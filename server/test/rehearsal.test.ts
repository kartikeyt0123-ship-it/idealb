import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { many, one } from '../src/db.js';
import { tick } from '../src/worker.js';
import { commander, crew, expireSprint, freshEnv, gameId, solve, startSprint, taskIds, type Client, type Env } from './helpers.js';

/**
 * Accelerated full rehearsal: Game 1 (Day 1) S1 → close → eliminate → S2 → close → eliminate → results,
 * then Game 2 (Day 2) independently. Distinct scores avoid tie decisions so the standard path is exercised.
 */
let env: Env;
let admin: Client;
beforeAll(async () => {
  env = await freshEnv();
  admin = await commander(env);
});
afterAll(async () => env.close());

async function playSprint(game: number, sprint: number, slugs: string[], solvesPerCrew: number[]) {
  const clients = await Promise.all(slugs.map((s) => crew(env, s)));
  for (let i = 0; i < slugs.length; i++) {
    for (let k = 0; k < solvesPerCrew[i]; k++) {
      const t = (await taskIds(env, game, sprint, `AND ti.status='AVAILABLE' AND pv.difficulty='EASY'`))[0]
        ?? (await taskIds(env, game, sprint, `AND ti.status='AVAILABLE'`))[0];
      const r = await solve(env, clients[i], t.id);
      expect(r.body.correct).toBe(true);
    }
  }
}

async function runGame(game: number, crewsInGame: string[]) {
  const gid = await startSprint(env, admin, game, 1);
  // 10 crews with distinct numbers of solves (9..0) → strictly ordered scores.
  await playSprint(game, 1, crewsInGame, crewsInGame.map((_, i) => Math.max(0, Math.min(2, 9 - i - 7)) + (i < 8 ? 1 : 0) + (i < 2 ? 1 : 0)));
  // Make the order strict with audited score adjustments (tests the "score only" path too).
  const st = (await admin.get(`/api/admin/overview`)).body.games.find((g: { number: number }) => g.number === game).standings.active as { enrollmentId: string }[];
  for (let i = 0; i < st.length; i++) {
    await admin.post(`/api/admin/enrollments/${st[i].enrollmentId}/adjust`, { amount: 10 * (st.length - i), target: 'SCORE', reason: 'Rehearsal: strict ordering' });
  }
  await expireSprint(env, game);
  await tick(env.db);
  const rev1 = await admin.get(`/api/admin/games/${gid}/elimination`);
  expect(rev1.body.preview.tie).toBeNull();
  expect(rev1.body.preview.proposed).toHaveLength(2);
  const c1 = await admin.post(`/api/admin/games/${gid}/elimination/confirm`, {});
  expect(c1.status).toBe(200);
  expect(c1.body.survivors).toBe(8);

  await startSprint(env, admin, game, 2);
  const survivors = (await admin.get(`/api/admin/overview`)).body.games.find((g: { number: number }) => g.number === game).standings.active as { enrollmentId: string; crewId: string }[];
  expect(survivors).toHaveLength(8);
  for (let i = 0; i < survivors.length; i++) {
    await admin.post(`/api/admin/enrollments/${survivors[i].enrollmentId}/adjust`, { amount: 3 * (survivors.length - i), target: 'SCORE', reason: 'Rehearsal: strict ordering S2' });
  }
  await expireSprint(env, game);
  await tick(env.db);
  const c2 = await admin.post(`/api/admin/games/${gid}/elimination/confirm`, {});
  expect(c2.status).toBe(200);
  expect(c2.body.survivors).toBe(5);
  const res = await admin.get(`/api/admin/games/${gid}/results`);
  expect(res.body.rows).toHaveLength(5);
  expect(res.body.conflicts).toHaveLength(0);
  const conf = await admin.post(`/api/admin/games/${gid}/results/confirm`, {});
  expect(conf.status).toBe(200);
  expect(conf.body.results.slice(0, 3).map((r: { place: number }) => r.place)).toEqual([1, 2, 3]);
  expect(conf.body.results[0].prize).toMatch(/First place/);
  expect(conf.body.results[3].prize).toBeNull();
  return { gid, results: conf.body.results as { crewId: string; score: number }[] };
}

describe('full two-game rehearsal', () => {
  it('Game 1 then Game 2 run end-to-end with separate results and no cross-game contamination', async () => {
    const day1 = ['byteforce', 'codex', 'debuggers', 'nullptr', 'stacksmash', 'nexora', 'syntaxsquad', 'quantumquills', 'looptroop', 'recursia'];
    const g1 = await runGame(1, day1);
    const nx = await crew(env, 'nexora');
    const s1 = await nx.get('/api/game/state');
    expect(s1.body.game.phase).toBe('COMPLETED');
    expect(s1.body.result.rows).toHaveLength(5);

    // Switch the event to Day 2.
    await admin.patch('/api/admin/event', { manualDayNumber: 2 });
    // A Day-1-only crew is now denied; Nexora (both days) enters a fresh Game 2.
    const bf = await crew(env, 'byteforce');
    expect((await bf.get('/api/game/state')).body.error).toBe('NOT_ACTIVATED_FOR_DAY');
    const s2 = await nx.get('/api/game/state');
    expect(s2.body.game.number).toBe(2);
    expect(s2.body.game.phase).toBe('WAITING');
    expect(s2.body.me).toMatchObject({ wallet: 0, earned: 0, spent: 0, status: 'ACTIVE' });
    // Tasks in Game 2 are distinct instances with different content.
    const g1Tasks = await many<{ problem_version_id: string }>(env.db, `SELECT problem_version_id FROM task_instance WHERE game_id=$1`, [g1.gid]);
    const g2id = await gameId(env, 2);
    const g2Tasks = await many<{ problem_version_id: string }>(env.db, `SELECT problem_version_id FROM task_instance WHERE game_id=$1`, [g2id]);
    const overlap = g2Tasks.filter((t) => g1Tasks.some((u) => u.problem_version_id === t.problem_version_id));
    expect(overlap).toHaveLength(0);

    const day2 = ['segfault', 'bitshift', 'kernelpanic', 'lambdalegion', 'heapsters', 'nexora', 'syntaxsquad', 'quantumquills', 'looptroop', 'recursia'];
    const g2 = await runGame(2, day2);
    // Separate result rows per game; Game 1 history untouched.
    const results = await many<{ game_id: string }>(env.db, 'SELECT game_id FROM game_result');
    expect(results).toHaveLength(2);
    const g1Again = await one<{ rows: unknown[] }>(env.db, 'SELECT rows FROM game_result WHERE game_id=$1', [g1.gid]);
    expect(g1Again!.rows).toEqual(g1.results);
    expect(g2.results).not.toEqual(g1.results);
    // Every ledger entry belongs to the enrollment of its own game.
    const bad = await many(env.db, 'SELECT l.id FROM coin_ledger l JOIN game_enrollment ge ON ge.id=l.enrollment_id WHERE ge.game_id <> l.game_id');
    expect(bad).toHaveLength(0);
    const exp = await admin.get(`/api/admin/export/results?gameId=${g2.gid}`);
    expect(exp.status).toBe(200);
    expect(String(exp.body)).toContain('place,crew_id,team,score,prize');
  });
});
