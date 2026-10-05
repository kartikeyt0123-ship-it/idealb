import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { one, withTx } from '../db.js';
import { AppError } from '../errors.js';
import { clearDisplayCookie, clearSessionCookie, clientIp, getAuth, permissionsOf, setDisplayCookie, setSessionCookie, type Deps } from '../http.js';
import { checkTeamPasswordPolicy, dummyPasswordHash, hashPassword, verifyPassword } from '../security/crypto.js';
import { audit } from '../services/audit.js';
import { getEvent, resolveCrew } from '../services/context.js';
import { openDisplaySession } from '../services/display.js';
import { createSession, revokeSession } from '../services/sessions.js';
import { CREW_COLORS, normalizeEmail } from '../services/teams.js';
import { api } from './openapi.js';

const crewLoginSchema = z.object({ identifier: z.string().trim().min(1).max(254), password: z.string().min(1).max(200) });
const organizerLoginSchema = z.object({ email: z.string().trim().min(3).max(254), password: z.string().min(1).max(200) });

function meta(req: FastifyRequest) {
  return { userAgent: req.headers['user-agent'], ip: clientIp(req) };
}

/** The crew's identity plus *why* it can or cannot play — never game data for a crew that cannot. */
async function crewIdentity(deps: Deps, teamId: string) {
  const t = (await one<{ id: string; crew_id: string; name: string; email: string; color: string; must_change_password: boolean }>(
    deps.db, 'SELECT id, crew_id, name, email, color, must_change_password FROM team WHERE id=$1', [teamId],
  ))!;
  const members = (await deps.db.query('SELECT name, institution, is_captain FROM team_member WHERE team_id=$1 ORDER BY position', [teamId])).rows;
  let access: Record<string, unknown>;
  try {
    const ctx = await resolveCrew(deps.db, teamId);
    const day = await one<{ date: string; label: string }>(deps.db, `SELECT to_char(date,'YYYY-MM-DD') AS date, label FROM event_day WHERE id=$1`, [ctx.slot.day_id]);
    access = { state: 'ASSIGNED', message: 'Cleared for boarding.', slot: { id: ctx.slot.id, number: ctx.slot.number, name: ctx.slot.name, phase: ctx.slot.phase, date: day?.date, dayLabel: day?.label, scheduledStartAt: ctx.slot.scheduled_start_at } };
  } catch (err) {
    const e = err as AppError;
    access = { state: e.code ?? 'ERROR', message: e.message };
    // Waiting for the slot to open: still show which slot / when.
    const slot = await one<{ id: string; number: number; name: string; phase: string; date: string; label: string; scheduled_start_at: Date | null }>(
      deps.db,
      `SELECT s.id, s.number, s.name, s.phase, to_char(d.date,'YYYY-MM-DD') AS date, d.label, s.scheduled_start_at FROM slot_enrollment se JOIN slot s ON s.id=se.slot_id JOIN event_day d ON d.id=s.day_id WHERE se.team_id=$1`,
      [teamId],
    );
    if (slot && e.code === 'SLOT_NOT_OPEN') access.slot = { id: slot.id, number: slot.number, name: slot.name, phase: slot.phase, date: slot.date, dayLabel: slot.label, scheduledStartAt: slot.scheduled_start_at };
  }
  return {
    role: 'CREW' as const,
    team: { id: t.id, crewId: t.crew_id, name: t.name, email: t.email, color: t.color, mustChangePassword: t.must_change_password },
    members,
    access,
  };
}

export async function authRoutes(app: FastifyInstance, deps: Deps) {
  const r = api(app);

  r.get('/meta', { summary: 'Public event branding (no credentials, ever)', tag: 'auth', auth: 'public' }, async () => {
    const ev = await getEvent(deps.db).catch(() => null);
    return {
      event: ev ? { name: ev.name, organizer: ev.organizer, edition: ev.edition, venue: ev.venue, isDemo: ev.is_demo, timezone: ev.timezone } : null,
      demoMode: deps.cfg.demoMode,
      registration: false,
      colors: CREW_COLORS,
    };
  });

  r.post('/auth/crew-login', { summary: 'Crew sign-in with captain email or CRW id', tag: 'auth', auth: 'public', body: '{ identifier, password }' }, async (req, reply) => {
    const body = crewLoginSchema.parse(req.body);
    const ident = body.identifier.trim();
    deps.limiters.loginByIp.enforce(`ip:${clientIp(req)}`, 'Too many sign-in attempts from this network. Wait a moment.');
    deps.limiters.loginByIdentifier.enforce(`crew:${ident.toLowerCase()}`, 'Too many attempts for this account. Wait a minute and try again.');
    const isCrewId = /^crw-\d{3,}$/i.test(ident);
    const team = await one<{ id: string; password_hash: string | null; status: string; account_enabled: boolean; checked_in_at: Date | null }>(
      deps.db,
      `SELECT id, password_hash, status, account_enabled, checked_in_at FROM team WHERE ${isCrewId ? 'crew_id=$1' : 'email_normalized=$1'}`,
      [isCrewId ? ident.toUpperCase() : normalizeEmail(ident)],
    );
    // Constant-ish work whether or not the crew exists / has credentials yet.
    const ok = await verifyPassword(body.password, team?.password_hash ?? (await dummyPasswordHash()));
    if (!team || !team.password_hash || !ok) throw new AppError('INVALID_CREDENTIALS', 'Crew credentials not recognised. Use the captain email (or CRW id) and the password from your credential mail.');
    if (team.status === 'ARCHIVED') throw new AppError('TEAM_ARCHIVED', 'This crew has been archived by the organizers.');
    if (!team.account_enabled) throw new AppError('ACCOUNT_DISABLED', 'This crew account is disabled. Ask the organizer desk.');
    // Attendance is what enables a crew's login (rule attendanceGatesLogin).
    if ((await getEvent(deps.db)).rules.attendanceGatesLogin && !team.checked_in_at) {
      throw new AppError('ATTENDANCE_REQUIRED', 'Your attendance has not been marked yet. Report to the organizer desk — your login opens as soon as you are marked present.');
    }
    const s = await createSession(deps.db, deps.cfg, { type: 'TEAM', teamId: team.id }, meta(req));
    await audit(deps.db, { type: 'TEAM', id: team.id }, 'team.login', { type: 'team', id: team.id }, { ip: clientIp(req), evicted: s.evicted.length });
    setSessionCookie(deps, reply, s.token);
    return crewIdentity(deps, team.id);
  });

  r.post('/auth/organizer-login', { summary: 'Organizer sign-in', tag: 'auth', auth: 'public', body: '{ email, password }' }, async (req, reply) => {
    const body = organizerLoginSchema.parse(req.body);
    deps.limiters.loginByIp.enforce(`ip:${clientIp(req)}`, 'Too many sign-in attempts from this network. Wait a moment.');
    deps.limiters.loginByIdentifier.enforce(`org:${body.email.toLowerCase()}`, 'Too many attempts for this account. Wait a minute and try again.');
    const o = await one<{ id: string; password_hash: string; active: boolean; display_name: string; role: 'SUPER_ADMIN' | 'OPERATOR' | 'CONTENT_EDITOR'; email: string }>(
      deps.db, 'SELECT id, password_hash, active, display_name, role, email FROM organizer_user WHERE email_normalized=$1', [normalizeEmail(body.email)],
    );
    const ok = await verifyPassword(body.password, o?.password_hash ?? (await dummyPasswordHash()));
    if (!o || !ok || !o.active) throw new AppError('INVALID_CREDENTIALS', 'Organizer credentials not recognised.');
    const s = await createSession(deps.db, deps.cfg, { type: 'ORGANIZER', organizerId: o.id }, meta(req));
    await deps.db.query('UPDATE organizer_user SET last_login_at=now() WHERE id=$1', [o.id]);
    await audit(deps.db, { type: 'ORGANIZER', id: o.id }, 'organizer.login', { type: 'organizer', id: o.id }, { ip: clientIp(req) });
    setSessionCookie(deps, reply, s.token);
    return { role: 'ORGANIZER', organizer: { id: o.id, name: o.display_name, email: o.email, role: o.role, permissions: permissionsOf(o.role) } };
  });

  r.post('/auth/logout', { summary: 'End this session', tag: 'auth', auth: 'public' }, async (req, reply) => {
    const a = await getAuth(deps, req);
    if (a) await revokeSession(deps.db, a.session.id, 'LOGOUT');
    clearSessionCookie(deps, reply);
    return { ok: true };
  });

  r.get('/me', { summary: 'Who am I (crew identity + slot access, or organizer role)', tag: 'auth', auth: 'public' }, async (req) => {
    const a = await getAuth(deps, req);
    if (!a) return { role: null };
    if (a.organizer) return { role: 'ORGANIZER', organizer: { id: a.organizer.id, name: a.organizer.display_name, email: a.organizer.email, role: a.organizer.role, permissions: permissionsOf(a.organizer.role) } };
    return crewIdentity(deps, a.team!.id);
  });

  r.post('/auth/change-password', { summary: 'Crew changes its password (required after credential mail)', tag: 'auth', auth: 'crew', body: '{ currentPassword, newPassword }' }, async (req) => {
    const a = await getAuth(deps, req);
    if (!a?.team) throw new AppError('UNAUTHENTICATED', 'Sign in first.');
    const body = z.object({ currentPassword: z.string().max(200), newPassword: z.string().max(200) }).parse(req.body);
    deps.limiters.loginByIdentifier.enforce(`pw:${a.team.id}`, 'Too many attempts. Wait a minute.');
    const row = await one<{ password_hash: string }>(deps.db, 'SELECT password_hash FROM team WHERE id=$1', [a.team.id]);
    if (!(await verifyPassword(body.currentPassword, row!.password_hash))) throw new AppError('INVALID_CREDENTIALS', 'Current password is incorrect.', { fields: { currentPassword: 'Incorrect password.' } });
    const err = checkTeamPasswordPolicy(body.newPassword);
    if (err) throw new AppError('VALIDATION_FAILED', err, { fields: { newPassword: err } });
    const hash = await hashPassword(body.newPassword);
    await withTx(deps.db, async (tx) => {
      await tx.query('UPDATE team SET password_hash=$2, must_change_password=false, updated_at=now() WHERE id=$1', [a.team!.id, hash]);
      await tx.query(`UPDATE session SET revoked_at=now(), revoke_reason='PASSWORD_CHANGED' WHERE team_id=$1 AND id<>$2 AND revoked_at IS NULL`, [a.team!.id, a.session.id]);
      await audit(tx, { type: 'TEAM', id: a.team!.id }, 'team.password_changed', { type: 'team', id: a.team!.id });
    });
    return { ok: true };
  });

  // Projector: exchange the one-time display key (URL fragment, never sent to logs) for a display-only cookie.
  r.post('/display/session', { summary: 'Open a projector session from a display link key', tag: 'display', auth: 'public', body: '{ key }' }, async (req, reply) => {
    const body = z.object({ key: z.string().min(10).max(200) }).parse(req.body);
    deps.limiters.loginByIp.enforce(`display:${clientIp(req)}`);
    const s = await openDisplaySession(deps.db, deps.cfg, body.key, meta(req));
    const link = await one<{ expires_at: Date; label: string }>(deps.db, 'SELECT dl.expires_at, dl.label FROM display_link dl JOIN session s ON s.display_link_id=dl.id WHERE s.id=$1', [s.sessionId]);
    setDisplayCookie(deps, reply, s.token, new Date(link!.expires_at));
    return { ok: true, label: link!.label, expiresAt: link!.expires_at };
  });

  r.post('/display/logout', { summary: 'Close this projector session', tag: 'display', auth: 'display' }, async (_req, reply) => {
    clearDisplayCookie(deps, reply);
    return { ok: true };
  });
}
