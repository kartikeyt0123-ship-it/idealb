import type { AppConfig } from '../config.js';
import { one, withTx, type Db, type Queryable } from '../db.js';
import { AppError } from '../errors.js';
import { randomToken, sha256 } from '../security/crypto.js';
import { getEvent } from './context.js';
import { emit, Rooms } from './outbox.js';

export const SESSION_COOKIE = 'ab_sid';
export const DISPLAY_COOKIE = 'ab_display';

export type OrganizerRole = 'SUPER_ADMIN' | 'OPERATOR' | 'CONTENT_EDITOR';

export interface SessionRow {
  id: string;
  actor_type: 'TEAM' | 'ORGANIZER' | 'DISPLAY';
  team_id: string | null;
  organizer_id: string | null;
  display_link_id: string | null;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

export interface ResolvedSession {
  session: SessionRow;
  organizer?: { id: string; email: string; display_name: string; role: OrganizerRole; active: boolean };
  team?: { id: string; crew_id: string; name: string; status: string; account_enabled: boolean; must_change_password: boolean };
  display?: { id: string; label: string };
}

type Actor = { type: 'TEAM'; teamId: string } | { type: 'ORGANIZER'; organizerId: string } | { type: 'DISPLAY'; displayLinkId: string; expiresAt: Date };

export async function createSession(db: Db, cfg: AppConfig, actor: Actor, meta: { userAgent?: string; ip?: string }): Promise<{ token: string; sessionId: string; evicted: string[] }> {
  const token = randomToken(32);
  const expires = actor.type === 'DISPLAY' ? actor.expiresAt : new Date(Date.now() + cfg.sessionTtlHours * 3600_000);
  return withTx(db, async (tx) => {
    const evicted: string[] = [];
    if (actor.type === 'TEAM') {
      // Serialise concurrent logins of the same crew while counting devices.
      await tx.query('SELECT id FROM team WHERE id=$1 FOR UPDATE', [actor.teamId]);
      const { rules } = await getEvent(tx);
      const live = (await tx.query(`SELECT id FROM session WHERE team_id=$1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at ASC`, [actor.teamId])).rows as { id: string }[];
      if (live.length >= rules.sessionLimit) {
        if (rules.sessionLimitPolicy === 'REJECT') {
          throw new AppError('SESSION_LIMIT', `Your crew already has ${live.length} active devices (limit ${rules.sessionLimit}). Ask an organizer to sign out a device.`);
        }
        const toEvict = live.slice(0, live.length - rules.sessionLimit + 1).map((r) => r.id);
        await tx.query(`UPDATE session SET revoked_at=now(), revoke_reason='SESSION_LIMIT_EVICTED' WHERE id = ANY($1)`, [toEvict]);
        evicted.push(...toEvict);
        await emit(tx, 'session.revoked', [Rooms.team(actor.teamId)], { sessionIds: toEvict, reason: 'SESSION_LIMIT_EVICTED' });
      }
    }
    const row = await one<{ id: string }>(
      tx,
      `INSERT INTO session(token_hash, actor_type, team_id, organizer_id, display_link_id, expires_at, user_agent, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        sha256(token),
        actor.type,
        actor.type === 'TEAM' ? actor.teamId : null,
        actor.type === 'ORGANIZER' ? actor.organizerId : null,
        actor.type === 'DISPLAY' ? actor.displayLinkId : null,
        expires,
        meta.userAgent?.slice(0, 300) ?? null,
        meta.ip ?? null,
      ],
    );
    return { token, sessionId: row!.id, evicted };
  });
}

/** Resolves and touches a session. Returns null for unknown / expired / revoked / idle sessions. */
export async function resolveSession(db: Db, cfg: AppConfig, token: string | undefined): Promise<ResolvedSession | null> {
  if (!token || token.length > 200) return null;
  const s = await one<SessionRow & { idle_ms: number }>(
    db,
    `SELECT id, actor_type, team_id, organizer_id, display_link_id, created_at, last_seen_at, expires_at, revoked_at,
            EXTRACT(EPOCH FROM (now() - last_seen_at)) * 1000 AS idle_ms
       FROM session WHERE token_hash=$1`,
    [sha256(token)],
  );
  if (!s || s.revoked_at || new Date(s.expires_at).getTime() <= Date.now()) return null;
  if (s.actor_type !== 'DISPLAY') {
    const idleLimitMs = (s.actor_type === 'ORGANIZER' ? cfg.adminIdleMinutes : cfg.sessionIdleMinutes) * 60_000;
    if (s.idle_ms > idleLimitMs) {
      await db.query(`UPDATE session SET revoked_at=now(), revoke_reason='IDLE_TIMEOUT' WHERE id=$1 AND revoked_at IS NULL`, [s.id]);
      return null;
    }
  }
  if (s.idle_ms > 30_000) await db.query('UPDATE session SET last_seen_at=now() WHERE id=$1', [s.id]);
  const out: ResolvedSession = { session: s };
  if (s.actor_type === 'ORGANIZER') {
    const o = await one<NonNullable<ResolvedSession['organizer']>>(db, 'SELECT id, email, display_name, role, active FROM organizer_user WHERE id=$1', [s.organizer_id]);
    if (!o || !o.active) return null;
    out.organizer = o;
  } else if (s.actor_type === 'TEAM') {
    const t = await one<NonNullable<ResolvedSession['team']>>(db, 'SELECT id, crew_id, name, status, account_enabled, must_change_password FROM team WHERE id=$1', [s.team_id]);
    if (!t) return null;
    out.team = t;
  } else {
    const d = await one<{ id: string; label: string; revoked_at: Date | null; expires_at: Date }>(db, 'SELECT id, label, revoked_at, expires_at FROM display_link WHERE id=$1', [s.display_link_id]);
    if (!d || d.revoked_at || new Date(d.expires_at).getTime() <= Date.now()) return null;
    out.display = { id: d.id, label: d.label };
  }
  return out;
}

export async function revokeSession(q: Queryable, sessionId: string, reason: string) {
  const r = await one<{ team_id: string | null }>(q, `UPDATE session SET revoked_at=now(), revoke_reason=$2 WHERE id=$1 AND revoked_at IS NULL RETURNING team_id`, [sessionId, reason]);
  if (r) await emit(q, 'session.revoked', r.team_id ? [Rooms.team(r.team_id)] : [Rooms.all], { sessionIds: [sessionId], reason });
}

export async function revokeAllTeamSessions(q: Queryable, teamId: string, reason: string) {
  const r = await q.query(`UPDATE session SET revoked_at=now(), revoke_reason=$2 WHERE team_id=$1 AND revoked_at IS NULL RETURNING id`, [teamId, reason]);
  if (r.rowCount) await emit(q, 'session.revoked', [Rooms.team(teamId)], { sessionIds: r.rows.map((x) => x.id), reason });
}

export async function revokeDisplaySessions(q: Queryable, displayLinkId: string, reason: string) {
  const r = await q.query(`UPDATE session SET revoked_at=now(), revoke_reason=$2 WHERE display_link_id=$1 AND revoked_at IS NULL RETURNING id`, [displayLinkId, reason]);
  if (r.rowCount) await emit(q, 'session.revoked', [Rooms.display], { sessionIds: r.rows.map((x) => x.id), reason });
}
