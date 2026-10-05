import { many, one, type Queryable, type Tx } from '../db.js';
import { AppError } from '../errors.js';
import { audit, SYSTEM, type Actor } from './audit.js';
import { getEvent, getSprints, listSlots, type EventRow, type SlotRow, type SprintRow } from './context.js';
import { emit, Rooms } from './outbox.js';
import { eliminationPreview, eventBoard, publicRow, slotBoard, sprintBoard, topTies, type BoardRow } from './ranking.js';
import { releaseNow } from './releases.js';
import { RULE_CATALOGUE, unconfirmedRules } from './rules.js';

const fanout = (slotId: string) => [Rooms.slot(slotId), Rooms.organizers, Rooms.display];

export async function lockSlot(tx: Tx, slotId: string): Promise<SlotRow> {
  const s = await one<SlotRow>(tx, 'SELECT * FROM slot WHERE id=$1 FOR UPDATE', [slotId]);
  if (!s) throw new AppError('NOT_FOUND', 'Slot not found.');
  return s;
}

function checkVersion(s: { version: number }, expected?: number) {
  if (expected !== undefined && expected !== s.version) throw new AppError('STALE_VERSION', 'This slot changed since you loaded it. Review the latest state and try again.', { currentVersion: s.version });
}

async function bumpSlot(tx: Tx, slotId: string, fields: Record<string, unknown>): Promise<SlotRow> {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k}=$${i + 2}`).join(', ');
  return (await one<SlotRow>(tx, `UPDATE slot SET ${sets}${keys.length ? ',' : ''} version=version+1 WHERE id=$1 RETURNING *`, [slotId, ...keys.map((k) => fields[k])]))!;
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

export interface Preflight {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  summary: string[];
  unconfirmedRules: string[];
}

async function planStats(q: Queryable, slotId: string) {
  return many<{ sprint: number | null; type: string; count: number; budget: number; manual: number }>(
    q,
    `SELECT sp.number AS sprint, r.type, count(qi.id)::int AS count, COALESCE(sum(qi.reward),0)::int AS budget, count(*) FILTER (WHERE r.manual)::int AS manual
       FROM release r LEFT JOIN sprint sp ON sp.id=r.sprint_id LEFT JOIN question_instance qi ON qi.release_id=r.id
      WHERE r.slot_id=$1 AND r.status <> 'CANCELLED' GROUP BY sp.number, r.type ORDER BY sp.number NULLS FIRST, r.type`,
    [slotId],
  );
}

export async function preflight(q: Queryable, slotId: string, sprintNumber: number): Promise<Preflight> {
  const ev = await getEvent(q);
  const slot = await one<SlotRow>(q, 'SELECT * FROM slot WHERE id=$1', [slotId]);
  if (!slot) throw new AppError('NOT_FOUND', 'Slot not found.');
  const sprints = await getSprints(q, slotId);
  const target = sprints.find((s) => s.number === sprintNumber);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const summary: string[] = [];
  const unconfirmed = unconfirmedRules(ev.rule_confirmations);
  if (unconfirmed.length) {
    const names = unconfirmed.map((k) => RULE_CATALOGUE.find((c) => c.key === k)?.title ?? k).join(', ');
    if (ev.is_demo) warnings.push(`DEMO: running on UNCONFIRMED default rules (${names}). A production event requires every rule to be confirmed.`);
    else blockers.push(`Confirm every rule before activation. Unconfirmed: ${names}.`);
  }
  if (!target) blockers.push(`Sprint ${sprintNumber} does not exist.`);
  else if (target.status !== 'READY') blockers.push(`Sprint ${sprintNumber} is ${target.status}.`);
  if (sprintNumber > 1) {
    const prev = sprints.find((s) => s.number === sprintNumber - 1);
    if (!prev || !['CLOSED', 'FINALIZED'].includes(prev.status)) blockers.push(`Sprint ${sprintNumber - 1} has not been closed.`);
  }
  if (['REVIEW', 'COMPLETED'].includes(slot.phase)) blockers.push(`Slot is ${slot.phase}.`);
  if (ev.rules.singleRunningSlot) {
    const other = await one<{ name: string }>(q, `SELECT s.name FROM slot s JOIN sprint sp ON sp.slot_id=s.id AND sp.number=s.current_sprint
                                                   WHERE s.event_id=$1 AND s.id<>$2 AND sp.status IN ('RUNNING','PAUSED')`, [ev.id, slotId]);
    if (other) blockers.push(`${other.name} is running. Event policy allows one running slot at a time.`);
  }
  const crews = await one<{ total: number; enabled: number; nocred: number }>(
    q,
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE t.account_enabled)::int AS enabled, count(*) FILTER (WHERE t.password_hash IS NULL)::int AS nocred
       FROM slot_enrollment se JOIN team t ON t.id=se.team_id WHERE se.slot_id=$1 AND se.status='ACTIVE' AND t.status='ACTIVE'`,
    [slotId],
  );
  if (!crews?.total) blockers.push('No crews are assigned to this slot.');
  else {
    summary.push(`${crews.enabled} enabled crew(s) of ${crews.total} assigned (capacity ${slot.capacity}).`);
    if (crews.nocred) warnings.push(`${crews.nocred} crew(s) have no credentials yet — send credentials before the start.`);
    if (crews.enabled < crews.total) warnings.push(`${crews.total - crews.enabled} assigned crew(s) are disabled and cannot compete.`);
  }
  // Initial release must exist for this sprint (or the slot pool for sprint 1)
  const initial = await one<{ n: number }>(
    q,
    `SELECT count(qi.id)::int AS n FROM release r JOIN question_instance qi ON qi.release_id=r.id
      WHERE r.slot_id=$1 AND r.type='INITIAL' AND r.status IN ('SCHEDULED','PENDING','RELEASED')
        AND (${ev.rules.questionScope === 'FRESH_PER_SPRINT' ? 'r.sprint_id=$2' : 'r.sprint_id IS NULL'})`,
    [slotId, target?.id ?? null],
  );
  if (!initial?.n) blockers.push('No initial questions are planned for this sprint. Build the slot plan from the blueprint first.');
  else summary.push(`${initial.n} initial question(s) ${ev.rules.questionScope === 'FRESH_PER_SPRINT' ? `for sprint ${sprintNumber}` : 'in the slot pool'}.`);
  if (target) summary.push(`Sprint ${sprintNumber}: ${Math.round(target.duration_seconds / 6) / 10} active minutes (${ev.rules.preset}).`);
  // Comparability against the other slots: same counts and reward budget per sprint & type.
  const mine = await planStats(q, slotId);
  const slots = await listSlots(q, ev.id);
  for (const other of slots.filter((s) => s.id !== slotId)) {
    const theirs = await planStats(q, other.id);
    const key = (r: { sprint: number | null; type: string }) => `${r.sprint ?? 'pool'}:${r.type}`;
    const diff = [...new Set([...mine, ...theirs].map(key))].filter((k) => {
      const a = mine.find((r) => key(r) === k);
      const b = theirs.find((r) => key(r) === k);
      return (a?.count ?? 0) !== (b?.count ?? 0) || (a?.budget ?? 0) !== (b?.budget ?? 0);
    });
    if (theirs.length && diff.length) warnings.push(`Not comparable with ${other.name}: plan differs at ${diff.join(', ')} (question counts / reward budget). Raw totals are not normalized.`);
  }
  const manual = mine.reduce((a, r) => a + r.manual, 0);
  if (manual) warnings.push(`${manual} manual release(s) in this slot are recorded as fairness deviations.`);
  if (ev.rules.elimination.enabled) {
    const k = ev.rules.elimination.counts[sprintNumber - 1];
    summary.push(`Elimination ENABLED: ${k} crew(s) after sprint ${sprintNumber} (frozen standings; ties need a decision).`);
  } else summary.push('Elimination disabled.');
  summary.push(`Ranking basis: ${ev.rules.rankingMetric}.`);
  return { ok: blockers.length === 0, blockers, warnings, summary, unconfirmedRules: unconfirmed };
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/** Explicit activation. Stores the authoritative deadline and releases the sprint's initial questions. */
export async function startSprint(tx: Tx, actor: Actor, slotId: string, sprintNumber: number, opts: { expectedVersion?: number } = {}) {
  // Serialise starts across slots (single-running-slot policy).
  await tx.query('SELECT pg_advisory_xact_lock(727010)');
  const slot = await lockSlot(tx, slotId);
  checkVersion(slot, opts.expectedVersion);
  if (!['READY', 'WAITING', 'CONFIGURING'].includes(slot.phase)) throw new AppError('INVALID_TRANSITION', `Cannot start a sprint while the slot is ${slot.phase}.`);
  if (sprintNumber !== slot.current_sprint + 1) throw new AppError('INVALID_TRANSITION', `The next sprint for this slot is sprint ${slot.current_sprint + 1}.`);
  const pf = await preflight(tx, slotId, sprintNumber);
  if (!pf.ok) throw new AppError('PREFLIGHT_FAILED', 'Preflight checks failed.', { preflight: pf });
  const ev = await getEvent(tx);
  // Auto-finalize the previous sprint when no elimination applies to it (audited); otherwise it must be finalized explicitly.
  if (sprintNumber > 1) {
    const prev = (await one<SprintRow>(tx, 'SELECT * FROM sprint WHERE slot_id=$1 AND number=$2 FOR UPDATE', [slotId, sprintNumber - 1]))!;
    if (prev.status === 'CLOSED') {
      if (ev.rules.elimination.enabled && ev.rules.elimination.counts[sprintNumber - 2] > 0) throw new AppError('INVALID_TRANSITION', `Finalize sprint ${sprintNumber - 1} (elimination review) before starting sprint ${sprintNumber}.`);
      await tx.query(`UPDATE sprint SET status='FINALIZED', version=version+1 WHERE id=$1`, [prev.id]);
      await audit(tx, actor, 'sprint.finalized', { type: 'sprint', id: prev.id }, { slot: slot.number, sprint: prev.number, auto: true });
    }
  }
  if (!ev.rules_frozen_at) await tx.query('UPDATE event SET rules_frozen_at=now(), version=version+1 WHERE id=$1', [ev.id]);
  const sp = (await one<SprintRow>(
    tx,
    `UPDATE sprint SET status='RUNNING', started_at=clock_timestamp(), deadline_at=clock_timestamp() + make_interval(secs => duration_seconds), version=version+1
      WHERE slot_id=$1 AND number=$2 AND status='READY' RETURNING *`,
    [slotId, sprintNumber],
  ))!;
  if (!sp) throw new AppError('INVALID_TRANSITION', 'Sprint is not ready.');
  const updated = await bumpSlot(tx, slotId, { phase: 'RUNNING', current_sprint: sprintNumber });
  // Initial set (offset 0) for this sprint, or the slot pool at sprint 1.
  const initial = await many<{ id: string }>(
    tx,
    `SELECT id FROM release WHERE slot_id=$1 AND type='INITIAL' AND status IN ('SCHEDULED','PENDING') AND (sprint_id=$2 OR (sprint_id IS NULL AND $3::int = 1))`,
    [slotId, sp.id, sprintNumber],
  );
  // Part of the plan, not an override: released as SYSTEM (no deviation).
  for (const r of initial) await releaseNow(tx, SYSTEM, r.id);
  await audit(tx, actor, 'sprint.started', { type: 'slot', id: slotId }, { slot: slot.number, sprint: sprintNumber, deadlineAt: sp.deadline_at, warnings: pf.warnings });
  await emit(tx, 'sprint.started', fanout(slotId), { slotId, sprint: sprintNumber, startedAt: sp.started_at, deadlineAt: sp.deadline_at, version: updated.version });
  await emit(tx, 'leaderboard.updated', fanout(slotId), { slotId });
  return { slot: updated, sprint: sp, preflight: pf };
}

export async function pauseSprint(tx: Tx, actor: Actor, slotId: string, expectedVersion?: number) {
  const slot = await lockSlot(tx, slotId);
  checkVersion(slot, expectedVersion);
  const sp = await one<SprintRow>(tx, `UPDATE sprint SET status='PAUSED', paused_at=clock_timestamp(), version=version+1 WHERE slot_id=$1 AND number=$2 AND status='RUNNING' AND deadline_at > clock_timestamp() RETURNING *`, [slotId, slot.current_sprint]);
  if (!sp) throw new AppError('INVALID_TRANSITION', 'Only a running sprint (before its deadline) can be paused.');
  const updated = await bumpSlot(tx, slotId, {});
  await audit(tx, actor, 'sprint.paused', { type: 'slot', id: slotId }, { sprint: sp.number });
  await emit(tx, 'sprint.paused', fanout(slotId), { slotId, sprint: sp.number, pausedAt: sp.paused_at, version: updated.version });
  return { slot: updated, sprint: sp };
}

/** Resume shifts the deadline by the paused time; release offsets are in ACTIVE time, so they shift automatically. */
export async function resumeSprint(tx: Tx, actor: Actor, slotId: string, expectedVersion?: number) {
  const slot = await lockSlot(tx, slotId);
  checkVersion(slot, expectedVersion);
  const sp0 = await one<SprintRow & { delta_ms: number }>(tx, `SELECT *, EXTRACT(EPOCH FROM (clock_timestamp() - paused_at)) * 1000 AS delta_ms FROM sprint WHERE slot_id=$1 AND number=$2 AND status='PAUSED' FOR UPDATE`, [slotId, slot.current_sprint]);
  if (!sp0) throw new AppError('INVALID_TRANSITION', 'The sprint is not paused.');
  const delta = Math.max(0, Math.round(sp0.delta_ms));
  const sp = (await one<SprintRow>(
    tx,
    `UPDATE sprint SET status='RUNNING', deadline_at = deadline_at + make_interval(secs => $2::double precision / 1000), paused_total_ms = paused_total_ms + $2, paused_at=NULL, version=version+1 WHERE id=$1 RETURNING *`,
    [sp0.id, delta],
  ))!;
  const updated = await bumpSlot(tx, slotId, {});
  await audit(tx, actor, 'sprint.resumed', { type: 'slot', id: slotId }, { sprint: sp.number, pausedMs: delta, deadlineAt: sp.deadline_at });
  await emit(tx, 'sprint.resumed', fanout(slotId), { slotId, sprint: sp.number, deadlineAt: sp.deadline_at, version: updated.version });
  return { slot: updated, sprint: sp };
}

/**
 * Closes the running sprint at its authoritative deadline (worker) or early
 * (organizer, with reason). Expires fresh questions, cancels unreleased
 * releases (never replayed later), freezes sprint + slot snapshots.
 */
export async function closeSprint(tx: Tx, actor: Actor, slotId: string, reason: 'DEADLINE' | 'ORGANIZER', opts: { expectedVersion?: number; note?: string } = {}) {
  const slot = await lockSlot(tx, slotId);
  checkVersion(slot, opts.expectedVersion);
  if (slot.phase !== 'RUNNING') throw new AppError('INVALID_TRANSITION', `No running sprint to close (slot is ${slot.phase}).`);
  const sp = await one<SprintRow & { overdue: boolean }>(tx, `SELECT *, (deadline_at <= clock_timestamp()) AS overdue FROM sprint WHERE slot_id=$1 AND number=$2 FOR UPDATE`, [slotId, slot.current_sprint]);
  if (!sp || !['RUNNING', 'PAUSED'].includes(sp.status)) throw new AppError('INVALID_TRANSITION', 'Sprint is not running.');
  if (reason === 'DEADLINE' && (sp.status !== 'RUNNING' || !sp.overdue)) return null;
  if (reason === 'ORGANIZER' && (!opts.note || opts.note.trim().length < 4)) throw new AppError('VALIDATION_FAILED', 'Give a reason for closing early.');
  const expired = await tx.query(`UPDATE question_instance SET status='EXPIRED', version=version+1 WHERE expires_with_sprint_id=$1 AND status='AVAILABLE'`, [sp.id]);
  await tx.query(`UPDATE release SET status='CANCELLED', deviation_reason=COALESCE(deviation_reason, 'Sprint closed before release (not replayed)'), version=version+1 WHERE sprint_id=$1 AND status IN ('SCHEDULED','PENDING')`, [sp.id]);
  await tx.query(`UPDATE run_job SET status='CANCELLED', finished_at=now(), error='Sprint closed' WHERE slot_id=$1 AND status IN ('QUEUED','RUNNING')`, [slotId]);
  const ev = await getEvent(tx);
  const sb = await sprintBoard(tx, slotId, sp.number, ev.rules.rankingMetric);
  const cb = await slotBoard(tx, slotId, ev.rules.rankingMetric);
  const snap = (await one<{ id: string }>(
    tx,
    `INSERT INTO ranking_snapshot(event_id, slot_id, sprint_id, scope, metric, rows) VALUES ($1,$2,$3,'SPRINT',$4,$5) RETURNING id`,
    [ev.id, slotId, sp.id, ev.rules.rankingMetric, JSON.stringify({ sprint: sb.active.map(publicRow), cumulative: cb.active.map((r) => ({ ...publicRow(r), enrollmentId: r.enrollmentId })), inactive: cb.inactive.map(publicRow) })],
  ))!;
  const closed = (await one<SprintRow>(
    tx,
    `UPDATE sprint SET status='CLOSED', closed_at=${reason === 'DEADLINE' ? 'deadline_at' : 'clock_timestamp()'}, paused_at=NULL, close_reason=$2, frozen_snapshot_id=$3, version=version+1 WHERE id=$1 RETURNING *`,
    [sp.id, reason === 'DEADLINE' ? 'DEADLINE' : `ORGANIZER: ${opts.note!.trim()}`, snap.id],
  ))!;
  const updated = await bumpSlot(tx, slotId, { phase: sp.number === 4 ? 'REVIEW' : 'WAITING' });
  await audit(tx, actor, 'sprint.closed', { type: 'slot', id: slotId }, { slot: slot.number, sprint: sp.number, reason, expired: expired.rowCount }, opts.note);
  await emit(tx, 'sprint.closed', fanout(slotId), { slotId, sprint: sp.number, closedAt: closed.closed_at, reason, version: updated.version });
  await emit(tx, 'question.expired', [Rooms.slot(slotId), Rooms.organizers], { slotId, count: expired.rowCount });
  await emit(tx, 'leaderboard.updated', fanout(slotId), { slotId });
  return { slot: updated, sprint: closed, snapshotId: snap.id };
}

export interface TieResolution {
  mode: 'RETAIN_TIED' | 'ELIMINATE_TIED' | 'MANUAL_TIEBREAK';
  eliminateEnrollmentIds?: string[];
  note: string;
}

async function frozenCumulative(q: Queryable, sp: SprintRow): Promise<BoardRow[]> {
  const snap = await one<{ rows: { cumulative: (BoardRow & { enrollmentId: string })[] } }>(q, 'SELECT rows FROM ranking_snapshot WHERE id=$1', [sp.frozen_snapshot_id]);
  if (!snap) throw new AppError('INVALID_TRANSITION', 'No frozen standings for this sprint.');
  const still = new Set((await many<{ id: string }>(q, `SELECT se.id FROM slot_enrollment se WHERE se.slot_id=$1 AND se.status='ACTIVE'`, [sp.slot_id])).map((r) => r.id));
  return snap.rows.cumulative.filter((r) => still.has(r.enrollmentId));
}

/** Elimination preview (only meaningful when the elimination rule is enabled). */
export async function eliminationReview(q: Queryable, slotId: string, sprintNumber: number) {
  const ev = await getEvent(q);
  const sp = await one<SprintRow>(q, 'SELECT * FROM sprint WHERE slot_id=$1 AND number=$2', [slotId, sprintNumber]);
  if (!sp || sp.status !== 'CLOSED') throw new AppError('INVALID_TRANSITION', 'Sprint is not awaiting finalization.');
  const rows = await frozenCumulative(q, sp);
  const k = ev.rules.elimination.enabled ? ev.rules.elimination.counts[sprintNumber - 1] : 0;
  return { sprint: sp, rows, k, preview: eliminationPreview(rows, k), enabled: ev.rules.elimination.enabled };
}

/** CLOSED → FINALIZED. Applies the optional elimination (explicit decisions on cutoff ties). */
export async function finalizeSprint(tx: Tx, actor: Actor, slotId: string, sprintNumber: number, opts: { expectedVersion?: number; resolution?: TieResolution } = {}) {
  const slot = await lockSlot(tx, slotId);
  checkVersion(slot, opts.expectedVersion);
  const sp = await one<SprintRow>(tx, 'SELECT * FROM sprint WHERE slot_id=$1 AND number=$2 FOR UPDATE', [slotId, sprintNumber]);
  if (!sp || sp.status !== 'CLOSED') throw new AppError('INVALID_TRANSITION', sp?.status === 'FINALIZED' ? 'Sprint already finalized.' : 'Sprint is not closed.');
  const review = await eliminationReview(tx, slotId, sprintNumber);
  let eliminated: string[] = [];
  if (review.k > 0) {
    const pv = review.preview;
    if (pv.tie) {
      const r = opts.resolution;
      if (!r) throw new AppError('TIE_RESOLUTION_REQUIRED', 'A tie crosses the elimination cutoff. Record a published decision.', { tie: pv.tie });
      if (!r.note || r.note.trim().length < 8) throw new AppError('VALIDATION_FAILED', 'Record the published tiebreak decision (at least 8 characters).');
      if (r.mode === 'RETAIN_TIED') eliminated = [...pv.tie.strictlyBelow];
      else if (r.mode === 'ELIMINATE_TIED') eliminated = [...pv.tie.strictlyBelow, ...pv.tie.tiedEnrollmentIds];
      else {
        const pick = r.eliminateEnrollmentIds ?? [];
        if (pick.length !== pv.tie.needFromTie || pick.some((id) => !pv.tie!.tiedEnrollmentIds.includes(id))) throw new AppError('VALIDATION_FAILED', `Select exactly ${pv.tie.needFromTie} crew(s) from the tied group.`);
        eliminated = [...pv.tie.strictlyBelow, ...pick];
      }
    } else eliminated = pv.proposed;
    if (review.rows.length - eliminated.length < 1) throw new AppError('VALIDATION_FAILED', 'At least one crew must remain.');
    await tx.query(
      `INSERT INTO elimination_batch(slot_id, sprint_id, snapshot_id, configured_count, eliminated_enrollment_ids, resolution, note, confirmed_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [slotId, sp.id, sp.frozen_snapshot_id, review.k, eliminated, JSON.stringify(opts.resolution ?? { mode: 'STANDARD' }), opts.resolution?.note ?? null, actor.id],
    );
    if (eliminated.length) {
      await tx.query(`UPDATE slot_enrollment SET status='ELIMINATED', eliminated_sprint=$2, version=version+1 WHERE id = ANY($1) AND status='ACTIVE'`, [eliminated, sprintNumber]);
      const teams = await many<{ team_id: string }>(tx, 'SELECT team_id FROM slot_enrollment WHERE id = ANY($1)', [eliminated]);
      for (const t of teams) await emit(tx, 'team.eliminated', [Rooms.team(t.team_id)], { slotId, sprint: sprintNumber, you: true });
    }
  }
  await tx.query(`UPDATE sprint SET status='FINALIZED', version=version+1 WHERE id=$1`, [sp.id]);
  const updated = await bumpSlot(tx, slotId, {});
  await audit(tx, actor, 'sprint.finalized', { type: 'sprint', id: sp.id }, { slot: slot.number, sprint: sprintNumber, eliminated: eliminated.length }, opts.resolution?.note);
  await emit(tx, 'sprint.finalized', fanout(slotId), { slotId, sprint: sprintNumber, eliminated: eliminated.length, version: updated.version });
  return { slot: updated, eliminated };
}

export interface PlacementResolution {
  mode: 'SHARE' | 'MANUAL_ORDER';
  order?: string[];
  note: string;
}

function placements(rows: BoardRow[], ties: ReturnType<typeof topTies>, resolution: PlacementResolution | undefined) {
  let ordered = rows;
  let shared = true;
  if (ties.length) {
    if (!resolution) throw new AppError('TIE_RESOLUTION_REQUIRED', 'A tie involves the top places. Record a published tiebreak or a joint-winner decision.', { conflicts: ties });
    if (!resolution.note || resolution.note.trim().length < 8) throw new AppError('VALIDATION_FAILED', 'Record the published decision (at least 8 characters).');
    if (resolution.mode === 'MANUAL_ORDER') {
      const involved = ties.flatMap((c) => c.enrollmentIds);
      const order = resolution.order ?? [];
      if (order.length !== involved.length || involved.some((id) => !order.includes(id))) throw new AppError('VALIDATION_FAILED', 'Provide an order for every tied crew.');
      ordered = [...rows].sort((a, b) => b.score - a.score || order.indexOf(a.enrollmentId) - order.indexOf(b.enrollmentId));
      shared = false;
    }
  }
  return ordered.map((r, i) => ({ place: shared ? ordered.findIndex((x) => x.score === r.score) + 1 : i + 1, enrollmentId: r.enrollmentId, ...publicRow(r) }));
}

export async function slotResultsReview(q: Queryable, slotId: string) {
  const ev = await getEvent(q);
  const slot = await one<SlotRow>(q, 'SELECT * FROM slot WHERE id=$1', [slotId]);
  if (!slot) throw new AppError('NOT_FOUND', 'Slot not found.');
  const board = await slotBoard(q, slotId, ev.rules.rankingMetric);
  return { slot, board, conflicts: topTies(board.active, 3) };
}

/** Freeze the slot's resultant cumulative ranking after sprint 4. */
export async function finalizeSlot(tx: Tx, actor: Actor, slotId: string, opts: { expectedVersion?: number; resolution?: PlacementResolution } = {}) {
  const slot = await lockSlot(tx, slotId);
  checkVersion(slot, opts.expectedVersion);
  if (slot.phase !== 'REVIEW') throw new AppError('INVALID_TRANSITION', slot.phase === 'COMPLETED' ? 'Slot already finalized.' : 'Finish and close all four sprints first.');
  const s4 = await one<SprintRow>(tx, 'SELECT * FROM sprint WHERE slot_id=$1 AND number=4', [slotId]);
  if (s4?.status === 'CLOSED') {
    const ev0 = await getEvent(tx);
    if (ev0.rules.elimination.enabled && ev0.rules.elimination.counts[3] > 0) throw new AppError('INVALID_TRANSITION', 'Finalize sprint 4 (elimination review) first.');
    await tx.query(`UPDATE sprint SET status='FINALIZED', version=version+1 WHERE id=$1`, [s4.id]);
  }
  const { board, conflicts } = await slotResultsReview(tx, slotId);
  const rows = placements(board.active, conflicts, opts.resolution);
  const ev = await getEvent(tx);
  const snap = (await one<{ id: string }>(tx, `INSERT INTO ranking_snapshot(event_id, slot_id, scope, metric, rows) VALUES ($1,$2,'SLOT',$3,$4) RETURNING id`, [ev.id, slotId, ev.rules.rankingMetric, JSON.stringify(rows)]))!;
  await tx.query(`INSERT INTO slot_result(slot_id, snapshot_id, rows, resolution, note, confirmed_by) VALUES ($1,$2,$3,$4,$5,$6)`, [slotId, snap.id, JSON.stringify(rows), JSON.stringify(opts.resolution ?? { mode: 'NO_TIES' }), opts.resolution?.note ?? null, actor.id])
    .catch((err: { code?: string }) => {
      if (err.code === '23505') throw new AppError('INVALID_TRANSITION', 'Slot already finalized.');
      throw err;
    });
  const updated = await bumpSlot(tx, slotId, { phase: 'COMPLETED', finalized_at: new Date() });
  await audit(tx, actor, 'slot.finalized', { type: 'slot', id: slotId }, { slot: slot.number, top: rows.slice(0, 3).map((r) => [r.place, r.crewId, r.score]) }, opts.resolution?.note);
  await emit(tx, 'slot.finalized', fanout(slotId), { slotId, version: updated.version });
  return { slot: updated, rows };
}

export async function eventResultsReview(q: Queryable) {
  const ev = await getEvent(q);
  const board = await eventBoard(q, ev.id, ev.rules.rankingMetric);
  const prizes = await many<{ place: number; label: string }>(q, 'SELECT place, label FROM prize_rule WHERE event_id=$1 ORDER BY place', [ev.id]);
  const slots = await listSlots(q, ev.id);
  return { event: ev, board, prizes, slots, conflicts: topTies(board.active, Math.max(1, prizes.length)), allCompleted: slots.every((s) => s.phase === 'COMPLETED') };
}

/** Event results become final only after every slot is completed and ties are resolved. */
export async function finalizeEvent(tx: Tx, actor: Actor, opts: { expectedVersion?: number; resolution?: PlacementResolution } = {}) {
  const ev0 = await one<EventRow>(tx, 'SELECT * FROM event ORDER BY created_at LIMIT 1 FOR UPDATE');
  if (!ev0) throw new AppError('NOT_CONFIGURED', 'No event.');
  checkVersion(ev0, opts.expectedVersion);
  if (ev0.phase === 'FINALIZED') throw new AppError('INVALID_TRANSITION', 'Event results are already final.');
  const review = await eventResultsReview(tx);
  if (!review.allCompleted) throw new AppError('INVALID_TRANSITION', 'Finalize all four slots first.');
  const rows = placements(review.board.active, review.conflicts, opts.resolution).map((r) => ({ ...r, prize: review.prizes.find((p) => p.place === r.place)?.label ?? null }));
  const snap = (await one<{ id: string }>(tx, `INSERT INTO ranking_snapshot(event_id, scope, metric, rows) VALUES ($1,'EVENT',$2,$3) RETURNING id`, [ev0.id, review.event.rules.rankingMetric, JSON.stringify(rows)]))!;
  await tx.query(`INSERT INTO event_result(event_id, snapshot_id, rows, resolution, note, confirmed_by) VALUES ($1,$2,$3,$4,$5,$6)`, [ev0.id, snap.id, JSON.stringify(rows), JSON.stringify(opts.resolution ?? { mode: 'NO_TIES' }), opts.resolution?.note ?? null, actor.id]);
  await tx.query(`UPDATE event SET phase='FINALIZED', finalized_at=now(), version=version+1 WHERE id=$1`, [ev0.id]);
  await audit(tx, actor, 'event.finalized', { type: 'event', id: ev0.id }, { winner: rows[0] ? [rows[0].crewId, rows[0].score] : null }, opts.resolution?.note);
  await emit(tx, 'event.finalized', [Rooms.all, Rooms.display], { eventId: ev0.id });
  return { rows };
}
