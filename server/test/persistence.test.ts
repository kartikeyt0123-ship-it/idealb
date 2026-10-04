import EmbeddedPostgres from 'embedded-postgres';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool, one } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { seedDemo } from '../src/seed/demo.js';
import { Client, solve, startSprint, taskIds, type Env } from './helpers.js';

/**
 * Restart API + worker + DATABASE with a persistent data directory:
 * registrations, balances, purchases and history must survive.
 */
describe('restart persistence', () => {
  it('survives an API and PostgreSQL restart on the same volume', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ab-persist-'));
    const port = 57100 + Math.floor(Math.random() * 500);
    const mkPg = () => new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'p', port, persistent: true, initdbFlags: ['--encoding=UTF8', '--no-locale'], onLog: () => {} });
    let server = mkPg();
    await server.initialise();
    await server.start();
    const c = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'p', database: 'postgres' });
    await c.connect();
    await c.query(`CREATE DATABASE persist ENCODING 'UTF8' TEMPLATE template0`);
    await c.end();
    const cfg = loadConfig({ logLevel: 'silent', nodeEnv: 'test', demoMode: true, databaseUrl: `postgres://postgres:p@127.0.0.1:${port}/persist` });

    // ---- first life
    let db = createPool(cfg.databaseUrl, 10);
    await migrate(db, () => undefined);
    await seedDemo(db, cfg, () => undefined);
    let built = await buildApp(cfg, { db });
    let env: Env = { cfg, db, built, close: async () => undefined };
    const anon = new Client(env);
    const reg = await anon.postKey('/api/auth/register', {
      teamName: 'Persistent Crew', captainEmail: 'persist@example.test', password: 'Survive-Restart-1', confirmPassword: 'Survive-Restart-1',
      members: ['A One', 'B Two', 'C Three'].map((n) => ({ name: n, institution: 'X', year: '1st year', branch: 'IT' })),
      requestedDays: 'BOTH', color: '#86cd97', rulesAccepted: true,
    }, 'persist-reg-key-01');
    expect(reg.status).toBe(201);
    const admin = new Client(env);
    await admin.loginAdmin();
    await startSprint(env, admin, 1, 1);
    const nx = new Client(env);
    await nx.loginCrew('nexora@example.test', 'CrewDemo123!');
    const t = (await taskIds(env, 1, 1))[0];
    expect((await solve(env, nx, t.id)).body.correct).toBe(true);
    const hintTask = (await taskIds(env, 1, 1, `AND ti.status='AVAILABLE'`))[0];
    expect((await nx.post(`/api/game/tasks/${hintTask.id}/hint`, {}, true)).status).toBe(200);
    const before = (await nx.get('/api/game/state')).body.me;
    const deadline = (await one<{ deadline_at: Date }>(db, `SELECT deadline_at FROM sprint WHERE status='RUNNING'`))!.deadline_at;
    const cookie = nx.cookie;

    await built.close();
    await db.end();
    await server.stop();

    // ---- second life (same volume)
    server = mkPg();
    await server.start();
    db = createPool(cfg.databaseUrl, 10);
    await migrate(db, () => undefined);
    await seedDemo(db, cfg, () => undefined); // re-running the seed must not reset anything
    built = await buildApp(cfg, { db });
    env = { cfg, db, built, close: async () => undefined };
    const again = new Client(env);
    again.cookie = cookie; // same browser session survives
    const after = (await again.get('/api/game/state')).body;
    expect(after.me.wallet).toBe(before.wallet);
    expect(after.me.spent).toBe(before.spent);
    expect(after.game.phase).toBe('RUNNING');
    expect((await again.get(`/api/game/tasks/${hintTask.id}`)).body.hint.unlocked).toBe(true);
    expect(new Date((await one<{ deadline_at: Date }>(db, `SELECT deadline_at FROM sprint WHERE status='RUNNING'`))!.deadline_at).getTime()).toBe(new Date(deadline).getTime());
    expect(await one(db, `SELECT id FROM team WHERE email_normalized='persist@example.test'`)).toBeTruthy();
    expect((await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM team'))!.n).toBe(21);

    await built.close();
    await db.end();
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  }, 120_000);
});
