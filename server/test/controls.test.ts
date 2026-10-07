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
    expect((await c.get(`${V}/slots/mine/state`)).body.questions.length).toBe(90);
    expect((await org.post(`${V}/admin/slots/${sid}/close-boarding`, { reason: 'too late now' })).status).toBe(409);
  });
});

describe('question control: stock, top-up, picking from the bank, bonuses, reuse', () => {
  it('stock shows active / solved per domain and difficulty; Top up brings a depleted cell back to target', async () => {
    const sid = await slotId(env, 1);
    const c = await crew(env, 1);
    const st0 = (await org.get(`${V}/admin/slots/${sid}/stock`)).body;
    expect(st0.running).toBe(true);
    expect(st0.targets).toEqual({ EASY: 7, MEDIUM: 5, HARD: 3 });
    expect(st0.domains.map((d: { slug: string }) => d.slug)).toEqual(['core_compute', 'cryptography', 'data_decypher', 'maker', 'recon', 'web']);
    for (const d of st0.domains) for (const k of ['EASY', 'MEDIUM', 'HARD']) expect(d.byDifficulty[k]).toMatchObject({ active: st0.targets[k], low: false });

    // Solve 2 easy cryptography questions → that cell drops to 5/7.
    const crypto = await many<{ id: string }>(
      env.db,
      `SELECT qi.id FROM question_instance qi JOIN release r ON r.id=qi.release_id JOIN domain d ON d.id=qi.domain_id
        WHERE qi.slot_id=$1 AND r.status='RELEASED' AND qi.status='AVAILABLE' AND d.slug='cryptography' AND qi.difficulty='EASY' ORDER BY qi.label LIMIT 2`,
      [sid],
    );
    for (const q of crypto) expect((await solve(env, c, q.id)).body.correct).toBe(true);
    const st1 = (await org.get(`${V}/admin/slots/${sid}/stock`)).body;
    const cell = st1.domains.find((d: { slug: string }) => d.slug === 'cryptography').byDifficulty.EASY;
    expect(cell).toMatchObject({ active: 5, solved: 2, solvedThisSprint: 2, target: 7, low: true });

    const up = await org.post(`${V}/admin/slots/${sid}/top-up`, {});
    expect(up.body).toMatchObject({ released: 2, when: 'NOW' });
    const st2 = (await org.get(`${V}/admin/slots/${sid}/stock`)).body;
    expect(st2.domains.find((d: { slug: string }) => d.slug === 'cryptography').byDifficulty.EASY).toMatchObject({ active: 7, low: false });
    expect((await org.post(`${V}/admin/slots/${sid}/top-up`, {})).body.released).toBe(0); // nothing low
    // Crews see the new questions immediately.
    const visible = (await c.get(`${V}/slots/mine/state`)).body.questions.filter((q: { domain: string; difficulty: string; state: string }) => q.domain === 'cryptography' && q.difficulty === 'EASY' && q.state === 'AVAILABLE');
    expect(visible.length).toBe(7);
  });

  it('the organizer picks specific bank questions (regular or bonus); previously used questions can be reused', async () => {
    const sid = await slotId(env, 1);
    const bank = (await org.get(`${V}/admin/slots/${sid}/bank?domain=web&difficulty=HARD`)).body as { versionId: string; key: string; usedInSlot: number }[];
    expect(bank.length).toBe(15);
    const fresh = bank.filter((b) => b.usedInSlot === 0);
    const used = bank.filter((b) => b.usedInSlot > 0);
    expect(used.length).toBe(3); // the initial set's 3 hard web questions
    const r = await org.post(`${V}/admin/slots/${sid}/releases`, { versionIds: [fresh[0].versionId, used[0].versionId] });
    expect(r.body).toMatchObject({ count: 2, kind: 'RESERVE', when: 'NOW' });
    const b = await org.post(`${V}/admin/slots/${sid}/releases`, { versionIds: [fresh[1].versionId], bonus: true });
    expect(b.body).toMatchObject({ count: 1, kind: 'BONUS', when: 'NOW' });
    const c = await crew(env, 2);
    const st = (await c.get(`${V}/slots/mine/state`)).body;
    expect(st.bonuses.length).toBe(1);
    expect(st.bonuses[0]).toMatchObject({ reward: 900, state: 'AVAILABLE' });
    // Releases from the bank are organizer decisions, not fairness deviations.
    expect(await one(env.db, `SELECT id FROM release WHERE slot_id=$1 AND manual`, [sid])).toBeUndefined();
  });

  it('released questions carry over to the next sprint and expire when the slot ends; NEXT_START queues for the next sprint', async () => {
    const sid = await slotId(env, 1);
    const active1 = (await org.get(`${V}/admin/slots/${sid}/stock`)).body.totals.active;
    await expireSprint(env, 1);
    const pick = (await org.get(`${V}/admin/slots/${sid}/bank?domain=maker&freshOnly=true`)).body[0];
    // Between sprints a release defaults to the next sprint start.
    const q = await org.post(`${V}/admin/slots/${sid}/releases`, { versionIds: [pick.versionId] });
    expect(q.body.when).toBe('NEXT_START');
    expect((await org.post(`${V}/admin/slots/${sid}/releases`, { versionIds: [pick.versionId], when: 'NOW' })).body.error).toBe('SPRINT_NOT_RUNNING');
    await org.post(`${V}/admin/slots/${sid}/sprints/2/start`, {});
    const st = (await org.get(`${V}/admin/slots/${sid}/stock`)).body;
    expect(st.totals.active).toBe(active1 + 1);
    // Run the slot to its end: everything unsolved expires.
    for (const n of [3, 4]) {
      await expireSprint(env, 1);
      await org.post(`${V}/admin/slots/${sid}/sprints/${n}/start`, {});
    }
    await expireSprint(env, 1);
    const left = await one<{ n: number }>(env.db, `SELECT count(*)::int AS n FROM question_instance WHERE slot_id=$1 AND status='AVAILABLE'`, [sid]);
    expect(left!.n).toBe(0);
  });

  it('the initial set is editable before Sprint 1: rebuild with other counts, remove one, add from the bank', async () => {
    const sid = await slotId(env, 2);
    const rebuilt = await org.post(`${V}/admin/slots/${sid}/plan`, { counts: { EASY: 3, MEDIUM: 2, HARD: 1 }, perDomain: { recon: { EASY: 0, MEDIUM: 0, HARD: 0 } } });
    expect(rebuilt.body.instances).toBe(5 * 6);
    const plan = (await org.get(`${V}/admin/slots/${sid}/plan`)).body as { id: string; domain: string }[];
    expect(plan.length).toBe(30);
    expect(plan.some((p) => p.domain === 'recon')).toBe(false);
    expect((await org.del(`${V}/admin/slots/${sid}/plan/${plan[0].id}`)).body.removed).toBeTruthy();
    const pick = (await org.get(`${V}/admin/slots/${sid}/bank?domain=recon&difficulty=HARD`)).body[0];
    const add = await org.post(`${V}/admin/slots/${sid}/releases`, { versionIds: [pick.versionId] });
    expect(add.body).toMatchObject({ kind: 'INITIAL', when: 'NEXT_START' });
    expect(((await org.get(`${V}/admin/slots/${sid}/plan`)).body as unknown[]).length).toBe(30);
    // Restore the default 7/5/3 set.
    expect((await org.post(`${V}/admin/slots/${sid}/plan`, {})).body.instances).toBe(90);
  });
});

void crewLogin;
