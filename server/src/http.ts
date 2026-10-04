import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from './config.js';
import type { Db } from './db.js';
import { AppError } from './errors.js';
import type { Limiters } from './security/rateLimit.js';
import type { Actor } from './services/audit.js';
import { resolveCompetitor, type CompetitorContext } from './services/context.js';
import type { RunService } from './services/runs.js';
import { resolveSession, SESSION_COOKIE, type AdminRole, type ResolvedSession } from './services/sessions.js';
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
  }
}

export async function getAuth(deps: Deps, req: FastifyRequest): Promise<ResolvedSession | null> {
  if (req.auth !== undefined) return req.auth;
  req.auth = await resolveSession(deps.db, deps.cfg, req.cookies?.[SESSION_COOKIE]);
  return req.auth;
}

export async function requireTeam(deps: Deps, req: FastifyRequest) {
  const a = await getAuth(deps, req);
  if (!a) throw new AppError('UNAUTHENTICATED', 'Sign in to board the ship.');
  if (!a.team) throw new AppError('FORBIDDEN', 'This endpoint is for crews.');
  return a as ResolvedSession & { team: NonNullable<ResolvedSession['team']> };
}

export async function requireCompetitor(deps: Deps, req: FastifyRequest): Promise<{ auth: ResolvedSession; ctx: CompetitorContext }> {
  const auth = await requireTeam(deps, req);
  const ctx = await resolveCompetitor(deps.db, auth.team.id);
  return { auth, ctx };
}

export type Permission =
  | 'crews.read' | 'crews.write' | 'game.control' | 'coins.adjust' | 'content.read' | 'content.write'
  | 'content.solutions' | 'results.confirm' | 'disqualify' | 'event.config' | 'audit.read' | 'exports';

const ROLE_PERMS: Record<AdminRole, Permission[]> = {
  SUPER_ADMIN: ['crews.read', 'crews.write', 'game.control', 'coins.adjust', 'content.read', 'content.write', 'content.solutions', 'results.confirm', 'disqualify', 'event.config', 'audit.read', 'exports'],
  OPERATOR: ['crews.read', 'crews.write', 'game.control', 'coins.adjust', 'content.read', 'audit.read', 'exports'],
  CONTENT_EDITOR: ['crews.read', 'content.read', 'content.write', 'content.solutions'],
};

export function can(role: AdminRole, p: Permission) {
  return ROLE_PERMS[role].includes(p);
}

export async function requireAdmin(deps: Deps, req: FastifyRequest, perm?: Permission): Promise<{ auth: ResolvedSession; actor: Actor; role: AdminRole }> {
  const a = await getAuth(deps, req);
  if (!a) throw new AppError('UNAUTHENTICATED', 'Commander sign-in required.');
  if (!a.admin) throw new AppError('COMMANDER_CLEARANCE_REQUIRED', 'ACCESS DENIED — commander clearance required.');
  if (perm && !can(a.admin.role, perm)) throw new AppError('FORBIDDEN', `Your role (${a.admin.role}) cannot perform this action.`);
  return { auth: a, actor: { type: 'ADMIN', id: a.admin.id }, role: a.admin.role };
}

export function idemKey(req: FastifyRequest): string {
  const k = req.headers['idempotency-key'];
  if (typeof k !== 'string' || !k) throw new AppError('VALIDATION_FAILED', 'Missing Idempotency-Key header.');
  return k;
}

export function clientIp(req: FastifyRequest) {
  return req.ip;
}

export function setSessionCookie(deps: Deps, reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: deps.cfg.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: deps.cfg.sessionTtlHours * 3600,
  });
}

export function clearSessionCookie(deps: Deps, reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: deps.cfg.cookieSecure, sameSite: 'lax' });
}
