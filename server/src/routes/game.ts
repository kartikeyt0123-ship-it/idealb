import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many } from '../db.js';
import { AppError } from '../errors.js';
import { getAuth, idemKey, requireAdmin, requireCompetitor, type Deps } from '../http.js';
import { requireActiveEnrollment } from '../services/context.js';
import { abandonImposter, imposterDetail, purchaseImposterHint, reserveImposter, submitImposter } from '../services/imposter.js';
import { participantSnapshot } from '../services/snapshot.js';
import { listTasks, purchaseTaskHint, submitTask, taskDetail } from '../services/tasks.js';

const submitSchema = z.object({
  generation: z.number().int().min(1).optional(),
  answer: z.string().max(500).optional(),
  files: z.record(z.string().max(200_000)).optional(),
});
const runSchema = z.object({
  target: z.object({ type: z.enum(['TASK', 'IMPOSTER']), id: z.string().uuid() }),
  files: z.record(z.string().max(200_000)).default({}),
  stdin: z.string().max(20_000).default(''),
});
const idParam = z.object({ id: z.string().uuid() });

export async function gameRoutes(app: FastifyInstance, deps: Deps) {
  app.get('/api/game/state', async (req) => {
    const { ctx } = await requireCompetitor(deps, req);
    return participantSnapshot(deps.db, ctx);
  });

  app.get('/api/game/tasks', async (req) => {
    const { ctx } = await requireCompetitor(deps, req);
    return listTasks(deps.db, ctx);
  });

  app.get('/api/game/tasks/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const { ctx } = await requireCompetitor(deps, req);
    requireActiveEnrollment(ctx);
    return taskDetail(deps.db, ctx, id);
  });

  app.post('/api/game/tasks/:id/submit', async (req) => {
    const { id } = idParam.parse(req.params);
    const { auth, ctx } = await requireCompetitor(deps, req);
    requireActiveEnrollment(ctx);
    deps.limiters.answer.enforce(`enr:${ctx.enrollment.id}`, 'Too many verification attempts. Wait a few seconds before trying again.');
    const body = submitSchema.parse(req.body);
    if (!body.generation) throw new AppError('VALIDATION_FAILED', 'Missing task generation. Reload the task.');
    return submitTask(deps.db, deps.cfg, ctx, auth.session.id, id, body.generation, body, idemKey(req));
  });

  app.post('/api/game/tasks/:id/hint', async (req) => {
    const { id } = idParam.parse(req.params);
    const { ctx } = await requireCompetitor(deps, req);
    requireActiveEnrollment(ctx);
    deps.limiters.hint.enforce(`enr:${ctx.enrollment.id}`);
    return purchaseTaskHint(deps.db, ctx, id, idemKey(req));
  });

  app.post('/api/game/run', async (req) => {
    const { auth, ctx } = await requireCompetitor(deps, req);
    requireActiveEnrollment(ctx);
    deps.limiters.run.enforce(`enr:${ctx.enrollment.id}`, 'Runner cooling down — too many runs. Wait a few seconds.');
    const body = runSchema.parse(req.body);
    return deps.runs.create(ctx, auth.session.id, body.target, body.files, body.stdin);
  });

  app.get('/api/game/run/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const { ctx } = await requireCompetitor(deps, req);
    return deps.runs.status(ctx, id);
  });

  app.post('/api/game/run/:id/cancel', async (req) => {
    const { id } = idParam.parse(req.params);
    const { ctx } = await requireCompetitor(deps, req);
    return deps.runs.cancel(ctx, id);
  });

  app.get('/api/game/imposter/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const { ctx } = await requireCompetitor(deps, req);
    return imposterDetail(deps.db, ctx, id);
  });

  app.post('/api/game/imposter/:id/reserve', async (req) => {
    const { id } = idParam.parse(req.params);
    const { ctx } = await requireCompetitor(deps, req);
    requireActiveEnrollment(ctx);
    deps.limiters.imposter.enforce(`enr:${ctx.enrollment.id}`);
    return reserveImposter(deps.db, ctx, id, idemKey(req));
  });

  app.post('/api/game/imposter/:id/submit', async (req) => {
    const { id } = idParam.parse(req.params);
    const { auth, ctx } = await requireCompetitor(deps, req);
    requireActiveEnrollment(ctx);
    deps.limiters.answer.enforce(`enr:${ctx.enrollment.id}`, 'Too many verification attempts. Wait a few seconds.');
    const body = submitSchema.parse(req.body);
    return submitImposter(deps.db, deps.cfg, ctx, auth.session.id, id, body, idemKey(req));
  });

  app.post('/api/game/imposter/:id/hint', async (req) => {
    const { id } = idParam.parse(req.params);
    const { ctx } = await requireCompetitor(deps, req);
    requireActiveEnrollment(ctx);
    deps.limiters.hint.enforce(`enr:${ctx.enrollment.id}`);
    return purchaseImposterHint(deps.db, ctx, id, idemKey(req));
  });

  app.post('/api/game/imposter/:id/abandon', async (req) => {
    const { id } = idParam.parse(req.params);
    const { ctx } = await requireCompetitor(deps, req);
    return abandonImposter(deps.db, ctx, id);
  });

  app.get('/api/game/wallet', async (req) => {
    const { ctx } = await requireCompetitor(deps, req);
    const rows = await many(
      deps.db,
      `SELECT kind, wallet_delta, earned_delta, spent_delta, score_delta, wallet_after, reason, created_at FROM coin_ledger WHERE enrollment_id=$1 ORDER BY id DESC LIMIT 200`,
      [ctx.enrollment.id],
    );
    return { wallet: ctx.enrollment.wallet_balance, earned: ctx.enrollment.earned_total, spent: ctx.enrollment.spent_total, entries: rows };
  });

  /**
   * Card-swipe authorisation. The card animation is presentation only: this
   * endpoint checks the real server session. A crew session ALWAYS gets 403 and
   * no privileged data is returned.
   */
  app.post('/api/command/authorize', async (req) => {
    const a = await getAuth(deps, req);
    if (!a) throw new AppError('UNAUTHENTICATED', 'Sign in first.');
    const { auth } = await requireAdmin(deps, req);
    return { granted: true, admin: { name: auth.admin!.display_name, role: auth.admin!.role } };
  });
}
