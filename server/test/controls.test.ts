import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { many, one } from '../src/db.js';
import { Client, crew, crewLogin, expireSprint, freshEnv, organizer, slotId, solve, V, type Env } from './helpers.js';

/** Organizer controls: attendance gates login, slot kick-in, reserve refills, the manual bonus pool. */
let env: Env;
let org: Client;
beforeAll(async () => {
  env = await freshEnv({ ready: false });
  org = await organizer(env);
});
afterAll(async () => env?.close());

const teamId = async (crewId: string) => (await one<{ id: string }>(env.db, 'SELECT id FROM team WHERE crew_id=$1', [crewId]))!.id;

describe('attendance enables login', () => {
  it('a crew not marked present cannot sign in; marking it present enables login; unmarking signs it out', async () => {
    const c = new Client(env);
    const denied = await c.post(`${V}/auth/crew-login`, { identifier: 'CRW-002', password: 'Crew-002-Demo!' });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('ATTENDANCE_REQUIRED');
    // A wrong password still says "invalid credentials" (attendance is only revealed to the real crew).
    expect((await c.post(`${V}/auth/crew-login`, { identifier: 'CRW-002', password: 'wrong-password' })).body.error).toBe('INVALID_CREDENTIALS');

    const id = await teamId('CRW-002');
    const mark = await org.post(`${V}/admin/teams/attendance`, { teamIds: [id], present: true });
    expect(mark.body).toMatchObject({ present: true, changed: ['CRW-002'] });
    const b = await crew(env, 2);
    expect((await b.get(`${V}/me`)).body.role).toBe('CREW');

    await org.post(`${V}/admin/teams/attendance`, { teamIds: [id], present: false });
    expect((await b.get(`${V}/me`)).body.role).toBe(null); // signed out
    expect((await c.post(`${V}/auth/crew-login`, { identifier: 'CRW-002', password: 'Crew-002-Demo!' })).body.error).toBe('ATTENDANCE_REQUIRED');
    // Per-crew editor does the same.
    expect((await org.patch(`${V}/admin/teams/${id}`, { checkedIn: true })).status).toBe(200);
    await crew(env, 2);
  });

  it('re-importing without a checked_in value keeps attendance', async () => {
    const csv = 'team_name,crew_id,captain_email,member1_name,member2_name,member3_name\n';
    const roster = (await env.db.query(`SELECT m.name FROM team_member m JOIN team t ON t.id=m.team_id WHERE t.crew_id='CRW-002' ORDER BY m.position`)).rows.map((r) => r.name);
    const row = ['Byteforce', 'CRW-002', 'byteforce@example.test', ...roster.slice(0, 3)].join(',') + '\n';
    const p = await org.post(`${V}/admin/teams/imports`, { fileName: 'r.csv', contentBase64: Buffer.from(csv + row).toString('base64') });
    expect(p.body.rows[0].changes.join(' ')).not.toMatch(/attendance/);
  });

  it('bulk roll call marks a whole slot present', async () => {
    const ids = (await env.db.query(`SELECT se.team_id FROM slot_enrollment se JOIN slot s ON s.id=se.slot_id WHERE s.number=1`)).rows.map((r) => r.team_id);
    const r = await org.post(`${V}/admin/teams/attendance`, { teamIds: ids, present: true });
    expect(r.status).toBe(200);
    expect(r.body.changed.length + r.body.unchanged).toBe(10);
  });
});

describe('slot kick-in', () => {
  it('crews of an unopened slot can sign in but wait; Sprint 1 cannot start before the slot is opened', async () => {
    const c = await crew(env, 1);
    const me = (await c.get(`${V}/me`)).body;
    expect(me.access.state).toBe('SLOT_NOT_OPEN');
    expect(me.access.slot).toMatchObject({ number: 1, date: '2026-10-08' });
    expect((await c.get(`${V}/slots/mine/state`)).body.error).toBe('SLOT_NOT_OPEN');

    const sid = await slotId(env, 1);
    const pf = (await org.get(`${V}/admin/slots/${sid}/sprints/1/preflight`)).body;
    expect(pf.ok).toBe(false);
    expect(pf.blockers.join(' ')).toMatch(/Open Slot 1/);
    expect((await org.post(`${V}/admin/slots/${sid}/sprints/1/start`, {})).body.error).toBe('PREFLIGHT_FAILED');
  });

  it('opening the slot lets crews board and roam — but nothing can be solved until the sprint is started', async () => {
    const sid = await slotId(env, 1);
    const open = await org.post(`${V}/admin/slots/${sid}/open`, {});
    expect(open.body.opened).toBe(true);
    expect((await org.post(`${V}/admin/slots/${sid}/open`, {})).body.opened).toBe(false); // idempotent
    const c = await crew(env, 1);
    expect((await c.get(`${V}/me`)).body.access.state).toBe('ASSIGNED');
    const st = (await c.get(`${V}/slots/mine/state`)).body;
    expect(st.sprint.status).toBe('READY');
    expect(st.questions).toEqual([]);
    // Undo an accidental kick-in (before Sprint 1 only), then open again.
    expect((await org.post(`${V}/admin/slots/${sid}/close-boarding`, { reason: 'Opened the wrong slot' })).body.closed).toBe(true);
    expect((await c.get(`${V}/me`)).body.access.state).toBe('SLOT_NOT_OPEN');
    await org.post(`${V}/admin/slots/${sid}/open`, {});
    const start = await org.post(`${V}/admin/slots/${sid}/sprints/1/start`, {});
    expect(start.status).toBe(200);
    expect((await c.get(`${V}/slots/mine/state`)).body.questions.length).toBe(60);
    expect((await org.post(`${V}/admin/slots/${sid}/close-boarding`, { reason: 'too late now' })).status).toBe(409);
  });
});

describe('reserve refills and the bonus pool', () => {
  it('refill tops up the domain depleted by solves from the 20-question reserve pool', async () => {
    const sid = await slotId(env, 1);
    const c = await crew(env, 1);
    const misc = await many<{ id: string }>(
      env.db,
      `SELECT qi.id FROM question_instance qi JOIN release r ON r.id=qi.release_id JOIN question_version qv ON qv.id=qi.question_version_id JOIN domain d ON d.id=qi.domain_id
        WHERE qi.slot_id=$1 AND r.status='RELEASED' AND qi.status='AVAILABLE' AND d.slug='misc' AND qv.validation->>'mode'<>'CODE_TESTS' ORDER BY qi.label LIMIT 3`,
      [sid],
    );
    expect(misc.length).toBe(3);
    for (const q of misc) expect((await solve(env, c, q.id)).body.correct).toBe(true);

    const before = (await org.get(`${V}/admin/slots/${sid}/pools`)).body;
    expect(before.reservesLeft).toBe(20);
    expect(before.bonusesLeft).toBe(10);
    const m = before.domains.find((d: { slug: string }) => d.slug === 'misc');
    expect(m).toMatchObject({ available: 7, solved: 3, target: 10, deficit: 3, pool: 3 });
    expect(before.totalDeficit).toBe(3);

    const r = await org.post(`${V}/admin/slots/${sid}/refill`, {}); // default: the total deficit
    expect(r.status).toBe(200);
    expect(r.body.released.map((x: { domain: string }) => x.domain)).toEqual(['misc', 'misc', 'misc']);
    expect(r.body.status.domains.find((d: { slug: string }) => d.slug === 'misc')).toMatchObject({ available: 10, deficit: 0, pool: 0 });
    expect(r.body.status.reservesLeft).toBe(17);

    const st = (await c.get(`${V}/slots/mine/state`)).body;
    expect(st.questions.filter((q: { kind: string; domain: string; state: string }) => q.kind === 'RESERVE' && q.domain === 'misc' && q.state === 'AVAILABLE').length).toBe(3);
    const empty = await org.post(`${V}/admin/slots/${sid}/refill`, { domain: 'misc' });
    expect(empty.status).toBe(409);
    expect(empty.body.error).toBe('POOL_EMPTY');
    // Refills are part of the plan, not fairness deviations.
    expect(await one(env.db, `SELECT id FROM release WHERE slot_id=$1 AND type='RESERVE' AND manual`, [sid])).toBeUndefined();
  });

  it('bonus questions are released one at a time from a 10-question pool; open to everyone; unreleased ones carry over', async () => {
    const sid = await slotId(env, 1);
    const c = await crew(env, 2);
    const b = await org.post(`${V}/admin/slots/${sid}/bonus/next`, {});
    expect(b.status).toBe(200);
    expect(b.body.release).toMatchObject({ type: 'BONUS', status: 'RELEASED', manual: false });
    expect(b.body.status.bonusesLeft).toBe(9);
    const st = (await c.get(`${V}/slots/mine/state`)).body;
    expect(st.bonuses.length).toBe(1);
    expect(st.bonuses[0]).toMatchObject({ reward: 900, state: 'AVAILABLE' });

    // Sprint 1 ends: the released bonus expires, the 9 unreleased stay in the pool for later sprints.
    await expireSprint(env, 1);
    const after = (await org.get(`${V}/admin/slots/${sid}/pools`)).body;
    expect(after.bonusesLeft).toBe(9);
    expect(after.reservesLeft).toBe(17);
    expect((await org.post(`${V}/admin/slots/${sid}/bonus/next`, {})).body.error).toBe('SPRINT_NOT_RUNNING');
    expect((await org.post(`${V}/admin/slots/${sid}/refill`, {})).body.error).toBe('SPRINT_NOT_RUNNING');
    await org.post(`${V}/admin/slots/${sid}/sprints/2/start`, {});
    for (let i = 0; i < 9; i++) expect((await org.post(`${V}/admin/slots/${sid}/bonus/next`, {})).status).toBe(200);
    expect((await org.post(`${V}/admin/slots/${sid}/bonus/next`, {})).body.error).toBe('POOL_EMPTY');
  });
});

void crewLogin;
