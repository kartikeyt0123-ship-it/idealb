import { many, one, withTx, type Db, type Queryable, type Tx } from '../db.js';
import { AppError } from '../errors.js';
import { audit, SYSTEM, type Actor } from './audit.js';
import { activeElapsedSeconds, getEvent, type SlotRow, type SprintRow } from './context.js';
import { emit, Rooms } from './outbox.js';
import { scaledOffsetSeconds, type Rules } from './rules.js';

export interface ReleaseRow {
  id: string;
  slot_id: string;
  sprint_id: string | null;
  type: 'INITIAL' | 'RESERVE' | 'BONUS';
  label: string;
  status: 'PENDING' | 'SCHEDULED' | 'RELEASED' | 'CANCELLED';
  offset_seconds: number | null;
  expires_at_sprint_end: boolean;
  blueprint_key: string | null;
  announcement: string | null;
  manual: boolean;
  deviation_reason: string | null;
  released_at: Date | null;
  released_in_sprint_id: string | null;
  version: number;
}

/**
 * Releases a group of questions into its slot. The same service is used by the
 * scheduler and by organizers, and it is idempotent: releasing an already
 * released (or cancelled) release changes nothing. Releases only happen while
 * the slot's sprint is RUNNING (pause suspends releases).
 */
export async function releaseNow(tx: Tx, actor: Actor, releaseId: string, opts: { reason?: string } = {}) {
  const r0 = await one<ReleaseRow>(tx, 'SELECT * FROM release WHERE id=$1', [releaseId]);
  if (!r0) throw new AppError('NOT_FOUND', 'Release not found.');
  const slot = (await one<SlotRow>(tx, 'SELECT * FROM slot WHERE id=$1 FOR SHARE', [r0.slot_id]))!;
  const r = (await one<ReleaseRow>(tx, 'SELECT * FROM release WHERE id=$1 FOR UPDATE', [releaseId]))!;
  if (r.status === 'RELEASED') return { release: r, released: false };
  if (r.status === 'CANCELLED') throw new AppError('INVALID_TRANSITION', 'This release was cancelled.');
  const sprint = slot.current_sprint ? await one<SprintRow>(tx, 'SELECT * FROM sprint WHERE slot_id=$1 AND number=$2', [slot.id, slot.current_sprint]) : undefined;
  if (slot.phase !== 'RUNNING' || !sprint || sprint.status !== 'RUNNING') throw new AppError('SPRINT_NOT_RUNNING', 'Questions can only be released while the slot sprint is running (pause suspends releases).');
  if (r.sprint_id && r.sprint_id !== sprint.id) throw new AppError('INVALID_TRANSITION', 'This release belongs to a different sprint.');
  const manualEarly = actor.type === 'ORGANIZER' && r.status === 'SCHEDULED';
  if (manualEarly && !opts.reason?.trim()) throw new AppError('VALIDATION_FAILED', 'Releasing a scheduled release early changes slot comparability: give a reason (it is recorded as a fairness deviation).');
  const updated = (await one<ReleaseRow>(
    tx,
    `UPDATE release SET status='RELEASED', released_at=clock_timestamp(), released_in_sprint_id=$2, released_by=$3,
            deviation_reason=COALESCE($4, deviation_reason), manual = manual OR $5, version=version+1
      WHERE id=$1 RETURNING *`,
    [r.id, sprint.id, actor.id, manualEarly ? opts.reason!.trim() : null, manualEarly],
  ))!;
  // Fresh-per-sprint expiry: instances that expire at sprint end are bound to the sprint they appear in.
  if (r.expires_at_sprint_end) await tx.query(`UPDATE question_instance SET expires_with_sprint_id=$2, version=version+1 WHERE release_id=$1 AND status='AVAILABLE'`, [r.id, sprint.id]);
  const items = await many<{ id: string; label: string; difficulty: string; reward: number; title: string; domain: string }>(
    tx,
    `SELECT qi.id, qi.label, qi.difficulty, qi.reward, qv.title, d.name AS domain FROM question_instance qi
       JOIN question_version qv ON qv.id=qi.question_version_id JOIN domain d ON d.id=qi.domain_id WHERE qi.release_id=$1 ORDER BY qi.label`,
    [r.id],
  );
  await audit(tx, actor, 'release.released', { type: 'release', id: r.id }, { label: r.label, type: r.type, count: items.length, sprint: sprint.number, deviation: manualEarly ? opts.reason : null });
  const payload = { slotId: slot.id, releaseId: r.id, type: r.type, label: r.label, count: items.length, announcement: r.announcement };
  if (r.type === 'BONUS') {
    // Ship-wide alert for the slot (shows on open workspaces too). Titles only — never statements.
    await emit(tx, 'bonus.released', [Rooms.slot(slot.id), Rooms.organizers, Rooms.display], { ...payload, items: items.map((i) => ({ id: i.id, label: i.label, title: i.title, reward: i.reward, domain: i.domain })) });
  } else {
    await emit(tx, 'question.released', [Rooms.slot(slot.id), Rooms.organizers], payload);
  }
  return { release: updated, released: true };
}

export async function cancelRelease(tx: Tx, actor: Actor, releaseId: string, reason: string) {
  const r = await one<ReleaseRow>(tx, 'SELECT * FROM release WHERE id=$1 FOR UPDATE', [releaseId]);
  if (!r) throw new AppError('NOT_FOUND', 'Release not found.');
  if (r.status === 'RELEASED') throw new AppError('INVALID_TRANSITION', 'Released questions cannot be un-released; disable individual questions instead.');
  if (!reason || reason.trim().length < 4) throw new AppError('VALIDATION_FAILED', 'A reason is required.');
  await tx.query(`UPDATE release SET status='CANCELLED', deviation_reason=$2, version=version+1 WHERE id=$1`, [releaseId, reason.trim()]);
  await audit(tx, actor, 'release.cancelled', { type: 'release', id: releaseId }, { label: r.label }, reason);
}

/** Scheduler step (worker): releases due SCHEDULED releases of running sprints by active time. */
export async function releaseDue(db: Db): Promise<number> {
  const running = await many<SprintRow>(db, `SELECT sp.* FROM sprint sp JOIN slot s ON s.id=sp.slot_id WHERE sp.status='RUNNING' AND s.phase='RUNNING' AND s.current_sprint=sp.number`);
  let n = 0;
  for (const sp of running) {
    const elapsed = activeElapsedSeconds(sp, Date.now());
    const due = await many<{ id: string }>(db, `SELECT id FROM release WHERE sprint_id=$1 AND status='SCHEDULED' AND offset_seconds <= $2`, [sp.id, Math.floor(elapsed)]);
    for (const d of due) {
      const r = await withTx(db, (tx) => releaseNow(tx, SYSTEM, d.id)).catch(() => null);
      if (r?.released) n++;
    }
  }
  return n;
}

/** Re-applies scaled bonus offsets after a preset change (unreleased releases only). */
export async function rescheduleBonuses(tx: Tx, rules: Rules) {
  const rows = await many<{ id: string; blueprint_key: string }>(tx, `SELECT id, blueprint_key FROM release WHERE type='BONUS' AND status='SCHEDULED' AND blueprint_key LIKE 'bonus-s%'`);
  for (const r of rows) {
    const m = /^bonus-s(\d)-(\d+)$/.exec(r.blueprint_key);
    if (!m) continue;
    const minutes = rules.blueprint.bonusOffsetsMinutes[Number(m[1]) - 1]?.[Number(m[2]) - 1];
    if (minutes !== undefined) await tx.query('UPDATE release SET offset_seconds=$2, version=version+1 WHERE id=$1', [r.id, scaledOffsetSeconds(rules, minutes)]);
  }
}

/** Organizer-created release (manual override): always recorded as a fairness deviation with a reason. */
export async function createManualRelease(
  tx: Tx,
  actor: Actor,
  args: { slotId: string; sprintNumber: number | null; type: 'RESERVE' | 'BONUS' | 'INITIAL'; versionIds: string[]; offsetSeconds: number | null; expiresAtSprintEnd: boolean; announcement?: string; reason: string; releaseImmediately: boolean },
) {
  if (!args.reason || args.reason.trim().length < 8) throw new AppError('VALIDATION_FAILED', 'Manual releases break slot comparability: give a reason (min 8 characters).');
  if (!args.versionIds.length || args.versionIds.length > 60) throw new AppError('VALIDATION_FAILED', 'Select 1-60 questions.');
  const ev = await getEvent(tx);
  const slot = (await one<SlotRow>(tx, 'SELECT * FROM slot WHERE id=$1', [args.slotId]))!;
  if (!slot) throw new AppError('NOT_FOUND', 'Slot not found.');
  const sprint = args.sprintNumber ? await one<SprintRow>(tx, 'SELECT * FROM sprint WHERE slot_id=$1 AND number=$2', [slot.id, args.sprintNumber]) : undefined;
  if (args.sprintNumber && !sprint) throw new AppError('VALIDATION_FAILED', 'Unknown sprint.');
  const n = (await one<{ n: number }>(tx, 'SELECT count(*)::int AS n FROM release WHERE slot_id=$1 AND manual', [slot.id]))!.n + 1;
  const rid = (await one<{ id: string }>(
    tx,
    `INSERT INTO release(slot_id, sprint_id, type, label, status, offset_seconds, expires_at_sprint_end, announcement, manual, deviation_reason, blueprint_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10) RETURNING id`,
    [slot.id, sprint?.id ?? null, args.type, `Manual ${args.type.toLowerCase()} ${n}`, args.offsetSeconds !== null ? 'SCHEDULED' : 'PENDING', args.offsetSeconds, args.expiresAtSprintEnd, args.announcement ?? null, args.reason.trim(), `manual-${Date.now()}-${n}`],
  ))!.id;
  let k = 0;
  for (const vid of args.versionIds) {
    const v = await one<{ id: string; difficulty: string; domain_id: string; prefix: string; status: string }>(
      tx, `SELECT qv.id, qv.difficulty, q.domain_id, d.prefix, qv.status FROM question_version qv JOIN question q ON q.id=qv.question_id JOIN domain d ON d.id=q.domain_id WHERE qv.id=$1`, [vid],
    );
    if (!v || v.status !== 'PUBLISHED') throw new AppError('VALIDATION_FAILED', 'Only published questions can be released.');
    k++;
    const bonus = args.type === 'BONUS';
    const label = `${bonus ? 'BONUS' : v.prefix}-M${n}-${String(k).padStart(2, '0')}`;
    await tx.query(
      `INSERT INTO question_instance(slot_id, release_id, question_version_id, domain_id, kind, label, difficulty, reward, hint_cost) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [slot.id, rid, v.id, v.domain_id, args.type, label, v.difficulty,
        bonus ? ev.rules.rewards.BONUS : ev.rules.rewards[v.difficulty as 'EASY'], bonus ? ev.rules.hintCosts.BONUS : ev.rules.hintCosts[v.difficulty as 'EASY']],
    );
  }
  await audit(tx, actor, 'release.created_manual', { type: 'release', id: rid }, { slot: slot.number, type: args.type, count: k, fairnessDeviation: true }, args.reason);
  if (args.releaseImmediately) await releaseNow(tx, actor, rid, { reason: args.reason });
  return { releaseId: rid };
}
