import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, withTx } from '../db.js';
import { AppError } from '../errors.js';
import { clearSessionCookie, clientIp, getAuth, setSessionCookie, type Deps } from '../http.js';
import { checkTeamPasswordPolicy, dummyPasswordHash, hashPassword, verifyPassword } from '../security/crypto.js';
import { audit } from '../services/audit.js';
import { currentDay, getEvent, resolveCompetitor } from '../services/context.js';
import { createSession, revokeAllTeamSessions, revokeSession } from '../services/sessions.js';
import { completePasswordReset, CREW_COLORS, getTeamProfile, normalizeEmail, registerTeam } from '../services/teams.js';
import type { AppError as AE } from '../errors.js';

const loginSchema = z.object({
  mode: z.enum(['CREW', 'COMMANDER']),
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(200),
});

/** Team status for the card / waiting screens. Never includes game data for pending crews. */
async function teamStatus(deps: Deps, teamId: string) {
  const profile = await getTeamProfile(deps.db, teamId);
  let access: { state: string; message: string; day?: number; gameNumber?: number } = { state: 'ELIGIBLE', message: 'Cleared for boarding.' };
  try {
    const ctx = await resolveCompetitor(deps.db, teamId);
    access = { state: 'ELIGIBLE', message: 'Cleared for boarding.', day: ctx.day.day_number, gameNumber: ctx.game.number };
  } catch (err) {
    const e = err as AE;
    access = { state: e.code ?? 'ERROR', message: e.message };
  }
  const ev = await getEvent(deps.db);
  const day = await currentDay(deps.db, ev);
  return {
    role: 'COMPETITOR' as const,
    team: {
      id: profile.team!.id, crewId: profile.team!.crew_id, name: profile.team!.name, email: profile.team!.email,
      color: profile.team!.color, requestedDays: profile.team!.requested_days, mustChangePassword: profile.team!.must_change_password,
    },
    members: profile.members,
    days: profile.days,
    currentDay: day ? { number: day.day_number, label: day.label } : null,
    access,
    event: { name: ev.name, isDemo: ev.is_demo },
  };
}

export async function authRoutes(app: FastifyInstance, deps: Deps) {
  app.get('/api/meta', async () => {
    const ev = await getEvent(deps.db).catch(() => null);
    // The public demo crew is advertised only in DEMO_MODE (never in production, never the commander password).
    const demoCrew = deps.cfg.demoMode && ev?.is_demo ? { identifier: 'nexora@example.test', password: 'CrewDemo123!' } : null;
    return { event: ev ? { name: ev.name, isDemo: ev.is_demo } : null, demoMode: deps.cfg.demoMode, demoCrew, colors: CREW_COLORS };
  });

  app.post('/api/auth/register', async (req, reply) => {
    deps.limiters.register.enforce(`reg:${clientIp(req)}`, 'Too many registrations from this network. Wait a minute.');
    const key = req.headers['idempotency-key'];
    const r = await registerTeam(deps.db, req.body, typeof key === 'string' ? key : undefined);
    reply.code(201);
    return r;
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const ident = body.identifier.trim();
    deps.limiters.loginByIp.enforce(`ip:${clientIp(req)}`, 'Too many sign-in attempts from this network. Wait a moment.');
    deps.limiters.loginByIdentifier.enforce(`id:${ident.toLowerCase()}`, 'Too many attempts for this account. Wait a minute and try again.');
    const meta = { userAgent: req.headers['user-agent'], ip: clientIp(req) };
    if (body.mode === 'COMMANDER') {
      const admin = await one<{ id: string; password_hash: string; active: boolean; display_name: string; role: string; email: string }>(
        deps.db, 'SELECT id, password_hash, active, display_name, role, email FROM admin_user WHERE email_normalized=$1', [normalizeEmail(ident)],
      );
      const ok = await verifyPassword(body.password, admin?.password_hash ?? (await dummyPasswordHash()));
      if (!admin || !ok || !admin.active) throw new AppError('INVALID_CREDENTIALS', 'Commander credentials not recognised.');
      const s = await createSession(deps.db, deps.cfg, { type: 'ADMIN', adminId: admin.id }, meta);
      await deps.db.query('UPDATE admin_user SET last_login_at=now() WHERE id=$1', [admin.id]);
      await audit(deps.db, { type: 'ADMIN', id: admin.id }, 'admin.login', { type: 'admin', id: admin.id }, { ip: meta.ip });
      setSessionCookie(deps, reply, s.token);
      return { role: 'COMMANDER', admin: { id: admin.id, name: admin.display_name, email: admin.email, role: admin.role } };
    }
    const isCrewId = /^crw-\d{3,}$/i.test(ident);
    const team = await one<{ id: string; password_hash: string; status: string }>(
      deps.db,
      isCrewId ? 'SELECT id, password_hash, status FROM team WHERE crew_id=$1' : 'SELECT id, password_hash, status FROM team WHERE email_normalized=$1',
      [isCrewId ? ident.toUpperCase() : normalizeEmail(ident)],
    );
    const ok = await verifyPassword(body.password, team?.password_hash ?? (await dummyPasswordHash()));
    if (!team || !ok) throw new AppError('INVALID_CREDENTIALS', 'Crew credentials not recognised. Use the captain email (or crew ID) and your crew password.');
    if (team.status === 'ARCHIVED') throw new AppError('TEAM_ARCHIVED', 'This crew has been archived by the organizers.');
    const s = await createSession(deps.db, deps.cfg, { type: 'TEAM', teamId: team.id }, meta);
    setSessionCookie(deps, reply, s.token);
    // First successful login on an eligible day records check-in.
    const ev = await getEvent(deps.db);
    const day = await currentDay(deps.db, ev);
    if (day) await deps.db.query('UPDATE team_day_eligibility SET checked_in_at=COALESCE(checked_in_at, now()) WHERE team_id=$1 AND day_id=$2 AND active', [team.id, day.id]);
    return teamStatus(deps, team.id);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const a = await getAuth(deps, req);
    if (a) await revokeSession(deps.db, a.session.id, 'LOGOUT');
    clearSessionCookie(deps, reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    const a = await getAuth(deps, req);
    if (!a) return { role: null };
    if (a.admin) return { role: 'COMMANDER', admin: { id: a.admin.id, name: a.admin.display_name, email: a.admin.email, role: a.admin.role } };
    return teamStatus(deps, a.team!.id);
  });

  app.post('/api/auth/change-password', async (req) => {
    const a = await getAuth(deps, req);
    if (!a?.team) throw new AppError('UNAUTHENTICATED', 'Sign in first.');
    const body = z.object({ currentPassword: z.string().max(200), newPassword: z.string().max(200) }).parse(req.body);
    const row = await one<{ password_hash: string }>(deps.db, 'SELECT password_hash FROM team WHERE id=$1', [a.team.id]);
    if (!(await verifyPassword(body.currentPassword, row!.password_hash))) throw new AppError('INVALID_CREDENTIALS', 'Current password is incorrect.', { fields: { currentPassword: 'Incorrect password.' } });
    const err = checkTeamPasswordPolicy(body.newPassword);
    if (err) throw new AppError('VALIDATION_FAILED', err, { fields: { newPassword: err } });
    const hash = await hashPassword(body.newPassword);
    await withTx(deps.db, async (tx) => {
      await tx.query('UPDATE team SET password_hash=$2, must_change_password=false, updated_at=now() WHERE id=$1', [a.team!.id, hash]);
      // Keep this device signed in; sign out every other device.
      await tx.query(`UPDATE session SET revoked_at=now(), revoke_reason='PASSWORD_CHANGED' WHERE team_id=$1 AND id<>$2 AND revoked_at IS NULL`, [a.team!.id, a.session.id]);
      await audit(tx, { type: 'TEAM', id: a.team!.id }, 'team.password_changed', { type: 'team', id: a.team!.id });
    });
    void revokeAllTeamSessions;
    return { ok: true };
  });

  app.post('/api/auth/reset', async (req) => {
    deps.limiters.loginByIp.enforce(`reset:${clientIp(req)}`);
    const body = z.object({ token: z.string().min(10).max(200), password: z.string().max(200) }).parse(req.body);
    return completePasswordReset(deps.db, body.token, body.password);
  });
}
