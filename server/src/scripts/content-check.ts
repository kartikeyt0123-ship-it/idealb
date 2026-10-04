/**
 * Content self-check: proves every seeded variant is internally consistent.
 *
 *   npm run content:check -w server                 # everything
 *   npm run content:check -w server -- --domain web # one domain
 *   npm run content:check -w server -- --key web-cart-total
 *
 * For each variant it verifies:
 *  - structure (files, entries, tests, solution files only touch editable files)
 *  - CODE_TESTS: the buggy starter FAILS the hidden tests and the private solution PASSES all of them
 *  - EXACT_TEXT / NUMERIC: the private answer verifies; when a runnable solution
 *    is provided, running it prints exactly that answer, and the starter does not
 *  - variants differ (statements and answers / tests), so Day-2 answers are not Day-1 answers
 *  - counts: 5 templates per domain with 2 EASY / 2 MEDIUM / 1 HARD; >= 4 imposters
 *
 * Uses RUNNER_URL/RUNNER_TOKEN when set; otherwise starts ../runner/dist/server.js locally.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { regularTemplates, imposterTemplates } from '../content/index.js';
import { DOMAIN_ORDER, type TaskTemplate, type TaskVariant } from '../content/types.js';
import { judgeCode } from '../grading/codeJudge.js';
import { normalizeOutput, normalizeTextAnswer, parseNumericAnswer } from '../grading/normalize.js';
import { runnerExecute, runnerHealth, type RunnerConfig } from '../grading/runnerClient.js';

const args = process.argv.slice(2);
const onlyDomain = args.includes('--domain') ? args[args.indexOf('--domain') + 1] : undefined;
const onlyKey = args.includes('--key') ? args[args.indexOf('--key') + 1] : undefined;
const includeImposters = !onlyDomain || onlyDomain === 'imposter';

async function ensureRunner(): Promise<{ cfg: RunnerConfig; stop: () => void }> {
  if (process.env.RUNNER_URL && process.env.RUNNER_TOKEN) {
    const cfg = { url: process.env.RUNNER_URL, token: process.env.RUNNER_TOKEN };
    const h = await runnerHealth(cfg);
    if (!h.ok) throw new Error(`Runner at ${cfg.url} is not healthy: ${h.error}`);
    return { cfg, stop: () => undefined };
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const runnerJs = join(here, '..', '..', '..', 'runner', 'dist', 'server.js');
  if (!existsSync(runnerJs)) throw new Error(`Build the runner first: npm run build -w runner (missing ${runnerJs})`);
  const token = randomBytes(24).toString('hex');
  const port = 4300 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, [runnerJs], {
    env: { ...process.env, RUNNER_TOKEN: token, RUNNER_PORT: String(port), RUNNER_MAX_CONCURRENCY: '6' },
    stdio: 'ignore',
  });
  const cfg = { url: `http://127.0.0.1:${port}`, token };
  for (let i = 0; i < 50; i++) {
    const h = await runnerHealth(cfg);
    if (h.ok) return { cfg, stop: () => child.kill() };
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error('Local runner did not start.');
}

const FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;

function structural(t: TaskTemplate, v: number, x: TaskVariant): string[] {
  const e: string[] = [];
  const names = new Set(x.files.map((f) => f.name));
  if (!x.title.trim()) e.push('empty title');
  if (x.statement.trim().length < 40) e.push('statement too short');
  if (!x.hint.trim()) e.push('empty hint');
  if (!x.answerFormat.trim()) e.push('empty answerFormat');
  if (!x.solution.explanation.trim()) e.push('empty solution explanation');
  for (const f of x.files) if (!FILE_NAME.test(f.name)) e.push(`bad file name ${f.name}`);
  if (names.size !== x.files.length) e.push('duplicate file names');
  if (x.runLanguage && (!x.runEntry || !names.has(x.runEntry))) e.push('runEntry missing from files');
  const editable = new Set(x.files.filter((f) => !f.readOnly).map((f) => f.name));
  for (const k of Object.keys(x.solution.files ?? {})) if (!editable.has(k)) e.push(`solution edits non-editable file ${k}`);
  const val = x.validation;
  if (val.mode === 'CODE_TESTS') {
    const all = new Set([...names, ...(val.harness ?? []).map((h) => h.name)]);
    if (!all.has(val.entry)) e.push('validation.entry not found');
    if (val.tests.length < 3) e.push('need >= 3 hidden tests');
    if (!x.solution.files || Object.keys(x.solution.files).length === 0) e.push('CODE_TESTS needs solution.files');
    if (x.runLanguage !== val.language) e.push('runLanguage must equal validation.language for CODE_TESTS');
  } else {
    if (x.solution.answer === undefined) e.push('solution.answer required');
    if (val.mode === 'NUMERIC' && !(val.tolerance >= 0)) e.push('tolerance must be >= 0');
  }
  void t;
  void v;
  return e;
}

function answerVerifies(x: TaskVariant, submitted: string): boolean {
  const val = x.validation;
  if (val.mode === 'EXACT_TEXT') {
    const o = { caseSensitive: val.caseSensitive, collapseWhitespace: val.collapseWhitespace };
    return normalizeTextAnswer(submitted, o) === normalizeTextAnswer(val.answer, o);
  }
  if (val.mode === 'NUMERIC') {
    const n = parseNumericAnswer(submitted);
    return n !== null && Math.abs(n - val.answer) <= val.tolerance + 1e-12;
  }
  return false;
}

async function checkVariant(cfg: RunnerConfig, t: TaskTemplate, v: 0 | 1 | 2 | 3): Promise<string[]> {
  let x: TaskVariant;
  try {
    x = t.variant(v);
  } catch (err) {
    return [`variant() threw: ${(err as Error).message}`];
  }
  const errs = structural(t, v, x);
  if (errs.length) return errs;
  const val = x.validation;
  if (val.mode === 'CODE_TESTS') {
    const starterFiles: Record<string, string> = Object.fromEntries(x.files.map((f) => [f.name, f.content]));
    const bad = await judgeCode(cfg, x.files, starterFiles, val);
    if (bad.passed) errs.push('starter code already PASSES all hidden tests (bug not present)');
    const good = await judgeCode(cfg, x.files, { ...starterFiles, ...x.solution.files }, val);
    if (!good.passed) errs.push(`solution FAILS hidden test #${good.firstFailure?.index} (${good.firstFailure?.reason}) ${good.firstFailure?.stderrTail ?? ''}`);
  } else {
    if (!answerVerifies(x, x.solution.answer!)) errs.push('solution.answer does not verify against validation');
    if (x.runLanguage && x.solution.files) {
      const files = Object.fromEntries(x.files.map((f) => [f.name, f.content]));
      const fixed = { ...files, ...x.solution.files };
      const r = await runnerExecute(cfg, { language: x.runLanguage, files: fixed, entry: x.runEntry!, stdin: x.sampleStdin ?? '' });
      const out = normalizeOutput(r.stdout);
      if (r.exitCode !== 0) errs.push(`fixed solution crashed: ${r.stderr.slice(-300)}`);
      else if (!answerVerifies(x, out)) errs.push(`fixed solution prints "${out.slice(0, 80)}" which does not verify`);
      const s = await runnerExecute(cfg, { language: x.runLanguage, files, entry: x.runEntry!, stdin: x.sampleStdin ?? '' });
      if (s.exitCode === 0 && answerVerifies(x, normalizeOutput(s.stdout))) errs.push('buggy starter already prints the correct answer');
    }
  }
  return errs;
}

function variantFingerprint(x: TaskVariant): string {
  const val = x.validation;
  if (val.mode === 'CODE_TESTS') return JSON.stringify(val.tests.map((t) => [t.stdin, t.expected]));
  return String(val.answer);
}

async function main() {
  const { cfg, stop } = await ensureRunner();
  let failures = 0;
  let checked = 0;
  try {
    const templates = [
      ...regularTemplates.filter((t) => (!onlyDomain || t.domain === onlyDomain) && (!onlyKey || t.key === onlyKey)),
      ...(includeImposters ? imposterTemplates.filter((t) => !onlyKey || t.key === onlyKey) : []),
    ];
    // Counts
    if (!onlyKey) {
      for (const d of DOMAIN_ORDER) {
        if (onlyDomain && onlyDomain !== d) continue;
        const ts = regularTemplates.filter((t) => t.domain === d);
        const c = { EASY: 0, MEDIUM: 0, HARD: 0 };
        ts.forEach((t) => c[t.difficulty]++);
        if (ts.length !== 5 || c.EASY !== 2 || c.MEDIUM !== 2 || c.HARD !== 1) {
          console.log(`✗ domain ${d}: expected 5 templates (2E/2M/1H), found ${ts.length} (${c.EASY}E/${c.MEDIUM}M/${c.HARD}H)`);
          failures++;
        }
      }
      if (includeImposters && imposterTemplates.length < 4) {
        console.log(`✗ imposters: expected >= 4, found ${imposterTemplates.length}`);
        failures++;
      }
    }
    const keys = new Set<string>();
    for (const t of templates) {
      if (keys.has(t.key)) { console.log(`✗ duplicate key ${t.key}`); failures++; }
      keys.add(t.key);
      const fps = new Set<string>();
      const statements = new Set<string>();
      for (const v of [0, 1, 2, 3] as const) {
        checked++;
        const errs = await checkVariant(cfg, t, v);
        if (errs.length) {
          failures++;
          console.log(`✗ ${t.key} v${v}: ${errs.join('; ')}`);
        } else {
          console.log(`✓ ${t.key} v${v}`);
        }
        try {
          const x = t.variant(v);
          fps.add(variantFingerprint(x));
          statements.add(x.statement);
        } catch { /* reported above */ }
      }
      if (fps.size < 4) { failures++; console.log(`✗ ${t.key}: variants must have 4 distinct answers/test sets (found ${fps.size})`); }
      if (statements.size < 4) { failures++; console.log(`✗ ${t.key}: variants must have 4 distinct statements (found ${statements.size})`); }
    }
  } finally {
    stop();
  }
  console.log(`\n${checked} variants checked, ${failures} problem(s).`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
