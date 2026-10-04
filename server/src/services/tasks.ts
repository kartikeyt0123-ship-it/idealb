import { createHmac } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { StarterFile, Validation } from '../content/types.js';
import { many, one, withTx, type Db, type Queryable, type Tx } from '../db.js';
import { AppError } from '../errors.js';
import { judgeCode, type JudgeOutcome } from '../grading/codeJudge.js';
import { normalizeTextAnswer, parseNumericAnswer } from '../grading/normalize.js';
import { RunnerError } from '../grading/runnerClient.js';
import { answerVerifier, safeEqualHex, sha256 } from '../security/crypto.js';
import { activeElapsedSeconds, type CompetitorContext, type EnrollmentRow, type GameRow, type SprintRow } from './context.js';
import { claimIdempotency, peekIdempotency } from './idempotency.js';
import { emit, Rooms } from './outbox.js';
import { applyLedger } from './wallet.js';

export interface TaskInstanceRow {
  id: string;
  game_id: string;
  sprint_id: string;
  problem_version_id: string;
  domain_id: string;
  label: string;
  generation: number;
  status: 'AVAILABLE' | 'SOLVED' | 'DISABLED';
  release_offset_seconds: number;
  close_offset_seconds: number | null;
  solved_by_enrollment_id: string | null;
  solved_at: Date | null;
  version: number;
}

export interface ProblemVersionRow {
  id: string;
  problem_id: string;
  title: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  statement: string;
  workspace: string;
  run_language: 'javascript' | 'python' | null;
  run_entry: string | null;
  files: StarterFile[];
  sample_stdin: string | null;
  answer_format: string;
  validation: Validation;
  answer_verifier: string | null;
  hint: string;
  reward: number;
  hint_cost: number;
}

export type WindowState = 'LOCKED' | 'OPEN' | 'CLOSED';

/** Release/close windows are relative to *active* sprint time, so pauses shift them consistently. */
export function taskWindow(t: Pick<TaskInstanceRow, 'release_offset_seconds' | 'close_offset_seconds'>, s: SprintRow, nowMs: number): WindowState {
  if (s.status === 'PENDING' || !s.started_at) return 'LOCKED';
  if (s.status === 'CLOSED' || s.status === 'FINALIZED') return 'CLOSED';
  if (s.status === 'RUNNING' && s.deadline_at && nowMs >= new Date(s.deadline_at).getTime()) return 'CLOSED';
  const elapsed = activeElapsedSeconds(s, nowMs);
  if (elapsed < t.release_offset_seconds) return 'LOCKED';
  if (t.close_offset_seconds !== null && elapsed >= t.close_offset_seconds) return 'CLOSED';
  return 'OPEN';
}

/** Which sprint's tasks participants see: the running/closed one, else the next one as locked shells. */
export async function displaySprint(q: Queryable, game: GameRow): Promise<SprintRow | undefined> {
  const n = game.phase === 'WAITING_NEXT_SPRINT' ? 2 : Math.max(1, game.current_sprint);
  return one<SprintRow>(q, 'SELECT * FROM sprint WHERE game_id=$1 AND number=$2', [game.id, n]);
}

export interface TaskCard {
  id: string;
  label: string;
  domain: string;
  difficulty: string;
  reward: number;
  hintCost: number;
  /** Participant-facing state. LOCKED tasks expose no title or content. */
  state: 'LOCKED' | 'AVAILABLE' | 'SOLVED_BY_YOU' | 'SOLVED' | 'CLOSED' | 'DISABLED';
  title: string | null;
  solvedByCrew: string | null;
  generation: number;
  releaseInSeconds: number | null;
  hintUnlocked: boolean;
}

export type TaskRowFull = TaskInstanceRow & { domain_slug: string; title: string; difficulty: string; reward: number; hint_cost: number; solver_crew: string | null; solver_name: string | null };

/** Shared (crew-independent) task rows for a sprint — cacheable per game state version. */
export async function taskRowsForSprint(q: Queryable, sprintId: string): Promise<TaskRowFull[]> {
  return many<TaskRowFull>(
    q,
    `SELECT ti.*, d.slug AS domain_slug, pv.title, pv.difficulty, pv.reward, pv.hint_cost,
            t.crew_id AS solver_crew, t.name AS solver_name
       FROM task_instance ti
       JOIN domain d ON d.id=ti.domain_id
       JOIN problem_version pv ON pv.id=ti.problem_version_id
       LEFT JOIN game_enrollment ge ON ge.id=ti.solved_by_enrollment_id
       LEFT JOIN team t ON t.id=ge.team_id
      WHERE ti.sprint_id=$1
      ORDER BY d.sort, ti.label`,
    [sprintId],
  );
}

/** Per-crew view of the shared rows: states, visibility (no titles while locked) and own hint entitlements. */
export function taskCards(rows: TaskRowFull[], s: SprintRow, enrollmentId: string, hintTaskIds: Set<string>, nowMs: number): TaskCard[] {
  const elapsed = activeElapsedSeconds(s, nowMs);
  return rows.map((r) => {
    const w = taskWindow(r, s, nowMs);
    let state: TaskCard['state'];
    if (r.status === 'DISABLED') state = 'DISABLED';
    else if (r.status === 'SOLVED') state = r.solved_by_enrollment_id === enrollmentId ? 'SOLVED_BY_YOU' : 'SOLVED';
    else if (w === 'LOCKED') state = 'LOCKED';
    else if (w === 'CLOSED') state = 'CLOSED';
    else state = 'AVAILABLE';
    const visible = state !== 'LOCKED';
    return {
      id: r.id,
      label: r.label,
      domain: r.domain_slug,
      difficulty: r.difficulty,
      reward: r.reward,
      hintCost: r.hint_cost,
      state,
      title: visible ? r.title : null,
      solvedByCrew: r.status === 'SOLVED' ? `${r.solver_name} (${r.solver_crew})` : null,
      generation: r.generation,
      releaseInSeconds: state === 'LOCKED' && s.started_at ? Math.max(0, Math.ceil(r.release_offset_seconds - elapsed)) : null,
      hintUnlocked: hintTaskIds.has(r.id),
    };
  });
}

export async function hintTaskIds(q: Queryable, enrollmentId: string): Promise<Set<string>> {
  const rows = await many<{ target_id: string }>(q, `SELECT target_id FROM hint_purchase WHERE enrollment_id=$1 AND target_type='TASK'`, [enrollmentId]);
  return new Set(rows.map((r) => r.target_id));
}

export async function listTasks(q: Queryable, ctx: CompetitorContext, nowMs = Date.now()): Promise<{ sprint: number | null; tasks: TaskCard[] }> {
  const s = await displaySprint(q, ctx.game);
  if (!s) return { sprint: null, tasks: [] };
  const [rows, hints] = await Promise.all([taskRowsForSprint(q, s.id), hintTaskIds(q, ctx.enrollment.id)]);
  return { sprint: s.number, tasks: taskCards(rows, s, ctx.enrollment.id, hints, nowMs) };
}

function publicValidation(v: Validation) {
  if (v.mode === 'EXACT_TEXT') return { mode: v.mode, caseSensitive: v.caseSensitive, collapseWhitespace: v.collapseWhitespace };
  if (v.mode === 'NUMERIC') return { mode: v.mode, tolerance: v.tolerance };
  return { mode: v.mode, language: v.language, testCount: v.tests.length };
}

export async function loadTask(q: Queryable, taskId: string) {
  const t = await one<TaskInstanceRow>(q, 'SELECT * FROM task_instance WHERE id=$1', [taskId]);
  if (!t) throw new AppError('NOT_FOUND', 'Task not found.');
  const pv = await one<ProblemVersionRow>(q, 'SELECT * FROM problem_version WHERE id=$1', [t.problem_version_id]);
  const s = await one<SprintRow>(q, 'SELECT * FROM sprint WHERE id=$1', [t.sprint_id]);
  return { t, pv: pv!, s: s! };
}

/** Full task detail. Only for ACTIVE crews and released tasks of the game's visible sprint; hint text only if purchased. */
export async function taskDetail(q: Queryable, ctx: CompetitorContext, taskId: string, nowMs = Date.now()) {
  const { t, pv, s } = await loadTask(q, taskId);
  if (t.game_id !== ctx.game.id) throw new AppError('NOT_FOUND', 'Task not found.');
  const visible = await displaySprint(q, ctx.game);
  if (!visible || visible.id !== s.id) throw new AppError('TASK_NOT_RELEASED', 'This system is not part of the current sprint.');
  const w = taskWindow(t, s, nowMs);
  if (w === 'LOCKED' || t.status === 'DISABLED') throw new AppError('TASK_NOT_RELEASED', 'This system is still locked.');
  const purchase = await one<{ id: string }>(
    q,
    `SELECT id FROM hint_purchase WHERE enrollment_id=$1 AND target_type='TASK' AND target_id=$2 AND problem_version_id=$3`,
    [ctx.enrollment.id, t.id, t.problem_version_id],
  );
  const domain = await one<{ slug: string; name: string; room: string; color: string; symbol: string }>(q, 'SELECT slug, name, room, color, symbol FROM domain WHERE id=$1', [t.domain_id]);
  const solver = t.solved_by_enrollment_id
    ? await one<{ crew_id: string; name: string }>(q, 'SELECT t.crew_id, t.name FROM game_enrollment ge JOIN team t ON t.id=ge.team_id WHERE ge.id=$1', [t.solved_by_enrollment_id])
    : undefined;
  return {
    id: t.id,
    kind: 'REGULAR' as const,
    label: t.label,
    generation: t.generation,
    domain,
    title: pv.title,
    difficulty: pv.difficulty,
    reward: pv.reward,
    statement: pv.statement,
    workspace: pv.workspace,
    runLanguage: pv.run_language,
    runEntry: pv.run_entry,
    files: pv.files.map((f) => ({ name: f.name, language: f.language, content: f.content, readOnly: !!f.readOnly })),
    sampleStdin: pv.sample_stdin,
    answerFormat: pv.answer_format,
    validation: publicValidation(pv.validation),
    status: t.status === 'SOLVED' ? (t.solved_by_enrollment_id === ctx.enrollment.id ? 'SOLVED_BY_YOU' : 'SOLVED') : w === 'CLOSED' ? 'CLOSED' : 'AVAILABLE',
    solvedBy: solver ? `${solver.name} (${solver.crew_id})` : null,
    hint: { cost: pv.hint_cost, unlocked: !!purchase, text: purchase ? pv.hint : null },
    sprintDeadlineAt: s.deadline_at,
  };
}

// ---------------------------------------------------------------------------
// Authoritative grading
// ---------------------------------------------------------------------------

export interface SubmissionPayload {
  answer?: string;
  files?: Record<string, string>;
}

export function validateSubmissionPayload(pv: Pick<ProblemVersionRow, 'validation' | 'files'>, body: SubmissionPayload) {
  if (pv.validation.mode === 'CODE_TESTS') {
    if (!body.files || typeof body.files !== 'object') throw new AppError('VALIDATION_FAILED', 'Submit your edited files.');
    const editable = new Set(pv.files.filter((f) => !f.readOnly).map((f) => f.name));
    let size = 0;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.files)) {
      if (!editable.has(k)) continue; // read-only/unknown files are always taken from the task
      if (typeof v !== 'string') throw new AppError('VALIDATION_FAILED', `File ${k} must be text.`);
      size += v.length;
      out[k] = v;
    }
    if (size > 200_000) throw new AppError('PAYLOAD_TOO_LARGE', 'Submitted code is too large.');
    return { kind: 'CODE' as const, files: out };
  }
  if (typeof body.answer !== 'string' || !body.answer.trim()) throw new AppError('VALIDATION_FAILED', 'Enter an answer.');
  if (body.answer.length > 500) throw new AppError('VALIDATION_FAILED', 'Answer is too long.');
  return { kind: 'ANSWER' as const, answer: body.answer };
}

export async function gradeSubmission(
  cfg: AppConfig,
  pv: Pick<ProblemVersionRow, 'validation' | 'files' | 'answer_verifier'>,
  payload: ReturnType<typeof validateSubmissionPayload>,
): Promise<{ correct: boolean; judge?: JudgeOutcome; payloadHash: string }> {
  const v = pv.validation;
  if (payload.kind === 'CODE') {
    if (v.mode !== 'CODE_TESTS') throw new AppError('VALIDATION_FAILED', 'This task expects a typed answer.');
    let judge: JudgeOutcome;
    try {
      judge = await judgeCode(cfg.runner, pv.files, payload.files, v);
    } catch (err) {
      if (err instanceof RunnerError) throw new AppError(err.code === 'RUNNER_BUSY' ? 'RUNNER_BUSY' : err.code === 'RUNTIME_UNAVAILABLE' ? 'RUNTIME_UNAVAILABLE' : 'RUNNER_UNAVAILABLE', err.message);
      throw err;
    }
    return { correct: judge.passed, judge, payloadHash: sha256(JSON.stringify(payload.files)) };
  }
  const answer = payload.answer;
  // Keyed hash of the submitted text: never store raw low-entropy answers.
  const payloadHash = createHmac('sha256', cfg.gradingSecret).update(`submitted:${answer.trim()}`).digest('hex');
  if (v.mode === 'EXACT_TEXT') {
    const norm = normalizeTextAnswer(answer, { caseSensitive: v.caseSensitive, collapseWhitespace: v.collapseWhitespace });
    return { correct: !!pv.answer_verifier && safeEqualHex(answerVerifier(cfg.gradingSecret, norm), pv.answer_verifier), payloadHash };
  }
  if (v.mode === 'NUMERIC') {
    const n = parseNumericAnswer(answer);
    return { correct: n !== null && Math.abs(n - v.answer) <= v.tolerance + 1e-9, payloadHash };
  }
  throw new AppError('VALIDATION_FAILED', 'This task expects code, not a typed answer.');
}

// ---------------------------------------------------------------------------
// Locking helpers (consistent order: game -> sprint -> enrollment -> task/imposter)
// ---------------------------------------------------------------------------

export async function lockForScoring(tx: Tx, gameId: string, enrollmentId: string) {
  const game = await one<GameRow>(tx, 'SELECT * FROM game WHERE id=$1 FOR SHARE', [gameId]);
  const sprint = game!.current_sprint ? await one<SprintRow>(tx, 'SELECT * FROM sprint WHERE game_id=$1 AND number=$2 FOR SHARE', [gameId, game!.current_sprint]) : undefined;
  const enr = await one<EnrollmentRow>(tx, 'SELECT * FROM game_enrollment WHERE id=$1 FOR UPDATE', [enrollmentId]);
  const now = new Date((await one<{ t: Date }>(tx, 'SELECT clock_timestamp() AS t'))!.t).getTime();
  return { game: game!, sprint, enr: enr!, now };
}

/** Re-checks, under locks, everything that may have changed since the request started. */
export async function assertCanScore(tx: Tx, game: GameRow, sprint: SprintRow | undefined, enr: EnrollmentRow, now: number) {
  if (game.phase === 'PAUSED') throw new AppError('SPRINT_PAUSED', 'The commander paused the sprint. Hold position.');
  if (game.phase !== 'RUNNING' || !sprint || sprint.status !== 'RUNNING') throw new AppError('SPRINT_NOT_RUNNING', 'No sprint is running. Return to the lobby.');
  if (!sprint.deadline_at || now >= new Date(sprint.deadline_at).getTime()) throw new AppError('SPRINT_CLOSED', 'Time is up. The sprint has closed.');
  if (enr.status === 'ELIMINATED') throw new AppError('TEAM_ELIMINATED', 'Your crew was ejected from this game.');
  if (enr.status === 'DISQUALIFIED') throw new AppError('TEAM_DISQUALIFIED', 'Your crew has been disqualified from this game.');
  const ok = await one<{ ok: boolean }>(
    tx,
    `SELECT (COALESCE(e.active,false) AND t.status='ACTIVE'
             AND NOT EXISTS (SELECT 1 FROM disqualification d WHERE d.team_id=t.id AND d.revoked_at IS NULL AND (d.scope='EVENT' OR d.game_id=$3))) AS ok
       FROM team t LEFT JOIN team_day_eligibility e ON e.team_id=t.id AND e.day_id=$2 WHERE t.id=$1`,
    [enr.team_id, game.day_id, game.id],
  );
  if (!ok?.ok) throw new AppError('NOT_ACTIVATED_FOR_DAY', 'Your crew is not activated for this day. Contact the organizers.');
}

// ---------------------------------------------------------------------------
// Submit (regular task) — first correct committed solve wins
// ---------------------------------------------------------------------------

export async function submitTask(db: Db, cfg: AppConfig, ctx: CompetitorContext, sessionId: string, taskId: string, generation: number, body: SubmissionPayload, idemKey: string) {
  const prior = await peekIdempotency(db, `enr:${ctx.enrollment.id}`, `submit:${taskId}`, idemKey);
  if (prior) return prior as Record<string, unknown>;
  const { t, pv, s } = await loadTask(db, taskId);
  if (t.game_id !== ctx.game.id) throw new AppError('NOT_FOUND', 'Task not found.');
  if (taskWindow(t, s, Date.now()) === 'LOCKED') throw new AppError('TASK_NOT_RELEASED', 'This system is still locked.');
  if (t.status === 'SOLVED') throw new AppError('TASK_ALREADY_SOLVED', 'This problem has already been solved by another crew. Move on to the next task.');
  const payload = validateSubmissionPayload(pv, body);
  // Grade outside the transaction (runner calls can take seconds); the decision is re-validated under locks.
  const graded = await gradeSubmission(cfg, pv, payload);
  return withTx(db, async (tx) => {
    const idem = await claimIdempotency(tx, `enr:${ctx.enrollment.id}`, `submit:${taskId}`, idemKey, { generation, payloadHash: graded.payloadHash });
    if (idem.existing) return idem.existing as Record<string, unknown>;
    const { game, sprint, enr, now } = await lockForScoring(tx, ctx.game.id, ctx.enrollment.id);
    await assertCanScore(tx, game, sprint, enr, now);
    if (game.imposter_blocks_regular && enr.active_reservation_id) throw new AppError('IMPOSTER_MODE_ACTIVE', 'Your crew is on an imposter protocol. Finish or abandon it before repairing regular systems.');
    const task = (await one<TaskInstanceRow>(tx, 'SELECT * FROM task_instance WHERE id=$1 FOR UPDATE', [taskId]))!;
    if (task.sprint_id !== sprint!.id) throw new AppError('TASK_WINDOW_CLOSED', 'This system belongs to a previous sprint.');
    if (task.status === 'DISABLED') throw new AppError('TASK_DISABLED', 'The commander disabled this system.');
    if (task.status === 'SOLVED') throw new AppError('TASK_ALREADY_SOLVED', 'This problem has already been solved by another crew. Move on to the next task.');
    if (task.generation !== generation) throw new AppError('STALE_TASK', 'This system was reset. Reload it before submitting.');
    const w = taskWindow(task, sprint!, now);
    if (w !== 'OPEN') throw new AppError(w === 'LOCKED' ? 'TASK_NOT_RELEASED' : 'TASK_WINDOW_CLOSED', w === 'LOCKED' ? 'This system is still locked.' : 'This system\'s repair window has closed.');
    const sub = await one<{ id: string }>(
      tx,
      `INSERT INTO submission(game_id, enrollment_id, session_id, task_instance_id, generation, kind, payload_hash, code, correct, result_code, judge)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [game.id, enr.id, sessionId, task.id, task.generation, payload.kind, graded.payloadHash, payload.kind === 'CODE' ? JSON.stringify(payload.files) : null,
        graded.correct, graded.correct ? 'CORRECT' : 'INCORRECT', graded.judge ? JSON.stringify(graded.judge) : null],
    );
    let response: Record<string, unknown>;
    if (graded.correct) {
      const award = await one<{ id: string }>(
        tx,
        `INSERT INTO solve_award(task_instance_id, generation, enrollment_id, submission_id, reward) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [task.id, task.generation, enr.id, sub!.id, pv.reward],
      );
      await tx.query(`UPDATE task_instance SET status='SOLVED', solved_by_enrollment_id=$2, solved_at=clock_timestamp(), version=version+1 WHERE id=$1`, [task.id, enr.id]);
      const after = await applyLedger(tx, enr, { kind: 'SOLVE_REWARD', wallet: pv.reward, earned: pv.reward, sourceType: 'solve_award', sourceId: award!.id, reason: `${task.label} repaired` });
      await emit(tx, 'task.solved', [Rooms.game(game.id), Rooms.admin], { gameId: game.id, taskId: task.id, label: task.label, crewId: ctx.team.crew_id, crewName: ctx.team.name, reward: pv.reward });
      await emit(tx, 'standings.updated', [Rooms.game(game.id), Rooms.admin], { gameId: game.id });
      response = { correct: true, result: 'CORRECT', reward: pv.reward, wallet: after.wallet_balance, judge: graded.judge ?? null, message: 'System restored. Bug ejected.' };
    } else {
      response = { correct: false, result: 'INCORRECT', judge: graded.judge ?? null, wallet: enr.wallet_balance, message: 'Bug still detected. The task stays open to every crew.' };
    }
    await idem.save(response);
    return response;
  });
}

// ---------------------------------------------------------------------------
// Paid hints
// ---------------------------------------------------------------------------

export async function purchaseTaskHint(db: Db, ctx: CompetitorContext, taskId: string, idemKey: string) {
  return withTx(db, async (tx) => {
    const idem = await claimIdempotency(tx, `enr:${ctx.enrollment.id}`, `hint:${taskId}`, idemKey, { taskId });
    if (idem.existing) return idem.existing as Record<string, unknown>;
    const { game, sprint, enr, now } = await lockForScoring(tx, ctx.game.id, ctx.enrollment.id);
    const task = await one<TaskInstanceRow>(tx, 'SELECT * FROM task_instance WHERE id=$1 FOR UPDATE', [taskId]);
    if (!task || task.game_id !== game.id) throw new AppError('NOT_FOUND', 'Task not found.');
    const pv = (await one<ProblemVersionRow>(tx, 'SELECT * FROM problem_version WHERE id=$1', [task.problem_version_id]))!;
    // An existing entitlement is returned without charging, even after closure.
    const existing = await one<{ id: string }>(tx, `SELECT id FROM hint_purchase WHERE enrollment_id=$1 AND target_type='TASK' AND target_id=$2 AND problem_version_id=$3`, [enr.id, task.id, task.problem_version_id]);
    if (existing) {
      const r = { hint: pv.hint, cost: pv.hint_cost, charged: false, wallet: enr.wallet_balance };
      await idem.save(r);
      return r;
    }
    await assertCanScore(tx, game, sprint, enr, now);
    if (game.imposter_blocks_regular && enr.active_reservation_id) throw new AppError('IMPOSTER_MODE_ACTIVE', 'Your crew is on an imposter protocol. Regular hints are locked until it ends.');
    if (task.sprint_id !== sprint!.id || taskWindow(task, sprint!, now) !== 'OPEN') throw new AppError('HINT_UNAVAILABLE', 'Hints can only be bought while this system is open.');
    if (task.status !== 'AVAILABLE') throw new AppError('HINT_UNAVAILABLE', task.status === 'SOLVED' ? 'This system was already repaired. No new hints can be bought.' : 'This system is disabled.');
    if (enr.wallet_balance < pv.hint_cost) throw new AppError('INSUFFICIENT_FUNDS', `Not enough IdeaCoins. This hint costs ${pv.hint_cost}.`, { wallet: enr.wallet_balance, cost: pv.hint_cost });
    const hp = await one<{ id: string }>(
      tx,
      `INSERT INTO hint_purchase(game_id, enrollment_id, target_type, target_id, problem_version_id, cost) VALUES ($1,$2,'TASK',$3,$4,$5) RETURNING id`,
      [game.id, enr.id, task.id, task.problem_version_id, pv.hint_cost],
    );
    let wallet = enr.wallet_balance;
    if (pv.hint_cost > 0) {
      const after = await applyLedger(tx, enr, { kind: 'HINT_PURCHASE', wallet: -pv.hint_cost, spent: pv.hint_cost, sourceType: 'hint_purchase', sourceId: hp!.id, reason: `Hint for ${task.label}` });
      wallet = after.wallet_balance;
      await emit(tx, 'standings.updated', [Rooms.game(game.id), Rooms.admin], { gameId: game.id });
    }
    await emit(tx, 'hint.unlocked', [Rooms.team(ctx.team.id)], { gameId: game.id, targetType: 'TASK', targetId: task.id });
    const r = { hint: pv.hint, cost: pv.hint_cost, charged: true, wallet };
    await idem.save(r);
    return r;
  });
}
