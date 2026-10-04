/**
 * Starts a throwaway REAL PostgreSQL (embedded-postgres) and the real code
 * runner for the integration suite. Nothing here is mocked.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

let pgServer: EmbeddedPostgres | undefined;
let runner: ChildProcess | undefined;
let dir: string | undefined;

export async function setup() {
  dir = mkdtempSync(join(tmpdir(), 'ab-test-pg-'));
  const port = 55000 + Math.floor(Math.random() * 2000);
  pgServer = new EmbeddedPostgres({
    databaseDir: dir, user: 'postgres', password: 'test', port, persistent: false,
    initdbFlags: ['--encoding=UTF8', '--no-locale'], onLog: () => {},
  });
  await pgServer.initialise();
  await pgServer.start();
  const c = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'test', database: 'postgres' });
  await c.connect();
  await c.query(`CREATE DATABASE ab_test ENCODING 'UTF8' TEMPLATE template0`);
  await c.end();
  process.env.DATABASE_URL = `postgres://postgres:test@127.0.0.1:${port}/ab_test`;
  process.env.TEST_PG_PORT = String(port);

  const here = dirname(fileURLToPath(import.meta.url));
  const runnerJs = join(here, '..', '..', 'runner', 'dist', 'server.js');
  if (!existsSync(runnerJs)) throw new Error('Build the runner first: npm run build -w runner');
  const rport = 46000 + Math.floor(Math.random() * 2000);
  const token = 'test-runner-token-0123456789abcdef';
  runner = spawn(process.execPath, [runnerJs], {
    env: { ...process.env, RUNNER_TOKEN: token, RUNNER_PORT: String(rport), RUNNER_MAX_CONCURRENCY: '6' },
    stdio: 'ignore',
  });
  process.env.RUNNER_URL = `http://127.0.0.1:${rport}`;
  process.env.RUNNER_TOKEN = token;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${process.env.RUNNER_URL}/health`)).ok) break;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  process.env.NODE_ENV = 'test';
  process.env.DEMO_MODE = 'true';
  process.env.GRADING_SECRET = 'test-grading-secret-0123456789abcdef';
}

export async function teardown() {
  runner?.kill();
  await pgServer?.stop().catch(() => undefined);
  if (dir) rmSync(dir, { recursive: true, force: true });
}
