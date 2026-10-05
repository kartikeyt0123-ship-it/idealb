#!/usr/bin/env node
/**
 * One-command local stack: PostgreSQL (embedded, unless DATABASE_URL points elsewhere and --no-db),
 * code runner, API, competition worker and the Vite web app.
 *   npm run dev            # everything
 *   npm run dev -- --no-db # use an existing DATABASE_URL (e.g. docker compose postgres)
 *   npm run dev -- --no-web
 *   npm run live           # = dev --live: builds the web app, serves it from the API on :4000
 *                          #   and opens a public Cloudflare quick tunnel (https://….trycloudflare.com)
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const LIVE = args.has('--live');
const env = { ...process.env };
if (existsSync(join(root, '.env'))) {
  for (const line of readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2];
  }
}
const colors = ['\x1b[36m', '\x1b[35m', '\x1b[33m', '\x1b[32m', '\x1b[34m'];
const children = [];
function run(name, cmd, cmdArgs, cwd, i, extraEnv = {}) {
  const child = spawn(cmd, cmdArgs, { cwd, env: { ...env, ...extraEnv }, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `${colors[i % colors.length]}[${name}]\x1b[0m `;
  const pipe = (s) => s.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(tag + l));
  child.stdout.on('data', pipe);
  child.stderr.on('data', pipe);
  child.on('exit', (code) => console.log(`${tag}exited (${code})`));
  children.push(child);
  return child;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url, label, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await wait(500);
  }
  throw new Error(`${label} did not become ready`);
}

// Kill whole process trees (Windows does not propagate signals to grandchildren like tsx/postgres).
import { execSync } from 'node:child_process';
function killTree(c) {
  if (!c.pid || c.exitCode !== null) return;
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${c.pid} /T /F`, { stdio: 'ignore' });
    else c.kill('SIGTERM');
  } catch { /* already gone */ }
}
let stopping = false;
const stopAll = () => {
  if (stopping) return;
  stopping = true;
  console.log('Stopping AMONG BUG stack…');
  // Stop the database last so the API/worker can shut down cleanly.
  [...children].reverse().forEach(killTree);
  setTimeout(() => process.exit(0), 1500);
};
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
process.on('SIGHUP', stopAll);

if (!args.has('--no-db')) {
  const db = run('db', 'node', ['scripts/local-db.mjs'], root, 0);
  await new Promise((resolve, reject) => {
    db.stdout.on('data', (d) => d.toString().includes('ready') && resolve());
    db.on('exit', (code) => reject(new Error(`local database exited (${code}) — see the [db] lines above`)));
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
run('runner', 'npx', ['tsx', 'src/server.ts'], join(root, 'runner'), 1);
await waitFor(`http://127.0.0.1:${env.RUNNER_PORT ?? 4100}/health`, 'runner');
if (env.DEMO_MODE === 'true') {
  await new Promise((resolve) => run('seed', 'npx', ['tsx', 'src/scripts/seed-demo.ts'], join(root, 'server'), 2).on('exit', resolve));
}
const PORT = env.PORT ?? 4000;
if (LIVE) {
  // Production-style single origin: the API serves the built web app (strict CSP) on one port.
  if (!args.has('--no-build')) {
    console.log('[live] building the web app…');
    const code = await new Promise((resolve) => run('build', 'npx', ['vite', 'build'], join(root, 'web'), 2).on('exit', resolve));
    if (code !== 0) {
      console.error('[live] web build failed');
      stopAll();
    }
  }
  run('api', 'npx', ['tsx', 'src/index.ts'], join(root, 'server'), 3, { WEB_DIST_DIR: join(root, 'web', 'dist'), TRUST_PROXY: 'true' });
} else {
  run('api', 'npx', ['tsx', 'watch', 'src/index.ts'], join(root, 'server'), 3);
}
await waitFor(`http://127.0.0.1:${PORT}/api/health`, 'api');
run('worker', 'npx', ['tsx', 'src/worker.ts'], join(root, 'server'), 4);

if (LIVE) {
  const local = join(root, 'tools', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  const bin = env.CLOUDFLARED ?? (existsSync(local) ? local : 'cloudflared');
  const tunnel = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(tunnel);
  let announced = false;
  const scan = (d) => {
    const m = d.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !announced) {
      announced = true;
      console.log(`\n  ===============================================================\n  AMONG BUG IS LIVE  ->  ${m[0]}\n  (local: http://127.0.0.1:${PORT})   Ctrl+C stops everything\n  ===============================================================\n`);
    }
  };
  tunnel.stdout.on('data', scan);
  tunnel.stderr.on('data', scan);
  tunnel.on('error', (e) => console.error(`[live] could not start cloudflared (${e.message}). Download it to tools/ (see README "Live link").`));
  tunnel.on('exit', (code) => !stopping && console.log(`[live] tunnel exited (${code})`));
} else {
  if (!args.has('--no-web')) run('web', 'npx', ['vite', '--host', '127.0.0.1', '--port', '5173'], join(root, 'web'), 0);
  console.log('\n  AMONG BUG is starting →  http://127.0.0.1:5173   (API http://127.0.0.1:4000)\n');
}
