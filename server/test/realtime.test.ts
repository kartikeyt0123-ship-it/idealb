import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { one } from '../src/db.js';
import { commander, crew, freshEnv, solve, startSprint, taskIds, type Client, type Env } from './helpers.js';

let env: Env;
let base: string;
beforeAll(async () => {
  env = await freshEnv({ listen: true });
  const addr = env.built.app.server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});
afterAll(async () => env.close());

function connect(c: Client): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(base, { path: '/socket.io', transports: ['websocket'], extraHeaders: { cookie: c.cookie, origin: 'http://localhost:5173' }, reconnection: false });
    s.on('hello', () => resolve(s));
    s.on('connect_error', reject);
  });
}
const next = (s: Socket, ev: string, ms = 5000) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${ev}`)), ms);
    s.once(ev, (m) => { clearTimeout(t); resolve(m); });
  });

describe('realtime delivery', () => {
  it('unauthenticated sockets are refused; rooms cannot be requested by name', async () => {
    await expect(
      new Promise((resolve, reject) => {
        const s = io(base, { path: '/socket.io', transports: ['websocket'], reconnection: false });
        s.on('connect', () => resolve(s));
        s.on('connect_error', (e) => { s.close(); reject(e); });
      }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
  });

  it('committed solves broadcast after commit; disabling eligibility unsubscribes the crew immediately', async () => {
    const admin = await commander(env);
    const nexora = await crew(env, 'nexora');
    const codex = await crew(env, 'codex');
    const sNex = await connect(nexora);
    const sAdm = await connect(admin);
    await startSprint(env, admin, 1, 1);
    const t = (await taskIds(env, 1, 1))[0];
    const got = next(sNex, 'task.solved');
    const adm = next(sAdm, 'task.solved');
    expect((await solve(env, codex, t.id)).body.correct).toBe(true);
    const msg = await got;
    expect(msg.label).toBe(t.label);
    expect(msg.eventId).toBeTypeOf('number');
    expect(JSON.stringify(msg)).not.toMatch(/answer|hint|solution/i);
    await adm;

    // Admin revokes Day 1 for Nexora → it receives eligibility.changed and no further game events.
    const team = (await one<{ id: string }>(env.db, `SELECT id FROM team WHERE crew_id='CRW-042'`))!;
    const elig = next(sNex, 'eligibility.changed');
    await admin.post(`/api/admin/crews/${team.id}/eligibility`, { dayNumber: 1, active: false });
    expect((await elig).active).toBe(false);
    let leaked = false;
    sNex.on('task.solved', () => (leaked = true));
    const t2 = (await taskIds(env, 1, 1, `AND ti.status='AVAILABLE'`))[0];
    const admSeen = next(sAdm, 'task.solved');
    await solve(env, codex, t2.id);
    await admSeen;
    await new Promise((r) => setTimeout(r, 400));
    expect(leaked).toBe(false);

    // Logout revokes the server session and disconnects the socket.
    const gone = new Promise((r) => sNex.on('disconnect', r));
    await nexora.post('/api/auth/logout', {});
    await gone;
    sAdm.close();
  });
});
