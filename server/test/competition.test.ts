import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { many, one } from '../src/db.js';
import { commander, crew, freshEnv, solutionFor, solve, startSprint, taskIds, type Client, type Env } from './helpers.js';

let env: Env;
let admin: Client;
let nexora: Client;
let byteforce: Client;
let codex: Client;

beforeAll(async () => {
  env = await freshEnv();
  admin = await commander(env);
  nexora = await crew(env, 'nexora');
  byteforce = await crew(env, 'byteforce');
  codex = await crew(env, 'codex');
});
afterAll(async () => env.close());

describe('before the sprint', () => {
  it('tasks are locked shells; no statement, title or hint before release', async () => {
    const st = await nexora.get('/api/game/state');
    expect(st.body.game.phase).toBe('WAITING');
    expect(st.body.tasks.tasks.length).toBe(30);
    expect(st.body.tasks.tasks.every((t: { state: string; title: string | null }) => t.state === 'LOCKED' && t.title === null)).toBe(true);
    const [t] = await taskIds(env, 1, 1);
    const detail = await nexora.get(`/api/game/tasks/${t.id}`);
    expect(detail.status).toBe(404);
    expect(detail.body.error).toBe('TASK_NOT_RELEASED');
    const submit = await nexora.post(`/api/game/tasks/${t.id}/submit`, { generation: 1, answer: 'x' }, true);
    expect([404, 409]).toContain(submit.status);
  });

  it('a sprint never starts without the commander (ranking rule must be confirmed)', async () => {
    const gid = (await one<{ id: string }>(env.db, 'SELECT id FROM game WHERE number=1'))!.id;
    const r = await admin.post(`/api/admin/games/${gid}/start-sprint`, { sprint: 1 });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('PREFLIGHT_FAILED');
    expect(JSON.stringify(r.body.details.preflight.blockers)).toMatch(/ranking rule/i);
    expect(r.body.details.preflight.summary.join(' ')).toMatch(/10 active → eliminate 2 → 8 survive/);
    expect(r.body.details.preflight.summary.join(' ')).toMatch(/8 active → eliminate 3 → 5 survive/);
  });
});

describe('first-solve integrity', () => {
  it('two crews open the same task; the first correct accepted solution wins once', async () => {
    await startSprint(env, admin, 1, 1);
    const code = (await taskIds(env, 1, 1, `AND pv.validation->>'mode'='CODE_TESTS'`))[0];
    // Opening never reserves: both crews can read it.
    const a = await nexora.get(`/api/game/tasks/${code.id}`);
    const b = await byteforce.get(`/api/game/tasks/${code.id}`);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.status).toBe('AVAILABLE');
    // A wrong submission leaves it open to everyone.
    const wrong = await codex.post(`/api/game/tasks/${code.id}/submit`, { generation: 1, files: (await solutionFor(env, code.id)).starter }, true);
    expect(wrong.status).toBe(200);
    expect(wrong.body.correct).toBe(false);
    expect((await byteforce.get(`/api/game/tasks/${code.id}`)).body.status).toBe('AVAILABLE');

    const [r1, r2] = await Promise.all([solve(env, nexora, code.id), solve(env, byteforce, code.id)]);
    const results = [r1, r2];
    const winners = results.filter((r) => r.status === 200 && r.body.correct);
    const losers = results.filter((r) => r.status === 409);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0].body.error).toBe('TASK_ALREADY_SOLVED');
    expect(losers[0].body.message).toBe('This problem has already been solved by another crew. Move on to the next task.');
    const awards = await many(env.db, 'SELECT * FROM solve_award WHERE task_instance_id=$1', [code.id]);
    expect(awards).toHaveLength(1);
    const credits = await many(env.db, `SELECT * FROM coin_ledger WHERE kind='SOLVE_REWARD' AND source_id=$1`, [(awards[0] as { id: string }).id]);
    expect(credits).toHaveLength(1);
    // A late correct submission from a third crew is also rejected.
    const late = await solve(env, codex, code.id);
    expect(late.status).toBe(409);
  });

  it('duplicate requests / lost responses never double-credit', async () => {
    const t = (await taskIds(env, 1, 1, `AND ti.status='AVAILABLE' AND pv.validation->>'mode'<>'CODE_TESTS'`))[0];
    const s = await solutionFor(env, t.id);
    const key = 'submit-dup-key-000001';
    const body = { generation: s.generation, answer: (s as { answer: string }).answer };
    const [x, y] = await Promise.all([codex.postKey(`/api/game/tasks/${t.id}/submit`, body, key), codex.clone().postKey(`/api/game/tasks/${t.id}/submit`, body, key)]);
    const z = await codex.postKey(`/api/game/tasks/${t.id}/submit`, body, key); // retry after "lost" response
    expect([x, y, z].every((r) => r.status === 200 && r.body.correct)).toBe(true);
    const enr = await one<{ wallet_balance: number; earned_total: number }>(env.db, `SELECT ge.wallet_balance, ge.earned_total FROM game_enrollment ge JOIN team t ON t.id=ge.team_id JOIN game g ON g.id=ge.game_id WHERE t.crew_id='CRW-002' AND g.number=1`);
    expect(enr!.earned_total).toBe(t.reward);
    expect(enr!.wallet_balance).toBe(t.reward);
  });
});

describe('real execution', () => {
  it('Run produces real interpreter output and never awards coins', async () => {
    const t = (await taskIds(env, 1, 1, `AND ti.status='AVAILABLE' AND pv.run_language='python'`))[0];
    const before = (await nexora.get('/api/game/state')).body.me.wallet;
    const s = await solutionFor(env, t.id);
    const ok = await nexora.post('/api/game/run', { target: { type: 'TASK', id: t.id }, files: (s as { files?: Record<string, string> }).files ?? s.starter, stdin: '' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('DONE');
    expect(ok.body.result.runtime).toMatch(/Python 3/);
    const broken = Object.fromEntries(Object.entries(s.starter).map(([k, v]) => [k, k.endsWith('.py') ? `${v}\nprint(  # unterminated\n` : v]));
    const bad = await nexora.post('/api/game/run', { target: { type: 'TASK', id: t.id }, files: broken, stdin: '' });
    expect(bad.body.status).toBe('DONE');
    expect(bad.body.result.exitCode).not.toBe(0);
    expect(bad.body.result.stderr).toMatch(/SyntaxError/);
    expect((await nexora.get('/api/game/state')).body.me.wallet).toBe(before);
  });

  it('JavaScript runs through the isolated runner too', async () => {
    const t = (await taskIds(env, 1, 1, `AND ti.status='AVAILABLE' AND pv.run_language='javascript' AND pv.workspace<>'WEB'`))[0];
    const s = await solutionFor(env, t.id);
    const r = await nexora.post('/api/game/run', { target: { type: 'TASK', id: t.id }, files: { ...s.starter, ...Object.fromEntries(Object.keys(s.starter).filter((k) => k.endsWith('.js')).map((k) => [k, 'console.log(6*7); undefinedFn();'])) }, stdin: '' });
    expect(r.body.result.stdout).toContain('42');
    expect(r.body.result.stderr).toMatch(/ReferenceError/);
  });
});

describe('paid hints', () => {
  it('hint text is absent before purchase (detail, snapshot, list)', async () => {
    const t = (await taskIds(env, 1, 1, `AND ti.status='AVAILABLE'`))[0];
    const d = await nexora.get(`/api/game/tasks/${t.id}`);
    expect(d.body.hint.unlocked).toBe(false);
    expect(d.body.hint.text).toBeNull();
    const raw = JSON.stringify([d.body, (await nexora.get('/api/game/state')).body, (await nexora.get('/api/game/tasks')).body]);
    expect(raw).not.toContain(t.hint);
  });

  it('insufficient balance is rejected without a negative balance', async () => {
    const t = (await taskIds(env, 1, 1, `AND ti.status='AVAILABLE'`))[0];
    const debuggers = await crew(env, 'debuggers'); // never scored: wallet 0
    const r = await debuggers.post(`/api/game/tasks/${t.id}/hint`, {}, true);
    expect((await debuggers.get('/api/game/state')).body.me.wallet).toBe(0);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('INSUFFICIENT_FUNDS');
  });

  it('earn, buy a hint once, see it from a second session, single debit even under concurrency', async () => {
    // Earn first.
    const earn = (await taskIds(env, 1, 1, `AND ti.status='AVAILABLE' AND pv.difficulty='MEDIUM'`))[0];
    const won = await solve(env, nexora, earn.id);
    expect(won.body.correct).toBe(true);
    const wallet0 = won.body.wallet as number;
    const score0 = (await nexora.get('/api/game/state')).body.me.score as number;
    const t = (await taskIds(env, 1, 1, `AND ti.status='AVAILABLE'`))[0];
    const [p1, p2, p3] = await Promise.all([1, 2, 3].map(() => nexora.post(`/api/game/tasks/${t.id}/hint`, {}, true)));
    expect([p1, p2, p3].every((p) => p.status === 200 && p.body.hint === t.hint)).toBe(true);
    expect([p1, p2, p3].filter((p) => p.body.charged)).toHaveLength(1);
    const debits = await many(env.db, `SELECT * FROM coin_ledger WHERE kind='HINT_PURCHASE' AND reason LIKE $1`, [`%${t.label}%`]);
    expect(debits).toHaveLength(1);
    const state = await nexora.get('/api/game/state');
    expect(state.body.me.wallet).toBe(wallet0 - t.hint_cost);
    expect(state.body.me.spent).toBeGreaterThanOrEqual(t.hint_cost);
    // NET_COINS: buying a hint lowers score.
    expect(state.body.me.score).toBe(score0 - t.hint_cost);
    // Second device of the same crew sees the purchased hint without paying.
    const device2 = await crew(env, 'nexora');
    const d = await device2.get(`/api/game/tasks/${t.id}`);
    expect(d.body.hint.unlocked).toBe(true);
    expect(d.body.hint.text).toBe(t.hint);
    // Other crews still cannot see it.
    expect((await byteforce.get(`/api/game/tasks/${t.id}`)).body.hint.text).toBeNull();
  });

  it('hint purchase on an already-solved task is denied without charge', async () => {
    const solved = (await taskIds(env, 1, 1, `AND ti.status='SOLVED'`)).find(Boolean)!;
    const w0 = (await byteforce.get('/api/game/state')).body.me.wallet;
    const r = await byteforce.post(`/api/game/tasks/${solved.id}/hint`, {}, true);
    expect(r.status).toBe(409);
    expect((await byteforce.get('/api/game/state')).body.me.wallet).toBe(w0);
  });
});

describe('ledger integrity', () => {
  it('wallet caches reconcile with the append-only ledger', async () => {
    const rows = await many<{ id: string; wallet_balance: number; s: number }>(
      env.db,
      `SELECT ge.id, ge.wallet_balance, COALESCE((SELECT sum(wallet_delta) FROM coin_ledger l WHERE l.enrollment_id=ge.id),0)::int AS s FROM game_enrollment ge`,
    );
    for (const r of rows) expect(r.wallet_balance).toBe(r.s);
    await expect(env.db.query('UPDATE coin_ledger SET wallet_delta=0')).rejects.toThrow(/append-only/);
    await expect(env.db.query('DELETE FROM coin_ledger')).rejects.toThrow(/append-only/);
  });
});
