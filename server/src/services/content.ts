import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { DOMAINS } from '../content/index.js';
import type { TaskVariant, Validation } from '../content/types.js';
import { many, one, withTx, type Db, type Queryable, type Tx } from '../db.js';
import { AppError } from '../errors.js';
import { judgeCode } from '../grading/codeJudge.js';
import { normalizeOutput, normalizeTextAnswer, parseNumericAnswer } from '../grading/normalize.js';
import { runnerExecute } from '../grading/runnerClient.js';
import { answerVerifier } from '../security/crypto.js';
import { audit, type Actor } from './audit.js';
import { getEvent } from './context.js';
import { emit, Rooms } from './outbox.js';
import { normHeader, readUpload } from './spreadsheet.js';

export async function upsertDomains(tx: Tx) {
  for (let i = 0; i < DOMAINS.length; i++) {
    const d = DOMAINS[i];
    await tx.query(
      `INSERT INTO domain(slug, name, room, color, symbol, prefix, workspace, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (slug) DO NOTHING`,
      [d.slug, d.name, d.room, d.color, d.symbol, d.prefix, d.workspace, i],
    );
  }
}

/** EXACT_TEXT answers are stored only as a keyed verifier; tests/harness/numeric answers stay server-side. */
export function sealValidation(secret: string, v: Validation): { validation: Record<string, unknown>; verifier: string | null } {
  if (v.mode === 'EXACT_TEXT') {
    const { answer, ...rest } = v;
    return { validation: rest, verifier: answerVerifier(secret, normalizeTextAnswer(answer, v)) };
  }
  return { validation: v as unknown as Record<string, unknown>, verifier: null };
}

export interface NewVersion {
  variant: TaskVariant;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  sourceTemplate?: string;
  sourceSeed?: number;
}

export async function insertVersion(tx: Tx, cfg: AppConfig, questionId: string, versionNo: number, status: 'DRAFT' | 'REVIEWED' | 'PUBLISHED', p: NewVersion, actorId: string | null) {
  const sealed = sealValidation(cfg.gradingSecret, p.variant.validation);
  return (await one<{ id: string }>(
    tx,
    `INSERT INTO question_version(question_id, version_no, status, title, difficulty, statement, workspace, run_language, run_entry, files, sample_stdin,
                                  answer_format, validation, answer_verifier, hint, solution, source_template, source_seed, created_by,
                                  reviewed_at, published_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
             CASE WHEN $3 IN ('REVIEWED','PUBLISHED') THEN now() END, CASE WHEN $3='PUBLISHED' THEN now() END) RETURNING id`,
    [questionId, versionNo, status, p.variant.title, p.difficulty, p.variant.statement, p.variant.workspace, p.variant.runLanguage, p.variant.runEntry ?? null,
      JSON.stringify(p.variant.files), p.variant.sampleStdin ?? null, p.variant.answerFormat, JSON.stringify(sealed.validation), sealed.verifier,
      p.variant.hint, JSON.stringify(p.variant.solution), p.sourceTemplate ?? null, p.sourceSeed ?? null, actorId],
  ))!.id;
}

export async function createQuestion(tx: Tx, cfg: AppConfig, a: { key: string; domainSlug: string; pool: 'REGULAR' | 'BONUS'; isDemo: boolean; status: 'DRAFT' | 'REVIEWED' | 'PUBLISHED'; version: NewVersion; actorId: string | null }) {
  const dom = await one<{ id: string }>(tx, 'SELECT id FROM domain WHERE slug=$1', [a.domainSlug]);
  if (!dom) throw new AppError('VALIDATION_FAILED', `Unknown domain ${a.domainSlug}.`);
  const q = await one<{ id: string }>(tx, `INSERT INTO question(key, domain_id, title, pool, is_demo) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [a.key, dom.id, a.version.variant.title, a.pool, a.isDemo]).catch((err: { code?: string }) => {
    if (err.code === '23505') throw new AppError('CONFLICT', `A question with key ${a.key} already exists.`);
    throw err;
  });
  const versionId = await insertVersion(tx, cfg, q!.id, 1, a.status, a.version, a.actorId);
  return { questionId: q!.id, versionId };
}

// ---------------------------------------------------------------------------
// Authoring schema (also the JSON import schema — see docs/IMPORT_FORMATS.md)
// ---------------------------------------------------------------------------

const fileSchema = z.object({
  name: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/, 'Invalid file name.'),
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
export const questionInputSchema = z
  .object({
    key: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{2,80}$/, 'key: lowercase letters, digits and dashes').optional(),
    domain: z.enum(['web', 'data', 'ds', 'basic', 'design', 'misc']),
    pool: z.enum(['REGULAR', 'BONUS']).default('REGULAR'),
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
    solutionExplanation: z.string().trim().min(10, 'A private walkthrough is required.').max(8000),
    solutionFiles: z.record(z.string()).optional(),
    solutionAnswer: z.string().max(500).optional(),
  })
  .superRefine((p, ctx) => {
    const names = new Set(p.files.map((f) => f.name));
    if (p.runLanguage && (!p.runEntry || !names.has(p.runEntry))) ctx.addIssue({ code: 'custom', path: ['runEntry'], message: 'runEntry must name one of the files when a runtime is set.' });
    if (p.validation.mode === 'CODE_TESTS') {
      const all = new Set([...names, ...(p.validation.harness ?? []).map((h) => h.name)]);
      if (!all.has(p.validation.entry)) ctx.addIssue({ code: 'custom', path: ['validation', 'entry'], message: 'Test entry file not found among files/harness.' });
      if (p.runLanguage !== p.validation.language) ctx.addIssue({ code: 'custom', path: ['runLanguage'], message: 'Runtime must match the test language.' });
    }
    if (p.validation.mode === 'EXACT_TEXT' && !p.validation.answer?.trim()) ctx.addIssue({ code: 'custom', path: ['validation', 'answer'], message: 'Exact-text questions need a secret answer.' });
  });
export type QuestionInput = z.infer<typeof questionInputSchema>;

function toVariant(p: QuestionInput): TaskVariant {
  const v = p.validation;
  return {
    title: p.title, statement: p.statement, workspace: p.workspace, runLanguage: p.runLanguage, runEntry: p.runEntry ?? undefined,
    files: p.files, sampleStdin: p.sampleStdin ?? undefined, answerFormat: p.answerFormat,
    validation: (v.mode === 'EXACT_TEXT' ? { ...v, answer: v.answer ?? '' } : v) as Validation,
    hint: p.hint, solution: { explanation: p.solutionExplanation, files: p.solutionFiles, answer: p.solutionAnswer },
  };
}

export async function adminCreateQuestion(tx: Tx, cfg: AppConfig, actor: Actor, input: unknown) {
  const p = questionInputSchema.parse(input);
  const key = p.key ?? `q-${p.domain}-${Date.now().toString(36)}`;
  const r = await createQuestion(tx, cfg, { key, domainSlug: p.domain, pool: p.pool, isDemo: false, status: 'DRAFT', version: { variant: toVariant(p), difficulty: p.difficulty }, actorId: actor.id });
  await audit(tx, actor, 'question.created', { type: 'question', id: r.questionId }, { key, title: p.title });
  await emit(tx, 'content.changed', [Rooms.organizers], { questionId: r.questionId });
  return r;
}

/** Edits a DRAFT in place. Reviewed / published versions are immutable (create a new draft). */
export async function adminUpdateDraft(tx: Tx, cfg: AppConfig, actor: Actor, versionId: string, input: unknown) {
  const p = questionInputSchema.parse(input);
  const cur = await one<{ status: string; answer_verifier: string | null; question_id: string }>(tx, 'SELECT status, answer_verifier, question_id FROM question_version WHERE id=$1 FOR UPDATE', [versionId]);
  if (!cur) throw new AppError('NOT_FOUND', 'Version not found.');
  if (cur.status !== 'DRAFT') throw new AppError('INVALID_TRANSITION', 'Only drafts can be edited. Create a new draft version.');
  const variant = toVariant(p);
  const sealed = p.validation.mode === 'EXACT_TEXT' && !p.validation.answer?.trim() ? { validation: { ...p.validation, answer: undefined }, verifier: cur.answer_verifier } : sealValidation(cfg.gradingSecret, variant.validation);
  await tx.query(
    `UPDATE question_version SET title=$2, difficulty=$3, statement=$4, workspace=$5, run_language=$6, run_entry=$7, files=$8, sample_stdin=$9,
            answer_format=$10, validation=$11, answer_verifier=$12, hint=$13, solution=$14 WHERE id=$1`,
    [versionId, p.title, p.difficulty, p.statement, p.workspace, p.runLanguage, p.runEntry ?? null, JSON.stringify(p.files), p.sampleStdin ?? null,
      p.answerFormat, JSON.stringify(sealed.validation), sealed.verifier, p.hint, JSON.stringify(variant.solution)],
  );
  await tx.query('UPDATE question SET title=$2, pool=$3 WHERE id=$1', [cur.question_id, p.title, p.pool]);
  await audit(tx, actor, 'question.draft_updated', { type: 'question_version', id: versionId });
  return { versionId };
}

export async function adminNewDraft(tx: Tx, actor: Actor, questionId: string) {
  const latest = await one<{ id: string; version_no: number }>(tx, 'SELECT id, version_no FROM question_version WHERE question_id=$1 ORDER BY version_no DESC LIMIT 1 FOR UPDATE', [questionId]);
  if (!latest) throw new AppError('NOT_FOUND', 'Question not found.');
  const draft = await one<{ id: string }>(tx, `SELECT id FROM question_version WHERE question_id=$1 AND status='DRAFT'`, [questionId]);
  if (draft) return { versionId: draft.id };
  const r = await one<{ id: string }>(
    tx,
    `INSERT INTO question_version(question_id, version_no, status, title, difficulty, statement, workspace, run_language, run_entry, files, sample_stdin,
                                  answer_format, validation, answer_verifier, hint, solution, source_template, source_seed, created_by)
     SELECT question_id, $2, 'DRAFT', title, difficulty, statement, workspace, run_language, run_entry, files, sample_stdin, answer_format, validation,
            answer_verifier, hint, solution, source_template, source_seed, $3 FROM question_version WHERE id=$1 RETURNING id`,
    [latest.id, latest.version_no + 1, actor.id],
  );
  await audit(tx, actor, 'question.version_drafted', { type: 'question', id: questionId }, { versionNo: latest.version_no + 1 });
  return { versionId: r!.id };
}

/** DRAFT → REVIEWED → PUBLISHED. Publishing never happens automatically. */
export async function advanceStatus(tx: Tx, actor: Actor, versionId: string, to: 'REVIEWED' | 'PUBLISHED' | 'ARCHIVED') {
  const cur = await one<{ status: string }>(tx, 'SELECT status FROM question_version WHERE id=$1 FOR UPDATE', [versionId]);
  if (!cur) throw new AppError('NOT_FOUND', 'Version not found.');
  const ok = (cur.status === 'DRAFT' && to === 'REVIEWED') || (cur.status === 'REVIEWED' && to === 'PUBLISHED') || (to === 'ARCHIVED' && cur.status !== 'ARCHIVED');
  if (!ok) throw new AppError('INVALID_TRANSITION', `Cannot move a ${cur.status} version to ${to}. Flow: DRAFT → REVIEWED → PUBLISHED.`);
  await tx.query(
    `UPDATE question_version SET status=$2, reviewed_at=CASE WHEN $2='REVIEWED' THEN now() ELSE reviewed_at END, reviewed_by=CASE WHEN $2='REVIEWED' THEN $3 ELSE reviewed_by END,
            published_at=CASE WHEN $2='PUBLISHED' THEN now() ELSE published_at END WHERE id=$1`,
    [versionId, to, actor.id],
  );
  await audit(tx, actor, `question.${to.toLowerCase()}`, { type: 'question_version', id: versionId });
  await emit(tx, 'content.changed', [Rooms.organizers], { versionId });
  return { versionId, status: to };
}

/** Runs the private solution (and the buggy starter) through the real runner / validator. */
export async function verifyVersion(q: Queryable, cfg: AppConfig, versionId: string) {
  const pv = await one<{ files: TaskVariant['files']; validation: Validation; answer_verifier: string | null; solution: TaskVariant['solution']; run_language: 'javascript' | 'python' | null; run_entry: string | null; sample_stdin: string | null }>(
    q, 'SELECT files, validation, answer_verifier, solution, run_language, run_entry, sample_stdin FROM question_version WHERE id=$1', [versionId],
  );
  if (!pv) throw new AppError('NOT_FOUND', 'Version not found.');
  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  const v = pv.validation;
  checks.push({ name: 'Private walkthrough present', ok: !!pv.solution?.explanation?.trim() });
  if (v.mode === 'CODE_TESTS') {
    const starter = Object.fromEntries(pv.files.map((f) => [f.name, f.content]));
    const bad = await judgeCode(cfg.runner, pv.files, starter, v);
    checks.push({ name: 'Starter fails the hidden tests (bug is observable)', ok: !bad.passed });
    if (pv.solution.files) {
      const good = await judgeCode(cfg.runner, pv.files, { ...starter, ...pv.solution.files }, v);
      checks.push({ name: 'Private solution passes every hidden test', ok: good.passed, detail: good.passed ? `${good.total}/${good.total}` : `fails #${good.firstFailure?.index} (${good.firstFailure?.reason})` });
    } else checks.push({ name: 'Solution files present', ok: false, detail: 'Add solution files.' });
  } else {
    const ans = pv.solution.answer;
    if (v.mode === 'EXACT_TEXT') {
      checks.push({ name: 'Answer verifier stored', ok: !!pv.answer_verifier });
      if (ans) checks.push({ name: 'Walkthrough answer matches the verifier', ok: answerVerifier(cfg.gradingSecret, normalizeTextAnswer(ans, v)) === pv.answer_verifier });
    } else if (v.mode === 'NUMERIC' && ans !== undefined) {
      const n = parseNumericAnswer(ans);
      checks.push({ name: 'Walkthrough answer within tolerance', ok: n !== null && Math.abs(n - v.answer) <= v.tolerance + 1e-9 });
    }
    if (pv.run_language && pv.run_entry && pv.solution.files) {
      const files = { ...Object.fromEntries(pv.files.map((f) => [f.name, f.content])), ...pv.solution.files };
      const r = await runnerExecute(cfg.runner, { language: pv.run_language, files, entry: pv.run_entry, stdin: pv.sample_stdin ?? '' });
      checks.push({ name: 'Fixed program runs', ok: r.exitCode === 0, detail: normalizeOutput(r.stdout).slice(0, 120) || r.stderr.slice(-200) });
    }
  }
  return { ok: checks.every((c) => c.ok), checks };
}

export async function listQuestionsAdmin(q: Queryable) {
  return many(
    q,
    `SELECT q.id, q.key, q.pool, q.title, q.is_demo, q.archived, d.slug AS domain, d.name AS domain_name,
            v.id AS version_id, v.version_no, v.status, v.difficulty, v.workspace, v.run_language, v.validation->>'mode' AS validation_mode,
            (SELECT count(*)::int FROM question_instance qi JOIN question_version v2 ON v2.id=qi.question_version_id WHERE v2.question_id=q.id) AS uses
       FROM question q JOIN domain d ON d.id=q.domain_id
       JOIN LATERAL (SELECT * FROM question_version WHERE question_id=q.id ORDER BY version_no DESC LIMIT 1) v ON true
      ORDER BY q.pool, d.sort, q.key`,
  );
}

export async function getVersion(q: Queryable, versionId: string, includeSolution: boolean) {
  const v = await one<Record<string, unknown>>(q, `SELECT v.*, q.key, q.pool, d.slug AS domain FROM question_version v JOIN question q ON q.id=v.question_id JOIN domain d ON d.id=q.domain_id WHERE v.id=$1`, [versionId]);
  if (!v) throw new AppError('NOT_FOUND', 'Version not found.');
  delete v.answer_verifier;
  if (!includeSolution) {
    delete v.solution;
    const val = v.validation as Record<string, unknown>;
    if (val?.mode === 'CODE_TESTS') v.validation = { ...val, tests: `${(val.tests as unknown[]).length} hidden tests`, harness: val.harness ? 'hidden' : undefined };
    if (val?.mode === 'NUMERIC') v.validation = { ...val, answer: 'hidden' };
  }
  return v;
}

// ---------------------------------------------------------------------------
// Bank import: JSON (rich) or CSV/XLSX (metadata + linked assets). Creates DRAFTS only.
// ---------------------------------------------------------------------------

const CSV_COLS = ['key', 'domain', 'pool', 'difficulty', 'title', 'statement', 'workspace', 'validation_mode', 'answer', 'tolerance', 'case_sensitive', 'answer_format', 'hint', 'solution', 'files', 'run_language', 'run_entry'];
export const QUESTION_CSV_HEADER = CSV_COLS;

function csvRowToInput(cells: Record<string, string>, assets: Record<string, string>): { input?: QuestionInput; errors: string[] } {
  const errors: string[] = [];
  const fileNames = (cells.files ?? '').split(/[;,]/).map((x) => x.trim()).filter(Boolean);
  const files = fileNames.map((name) => {
    if (!(name in assets)) errors.push(`Asset "${name}" is not in the uploaded asset bundle.`);
    const ext = name.split('.').pop()?.toLowerCase();
    const lang = ({ js: 'javascript', py: 'python', html: 'html', css: 'css', csv: 'csv', json: 'json', md: 'markdown' } as Record<string, string>)[ext ?? ''] ?? 'text';
    return { name, language: lang as 'text', content: assets[name] ?? '', readOnly: !['javascript', 'python', 'html', 'css'].includes(lang) };
  });
  const mode = (cells.validation_mode ?? '').toUpperCase();
  if (mode === 'CODE_TESTS') errors.push('CODE_TESTS questions need the JSON format (hidden tests).');
  const validation = mode === 'NUMERIC'
    ? { mode: 'NUMERIC' as const, answer: Number(cells.answer), tolerance: Number(cells.tolerance || 0) }
    : { mode: 'EXACT_TEXT' as const, answer: cells.answer, caseSensitive: /^(1|true|yes)$/i.test(cells.case_sensitive ?? ''), collapseWhitespace: true };
  if (mode === 'NUMERIC' && !Number.isFinite(Number(cells.answer))) errors.push('NUMERIC answer must be a number.');
  if (!cells.answer?.trim()) errors.push('Missing secret answer.');
  const runLanguage = (cells.run_language || '').trim() || null;
  const parsed = questionInputSchema.safeParse({
    key: cells.key || undefined, domain: cells.domain?.toLowerCase(), pool: (cells.pool || 'REGULAR').toUpperCase(), title: cells.title,
    difficulty: cells.difficulty?.toUpperCase(), statement: cells.statement, workspace: (cells.workspace || '').toUpperCase() || 'MISC',
    runLanguage, runEntry: cells.run_entry || null, files, answerFormat: cells.answer_format || 'Type the answer exactly as asked.', validation, hint: cells.hint,
    solutionExplanation: cells.solution, solutionAnswer: cells.answer,
  });
  if (!parsed.success) errors.push(...parsed.error.issues.map((e) => `${e.path.join('.') || 'row'}: ${e.message}`));
  return errors.length ? { errors } : { input: parsed.data!, errors };
}

export async function previewQuestionImport(db: Db, actor: Actor, args: { fileName: string; contentBase64: string; assets?: Record<string, string> }) {
  const ev = await getEvent(db);
  let items: { row: number; input?: QuestionInput; errors: string[] }[] = [];
  if (args.fileName.toLowerCase().endsWith('.json')) {
    const buf = Buffer.from(args.contentBase64, 'base64');
    if (buf.length > 4 * 1024 * 1024) throw new AppError('PAYLOAD_TOO_LARGE', 'JSON bank too large (max 4 MB).');
    let data: unknown;
    try {
      data = JSON.parse(buf.toString('utf8'));
    } catch {
      throw new AppError('IMPORT_INVALID', 'Invalid JSON.');
    }
    const list = Array.isArray(data) ? data : (data as { questions?: unknown[] }).questions;
    if (!Array.isArray(list) || list.length > 1000) throw new AppError('IMPORT_INVALID', 'Expected { "questions": [...] } with at most 1000 items.');
    items = list.map((x, i) => {
      const p = questionInputSchema.safeParse(x);
      return p.success ? { row: i + 1, input: p.data, errors: [] } : { row: i + 1, errors: p.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`) };
    });
  } else {
    const table = await readUpload(args.fileName, args.contentBase64);
    const header = (table[0] ?? []).map(normHeader);
    items = table.slice(1).map((cells, i) => {
      const rec: Record<string, string> = {};
      CSV_COLS.forEach((c) => {
        const idx = header.indexOf(normHeader(c));
        rec[c] = idx >= 0 ? (cells[idx] ?? '').trim() : '';
      });
      return { row: i + 2, ...csvRowToInput(rec, args.assets ?? {}) };
    });
  }
  // Duplicate keys (in file and against the bank) and unknown runtimes are rejected.
  const existing = new Set((await many<{ key: string }>(db, 'SELECT key FROM question')).map((r) => r.key));
  const seen = new Map<string, number>();
  for (const it of items) {
    const k = it.input?.key;
    if (!k) continue;
    if (existing.has(k)) it.errors.push(`Key "${k}" already exists in the bank.`);
    if (seen.has(k)) it.errors.push(`Duplicate key "${k}" (also row ${seen.get(k)}).`);
    seen.set(k, it.row);
  }
  const ok = items.filter((i) => !i.errors.length);
  const dist: Record<string, number> = {};
  for (const i of ok) dist[`${i.input!.domain}:${i.input!.difficulty}:${i.input!.pool}`] = (dist[`${i.input!.domain}:${i.input!.difficulty}:${i.input!.pool}`] ?? 0) + 1;
  const summary = { rows: items.length, valid: ok.length, errors: items.length - ok.length, distribution: dist };
  const b = (await one<{ id: string }>(
    db,
    `INSERT INTO import_batch(event_id, kind, file_name, rows, errors, summary, created_by) VALUES ($1,'QUESTIONS',$2,$3,$4,$5,$6) RETURNING id`,
    [ev.id, args.fileName.slice(0, 200), JSON.stringify(ok.map((i) => i.input)), JSON.stringify(items.filter((i) => i.errors.length).map((i) => ({ row: i.row, errors: i.errors }))), JSON.stringify(summary), actor.id],
  ))!;
  return { batchId: b.id, summary, rows: items.map((i) => ({ row: i.row, key: i.input?.key ?? null, title: i.input?.title ?? null, domain: i.input?.domain ?? null, difficulty: i.input?.difficulty ?? null, pool: i.input?.pool ?? null, errors: i.errors })) };
}

export async function commitQuestionImport(db: Db, cfg: AppConfig, actor: Actor, batchId: string) {
  return withTx(db, async (tx) => {
    const b = await one<{ status: string; rows: QuestionInput[]; errors: unknown[]; result: unknown }>(tx, `SELECT status, rows, errors, result FROM import_batch WHERE id=$1 AND kind='QUESTIONS' FOR UPDATE`, [batchId]);
    if (!b) throw new AppError('NOT_FOUND', 'Import preview not found.');
    if (b.status === 'COMMITTED') return { ...(b.result as object), alreadyCommitted: true };
    if ((b.errors as unknown[]).length) throw new AppError('IMPORT_INVALID', 'Fix the rows with errors and preview again; nothing was imported.');
    let n = 0;
    for (const p of b.rows) {
      const parsed = questionInputSchema.parse(p);
      const key = parsed.key ?? `q-${parsed.domain}-${Date.now().toString(36)}-${n}`;
      await createQuestion(tx, cfg, { key, domainSlug: parsed.domain, pool: parsed.pool, isDemo: false, status: 'DRAFT', version: { variant: toVariant(parsed), difficulty: parsed.difficulty }, actorId: actor.id });
      n++;
    }
    const result = { createdDrafts: n };
    await tx.query(`UPDATE import_batch SET status='COMMITTED', committed_at=now(), result=$2 WHERE id=$1`, [batchId, JSON.stringify(result)]);
    await audit(tx, actor, 'questions.import_committed', { type: 'import_batch', id: batchId }, result);
    await emit(tx, 'content.changed', [Rooms.organizers], result);
    return result;
  });
}
