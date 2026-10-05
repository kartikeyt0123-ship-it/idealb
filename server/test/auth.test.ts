import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, crew, crewLogin, freshEnv, organizer, slotId, V, type Env } from './helpers.js';

let env: Env;
beforeAll(async () => {
  env = await freshEnv();
});
afterAll(async () => env?.close());

describe('access model', () => {
  it('has no public registration endpoint, old or new', async () => {
    const c = new Client(env);
    for (const url of [`${V}/auth/register`, '/api/auth/register', `${V}/teams`]) {
      const r = await c.post(url, { teamName: 'X', email: 'x@example.test', password: 'Aa1!aaaaaaaa' });
      expect(r.status, url).toBe(404);
    }
    const meta = await c.get(`${V}/meta`);
    expect(meta.body.registration).toBe(false);
    expect(meta.body.event.name).toBe('AMONG BUG');
    expect(meta.body.event.organizer).toBe('IDEALab.h');
    expect(JSON.stringify(meta.body)).not.toMatch(/CrewDemo123|idealab"|password/i);
  });

  it('crews sign in with captain email or CRW id; the session sees its own slot', async () => {
    const byEmail = await crewLogin(env, 'nexora@example.test', 'CrewDemo123!');
    const me = await byEmail.get(`${V}/me`);
    expect(me.body.role).toBe('CREW');
    expect(me.body.team.crewId).toBe('CRW-001');
    expect(me.body.access.state).toBe('ASSIGNED');
    expect(me.body.access.slot.number).toBe(1);
    expect(me.body.access.slot.date).toBe('2026-10-08');
    expect(JSON.stringify(me.body)).not.toMatch(/password_hash|scrypt/);
    const byId = await crewLogin(env, 'crw-001', 'CrewDemo123!');
    expect((await byId.get(`${V}/me`)).body.team.name).toBe('Nexora');
  });

  it('rejects wrong passwords, disabled accounts and crews without credentials with generic errors', async () => {
    const c = new Client(env);
    expect((await c.post(`${V}/auth/crew-login`, { identifier: 'nexora@example.test', password: 'nope-nope' })).status).toBe(401);
    expect((await c.post(`${V}/auth/crew-login`, { identifier: 'ghost@example.test', password: 'nope-nope' })).body.error).toBe('INVALID_CREDENTIALS');
    await env.db.query(`UPDATE team SET account_enabled=false WHERE crew_id='CRW-040'`);
    expect((await c.post(`${V}/auth/crew-login`, { identifier: 'CRW-040', password: 'Crew-040-Demo!' })).body.error).toBe('ACCOUNT_DISABLED');
    await env.db.query(`UPDATE team SET account_enabled=true WHERE crew_id='CRW-040'`);
    await env.db.query(`UPDATE team SET password_hash=NULL WHERE crew_id='CRW-039'`);
    expect((await c.post(`${V}/auth/crew-login`, { identifier: 'CRW-039', password: 'Crew-039-Demo!' })).body.error).toBe('INVALID_CREDENTIALS');
  });

  it('organizer login is separate; crews are refused on organizer endpoints and vice versa', async () => {
    const org = await organizer(env);
    const me = await org.get(`${V}/me`);
    expect(me.body.role).toBe('ORGANIZER');
    expect(me.body.organizer.permissions).toContain('slots.control');
    const c = await crew(env, 2);
    expect((await c.get(`${V}/admin/overview`)).body.error).toBe('ORGANIZER_CLEARANCE_REQUIRED');
    expect((await c.get(`${V}/admin/teams`)).status).toBe(403);
    expect((await new Client(env).post(`${V}/auth/organizer-login`, { email: 'nexora@example.test', password: 'CrewDemo123!' })).status).toBe(401);
    expect((await org.get(`${V}/slots/mine/state`)).status).toBe(403);
  });

  it('state-changing calls need the CSRF header and an allowed origin', async () => {
    const r = await env.built.app.inject({ method: 'POST', url: `${V}/auth/crew-login`, headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ identifier: 'CRW-001', password: 'CrewDemo123!' }) });
    expect(r.statusCode).toBe(403);
    const r2 = await env.built.app.inject({ method: 'POST', url: `${V}/auth/crew-login`, headers: { 'content-type': 'application/json', 'x-requested-with': 'amongbugs', origin: 'https://evil.example', host: '127.0.0.1:4000' }, payload: JSON.stringify({ identifier: 'CRW-001', password: 'CrewDemo123!' }) });
    expect(r2.statusCode).toBe(403);
  });

  it('caps concurrent sessions at 4 per crew (oldest is signed out)', async () => {
    const devices: Client[] = [];
    for (let i = 0; i < 5; i++) devices.push(await crew(env, 3));
    expect((await devices[0].get(`${V}/me`)).body.role).toBe(null);
    for (const d of devices.slice(1)) expect((await d.get(`${V}/me`)).body.role).toBe('CREW');
  });

  it('change-password keeps this device and signs out the others', async () => {
    const a = await crew(env, 4);
    const b = await crew(env, 4);
    const r = await a.post(`${V}/auth/change-password`, { currentPassword: 'Crew-004-Demo!', newPassword: 'Brand-New-Pass-42!' });
    expect(r.status).toBe(200);
    expect((await a.get(`${V}/me`)).body.role).toBe('CREW');
    expect((await b.get(`${V}/me`)).body.role).toBe(null);
    await crewLogin(env, 'CRW-004', 'Brand-New-Pass-42!');
  });

  it('a crew URL naming another slot is refused (slot ids never authorize)', async () => {
    const c = await crew(env, 1);
    const other = await slotId(env, 2);
    const r = await c.get(`${V}/slots/${other}/state`);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('WRONG_SLOT');
    const own = await c.get(`${V}/slots/${await slotId(env, 1)}/state`);
    expect(own.status).toBe(200);
  });

  it('publishes an OpenAPI document covering every v1 route', async () => {
    const doc = (await new Client(env).get(`${V}/openapi.json`)).body;
    expect(doc.openapi).toBe('3.0.3');
    for (const p of ['/api/v1/auth/crew-login', '/api/v1/admin/teams/imports', '/api/v1/question-instances/{id}/submissions', '/api/v1/display/slots/{slotId}/sprints/{sprintId}', '/api/v1/leaderboards']) {
      expect(doc.paths[p], p).toBeTruthy();
    }
    expect(Object.keys(doc.paths).some((p) => /register/.test(p))).toBe(false);
  });
});
