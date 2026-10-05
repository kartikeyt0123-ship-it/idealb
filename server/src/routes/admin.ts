import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, withTx } from '../db.js';
import { AppError } from '../errors.js';
import { expectedVersion, permissionsOf, requireOrganizer, type Deps } from '../http.js';
import * as admin from '../services/admin.js';
import * as content from '../services/content.js';
import { getEvent, getSprints } from '../services/context.js';
import { createDisplayLink, listDisplayLinks, revokeDisplayLink } from '../services/display.js';
import * as life from '../services/lifecycle.js';
import { emit, Rooms } from '../services/outbox.js';
import { buildSlotPlan, cancelRelease, createManualRelease, releaseNow } from '../services/releases.js';
import { RULE_CATALOGUE } from '../services/rules.js';
import { toXlsx } from '../services/spreadsheet.js';
import * as teams from '../services/teams.js';
import { adminAdjust } from '../services/wallet.js';
import { api } from './openapi.js';

const uuid = z.string().uuid();
const idParam = z.object({ id: uuid });
const slotParam = z.object({ slotId: uuid });
const sprintParam = z.object({ slotId: uuid, n: z.coerce.number().int().min(1).max(4) });
const upload = z.object({ fileName: z.string().min(1).max(200), contentBase64: z.string().min(1).max(6_000_000) });
const reasonBody = z.object({ reason: z.string().max(500).default('') });

const TEAM_SAMPLE_ROW = ['Orbit Breakers', '', 'captain@example.test', 'Asha Verma', 'SGSITS Indore', '3', 'CSE', 'S-101', 'Rohit Jain', 'SGSITS Indore', '3', 'CSE', '', 'Meera Iyer', 'SGSITS Indore', '2', 'IT', '', '', '', '', '', '', '1', 'yes', 'no'];

export async function adminRoutes(app: FastifyInstance, deps: Deps) {
  const r = api(app);
  const { db, cfg } = deps;
  const O = 'organizer' as const;

  // ------------------------------------------------------------------ overview / rules
  r.get('/admin/overview', { summary: 'Event, slots, sprints, release plan, preflight and rule review', tag: 'admin', auth: O, permission: 'teams.read' }, async (req) => {
    const { auth, role } = await requireOrganizer(deps, req, 'teams.read');
    return { ...(await admin.overview(db)), me: { name: auth.organizer!.display_name, email: auth.organizer!.email, role, permissions: permissionsOf(role) } };
  });

  r.patch('/admin/event', { summary: 'Edit display name, organizer, edition, venue, prizes', tag: 'rules', auth: O, permission: 'rules.manage', body: '{ name?, organizer?, edition?, venue?, prizes? }' }, async (req) => {
    const { actor } = await requireOrganizer(deps, req, 'rules.manage');
    const body = z.object({ name: z.string().optional(), organizer: z.string().optional(), edition: z.string().optional(), venue: z.string().optional(), prizes: z.array(z.object({ place: z.number().int().min(1), label: z.string().min(1).max(80) })).max(10).optional() }).parse(req.body);
    await withTx(db, (tx) => admin.updateEventInfo(tx, actor, body));
    return { ok: true };
  });

  r.get('/admin/rules', { summary: 'Rule review: every competition default with confirmation state', tag: 'rules', auth: O, permission: 'teams.read' }, async (req) => {
    await requireOrganizer(deps, req, 'teams.read');
    const ev = await getEvent(db);
    return {
      rules: ev.rules, frozenAt: ev.rules_frozen_at, version: ev.version, isDemo: ev.is_demo,
      review: RULE_CATALOGUE.map((c) => ({ key: c.key, title: c.title, fairness: c.fairness, description: c.describe(ev.rules), confirmed: ev.rule_confirmations[c.key] ?? null })),
    };
  });

  r.patch('/admin/rules', { summary: 'Change rules before the first sprint (changed rules lose confirmation)', tag: 'rules', auth: O, permission: 'rules.manage', body: 'Partial<Rules>' }, async (req) => {
    const { actor } = await requireOrganizer(deps, req, 'rules.manage');
    const body = z.record(z.unknown()).parse(req.body);
    return withTx(db, (tx) => admin.updateRules(tx, actor, body as never, expectedVersion(req)));
  });

  r.post('/admin/rules/:key/confirmation', { summary: 'Confirm (or un-confirm) one reviewed rule', tag: 'rules', auth: O, permission: 'rules.manage', body: '{ confirmed }' }, async (req) => {
    const { key } = z.object({ key: z.string().max(40) }).parse(req.params);
    const { actor } = await requireOrganizer(deps, req, 'rules.manage');
    const body = z.object({ confirmed: z.boolean() }).parse(req.body);
    return withTx(db, (tx) => admin.confirmRule(tx, actor, key, body.confirmed));
  });

  // ------------------------------------------------------------------ slots & sprints
  r.patch('/admin/slots/:slotId', { summary: 'Edit slot name, capacity, informational start time, readiness', tag: 'slots', auth: O, permission: 'slots.control' }, async (req) => {
    const { slotId } = slotParam.parse(req.params);
    const { actor } = await requireOrganizer(deps, req, 'slots.control');
    const body = z.object({ name: z.string().max(60).optional(), capacity: z.number().int().optional(), scheduledStartAt: z.string().datetime({ offset: true }).nullable().optional(), phase: z.enum(['CONFIGURING', 'READY', 'WAITING']).optional() }).parse(req.body);
    await withTx(db, (tx) => admin.updateSlot(tx, actor, slotId, body));
    return { ok: true };
  });

  r.post('/admin/slots/:slotId/plan', { summary: 'Build / rebuild the slot release plan from the blueprint (before start only)', tag: 'releases', auth: O, permission: 'releases.manage' }, async (req) => {
    const { slotId } = slotParam.parse(req.params);
    const { actor } = await requireOrganizer(deps, req, 'releases.manage');
    const res = await withTx(db, async (tx) => {
      const out = await buildSlotPlan(tx, actor, slotId);
      await emit(tx, 'slot.updated', [Rooms.organizers], { slotId });
      return out;
    });
    return res;
  });

  r.get('/admin/slots/:slotId/sprints/:n/preflight', { summary: 'Start checklist for a sprint', tag: 'slots', auth: O, permission: 'slots.control' }, async (req) => {
    const { slotId, n } = sprintParam.parse(req.params);
    await requireOrganizer(deps, req, 'slots.control');
    return life.preflight(db, slotId, n);
  });

  r.post('/admin/slots/:slotId/sprints/:n/start', { summary: 'Explicitly start sprint n (never automatic)', tag: 'slots', auth: O, permission: 'slots.control' }, async (req) => {
    const { slotId, n } = sprintParam.parse(req.params);
    const { actor } = await requireOrganizer(deps, req, 'slots.control');
    return withTx(db, (tx) => life.startSprint(tx, actor, slotId, n, { expectedVersion: expectedVersion(req) }));
  });

  r.post('/admin/slots/:slotId/sprints/:n/pause', { summary: 'Pause the running sprint (timer and releases stop)', tag: 'slots', auth: O, permission: 'slots.control' }, async (req) => {
    const { slotId } = sprintParam.parse(req.params);
    const { actor } = await requireOrganizer(deps, req, 'slots.control');
    return withTx(db, (tx) => life.pauseSprint(tx, actor, slotId, expectedVersion(req)));
  });

  r.post('/admin/slots/:slotId/sprints/:n/resume', { summary: 'Resume a paused sprint (deadline shifts by the pause)', tag: 'slots', auth: O, permission: 'slots.control' }, async (req) => {
    const { slotId } = sprintParam.parse(req.params);
    const { actor } = await requireOrganizer(deps, req, 'slots.control');
    return withTx(db, (tx) => life.resumeSprint(tx, actor, slotId, expectedVersion(req)));
  });

  r.post('/admin/slots/:slotId/sprints/:n/close', { summary: 'Close the sprint early (reason required); standings freeze', tag: 'slots', auth: O, permission: 'slots.control', body: '{ note }' }, async (req) => {
    const { slotId } = sprintParam.parse(req.params);
    const { actor } = await requireOrganizer(deps, req, 'slots.control');
    const body = z.object({ note: z.string().max(500).default('') }).parse(req.body ?? {});
    return withTx(db, (tx) => life.closeSprint(tx, actor, slotId, 'ORGANIZER', { expectedVersion: expectedVersion(req), note: body.note }));
  });

  r.get('/admin/slots/:slotId/sprints/:n/elimination-review', { summary: 'Optional elimination preview for a closed sprint', tag: 'slots', auth: O, permission: 'slots.control' }, async (req) => {
    const { slotId, n } = sprintParam.parse(req.params);
    await requireOrganizer(deps, req, 'slots.control');
    const rv = await life.eliminationReview(db, slotId, n);
    return { k: rv.k, enabled: rv.enabled, preview: rv.preview, rows: rv.rows.map((x) => ({ enrollmentId: x.enrollmentId, crewId: x.crewId, name: x.name, cumulative: x.cumulative, rank: x.rank })) };
  });

  r.post('/admin/slots/:slotId/sprints/:n/finalize', { summary: 'Finalize a closed sprint (applies optional elimination)', tag: 'slots', auth: O, permission: 'slots.control', body: '{ resolution? }' }, async (req) => {
    const { slotId, n } = sprintParam.parse(req.params);
    const { actor } = await requireOrganizer(deps, req, 'slots.control');
    const body = z.object({ resolution: z.object({ mode: z.enum(['RETAIN_TIED', 'ELIMINATE_TIED', 'MANUAL_TIEBREAK']), eliminateEnrollmentIds: z.array(uuid).optional(), note: z.string().max(500) }).optional() }).parse(req.body ?? {});
    return withTx(db, (tx) => life.finalizeSprint(tx, actor, slotId, n, { expectedVersion: expectedVersion(req), resolution: body.resolution }));
  });

  const placement = z.object({ resolution: z.object({ mode: z.enum(['SHARE', 'MANUAL_ORDER']), order: z.array(uuid).optional(), note: z.string().max(500) }).optional() });

  r.get('/admin/slots/:slotId/results-review', { summary: 'Slot cumulative results + top-3 tie conflicts', tag: 'results', auth: O, permission: 'results.finalize' }, async (req) => {
    const { slotId } = slotParam.parse(req.params);
    await requireOrganizer(deps, req, 'results.finalize');
    const rv = await life.slotResultsReview(db, slotId);
    return { slot: { id: rv.slot.id, name: rv.slot.name, phase: rv.slot.phase, version: rv.slot.version }, rows: rv.board.active, inactive: rv.board.inactive, conflicts: rv.conflicts };
  });

  r.post('/admin/slots/:slotId/finalize', { summary: 'Freeze the slot result after sprint 4', tag: 'results', auth: O, permission: 'results.finalize', body: '{ resolution? }' }, async (req) => {
    const { slotId } = slotParam.parse(req.params);
    const { actor } = await requireOrganizer(deps, req, 'results.finalize');
    const body = placement.parse(req.body ?? {});
    return withTx(db, (tx) => life.finalizeSlot(tx, actor, slotId, { expectedVersion: expectedVersion(req), resolution: body.resolution }));
  });

  r.get('/admin/event/results-review', { summary: 'Overall results across the four slots', tag: 'results', auth: O, permission: 'results.finalize' }, async (req) => {
    await requireOrganizer(deps, req, 'results.finalize');
    return life.eventResultsReview(db);
  });

  r.post('/admin/event/finalize', { summary: 'Finalize overall results (all slots completed)', tag: 'results', auth: O, permission: 'results.finalize', body: '{ resolution? }' }, async (req) => {
    const { actor } = await requireOrganizer(deps, req, 'results.finalize');
    const body = placement.parse(req.body ?? {});
    return withTx(db, (tx) => life.finalizeEvent(tx, actor, { expectedVersion: expectedVersion(req), resolution: body.resolution }));
  });

  r.get('/admin/slots/:slotId/question-instances', { summary: 'Every instance in the slot plan with solver and status', tag: 'releases', auth: O, permission: 'teams.read' }, async (req) => {
    const { slotId } = slotParam.parse(req.params);
    await requireOrganizer(deps, req, 'teams.read');
    return many(
      db,
      `SELECT qi.id, qi.label, qi.kind, qi.difficulty, qi.reward, qi.hint_cost, qi.status, qi.solved_at, qv.title, d.slug AS domain, r.label AS release, r.status AS release_status, sp.number AS sprint,
              t.crew_id AS solver_crew, t.name AS solver_name
         FROM question_instance qi JOIN question_version qv ON qv.id=qi.question_version_id JOIN domain d ON d.id=qi.domain_id
         JOIN release r ON r.id=qi.release_id LEFT JOIN sprint sp ON sp.id=r.sprint_id
         LEFT JOIN slot_enrollment se ON se.id=qi.solved_by_enrollment_id LEFT JOIN team t ON t.id=se.team_id
        WHERE qi.slot_id=$1 ORDER BY sp.number NULLS FIRST, r.type, qi.label`,
      [slotId],
    );
  });

  // ------------------------------------------------------------------ releases
  r.post('/admin/question-releases/:id/release', { summary: 'Release now (idempotent). Early release of a scheduled batch needs a reason', tag: 'releases', auth: O, permission: 'releases.manage', body: '{ reason? }' }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireOrganizer(deps, req, 'releases.manage');
    const body = reasonBody.parse(req.body ?? {});
    return withTx(db, (tx) => releaseNow(tx, actor, id, { reason: body.reason || undefined }));
  });

  r.post('/admin/question-releases/:id/cancel', { summary: 'Cancel an unreleased release', tag: 'releases', auth: O, permission: 'releases.manage', body: '{ reason }' }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireOrganizer(deps, req, 'releases.manage');
    const body = reasonBody.parse(req.body ?? {});
    await withTx(db, (tx) => cancelRelease(tx, actor, id, body.reason));
    return { ok: true };
  });

  r.post('/admin/question-releases', { summary: 'Manual override release (recorded as a fairness deviation)', tag: 'releases', auth: O, permission: 'releases.manage', body: '{ slotId, sprintNumber, type, versionIds, offsetSeconds, expiresAtSprintEnd, announcement?, reason, releaseImmediately }' }, async (req) => {
    const { actor } = await requireOrganizer(deps, req, 'releases.manage');
    const body = z.object({
      slotId: uuid, sprintNumber: z.number().int().min(1).max(4).nullable(), type: z.enum(['INITIAL', 'RESERVE', 'BONUS']), versionIds: z.array(uuid).min(1).max(60),
      offsetSeconds: z.number().int().min(0).max(4 * 3600).nullable().default(null), expiresAtSprintEnd: z.boolean().default(true), announcement: z.string().max(200).optional(),
      reason: z.string().max(500), releaseImmediately: z.boolean().default(false),
    }).parse(req.body);
    return withTx(db, (tx) => createManualRelease(tx, actor, body));
  });

  // ------------------------------------------------------------------ teams / import / credentials
  r.get('/admin/teams', { summary: 'All crews with slot, credentials, sessions and standing', tag: 'teams', auth: O, permission: 'teams.read' }, async (req) => {
    await requireOrganizer(deps, req, 'teams.read');
    return admin.teamList(db);
  });

  r.post('/admin/teams', { summary: 'Create one crew manually (no credentials are sent)', tag: 'teams', auth: O, permission: 'teams.write', body: 'TeamInput' }, async (req, reply) => {
    const { actor } = await requireOrganizer(deps, req, 'teams.write');
    reply.code(201);
    return teams.createTeam(db, actor, req.body);
  });

  r.patch('/admin/teams/:id', { summary: 'Edit crew, enable/disable, check-in, slot (blocked after scoring)', tag: 'teams', auth: O, permission: 'teams.write', body: 'TeamPatch' }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireOrganizer(deps, req, 'teams.write');
    return teams.updateTeam(db, actor, id, req.body);
  });

  r.post('/admin/teams/bulk-assign', { summary: 'Assign many crews to a slot (preview unless apply=true)', tag: 'teams', auth: O, permission: 'teams.write', body: '{ teamIds, slot, apply }' }, async (req) => {
    const { actor } = await requireOrganizer(deps, req, 'teams.write');
    const body = z.object({ teamIds: z.array(uuid).min(1).max(500), slot: z.number().int().min(1).max(8).nullable(), apply: z.boolean().default(false) }).parse(req.body);
    return teams.bulkAssign(db, actor, body);
  });

  r.get('/admin/teams/import-template', { summary: 'Download the team import template', tag: 'import', auth: O, permission: 'teams.write', query: 'format=csv|xlsx' }, async (req, reply) => {
    await requireOrganizer(deps, req, 'teams.write');
    const { format } = z.object({ format: z.enum(['csv', 'xlsx']).default('csv') }).parse(req.query);
    const header = [...teams.TEAM_TEMPLATE_HEADER];
    if (format === 'xlsx') {
      reply.header('content-disposition', 'attachment; filename="among-bug-teams-template.xlsx"').type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return reply.send(await toXlsx('teams', header, [TEAM_SAMPLE_ROW]));
    }
    reply.header('content-disposition', 'attachment; filename="among-bug-teams-template.csv"').type('text/csv; charset=utf-8');
    return reply.send(admin.toCsv(header, [TEAM_SAMPLE_ROW]));
  });

  r.post('/admin/teams/imports', { summary: 'Upload CSV/XLSX → preview with mapping, row errors, duplicates (writes nothing)', tag: 'import', auth: O, permission: 'teams.write', body: '{ fileName, contentBase64, mapping? }' }, async (req) => {
    const { actor } = await requireOrganizer(deps, req, 'teams.write');
    const body = upload.extend({ mapping: z.record(z.string()).optional() }).parse(req.body);
    return teams.previewTeamImport(db, actor, body as never);
  });

  r.post('/admin/teams/imports/:id/commit', { summary: 'Commit a previewed import (idempotent; never sends credentials)', tag: 'import', auth: O, permission: 'teams.write' }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireOrganizer(deps, req, 'teams.write');
    return teams.commitTeamImport(db, actor, id);
  });

  r.get('/admin/imports/:id', { summary: 'Read an import batch (preview or result)', tag: 'import', auth: O, permission: 'teams.read' }, async (req) => {
    const { id } = idParam.parse(req.params);
    await requireOrganizer(deps, req, 'teams.read');
    const b = await one(db, 'SELECT id, kind, status, file_name, summary, rows, errors, result, created_at, committed_at FROM import_batch WHERE id=$1', [id]);
    if (!b) throw new AppError('NOT_FOUND', 'Import not found.');
    return b;
  });

  r.post('/admin/credential-deliveries/preview', { summary: 'Preview who will receive credentials, and through which channel', tag: 'credentials', auth: O, permission: 'credentials.send', body: '{ teamIds, reason }' }, async (req) => {
    await requireOrganizer(deps, req, 'credentials.send');
    const body = z.object({ teamIds: z.array(uuid).min(1).max(500), reason: z.enum(['INITIAL', 'RESET']).default('INITIAL') }).parse(req.body);
    return teams.previewCredentials(db, cfg, body.teamIds, body.reason);
  });

  r.post('/admin/credential-deliveries', { summary: 'Send credentials (explicit; demo mode captures locally, never delivered externally)', tag: 'credentials', auth: O, permission: 'credentials.send', body: '{ teamIds, reason, confirm: true }' }, async (req) => {
    const { actor } = await requireOrganizer(deps, req, 'credentials.send');
    const body = z.object({ teamIds: z.array(uuid).min(1).max(500), reason: z.enum(['INITIAL', 'RESET']).default('INITIAL'), confirm: z.literal(true) }).parse(req.body);
    return teams.sendCredentials(db, cfg, actor, body.teamIds, body.reason);
  });

  r.get('/admin/credential-deliveries', { summary: 'Delivery log (no passwords)', tag: 'credentials', auth: O, permission: 'teams.read' }, async (req) => {
    await requireOrganizer(deps, req, 'teams.read');
    return many(db, `SELECT cd.id, t.crew_id, cd.channel, cd.recipient, cd.status, cd.error, cd.reason, cd.created_at FROM credential_delivery cd JOIN team t ON t.id=cd.team_id ORDER BY cd.created_at DESC LIMIT 500`);
  });

  r.get('/admin/mail-capture', { summary: 'Demo mail inbox (captured, not delivered externally)', tag: 'credentials', auth: O, permission: 'mail.read' }, async (req) => {
    await requireOrganizer(deps, req, 'mail.read');
    return { note: 'Demo mail, not delivered externally.', messages: await admin.mailOutbox(db) };
  });

  r.get('/admin/teams/:id/sessions', { summary: 'Active devices of a crew', tag: 'teams', auth: O, permission: 'teams.read' }, async (req) => {
    const { id } = idParam.parse(req.params);
    await requireOrganizer(deps, req, 'teams.read');
    return admin.listSessions(db, id);
  });

  r.delete('/admin/sessions/:id', { summary: 'Sign out one device', tag: 'teams', auth: O, permission: 'teams.write' }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireOrganizer(deps, req, 'teams.write');
    await withTx(db, (tx) => admin.adminRevokeSession(tx, actor, id));
    return { ok: true };
  });

  r.post('/admin/teams/:id/disqualify', { summary: 'Disqualify a crew (reason required)', tag: 'teams', auth: O, permission: 'disqualify', body: '{ reason }' }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireOrganizer(deps, req, 'disqualify');
    await withTx(db, (tx) => admin.disqualify(tx, actor, id, reasonBody.parse(req.body).reason));
    return { ok: true };
  });

  r.post('/admin/disqualifications/:id/revoke', { summary: 'Revoke a disqualification (audited correction)', tag: 'teams', auth: O, permission: 'disqualify', body: '{ reason }' }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireOrganizer(deps, req, 'disqualify');
    await withTx(db, (tx) => admin.revokeDisqualification(tx, actor, id, reasonBody.parse(req.body).reason));
    return { ok: true };
  });

  r.post('/admin/enrollments/:id/adjustments', { summary: 'Compensating ledger entry (wallet / score / both / grant)', tag: 'ledger', auth: O, permission: 'coins.adjust', body: '{ amount, target, reason, sprint? }' }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireOrganizer(deps, req, 'coins.adjust');
    const body = z.object({ amount: z.number().int(), target: z.enum(['WALLET', 'SCORE', 'BOTH', 'GRANT']), reason: z.string().max(500), sprint: z.number().int().min(1).max(4).nullable().default(null) }).parse(req.body);
    return withTx(db, async (tx) => {
      const enr = await one<{ slot_id: string; team_id: string }>(tx, 'SELECT slot_id, team_id FROM slot_enrollment WHERE id=$1', [id]);
      if (!enr) throw new AppError('NOT_FOUND', 'Enrollment not found.');
      const sprintId = body.sprint ? (await getSprints(tx, enr.slot_id)).find((s) => s.number === body.sprint)?.id ?? null : null;
      const after = await adminAdjust(tx, id, { amount: body.amount, target: body.target, reason: body.reason, sprintId, actorId: actor.id! });
      await emit(tx, 'wallet.updated', [Rooms.team(enr.team_id)], { wallet: after.wallet_balance });
      await emit(tx, 'leaderboard.updated', [Rooms.slot(enr.slot_id), Rooms.organizers, Rooms.display], { slotId: enr.slot_id });
      return { wallet: after.wallet_balance };
    });
  });

  r.get('/admin/ledger', { summary: 'Slot ledger (optionally one crew)', tag: 'ledger', auth: O, permission: 'audit.read', query: 'slotId, enrollmentId?' }, async (req) => {
    await requireOrganizer(deps, req, 'audit.read');
    const qs = z.object({ slotId: uuid, enrollmentId: uuid.optional() }).parse(req.query);
    return admin.ledger(db, qs.slotId, qs.enrollmentId);
  });

  r.post('/admin/announcements', { summary: 'Announce to one slot or everyone', tag: 'admin', auth: O, permission: 'slots.control', body: '{ slotId|null, message, kind }' }, async (req) => {
    const { actor } = await requireOrganizer(deps, req, 'slots.control');
    const body = z.object({ slotId: uuid.nullable().default(null), message: z.string().max(500), kind: z.enum(['INFO', 'ALERT']).default('INFO') }).parse(req.body);
    return withTx(db, (tx) => admin.announce(tx, actor, body.slotId, body.message, body.kind));
  });

  r.get('/admin/audit', { summary: 'Audit log', tag: 'admin', auth: O, permission: 'audit.read', query: 'limit, offset' }, async (req) => {
    await requireOrganizer(deps, req, 'audit.read');
    const qs = z.object({ limit: z.coerce.number().int().default(200), offset: z.coerce.number().int().default(0) }).parse(req.query);
    return admin.auditLog(db, qs.limit, qs.offset);
  });

  r.get('/admin/health', { summary: 'DB, worker heartbeat, outbox lag, runner, ledger reconciliation, mail mode', tag: 'admin', auth: O, permission: 'audit.read' }, async (req) => {
    await requireOrganizer(deps, req, 'audit.read');
    return admin.health(db, cfg, { sockets: deps.realtime?.socketCount ?? 0, outboxCursor: deps.realtime?.deliveredThrough ?? 0 });
  });

  r.get('/admin/exports/:kind', { summary: 'CSV / XLSX exports (formula-safe, never passwords)', tag: 'exports', auth: O, permission: 'exports', query: 'format=csv|xlsx, slotId, sprint' }, async (req, reply) => {
    const { kind } = z.object({ kind: z.enum(['teams', 'slot-standings', 'sprint-standings', 'overall', 'ledger', 'audit']) }).parse(req.params);
    const { actor } = await requireOrganizer(deps, req, 'exports');
    const qs = z.object({ format: z.enum(['csv', 'xlsx']).default('csv'), slotId: uuid.optional(), sprint: z.coerce.number().int().min(1).max(4).optional() }).parse(req.query);
    const f = await admin.exportFile(db, kind, { slotId: qs.slotId, sprint: qs.sprint }, qs.format);
    await db.query(`INSERT INTO audit_log(actor_type, actor_id, action, target_type, details) VALUES ('ORGANIZER',$1,'export.downloaded','export',$2)`, [actor.id, JSON.stringify({ kind, ...qs })]);
    reply.header('content-disposition', `attachment; filename="${f.filename}"`).type(f.type);
    return reply.send(f.body);
  });

  // ------------------------------------------------------------------ display links
  r.get('/admin/display-links', { summary: 'Projector links', tag: 'display', auth: O, permission: 'display.manage' }, async (req) => {
    await requireOrganizer(deps, req, 'display.manage');
    return listDisplayLinks(db);
  });
  r.post('/admin/display-links', { summary: 'Create a revocable projector link (key shown once)', tag: 'display', auth: O, permission: 'display.manage', body: '{ label, hours }' }, async (req, reply) => {
    const { actor } = await requireOrganizer(deps, req, 'display.manage');
    const body = z.object({ label: z.string().max(80), hours: z.number().int().min(1).max(168).default(24) }).parse(req.body);
    reply.code(201);
    const origin = typeof req.headers.origin === 'string' && /^https?:\/\/[^/]+$/.test(req.headers.origin) ? req.headers.origin : undefined;
    return createDisplayLink(db, cfg, actor, body.label, body.hours, origin);
  });
  r.delete('/admin/display-links/:id', { summary: 'Revoke a projector link (its screens disconnect)', tag: 'display', auth: O, permission: 'display.manage' }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireOrganizer(deps, req, 'display.manage');
    await revokeDisplayLink(db, actor, id);
    return { ok: true };
  });

  // ------------------------------------------------------------------ question bank
  r.get('/admin/questions', { summary: 'Question bank (latest version of each)', tag: 'bank', auth: O, permission: 'content.read' }, async (req) => {
    await requireOrganizer(deps, req, 'content.read');
    const ev = await getEvent(db);
    const { bankCoverage } = await import('../services/releases.js');
    const slots = await admin.unplannedSlots(db);
    return { questions: await content.listQuestionsAdmin(db), coverage: await bankCoverage(db, ev.rules, slots) };
  });

  r.post('/admin/questions', { summary: 'Create a question (as DRAFT)', tag: 'bank', auth: O, permission: 'content.write', body: 'QuestionInput' }, async (req, reply) => {
    const { actor } = await requireOrganizer(deps, req, 'content.write');
    reply.code(201);
    return withTx(db, (tx) => content.adminCreateQuestion(tx, cfg, actor, req.body));
  });

  r.get('/admin/question-versions/:id', { summary: 'One version (solution only with content.solutions)', tag: 'bank', auth: O, permission: 'content.read' }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { role } = await requireOrganizer(deps, req, 'content.read');
    return content.getVersion(db, id, permissionsOf(role).includes('content.solutions'));
  });

  r.put('/admin/question-versions/:id', { summary: 'Edit a DRAFT version', tag: 'bank', auth: O, permission: 'content.write', body: 'QuestionInput' }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireOrganizer(deps, req, 'content.write');
    return withTx(db, (tx) => content.adminUpdateDraft(tx, cfg, actor, id, req.body));
  });

  r.post('/admin/questions/:id/drafts', { summary: 'Start a new draft from the latest version', tag: 'bank', auth: O, permission: 'content.write' }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireOrganizer(deps, req, 'content.write');
    return withTx(db, (tx) => content.adminNewDraft(tx, actor, id));
  });

  r.post('/admin/question-versions/:id/status', { summary: 'DRAFT → REVIEWED → PUBLISHED (or ARCHIVED); never automatic', tag: 'bank', auth: O, permission: 'content.write', body: '{ to }' }, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ to: z.enum(['REVIEWED', 'PUBLISHED', 'ARCHIVED']) }).parse(req.body);
    const { actor } = await requireOrganizer(deps, req, body.to === 'PUBLISHED' ? 'content.publish' : 'content.write');
    return withTx(db, (tx) => content.advanceStatus(tx, actor, id, body.to));
  });

  r.post('/admin/question-versions/:id/verify', { summary: 'Run the private solution and starter through the real validator', tag: 'bank', auth: O, permission: 'content.write' }, async (req) => {
    const { id } = idParam.parse(req.params);
    await requireOrganizer(deps, req, 'content.write');
    return content.verifyVersion(db, cfg, id);
  });

  r.get('/admin/questions/import-template', { summary: 'Question bank CSV/XLSX template', tag: 'import', auth: O, permission: 'content.write', query: 'format=csv|xlsx' }, async (req, reply) => {
    await requireOrganizer(deps, req, 'content.write');
    const { format } = z.object({ format: z.enum(['csv', 'xlsx']).default('csv') }).parse(req.query);
    const header = [...content.QUESTION_CSV_HEADER];
    const sample = ['web-alt-text-1', 'web', 'REGULAR', 'EASY', 'Missing alt text', 'Which attribute makes the reactor diagram accessible to screen readers?', 'WEB', 'EXACT_TEXT', 'alt', '', 'false', 'One HTML attribute name', 'Screen readers read this attribute aloud.', 'The alt attribute describes the image.', '', '', ''];
    if (format === 'xlsx') {
      reply.header('content-disposition', 'attachment; filename="among-bug-questions-template.xlsx"').type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return reply.send(await toXlsx('questions', header, [sample]));
    }
    reply.header('content-disposition', 'attachment; filename="among-bug-questions-template.csv"').type('text/csv; charset=utf-8');
    return reply.send(admin.toCsv(header, [sample]));
  });

  r.post('/admin/questions/imports', { summary: 'Upload JSON / CSV / XLSX bank (+ linked assets) → preview', tag: 'import', auth: O, permission: 'content.write', body: '{ fileName, contentBase64, assets? }' }, async (req) => {
    const { actor } = await requireOrganizer(deps, req, 'content.write');
    const body = upload.extend({ assets: z.record(z.string().max(400_000)).optional() }).parse(req.body);
    return content.previewQuestionImport(db, actor, body);
  });

  r.post('/admin/questions/imports/:id/commit', { summary: 'Commit a previewed bank import (creates DRAFTs only)', tag: 'import', auth: O, permission: 'content.write' }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { actor } = await requireOrganizer(deps, req, 'content.write');
    return content.commitQuestionImport(db, cfg, actor, id);
  });
}
