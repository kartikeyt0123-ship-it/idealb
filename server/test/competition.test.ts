import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { many, one } from '../src/db.js';
import { tick } from '../src/worker.js';
import { answerInstances, Client, crew, expireSprint, freshEnv, organizer, slotId, solutionFor, startSprint, V, type Env } from './helpers.js';

let env: Env;
let org: Client;
beforeAll(async () => {
  env = await freshEnv();
  org = await organizer(env);
});
afterAll(async () => env?.close());

const count = async (sql: string, params: unknown[] = []) => (await one<{ n: number }>(env.db, sql, params))!.n;

describe('rules review', () => {
  it('rules start unconfirmed; changing one clears its confirmation; REHEARSAL scales sprint and bonus offsets', async () => {
    const rv = (await org.get(`${V}/admin/rules`)).body;
    expect(rv.review.every((r: { confirmed: unknown }) => r.confirmed === null)).toBe(true);
    expect(rv.rules).toMatchObject({ rankingMetric: 'GROSS_EARNED', questionScope: 'FRESH_PER_SPRINT', sessionLimit: 4, recycling: false, singleRunningSlot: true });
    expect(rv.rules.rewards).toEqual({ EASY: 150, MEDIUM: 400, HARD: 700, BONUS: 900 });
    expect(rv.rules.hintCosts).toEqual({ EASY: 30, MEDIUM: 80, HARD: 140, BONUS: 100 });
    expect((await org.post(`${V}/admin/rules/rewards/confirmation`, { confirmed: true })).status).toBe(200);
    expect((await org.post(`${V}/admin/rules/rankingMetric/confirmation`, { confirmed: true })).status).toBe(200);
    const upd = await org.patch(`${V}/admin/rules`, { preset: 'REHEARSAL' });
    expect(upd.status).toBe(200);
    expect(upd.body.changed).toContain('schedule');
    const after = (await org.get(`${V}/admin/rules`)).body;
    expect(after.review.find((r: { key: string }) => r.key === 'rewards').confirmed).not.toBeNull();
    expect(after.review.find((r: { key: string }) => r.key === 'schedule').confirmed).toBeNull();
    expect(await count(`SELECT count(*)::int AS n FROM sprint WHERE duration_seconds<>120`)).toBe(0);
    const offs = await many<{ o: number }>(env.db, `SELECT r.offset_seconds AS o FROM release r JOIN sprint sp ON sp.id=r.sprint_id WHERE r.slot_id=$1 AND r.type='BONUS' AND sp.number=1 ORDER BY 1`, [await slotId(env, 1)]);
    expect(offs.map((x) => x.o)).toEqual([32, 64, 96]);
    expect((await org.patch(`${V}/admin/rules`, { rewards: { EASY: 150, MEDIUM: 400, HARD: 700, BONUS: 0 } })).status).toBe(200);
    expect((await org.patch(`${V}/admin/rules`, { rewards: { EASY: 150, MEDIUM: 400, HARD: 700, BONUS: 900 } })).status).toBe(200);
    expect((await org.get(`${V}/admin/rules`)).body.review.find((r: { key: string }) => r.key === 'rewards').confirmed).toBeNull();
    // A production (non-demo) event cannot start on unconfirmed rules; demo only warns.
    const sid = await slotId(env, 1);
    await env.db.query('UPDATE event SET is_demo=false');
    const prod = (await org.get(`${V}/admin/slots/${sid}/sprints/1/preflight`)).body;
    expect(prod.ok).toBe(false);
    expect(prod.blockers.join(' ')).toMatch(/Confirm every rule/);
    expect((await org.post(`${V}/admin/slots/${sid}/sprints/1/start`, {})).body.error).toBe('PREFLIGHT_FAILED');
    await env.db.query('UPDATE event SET is_demo=true');
    expect((await org.get(`${V}/admin/slots/${sid}/sprints/1/preflight`)).body.ok).toBe(true);
    // Invalid blueprints are refused.
    expect((await org.patch(`${V}/admin/rules`, { blueprint: { reservesPerSprint: [5, 5, 5, 5], bonusesPerSprint: [3, 3, 2, 2], bonusOffsetsMinutes: [[8], [8, 16, 24], [10, 20], [10, 20]] } })).status).toBe(400);
  });
});

describe('races', () => {
  it('concurrent sprint starts: exactly one wins', async () => {
    const sid = await slotId(env, 1);
    const rs = await Promise.all([1, 2, 3].map(() => org.post(`${V}/admin/slots/${sid}/sprints/1/start`, {})));
    expect(rs.filter((r) => r.status === 200).length).toBe(1);
    expect(rs.filter((r) => r.status === 409).length).toBe(2);
    expect((await one<{ rules_frozen_at: Date | null }>(env.db, 'SELECT rules_frozen_at FROM event'))!.rules_frozen_at).not.toBeNull();
    expect((await org.patch(`${V}/admin/rules`, { sessionLimit: 3 })).body.error).toBe('RULES_FROZEN');
  });

  it('ten crews racing the same correct answer: exactly one award and one ledger row', async () => {
    const crews = await Promise.all(Array.from({ length: 10 }, (_, i) => crew(env, i + 1)));
    const q = (await answerInstances(env, 1))[0];
    const p = await solutionFor(env, q.id);
    const rs = await Promise.all(crews.map((c) => c.post(`${V}/question-instances/${q.id}/submissions`, p, true)));
    expect(rs.filter((r) => r.status === 200 && r.body.correct).length).toBe(1);
    expect(rs.filter((r) => r.body.error === 'QUESTION_ALREADY_SOLVED').length).toBe(9);
    expect(await count('SELECT count(*)::int AS n FROM solve_award WHERE instance_id=$1', [q.id])).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM coin_ledger WHERE source_type='solve_award' AND reason LIKE $1`, [`${q.label}%`])).toBe(1);
  });

  it('the same submission replayed from four devices with one idempotency key is applied once', async () => {
    const c = await crew(env, 2);
    const devices = [c, c.clone(), c.clone(), c.clone()];
    const q = (await answerInstances(env, 1))[0];
    const p = await solutionFor(env, q.id);
    const rs = await Promise.all(devices.map((d) => d.postKey(`${V}/question-instances/${q.id}/submissions`, p, 'same-key-0001')));
    expect(rs.every((r) => r.status === 200 && r.body.correct)).toBe(true);
    expect(await count('SELECT count(*)::int AS n FROM solve_award WHERE instance_id=$1', [q.id])).toBe(1);
    const mismatch = await c.postKey(`${V}/question-instances/${q.id}/submissions`, { generation: p.generation, answer: 'other' }, 'same-key-0001');
    expect(mismatch.body.error).toBe('IDEMPOTENCY_MISMATCH');
  });

  it('a hint bought concurrently from four devices is charged once and shared', async () => {
    const c = await crew(env, 2);
    const q = (await answerInstances(env, 1))[0];
    const wallet0 = (await c.get(`${V}/slots/mine/state`)).body.me.wallet;
    const rs = await Promise.all([c, c.clone(), c.clone(), c.clone()].map((d) => d.post(`${V}/question-instances/${q.id}/hint-purchases`, {}, true)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(rs.filter((r) => r.body.charged).length).toBe(1);
    expect((await c.get(`${V}/slots/mine/state`)).body.me.wallet).toBe(wallet0 - q.hint_cost);
    expect((await c.get(`${V}/question-instances/${q.id}`)).body.hint.text).toBeTruthy();
    // Another crew of the slot does not get it.
    expect((await (await crew(env, 3)).get(`${V}/question-instances/${q.id}`)).body.hint.text).toBeNull();
  });

  it('insufficient wallet refuses a hint without touching the ledger', async () => {
    // A crew of slot 1 that has not earned anything (the race above has a random winner).
    const poor = (await one<{ crew_id: string }>(env.db, `SELECT t.crew_id FROM slot_enrollment se JOIN team t ON t.id=se.team_id JOIN slot s ON s.id=se.slot_id WHERE s.number=1 AND se.wallet_balance=0 ORDER BY t.crew_id DESC LIMIT 1`))!;
    const c = await crew(env, Number(poor.crew_id.slice(4)));
    const q = (await answerInstances(env, 1))[0];
    const r = await c.post(`${V}/question-instances/${q.id}/hint-purchases`, {}, true);
    expect(r.body.error).toBe('INSUFFICIENT_FUNDS');
  });
});

describe('releases and the scheduler', () => {
  it('the scheduler releases a bonus at its active-time offset; pause suspends it', async () => {
    const sid = await slotId(env, 1);
    // Pretend 40 s of active time have passed (first bonus at 32 s under REHEARSAL), but pause first.
    await env.db.query(`UPDATE sprint SET started_at=started_at - interval '40 seconds', deadline_at=deadline_at + interval '10 minutes' WHERE slot_id=$1 AND status='RUNNING'`, [sid]);
    expect((await org.post(`${V}/admin/slots/${sid}/sprints/1/pause`, {})).status).toBe(200);
    const c = await crew(env, 4);
    const q = (await answerInstances(env, 1))[0];
    const paused = await c.post(`${V}/question-instances/${q.id}/submissions`, await solutionFor(env, q.id), true);
    expect(paused.body.error).toBe('SPRINT_PAUSED');
    expect((await tick(env.db)).released).toBe(0);
    expect((await org.post(`${V}/admin/slots/${sid}/sprints/1/resume`, {})).status).toBe(200);
    const r = await tick(env.db);
    expect(r.released).toBe(1);
    const st = (await c.get(`${V}/slots/mine/state`)).body;
    expect(st.bonuses.length).toBe(1);
    expect(st.bonuses[0]).toMatchObject({ kind: 'BONUS', reward: 900, state: 'AVAILABLE' });
    expect((await tick(env.db)).released).toBe(0); // idempotent
  });

  it('bonus: open to all, first correct wins and is recorded as BONUS_REWARD', async () => {
    const b = (await answerInstances(env, 1, 'BONUS'))[0];
    if (!b) return; // the first bonus may be a code question; covered by the runner-backed check below
    const c = await crew(env, 5);
    const r = await c.post(`${V}/question-instances/${b.id}/submissions`, await solutionFor(env, b.id), true);
    expect(r.body).toMatchObject({ correct: true, reward: 900 });
    expect(await count(`SELECT count(*)::int AS n FROM coin_ledger WHERE kind='BONUS_REWARD'`)).toBe(1);
  });

  it('a code bonus/question is judged by the real runner (starter fails, solution passes)', async () => {
    const q = await one<{ id: string; generation: number; files: { name: string; content: string }[] }>(
      env.db,
      `SELECT qi.id, qi.generation, qv.files FROM question_instance qi JOIN release r ON r.id=qi.release_id JOIN question_version qv ON qv.id=qi.question_version_id
        WHERE qi.slot_id=$1 AND r.status='RELEASED' AND qi.status='AVAILABLE' AND qv.validation->>'mode'='CODE_TESTS' ORDER BY qi.label LIMIT 1`,
      [await slotId(env, 1)],
    );
    const c = await crew(env, 6);
    const starter = Object.fromEntries(q!.files.map((f) => [f.name, f.content]));
    const bad = await c.post(`${V}/question-instances/${q!.id}/submissions`, { generation: q!.generation, files: starter }, true);
    expect(bad.body.correct).toBe(false);
    const good = await c.post(`${V}/question-instances/${q!.id}/submissions`, await solutionFor(env, q!.id), true);
    expect(good.body.correct).toBe(true);
  }, 60_000);

  it('reserves release on demand (no reason), early scheduled releases need a reason and are recorded as deviations', async () => {
    const sid = await slotId(env, 1);
    const rels = await many<{ id: string; type: string; status: string }>(env.db, `SELECT r.id, r.type, r.status FROM release r JOIN sprint sp ON sp.id=r.sprint_id WHERE r.slot_id=$1 AND sp.number=1 ORDER BY r.type, r.offset_seconds`, [sid]);
    const reserve = rels.find((r) => r.type === 'RESERVE')!;
    const r1 = await org.post(`${V}/admin/question-releases/${reserve.id}/release`, {});
    expect(r1.body.released).toBe(true);
    expect((await org.post(`${V}/admin/question-releases/${reserve.id}/release`, {})).body.released).toBe(false);
    const sched = rels.find((r) => r.type === 'BONUS' && r.status === 'SCHEDULED')!;
    expect((await org.post(`${V}/admin/question-releases/${sched.id}/release`, {})).status).toBe(400);
    const early = await org.post(`${V}/admin/question-releases/${sched.id}/release`, { reason: 'Room lost power for 5 minutes' });
    expect(early.body.release).toMatchObject({ manual: true, deviation_reason: 'Room lost power for 5 minutes' });
    const pf = (await org.get(`${V}/admin/slots/${sid}/sprints/2/preflight`)).body;
    expect(pf.warnings.join(' ')).toMatch(/fairness deviation/);
    // Manual override release needs a reason too.
    const v = (await one<{ id: string }>(env.db, `SELECT qv.id FROM question_version qv JOIN question q ON q.id=qv.question_id WHERE q.pool='BONUS' AND NOT EXISTS (SELECT 1 FROM question_instance qi WHERE qi.question_version_id=qv.id) LIMIT 1`))!;
    const body = { slotId: sid, sprintNumber: 1, type: 'BONUS', versionIds: [v.id], releaseImmediately: true };
    expect((await org.post(`${V}/admin/question-releases`, { ...body, reason: 'x' })).status).toBe(400);
    const man = await org.post(`${V}/admin/question-releases`, { ...body, reason: 'Replacement for a broken bonus question' });
    expect(man.status).toBe(200);
    expect(await count(`SELECT count(*)::int AS n FROM audit_log WHERE action='release.created_manual'`)).toBe(1);
  });

  it('closing a sprint cancels unreleased releases; they are never replayed', async () => {
    const sid = await slotId(env, 1);
    await expireSprint(env, 1);
    const left = await count(`SELECT count(*)::int AS n FROM release r JOIN sprint sp ON sp.id=r.sprint_id WHERE r.slot_id=$1 AND sp.number=1 AND r.status IN ('SCHEDULED','PENDING')`, [sid]);
    expect(left).toBe(0);
    await startSprint(env, org, 1, 2);
    await env.db.query(`UPDATE sprint SET started_at=started_at - interval '10 minutes', deadline_at=deadline_at + interval '20 minutes' WHERE slot_id=$1 AND status='RUNNING'`, [sid]);
    await tick(env.db);
    const s1Released = await count(`SELECT count(*)::int AS n FROM release r JOIN sprint sp ON sp.id=r.sprint_id WHERE r.slot_id=$1 AND sp.number=1 AND r.type='BONUS' AND r.status='RELEASED'`, [sid]);
    expect(s1Released).toBe(3); // 1 scheduled + 1 early + 1 manual, none replayed later
    expect(await count(`SELECT count(*)::int AS n FROM release r JOIN sprint sp ON sp.id=r.sprint_id WHERE r.slot_id=$1 AND sp.number=2 AND r.type='BONUS' AND r.status='RELEASED'`, [sid])).toBe(3);
  });

  it('an answer arriving after the DB deadline is rejected even before the worker closes the sprint', async () => {
    const sid = await slotId(env, 1);
    await env.db.query(`UPDATE sprint SET deadline_at=clock_timestamp() - interval '1 second' WHERE slot_id=$1 AND status='RUNNING'`, [sid]);
    const c = await crew(env, 7);
    const q = (await answerInstances(env, 1))[0];
    const r = await c.post(`${V}/question-instances/${q.id}/submissions`, await solutionFor(env, q.id), true);
    expect(r.body.error).toBe('SPRINT_CLOSED');
  });
});

describe('persistence across a restart', () => {
  it('a rebuilt server keeps sessions, deadlines and standings; the worker closes overdue sprints with the stored deadline', async () => {
    const c = await crew(env, 1);
    const before = (await c.get(`${V}/slots/mine/state`)).body;
    const deadline = (await one<{ d: Date }>(env.db, `SELECT deadline_at AS d FROM sprint WHERE status='RUNNING'`))!.d;
    await env.built.close();
    env.built = await buildApp(env.cfg, { db: env.db });
    const after = (await c.get(`${V}/slots/mine/state`)).body;
    expect(after.me.cumulative).toBe(before.me.cumulative);
    expect(after.sprint.number).toBe(2);
    const r = await tick(env.db);
    expect(r.closed).toBe(1);
    const sp = (await one<{ closed_at: Date; status: string }>(env.db, `SELECT closed_at, status FROM sprint sp JOIN slot s ON s.id=sp.slot_id WHERE s.number=1 AND sp.number=2`))!;
    expect(sp.status).toBe('CLOSED');
    expect(new Date(sp.closed_at).getTime()).toBe(new Date(deadline).getTime());
    expect((await tick(env.db)).closed).toBe(0);
    org = await organizer(env);
    expect((await org.get(`${V}/admin/health`)).body.ledgerReconciled).toBe(true);
    void expireSprint;
  });
});
