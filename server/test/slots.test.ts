import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { many, one } from '../src/db.js';
import { answerInstances, Client, crew, expireSprint, freshEnv, organizer, runSlot, slotId, solve, solutionFor, startSprint, V, type Env } from './helpers.js';

let env: Env;
let org: Client;
let base: string;
beforeAll(async () => {
  env = await freshEnv({ listen: true });
  org = await organizer(env);
  const addr = env.built.app.server.address();
  base = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
});
afterAll(async () => env?.close());

function socket(c: Client, display = false): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(base, { path: '/socket.io', transports: ['websocket'], extraHeaders: { cookie: c.cookieHeader, origin: 'http://localhost:5173' }, query: display ? { display: '1' } : {}, reconnection: false });
    s.on('hello', () => resolve(s));
    s.on('connect_error', reject);
  });
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('demo structure', () => {
  it('has 4 slots on 8 and 9 October 2026, 10 crews each, 4 sprints of 30 minutes, an initial set of 90 per slot', async () => {
    const ov = (await org.get(`${V}/admin/overview`)).body;
    expect(ov.event).toMatchObject({ name: 'AMONG BUG', organizer: 'IDEALab.h', edition: 'AAROHAN 2026', venue: 'SGSITS Indore', timezone: 'Asia/Kolkata', isDemo: true });
    expect(ov.slots.map((s: { date: string }) => s.date)).toEqual(['2026-10-08', '2026-10-08', '2026-10-09', '2026-10-09']);
    for (const s of ov.slots) {
      expect(s.counts.crews).toBe(10);
      expect(s.sprints.map((x: { durationSeconds: number }) => x.durationSeconds)).toEqual([1800, 1800, 1800, 1800]);
      const n = (await one<{ n: number }>(env.db, 'SELECT count(*)::int AS n FROM question_instance WHERE slot_id=$1', [s.id]))!.n;
      expect(n).toBe(90);
      expect(s.preflight.ok).toBe(true);
      expect(s.preflight.warnings.join(' ')).toMatch(/UNCONFIRMED/);
    }
    expect(ov.unconfirmed.length).toBe(ov.ruleReview.length);
    const nexora = await one<{ crew_id: string; number: number }>(env.db, `SELECT t.crew_id, s.number FROM team t JOIN slot_enrollment se ON se.team_id=t.id JOIN slot s ON s.id=se.slot_id WHERE t.email='nexora@example.test'`);
    expect(nexora).toEqual({ crew_id: 'CRW-001', number: 1 });
  });

  it('per slot: one initial set of 15 per domain (7 easy, 5 medium, 3 hard) for Sprint 1, from the IDEALab bank; no duplicates within a slot', async () => {
    const sid = await slotId(env, 1);
    const per = await many<{ domain: string; e: number; m: number; h: number; sprint: number; status: string }>(
      env.db,
      `SELECT d.slug AS domain, sp.number AS sprint, r.status, count(*) FILTER (WHERE qi.difficulty='EASY')::int AS e, count(*) FILTER (WHERE qi.difficulty='MEDIUM')::int AS m, count(*) FILTER (WHERE qi.difficulty='HARD')::int AS h
         FROM question_instance qi JOIN release r ON r.id=qi.release_id JOIN sprint sp ON sp.id=r.sprint_id JOIN domain d ON d.id=qi.domain_id
        WHERE qi.slot_id=$1 GROUP BY d.slug, sp.number, r.status ORDER BY 1`,
      [sid],
    );
    expect(per.map((p) => p.domain)).toEqual(['core_compute', 'cryptography', 'data_decypher', 'maker', 'recon', 'web']);
    for (const p of per) expect(p).toMatchObject({ sprint: 1, status: 'SCHEDULED', e: 7, m: 5, h: 3 });
    const dup = await one<{ n: number }>(env.db, `SELECT count(*)::int AS n FROM (SELECT question_version_id FROM question_instance WHERE slot_id=$1 GROUP BY 1 HAVING count(*) > 1) x`, [sid]);
    expect(dup!.n).toBe(0);
    const bank = await one<{ n: number }>(env.db, `SELECT count(*)::int AS n FROM question WHERE key ~ '^(core_compute|crypto|data|maker|recon|web)_[0-9]+$'`);
    expect(bank!.n).toBe(360);
  });
});

describe('slot isolation', () => {
  it('nothing is visible before the organizer starts the sprint', async () => {
    const c = await crew(env, 1);
    const st = (await c.get(`${V}/slots/mine/state`)).body;
    expect(st.slot.number).toBe(1);
    expect(st.sprint.status).toBe('READY');
    expect(st.questions).toEqual([]);
    const any = (await one<{ id: string }>(env.db, `SELECT id FROM question_instance WHERE slot_id=$1 LIMIT 1`, [await slotId(env, 1)]))!.id;
    expect((await c.get(`${V}/question-instances/${any}`)).status).toBe(404);
  });

  it('a running slot is invisible and unreachable for other slots; only one slot may run', async () => {
    await startSprint(env, org, 1, 1);
    const s2 = await org.post(`${V}/admin/slots/${await slotId(env, 2)}/sprints/1/start`, {});
    expect(s2.status).toBe(409);
    expect(JSON.stringify(s2.body.details)).toMatch(/one running slot/);

    const a = await crew(env, 1);
    const b = await crew(env, 11); // slot 2
    const st = (await a.get(`${V}/slots/mine/state`)).body;
    expect(st.questions.length).toBe(90);
    expect(st.questions.every((q: { kind: string }) => q.kind === 'INITIAL')).toBe(true);
    const stB = (await b.get(`${V}/slots/mine/state`)).body;
    expect(stB.questions).toEqual([]);
    const q = st.questions[0];
    expect((await b.get(`${V}/question-instances/${q.id}`)).status).toBe(404);
    const p = await solutionFor(env, q.id);
    const sub = await b.post(`${V}/question-instances/${q.id}/submissions`, p, true);
    expect(sub.status).toBe(404);
    expect((await b.get(`${V}/leaderboards?scope=sprint&slotId=${await slotId(env, 1)}`)).status).toBe(403);
    // Detail never leaks the answer or tests.
    const d = (await a.get(`${V}/question-instances/${q.id}`)).body;
    expect(JSON.stringify(d)).not.toMatch(/solution|answer_verifier|"expected"/);
  });

  it('first correct answer closes a question for the slot; realtime reaches only that slot', async () => {
    const a = await crew(env, 1);
    const a2 = await crew(env, 2);
    const other = await crew(env, 21); // slot 3
    const sa = await socket(a2);
    const so = await socket(other);
    const seenA: string[] = [];
    const seenO: string[] = [];
    sa.onAny((t) => seenA.push(t));
    so.onAny((t) => seenO.push(t));
    const q = (await answerInstances(env, 1))[0];
    const r = await solve(env, a, q.id);
    expect(r.body).toMatchObject({ correct: true, reward: q.reward });
    const late = await solve(env, a2, q.id);
    expect(late.status).toBe(409);
    expect(late.body.error).toBe('QUESTION_ALREADY_SOLVED');
    await wait(1500);
    expect(seenA).toContain('question.solved');
    expect(seenO).not.toContain('question.solved');
    sa.close();
    so.close();
  });

  it('a wrong answer keeps the question open and costs nothing', async () => {
    const c = await crew(env, 3);
    const q = (await answerInstances(env, 1))[0];
    const r = await c.post(`${V}/question-instances/${q.id}/submissions`, { generation: q.generation, answer: 'definitely-wrong-123' }, true);
    expect(r.body.correct).toBe(false);
    expect((await one<{ status: string }>(env.db, 'SELECT status FROM question_instance WHERE id=$1', [q.id]))!.status).toBe('AVAILABLE');
  });
});

describe('sprint and slot leaderboards', () => {
  it('hints reduce the wallet only (GROSS_EARNED), sprint board restarts at zero, cumulative carries', async () => {
    const c = await crew(env, 1);
    const before = (await c.get(`${V}/slots/mine/state`)).body.me;
    const q = (await answerInstances(env, 1))[0];
    const h = await c.post(`${V}/question-instances/${q.id}/hint-purchases`, {}, true);
    expect(h.body).toMatchObject({ charged: true, level: 1 });
    const after = (await c.get(`${V}/slots/mine/state`)).body.me;
    expect(after.wallet).toBe(before.wallet - h.body.cost);
    expect(after.cumulative).toBe(before.cumulative);
    expect(after.sprintScore).toBe(before.sprintScore);

    await expireSprint(env, 1);
    const closed = (await c.get(`${V}/slots/mine/state`)).body;
    expect(closed.slot.phase).toBe('WAITING');
    // Slot pool: unsolved questions stay active for the next sprint (they expire when the slot ends).
    const stillOpen = closed.questions.filter((x: { state: string }) => x.state === 'AVAILABLE').length;
    expect(stillOpen).toBeGreaterThan(80);

    await startSprint(env, org, 1, 2);
    const s2 = (await c.get(`${V}/slots/mine/state`)).body;
    expect(s2.sprint.number).toBe(2);
    expect(s2.me.sprintScore).toBe(0);
    expect(s2.me.cumulative).toBe(before.cumulative);
    expect(s2.questions.filter((x: { state: string }) => x.state === 'AVAILABLE').length).toBe(stillOpen);
    const sb = (await c.get(`${V}/leaderboards?scope=sprint&sprint=1`)).body;
    expect(sb.rows[0]).toMatchObject({ crewId: 'CRW-001' });
    expect(JSON.stringify(sb)).not.toMatch(/@example\.test/);
  });
});

describe('displays', () => {
  it('display links give a projector session with approved fields only; revocation cuts it off', async () => {
    const link = (await org.post(`${V}/admin/display-links`, { label: 'Main hall projector', hours: 8 })).body;
    expect(link.url).toMatch(/\/display\/overall#key=/);
    const proj = new Client(env);
    expect((await proj.get(`${V}/display/overall`)).status).toBe(401);
    expect((await proj.post(`${V}/display/session`, { key: link.key })).status).toBe(200);
    const overall = await proj.get(`${V}/display/overall`);
    expect(overall.body.status).toBe('PROVISIONAL');
    const sid = await slotId(env, 1);
    const slot = await proj.get(`${V}/display/slots/${sid}`);
    const sp1 = slot.body.slots.find((s: { id: string }) => s.id === sid).sprints[0].id;
    const sprint = await proj.get(`${V}/display/slots/${sid}/sprints/${sp1}`);
    expect(sprint.body.status).toBe('FROZEN');
    for (const body of [overall.body, slot.body, sprint.body]) {
      const s = JSON.stringify(body);
      expect(s).not.toMatch(/@example\.test|password|members|statement|answer|enrollmentId|wallet/);
    }
    // A projector cookie is not a crew/organizer session.
    expect((await proj.get(`${V}/admin/overview`)).status).toBe(401);
    expect((await proj.get(`${V}/slots/mine/state`)).status).toBe(401);
    const ds = await socket(proj, true);
    const closedP = new Promise((r) => ds.on('disconnect', r));
    await org.del(`${V}/admin/display-links/${link.id}`);
    expect((await proj.get(`${V}/display/overall`)).status).toBe(401);
    await Promise.race([closedP, wait(20_000)]);
    // Crews cannot open display boards.
    const c = await crew(env, 5);
    expect((await c.get(`${V}/display/overall`)).status).toBe(401);
  }, 40_000);
});

describe('four-slot flow', () => {
  it('runs all four slots × four sprints, finalizes each slot and the event', async () => {
    // Finish slot 1 (already in sprint 2)
    const s1 = [await crew(env, 1), await crew(env, 2), await crew(env, 3)];
    for (let s = 2; s <= 4; s++) {
      if (s > 2) await startSprint(env, org, 1, s);
      const qs = await answerInstances(env, 1);
      for (let i = 0; i < s1.length; i++) expect((await solve(env, s1[i], qs[i].id)).body.correct).toBe(true);
      await expireSprint(env, 1);
    }
    const ov = (await org.get(`${V}/admin/overview`)).body;
    expect(ov.slots[0].phase).toBe('REVIEW');
    expect((await org.post(`${V}/admin/event/finalize`, {})).status).toBe(409);
    let f1 = await org.post(`${V}/admin/slots/${await slotId(env, 1)}/finalize`, {});
    if (f1.status === 409) f1 = await org.post(`${V}/admin/slots/${await slotId(env, 1)}/finalize`, { resolution: { mode: 'SHARE', note: 'Tied crews share the place.' } });
    expect(f1.status).toBe(200);

    for (const [slot, first] of [[2, 11], [3, 21], [4, 31]] as const) {
      const crews = [await crew(env, first), await crew(env, first + 1)];
      const res = await runSlot(env, org, slot, crews);
      expect(res.rows.length).toBe(10);
    }
    const lb = (await org.get(`${V}/leaderboards?scope=event`)).body;
    expect(lb.status).toBe('PROVISIONAL');
    expect(lb.rows.length).toBe(40);
    const slotsSeen = new Set(lb.rows.map((r: { slotNumber: number }) => r.slotNumber));
    expect([...slotsSeen].sort()).toEqual([1, 2, 3, 4]);
    // Cumulative = sum of the four sprint scores.
    for (const r of lb.rows) expect(r.cumulative).toBe(r.perSprint['1'] + r.perSprint['2'] + r.perSprint['3'] + r.perSprint['4']);

    let fin = await org.post(`${V}/admin/event/finalize`, {});
    if (fin.status === 409 && fin.body.error === 'TIE_RESOLUTION_REQUIRED') fin = await org.post(`${V}/admin/event/finalize`, { resolution: { mode: 'SHARE', note: 'Joint winners per published rule.' } });
    expect(fin.status).toBe(200);
    expect(fin.body.rows[0].prize).toMatch(/Winner/);
    expect((await org.get(`${V}/leaderboards?scope=event`)).body.status).toBe('FINAL');

    // Nothing can change after finalization.
    expect((await org.post(`${V}/admin/slots/${await slotId(env, 1)}/sprints/1/start`, {})).status).toBe(409);
    const recon = (await org.get(`${V}/admin/health`)).body;
    expect(recon.ledgerReconciled).toBe(true);
  }, 240_000);
});
