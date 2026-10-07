import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many } from '../db.js';
import { AppError } from '../errors.js';
import { assertOwnSlot, getAuth, idemKey, requireCrew, type Deps } from '../http.js';
import { getEvent, requireActiveEnrollment } from '../services/context.js';
import { listQuestions, purchaseHint, questionDetail, submit } from '../services/questions.js';
import { eventBoard, publicRow, slotBoard, sprintBoard } from '../services/ranking.js';
import { crewSnapshot } from '../services/snapshot.js';
import { api } from './openapi.js';

const submitSchema = z.object({
  generation: z.number().int().min(1),
  answer: z.string().max(500).optional(),
  files: z.record(z.string().max(200_000)).optional(),
});
const runSchema = z.object({
  files: z.record(z.string().max(200_000)).default({}),
  stdin: z.string().max(20_000).default(''),
  /** Terminal questions: the command line and the session's working directory. */
  command: z.string().max(4000).optional(),
  cwd: z.string().max(500).optional(),
});
const uuid = z.string().uuid();
const slotParam = z.object({ slotId: uuid });
const idParam = z.object({ id: uuid });

export async function crewRoutes(app: FastifyInstance, deps: Deps) {
  const r = api(app);
  const { db, cfg } = deps;

  r.get('/slots/:slotId/state', { summary: 'Authorised snapshot of the crew\'s own slot (HUD, boards, question cards)', tag: 'crew', auth: 'crew' }, async (req) => {
    const { slotId } = slotParam.parse(req.params);
    const { ctx } = await requireCrew(deps, req);
    assertOwnSlot(ctx, slotId);
    return crewSnapshot(db, ctx);
  });

  /** Convenience: the crew's own slot without knowing its id. */
  r.get('/slots/mine/state', { summary: 'Snapshot of the signed-in crew\'s assigned slot', tag: 'crew', auth: 'crew' }, async (req) => {
    const { ctx } = await requireCrew(deps, req);
    return crewSnapshot(db, ctx);
  });

  r.get('/slots/:slotId/questions', { summary: 'Released question cards visible in this sprint', tag: 'crew', auth: 'crew' }, async (req) => {
    const { slotId } = slotParam.parse(req.params);
    const { ctx } = await requireCrew(deps, req);
    assertOwnSlot(ctx, slotId);
    return listQuestions(db, ctx);
  });

  r.get('/question-instances/:id', { summary: 'Question detail (unreleased or other-slot ids are 404)', tag: 'crew', auth: 'crew' }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { ctx } = await requireCrew(deps, req);
    return questionDetail(db, ctx, id);
  });

  r.post('/question-instances/:id/submissions', { summary: 'Submit an answer; first correct in the slot wins', tag: 'crew', auth: 'crew', body: '{ generation, answer? | files? }', idempotent: true }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { auth, ctx } = await requireCrew(deps, req);
    requireActiveEnrollment(ctx);
    deps.limiters.answer.enforce(`enr:${ctx.enrollment.id}`, 'Too many verification attempts. Wait a few seconds before trying again.');
    const body = submitSchema.parse(req.body);
    return submit(db, cfg, ctx, auth.session.id, id, body.generation, body, idemKey(req));
  });

  r.post('/question-instances/:id/hint-purchases', { summary: 'Buy the next (or a given) hint level (wallet only; ranking unaffected under GROSS_EARNED)', tag: 'crew', auth: 'crew', body: '{ level? }', idempotent: true }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { ctx } = await requireCrew(deps, req);
    requireActiveEnrollment(ctx);
    deps.limiters.hint.enforce(`enr:${ctx.enrollment.id}`);
    const body = z.object({ level: z.number().int().min(1).max(10).optional() }).parse(req.body ?? {});
    return purchaseHint(db, ctx, id, idemKey(req), body.level);
  });

  r.post('/question-instances/:id/run-jobs', { summary: 'Run: code in the isolated runner, a terminal command, a SQL query or a JSON check (never scores)', tag: 'crew', auth: 'crew', body: '{ files, stdin, command?, cwd? }' }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { auth, ctx } = await requireCrew(deps, req);
    requireActiveEnrollment(ctx);
    deps.limiters.run.enforce(`enr:${ctx.enrollment.id}`, 'Runner cooling down — too many runs. Wait a few seconds.');
    const body = runSchema.parse(req.body);
    return deps.runs.create(ctx, auth.session.id, id, body.files, body.stdin, { command: body.command, cwd: body.cwd });
  });

  r.get('/run-jobs/:id', { summary: 'Run job status / output', tag: 'crew', auth: 'crew' }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { ctx } = await requireCrew(deps, req);
    return deps.runs.status(ctx, id);
  });

  r.post('/run-jobs/:id/cancel', { summary: 'Cancel a running job', tag: 'crew', auth: 'crew' }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { ctx } = await requireCrew(deps, req);
    return deps.runs.cancel(ctx, id);
  });

  r.get('/teams/me/ledger', { summary: 'The crew\'s own coin ledger', tag: 'crew', auth: 'crew' }, async (req) => {
    const { ctx } = await requireCrew(deps, req);
    const rows = await many(
      db,
      `SELECT l.kind, sp.number AS sprint, l.wallet_delta, l.earned_delta, l.spent_delta, l.score_delta, l.wallet_after, l.reason, l.created_at
         FROM coin_ledger l LEFT JOIN sprint sp ON sp.id=l.sprint_id WHERE l.enrollment_id=$1 ORDER BY l.id DESC LIMIT 300`,
      [ctx.enrollment.id],
    );
    return { wallet: ctx.enrollment.wallet_balance, earned: ctx.enrollment.earned_total, spent: ctx.enrollment.spent_total, entries: rows };
  });

  /**
   * Leaderboards. Crews always get their own slot for sprint / cumulative
   * scopes (a slotId parameter is ignored unless it is theirs); organizers may
   * name any slot. Only public row fields are returned.
   */
  r.get('/leaderboards', { summary: 'Sprint, slot-cumulative or overall (provisional until finalized) standings', tag: 'boards', auth: 'crew', query: 'scope=sprint|cumulative|event, sprint=1..4, slotId (organizers)' }, async (req) => {
    const qs = z.object({ scope: z.enum(['sprint', 'cumulative', 'event']).default('cumulative'), sprint: z.coerce.number().int().min(1).max(4).optional(), slotId: uuid.optional() }).parse(req.query);
    const a = await getAuth(deps, req);
    if (!a) throw new AppError('UNAUTHENTICATED', 'Sign in first.');
    const ev = await getEvent(db);
    const metric = ev.rules.rankingMetric;
    if (qs.scope === 'event') {
      const b = await eventBoard(db, ev.id, metric);
      return { scope: 'event', metric, status: ev.phase === 'FINALIZED' ? 'FINAL' : 'PROVISIONAL', rows: b.active.map(publicRow) };
    }
    let slotId: string;
    let current = 1;
    if (a.organizer) {
      if (!qs.slotId) throw new AppError('VALIDATION_FAILED', 'slotId is required.');
      slotId = qs.slotId;
    } else {
      const { ctx } = await requireCrew(deps, req);
      if (qs.slotId) assertOwnSlot(ctx, qs.slotId);
      slotId = ctx.slot.id;
      current = Math.max(1, ctx.slot.current_sprint);
    }
    if (qs.scope === 'sprint') {
      const n = qs.sprint ?? current;
      const b = await sprintBoard(db, slotId, n, metric);
      return { scope: 'sprint', sprint: n, metric, rows: b.active.map(publicRow) };
    }
    const b = await slotBoard(db, slotId, metric);
    return { scope: 'cumulative', metric, rows: b.active.map(publicRow), inactive: b.inactive.map(publicRow) };
  });
}
