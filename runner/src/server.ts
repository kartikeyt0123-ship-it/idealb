/**
 * AMONG BUG execution runner.
 *
 * A small, separate HTTP service that executes untrusted participant code
 * (JavaScript via Node, Python via CPython) with hard limits. The scoring API
 * never spawns processes itself; it calls this service over the internal
 * network with a shared bearer token.
 *
 * Isolation layers (see docs/RUNBOOK.md):
 *  - container: non-root user, read-only root fs, tmpfs work dir, no egress
 *    network, pids/memory/cpu caps (docker-compose.yml)
 *  - process: per-job temp dir, minimal environment, wall-clock timeout,
 *    stdout/stderr byte caps, Node permission model (no fs writes, no
 *    child_process, no workers), Python isolated mode (-I)
 *  - service: bearer token, request size cap, bounded concurrency + queue
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';

const PORT = Number(process.env.RUNNER_PORT ?? 4100);
const HOST = process.env.RUNNER_HOST ?? '127.0.0.1';
const TOKEN = process.env.RUNNER_TOKEN ?? '';
const NODE_BIN = process.env.RUNNER_NODE_BIN ?? process.execPath;
const PYTHON_BIN = process.env.RUNNER_PYTHON_BIN ?? (process.platform === 'win32' ? 'python' : 'python3');
const MAX_CONCURRENCY = Number(process.env.RUNNER_MAX_CONCURRENCY ?? 4);
const MAX_QUEUE = Number(process.env.RUNNER_MAX_QUEUE ?? 200);
const MAX_OUTPUT = Number(process.env.RUNNER_MAX_OUTPUT_BYTES ?? 256 * 1024);
/**
 * Extra read-only module paths for Python (numpy / pandas / matplotlib for the
 * data and maker questions). Docker installs them system-wide, which -I sees.
 * Locally (non-production) the user's site-packages are added unless
 * RUNNER_PYTHON_USER_SITE=false; RUNNER_PYTHON_PATHS adds explicit dirs (';' or ':' separated).
 */
function pythonExtraPaths(): string[] {
  const out = (process.env.RUNNER_PYTHON_PATHS ?? '').split(process.platform === 'win32' ? ';' : ':').map((x) => x.trim()).filter(Boolean);
  const useUser = (process.env.RUNNER_PYTHON_USER_SITE ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true';
  if (useUser) {
    const r = spawnSync(process.env.RUNNER_PYTHON_BIN ?? (process.platform === 'win32' ? 'python' : 'python3'), ['-c', 'import site;print(site.getusersitepackages())'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    const p = r.stdout?.trim();
    if (r.status === 0 && p) out.push(p);
  }
  return out;
}
const PY_EXTRA_PATHS = pythonExtraPaths();
const MAX_BODY = 512 * 1024;
const MAX_TIMEOUT_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 4_000;

if (!TOKEN || TOKEN.length < 16) {
  console.error('[runner] RUNNER_TOKEN must be set (>= 16 chars). Refusing to start.');
  process.exit(1);
}

type Language = 'javascript' | 'python';

interface ExecuteRequest {
  language: Language;
  files: Record<string, string>;
  entry: string;
  stdin?: string;
  timeoutMs?: number;
}

interface ExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  outputTruncated: boolean;
  durationMs: number;
  language: Language;
  runtime: string;
}

function detectVersion(bin: string, args: string[]): string | null {
  try {
    const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 5000, windowsHide: true });
    if (r.status !== 0) return null;
    return (r.stdout || r.stderr).trim();
  } catch {
    return null;
  }
}

const runtimes: Record<Language, string | null> = {
  javascript: detectVersion(NODE_BIN, ['--version']),
  python: detectVersion(PYTHON_BIN, ['--version']),
};
const nodeMajor = Number((runtimes.javascript ?? 'v0').replace(/^v/, '').split('.')[0]);
const nodePermissionFlag = nodeMajor >= 22 ? '--permission' : nodeMajor >= 20 ? '--experimental-permission' : null;

// ---- concurrency gate -------------------------------------------------------
let active = 0;
const queue: Array<() => void> = [];
function acquire(): Promise<void> | null {
  if (active < MAX_CONCURRENCY) {
    active++;
    return Promise.resolve();
  }
  if (queue.length >= MAX_QUEUE) return null;
  return new Promise((resolve) => queue.push(() => { active++; resolve(); }));
}
function release() {
  active--;
  const next = queue.shift();
  if (next) next();
}

const FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;

function validate(body: unknown): ExecuteRequest | string {
  if (!body || typeof body !== 'object') return 'Body must be a JSON object.';
  const b = body as Record<string, unknown>;
  if (b.language !== 'javascript' && b.language !== 'python') return 'Unsupported language.';
  if (!b.files || typeof b.files !== 'object') return 'files must be an object.';
  const files = b.files as Record<string, unknown>;
  const names = Object.keys(files);
  if (names.length === 0 || names.length > 12) return 'Provide 1-12 files.';
  let total = 0;
  for (const n of names) {
    if (!FILE_NAME.test(n)) return `Invalid file name: ${n}`;
    if (typeof files[n] !== 'string') return `File ${n} must be a string.`;
    total += (files[n] as string).length;
  }
  if (total > 300_000) return 'Files too large.';
  if (typeof b.entry !== 'string' || !(b.entry in files)) return 'entry must name one of the files.';
  if (b.stdin !== undefined && (typeof b.stdin !== 'string' || b.stdin.length > 100_000)) return 'Invalid stdin.';
  const timeoutMs = b.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : Number(b.timeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100) return 'Invalid timeout.';
  return {
    language: b.language,
    files: files as Record<string, string>,
    entry: b.entry,
    stdin: (b.stdin as string | undefined) ?? '',
    timeoutMs: Math.min(timeoutMs, MAX_TIMEOUT_MS),
  };
}

async function execute(req: ExecuteRequest): Promise<ExecuteResult> {
  const runtime = runtimes[req.language];
  if (!runtime) throw Object.assign(new Error(`${req.language} runtime is not installed on this runner.`), { status: 501 });
  const dir = await mkdtemp(join(tmpdir(), 'ab-job-'));
  try {
    for (const [name, content] of Object.entries(req.files)) {
      await writeFile(join(dir, name), content, 'utf8');
    }
    const entryPath = join(dir, req.entry);
    let bin: string;
    let args: string[];
    if (req.language === 'javascript') {
      bin = NODE_BIN;
      args = ['--max-old-space-size=128', '--stack-size=2048'];
      if (nodePermissionFlag) args.push(nodePermissionFlag, `--allow-fs-read=${dir}`);
      args.push(entryPath);
    } else {
      bin = PYTHON_BIN;
      // Still isolated (-I: no env vars, no implicit user site); allowed library dirs are added explicitly.
      args = PY_EXTRA_PATHS.length
        ? ['-I', '-B', '-c', `import sys, runpy; sys.path[:0] = ${JSON.stringify(PY_EXTRA_PATHS)}; sys.argv = [${JSON.stringify(entryPath)}]; runpy.run_path(${JSON.stringify(entryPath)}, run_name='__main__')`]
        : ['-I', '-B', entryPath];
    }
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '',
      PYTHONIOENCODING: 'utf-8',
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONHASHSEED: '0',
      NODE_OPTIONS: '',
      LANG: 'C.UTF-8',
      // matplotlib: headless backend, config/cache inside the job dir.
      MPLBACKEND: 'Agg',
      MPLCONFIGDIR: dir,
      HOME: dir,
    };
    if (process.platform === 'win32') {
      // CPython on Windows needs SYSTEMROOT to initialise its random source.
      env.SYSTEMROOT = process.env.SYSTEMROOT ?? 'C:\\Windows';
    }
    const started = Date.now();
    return await new Promise<ExecuteResult>((resolve) => {
      const child = spawn(bin, args, { cwd: dir, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let truncated = false;
      let timedOut = false;
      const kill = () => { try { child.kill('SIGKILL'); } catch { /* already gone */ } };
      const timer = setTimeout(() => { timedOut = true; kill(); }, req.timeoutMs);
      const append = (which: 'out' | 'err', chunk: Buffer) => {
        const cur = which === 'out' ? stdout : stderr;
        if (cur.length + chunk.length > MAX_OUTPUT) {
          truncated = true;
          const room = Math.max(0, MAX_OUTPUT - cur.length);
          const next = Buffer.concat([cur, chunk.subarray(0, room)]);
          if (which === 'out') stdout = next; else stderr = next;
          kill();
          return;
        }
        if (which === 'out') stdout = Buffer.concat([cur, chunk]); else stderr = Buffer.concat([cur, chunk]);
      };
      child.stdout.on('data', (c: Buffer) => append('out', c));
      child.stderr.on('data', (c: Buffer) => append('err', c));
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          stdout: '', stderr: `Runner could not start ${req.language}: ${err.message}`, exitCode: null, signal: null,
          timedOut: false, outputTruncated: false, durationMs: Date.now() - started, language: req.language, runtime,
        });
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        // Strip the temp directory from tracebacks so participants see stable paths.
        const clean = (s: string) => s.split(dir).join('/workspace');
        resolve({
          stdout: clean(stdout.toString('utf8')),
          stderr: clean(stderr.toString('utf8')),
          exitCode: code,
          signal: signal ?? null,
          timedOut,
          outputTruncated: truncated,
          durationMs: Date.now() - started,
          language: req.language,
          runtime,
        });
      });
      child.stdin.on('error', () => { /* process may exit before reading stdin */ });
      child.stdin.end(req.stdin ?? '');
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

function authorized(req: IncomingMessage): boolean {
  const h = req.headers.authorization ?? '';
  const expected = Buffer.from(`Bearer ${TOKEN}`);
  const got = Buffer.from(h);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true, active, queued: queue.length, runtimes, permissionModel: nodePermissionFlag });
  }
  if (req.method !== 'POST' || req.url !== '/execute') return send(res, 404, { error: 'NOT_FOUND' });
  if (!authorized(req)) return send(res, 401, { error: 'UNAUTHORIZED' });
  let size = 0;
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size > MAX_BODY) { send(res, 413, { error: 'PAYLOAD_TOO_LARGE' }); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', async () => {
    if (res.headersSent) return;
    let parsed: unknown;
    try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, 400, { error: 'BAD_JSON' }); }
    const v = validate(parsed);
    if (typeof v === 'string') return send(res, 400, { error: 'INVALID_REQUEST', message: v });
    const gate = acquire();
    if (!gate) return send(res, 503, { error: 'RUNNER_BUSY', message: 'Runner queue is full. Try again shortly.' });
    await gate;
    try {
      const result = await execute(v);
      send(res, 200, result);
    } catch (err) {
      const e = err as Error & { status?: number };
      send(res, e.status ?? 500, { error: 'EXECUTION_FAILED', message: e.message });
    } finally {
      release();
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[runner] listening on ${HOST}:${PORT} · javascript=${runtimes.javascript ?? 'unavailable'} · python=${runtimes.python ?? 'unavailable'}${PY_EXTRA_PATHS.length ? ` (+${PY_EXTRA_PATHS.length} lib path)` : ''} · node permission=${nodePermissionFlag ?? 'none'}`);
});
