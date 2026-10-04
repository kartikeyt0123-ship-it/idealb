import type { AppConfig } from '../config.js';
import { many, one, withTx, type Db, type Queryable, type Tx } from '../db.js';
import { AppError } from '../errors.js';
import { audit, type Actor } from './audit.js';
import type { CompetitorContext, GameRow, SprintRow } from './context.js';
import { claimIdempotency, peekIdempotency } from './idempotency.js';
import { lockGame } from './lifecycle.js';
import { emit, Rooms } from './outbox.js';
import { assertCanScore, gradeSubmission, lockForScoring, validateSubmissionPayload, type ProblemVersionRow, type SubmissionPayload } from './tasks.js';
import { applyLedger } from './wallet.js';

export interface ReleaseRow {
  id: string;
  game_id: string;
  sprint_id: string;
  problem_version_id: string;
  label: string;
  generation: number;
  status: 'DRAFT' | 'OFFERED' | 'RESERVED' | 'SOLVED' | 'EXPIRED' | 'CANCELLED';
  mode: 'RESERVE' | 'OPEN';
  reward: number;
  hint_cost: number;
  claim_seconds: number;
  solve_seconds: number;
  released_at: Date | null;
  claim_deadline_at: Date | null;
  open_deadline_at: Date | null;
  resolved_at: Date | null;
  version: number;
}

export interface ReservationRow {
  id: string;
  release_id: string;
  enrollment_id: string;
  reserved_at: Date;
  solve_deadline_at: Date;
  status: 'ACTIVE' | 'SOLVED' | 'EXPIRED' | 'ABANDONED' | 'CANCELLED';
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export async function updateImposterDraft(tx: Tx, actor: Actor, releaseId: string, patch: { reward?: number; hintCost?: number; claimSeconds?: number; solveSeconds?: number }) {
  const r = await one<ReleaseRow>(tx, 'SELECT * FROM imposter_release WHERE id=$1 FOR UPDATE', [releaseId]);
  if (!r) throw new AppError('NOT_FOUND', 'Imposter not found.');
  if (r.status !== 'DRAFT') throw new AppError('INVALID_TRANSITION', 'Only drafts can be edited. Released imposters are frozen.');
  const n = (v: unknown, min: number, max: number, label: string) => {
    if (v === undefined) return undefined;
    if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) throw new AppError('VALIDATION_FAILED', `${label} must be an integer between ${min} and ${max}.`);
    return v as number;
  };
  const reward = n(patch.reward, 0, 100000, 'Reward') ?? r.reward;
  const hintCost = n(patch.hintCost, 0, 100000, 'Hint cost') ?? r.hint_cost;
  const claim = n(patch.claimSeconds, 5, 3600, 'Claim window') ?? r.claim_seconds;
  const solve = n(patch.solveSeconds, 15, 6 * 3600, 'Solve duration') ?? r.solve_seconds;
  const updated = await one<ReleaseRow>(tx, `UPDATE imposter_release SET reward=$2, hint_cost=$3, claim_seconds=$4, solve_seconds=$5, version=version+1 WHERE id=$1 RETURNING *`, [releaseId, reward, hintCost, claim, solve]);
  await audit(tx, actor, 'imposter.draft_updated', { type: 'imposter', id: releaseId }, { reward, hintCost, claim, solve });
  return updated!;
}

/** Releases a DRAFT for the running sprint. Durations are validated against remaining sprint time. */
export async function releaseImposter(tx: Tx, actor: Actor, releaseId: string) {
  const r0 = await one<ReleaseRow>(tx, 'SELECT * FROM imposter_release WHERE id=$1', [releaseId]);
  if (!r0) throw new AppError('NOT_FOUND', 'Imposter not found.');
  const g = await lockGame(tx, r0.game_id);
  const r = (await one<ReleaseRow>(tx, 'SELECT * FROM imposter_release WHERE id=$1 FOR UPDATE', [releaseId]))!;
  if (r.status !== 'DRAFT') throw new AppError('INVALID_TRANSITION', 'This imposter was already released.');
  if (g.phase !== 'RUNNING') throw new AppError('SPRINT_NOT_RUNNING', 'Imposters can only be released while a sprint is running.');
  const s = (await one<SprintRow & { remaining: number }>(tx, `SELECT *, EXTRACT(EPOCH FROM (deadline_at - clock_timestamp())) AS remaining FROM sprint WHERE game_id=$1 AND number=$2`, [g.id, g.current_sprint]))!;
  if (r.sprint_id !== s.id) throw new AppError('INVALID_TRANSITION', `This imposter is assigned to another sprint.`);
  if (r.claim_seconds >= s.remaining) throw new AppError('VALIDATION_FAILED', `Only ${Math.floor(s.remaining)}s remain in the sprint — shorter than the ${r.claim_seconds}s claim window.`);
  const live = await one(tx, `SELECT id FROM imposter_release WHERE game_id=$1 AND status IN ('OFFERED','RESERVED')`, [g.id]);
  if (live) throw new AppError('CONFLICT', 'Another imposter is already live. Resolve it first.');
  const updated = await one<ReleaseRow>(
    tx,
    `UPDATE imposter_release SET status='OFFERED', mode=$2, released_at=clock_timestamp(),
            claim_deadline_at = LEAST(clock_timestamp() + make_interval(secs => claim_seconds), $3::timestamptz),
            open_deadline_at = CASE WHEN $2='OPEN' THEN LEAST(clock_timestamp() + make_interval(secs => claim_seconds + solve_seconds), $3::timestamptz) ELSE NULL END,
            released_by=$4, version=version+1
      WHERE id=$1 RETURNING *`,
    [releaseId, g.imposter_mode, s.deadline_at, actor.id],
  );
  const pv = (await one<{ title: string; difficulty: string }>(tx, 'SELECT title, difficulty FROM problem_version WHERE id=$1', [r.problem_version_id]))!;
  await audit(tx, actor, 'imposter.released', { type: 'imposter', id: releaseId }, { label: r.label, mode: g.imposter_mode });
  await emit(tx, 'imposter.offered', [Rooms.game(g.id), Rooms.admin], {
    gameId: g.id, releaseId, label: r.label, title: pv.title, reward: r.reward, mode: g.imposter_mode,
    claimDeadlineAt: updated!.claim_deadline_at, openDeadlineAt: updated!.open_deadline_at,
  });
  return updated!;
}

/** Admin cancel: no award, reservation cancelled, crew returns to regular mode. */
export async function cancelImposter(tx: Tx, actor: Actor, releaseId: string, reason: string) {
  const r0 = await one<ReleaseRow>(tx, 'SELECT * FROM imposter_release WHERE id=$1', [releaseId]);
  if (!r0) throw new AppError('NOT_FOUND', 'Imposter not found.');
  await lockGame(tx, r0.game_id);
  const r = (await one<ReleaseRow>(tx, 'SELECT * FROM imposter_release WHERE id=$1 FOR UPDATE', [releaseId]))!;
  if (!['DRAFT', 'OFFERED', 'RESERVED'].includes(r.status)) throw new AppError('INVALID_TRANSITION', 'This imposter is already resolved.');
  await tx.query(`UPDATE imposter_release SET status='CANCELLED', resolved_at=clock_timestamp(), resolution_note=$2, version=version+1 WHERE id=$1`, [releaseId, reason]);
  const res = await one<ReservationRow>(tx, `UPDATE imposter_reservation SET status='CANCELLED', resolved_at=clock_timestamp() WHERE release_id=$1 AND status='ACTIVE' RETURNING *`, [releaseId]);
  if (res) await tx.query('UPDATE game_enrollment SET active_reservation_id=NULL, version=version+1 WHERE id=$1 AND active_reservation_id=$2', [res.enrollment_id, res.id]);
  await audit(tx, actor, 'imposter.cancelled', { type: 'imposter', id: releaseId }, { label: r.label }, reason);
  if (r.status !== 'DRAFT') await emit(tx, 'imposter.cancelled', [Rooms.game(r.game_id), Rooms.admin], { gameId: r.game_id, releaseId });
}

/** Creates a NEW generation (fresh draft) from an expired/cancelled release. Never silently reassigns. */
export async function rearmImposter(tx: Tx, actor: Actor, releaseId: string) {
  const r = await one<ReleaseRow>(tx, 'SELECT * FROM imposter_release WHERE id=$1', [releaseId]);
  if (!r) throw new AppError('NOT_FOUND', 'Imposter not found.');
  if (!['EXPIRED', 'CANCELLED'].includes(r.status)) throw new AppError('INVALID_TRANSITION', 'Only expired or cancelled imposters can be re-armed.');
  const next = await one<ReleaseRow>(
    tx,
    `INSERT INTO imposter_release(game_id, sprint_id, problem_version_id, label, generation, status, mode, reward, hint_cost, claim_seconds, solve_seconds)
     SELECT game_id, sprint_id, problem_version_id, regexp_replace(label, '-G[0-9]+$', '') || '-G' || (generation+1), generation+1, 'DRAFT', mode, reward, hint_cost, claim_seconds, solve_seconds
       FROM imposter_release WHERE id=$1 RETURNING *`,
    [releaseId],
  );
  await audit(tx, actor, 'imposter.rearmed', { type: 'imposter', id: next!.id }, { from: releaseId, generation: next!.generation });
  return next!;
}

// ---------------------------------------------------------------------------
// Participant
// ---------------------------------------------------------------------------

export interface ImposterRaw {
  r: ReleaseRow & { title: string; difficulty: string };
  res?: ReservationRow & { crew_id: string; name: string };
  solvedOpen?: { crew_id: string; name: string; enrollment_id: string };
}

/** Crew-independent imposter state (cacheable per game state version). */
export async function imposterRaw(q: Queryable, game: GameRow): Promise<ImposterRaw | null> {
  const r = await one<ReleaseRow & { title: string; difficulty: string }>(
    q,
    `SELECT ir.*, pv.title, pv.difficulty FROM imposter_release ir JOIN problem_version pv ON pv.id=ir.problem_version_id
      WHERE ir.game_id=$1 AND ir.status <> 'DRAFT' AND ir.sprint_id = (SELECT id FROM sprint WHERE game_id=$1 AND number=$2)
      ORDER BY ir.released_at DESC NULLS LAST LIMIT 1`,
    [game.id, Math.max(1, game.current_sprint)],
  );
  if (!r) return null;
  const res = await one<ReservationRow & { crew_id: string; name: string }>(
    q,
    `SELECT r.*, t.crew_id, t.name FROM imposter_reservation r JOIN game_enrollment ge ON ge.id=r.enrollment_id JOIN team t ON t.id=ge.team_id WHERE r.release_id=$1`,
    [r.id],
  );
  const solvedOpen = r.mode === 'OPEN' && r.status === 'SOLVED'
    ? await one<{ crew_id: string; name: string; enrollment_id: string }>(q, `SELECT t.crew_id, t.name, s.enrollment_id FROM submission s JOIN game_enrollment ge ON ge.id=s.enrollment_id JOIN team t ON t.id=ge.team_id WHERE s.imposter_release_id=$1 AND s.correct ORDER BY s.created_at LIMIT 1`, [r.id])
    : undefined;
  return { r, res, solvedOpen };
}

/** Per-crew view: only the reserving crew sees its own solve deadline. Never includes the statement. */
export function imposterView(raw: ImposterRaw | null, enrollmentId: string | null, nowMs = Date.now()) {
  if (!raw) return null;
  const { r, res, solvedOpen } = raw;
  const mine = !!res && res.enrollment_id === enrollmentId;
  return {
    id: r.id,
    label: r.label,
    title: r.title,
    difficulty: r.difficulty,
    reward: r.reward,
    hintCost: r.hint_cost,
    mode: r.mode,
    status: r.status,
    claimDeadlineAt: r.claim_deadline_at,
    openDeadlineAt: r.open_deadline_at,
    claimOpen: r.status === 'OFFERED' && r.mode === 'RESERVE' && !!r.claim_deadline_at && nowMs < new Date(r.claim_deadline_at).getTime(),
    reservedByMe: mine && res!.status === 'ACTIVE',
    reservation: res ? { crew: `${res.name} (${res.crew_id})`, status: res.status, solveDeadlineAt: mine ? res.solve_deadline_at : null, mine } : null,
    solvedBy: solvedOpen ? `${solvedOpen.name} (${solvedOpen.crew_id})` : res?.status === 'SOLVED' ? `${res.name} (${res.crew_id})` : null,
  };
}

export async function currentImposter(q: Queryable, game: GameRow, enrollmentId: string | null, nowMs = Date.now()) {
  return imposterView(await imposterRaw(q, game), enrollmentId, nowMs);
}

/** The first eligible reservation transaction wins. Clicking the banner only opens the offer. */
export async function reserveImposter(db: Db, ctx: CompetitorContext, releaseId: string, idemKey: string) {
  return withTx(db, async (tx) => {
    const idem = await claimIdempotency(tx, `enr:${ctx.enrollment.id}`, `imposter-reserve:${releaseId}`, idemKey, { releaseId });
    if (idem.existing) return idem.existing as Record<string, unknown>;
    const { game, sprint, enr, now } = await lockForScoring(tx, ctx.game.id, ctx.enrollment.id);
    await assertCanScore(tx, game, sprint, enr, now);
    const r = await one<ReleaseRow>(tx, 'SELECT * FROM imposter_release WHERE id=$1 FOR UPDATE', [releaseId]);
    if (!r || r.game_id !== game.id) throw new AppError('NOT_FOUND', 'Imposter not found.');
    if (r.mode !== 'RESERVE') throw new AppError('INVALID_TRANSITION', 'This imposter is open to every crew — no claim needed.');
    if (r.status === 'RESERVED' || r.status === 'SOLVED') throw new AppError('IMPOSTER_CLAIMED', 'Another crew has claimed this imposter problem.');
    if (r.status !== 'OFFERED' || !r.claim_deadline_at || now >= new Date(r.claim_deadline_at).getTime()) throw new AppError('IMPOSTER_WINDOW_CLOSED', 'The claim window has closed.');
    if (enr.active_reservation_id) throw new AppError('CONFLICT', 'Your crew already holds an imposter reservation.');
    const res = await one<ReservationRow>(
      tx,
      `INSERT INTO imposter_reservation(release_id, enrollment_id, reserved_at, solve_deadline_at)
       VALUES ($1, $2, clock_timestamp(), LEAST(clock_timestamp() + make_interval(secs => $3), $4::timestamptz)) RETURNING *`,
      [r.id, enr.id, r.solve_seconds, sprint!.deadline_at],
    );
    await tx.query(`UPDATE imposter_release SET status='RESERVED', version=version+1 WHERE id=$1`, [r.id]);
    await tx.query('UPDATE game_enrollment SET active_reservation_id=$2, version=version+1 WHERE id=$1', [enr.id, res!.id]);
    await emit(tx, 'imposter.reserved', [Rooms.game(game.id), Rooms.admin], { gameId: game.id, releaseId: r.id, crewId: ctx.team.crew_id, crewName: ctx.team.name });
    await emit(tx, 'imposter.reserved', [Rooms.team(ctx.team.id)], { gameId: game.id, releaseId: r.id, mine: true, solveDeadlineAt: res!.solve_deadline_at });
    const response = { reserved: true, releaseId: r.id, solveDeadlineAt: res!.solve_deadline_at };
    await idem.save(response);
    return response;
  });
}

async function assertImposterAccess(q: Queryable, ctx: CompetitorContext, r: ReleaseRow, nowMs: number) {
  if (r.game_id !== ctx.game.id || r.status === 'DRAFT') throw new AppError('NOT_FOUND', 'Imposter not found.');
  if (r.mode === 'OPEN') return null;
  const res = await one<ReservationRow>(q, 'SELECT * FROM imposter_reservation WHERE release_id=$1', [r.id]);
  if (!res || res.enrollment_id !== ctx.enrollment.id) throw new AppError('IMPOSTER_NOT_OWNER', 'Another crew has claimed this imposter problem.');
  void nowMs;
  return res;
}

export async function imposterDetail(q: Queryable, ctx: CompetitorContext, releaseId: string) {
  if (ctx.enrollment.status !== 'ACTIVE') throw new AppError('TEAM_ELIMINATED', 'Your crew can no longer access imposter files.');
  const r = await one<ReleaseRow>(q, 'SELECT * FROM imposter_release WHERE id=$1', [releaseId]);
  if (!r) throw new AppError('NOT_FOUND', 'Imposter not found.');
  const res = await assertImposterAccess(q, ctx, r, Date.now());
  const pv = (await one<ProblemVersionRow>(q, 'SELECT * FROM problem_version WHERE id=$1', [r.problem_version_id]))!;
  const purchase = await one(q, `SELECT id FROM hint_purchase WHERE enrollment_id=$1 AND target_type='IMPOSTER' AND target_id=$2 AND problem_version_id=$3`, [ctx.enrollment.id, r.id, r.problem_version_id]);
  const domain = await one(q, 'SELECT d.slug, d.name, d.room, d.color, d.symbol FROM problem p JOIN domain d ON d.id=p.domain_id WHERE p.id=$1', [pv.problem_id]);
  return {
    id: r.id,
    kind: 'IMPOSTER' as const,
    label: r.label,
    generation: r.generation,
    domain,
    title: pv.title,
    difficulty: pv.difficulty,
    reward: r.reward,
    statement: pv.statement,
    workspace: pv.workspace,
    runLanguage: pv.run_language,
    runEntry: pv.run_entry,
    files: pv.files.map((f) => ({ name: f.name, language: f.language, content: f.content, readOnly: !!f.readOnly })),
    sampleStdin: pv.sample_stdin,
    answerFormat: pv.answer_format,
    validation: pv.validation.mode === 'CODE_TESTS' ? { mode: 'CODE_TESTS', language: pv.validation.language, testCount: pv.validation.tests.length }
      : pv.validation.mode === 'NUMERIC' ? { mode: 'NUMERIC', tolerance: pv.validation.tolerance }
      : { mode: 'EXACT_TEXT', caseSensitive: pv.validation.caseSensitive, collapseWhitespace: pv.validation.collapseWhitespace },
    status: r.status,
    reservationStatus: res?.status ?? null,
    solveDeadlineAt: res?.solve_deadline_at ?? r.open_deadline_at,
    hint: { cost: r.hint_cost, unlocked: !!purchase, text: purchase ? pv.hint : null },
  };
}

export async function submitImposter(db: Db, cfg: AppConfig, ctx: CompetitorContext, sessionId: string, releaseId: string, body: SubmissionPayload, idemKey: string) {
  const prior = await peekIdempotency(db, `enr:${ctx.enrollment.id}`, `imposter-submit:${releaseId}`, idemKey);
  if (prior) return prior as Record<string, unknown>;
  const r0 = await one<ReleaseRow>(db, 'SELECT * FROM imposter_release WHERE id=$1', [releaseId]);
  if (!r0) throw new AppError('NOT_FOUND', 'Imposter not found.');
  await assertImposterAccess(db, ctx, r0, Date.now());
  const pv = (await one<ProblemVersionRow>(db, 'SELECT * FROM problem_version WHERE id=$1', [r0.problem_version_id]))!;
  const payload = validateSubmissionPayload(pv, body);
  const graded = await gradeSubmission(cfg, pv, payload);
  return withTx(db, async (tx) => {
    const idem = await claimIdempotency(tx, `enr:${ctx.enrollment.id}`, `imposter-submit:${releaseId}`, idemKey, { payloadHash: graded.payloadHash });
    if (idem.existing) return idem.existing as Record<string, unknown>;
    const { game, sprint, enr, now } = await lockForScoring(tx, ctx.game.id, ctx.enrollment.id);
    await assertCanScore(tx, game, sprint, enr, now);
    const r = (await one<ReleaseRow>(tx, 'SELECT * FROM imposter_release WHERE id=$1 FOR UPDATE', [releaseId]))!;
    let res: ReservationRow | undefined;
    if (r.mode === 'RESERVE') {
      res = await one<ReservationRow>(tx, 'SELECT * FROM imposter_reservation WHERE release_id=$1 FOR UPDATE', [r.id]);
      if (!res || res.enrollment_id !== enr.id) throw new AppError('IMPOSTER_NOT_OWNER', 'Another crew has claimed this imposter problem.');
      if (res.status !== 'ACTIVE' || r.status !== 'RESERVED') throw new AppError('IMPOSTER_WINDOW_CLOSED', 'Your imposter protocol is no longer active.');
      if (now >= new Date(res.solve_deadline_at).getTime()) throw new AppError('IMPOSTER_WINDOW_CLOSED', 'Imposter protocol time limit exceeded.');
    } else {
      if (r.status === 'SOLVED') throw new AppError('TASK_ALREADY_SOLVED', 'Another crew already eliminated this imposter.');
      if (r.status !== 'OFFERED' || !r.open_deadline_at || now >= new Date(r.open_deadline_at).getTime()) throw new AppError('IMPOSTER_WINDOW_CLOSED', 'The imposter window has closed.');
    }
    await tx.query(
      `INSERT INTO submission(game_id, enrollment_id, session_id, imposter_release_id, generation, kind, payload_hash, code, correct, result_code, judge)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [game.id, enr.id, sessionId, r.id, r.generation, payload.kind, graded.payloadHash, payload.kind === 'CODE' ? JSON.stringify(payload.files) : null,
        graded.correct, graded.correct ? 'CORRECT' : 'INCORRECT', graded.judge ? JSON.stringify(graded.judge) : null],
    );
    let response: Record<string, unknown>;
    if (graded.correct) {
      await tx.query(`UPDATE imposter_release SET status='SOLVED', resolved_at=clock_timestamp(), version=version+1 WHERE id=$1`, [r.id]);
      if (res) {
        await tx.query(`UPDATE imposter_reservation SET status='SOLVED', resolved_at=clock_timestamp() WHERE id=$1`, [res.id]);
        await tx.query('UPDATE game_enrollment SET active_reservation_id=NULL WHERE id=$1', [enr.id]);
      }
      const after = await applyLedger(tx, { ...enr, active_reservation_id: null }, {
        kind: 'IMPOSTER_REWARD', wallet: r.reward, earned: r.reward, sourceType: 'imposter_release', sourceId: r.id, reason: `${r.label} eliminated`,
      });
      await emit(tx, 'imposter.solved', [Rooms.game(game.id), Rooms.admin], { gameId: game.id, releaseId: r.id, crewId: ctx.team.crew_id, crewName: ctx.team.name, reward: r.reward });
      await emit(tx, 'standings.updated', [Rooms.game(game.id), Rooms.admin], { gameId: game.id });
      response = { correct: true, result: 'CORRECT', reward: r.reward, wallet: after.wallet_balance, judge: graded.judge ?? null, message: 'Imposter eliminated.' };
    } else {
      response = { correct: false, result: 'INCORRECT', judge: graded.judge ?? null, wallet: enr.wallet_balance, message: 'The imposter is still among us.' };
    }
    await idem.save(response);
    return response;
  });
}

export async function abandonImposter(db: Db, ctx: CompetitorContext, releaseId: string) {
  return withTx(db, async (tx) => {
    await tx.query('SELECT id FROM game WHERE id=$1 FOR SHARE', [ctx.game.id]);
    const enr = (await one<{ id: string; active_reservation_id: string | null }>(tx, 'SELECT id, active_reservation_id FROM game_enrollment WHERE id=$1 FOR UPDATE', [ctx.enrollment.id]))!;
    const r = await one<ReleaseRow>(tx, 'SELECT * FROM imposter_release WHERE id=$1 FOR UPDATE', [releaseId]);
    const res = r ? await one<ReservationRow>(tx, 'SELECT * FROM imposter_reservation WHERE release_id=$1 FOR UPDATE', [releaseId]) : undefined;
    if (!r || !res || res.enrollment_id !== enr.id || res.status !== 'ACTIVE') throw new AppError('INVALID_TRANSITION', 'You do not hold an active imposter reservation.');
    await tx.query(`UPDATE imposter_reservation SET status='ABANDONED', resolved_at=clock_timestamp() WHERE id=$1`, [res.id]);
    await tx.query(`UPDATE imposter_release SET status='EXPIRED', resolved_at=clock_timestamp(), resolution_note='ABANDONED', version=version+1 WHERE id=$1`, [r.id]);
    await tx.query('UPDATE game_enrollment SET active_reservation_id=NULL, version=version+1 WHERE id=$1', [enr.id]);
    await audit(tx, { type: 'TEAM', id: ctx.team.id }, 'imposter.abandoned', { type: 'imposter', id: r.id });
    await emit(tx, 'imposter.expired', [Rooms.game(ctx.game.id), Rooms.admin], { gameId: ctx.game.id, releaseId: r.id, reason: 'ABANDONED' });
    return { abandoned: true };
  });
}

/** Worker: expire claim windows / solve deadlines. Returns number of state changes. */
export async function expireImposters(db: Db): Promise<number> {
  const due = await many<{ id: string; game_id: string }>(
    db,
    `SELECT ir.id, ir.game_id FROM imposter_release ir
       LEFT JOIN imposter_reservation r ON r.release_id=ir.id AND r.status='ACTIVE'
      WHERE (ir.status='OFFERED' AND ir.mode='RESERVE' AND ir.claim_deadline_at <= clock_timestamp())
         OR (ir.status='OFFERED' AND ir.mode='OPEN' AND ir.open_deadline_at <= clock_timestamp())
         OR (ir.status='RESERVED' AND r.solve_deadline_at <= clock_timestamp())`,
  );
  let n = 0;
  for (const d of due) {
    await withTx(db, async (tx) => {
      const g = await one<GameRow>(tx, 'SELECT * FROM game WHERE id=$1 FOR SHARE', [d.game_id]);
      if (g?.phase === 'PAUSED') return; // deadlines are frozen while paused
      const r = await one<ReleaseRow>(tx, 'SELECT * FROM imposter_release WHERE id=$1 FOR UPDATE', [d.id]);
      if (!r || !['OFFERED', 'RESERVED'].includes(r.status)) return;
      const res = await one<ReservationRow>(tx, `SELECT * FROM imposter_reservation WHERE release_id=$1 AND status='ACTIVE' FOR UPDATE`, [r.id]);
      const nowRow = await one<{ t: Date }>(tx, 'SELECT clock_timestamp() AS t');
      const now = new Date(nowRow!.t).getTime();
      const expired =
        (r.status === 'OFFERED' && r.mode === 'RESERVE' && r.claim_deadline_at && now >= new Date(r.claim_deadline_at).getTime()) ||
        (r.status === 'OFFERED' && r.mode === 'OPEN' && r.open_deadline_at && now >= new Date(r.open_deadline_at).getTime()) ||
        (r.status === 'RESERVED' && res && now >= new Date(res.solve_deadline_at).getTime());
      if (!expired) return;
      await tx.query(`UPDATE imposter_release SET status='EXPIRED', resolved_at=clock_timestamp(), resolution_note=$2, version=version+1 WHERE id=$1`, [r.id, r.status === 'OFFERED' ? 'UNCLAIMED' : 'SOLVE_TIMEOUT']);
      if (res) {
        await tx.query(`UPDATE imposter_reservation SET status='EXPIRED', resolved_at=clock_timestamp() WHERE id=$1`, [res.id]);
        await tx.query('UPDATE game_enrollment SET active_reservation_id=NULL, version=version+1 WHERE id=$1 AND active_reservation_id=$2', [res.enrollment_id, res.id]);
      }
      await emit(tx, 'imposter.expired', [Rooms.game(r.game_id), Rooms.admin], { gameId: r.game_id, releaseId: r.id, reason: r.status === 'OFFERED' ? 'UNCLAIMED' : 'SOLVE_TIMEOUT' });
      n++;
    });
  }
  return n;
}

export async function purchaseImposterHint(db: Db, ctx: CompetitorContext, releaseId: string, idemKey: string) {
  return withTx(db, async (tx) => {
    const idem = await claimIdempotency(tx, `enr:${ctx.enrollment.id}`, `imposter-hint:${releaseId}`, idemKey, { releaseId });
    if (idem.existing) return idem.existing as Record<string, unknown>;
    const { game, sprint, enr, now } = await lockForScoring(tx, ctx.game.id, ctx.enrollment.id);
    const r = await one<ReleaseRow>(tx, 'SELECT * FROM imposter_release WHERE id=$1 FOR UPDATE', [releaseId]);
    if (!r || r.game_id !== game.id) throw new AppError('NOT_FOUND', 'Imposter not found.');
    const pv = (await one<ProblemVersionRow>(tx, 'SELECT * FROM problem_version WHERE id=$1', [r.problem_version_id]))!;
    const existing = await one(tx, `SELECT id FROM hint_purchase WHERE enrollment_id=$1 AND target_type='IMPOSTER' AND target_id=$2 AND problem_version_id=$3`, [enr.id, r.id, r.problem_version_id]);
    if (existing) {
      const resp = { hint: pv.hint, cost: r.hint_cost, charged: false, wallet: enr.wallet_balance };
      await idem.save(resp);
      return resp;
    }
    await assertCanScore(tx, game, sprint, enr, now);
    if (r.mode === 'RESERVE') {
      const res = await one<ReservationRow>(tx, 'SELECT * FROM imposter_reservation WHERE release_id=$1', [r.id]);
      if (!res || res.enrollment_id !== enr.id || res.status !== 'ACTIVE') throw new AppError('IMPOSTER_NOT_OWNER', 'Only the crew holding this imposter can buy its hint.');
      if (now >= new Date(res.solve_deadline_at).getTime()) throw new AppError('IMPOSTER_WINDOW_CLOSED', 'Imposter protocol time limit exceeded.');
    } else if (r.status !== 'OFFERED') {
      throw new AppError('HINT_UNAVAILABLE', 'This imposter is no longer open.');
    }
    if (enr.wallet_balance < r.hint_cost) throw new AppError('INSUFFICIENT_FUNDS', `Not enough IdeaCoins. This hint costs ${r.hint_cost}.`, { wallet: enr.wallet_balance, cost: r.hint_cost });
    const hp = await one<{ id: string }>(tx, `INSERT INTO hint_purchase(game_id, enrollment_id, target_type, target_id, problem_version_id, cost) VALUES ($1,$2,'IMPOSTER',$3,$4,$5) RETURNING id`, [game.id, enr.id, r.id, r.problem_version_id, r.hint_cost]);
    let wallet = enr.wallet_balance;
    if (r.hint_cost > 0) {
      wallet = (await applyLedger(tx, enr, { kind: 'HINT_PURCHASE', wallet: -r.hint_cost, spent: r.hint_cost, sourceType: 'hint_purchase', sourceId: hp!.id, reason: `Hint for ${r.label}` })).wallet_balance;
      await emit(tx, 'standings.updated', [Rooms.game(game.id), Rooms.admin], { gameId: game.id });
    }
    await emit(tx, 'hint.unlocked', [Rooms.team(ctx.team.id)], { gameId: game.id, targetType: 'IMPOSTER', targetId: r.id });
    const resp = { hint: pv.hint, cost: r.hint_cost, charged: true, wallet };
    await idem.save(resp);
    return resp;
  });
}
