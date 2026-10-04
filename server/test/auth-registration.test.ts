import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { many, one } from '../src/db.js';
import { Client, commander, crew, freshEnv, type Env } from './helpers.js';

let env: Env;
beforeAll(async () => {
  env = await freshEnv();
});
afterAll(async () => env.close());

const member = (n: string) => ({ name: n, institution: 'Test Institute', year: '2nd year', branch: 'CSE', studentId: '' });
const validReg = (name: string, email: string) => ({
  teamName: name,
  captainEmail: email,
  password: 'Orbital-Wrench-42',
  confirmPassword: 'Orbital-Wrench-42',
  members: [member('Asha Kulkarni'), member('Bilal Shah'), member('Chen Iyer'), member('Dev Mehta')],
  requestedDays: 'DAY1',
  color: '#b298e7',
  rulesAccepted: true,
});

describe('demo commander authentication', () => {
  it('exact demo admin credentials log in; wrong password fails', async () => {
    const a = new Client(env);
    const ok = await a.post('/api/auth/login', { mode: 'COMMANDER', identifier: 'admin@crm.local', password: 'idealab' });
    expect(ok.status).toBe(200);
    expect(ok.body.admin).toMatchObject({ email: 'admin@crm.local', name: 'IDEALab Commander', role: 'SUPER_ADMIN' });
    expect(JSON.stringify(ok.body)).not.toMatch(/scrypt|password/i);
    const bad = await new Client(env).post('/api/auth/login', { mode: 'COMMANDER', identifier: 'admin@crm.local', password: 'idealab!' });
    expect(bad.status).toBe(401);
    // Stored as a real scrypt hash, never plaintext.
    const row = await one<{ password_hash: string }>(env.db, `SELECT password_hash FROM admin_user WHERE email_normalized='admin@crm.local'`);
    expect(row!.password_hash.startsWith('scrypt$')).toBe(true);
    expect(row!.password_hash).not.toContain('idealab');
  });

  it('crews cannot select, forge or reach the commander role', async () => {
    const c = await crew(env, 'nexora');
    // Crew credentials are not admin credentials.
    const asCommander = await new Client(env).post('/api/auth/login', { mode: 'COMMANDER', identifier: 'nexora@example.test', password: 'CrewDemo123!' });
    expect(asCommander.status).toBe(401);
    // Swipe with a crew session: denied, no privileged payload.
    const swipe = await c.post('/api/command/authorize', {});
    expect(swipe.status).toBe(403);
    expect(swipe.body.error).toBe('COMMANDER_CLEARANCE_REQUIRED');
    // Direct admin routes / forged role fields are ignored.
    for (const url of ['/api/admin/overview', '/api/admin/crews', '/api/admin/problems', '/api/admin/export/crews']) {
      expect((await c.get(url)).status).toBe(403);
    }
    const forged = await c.req('GET', '/api/admin/overview', undefined, { 'x-role': 'SUPER_ADMIN', cookie: `${c.cookie}; role=COMMANDER` });
    expect(forged.status).toBe(403);
    // Commander swipe is granted by the server.
    const admin = await commander(env);
    const granted = await admin.post('/api/command/authorize', {});
    expect(granted.status).toBe(200);
    expect(granted.body.granted).toBe(true);
  });

  it('state-changing requests without the CSRF header or from foreign origins are rejected', async () => {
    const c = await crew(env, 'nexora');
    const noHeader = await c.req('POST', '/api/game/tasks/00000000-0000-0000-0000-000000000000/hint', {}, { 'x-requested-with': '' });
    expect(noHeader.status).toBe(403);
    const foreign = await c.req('POST', '/api/auth/logout', {}, { origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
  });

  it('login, refresh and logout preserve / revoke the server session', async () => {
    const c = await crew(env, 'nexora');
    expect((await c.get('/api/auth/me')).body.team.crewId).toBe('CRW-042');
    const second = c.clone(); // same cookie = refresh / reopened tab
    expect((await second.get('/api/game/state')).status).toBe(200);
    const stale = c.cookie;
    expect((await c.post('/api/auth/logout', {})).status).toBe(200);
    const after = new Client(env);
    after.cookie = stale;
    expect((await after.get('/api/auth/me')).body.role).toBeNull();
    expect((await after.get('/api/game/state')).status).toBe(401);
    // Unknown / random cookies never authenticate.
    const fake = new Client(env);
    fake.cookie = 'ab_sid=totally-made-up-token';
    expect((await fake.get('/api/game/state')).status).toBe(401);
  });
});

describe('team registration', () => {
  it('registers a valid 4-member team → pending → admin enables Day 1 → Day 1 lobby; Day 2 denied', async () => {
    const anon = new Client(env);
    const reg = await anon.postKey('/api/auth/register', validReg('Orbit Menders', 'Captain.Orbit@Example.Test'), 'reg-orbit-menders-001');
    expect(reg.status).toBe(201);
    expect(reg.body.status).toBe('PENDING_ACTIVATION');
    expect(reg.body.crewId).toMatch(/^CRW-\d{3,}$/);

    const c = new Client(env);
    const login = await c.loginCrew('captain.orbit@example.test', 'Orbital-Wrench-42');
    expect(login.body.access.state).toBe('REGISTRATION_PENDING');
    expect(login.body.access.message).toMatch(/awaiting organizer activation/i);
    expect((await c.get('/api/game/state')).status).toBe(403);

    const admin = await commander(env);
    const list = await admin.get('/api/admin/crews');
    const row = list.body.crews.find((x: { crew_id: string }) => x.crew_id === reg.body.crewId);
    expect(row).toBeTruthy();
    expect(row.requested_days).toBe('DAY1');
    expect(row.days['1'].active).toBe(false);
    expect(row.days['2'].active).toBe(false);

    expect((await admin.post(`/api/admin/crews/${row.id}/eligibility`, { dayNumber: 1, active: true })).status).toBe(200);
    // Same existing session — no re-login needed.
    const state = await c.get('/api/game/state');
    expect(state.status).toBe(200);
    expect(state.body.game.number).toBe(1);
    expect(state.body.game.phase).toBe('WAITING');
    expect(state.body.me.wallet).toBe(0);

    // Organizer switches the event to Day 2 → this crew is not activated for Day 2.
    expect((await admin.patch('/api/admin/event', { manualDayNumber: 2 })).status).toBe(200);
    const d2 = await c.get('/api/game/state');
    expect(d2.status).toBe(403);
    expect(d2.body.error).toBe('NOT_ACTIVATED_FOR_DAY');
    expect(d2.body.message).toBe('Your crew is not activated for this day. Contact the organizers.');
    await admin.patch('/api/admin/event', { manualDayNumber: 1 });
  });

  it('registration cannot assign roles, coins, active days or approval', async () => {
    const anon = new Client(env);
    const r = await anon.postKey('/api/auth/register', { ...validReg('Sneaky Crew', 'sneaky@example.test'), role: 'SUPER_ADMIN', activeDays: [1, 2], coins: 9999 }, 'reg-sneaky-0001');
    expect(r.status).toBe(400); // strict schema rejects unknown fields
    expect(await one(env.db, `SELECT id FROM team WHERE email_normalized='sneaky@example.test'`)).toBeUndefined();
  });

  it('invalid roster sizes create no partial records', async () => {
    const anon = new Client(env);
    const before = (await one<{ n: number }>(env.db, 'SELECT count(*)::int AS n FROM team'))!.n;
    const two = { ...validReg('Too Small', 'small@example.test'), members: [member('A A'), member('B B')] };
    const five = { ...validReg('Too Big', 'big@example.test'), members: [1, 2, 3, 4, 5].map((i) => member(`M ${i}`)) };
    const r2 = await anon.postKey('/api/auth/register', two, 'reg-small-0001');
    const r5 = await anon.postKey('/api/auth/register', five, 'reg-big-00001');
    expect(r2.status).toBe(400);
    expect(r2.body.details.fields.members).toMatch(/3 or 4/);
    expect(r5.status).toBe(400);
    const weak = await anon.postKey('/api/auth/register', { ...validReg('Weak Pw', 'weak@example.test'), password: 'short', confirmPassword: 'short' }, 'reg-weak-00001');
    expect(weak.status).toBe(400);
    expect(weak.body.details.fields.password).toBeTruthy();
    const after = (await one<{ n: number }>(env.db, 'SELECT count(*)::int AS n FROM team'))!.n;
    expect(after).toBe(before);
    expect((await one<{ n: number }>(env.db, `SELECT count(*)::int AS n FROM team_member m LEFT JOIN team t ON t.id=m.team_id WHERE t.id IS NULL`))!.n).toBe(0);
  });

  it('duplicate email and team-name races create exactly one team', async () => {
    const mk = (i: number, name: string, email: string) => new Client(env).postKey('/api/auth/register', validReg(name, email), `reg-race-${i}-${Date.now()}`);
    const emailRace = await Promise.all([1, 2, 3, 4].map((i) => mk(i, `Race Email ${i}`, 'race@example.test')));
    expect(emailRace.filter((r) => r.status === 201)).toHaveLength(1);
    expect(emailRace.filter((r) => r.status === 409 && r.body.error === 'DUPLICATE_EMAIL')).toHaveLength(3);
    const nameRace = await Promise.all([5, 6, 7].map((i) => mk(i, 'Same  Name', `name${i}@example.test`)));
    expect(nameRace.filter((r) => r.status === 201)).toHaveLength(1);
    expect(nameRace.filter((r) => r.body.error === 'DUPLICATE_TEAM_NAME')).toHaveLength(2);
    expect((await many(env.db, `SELECT id FROM team WHERE email_normalized='race@example.test'`)).length).toBe(1);
    // Crew IDs are unique under concurrency.
    const ids = await many<{ crew_id: string }>(env.db, 'SELECT crew_id FROM team');
    expect(new Set(ids.map((r) => r.crew_id)).size).toBe(ids.length);
  });

  it('a retry with the same idempotency key returns the same creation result', async () => {
    const body = validReg('Retry Rangers', 'retry@example.test');
    const [a, b] = await Promise.all([
      new Client(env).postKey('/api/auth/register', body, 'reg-retry-key-0001'),
      new Client(env).postKey('/api/auth/register', body, 'reg-retry-key-0001'),
    ]);
    const c = await new Client(env).postKey('/api/auth/register', body, 'reg-retry-key-0001');
    const ok = [a, b, c].filter((r) => r.status === 201);
    expect(ok.length).toBe(3);
    expect(new Set(ok.map((r) => r.body.crewId)).size).toBe(1);
    expect((await many(env.db, `SELECT id FROM team WHERE email_normalized='retry@example.test'`)).length).toBe(1);
  });

  it('passwords never appear in logs, responses or storage', async () => {
    const audits = await many<{ details: unknown }>(env.db, 'SELECT details FROM audit_log');
    expect(JSON.stringify(audits)).not.toContain('Orbital-Wrench-42');
    const idem = await many<{ response: unknown }>(env.db, 'SELECT response FROM idempotency_record');
    expect(JSON.stringify(idem)).not.toContain('Orbital-Wrench-42');
  });
});
