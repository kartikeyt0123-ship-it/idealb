/**
 * npm run bank:check — validates every IDEALab.dev question (bundled snapshot,
 * or `--github [repo] [--ref main]`) against the real runtimes:
 *
 *   python  hidden setup + the starter code run without import / setup errors,
 *           and the buggy starter does NOT already print the flag
 *   sql     the default query runs; the flag is somewhere in the hidden tables
 *   shell   the flag is discoverable in the virtual terminal; hint commands are supported
 *   json    the expected state is accepted and reveals the flag
 *   web     an index.html exists for the preview
 *   evidence the board is not empty
 *
 * It cannot prove the intended fix (the repository has no reference solutions);
 * it proves each problem is wired up and its flag is reachable.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertDomainFile, fetchFromGitHub, IDEALAB_DOMAIN_FILES, IDEALAB_REPO, loadSnapshot, type ConvertedQuestion } from '../content/idealab.js';
import { runnerExecute, runnerHealth, type RunnerConfig } from '../grading/runnerClient.js';
import { buildPythonJob, buildSqlJob, runJsonCheck } from '../services/runtimes.js';
import { runShell } from '../services/shell.js';

const args = process.argv.slice(2);

async function ensureRunner(): Promise<{ cfg: RunnerConfig; stop: () => void }> {
  if (process.env.RUNNER_URL && process.env.RUNNER_TOKEN && args.includes('--use-env-runner')) {
    const cfg = { url: process.env.RUNNER_URL, token: process.env.RUNNER_TOKEN };
    return { cfg, stop: () => undefined };
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const runnerJs = join(here, '..', '..', '..', 'runner', 'dist', 'server.js');
  if (!existsSync(runnerJs)) throw new Error('Build the runner first: npm run build -w runner');
  const token = randomBytes(24).toString('hex');
  const port = 4800 + Math.floor(Math.random() * 400);
  const child = spawn(process.execPath, [runnerJs], { env: { ...process.env, RUNNER_TOKEN: token, RUNNER_PORT: String(port), RUNNER_MAX_CONCURRENCY: '6' }, stdio: 'ignore' });
  const cfg = { url: `http://127.0.0.1:${port}`, token };
  for (let i = 0; i < 80; i++) {
    if ((await runnerHealth(cfg)).ok) return { cfg, stop: () => child.kill() };
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error('Local runner did not start.');
}

async function check(cfg: RunnerConfig, q: ConvertedQuestion): Promise<string[]> {
  const v = q.variant;
  const flag = v.solution.answer!;
  const has = (s: string) => s.toLowerCase().includes(flag.toLowerCase());
  const e: string[] = [];
  const rt = v.runtime;
  if (rt?.kind === 'python') {
    const job = buildPythonJob(rt, v.files.find((f) => f.name === 'main.py')?.content ?? '', '', flag);
    const r = await runnerExecute(cfg, { language: 'python', files: job.files, entry: job.entry, stdin: job.stdin, timeoutMs: 10_000 });
    const out = job.finish(r.stdout);
    if (/ModuleNotFoundError|ImportError/.test(r.stderr)) e.push(`missing library: ${r.stderr.trim().split('\n').pop()}`);
    else if (r.stderr.includes('<setup>')) e.push(`hidden setup fails: ${r.stderr.trim().split('\n').pop()}`);
    if (r.timedOut) e.push('NOTE starter code times out (10 s) — expected when the bug is an infinite loop');
    if (rt.suffix && has(out.stdout) && !rt.prefix?.includes(flag)) e.push('the unmodified starter already prints the flag');
    if (rt.plot && !out.images.length && !r.stderr) e.push('NOTE plot question: the starter draws nothing yet (the crew writes the plot)');
  } else if (rt?.kind === 'sql') {
    const job = buildSqlJob(rt, v.files[0]?.content ?? 'SELECT 1;');
    const r = await runnerExecute(cfg, { language: 'python', files: job.files, entry: job.entry, stdin: '', timeoutMs: 5000 });
    if (r.exitCode !== 0) e.push(`default query fails: ${r.stderr.trim()}`);
    if (!has(JSON.stringify(rt.tables))) e.push('flag not present in any table');
  } else if (rt?.kind === 'shell') {
    const probe = ['ls -la', 'cat * .*', 'grep -r . .', 'env', 'whoami', 'pwd', 'history', ...(rt.initialCommand ? [rt.initialCommand] : [])].map((c) => runShell(rt, c).stdout).join('\n');
    const echoOnly = !has(probe);
    for (const h of v.hints ?? []) for (const m of h.text.matchAll(/`([^`]+)`/g)) {
      const c = m[1];
      if (!/^[a-z.~/]/.test(c) || /^\/etc|^rwx|^\.\w/.test(c)) continue;
      const r = runShell(rt, c);
      if (/command not found|supported here|unknown predicate|syntax error/.test(r.stderr)) e.push(`hint command unsupported: ${c} → ${r.stderr.trim()}`);
    }
    if (echoOnly && !/echo/i.test(v.statement + (v.hints ?? []).map((h) => h.text).join(' '))) e.push('NOTE flag is not literally in the files — it must be computed or decoded in the terminal (verify the puzzle data)');
  } else if (rt?.kind === 'json') {
    const r = runJsonCheck(rt, JSON.stringify(rt.expected));
    if (!r.success) e.push('expected state is not accepted');
    if (!has(r.stdout)) e.push('success message does not reveal the flag');
  } else if (v.workspace === 'WEB') {
    if (!v.files.some((f) => f.name === 'index.html')) e.push('no index.html');
    if (!v.files.some((f) => !f.readOnly)) e.push('NOTE no editable file — an interaction / inspection puzzle in the preview');
  } else if (v.workspace === 'EVIDENCE') {
    if (!v.board?.content.trim()) e.push('empty evidence board');
  }
  return e;
}

async function main() {
  const src = args.includes('--github')
    ? await fetchFromGitHub(args[args.indexOf('--github') + 1]?.startsWith('http') ? args[args.indexOf('--github') + 1] : IDEALAB_REPO, args.includes('--ref') ? args[args.indexOf('--ref') + 1] : 'main')
    : loadSnapshot();
  console.log(`IDEALab bank from ${src.source.repo} @ ${src.source.commit || 'snapshot'}`);
  const { cfg, stop } = await ensureRunner();
  let total = 0;
  let problems = 0;
  let notes = 0;
  try {
    for (const d of IDEALAB_DOMAIN_FILES) {
      const conv = convertDomainFile(d, src.domains[d], src.source);
      for (const err of conv.errors) {
        problems++;
        console.log(`✗ ${err.id}: ${err.error}`);
      }
      const results = await Promise.all(conv.ok.map(async (q) => [q, await check(cfg, q)] as const));
      for (const [q, errs] of results) {
        total++;
        const real = errs.filter((x) => !x.startsWith('NOTE '));
        const info = errs.filter((x) => x.startsWith('NOTE ')).map((x) => x.slice(5));
        problems += real.length;
        notes += info.length;
        if (real.length) console.log(`✗ ${q.key} (${q.variant.workspace}): ${real.join('; ')}`);
        if (info.length && args.includes('--notes')) console.log(`  · ${q.key}: ${info.join('; ')}`);
      }
      console.log(`  ${d}: ${conv.ok.length} checked`);
    }
  } finally {
    stop();
  }
  console.log(`\n${total} questions checked, ${problems} problem(s), ${notes} note(s) (show them with --notes).`);
  process.exit(problems ? 1 : 0);
}

void main().catch((e) => {
  console.error(e);
  process.exit(2);
});
