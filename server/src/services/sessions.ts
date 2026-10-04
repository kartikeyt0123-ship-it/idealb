import type { AppConfig } from '../config.js';
import { one, withTx, type Db, type Queryable } from '../db.js';
import { AppError } from '../errors.js';
import { randomToken, sha256 } from '../security/crypto.js';
import { emit, Rooms } from './outbox.js';

export const SESSION_COOKIE = 'ab_sid';

export interface SessionRow {
  id: string;
  actor_type: 'TEAM' | 'ADMIN';
  team_id: string | null;
  admin_id: string | null;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

export interface ResolvedSession {
  session: SessionRow;
  /** Present for admin sessions. */
  admin?: { id: string; email: string; display_name: string; role: AdminRole; active: boolean };
  /** Present for team sessions. */
  team?: { id: string; crew_id: string; name: string; status: string; must_change_password: boolean };
}

export type AdminRole = 'SUPER_ADMIN' | 'OPERATOR' | 'CONTENT_EDITOR';

export async function createSession(
  db: Db,
  cfg: AppConfig,
  actor: { type: 'TEAM'; teamId: string } | { type: 'ADMIN'; adminId: string },
  meta: { userAgent?: string; ip?: string },
): Promise<{ token: string; sessionId: string; evicted: string[] }> {
  const token = randomToken(32);
  const tokenHash = sha256(token);
  const expires = new Date(Date.now() + cfg.sessionTtlHours * 3600_000);
  return withTx(db, async (tx) => {
    const evicted: string[] = [];
    if (actor.type === 'TEAM') {
      // Serialise concurrent logins of the same crew while counting sessions.
      await tx.query('SELECT id FROM team WHERE id=$1 FOR UPDATE', [actor.teamId]);
      const ev = (await tx.query('SELECT session_limit, session_limit_policy FROM event LIMIT 1')).rows[0] ?? { session_limit: 4, session_limit_policy: 'EVICT_OLDEST' };
      const live = (
        await tx.query(
          `SELECT id FROM session WHERE team_id=$1 AND revoked_at IS NULL AND expires_at > now()
           ORDER BY last_seen_at ASC`,
          [actor.teamId],
        )
      ).rows as { id: string }[];
      if (live.length >= ev.session_limit) {
        if (ev.session_limit_policy === 'REJECT') {
          throw new AppError('SESSION_LIMIT', `Your crew already has ${live.length} active devices (limit ${ev.session_limit}). Ask an organizer to sign out a device.`);
        }
        const toEvict = live.slice(0, live.length - ev.session_limit + 1).map((r) => r.id);
        await tx.query(`UPDATE session SET revoked_at=now(), revoke_reason='SESSION_LIMIT_EVICTED' WHERE id = ANY($1)`, [toEvict]);
        evicted.push(...toEvict);
        await emit(tx, 'session.revoked', [Rooms.team(actor.teamId)], { sessionIds: toEvict, reason: 'SESSION_LIMIT_EVICTED' });
      }
    }
    const row = await one<{ id: string }>(
      tx,
      `INSERT INTO session(token_hash, actor_type, team_id, admin_id, expires_at, user_agent, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        tokenHash,
        actor.type,
        actor.type === 'TEAM' ? actor.teamId : null,
        actor.type === 'ADMIN' ? actor.adminId : null,
        expires,
        meta.userAgent?.slice(0, 300) ?? null,
        meta.ip ?? null,
      ],
    );
    return { token, sessionId: row!.id, evicted };
  });
}

/** Resolves and touches a session. Returns null for unknown/expired/revoked/idle sessions. */
export async function resolveSession(db: Db, cfg: AppConfig, token: string | undefined): Promise<ResolvedSession | null> {
  if (!token || token.length > 200) return null;
  const s = await one<SessionRow & { idle_ms: number }>(
    db,
    `SELECT id, actor_type, team_id, admin_id, created_at, last_seen_at, expires_at, revoked_at,
            EXTRACT(EPOCH FROM (now() - last_seen_at)) * 1000 AS idle_ms
       FROM session WHERE token_hash=$1`,
    [sha256(token)],
  );
  if (!s || s.revoked_at || new Date(s.expires_at).getTime() <= Date.now()) return null;
  const idleLimitMs = (s.actor_type === 'ADMIN' ? cfg.adminIdleMinutes : cfg.sessionIdleMinutes) * 60_000;
  if (s.idle_ms > idleLimitMs) {
    await db.query(`UPDATE session SET revoked_at=now(), revoke_reason='IDLE_TIMEOUT' WHERE id=$1 AND revoked_at IS NULL`, [s.id]);
    return null;
  }
  if (s.idle_ms > 30_000) await db.query('UPDATE session SET last_seen_at=now() WHERE id=$1', [s.id]);
  const out: ResolvedSession = { session: s };
  if (s.actor_type === 'ADMIN') {
    const admin = await one<NonNullable<ResolvedSession['admin']>>(db, 'SELECT id, email, display_name, role, active FROM admin_user WHERE id=$1', [s.admin_id]);
    if (!admin || !admin.active) return null;
    out.admin = admin;
  } else {
    const team = await one<NonNullable<ResolvedSession['team']>>(db, 'SELECT id, crew_id, name, status, must_change_password FROM team WHERE id=$1', [s.team_id]);
    if (!team) return null;
    out.team = team;
  }
  return out;
}

export async function revokeSession(q: Queryable, sessionId: string, reason: string) {
  const r = await one<{ team_id: string | null }>(q, `UPDATE session SET revoked_at=now(), revoke_reason=$2 WHERE id=$1 AND revoked_at IS NULL RETURNING team_id`, [sessionId, reason]);
  if (r?.team_id) await emit(q, 'session.revoked', [Rooms.team(r.team_id)], { sessionIds: [sessionId], reason });
}

export async function revokeAllTeamSessions(q: Queryable, teamId: string, reason: string) {
  const r = await q.query(`UPDATE session SET revoked_at=now(), revoke_reason=$2 WHERE team_id=$1 AND revoked_at IS NULL RETURNING id`, [teamId, reason]);
  if (r.rowCount) await emit(q, 'session.revoked', [Rooms.team(teamId)], { sessionIds: r.rows.map((x) => x.id), reason });
}
