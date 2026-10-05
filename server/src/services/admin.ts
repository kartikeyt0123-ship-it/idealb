import type { AppConfig } from '../config.js';
import { many, one, withTx, type Db, type Queryable, type Tx } from '../db.js';
import { AppError } from '../errors.js';
import { runnerHealth } from '../grading/runnerClient.js';
import { audit, type Actor } from './audit.js';
import { getEvent, getSprints, listDays, listSlots } from './context.js';
import { preflight } from './lifecycle.js';
import { emit, Rooms } from './outbox.js';
import { eventBoard, publicRow, slotBoard, sprintBoard } from './ranking.js';
import { bankCoverage, rescheduleBonuses } from './releases.js';
import { parseRules, RULE_CATALOGUE, sprintSeconds, unconfirmedRules, type Rules } from './rules.js';
import { revokeAllTeamSessions, revokeSession } from './sessions.js';
import { slotDto, sprintDto } from './snapshot.js';
import { toXlsx } from './spreadsheet.js';

export async function unplannedSlots(q: Queryable) {
  return (await one<{ n: number }>(q, 'SELECT count(*)::int AS n FROM slot s WHERE NOT EXISTS (SELECT 1 FROM question_instance qi WHERE qi.slot_id=s.id)'))!.n;
}

export async function overview(q: Queryable) {
  const ev = await getEvent(q);
  const days = await listDays(q, ev.id);
  const slots = await listSlots(q, ev.id);
  const now = Date.now();
  const out = [];
  for (const s of slots) {
    const sprints = await getSprints(q, s.id);
    const next = s.current_sprint < 4 && ['CONFIGURING', 'READY', 'WAITING'].includes(s.phase) ? s.current_sprint + 1 : null;
    const counts = await one<Record<string, number>>(
      q,
      `SELECT count(*)::int AS crews, count(*) FILTER (WHERE t.account_enabled)::int AS enabled, count(*) FILTER (WHERE t.checked_in_at IS NOT NULL)::int AS checked_in,
              (SELECT count(*)::int FROM session x WHERE x.team_id IN (SELECT team_id FROM slot_enrollment WHERE slot_id=$1) AND x.revoked_at IS NULL AND x.expires_at > now()) AS sessions
         FROM slot_enrollment se JOIN team t ON t.id=se.team_id WHERE se.slot_id=$1`,
      [s.id],
    );
    const releases = await many(
      q,
      `SELECT r.id, r.type, r.label, r.status, r.offset_seconds, r.manual, r.deviation_reason, r.released_at, r.announcement, sp.number AS sprint,
              count(qi.id)::int AS questions, count(qi.id) FILTER (WHERE qi.status='SOLVED')::int AS solved,
              count(qi.id) FILTER (WHERE qi.status='EXPIRED')::int AS expired, count(qi.id) FILTER (WHERE qi.status='AVAILABLE')::int AS available,
              COALESCE(sum(qi.reward),0)::int AS budget
         FROM release r LEFT JOIN sprint sp ON sp.id=r.sprint_id LEFT JOIN question_instance qi ON qi.release_id=r.id
        WHERE r.slot_id=$1 GROUP BY r.id, sp.number ORDER BY sp.number NULLS FIRST, r.type, r.offset_seconds NULLS LAST, r.label`,
      [s.id],
    );
    out.push({
      ...slotDto(s),
      date: s.date,
      dayLabel: s.day_label,
      dayNumber: s.day_number,
      sprints: sprints.map((x) => sprintDto(x, now)),
      counts,
      releases,
      nextSprint: next,
      preflight: next ? await preflight(q, s.id, next) : null,
      result: s.phase === 'COMPLETED' ? await one(q, 'SELECT rows, note, confirmed_at FROM slot_result WHERE slot_id=$1', [s.id]) : null,
    });
  }
  const prizes = await many(q, 'SELECT place, label FROM prize_rule WHERE event_id=$1 ORDER BY place', [ev.id]);
  return {
    serverTime: new Date(now).toISOString(),
    event: { id: ev.id, name: ev.name, organizer: ev.organizer, edition: ev.edition, venue: ev.venue, timezone: ev.timezone, isDemo: ev.is_demo, phase: ev.phase, finalizedAt: ev.finalized_at, rulesFrozenAt: ev.rules_frozen_at, version: ev.version },
    rules: ev.rules,
    ruleReview: RULE_CATALOGUE.map((c) => ({ key: c.key, title: c.title, fairness: c.fairness, description: c.describe(ev.rules), confirmed: ev.rule_confirmations[c.key] ?? null })),
    unconfirmed: unconfirmedRules(ev.rule_confirmations),
    days,
    slots: out,
    prizes,
    eventResult: ev.phase === 'FINALIZED' ? await one(q, 'SELECT rows, note, confirmed_at FROM event_result WHERE event_id=$1', [ev.id]) : null,
    // Only slots without a release plan still need questions from the bank.
    bank: await bankCoverage(q, ev.rules, await unplannedSlots(q)),
  };
}

/** Rules can change until the first sprint of any slot starts. A changed rule loses its confirmation. */
export async function updateRules(tx: Tx, actor: Actor, patch: Partial<Rules>, expectedVersion?: number) {
  const ev = await getEvent(tx);
  await tx.query('SELECT id FROM event WHERE id=$1 FOR UPDATE', [ev.id]);
  if (expectedVersion !== undefined && expectedVersion !== ev.version) throw new AppError('STALE_VERSION', 'Rules changed since you loaded them.');
  if (ev.rules_frozen_at) throw new AppError('RULES_FROZEN', 'Rules are frozen: a sprint has already started.');
  const next = parseRules({ ...ev.rules, ...patch, blueprint: { ...ev.rules.blueprint, ...(patch.blueprint ?? {}) } });
  if (next.preset === 'STANDARD') next.sprintMinutes = next.sprintMinutes || 30;
  const changedKeys = RULE_CATALOGUE.filter((c) => c.describe(next) !== c.describe(ev.rules)).map((c) => c.key);
  const confirmations = { ...ev.rule_confirmations };
  for (const k of changedKeys) delete confirmations[k];
  await tx.query('UPDATE event SET rules=$2, rule_confirmations=$3, version=version+1 WHERE id=$1', [ev.id, JSON.stringify(next), JSON.stringify(confirmations)]);
  const notes: string[] = [];
  // Durations of sprints that have not started.
  const secs = sprintSeconds(next);
  const r = await tx.query(`UPDATE sprint SET duration_seconds=$1, eliminate_count=0, version=version+1 WHERE status='READY' AND duration_seconds<>$1`, [secs]);
  if (r.rowCount) notes.push(`${r.rowCount} not-yet-started sprint(s) now last ${Math.round(secs / 6) / 10} min.`);
  for (let i = 0; i < 4; i++) await tx.query(`UPDATE sprint SET eliminate_count=$1 WHERE status='READY' AND number=$2`, [next.elimination.enabled ? next.elimination.counts[i] : 0, i + 1]);
  await rescheduleBonuses(tx, next);
  // Rewards / hint costs of unreleased + unsolved instances follow the rules.
  for (const d of ['EASY', 'MEDIUM', 'HARD'] as const) {
    await tx.query(`UPDATE question_instance SET reward=$1, hint_cost=$2, version=version+1 WHERE kind<>'BONUS' AND difficulty=$3 AND status='AVAILABLE' AND (reward<>$1 OR hint_cost<>$2)`, [next.rewards[d], next.hintCosts[d], d]);
  }
  await tx.query(`UPDATE question_instance SET reward=$1, hint_cost=$2, version=version+1 WHERE kind='BONUS' AND status='AVAILABLE' AND (reward<>$1 OR hint_cost<>$2)`, [next.rewards.BONUS, next.hintCosts.BONUS]);
  if (['questionScope', 'initialPerDomain', 'extraPools', 'schedule'].some((k) => changedKeys.includes(k))) notes.push('Question scope or blueprint changed: rebuild each slot plan before starting.');
  await audit(tx, actor, 'rules.updated', { type: 'event', id: ev.id }, { changed: changedKeys, patch });
  await emit(tx, 'event.changed', [Rooms.organizers], { reason: 'RULES' });
  return { rules: next, changed: changedKeys, notes };
}

export async function confirmRule(tx: Tx, actor: Actor & { name: string }, key: string, confirmed: boolean) {
  const ev = await getEvent(tx);
  if (!RULE_CATALOGUE.find((c) => c.key === key)) throw new AppError('VALIDATION_FAILED', 'Unknown rule.');
  if (ev.rules_frozen_at && !confirmed) throw new AppError('RULES_FROZEN', 'Rules are frozen.');
  const c = { ...ev.rule_confirmations };
  if (confirmed) c[key] = { by: actor.id!, byName: actor.name, at: new Date().toISOString() };
  else delete c[key];
  await tx.query('UPDATE event SET rule_confirmations=$2, version=version+1 WHERE id=$1', [ev.id, JSON.stringify(c)]);
  await audit(tx, actor, confirmed ? 'rules.confirmed' : 'rules.unconfirmed', { type: 'event', id: ev.id }, { key });
  return { key, confirmed };
}

export async function updateEventInfo(tx: Tx, actor: Actor, patch: { name?: string; organizer?: string; edition?: string; venue?: string; prizes?: { place: number; label: string }[] }) {
  const ev = await getEvent(tx);
  for (const [k, v] of Object.entries({ name: patch.name, organizer: patch.organizer, edition: patch.edition, venue: patch.venue })) {
    if (v === undefined) continue;
    if (!v.trim() || v.length > 80) throw new AppError('VALIDATION_FAILED', `${k} must be 1-80 characters.`);
    await tx.query(`UPDATE event SET ${k}=$2, version=version+1 WHERE id=$1`, [ev.id, v.trim()]);
  }
  if (patch.prizes) {
    if (ev.phase === 'FINALIZED') throw new AppError('INVALID_TRANSITION', 'Results are final; prizes are frozen.');
    const places = patch.prizes.map((p) => p.place).sort((a, b) => a - b);
    if (places.some((p, i) => p !== i + 1)) throw new AppError('VALIDATION_FAILED', 'Prize places must be 1..N without gaps.');
    await tx.query('DELETE FROM prize_rule WHERE event_id=$1', [ev.id]);
    for (const p of patch.prizes) await tx.query('INSERT INTO prize_rule(event_id, place, label) VALUES ($1,$2,$3)', [ev.id, p.place, p.label.trim()]);
  }
  await audit(tx, actor, 'event.updated', { type: 'event', id: ev.id }, patch);
  await emit(tx, 'event.changed', [Rooms.all, Rooms.display], { reason: 'INFO' });
}

export async function updateSlot(tx: Tx, actor: Actor, slotId: string, patch: { name?: string; capacity?: number; scheduledStartAt?: string | null; phase?: 'READY' | 'WAITING' | 'CONFIGURING' }) {
  const s = await one<{ phase: string; current_sprint: number }>(tx, 'SELECT phase, current_sprint FROM slot WHERE id=$1 FOR UPDATE', [slotId]);
  if (!s) throw new AppError('NOT_FOUND', 'Slot not found.');
  if (patch.name !== undefined) await tx.query('UPDATE slot SET name=$2 WHERE id=$1', [slotId, patch.name.trim().slice(0, 60)]);
  if (patch.capacity !== undefined) {
    if (!Number.isInteger(patch.capacity) || patch.capacity < 1 || patch.capacity > 500) throw new AppError('VALIDATION_FAILED', 'Capacity must be 1-500.');
    await tx.query('UPDATE slot SET capacity=$2 WHERE id=$1', [slotId, patch.capacity]);
  }
  // Clock time is informational only — it never auto-starts anything.
  if (patch.scheduledStartAt !== undefined) await tx.query('UPDATE slot SET scheduled_start_at=$2 WHERE id=$1', [slotId, patch.scheduledStartAt]);
  if (patch.phase) {
    if (s.current_sprint > 0) throw new AppError('INVALID_TRANSITION', 'The slot has started; its phase follows the sprints.');
    await tx.query('UPDATE slot SET phase=$2 WHERE id=$1', [slotId, patch.phase]);
  }
  await tx.query('UPDATE slot SET version=version+1 WHERE id=$1', [slotId]);
  await audit(tx, actor, 'slot.updated', { type: 'slot', id: slotId }, patch);
  await emit(tx, 'slot.updated', [Rooms.slot(slotId), Rooms.organizers], { slotId });
}

export async function teamList(q: Queryable) {
  const ev = await getEvent(q);
  const board = await eventBoard(q, ev.id, ev.rules.rankingMetric);
  const byTeam = new Map([...board.active, ...board.inactive].map((r) => [r.teamId, r]));
  const teams = await many<Record<string, unknown>>(
    q,
    `SELECT t.id, t.crew_id, t.name, t.email, t.captain_name, t.color, t.account_enabled, t.checked_in_at, t.status, t.credential_status, t.created_via,
            (t.password_hash IS NOT NULL) AS has_credentials, t.must_change_password,
            s.id AS slot_id, s.number AS slot_number, s.name AS slot_name, to_char(d.date, 'YYYY-MM-DD') AS slot_date, se.status AS enrollment_status, se.id AS enrollment_id,
            (SELECT count(*)::int FROM session x WHERE x.team_id=t.id AND x.revoked_at IS NULL AND x.expires_at > now()) AS sessions,
            (SELECT json_agg(json_build_object('position', m.position, 'name', m.name, 'institution', m.institution, 'year', m.year, 'branch', m.branch, 'studentId', m.student_id) ORDER BY m.position) FROM team_member m WHERE m.team_id=t.id) AS members,
            (SELECT json_agg(json_build_object('id', dq.id, 'reason', dq.reason, 'createdAt', dq.created_at)) FROM disqualification dq WHERE dq.team_id=t.id AND dq.revoked_at IS NULL) AS disqualifications,
            (SELECT max(cd.created_at) FROM credential_delivery cd WHERE cd.team_id=t.id) AS last_credential_at
       FROM team t LEFT JOIN slot_enrollment se ON se.team_id=t.id LEFT JOIN slot s ON s.id=se.slot_id LEFT JOIN event_day d ON d.id=s.day_id
      WHERE t.event_id=$1 ORDER BY t.crew_id`,
    [ev.id],
  );
  return teams.map((t) => {
    const r = byTeam.get(t.id as string);
    return { ...t, standing: r ? { wallet: r.wallet, cumulative: r.cumulative, perSprint: r.perSprint, rank: r.rank, solves: r.solves } : null };
  });
}

export async function listSessions(q: Queryable, teamId: string) {
  return many(q, `SELECT id, created_at, last_seen_at, expires_at, user_agent, ip FROM session WHERE team_id=$1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC`, [teamId]);
}
export async function adminRevokeSession(tx: Tx, actor: Actor, sessionId: string) {
  await revokeSession(tx, sessionId, 'ORGANIZER_REVOKED');
  await audit(tx, actor, 'session.revoked', { type: 'session', id: sessionId });
}

export async function disqualify(tx: Tx, actor: Actor, teamId: string, reason: string) {
  if (!reason || reason.trim().length < 8) throw new AppError('VALIDATION_FAILED', 'A disqualification reason (min 8 characters) is required.');
  const t = await one<{ crew_id: string }>(tx, 'SELECT crew_id FROM team WHERE id=$1 FOR UPDATE', [teamId]);
  if (!t) throw new AppError('NOT_FOUND', 'Crew not found.');
  await tx.query(`INSERT INTO disqualification(team_id, reason, actor_id) VALUES ($1,$2,$3)`, [teamId, reason.trim(), actor.id]);
  const enr = await one<{ id: string; slot_id: string }>(tx, `UPDATE slot_enrollment SET status='DISQUALIFIED', version=version+1 WHERE team_id=$1 RETURNING id, slot_id`, [teamId]);
  if (enr) {
    await tx.query(`UPDATE run_job SET status='CANCELLED', finished_at=now(), error='Disqualified' WHERE enrollment_id=$1 AND status IN ('QUEUED','RUNNING')`, [enr.id]);
    await emit(tx, 'team.disqualified', [Rooms.slot(enr.slot_id), Rooms.organizers], { slotId: enr.slot_id, crewId: t.crew_id });
    await emit(tx, 'leaderboard.updated', [Rooms.slot(enr.slot_id), Rooms.organizers, Rooms.display], { slotId: enr.slot_id });
  }
  await emit(tx, 'eligibility.changed', [Rooms.team(teamId)], { teamId, disqualified: true });
  await audit(tx, actor, 'team.disqualified', { type: 'team', id: teamId }, { crewId: t.crew_id }, reason);
}

export async function revokeDisqualification(tx: Tx, actor: Actor, dqId: string, reason: string) {
  if (!reason || reason.trim().length < 8) throw new AppError('VALIDATION_FAILED', 'A correction reason (min 8 characters) is required.');
  const d = await one<{ team_id: string }>(tx, `UPDATE disqualification SET revoked_at=now(), revoked_by=$2, revoke_reason=$3 WHERE id=$1 AND revoked_at IS NULL RETURNING team_id`, [dqId, actor.id, reason.trim()]);
  if (!d) throw new AppError('NOT_FOUND', 'Active disqualification not found.');
  const still = await one(tx, 'SELECT id FROM disqualification WHERE team_id=$1 AND revoked_at IS NULL', [d.team_id]);
  if (!still) await tx.query(`UPDATE slot_enrollment SET status=CASE WHEN eliminated_sprint IS NULL THEN 'ACTIVE' ELSE 'ELIMINATED' END, version=version+1 WHERE team_id=$1 AND status='DISQUALIFIED'`, [d.team_id]);
  await audit(tx, actor, 'team.disqualification_revoked', { type: 'team', id: d.team_id }, { dqId }, reason);
  await emit(tx, 'eligibility.changed', [Rooms.team(d.team_id), Rooms.organizers], { teamId: d.team_id });
}

export async function announce(tx: Tx, actor: Actor, slotId: string | null, message: string, kind: 'INFO' | 'ALERT' = 'INFO') {
  const m = message?.trim();
  if (!m || m.length > 500) throw new AppError('VALIDATION_FAILED', 'Announcement must be 1-500 characters.');
  const ev = await getEvent(tx);
  const a = (await one<{ id: string; created_at: Date }>(tx, 'INSERT INTO announcement(event_id, slot_id, message, kind, actor_id) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at', [ev.id, slotId, m, kind, actor.id]))!;
  await audit(tx, actor, 'announcement.created', { type: 'announcement', id: a.id }, { slotId, kind });
  await emit(tx, 'announcement.created', slotId ? [Rooms.slot(slotId), Rooms.organizers] : [Rooms.all], { id: a.id, slotId, message: m, kind, createdAt: a.created_at });
  return a;
}

export async function ledger(q: Queryable, slotId: string, enrollmentId?: string) {
  return many(
    q,
    `SELECT l.id, l.kind, sp.number AS sprint, l.wallet_delta, l.earned_delta, l.spent_delta, l.grant_delta, l.score_delta, l.wallet_after, l.source_type, l.reason, l.created_at,
            t.crew_id, t.name AS team_name, o.display_name AS actor
       FROM coin_ledger l JOIN slot_enrollment se ON se.id=l.enrollment_id JOIN team t ON t.id=se.team_id
       LEFT JOIN sprint sp ON sp.id=l.sprint_id LEFT JOIN organizer_user o ON o.id=l.actor_id
      WHERE l.slot_id=$1 AND ($2::uuid IS NULL OR l.enrollment_id=$2) ORDER BY l.id DESC LIMIT 1000`,
    [slotId, enrollmentId ?? null],
  );
}

/** Reconciliation: cached wallet / earned / spent totals must equal the immutable ledger sums. */
export async function reconcile(q: Queryable) {
  return many(
    q,
    `SELECT t.crew_id, se.wallet_balance, se.earned_total, se.spent_total, x.w, x.e, x.s
       FROM slot_enrollment se JOIN team t ON t.id=se.team_id
       JOIN LATERAL (SELECT COALESCE(sum(wallet_delta),0)::int AS w, COALESCE(sum(earned_delta),0)::int AS e, COALESCE(sum(spent_delta),0)::int AS s FROM coin_ledger WHERE enrollment_id=se.id) x ON true
      WHERE se.wallet_balance<>x.w OR se.earned_total<>x.e OR se.spent_total<>x.s`,
  );
}

export async function auditLog(q: Queryable, limit = 200, offset = 0) {
  return many(
    q,
    `SELECT l.id, l.actor_type, l.action, l.target_type, l.target_id, l.reason, l.details, l.created_at, COALESCE(o.display_name, t.name) AS actor_name
       FROM audit_log l LEFT JOIN organizer_user o ON o.id=l.actor_id AND l.actor_type='ORGANIZER' LEFT JOIN team t ON t.id=l.actor_id AND l.actor_type='TEAM'
      ORDER BY l.id DESC LIMIT $1 OFFSET $2`,
    [Math.min(500, limit), Math.max(0, offset)],
  );
}

export async function mailOutbox(q: Queryable) {
  return many(q, `SELECT mc.id, mc.recipient, mc.subject, mc.body, mc.created_at, cd.reason, t.crew_id FROM mail_capture mc JOIN credential_delivery cd ON cd.id=mc.delivery_id JOIN team t ON t.id=cd.team_id ORDER BY mc.created_at DESC LIMIT 500`);
}

export async function health(db: Db, cfg: AppConfig, extra: { sockets: number; outboxCursor: number }) {
  const t0 = Date.now();
  let dbOk = true;
  try {
    await db.query('SELECT 1');
  } catch {
    dbOk = false;
  }
  const dbMs = Date.now() - t0;
  const hb = await many<{ name: string; age_s: number; info: unknown }>(db, `SELECT name, EXTRACT(EPOCH FROM (now() - beat_at)) AS age_s, info FROM worker_heartbeat`).catch(() => []);
  const outboxMax = (await one<{ m: number }>(db, 'SELECT COALESCE(max(id),0) AS m FROM outbox_event').catch(() => undefined))?.m ?? 0;
  const runner = await runnerHealth(cfg.runner);
  const queue = await one(db, `SELECT count(*) FILTER (WHERE status IN ('QUEUED','RUNNING'))::int AS active_runs FROM run_job WHERE created_at > now() - interval '10 minutes'`).catch(() => null);
  const deadlines = await many(db, `SELECT s.name AS slot, sp.number AS sprint, sp.status, sp.deadline_at FROM sprint sp JOIN slot s ON s.id=sp.slot_id WHERE sp.status IN ('RUNNING','PAUSED')`).catch(() => []);
  const drift = await reconcile(db).catch(() => []);
  return {
    db: { ok: dbOk, latencyMs: dbMs, pool: { total: db.totalCount, idle: db.idleCount, waiting: db.waitingCount } },
    workers: hb.map((h) => ({ name: h.name, ageSeconds: Math.round(Number(h.age_s)), healthy: Number(h.age_s) < 10, info: h.info })),
    outbox: { latestId: outboxMax, deliveredThrough: extra.outboxCursor, lag: Math.max(0, outboxMax - extra.outboxCursor) },
    runner,
    runQueue: queue,
    sockets: extra.sockets,
    deadlines,
    ledgerReconciled: drift.length === 0,
    ledgerDrift: drift,
    mail: { mode: cfg.mail.mode, smtpConfigured: !!cfg.mail.smtpUrl, sink: cfg.mail.sink },
  };
}

// ---------------------------------------------------------------------------
// Exports (CSV formula-injection safe; XLSX). Never include passwords.
// ---------------------------------------------------------------------------

export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(header: string[], rows: unknown[][]) {
  return [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';
}

export async function exportTable(q: Queryable, kind: 'teams' | 'slot-standings' | 'sprint-standings' | 'overall' | 'ledger' | 'audit', args: { slotId?: string; sprint?: number }) {
  const ev = await getEvent(q);
  const m = ev.rules.rankingMetric;
  if (kind === 'teams') {
    const teams = await teamList(q);
    return {
      name: 'teams',
      header: ['crew_id', 'team', 'captain_email', 'slot', 'account_enabled', 'checked_in', 'members', 'credential_status'],
      rows: teams.map((t: Record<string, any>) => [t.crew_id, t.name, t.email, t.slot_number ?? '', t.account_enabled, !!t.checked_in_at, ((t.members ?? []) as { name: string }[]).map((x) => x.name).join('; '), t.credential_status]),
    };
  }
  if (kind === 'overall') {
    const b = await eventBoard(q, ev.id, m);
    return { name: 'overall-standings', header: ['rank', 'crew_id', 'team', 'slot', `cumulative_${m}`, 's1', 's2', 's3', 's4', 'solves', 'status'], rows: b.active.map((r) => [r.rank, r.crewId, r.name, r.slotNumber, r.cumulative, r.perSprint['1'], r.perSprint['2'], r.perSprint['3'], r.perSprint['4'], r.solves, ev.phase === 'FINALIZED' ? 'FINAL' : 'PROVISIONAL']) };
  }
  if (!args.slotId) throw new AppError('VALIDATION_FAILED', 'slotId is required.');
  if (kind === 'slot-standings') {
    const b = await slotBoard(q, args.slotId, m);
    return { name: 'slot-standings', header: ['rank', 'crew_id', 'team', `cumulative_${m}`, 's1', 's2', 's3', 's4', 'earned', 'spent', 'wallet', 'solves'], rows: b.active.map((r) => [r.rank, r.crewId, r.name, r.cumulative, r.perSprint['1'], r.perSprint['2'], r.perSprint['3'], r.perSprint['4'], r.earned, r.spent, r.wallet, r.solves]) };
  }
  if (kind === 'sprint-standings') {
    const b = await sprintBoard(q, args.slotId, args.sprint ?? 1, m);
    return { name: `sprint-${args.sprint ?? 1}-standings`, header: ['rank', 'crew_id', 'team', `sprint_${m}`, 'cumulative'], rows: b.active.map((r) => [r.rank, r.crewId, r.name, r.score, r.cumulative]) };
  }
  if (kind === 'ledger') {
    const rows = await ledger(q, args.slotId);
    return { name: 'ledger', header: ['id', 'time', 'sprint', 'crew_id', 'team', 'kind', 'wallet_delta', 'earned_delta', 'spent_delta', 'score_delta', 'wallet_after', 'reason', 'actor'], rows: rows.map((r: Record<string, any>) => [r.id, r.created_at, r.sprint ?? '', r.crew_id, r.team_name, r.kind, r.wallet_delta, r.earned_delta, r.spent_delta, r.score_delta, r.wallet_after, r.reason, r.actor]) };
  }
  const rows = await auditLog(q, 500);
  return { name: 'audit', header: ['id', 'time', 'actor_type', 'actor', 'action', 'target', 'reason', 'details'], rows: rows.map((r: Record<string, any>) => [r.id, r.created_at, r.actor_type, r.actor_name, r.action, `${r.target_type ?? ''}:${r.target_id ?? ''}`, r.reason, r.details]) };
}

export async function exportFile(q: Queryable, kind: Parameters<typeof exportTable>[1], args: Parameters<typeof exportTable>[2], format: 'csv' | 'xlsx') {
  const t = await exportTable(q, kind, args);
  if (format === 'xlsx') return { filename: `${t.name}.xlsx`, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: await toXlsx(t.name, t.header, t.rows as (string | number | boolean | null)[][]) };
  return { filename: `${t.name}.csv`, type: 'text/csv; charset=utf-8', body: toCsv(t.header, t.rows) };
}

export { withTx, publicRow, revokeAllTeamSessions };
