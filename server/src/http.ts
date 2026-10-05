import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from './config.js';
import type { Db } from './db.js';
import { AppError } from './errors.js';
import type { Limiters } from './security/rateLimit.js';
import type { Actor } from './services/audit.js';
import { resolveCrew, type CrewContext } from './services/context.js';
import type { RunService } from './services/runs.js';
import { DISPLAY_COOKIE, resolveSession, SESSION_COOKIE, type OrganizerRole, type ResolvedSession } from './services/sessions.js';
import type { Realtime } from './realtime.js';

export interface Deps {
  db: Db;
  cfg: AppConfig;
  limiters: Limiters;
  runs: RunService;
  realtime?: Realtime;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: ResolvedSession | null;
    displayAuth?: ResolvedSession | null;
  }
}

export async function getAuth(deps: Deps, req: FastifyRequest): Promise<ResolvedSession | null> {
  if (req.auth !== undefined) return req.auth;
  const s = await resolveSession(deps.db, deps.cfg, req.cookies?.[SESSION_COOKIE]);
  // A display session never authenticates the main cookie.
  req.auth = s && s.session.actor_type !== 'DISPLAY' ? s : null;
  return req.auth;
}

export async function requireTeam(deps: Deps, req: FastifyRequest) {
  const a = await getAuth(deps, req);
  if (!a) throw new AppError('UNAUTHENTICATED', 'Sign in to board the ship.');
  if (!a.team) throw new AppError('FORBIDDEN', 'This endpoint is for crews.');
  return a as ResolvedSession & { team: NonNullable<ResolvedSession['team']> };
}

/** Crew + its one assigned slot. The slot always comes from the server-side enrollment, never from the URL. */
export async function requireCrew(deps: Deps, req: FastifyRequest): Promise<{ auth: ResolvedSession; ctx: CrewContext }> {
  const auth = await requireTeam(deps, req);
  const ctx = await resolveCrew(deps.db, auth.team.id);
  return { auth, ctx };
}

/** A slot id in a crew URL must be the crew's own slot; anything else is indistinguishable from "not found". */
export function assertOwnSlot(ctx: CrewContext, slotId: string) {
  if (ctx.slot.id !== slotId) throw new AppError('WRONG_SLOT', 'That slot is not yours.');
}

export type Permission =
  | 'teams.read' | 'teams.write' | 'credentials.send' | 'slots.control' | 'releases.manage' | 'coins.adjust'
  | 'content.read' | 'content.write' | 'content.publish' | 'content.solutions' | 'results.finalize' | 'disqualify'
  | 'rules.manage' | 'audit.read' | 'exports' | 'display.manage' | 'mail.read';

const ROLE_PERMS: Record<OrganizerRole, Permission[]> = {
  SUPER_ADMIN: ['teams.read', 'teams.write', 'credentials.send', 'slots.control', 'releases.manage', 'coins.adjust', 'content.read', 'content.write', 'content.publish', 'content.solutions', 'results.finalize', 'disqualify', 'rules.manage', 'audit.read', 'exports', 'display.manage', 'mail.read'],
  OPERATOR: ['teams.read', 'teams.write', 'credentials.send', 'slots.control', 'releases.manage', 'coins.adjust', 'content.read', 'audit.read', 'exports', 'display.manage'],
  CONTENT_EDITOR: ['teams.read', 'content.read', 'content.write', 'content.solutions'],
};

export function permissionsOf(role: OrganizerRole) {
  return ROLE_PERMS[role];
}

export async function requireOrganizer(deps: Deps, req: FastifyRequest, perm?: Permission): Promise<{ auth: ResolvedSession; actor: Actor & { name: string }; role: OrganizerRole }> {
  const a = await getAuth(deps, req);
  if (!a) throw new AppError('UNAUTHENTICATED', 'Organizer sign-in required.');
  if (!a.organizer) throw new AppError('ORGANIZER_CLEARANCE_REQUIRED', 'ACCESS DENIED — organizer clearance required.');
  if (perm && !ROLE_PERMS[a.organizer.role].includes(perm)) throw new AppError('FORBIDDEN', `Your role (${a.organizer.role}) cannot perform this action.`);
  return { auth: a, actor: { type: 'ORGANIZER', id: a.organizer.id, name: a.organizer.display_name }, role: a.organizer.role };
}

/** Projector access: a display session (own cookie) or any signed-in organizer. Crews are refused. */
export async function requireDisplay(deps: Deps, req: FastifyRequest) {
  if (req.displayAuth === undefined) {
    const s = await resolveSession(deps.db, deps.cfg, req.cookies?.[DISPLAY_COOKIE]);
    req.displayAuth = s && s.session.actor_type === 'DISPLAY' ? s : null;
  }
  if (req.displayAuth) return { kind: 'DISPLAY' as const };
  const a = await getAuth(deps, req);
  if (a?.organizer) return { kind: 'ORGANIZER' as const };
  throw new AppError('UNAUTHENTICATED', 'Open this screen with a display link from the organizer console.');
}

export function idemKey(req: FastifyRequest): string {
  const k = req.headers['idempotency-key'];
  if (typeof k !== 'string' || !k) throw new AppError('VALIDATION_FAILED', 'Missing Idempotency-Key header.');
  return k;
}

export function expectedVersion(req: FastifyRequest): number | undefined {
  const h = req.headers['if-match'];
  if (typeof h !== 'string' || !h) return undefined;
  const n = Number(h.replace(/"/g, ''));
  if (!Number.isInteger(n)) throw new AppError('VALIDATION_FAILED', 'If-Match must be a version number.');
  return n;
}

export function clientIp(req: FastifyRequest) {
  return req.ip;
}

function cookieOpts(deps: Deps) {
  return { httpOnly: true, secure: deps.cfg.cookieSecure, sameSite: 'lax' as const, path: '/' };
}

export function setSessionCookie(deps: Deps, reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, { ...cookieOpts(deps), maxAge: deps.cfg.sessionTtlHours * 3600 });
}
export function clearSessionCookie(deps: Deps, reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, cookieOpts(deps));
}
export function setDisplayCookie(deps: Deps, reply: FastifyReply, token: string, expiresAt: Date) {
  reply.setCookie(DISPLAY_COOKIE, token, { ...cookieOpts(deps), expires: expiresAt });
}
export function clearDisplayCookie(deps: Deps, reply: FastifyReply) {
  reply.clearCookie(DISPLAY_COOKIE, cookieOpts(deps));
}
