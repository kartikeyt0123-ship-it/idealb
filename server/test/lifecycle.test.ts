import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { many, one } from '../src/db.js';
import { expireImposters } from '../src/services/imposter.js';
import { tick } from '../src/worker.js';
import { commander, crew, expireSprint, freshEnv, gameId, solutionFor, solve, startSprint, taskIds, type Client, type Env } from './helpers.js';

let env: Env;
let admin: Client;
const D1 = ['byteforce', 'codex', 'debuggers', 'nullptr', 'stacksmash', 'nexora', 'syntaxsquad', 'quantumquills', 'looptroop', 'recursia'];
const crews: Record<string, Client> = {};

beforeAll(async () => {
  env = await freshEnv();
  admin = await commander(env);
  for (const s of D1) crews[s] = await crew(env, s);
});
afterAll(async () => env.close());

describe('imposter protocol', () => {
  it('first reservation wins; owner-only statement; exclusive mode across devices; no late award', async () => {
    const gid = await startSprint(env, admin, 1, 1);
    const draft = (await one<{ id: string }>(env.db, `SELECT ir.id FROM imposter_release ir JOIN sprint s ON s.id=ir.sprint_id WHERE ir.game_id=$1 AND s.number=1`, [gid]))!;
    // Not visible before release.
    expect((await crews.nexora.get(`/api/game/imposter/${draft.id}`)).status).toBe(404);
    const rel = await admin.post(`/api/admin/imposters/${draft.id}/release`, {});
    expect(rel.status).toBe(200);
    const banner = (await crews.nexora.get('/api/game/state')).body.imposter;
    expect(banner.claimOpen).toBe(true);
    expect(JSON.stringify(banner)).not.toMatch(/statement/);

    const racers = ['nexora', 'codex', 'byteforce', 'nullptr'];
    const results = await Promise.all(racers.map((s) => crews[s].post(`/api/game/imposter/${draft.id}/reserve`, {}, true)));
    const won = results.filter((r) => r.status === 200);
    expect(won).toHaveLength(1);
    const losers = results.filter((r) => r.status === 409);
    expect(losers.every((r) => r.body.error === 'IMPOSTER_CLAIMED')).toBe(true);
    expect(losers[0].body.message).toBe('Another crew has claimed this imposter problem.');
    const ownerSlug = racers[results.findIndex((r) => r.status === 200)];
    const owner = crews[ownerSlug];
    const other = crews[racers.find((s) => s !== ownerSlug)!];
    expect((await owner.get(`/api/game/imposter/${draft.id}`)).body.statement.length).toBeGreaterThan(20);
    const denied = await other.get(`/api/game/imposter/${draft.id}`);
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).not.toMatch(/statement/);

    // Exclusive mode is enforced server-side for every device of the owner crew.
    const secondDevice = await crew(env, ownerSlug);
    const regular = (await taskIds(env, 1, 1, `AND ti.status='AVAILABLE'`))[0];
    const blocked = await solve(env, secondDevice, regular.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('IMPOSTER_MODE_ACTIVE');

    // Timeout: no award, regular mode restored.
    await env.db.query(`UPDATE imposter_reservation SET solve_deadline_at = clock_timestamp() - interval '1 second' WHERE release_id=$1`, [draft.id]);
    expect(await expireImposters(env.db)).toBe(1);
    const sol = await solutionFor(env, draft.id, 'IMPOSTER');
    const late = await owner.post(`/api/game/imposter/${draft.id}/submit`, { answer: (sol as { answer?: string }).answer, files: (sol as { files?: Record<string, string> }).files }, true);
    expect(late.status).toBe(409);
    expect(await many(env.db, `SELECT * FROM coin_ledger WHERE kind='IMPOSTER_REWARD'`)).toHaveLength(0);
    expect((await solve(env, secondDevice, regular.id)).body.correct).toBe(true);

    // Re-arm creates a NEW generation; a correct solve awards exactly once.
    const rearm = await admin.post(`/api/admin/imposters/${draft.id}/rearm`, {});
    expect(rearm.body.generation).toBe(2);
    await admin.post(`/api/admin/imposters/${rearm.body.id}/release`, {});
    const res = await crews.recursia.post(`/api/game/imposter/${rearm.body.id}/reserve`, {}, true);
    expect(res.status).toBe(200);
    const sol2 = await solutionFor(env, rearm.body.id, 'IMPOSTER');
    const body = { answer: (sol2 as { answer?: string }).answer, files: (sol2 as { files?: Record<string, string> }).files };
    const [s1, s2] = await Promise.all([crews.recursia.post(`/api/game/imposter/${rearm.body.id}/submit`, body, true), crews.recursia.post(`/api/game/imposter/${rearm.body.id}/submit`, body, true)]);
    expect([s1, s2].filter((r) => r.status === 200 && r.body.correct)).toHaveLength(1);
    expect(await many(env.db, `SELECT * FROM coin_ledger WHERE kind='IMPOSTER_REWARD'`)).toHaveLength(1);
  });
});

describe('sprint lifecycle', () => {
  it('pause/resume shifts the deadline; scoring is refused while paused', async () => {
    const gid = await gameId(env, 1);
    const before = (await one<{ deadline_at: Date }>(env.db, `SELECT deadline_at FROM sprint WHERE game_id=$1 AND number=1`, [gid]))!.deadline_at;
    const g = await admin.get('/api/admin/overview');
    const ver = g.body.games[0].version;
    expect((await admin.post(`/api/admin/games/${gid}/pause`, { expectedVersion: ver })).status).toBe(200);
    // Repeated click with the stale version is rejected, not applied twice.
    expect((await admin.post(`/api/admin/games/${gid}/pause`, { expectedVersion: ver })).status).toBe(409);
    const t = (await taskIds(env, 1, 1, `AND ti.status='AVAILABLE'`))[0];
    const p = await solve(env, crews.debuggers, t.id);
    expect(p.body.error).toBe('SPRINT_PAUSED');
    await new Promise((r) => setTimeout(r, 1200));
    expect((await admin.post(`/api/admin/games/${gid}/resume`, {})).status).toBe(200);
    const after = (await one<{ deadline_at: Date }>(env.db, `SELECT deadline_at FROM sprint WHERE game_id=$1 AND number=1`, [gid]))!.deadline_at;
    expect(new Date(after).getTime() - new Date(before).getTime()).toBeGreaterThanOrEqual(1100);
  });

  it('timer end → everyone waits → bottom K from frozen standings → only the commander starts Sprint 2', async () => {
    const gid = await gameId(env, 1);
    // A few crews score so the cutoff is decided by score; several remain tied at 0.
    for (const s of ['syntaxsquad', 'quantumquills', 'looptroop']) {
      const t = (await taskIds(env, 1, 1, `AND ti.status='AVAILABLE'`))[0];
      expect((await solve(env, crews[s], t.id)).body.correct).toBe(true);
    }
    await expireSprint(env, 1);
    const r = await tick(env.db);
    expect(r.closed).toBe(1);
    // Every participant device moves to review; scoring is closed.
    const st = await crews.nexora.get('/api/game/state');
    expect(st.body.game.phase).toBe('ELIMINATION_REVIEW');
    const t = (await taskIds(env, 1, 1, `AND ti.status='AVAILABLE'`))[0];
    const late = await solve(env, crews.debuggers, t.id);
    expect(late.status).toBe(409);
    // Scores after the freeze do not change the frozen preview.
    await admin.post(`/api/admin/enrollments/${(await one<{ id: string }>(env.db, `SELECT ge.id FROM game_enrollment ge JOIN team t ON t.id=ge.team_id WHERE t.crew_id='CRW-004' AND ge.game_id=$1`, [gid]))!.id}/adjust`, { amount: 5000, target: 'BOTH', reason: 'test adjustment after freeze' });
    const rev = await admin.get(`/api/admin/games/${gid}/elimination`);
    expect(rev.status).toBe(200);
    expect(rev.body.preview.activeCount).toBe(10);
    expect(rev.body.preview.eliminateCount).toBe(2);
    expect(rev.body.rows.find((x: { crewId: string }) => x.crewId === 'CRW-004').score).toBe(0);
    // Many crews tied at 0 straddle the cut: confirmation stops for an explicit decision.
    expect(rev.body.preview.tie).toBeTruthy();
    const noRes = await admin.post(`/api/admin/games/${gid}/elimination/confirm`, {});
    expect(noRes.status).toBe(409);
    expect(noRes.body.error).toBe('TIE_RESOLUTION_REQUIRED');
    const tie = rev.body.preview.tie;
    const pick = tie.tiedEnrollmentIds.slice(0, tie.needFromTie);
    const conf = await admin.post(`/api/admin/games/${gid}/elimination/confirm`, { resolution: { mode: 'MANUAL_TIEBREAK', eliminateEnrollmentIds: pick, note: 'Published tiebreak: rapid-fire quiz at the stage, results posted.' } });
    expect(conf.status).toBe(200);
    expect(conf.body.eliminated).toHaveLength(2);
    // Repeat confirmation cannot eliminate twice.
    const again = await admin.post(`/api/admin/games/${gid}/elimination/confirm`, { resolution: { mode: 'MANUAL_TIEBREAK', eliminateEnrollmentIds: pick, note: 'Published tiebreak: rapid-fire quiz at the stage, results posted.' } });
    expect(again.status).toBe(409);
    expect((await many(env.db, `SELECT * FROM game_enrollment WHERE game_id=$1 AND status='ELIMINATED'`, [gid])).length).toBe(2);
    // Waiting: no automatic Sprint 2 from refreshes or worker ticks.
    await tick(env.db);
    const waiting = await crews.nexora.get('/api/game/state');
    expect(['WAITING_NEXT_SPRINT']).toContain(waiting.body.game.phase);
    expect(waiting.body.sprints[1].status).toBe('PENDING');

    // Eliminated crews: read-only.
    const ejectedIds = conf.body.eliminated.map((e: { crewId: string }) => e.crewId);
    const ejectedSlug = (await one<{ email: string }>(env.db, `SELECT email FROM team WHERE crew_id=$1`, [ejectedIds[0]]))!.email.split('@')[0];
    const ejected = crews[ejectedSlug] ?? (await crew(env, ejectedSlug));
    const es = await ejected.get('/api/game/state');
    expect(es.body.me.status).toBe('ELIMINATED');
    expect(es.body.lastElimination.youEliminated).toBe(true);

    // Commander activates Sprint 2.
    await startSprint(env, admin, 1, 2);
    const s2 = (await taskIds(env, 1, 2))[0];
    const denied = await solve(env, ejected, s2.id);
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('TEAM_ELIMINATED');
    expect((await ejected.get(`/api/game/tasks/${s2.id}`)).status).toBe(403);
    expect((await ejected.post('/api/game/run', { target: { type: 'TASK', id: s2.id }, files: {}, stdin: '' })).status).toBe(403);
    // Survivors play on with carried-over wallets.
    const sq = await crews.syntaxsquad.get('/api/game/state');
    expect(sq.body.sprint.number).toBe(2);
    expect(sq.body.me.wallet).toBeGreaterThan(0);
  });

  it('disabling a day mid-game immediately blocks APIs for existing sessions; the other day stays intact', async () => {
    const team = (await one<{ id: string }>(env.db, `SELECT id FROM team WHERE crew_id='CRW-042'`))!;
    const t = (await taskIds(env, 1, 2, `AND ti.status='AVAILABLE'`))[0];
    expect((await crews.nexora.get(`/api/game/tasks/${t.id}`)).status).toBe(200);
    await admin.post(`/api/admin/crews/${team.id}/eligibility`, { dayNumber: 1, active: false });
    const blocked = await crews.nexora.get('/api/game/state');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('NOT_ACTIVATED_FOR_DAY');
    expect((await solve(env, crews.nexora, t.id)).status).toBe(403);
    const d2 = await one<{ active: boolean }>(env.db, `SELECT e.active FROM team_day_eligibility e JOIN event_day d ON d.id=e.day_id WHERE e.team_id=$1 AND d.day_number=2`, [team.id]);
    expect(d2!.active).toBe(true);
    await admin.post(`/api/admin/crews/${team.id}/eligibility`, { dayNumber: 1, active: true });
    expect((await crews.nexora.get('/api/game/state')).status).toBe(200);
  });
});
