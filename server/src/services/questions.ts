import { createHmac } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { HintLevel, Runtime, StarterFile, Validation } from '../content/types.js';
import { many, one, withTx, type Db, type Queryable, type Tx } from '../db.js';
import { AppError } from '../errors.js';
import { judgeCode, type JudgeOutcome } from '../grading/codeJudge.js';
import { normalizeTextAnswer, parseNumericAnswer } from '../grading/normalize.js';
import { RunnerError } from '../grading/runnerClient.js';
import { answerVerifier, safeEqualHex, sha256 } from '../security/crypto.js';
import type { CrewContext, EnrollmentRow, SlotRow, SprintRow } from './context.js';
import { claimIdempotency, peekIdempotency } from './idempotency.js';
import { emit, Rooms } from './outbox.js';
import { applyLedger } from './wallet.js';

export interface InstanceRow {
  id: string;
  slot_id: string;
  release_id: string;
  question_version_id: string;
  domain_id: string;
  kind: 'INITIAL' | 'RESERVE' | 'BONUS';
  label: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  reward: number;
  hint_cost: number;
  generation: number;
  status: 'AVAILABLE' | 'SOLVED' | 'EXPIRED' | 'DISABLED';
  expires_with_sprint_id: string | null;
  solved_by_enrollment_id: string | null;
  solved_at: Date | null;
  solved_sprint_id: string | null;
  version: number;
}

export interface VersionRow {
  id: string;
  question_id: string;
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
  /** SERVER-ONLY run context (hidden setup / checks / filesystem / tables / expected state). */
  runtime: Runtime | null;
  /** Visible evidence board. */
  board: { type: string; content: string } | null;
  /** Paid hint ladder (server-only until bought). */
  hints: HintLevel[] | null;
  solution: { explanation: string; files?: Record<string, string>; answer?: string };
}

export interface QuestionCard {
  id: string;
  label: string;
  kind: InstanceRow['kind'];
  domain: string;
  difficulty: string;
  reward: number;
  hintCost: number;
  state: 'AVAILABLE' | 'SOLVED_BY_YOU' | 'SOLVED' | 'EXPIRED' | 'DISABLED';
  title: string;
  solvedByCrew: string | null;
  generation: number;
  hintUnlocked: boolean;
}

export type CardRow = InstanceRow & { domain_slug: string; title: string; solver_crew: string | null; solver_name: string | null; release_status: string };

/**
 * Released instances visible to the slot right now: the current sprint's fresh
 * releases plus any carry-over pool (expires_with_sprint_id IS NULL). Unreleased
 * instances are never listed, so nothing about them can be prefetched.
 */
export async function visibleRows(q: Queryable, slot: SlotRow): Promise<CardRow[]> {
  const cur = slot.current_sprint
    ? await one<{ id: string }>(q, 'SELECT id FROM sprint WHERE slot_id=$1 AND number=$2', [slot.id, slot.current_sprint])
    : undefined;
  return many<CardRow>(
    q,
    `SELECT qi.*, d.slug AS domain_slug, qv.title, t.crew_id AS solver_crew, t.name AS solver_name, r.status AS release_status
       FROM question_instance qi
       JOIN release r ON r.id=qi.release_id
       JOIN domain d ON d.id=qi.domain_id
       JOIN question_version qv ON qv.id=qi.question_version_id
       LEFT JOIN slot_enrollment se ON se.id=qi.solved_by_enrollment_id
       LEFT JOIN team t ON t.id=se.team_id
      WHERE qi.slot_id=$1 AND r.status='RELEASED'
        AND (qi.expires_with_sprint_id IS NULL OR qi.expires_with_sprint_id = $2)
      ORDER BY d.sort, qi.kind, qi.label`,
    [slot.id, cur?.id ?? null],
  );
}

export async function hintInstanceIds(q: Queryable, enrollmentId: string): Promise<Set<string>> {
  const rows = await many<{ instance_id: string }>(q, 'SELECT instance_id FROM hint_purchase WHERE enrollment_id=$1', [enrollmentId]);
  return new Set(rows.map((r) => r.instance_id));
}

export function toCards(rows: CardRow[], enrollmentId: string, hints: Set<string>): QuestionCard[] {
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    kind: r.kind,
    domain: r.domain_slug,
    difficulty: r.difficulty,
    reward: r.reward,
    hintCost: r.hint_cost,
    state: r.status === 'SOLVED' ? (r.solved_by_enrollment_id === enrollmentId ? 'SOLVED_BY_YOU' : 'SOLVED') : r.status,
    title: r.title,
    solvedByCrew: r.status === 'SOLVED' ? `${r.solver_name} (${r.solver_crew})` : null,
    generation: r.generation,
    hintUnlocked: hints.has(r.id),
  }));
}

export async function listQuestions(q: Queryable, ctx: CrewContext) {
  const [rows, hints] = await Promise.all([visibleRows(q, ctx.slot), hintInstanceIds(q, ctx.enrollment.id)]);
  return toCards(rows, ctx.enrollment.id, hints);
}

async function loadInstance(q: Queryable, id: string) {
  const i = await one<InstanceRow & { release_status: string }>(q, `SELECT qi.*, r.status AS release_status FROM question_instance qi JOIN release r ON r.id=qi.release_id WHERE qi.id=$1`, [id]);
  if (!i) throw new AppError('NOT_FOUND', 'Question not found.');
  const v = (await one<VersionRow>(q, 'SELECT * FROM question_version WHERE id=$1', [i.question_version_id]))!;
  return { i, v };
}

/** Same response for "other slot" and "unreleased": nothing leaks about either. */
function assertVisible(ctx: CrewContext, i: InstanceRow & { release_status: string }, currentSprintId: string | null) {
  if (i.slot_id !== ctx.slot.id || i.release_status !== 'RELEASED') throw new AppError('QUESTION_NOT_RELEASED', 'This question is not available.');
  if (i.expires_with_sprint_id && i.expires_with_sprint_id !== currentSprintId) throw new AppError('QUESTION_NOT_RELEASED', 'This question belongs to another sprint.');
}

async function currentSprint(q: Queryable, slot: SlotRow) {
  return slot.current_sprint ? one<SprintRow>(q, 'SELECT * FROM sprint WHERE slot_id=$1 AND number=$2', [slot.id, slot.current_sprint]) : undefined;
}

/** The question's hint ladder; single-hint questions become a one-level ladder at the instance's hint cost. */
export function hintLadder(v: Pick<VersionRow, 'hint' | 'hints'>, instanceCost: number): HintLevel[] {
  if (v.hints?.length) return v.hints;
  return [{ level: 1, cost: instanceCost, text: v.hint }];
}

function publicValidation(v: Validation) {
  if (v.mode === 'EXACT_TEXT') return { mode: v.mode, caseSensitive: v.caseSensitive, collapseWhitespace: v.collapseWhitespace };
  if (v.mode === 'NUMERIC') return { mode: v.mode, tolerance: v.tolerance };
  return { mode: v.mode, language: v.language, testCount: v.tests.length };
}

/** Statement + starter files. Hint text only after a purchase. Never answers, tests, harness or solution. */
export async function questionDetail(q: Queryable, ctx: CrewContext, id: string) {
  const { i, v } = await loadInstance(q, id);
  const cur = await currentSprint(q, ctx.slot);
  assertVisible(ctx, i, cur?.id ?? null);
  const bought = new Set((await many<{ level: number }>(q, 'SELECT level FROM hint_purchase WHERE enrollment_id=$1 AND instance_id=$2 AND question_version_id=$3', [ctx.enrollment.id, i.id, i.question_version_id])).map((r) => r.level));
  const purchase = bought.has(1);
  const ladder = hintLadder(v, i.hint_cost);
  const domain = await one<{ slug: string; name: string; room: string; color: string; symbol: string }>(q, 'SELECT slug, name, room, color, symbol FROM domain WHERE id=$1', [i.domain_id]);
  const solver = i.solved_by_enrollment_id
    ? await one<{ crew_id: string; name: string }>(q, 'SELECT t.crew_id, t.name FROM slot_enrollment se JOIN team t ON t.id=se.team_id WHERE se.id=$1', [i.solved_by_enrollment_id])
    : undefined;
  return {
    id: i.id,
    kind: i.kind,
    label: i.label,
    generation: i.generation,
    domain,
    title: v.title,
    difficulty: i.difficulty,
    reward: i.reward,
    statement: v.statement,
    workspace: v.workspace,
    runLanguage: v.run_language,
    runEntry: v.run_entry,
    // WEB preview-only files are sent (the sandboxed preview needs them) but flagged hidden; never shown in the editor.
    files: v.files.map((f) => ({ name: f.name, language: f.language, content: f.content, readOnly: !!f.readOnly || !!f.hidden, ...(f.hidden ? { hidden: true } : {}) })),
    board: v.board ?? null,
    runtimeKind: v.runtime?.kind ?? (v.run_language ? 'code' : null),
    terminal: v.runtime?.kind === 'shell' ? { cwd: v.runtime.cwd, user: v.runtime.user ?? 'agent', initialCommand: v.runtime.initialCommand ?? null } : null,
    sampleStdin: v.sample_stdin,
    answerFormat: v.answer_format,
    validation: publicValidation(v.validation),
    status: i.status === 'SOLVED' ? (i.solved_by_enrollment_id === ctx.enrollment.id ? 'SOLVED_BY_YOU' : 'SOLVED') : i.status,
    solvedBy: solver ? `${solver.name} (${solver.crew_id})` : null,
    hint: { cost: ladder[0]?.cost ?? i.hint_cost, unlocked: purchase, text: purchase ? ladder[0]?.text ?? v.hint : null },
    hints: ladder.map((h) => ({ level: h.level, cost: h.cost, unlocked: bought.has(h.level), text: bought.has(h.level) ? h.text : null })),
    sprintDeadlineAt: cur?.deadline_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// Grading (outside DB locks)
// ---------------------------------------------------------------------------

export interface SubmissionPayload {
  answer?: string;
  files?: Record<string, string>;
}

export function validatePayload(v: Pick<VersionRow, 'validation' | 'files'>, body: SubmissionPayload) {
  if (v.validation.mode === 'CODE_TESTS') {
    if (!body.files || typeof body.files !== 'object') throw new AppError('VALIDATION_FAILED', 'Submit your edited files.');
    const editable = new Set(v.files.filter((f) => !f.readOnly).map((f) => f.name));
    let size = 0;
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(body.files)) {
      if (!editable.has(k)) continue;
      if (typeof val !== 'string') throw new AppError('VALIDATION_FAILED', `File ${k} must be text.`);
      size += val.length;
      out[k] = val;
    }
    if (size > 200_000) throw new AppError('PAYLOAD_TOO_LARGE', 'Submitted code is too large.');
    return { kind: 'CODE' as const, files: out };
  }
  if (typeof body.answer !== 'string' || !body.answer.trim()) throw new AppError('VALIDATION_FAILED', 'Enter an answer.');
  if (body.answer.length > 500) throw new AppError('VALIDATION_FAILED', 'Answer is too long.');
  return { kind: 'ANSWER' as const, answer: body.answer };
}

export async function grade(cfg: AppConfig, v: Pick<VersionRow, 'validation' | 'files' | 'answer_verifier'>, payload: ReturnType<typeof validatePayload>): Promise<{ correct: boolean; judge?: JudgeOutcome; payloadHash: string }> {
  const val = v.validation;
  if (payload.kind === 'CODE') {
    if (val.mode !== 'CODE_TESTS') throw new AppError('VALIDATION_FAILED', 'This question expects a typed answer.');
    try {
      const judge = await judgeCode(cfg.runner, v.files, payload.files, val);
      return { correct: judge.passed, judge, payloadHash: sha256(JSON.stringify(payload.files)) };
    } catch (err) {
      if (err instanceof RunnerError) throw new AppError(err.code === 'RUNNER_BUSY' ? 'RUNNER_BUSY' : err.code === 'RUNTIME_UNAVAILABLE' ? 'RUNTIME_UNAVAILABLE' : 'RUNNER_UNAVAILABLE', err.message);
      throw err;
    }
  }
  // Keyed hash of the submitted text: raw low-entropy answers are never stored or logged.
  const payloadHash = createHmac('sha256', cfg.gradingSecret).update(`submitted:${payload.answer.trim()}`).digest('hex');
  if (val.mode === 'EXACT_TEXT') {
    const norm = normalizeTextAnswer(payload.answer, { caseSensitive: val.caseSensitive, collapseWhitespace: val.collapseWhitespace, flag: val.flag });
    return { correct: !!v.answer_verifier && safeEqualHex(answerVerifier(cfg.gradingSecret, norm), v.answer_verifier), payloadHash };
  }
  if (val.mode === 'NUMERIC') {
    const n = parseNumericAnswer(payload.answer);
    return { correct: n !== null && Math.abs(n - val.answer) <= val.tolerance + 1e-9, payloadHash };
  }
  throw new AppError('VALIDATION_FAILED', 'This question expects code, not a typed answer.');
}

// ---------------------------------------------------------------------------
// Locks — consistent order: slot → sprint → enrollment → question instance
// ---------------------------------------------------------------------------

export async function lockForScoring(tx: Tx, slotId: string, enrollmentId: string) {
  const slot = (await one<SlotRow>(tx, 'SELECT * FROM slot WHERE id=$1 FOR SHARE', [slotId]))!;
  const sprint = slot.current_sprint ? await one<SprintRow>(tx, 'SELECT * FROM sprint WHERE slot_id=$1 AND number=$2 FOR SHARE', [slotId, slot.current_sprint]) : undefined;
  const enr = (await one<EnrollmentRow>(tx, 'SELECT * FROM slot_enrollment WHERE id=$1 FOR UPDATE', [enrollmentId]))!;
  const now = new Date((await one<{ t: Date }>(tx, 'SELECT clock_timestamp() AS t'))!.t).getTime();
  return { slot, sprint, enr, now };
}

/** Re-checks, under locks and with fresh DB time, everything that may have changed since the request began. */
export async function assertCanScore(tx: Tx, slot: SlotRow, sprint: SprintRow | undefined, enr: EnrollmentRow, now: number) {
  if (sprint?.status === 'PAUSED') throw new AppError('SPRINT_PAUSED', 'The organizers paused the sprint. Hold position.');
  if (slot.phase !== 'RUNNING' || !sprint || sprint.status !== 'RUNNING') throw new AppError('SPRINT_NOT_RUNNING', 'No sprint is running in your slot.');
  if (!sprint.deadline_at || now >= new Date(sprint.deadline_at).getTime()) throw new AppError('SPRINT_CLOSED', 'Time is up. The sprint has closed.');
  if (enr.status === 'ELIMINATED') throw new AppError('TEAM_ELIMINATED', 'Your crew was eliminated.');
  if (enr.status === 'DISQUALIFIED') throw new AppError('TEAM_DISQUALIFIED', 'Your crew has been disqualified.');
  const ok = await one<{ ok: boolean }>(
    tx,
    `SELECT (t.account_enabled AND t.status='ACTIVE' AND NOT EXISTS (SELECT 1 FROM disqualification d WHERE d.team_id=t.id AND d.revoked_at IS NULL)) AS ok
       FROM team t WHERE t.id=$1`,
    [enr.team_id],
  );
  if (!ok?.ok) throw new AppError('ACCOUNT_DISABLED', 'Your crew can no longer compete. Contact the organizers.');
}

function assertInstanceOpen(i: InstanceRow & { release_status: string }, sprint: SprintRow, generation?: number) {
  if (i.release_status !== 'RELEASED') throw new AppError('QUESTION_NOT_RELEASED', 'This question is not available.');
  if (i.status === 'SOLVED') throw new AppError('QUESTION_ALREADY_SOLVED', 'This problem has already been solved by another crew. Move on to the next task.');
  if (i.status === 'DISABLED') throw new AppError('QUESTION_DISABLED', 'The organizers disabled this question.');
  if (i.status === 'EXPIRED' || (i.expires_with_sprint_id && i.expires_with_sprint_id !== sprint.id)) throw new AppError('QUESTION_EXPIRED', 'This question expired with its sprint.');
  if (generation !== undefined && i.generation !== generation) throw new AppError('STALE_QUESTION', 'This question was reset. Reload it before submitting.');
}

// ---------------------------------------------------------------------------
// Submit — the first correct committed submission in the slot wins
// ---------------------------------------------------------------------------

export async function submit(db: Db, cfg: AppConfig, ctx: CrewContext, sessionId: string, instanceId: string, generation: number, body: SubmissionPayload, idemKey: string) {
  const actor = `enr:${ctx.enrollment.id}`;
  const fp = { generation, answer: body.answer ?? null, files: body.files ?? null };
  const prior = await peekIdempotency(db, actor, `submit:${instanceId}`, idemKey, fp);
  if (prior) return prior as Record<string, unknown>;
  const { i, v } = await loadInstance(db, instanceId);
  const cur = await currentSprint(db, ctx.slot);
  assertVisible(ctx, i, cur?.id ?? null);
  if (i.status === 'SOLVED') throw new AppError('QUESTION_ALREADY_SOLVED', 'This problem has already been solved by another crew. Move on to the next task.');
  const payload = validatePayload(v, body);
  // Judge outside the transaction (runner calls can take seconds); the decision is re-validated under locks.
  const graded = await grade(cfg, v, payload);
  return withTx(db, async (tx) => {
    const idem = await claimIdempotency(tx, actor, `submit:${instanceId}`, idemKey, fp);
    if (idem.existing) return idem.existing as Record<string, unknown>;
    const { slot, sprint, enr, now } = await lockForScoring(tx, ctx.slot.id, ctx.enrollment.id);
    await assertCanScore(tx, slot, sprint, enr, now);
    const inst = (await one<InstanceRow & { release_status: string }>(tx, `SELECT qi.*, r.status AS release_status FROM question_instance qi JOIN release r ON r.id=qi.release_id WHERE qi.id=$1 FOR UPDATE OF qi`, [instanceId]))!;
    if (inst.slot_id !== slot.id) throw new AppError('QUESTION_NOT_RELEASED', 'This question is not available.');
    assertInstanceOpen(inst, sprint!, generation);
    const sub = await one<{ id: string }>(
      tx,
      `INSERT INTO submission(slot_id, sprint_id, enrollment_id, session_id, instance_id, generation, kind, payload_hash, code, correct, result_code, judge)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [slot.id, sprint!.id, enr.id, sessionId, inst.id, inst.generation, payload.kind, graded.payloadHash, payload.kind === 'CODE' ? JSON.stringify(payload.files) : null,
        graded.correct, graded.correct ? 'CORRECT' : 'INCORRECT', graded.judge ? JSON.stringify(graded.judge) : null],
    );
    let response: Record<string, unknown>;
    if (graded.correct) {
      const award = await one<{ id: string }>(
        tx,
        `INSERT INTO solve_award(instance_id, generation, enrollment_id, submission_id, sprint_id, reward) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [inst.id, inst.generation, enr.id, sub!.id, sprint!.id, inst.reward],
      );
      await tx.query(`UPDATE question_instance SET status='SOLVED', solved_by_enrollment_id=$2, solved_at=clock_timestamp(), solved_sprint_id=$3, version=version+1 WHERE id=$1`, [inst.id, enr.id, sprint!.id]);
      const after = await applyLedger(tx, enr, {
        kind: inst.kind === 'BONUS' ? 'BONUS_REWARD' : 'SOLVE_REWARD', sprintId: sprint!.id, wallet: inst.reward, earned: inst.reward,
        sourceType: 'solve_award', sourceId: award!.id, reason: `${inst.label} solved`,
      });
      await emit(tx, 'question.solved', [Rooms.slot(slot.id), Rooms.organizers], { slotId: slot.id, instanceId: inst.id, label: inst.label, kind: inst.kind, crewId: ctx.team.crew_id, crewName: ctx.team.name, reward: inst.reward });
      await emit(tx, 'leaderboard.updated', [Rooms.slot(slot.id), Rooms.organizers, Rooms.display], { slotId: slot.id });
      response = { correct: true, result: 'CORRECT', reward: inst.reward, wallet: after.wallet_balance, judge: graded.judge ?? null, message: 'System restored. Bug ejected.' };
    } else {
      response = { correct: false, result: 'INCORRECT', judge: graded.judge ?? null, wallet: enr.wallet_balance, message: 'Bug still detected. The question stays open to every crew.' };
    }
    await idem.save(response);
    return response;
  });
}

// ---------------------------------------------------------------------------
// Paid hints — one debit, one entitlement, shared by every device of the crew
// ---------------------------------------------------------------------------

/** Buys hint `level` (default: the next unbought one). Levels are bought in order; each is charged once per crew. */
export async function purchaseHint(db: Db, ctx: CrewContext, instanceId: string, idemKey: string, requestedLevel?: number) {
  return withTx(db, async (tx) => {
    const idem = await claimIdempotency(tx, `enr:${ctx.enrollment.id}`, `hint:${instanceId}`, idemKey, { instanceId, level: requestedLevel ?? null });
    if (idem.existing) return idem.existing as Record<string, unknown>;
    const { slot, sprint, enr, now } = await lockForScoring(tx, ctx.slot.id, ctx.enrollment.id);
    const inst = await one<InstanceRow & { release_status: string }>(tx, `SELECT qi.*, r.status AS release_status FROM question_instance qi JOIN release r ON r.id=qi.release_id WHERE qi.id=$1 FOR UPDATE OF qi`, [instanceId]);
    if (!inst || inst.slot_id !== slot.id || inst.release_status !== 'RELEASED') throw new AppError('QUESTION_NOT_RELEASED', 'This question is not available.');
    const v = (await one<VersionRow>(tx, 'SELECT * FROM question_version WHERE id=$1', [inst.question_version_id]))!;
    const ladder = hintLadder(v, inst.hint_cost);
    const bought = new Set((await many<{ level: number }>(tx, 'SELECT level FROM hint_purchase WHERE enrollment_id=$1 AND instance_id=$2 AND question_version_id=$3', [enr.id, inst.id, inst.question_version_id])).map((r) => r.level));
    const level = requestedLevel ?? ladder.find((h) => !bought.has(h.level))?.level ?? ladder[ladder.length - 1].level;
    const h = ladder.find((x) => x.level === level);
    if (!h) throw new AppError('HINT_UNAVAILABLE', 'This hint level does not exist.');
    // Existing entitlement (any device of the crew) → returned free, even after closure.
    if (bought.has(level)) {
      const r = { hint: h.text, level, cost: h.cost, charged: false, wallet: enr.wallet_balance };
      await idem.save(r);
      return r;
    }
    if (ladder.some((x) => x.level < level && !bought.has(x.level))) throw new AppError('HINT_UNAVAILABLE', 'Buy the earlier hint levels first.');
    await assertCanScore(tx, slot, sprint, enr, now);
    if (inst.status === 'SOLVED') throw new AppError('HINT_UNAVAILABLE', 'This question was already solved. No new hints can be bought.');
    assertInstanceOpen(inst, sprint!);
    if (enr.wallet_balance < h.cost) throw new AppError('INSUFFICIENT_FUNDS', `Not enough IdeaCoins. This hint costs ${h.cost}.`, { wallet: enr.wallet_balance, cost: h.cost });
    const hp = await one<{ id: string }>(
      tx,
      `INSERT INTO hint_purchase(slot_id, sprint_id, enrollment_id, instance_id, question_version_id, cost, level) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [slot.id, sprint!.id, enr.id, inst.id, inst.question_version_id, h.cost, level],
    );
    let wallet = enr.wallet_balance;
    if (h.cost > 0) {
      wallet = (await applyLedger(tx, enr, { kind: 'HINT_PURCHASE', sprintId: sprint!.id, wallet: -h.cost, spent: h.cost, sourceType: 'hint_purchase', sourceId: hp!.id, reason: `Hint ${level} for ${inst.label}` })).wallet_balance;
      await emit(tx, 'leaderboard.updated', [Rooms.slot(slot.id), Rooms.organizers, Rooms.display], { slotId: slot.id });
    }
    await emit(tx, 'hint.unlocked', [Rooms.team(ctx.team.id)], { slotId: slot.id, instanceId: inst.id, level });
    const r = { hint: h.text, level, cost: h.cost, charged: true, wallet };
    await idem.save(r);
    return r;
  });
}

/** For the runner: starter files (+ visibility check). */
export async function instanceForRun(q: Queryable, ctx: CrewContext, instanceId: string) {
  const { i, v } = await loadInstance(q, instanceId);
  const cur = await currentSprint(q, ctx.slot);
  assertVisible(ctx, i, cur?.id ?? null);
  return { i, v };
}
