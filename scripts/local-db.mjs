#!/usr/bin/env node
/**
 * Local PostgreSQL without Docker (real PostgreSQL binaries via embedded-postgres).
 * Data persists in ./.local-pg. Port 54329, user postgres, password amongbugs, db among_bugs.
 *   npm run db:local
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'server', 'package.json'));
const EmbeddedPostgres = require('embedded-postgres').default ?? require('embedded-postgres');
const pg = require('pg');

const PORT = Number(process.env.LOCAL_PG_PORT ?? 54329);
const pgServer = new EmbeddedPostgres({
  databaseDir: join(root, '.local-pg'),
  user: 'postgres',
  password: 'amongbugs',
  port: PORT,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--no-locale'],
  onLog: () => {},
});

import { existsSync } from 'node:fs';
if (!existsSync(join(root, '.local-pg', 'PG_VERSION'))) {
  console.log('[local-db] initialising data directory .local-pg');
  await pgServer.initialise();
}
// A force-killed server can leave postmaster.pid behind; remove it if nothing is listening, then retry.
import { rmSync } from 'node:fs';
import { createConnection } from 'node:net';
const portBusy = () => new Promise((r) => { const s = createConnection(PORT, '127.0.0.1'); s.on('connect', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });
try {
  await pgServer.start();
} catch (err) {
  const pid = join(root, '.local-pg', 'postmaster.pid');
  if (existsSync(pid) && !(await portBusy())) {
    console.log('[local-db] removing stale postmaster.pid and retrying');
    rmSync(pid);
    await pgServer.start();
  } else {
    console.error('[local-db] could not start PostgreSQL:', err?.message ?? err, (await portBusy()) ? `(port ${PORT} is already in use)` : '');
    process.exit(1);
  }
}
const c = new pg.Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'amongbugs', database: 'postgres' });
await c.connect();
const exists = await c.query(`SELECT 1 FROM pg_database WHERE datname='among_bugs'`);
if (!exists.rowCount) await c.query("CREATE DATABASE among_bugs ENCODING 'UTF8' TEMPLATE template0");
await c.end();
console.log(`[local-db] PostgreSQL ready: postgres://postgres:amongbugs@127.0.0.1:${PORT}/among_bugs`);
const stop = async () => { console.log('[local-db] stopping'); await pgServer.stop().catch(() => {}); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
