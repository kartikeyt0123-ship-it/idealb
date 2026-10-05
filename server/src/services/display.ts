import type { AppConfig } from '../config.js';
import { many, one, withTx, type Db, type Queryable } from '../db.js';
import { AppError } from '../errors.js';
import { randomToken, sha256 } from '../security/crypto.js';
import { audit, type Actor } from './audit.js';
import { getEvent, getSprints, listSlots } from './context.js';
import { eventBoard, slotBoard, sprintBoard, type Board } from './ranking.js';
import { createSession, revokeDisplaySessions } from './sessions.js';

/**
 * Projector access. An organizer creates a revocable display link; the
 * projector exchanges its one-time-shown key for a DISPLAY session that can
 * only read approved standings fields — never emails, answers or admin data.
 */
/** `baseUrl` is the console's own (CSRF-validated) origin, so links work behind tunnels and proxies; PUBLIC_URL otherwise. */
export async function createDisplayLink(db: Db, cfg: AppConfig, actor: Actor, label: string, hours: number, baseUrl?: string) {
  if (!label?.trim() || label.length > 80) throw new AppError('VALIDATION_FAILED', 'Give the display a label (max 80 chars).');
  const h = Math.min(Math.max(1, Math.floor(hours || 24)), 24 * 7);
  const key = randomToken(24);
  const ev = await getEvent(db);
  const row = await withTx(db, async (tx) => {
    const r = (await one<{ id: string; expires_at: Date }>(
      tx,
      `INSERT INTO display_link(event_id, label, token_hash, created_by, expires_at) VALUES ($1,$2,$3,$4, now() + make_interval(hours => $5)) RETURNING id, expires_at`,
      [ev.id, label.trim(), sha256(key), actor.id, h],
    ))!;
    await audit(tx, actor, 'display.link_created', { type: 'display_link', id: r.id }, { label, hours: h });
    return r;
  });
  return { id: row.id, label: label.trim(), expiresAt: row.expires_at, key, url: `${(baseUrl ?? cfg.publicUrl).replace(/\/$/, '')}/display/overall#key=${key}` };
}

export async function listDisplayLinks(q: Queryable) {
  return many(q, `SELECT dl.id, dl.label, dl.created_at, dl.expires_at, dl.revoked_at, o.display_name AS created_by,
                         (SELECT count(*)::int FROM session s WHERE s.display_link_id=dl.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS live_sessions
                    FROM display_link dl JOIN organizer_user o ON o.id=dl.created_by ORDER BY dl.created_at DESC`);
}

export async function revokeDisplayLink(db: Db, actor: Actor, id: string) {
  await withTx(db, async (tx) => {
    const r = await one(tx, 'UPDATE display_link SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL RETURNING id', [id]);
    if (!r) throw new AppError('NOT_FOUND', 'Active display link not found.');
    await revokeDisplaySessions(tx, id, 'DISPLAY_LINK_REVOKED');
    await audit(tx, actor, 'display.link_revoked', { type: 'display_link', id });
  });
}

export async function openDisplaySession(db: Db, cfg: AppConfig, key: string, meta: { userAgent?: string; ip?: string }) {
  if (!key || key.length > 200) throw new AppError('UNAUTHENTICATED', 'Missing display key.');
  const link = await one<{ id: string; expires_at: Date; revoked_at: Date | null }>(db, 'SELECT id, expires_at, revoked_at FROM display_link WHERE token_hash=$1', [sha256(key)]);
  if (!link || link.revoked_at || new Date(link.expires_at).getTime() <= Date.now()) throw new AppError('INVALID_CREDENTIALS', 'This display link is invalid, expired or revoked.');
  return createSession(db, cfg, { type: 'DISPLAY', displayLinkId: link.id, expiresAt: new Date(link.expires_at) }, meta);
}

const displayRow = (r: Board['active'][number]) => ({
  rank: r.rank, crewId: r.crewId, name: r.name, color: r.color, slotNumber: r.slotNumber, score: r.score, cumulative: r.cumulative, perSprint: r.perSprint, solves: r.solves,
});

/** Approved projector payloads only. */
export async function displayState(q: Queryable, scope: { kind: 'OVERALL' } | { kind: 'SLOT'; slotId: string; sprintId?: string }) {
  const ev = await getEvent(q);
  const slots = await listSlots(q, ev.id);
  const slotMeta = await Promise.all(
    slots.map(async (s) => {
      const sprints = await getSprints(q, s.id);
      const cur = sprints.find((x) => x.number === Math.max(1, s.current_sprint));
      return {
        id: s.id, number: s.number, name: s.name, date: s.date, dayLabel: s.day_label, phase: s.phase, currentSprint: s.current_sprint,
        sprint: cur ? { id: cur.id, number: cur.number, status: cur.status, deadlineAt: cur.deadline_at, pausedAt: cur.paused_at, durationSeconds: cur.duration_seconds } : null,
        sprints: sprints.map((x) => ({ id: x.id, number: x.number, status: x.status })),
      };
    }),
  );
  const base = { serverTime: new Date().toISOString(), event: { name: ev.name, edition: ev.edition, organizer: ev.organizer, venue: ev.venue, phase: ev.phase, metric: ev.rules.rankingMetric }, slots: slotMeta };
  if (scope.kind === 'OVERALL') {
    const b = await eventBoard(q, ev.id, ev.rules.rankingMetric);
    const final = ev.phase === 'FINALIZED';
    return { ...base, scope: 'OVERALL', status: final ? 'FINAL' : 'PROVISIONAL', completedSlots: slots.filter((s) => s.phase === 'COMPLETED').map((s) => s.number), rows: b.active.map(displayRow) };
  }
  const slot = slots.find((s) => s.id === scope.slotId);
  if (!slot) throw new AppError('NOT_FOUND', 'Slot not found.');
  const meta = slotMeta.find((s) => s.id === slot.id)!;
  if (scope.sprintId) {
    const sp = meta.sprints.find((x) => x.id === scope.sprintId);
    if (!sp) throw new AppError('NOT_FOUND', 'Sprint not found.');
    const b = await sprintBoard(q, slot.id, sp.number, ev.rules.rankingMetric);
    const status = sp.status === 'RUNNING' || sp.status === 'PAUSED' ? 'LIVE' : sp.status === 'READY' ? 'NOT_STARTED' : 'FROZEN';
    return { ...base, scope: 'SPRINT', slotId: slot.id, sprintNumber: sp.number, status, rows: b.active.map(displayRow) };
  }
  const b = await slotBoard(q, slot.id, ev.rules.rankingMetric);
  return { ...base, scope: 'SLOT', slotId: slot.id, status: slot.phase === 'COMPLETED' ? 'FINAL' : slot.phase === 'RUNNING' ? 'LIVE' : 'PROVISIONAL', rows: b.active.map(displayRow) };
}
