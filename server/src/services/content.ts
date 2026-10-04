import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { DOMAINS } from '../content/index.js';
import type { TaskVariant, Validation } from '../content/types.js';
import { many, one, type Queryable, type Tx } from '../db.js';
import { AppError } from '../errors.js';
import { judgeCode } from '../grading/codeJudge.js';
import { normalizeOutput, normalizeTextAnswer, parseNumericAnswer } from '../grading/normalize.js';
import { runnerExecute } from '../grading/runnerClient.js';
import { answerVerifier } from '../security/crypto.js';
import { audit, type Actor } from './audit.js';
import { emit, Rooms } from './outbox.js';

export const DIFFICULTY_DEFAULTS = {
  EASY: { reward: 150, hintCost: 30 },
  MEDIUM: { reward: 400, hintCost: 80 },
  HARD: { reward: 700, hintCost: 140 },
} as const;

export async function upsertDomains(tx: Tx) {
  for (let i = 0; i < DOMAINS.length; i++) {
    const d = DOMAINS[i];
    await tx.query(
      `INSERT INTO domain(slug, name, room, color, symbol, prefix, workspace, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (slug) DO NOTHING`,
      [d.slug, d.name, d.room, d.color, d.symbol, d.prefix, d.workspace, i],
    );
  }
}

/** Splits authoring validation into what is stored: EXACT_TEXT answers become a keyed verifier only. */
export function sealValidation(secret: string, v: Validation): { validation: Record<string, unknown>; verifier: string | null } {
  if (v.mode === 'EXACT_TEXT') {
    const { answer, ...rest } = v;
    return { validation: rest, verifier: answerVerifier(secret, normalizeTextAnswer(answer, v)) };
  }
  return { validation: v as unknown as Record<string, unknown>, verifier: null };
}

export interface NewProblemVersion {
  variant: TaskVariant;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  reward: number;
  hintCost: number;
  sourceTemplate?: string;
  sourceVariant?: number;
}

export async function insertProblemVersion(tx: Tx, cfg: AppConfig, problemId: string, versionNo: number, status: 'DRAFT' | 'PUBLISHED', p: NewProblemVersion, actorId: string | null) {
  const sealed = sealValidation(cfg.gradingSecret, p.variant.validation);
  return one<{ id: string }>(
    tx,
    `INSERT INTO problem_version(problem_id, version_no, status, title, difficulty, statement, workspace, run_language, run_entry, files, sample_stdin,
                                 answer_format, validation, answer_verifier, hint, solution, reward, hint_cost, source_template, source_variant, created_by, published_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21, CASE WHEN $3='PUBLISHED' THEN now() END) RETURNING id`,
    [problemId, versionNo, status, p.variant.title, p.difficulty, p.variant.statement, p.variant.workspace, p.variant.runLanguage, p.variant.runEntry ?? null,
      JSON.stringify(p.variant.files), p.variant.sampleStdin ?? null, p.variant.answerFormat, JSON.stringify(sealed.validation), sealed.verifier,
      p.variant.hint, JSON.stringify(p.variant.solution), p.reward, p.hintCost, p.sourceTemplate ?? null, p.sourceVariant ?? null, actorId],
  ).then((r) => r!.id);
}

export async function createProblem(tx: Tx, cfg: AppConfig, args: { key: string; domainSlug: string; kind: 'REGULAR' | 'IMPOSTER'; isDemo: boolean; status: 'DRAFT' | 'PUBLISHED'; version: NewProblemVersion; actorId: string | null }) {
  const dom = await one<{ id: string }>(tx, 'SELECT id FROM domain WHERE slug=$1', [args.domainSlug]);
  if (!dom) throw new AppError('VALIDATION_FAILED', `Unknown domain ${args.domainSlug}.`);
  const p = await one<{ id: string }>(
    tx,
    `INSERT INTO problem(key, domain_id, kind, title, is_demo) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [args.key, dom.id, args.kind, args.version.variant.title, args.isDemo],
  ).catch((err: { code?: string }) => {
    if (err.code === '23505') throw new AppError('CONFLICT', `A problem with key ${args.key} already exists.`);
    throw err;
  });
  const versionId = await insertProblemVersion(tx, cfg, p!.id, 1, args.status, args.version, args.actorId);
  return { problemId: p!.id, versionId };
}

// ---------------------------------------------------------------------------
// Admin library
// ---------------------------------------------------------------------------

const fileSchema = z.object({
  name: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/),
  language: z.enum(['javascript', 'python', 'html', 'css', 'text', 'csv', 'json', 'markdown']),
  content: z.string().max(100_000),
  readOnly: z.boolean().optional(),
});
const validationSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('EXACT_TEXT'), answer: z.string().max(500).optional(), caseSensitive: z.boolean(), collapseWhitespace: z.boolean() }),
  z.object({ mode: z.literal('NUMERIC'), answer: z.number().finite(), tolerance: z.number().min(0) }),
  z.object({
    mode: z.literal('CODE_TESTS'),
    language: z.enum(['javascript', 'python']),
    entry: z.string(),
    harness: z.array(z.object({ name: z.string(), content: z.string().max(100_000) })).optional(),
    tests: z.array(z.object({ name: z.string().max(60), stdin: z.string().max(50_000), expected: z.string().max(50_000) })).min(1).max(30),
  }),
]);
export const problemInputSchema = z.object({
  domain: z.enum(['web', 'data', 'ds', 'basic', 'design', 'misc']),
  kind: z.enum(['REGULAR', 'IMPOSTER']).default('REGULAR'),
  title: z.string().trim().min(3).max(120),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
  statement: z.string().trim().min(20).max(20_000),
  workspace: z.enum(['WEB', 'DATA', 'DS', 'BASIC', 'DESIGN', 'MISC']),
  runLanguage: z.enum(['javascript', 'python']).nullable(),
  runEntry: z.string().nullable().optional(),
  files: z.array(fileSchema).max(12),
  sampleStdin: z.string().max(20_000).nullable().optional(),
  answerFormat: z.string().trim().min(5).max(500),
  validation: validationSchema,
  hint: z.string().trim().min(3).max(2000),
  solutionExplanation: z.string().max(5000).default(''),
  solutionFiles: z.record(z.string()).optional(),
  reward: z.number().int().min(0).max(100_000),
  hintCost: z.number().int().min(0).max(100_000),
});
export type ProblemInput = z.infer<typeof problemInputSchema>;

function toVariant(p: ProblemInput, keepVerifier?: string | null): { variant: TaskVariant; existingVerifier?: string | null } {
  const v = p.validation;
  return {
    variant: {
      title: p.title, statement: p.statement, workspace: p.workspace, runLanguage: p.runLanguage, runEntry: p.runEntry ?? undefined,
      files: p.files, sampleStdin: p.sampleStdin ?? undefined, answerFormat: p.answerFormat,
      validation: (v.mode === 'EXACT_TEXT' ? { ...v, answer: v.answer ?? '' } : v) as Validation,
      hint: p.hint, solution: { explanation: p.solutionExplanation, files: p.solutionFiles },
    },
    existingVerifier: keepVerifier,
  };
}

export async function adminCreateProblem(tx: Tx, cfg: AppConfig, actor: Actor, input: unknown) {
  const p = problemInputSchema.parse(input);
  if (p.validation.mode === 'EXACT_TEXT' && !p.validation.answer?.trim()) throw new AppError('VALIDATION_FAILED', 'Exact-text problems need an answer.');
  const key = `custom-${p.domain}-${Date.now().toString(36)}`;
  const { variant } = toVariant(p);
  const r = await createProblem(tx, cfg, { key, domainSlug: p.domain, kind: p.kind, isDemo: false, status: 'DRAFT', version: { variant, difficulty: p.difficulty, reward: p.reward, hintCost: p.hintCost }, actorId: actor.id });
  await audit(tx, actor, 'problem.created', { type: 'problem', id: r.problemId }, { title: p.title });
  await emit(tx, 'content.changed', [Rooms.admin], { problemId: r.problemId });
  return r;
}

/** Edits a DRAFT version in place. Published versions are immutable (create a new draft instead). */
export async function adminUpdateDraft(tx: Tx, cfg: AppConfig, actor: Actor, versionId: string, input: unknown) {
  const p = problemInputSchema.parse(input);
  const cur = await one<{ id: string; status: string; answer_verifier: string | null; problem_id: string }>(tx, 'SELECT id, status, answer_verifier, problem_id FROM problem_version WHERE id=$1 FOR UPDATE', [versionId]);
  if (!cur) throw new AppError('NOT_FOUND', 'Version not found.');
  if (cur.status !== 'DRAFT') throw new AppError('INVALID_TRANSITION', 'Published versions are frozen. Create a new draft version to edit.');
  const { variant } = toVariant(p);
  let verifier: string | null = null;
  let validation: Record<string, unknown>;
  if (p.validation.mode === 'EXACT_TEXT') {
    const { answer, ...rest } = p.validation;
    validation = rest;
    verifier = answer?.trim() ? answerVerifier(cfg.gradingSecret, normalizeTextAnswer(answer, p.validation)) : cur.answer_verifier;
    if (!verifier) throw new AppError('VALIDATION_FAILED', 'Exact-text problems need an answer.');
  } else validation = p.validation as Record<string, unknown>;
  await tx.query(
    `UPDATE problem_version SET title=$2, difficulty=$3, statement=$4, workspace=$5, run_language=$6, run_entry=$7, files=$8, sample_stdin=$9,
            answer_format=$10, validation=$11, answer_verifier=$12, hint=$13, solution=$14, reward=$15, hint_cost=$16 WHERE id=$1`,
    [versionId, p.title, p.difficulty, p.statement, p.workspace, p.runLanguage, p.runEntry ?? null, JSON.stringify(p.files), p.sampleStdin ?? null,
      p.answerFormat, JSON.stringify(validation), verifier, p.hint, JSON.stringify(variant.solution), p.reward, p.hintCost],
  );
  await tx.query('UPDATE problem SET title=$2 WHERE id=$1', [cur.problem_id, p.title]);
  await audit(tx, actor, 'problem.draft_updated', { type: 'problem_version', id: versionId });
  return { versionId };
}

export async function adminNewDraft(tx: Tx, actor: Actor, problemId: string) {
  const latest = await one<{ id: string; version_no: number }>(tx, 'SELECT id, version_no FROM problem_version WHERE problem_id=$1 ORDER BY version_no DESC LIMIT 1 FOR UPDATE', [problemId]);
  if (!latest) throw new AppError('NOT_FOUND', 'Problem not found.');
  const existingDraft = await one<{ id: string }>(tx, `SELECT id FROM problem_version WHERE problem_id=$1 AND status='DRAFT'`, [problemId]);
  if (existingDraft) return { versionId: existingDraft.id };
  const r = await one<{ id: string }>(
    tx,
    `INSERT INTO problem_version(problem_id, version_no, status, title, difficulty, statement, workspace, run_language, run_entry, files, sample_stdin,
                                 answer_format, validation, answer_verifier, hint, solution, reward, hint_cost, source_template, source_variant, created_by)
     SELECT problem_id, $2, 'DRAFT', title, difficulty, statement, workspace, run_language, run_entry, files, sample_stdin, answer_format, validation,
            answer_verifier, hint, solution, reward, hint_cost, source_template, source_variant, $3
       FROM problem_version WHERE id=$1 RETURNING id`,
    [latest.id, latest.version_no + 1, actor.id],
  );
  await audit(tx, actor, 'problem.version_drafted', { type: 'problem', id: problemId }, { versionNo: latest.version_no + 1 });
  return { versionId: r!.id };
}

/** Runs the private solution (and the starter) through the real runner/validator. */
export async function verifyVersion(q: Queryable, cfg: AppConfig, versionId: string) {
  const pv = await one<{ files: TaskVariant['files']; validation: Validation; answer_verifier: string | null; solution: TaskVariant['solution']; run_language: 'javascript' | 'python' | null; run_entry: string | null; sample_stdin: string | null }>(
    q, 'SELECT files, validation, answer_verifier, solution, run_language, run_entry, sample_stdin FROM problem_version WHERE id=$1', [versionId],
  );
  if (!pv) throw new AppError('NOT_FOUND', 'Version not found.');
  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  const v = pv.validation;
  if (v.mode === 'CODE_TESTS') {
    const starter = Object.fromEntries(pv.files.map((f) => [f.name, f.content]));
    const bad = await judgeCode(cfg.runner, pv.files, starter, v);
    checks.push({ name: 'Buggy starter fails hidden tests', ok: !bad.passed, detail: bad.passed ? 'Starter already passes — the bug is not observable.' : `fails test #${bad.firstFailure?.index}` });
    if (pv.solution.files) {
      const good = await judgeCode(cfg.runner, pv.files, { ...starter, ...pv.solution.files }, v);
      checks.push({ name: 'Private solution passes all hidden tests', ok: good.passed, detail: good.passed ? `${good.total}/${good.total}` : `fails #${good.firstFailure?.index} (${good.firstFailure?.reason})` });
    } else checks.push({ name: 'Private solution files present', ok: false, detail: 'Add solution files to verify.' });
  } else {
    const ans = pv.solution.answer;
    if (v.mode === 'EXACT_TEXT') {
      checks.push({ name: 'Answer verifier stored', ok: !!pv.answer_verifier });
      if (ans) checks.push({ name: 'Solution answer matches verifier', ok: answerVerifier(cfg.gradingSecret, normalizeTextAnswer(ans, v)) === pv.answer_verifier });
    } else if (v.mode === 'NUMERIC' && ans !== undefined) {
      const n = parseNumericAnswer(ans);
      checks.push({ name: 'Solution answer within tolerance', ok: n !== null && Math.abs(n - v.answer) <= v.tolerance + 1e-9 });
    }
    if (pv.run_language && pv.run_entry && pv.solution.files) {
      const files = { ...Object.fromEntries(pv.files.map((f) => [f.name, f.content])), ...pv.solution.files };
      const r = await runnerExecute(cfg.runner, { language: pv.run_language, files, entry: pv.run_entry, stdin: pv.sample_stdin ?? '' });
      checks.push({ name: 'Fixed program runs', ok: r.exitCode === 0, detail: normalizeOutput(r.stdout).slice(0, 120) || r.stderr.slice(-200) });
    }
  }
  return { ok: checks.every((c) => c.ok), checks };
}

export async function adminPublish(tx: Tx, cfg: AppConfig, actor: Actor, versionId: string) {
  const cur = await one<{ id: string; status: string; problem_id: string }>(tx, 'SELECT id, status, problem_id FROM problem_version WHERE id=$1 FOR UPDATE', [versionId]);
  if (!cur) throw new AppError('NOT_FOUND', 'Version not found.');
  if (cur.status !== 'DRAFT') throw new AppError('INVALID_TRANSITION', 'Only drafts can be published.');
  void cfg;
  await tx.query(`UPDATE problem_version SET status='PUBLISHED', published_at=now() WHERE id=$1`, [versionId]);
  await audit(tx, actor, 'problem.published', { type: 'problem_version', id: versionId });
  await emit(tx, 'content.changed', [Rooms.admin], { versionId });
  return { versionId, status: 'PUBLISHED' };
}

/** Assign a PUBLISHED version to a sprint as a new task instance (or as an imposter draft). */
export async function assignToSprint(
  tx: Tx,
  actor: Actor,
  args: { versionId: string; gameId: string; sprintNumber: number; releaseOffsetSeconds?: number; closeOffsetSeconds?: number | null; asImposter?: { reward: number; hintCost: number; claimSeconds: number; solveSeconds: number } },
) {
  const pv = await one<{ id: string; status: string; problem_id: string; reward: number; hint_cost: number }>(tx, 'SELECT id, status, problem_id, reward, hint_cost FROM problem_version WHERE id=$1', [args.versionId]);
  if (!pv || pv.status !== 'PUBLISHED') throw new AppError('VALIDATION_FAILED', 'Only published versions can be scheduled.');
  const g = await one<{ id: string; phase: string }>(tx, 'SELECT id, phase FROM game WHERE id=$1 FOR UPDATE', [args.gameId]);
  if (!g) throw new AppError('NOT_FOUND', 'Game not found.');
  const s = await one<{ id: string; status: string }>(tx, 'SELECT id, status FROM sprint WHERE game_id=$1 AND number=$2', [args.gameId, args.sprintNumber]);
  if (!s) throw new AppError('NOT_FOUND', 'Sprint not found.');
  if (s.status !== 'PENDING' && !(s.status === 'PAUSED')) throw new AppError('INVALID_TRANSITION', 'Tasks can be added only to a pending sprint (or a paused one, as an emergency change).');
  const dom = (await one<{ id: string; prefix: string }>(tx, 'SELECT d.id, d.prefix FROM problem p JOIN domain d ON d.id=p.domain_id WHERE p.id=$1', [pv.problem_id]))!;
  if (args.asImposter) {
    const n = await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM imposter_release WHERE game_id=$1`, [args.gameId]);
    const label = `IMPOSTER-${String((n?.n ?? 0) + 1).padStart(2, '0')}`;
    const r = await one<{ id: string }>(
      tx,
      `INSERT INTO imposter_release(game_id, sprint_id, problem_version_id, label, status, reward, hint_cost, claim_seconds, solve_seconds) VALUES ($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8) RETURNING id`,
      [args.gameId, s.id, pv.id, label, args.asImposter.reward, args.asImposter.hintCost, args.asImposter.claimSeconds, args.asImposter.solveSeconds],
    );
    await audit(tx, actor, 'imposter.assigned', { type: 'imposter', id: r!.id }, { versionId: pv.id, sprint: args.sprintNumber });
    return { imposterId: r!.id };
  }
  const n = await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM task_instance WHERE sprint_id=$1 AND domain_id=$2`, [s.id, dom.id]);
  const label = `${dom.prefix}-${String((n?.n ?? 0) + 1).padStart(2, '0')}`;
  const r = await one<{ id: string }>(
    tx,
    `INSERT INTO task_instance(game_id, sprint_id, problem_version_id, domain_id, label, release_offset_seconds, close_offset_seconds) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [args.gameId, s.id, pv.id, dom.id, label, args.releaseOffsetSeconds ?? 0, args.closeOffsetSeconds ?? null],
  );
  await audit(tx, actor, 'task.assigned', { type: 'task_instance', id: r!.id }, { versionId: pv.id, sprint: args.sprintNumber, label });
  return { taskId: r!.id, label };
}

export async function updateInstance(tx: Tx, actor: Actor, taskId: string, patch: { releaseOffsetSeconds?: number; closeOffsetSeconds?: number | null; disabled?: boolean }) {
  const t = await one<{ id: string; status: string; sprint_id: string; game_id: string; label: string }>(tx, 'SELECT id, status, sprint_id, game_id, label FROM task_instance WHERE id=$1', [taskId]);
  if (!t) throw new AppError('NOT_FOUND', 'Task not found.');
  await tx.query('SELECT id FROM game WHERE id=$1 FOR UPDATE', [t.game_id]);
  const s = (await one<{ status: string }>(tx, 'SELECT status FROM sprint WHERE id=$1', [t.sprint_id]))!;
  if ((patch.releaseOffsetSeconds !== undefined || patch.closeOffsetSeconds !== undefined) && !['PENDING', 'PAUSED'].includes(s.status)) {
    throw new AppError('INVALID_TRANSITION', 'Release windows can be changed only before the sprint starts or while it is paused.');
  }
  if (patch.releaseOffsetSeconds !== undefined) {
    if (!Number.isInteger(patch.releaseOffsetSeconds) || patch.releaseOffsetSeconds < 0) throw new AppError('VALIDATION_FAILED', 'Release offset must be >= 0 seconds.');
    await tx.query('UPDATE task_instance SET release_offset_seconds=$2, version=version+1 WHERE id=$1', [taskId, patch.releaseOffsetSeconds]);
  }
  if (patch.closeOffsetSeconds !== undefined) {
    if (patch.closeOffsetSeconds !== null && (!Number.isInteger(patch.closeOffsetSeconds) || patch.closeOffsetSeconds <= 0)) throw new AppError('VALIDATION_FAILED', 'Close offset must be a positive number of seconds.');
    await tx.query('UPDATE task_instance SET close_offset_seconds=$2, version=version+1 WHERE id=$1', [taskId, patch.closeOffsetSeconds]);
  }
  if (patch.disabled !== undefined) {
    if (t.status === 'SOLVED') throw new AppError('INVALID_TRANSITION', 'A solved task cannot be disabled.');
    await tx.query('UPDATE task_instance SET status=$2, version=version+1 WHERE id=$1', [taskId, patch.disabled ? 'DISABLED' : 'AVAILABLE']);
    await emit(tx, 'task.available', [Rooms.game(t.game_id), Rooms.admin], { gameId: t.game_id, taskId, label: t.label, disabled: patch.disabled });
  }
  await audit(tx, actor, 'task.updated', { type: 'task_instance', id: taskId }, patch);
  return { ok: true };
}

export async function listProblems(q: Queryable) {
  return many(
    q,
    `SELECT p.id, p.key, p.kind, p.title, p.is_demo, p.archived, d.slug AS domain, d.name AS domain_name,
            v.id AS version_id, v.version_no, v.status, v.difficulty, v.reward, v.hint_cost, v.workspace, v.run_language,
            v.validation->>'mode' AS validation_mode,
            (SELECT count(*)::int FROM task_instance ti JOIN problem_version pv2 ON pv2.id=ti.problem_version_id WHERE pv2.problem_id=p.id) AS uses,
            (SELECT count(*)::int FROM imposter_release ir JOIN problem_version pv3 ON pv3.id=ir.problem_version_id WHERE pv3.problem_id=p.id) AS imposter_uses
       FROM problem p
       JOIN domain d ON d.id=p.domain_id
       JOIN LATERAL (SELECT * FROM problem_version WHERE problem_id=p.id ORDER BY version_no DESC LIMIT 1) v ON true
      ORDER BY p.kind, d.sort, p.key`,
  );
}

export async function getVersion(q: Queryable, versionId: string, includeSolution: boolean) {
  const v = await one<Record<string, unknown>>(
    q,
    `SELECT v.*, p.key, p.kind, d.slug AS domain FROM problem_version v JOIN problem p ON p.id=v.problem_id JOIN domain d ON d.id=p.domain_id WHERE v.id=$1`,
    [versionId],
  );
  if (!v) throw new AppError('NOT_FOUND', 'Version not found.');
  if (!includeSolution) {
    delete v.solution;
    delete v.answer_verifier;
    const val = v.validation as Record<string, unknown>;
    if (val?.mode === 'CODE_TESTS') v.validation = { ...val, tests: `${(val.tests as unknown[]).length} hidden tests`, harness: val.harness ? 'hidden' : undefined };
    if (val?.mode === 'NUMERIC') v.validation = { ...val, answer: 'hidden' };
  } else delete v.answer_verifier;
  return v;
}
