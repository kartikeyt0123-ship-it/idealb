import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, withTx } from '../db.js';
import { AppError } from '../errors.js';
import { can, requireAdmin, type Deps } from '../http.js';
import * as admin from '../services/admin.js';
import * as content from '../services/content.js';
import { currentDay, getEvent, type GameRow } from '../services/context.js';
import { cancelImposter, rearmImposter, releaseImposter, updateImposterDraft } from '../services/imposter.js';
import * as life from '../services/lifecycle.js';
import { assignZones, computeStandings } from '../services/ranking.js';
import { gameDto, publicStanding, sprintDto } from '../services/snapshot.js';
import { adminCreateTeams, issuePasswordReset, setDayEligibility } from '../services/teams.js';
import { adminAdjust } from '../services/wallet.js';
import { emit, Rooms } from '../services/outbox.js';

const uuid = z.string().uuid();
const idParam = z.object({ id: uuid });
const versioned = z.object({ expectedVersion: z.number().int().optional() });

export async function adminRoutes(app: FastifyInstance, deps: Deps) {
  const { db, cfg } = deps;

  app.get('/api/admin/overview', async (req) => {
    const { auth, role } = await requireAdmin(deps, req, 'crews.read');
    return { ...(await admin.overview(db)), me: { name: auth.admin!.display_name, role, email: auth.admin!.email } };
  });

  /** Public ship view for a commander walking the ship (no private crew data). */
  app.get('/api/admin/ship-state', async (req) => {
    const { auth } = await requireAdmin(deps, req);
    const ev = await getEvent(db);
    const day = await currentDay(db, ev);
    const g = day ? await one<GameRow>(db, 'SELECT * FROM game WHERE day_id=$1', [day.id]) : undefined;
    const now = Date.now();
    let body: Record<string, unknown> = { game: null };
    if (g) {
      const sprints = await life.getSprints(db, g.id);
      const cur = sprints.find((s) => s.number === Math.max(1, g.current_sprint));
      const { active, inactive } = await computeStandings(db, g);
      const domains = await many(
        db,
        `SELECT d.slug, d.name, d.room, d.color, d.symbol, d.prefix, d.workspace,
                count(ti.id) FILTER (WHERE ti.status='AVAILABLE')::int AS available, count(ti.id)::int AS total, count(ti.id) FILTER (WHERE ti.status='SOLVED')::int AS solved
           FROM domain d LEFT JOIN task_instance ti ON ti.domain_id=d.id AND ti.sprint_id=$1 GROUP BY d.id ORDER BY d.sort`,
        [cur?.id ?? null],
      );
      body = {
        game: gameDto(g),
        sprint: sprintDto(cur, now),
        standings: { active: assignZones(active, ['RUNNING', 'PAUSED'].includes(g.phase) ? cur?.eliminate_count ?? null : null).map(publicStanding), inactive: inactive.map(publicStanding) },
        domains: domains.map((d: Record<string, unknown>) => ({ ...d, counts: { total: d.total, available: d.available, locked: 0, solvedByYou: 0, solvedByOthers: d.solved, closed: 0 } })),
        announcements: await many(db, `SELECT id, message, kind, created_at FROM announcement WHERE game_id=$1 OR game_id IS NULL ORDER BY created_at DESC LIMIT 12`, [g.id]),
      };
    }
    return {
      serverTime: new Date(now).toISOString(),
      identity: { role: 'COMMANDER', name: auth.admin!.display_name, adminRole: auth.admin!.role },
      event: { name: ev.name, isDemo: ev.is_demo },
      day: day ? { number: day.day_number, label: day.label } : null,
      ...body,
    };
  });

  app.patch('/api/admin/event', async (req) => {
    const { actor } = await requireAdmin(deps, req, 'event.config');
    const body = z.object({
      daySelectionMode: z.enum(['AUTO', 'MANUAL']).optional(),
      manualDayNumber: z.number().int().nullable().optional(),
      sessionLimit: z.number().int().optional(),
      sessionLimitPolicy: z.enum(['EVICT_OLDEST', 'REJECT']).optional(),
    }).parse(req.body);
    await withTx(db, (tx) => admin.updateEventConfig(tx, actor, body));
    return admin.overview(db);
  });

  // ---------------- Crews ----------------
  app.get('/api/admin/crews', async (req) => {
    await requireAdmin(deps, req, 'crews.read');
    return admin.crewList(db);
  });

  app.post('/api/admin/crews', async (req, reply) => {
    const { actor } = await requireAdmin(deps, req, 'crews.write');
    const body = z.object({ crews: z.array(z.unknown()).min(1).max(300), via: z.enum(['ADMIN', 'IMPORT']).default('ADMIN') }).parse(req.body);
    reply.code(201);
    return { created: await adminCreateTeams(db, actor, body.crews, body.via), notice: 'Temporary passwords are shown once. Distribute them privately; crews must change them at first sign-in.' };
  });

  app.patch('/api/admin/crews/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireAdmin(deps, req, 'crews.write');
    const body = z.object({ name: z.string().optional(), color: z.string().optional(), status: z.enum(['ACTIVE', 'ARCHIVED']).optional() }).parse(req.body);
    await withTx(db, (tx) => admin.updateTeam(tx, actor, id, body));
    return { ok: true };
  });

  app.post('/api/admin/crews/:id/eligibility', async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireAdmin(deps, req, 'crews.write');
    const body = z.object({ dayNumber: z.number().int().min(1), active: z.boolean() }).parse(req.body);
    await withTx(db, async (tx) => {
      const ev = await getEvent(tx);
      const day = await one<{ id: string }>(tx, 'SELECT id FROM event_day WHERE event_id=$1 AND day_number=$2', [ev.id, body.dayNumber]);
      if (!day) throw new AppError('VALIDATION_FAILED', 'Unknown day.');
      await setDayEligibility(tx, actor, id, day.id, body.active);
    });
    return { ok: true };
  });

  app.post('/api/admin/crews/eligibility/bulk', async (req) => {
    const { actor } = await requireAdmin(deps, req, 'crews.write');
    const body = z.object({ teamIds: z.array(uuid), dayNumber: z.number().int(), active: z.boolean(), apply: z.boolean().default(false) }).parse(req.body);
    return withTx(db, (tx) => admin.bulkEligibility(db, tx, actor, body));
  });

  app.post('/api/admin/crews/:id/check-in', async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireAdmin(deps, req, 'crews.write');
    const body = z.object({ dayNumber: z.number().int(), checkedIn: z.boolean() }).parse(req.body);
    await withTx(db, (tx) => admin.setCheckIn(tx, actor, id, body.dayNumber, body.checkedIn));
    return { ok: true };
  });

  app.post('/api/admin/crews/:id/reset-password', async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireAdmin(deps, req, 'crews.write');
    const r = await issuePasswordReset(db, actor, id);
    return { ...r, notice: 'Give this one-time reset code to the crew captain privately. It expires in 30 minutes; all their devices were signed out.' };
  });

  app.get('/api/admin/crews/:id/sessions', async (req) => {
    const { id } = idParam.parse(req.params);
    await requireAdmin(deps, req, 'crews.read');
    return admin.listSessions(db, id);
  });

  app.delete('/api/admin/sessions/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireAdmin(deps, req, 'crews.write');
    await withTx(db, (tx) => admin.adminRevokeSession(tx, actor, id));
    return { ok: true };
  });

  app.post('/api/admin/crews/:id/disqualify', async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireAdmin(deps, req, 'disqualify');
    const body = z.object({ scope: z.enum(['GAME', 'EVENT']), gameId: uuid.optional(), reason: z.string() }).parse(req.body);
    return withTx(db, (tx) => admin.disqualify(tx, actor, { teamId: id, ...body }));
  });

  app.post('/api/admin/disqualifications/:id/revoke', async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireAdmin(deps, req, 'disqualify');
    const body = z.object({ reason: z.string() }).parse(req.body);
    await withTx(db, (tx) => admin.revokeDisqualification(tx, actor, id, body.reason));
    return { ok: true };
  });

  // ---------------- Game control ----------------
  app.patch('/api/admin/games/:id/config', async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireAdmin(deps, req, 'game.control');
    const body = versioned.extend({
      rankingMetric: z.enum(['NET_COINS', 'GROSS_EARNED']).optional(),
      rankingMetricConfirmed: z.boolean().optional(),
      durationPreset: z.enum(['STANDARD', 'REHEARSAL']).optional(),
      sprintDurations: z.array(z.object({ sprint: z.number().int(), seconds: z.number().int() })).optional(),
      eliminateCounts: z.array(z.object({ sprint: z.number().int(), count: z.number().int().nullable() })).optional(),
      imposterMode: z.enum(['RESERVE', 'OPEN']).optional(),
      imposterBlocksRegular: z.boolean().optional(),
      recycleEliminatedSolves: z.boolean().optional(),
      startingCoins: z.number().int().optional(),
      prizes: z.array(z.object({ place: z.number().int(), label: z.string() })).optional(),
      dayNumber: z.number().int().optional(),
    }).parse(req.body);
    const { expectedVersion, ...patch } = body;
    return withTx(db, (tx) => life.updateGameConfig(tx, actor, id, patch, expectedVersion));
  });

  app.get('/api/admin/games/:id/preflight', async (req) => {
    const { id } = idParam.parse(req.params);
    await requireAdmin(deps, req, 'game.control');
    const q = z.object({ sprint: z.coerce.number().int().min(1).max(2) }).parse(req.query);
    return life.preflight(db, id, q.sprint);
  });

  app.post('/api/admin/games/:id/start-sprint', async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireAdmin(deps, req, 'game.control');
    const body = versioned.extend({ sprint: z.number().int().min(1).max(2), acknowledgeZeroElimination: z.boolean().optional() }).parse(req.body);
    return withTx(db, (tx) => life.startSprint(tx, actor, id, body.sprint, body));
  });

  app.post('/api/admin/games/:id/pause', async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireAdmin(deps, req, 'game.control');
    const body = versioned.parse(req.body ?? {});
    return withTx(db, (tx) => life.pauseSprint(tx, actor, id, body.expectedVersion));
  });

  app.post('/api/admin/games/:id/resume', async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireAdmin(deps, req, 'game.control');
    const body = versioned.parse(req.body ?? {});
    return withTx(db, (tx) => life.resumeSprint(tx, actor, id, body.expectedVersion));
  });

  app.post('/api/admin/games/:id/close-sprint', async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireAdmin(deps, req, 'game.control');
    const body = versioned.extend({ reason: z.string().min(4) }).parse(req.body);
    const r = await withTx(db, (tx) => life.closeSprint(tx, actor, id, 'ADMIN_EARLY', body.expectedVersion));
    return r;
  });

  app.get('/api/admin/games/:id/elimination', async (req) => {
    const { id } = idParam.parse(req.params);
    await requireAdmin(deps, req, 'game.control');
    const r = await life.eliminationReview(db, id);
    return { sprint: r.sprint.number, finalSprint: r.finalSprint, prizePlaces: r.prizePlaces, preview: r.preview, rows: r.rows.map((x) => ({ ...publicStanding(x), enrollmentId: x.enrollmentId })), gameVersion: r.game.version };
  });

  app.post('/api/admin/games/:id/elimination/confirm', async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireAdmin(deps, req, 'game.control');
    const body = versioned.extend({
      resolution: z.object({ mode: z.enum(['RETAIN_TIED', 'ELIMINATE_TIED', 'MANUAL_TIEBREAK']), eliminateEnrollmentIds: z.array(uuid).optional(), note: z.string() }).optional(),
    }).parse(req.body);
    return withTx(db, (tx) => life.confirmElimination(tx, actor, id, body));
  });

  app.get('/api/admin/games/:id/results', async (req) => {
    const { id } = idParam.parse(req.params);
    await requireAdmin(deps, req, 'game.control');
    const r = await life.resultsReview(db, id);
    return { rows: r.rows.map((x) => ({ ...publicStanding(x), enrollmentId: x.enrollmentId })), prizes: r.prizes, conflicts: r.conflicts, gameVersion: r.game.version };
  });

  app.post('/api/admin/games/:id/results/confirm', async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireAdmin(deps, req, 'results.confirm');
    const body = versioned.extend({ resolution: z.object({ mode: z.enum(['SHARE', 'MANUAL_ORDER']), order: z.array(uuid).optional(), note: z.string() }).optional() }).parse(req.body);
    return withTx(db, (tx) => life.confirmResults(tx, actor, id, body));
  });

  app.get('/api/admin/games/:id/tasks', async (req) => {
    const { id } = idParam.parse(req.params);
    await requireAdmin(deps, req, 'crews.read');
    return many(
      db,
      `SELECT ti.id, ti.label, ti.status, ti.generation, ti.release_offset_seconds, ti.close_offset_seconds, ti.solved_at, s.number AS sprint,
              d.slug AS domain, pv.title, pv.difficulty, pv.reward, pv.hint_cost, pv.id AS version_id, p.key AS problem_key,
              t.crew_id AS solved_by_crew, t.name AS solved_by_name,
              (SELECT count(*)::int FROM hint_purchase hp WHERE hp.target_type='TASK' AND hp.target_id=ti.id) AS hints_bought,
              (SELECT count(*)::int FROM submission sb WHERE sb.task_instance_id=ti.id) AS attempts
         FROM task_instance ti JOIN sprint s ON s.id=ti.sprint_id JOIN domain d ON d.id=ti.domain_id
         JOIN problem_version pv ON pv.id=ti.problem_version_id JOIN problem p ON p.id=pv.problem_id
         LEFT JOIN game_enrollment ge ON ge.id=ti.solved_by_enrollment_id LEFT JOIN team t ON t.id=ge.team_id
        WHERE ti.game_id=$1 ORDER BY s.number, d.sort, ti.label`,
      [id],
    );
  });

  app.patch('/api/admin/tasks/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireAdmin(deps, req, 'game.control');
    const body = z.object({ releaseOffsetSeconds: z.number().int().optional(), closeOffsetSeconds: z.number().int().nullable().optional(), disabled: z.boolean().optional() }).parse(req.body);
    return withTx(db, (tx) => content.updateInstance(tx, actor, id, body));
  });

  // ---------------- Imposters ----------------
  app.patch('/api/admin/imposters/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireAdmin(deps, req, 'game.control');
    const body = z.object({ reward: z.number().int().optional(), hintCost: z.number().int().optional(), claimSeconds: z.number().int().optional(), solveSeconds: z.number().int().optional() }).parse(req.body);
    return withTx(db, (tx) => updateImposterDraft(tx, actor, id, body));
  });
  app.post('/api/admin/imposters/:id/release', async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireAdmin(deps, req, 'game.control');
    return withTx(db, (tx) => releaseImposter(tx, actor, id));
  });
  app.post('/api/admin/imposters/:id/cancel', async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireAdmin(deps, req, 'game.control');
    const body = z.object({ reason: z.string().min(4) }).parse(req.body);
    await withTx(db, (tx) => cancelImposter(tx, actor, id, body.reason));
    return { ok: true };
  });
  app.post('/api/admin/imposters/:id/rearm', async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireAdmin(deps, req, 'game.control');
    return withTx(db, (tx) => rearmImposter(tx, actor, id));
  });

  // ---------------- IdeaCoins ----------------
  app.get('/api/admin/games/:id/ledger', async (req) => {
    const { id } = idParam.parse(req.params);
    await requireAdmin(deps, req, 'crews.read');
    const q = z.object({ enrollmentId: uuid.optional() }).parse(req.query);
    return admin.ledger(db, id, q.enrollmentId);
  });
  app.post('/api/admin/enrollments/:id/adjust', async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireAdmin(deps, req, 'coins.adjust');
    const body = z.object({ amount: z.number().int(), target: z.enum(['WALLET', 'SCORE', 'BOTH', 'GRANT']), reason: z.string() }).parse(req.body);
    const r = await withTx(db, async (tx) => {
      const e = await adminAdjust(tx, id, body.amount, body.target, body.reason, actor.id!);
      await tx.query(`INSERT INTO audit_log(actor_type, actor_id, action, target_type, target_id, reason, details) VALUES ('ADMIN',$1,'coins.adjusted','enrollment',$2,$3,$4)`, [actor.id, id, body.reason, JSON.stringify({ amount: body.amount, target: body.target })]);
      await emit(tx, 'standings.updated', [Rooms.game(e.game_id), Rooms.admin], { gameId: e.game_id });
      return e;
    });
    return { wallet: r.wallet_balance, earned: r.earned_total, spent: r.spent_total, scoreAdjust: r.score_adjust };
  });

  // ---------------- Announcements, audit, health, exports ----------------
  app.post('/api/admin/announcements', async (req) => {
    const { actor } = await requireAdmin(deps, req, 'game.control');
    const body = z.object({ gameId: uuid.nullable().optional(), message: z.string(), kind: z.enum(['INFO', 'ALERT']).default('INFO') }).parse(req.body);
    return withTx(db, (tx) => admin.announce(tx, actor, body.gameId ?? null, body.message, body.kind));
  });
  app.get('/api/admin/audit', async (req) => {
    await requireAdmin(deps, req, 'audit.read');
    return admin.auditLog(db);
  });
  app.get('/api/admin/health', async (req) => {
    await requireAdmin(deps, req);
    return admin.health(db, cfg, { sockets: deps.realtime?.socketCount ?? 0, outboxCursor: deps.realtime?.deliveredThrough ?? 0 });
  });
  app.get('/api/admin/export/:kind', async (req, reply) => {
    await requireAdmin(deps, req, 'exports');
    const { kind } = z.object({ kind: z.enum(['standings', 'ledger', 'results', 'crews']) }).parse(req.params);
    const q = z.object({ gameId: uuid.optional() }).parse(req.query);
    const r = await admin.exportCsv(db, kind, q.gameId);
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${r.filename}"`);
    return r.csv;
  });

  // ---------------- Problem library ----------------
  app.get('/api/admin/problems', async (req) => {
    await requireAdmin(deps, req, 'content.read');
    return content.listProblems(db);
  });
  app.get('/api/admin/problem-versions/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const { role } = await requireAdmin(deps, req, 'content.read');
    return content.getVersion(db, id, can(role, 'content.solutions'));
  });
  app.post('/api/admin/problems', async (req, reply) => {
    const { actor } = await requireAdmin(deps, req, 'content.write');
    reply.code(201);
    return withTx(db, (tx) => content.adminCreateProblem(tx, cfg, actor, req.body));
  });
  app.put('/api/admin/problem-versions/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireAdmin(deps, req, 'content.write');
    return withTx(db, (tx) => content.adminUpdateDraft(tx, cfg, actor, id, req.body));
  });
  app.post('/api/admin/problems/:id/new-version', async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireAdmin(deps, req, 'content.write');
    return withTx(db, (tx) => content.adminNewDraft(tx, actor, id));
  });
  app.post('/api/admin/problem-versions/:id/verify', async (req) => {
    const { id } = idParam.parse(req.params);
    await requireAdmin(deps, req, 'content.solutions');
    return content.verifyVersion(db, cfg, id);
  });
  app.post('/api/admin/problem-versions/:id/publish', async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireAdmin(deps, req, 'content.write');
    return withTx(db, (tx) => content.adminPublish(tx, cfg, actor, id));
  });
  app.post('/api/admin/problem-versions/:id/assign', async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireAdmin(deps, req, 'game.control');
    const body = z.object({
      gameId: uuid, sprint: z.number().int().min(1).max(2), releaseOffsetSeconds: z.number().int().min(0).optional(), closeOffsetSeconds: z.number().int().positive().nullable().optional(),
      asImposter: z.object({ reward: z.number().int().min(0), hintCost: z.number().int().min(0), claimSeconds: z.number().int().min(5), solveSeconds: z.number().int().min(15) }).optional(),
    }).parse(req.body);
    return withTx(db, (tx) => content.assignToSprint(tx, actor, { versionId: id, gameId: body.gameId, sprintNumber: body.sprint, releaseOffsetSeconds: body.releaseOffsetSeconds, closeOffsetSeconds: body.closeOffsetSeconds, asImposter: body.asImposter }));
  });
  app.get('/api/admin/problems/export', async (req, reply) => {
    await requireAdmin(deps, req, 'content.solutions');
    const rows = await many(db, `SELECT p.key, p.kind, d.slug AS domain, v.* FROM problem p JOIN domain d ON d.id=p.domain_id JOIN problem_version v ON v.problem_id=p.id ORDER BY p.key, v.version_no`);
    reply.header('content-disposition', 'attachment; filename="problem-library.json"');
    return { exportedAt: new Date().toISOString(), note: 'Contains private solutions and hints. Keep server-side.', problems: rows };
  });
}
