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

// ---------------------------------------------------------------------------
// Slot plan from the blueprint (identical structure for every slot)
// ---------------------------------------------------------------------------

const DIFFS = ['EASY', 'MEDIUM', 'HARD'] as const;
/** Difficulty pattern for reserve batches (comparable across slots). */
const RESERVE_PATTERN: (typeof DIFFS)[number][] = ['EASY', 'MEDIUM', 'EASY', 'HARD', 'MEDIUM'];

const seedOf = (key: string) => Number(/-s(\d+)$/.exec(key)?.[1] ?? 0);

interface Pick {
  versionId: string;
  domainId: string;
  difficulty: (typeof DIFFS)[number];
}

/**
 * Deterministic picker over PUBLISHED versions not yet used by any slot.
 * Comparable slots get the same domain/difficulty mix; each slot gets
 * different question versions (no answer sharing across slots).
 */
async function picker(q: Queryable) {
  const versions = await many<{ id: string; domain_id: string; difficulty: (typeof DIFFS)[number]; pool: string; slug: string; key: string }>(
    q,
    `SELECT DISTINCT ON (qv.question_id) qv.id, q.domain_id, qv.difficulty, q.pool, d.slug, q.key
       FROM question_version qv JOIN question q ON q.id=qv.question_id JOIN domain d ON d.id=q.domain_id
      WHERE qv.status='PUBLISHED' AND NOT q.archived
        AND NOT EXISTS (SELECT 1 FROM question_instance qi WHERE qi.question_version_id IN (SELECT id FROM question_version WHERE question_id=qv.question_id))
      ORDER BY qv.question_id, qv.version_no DESC`,
  );
  // Deterministic: stable key order, then interleave templates so each slot gets a mix of templates.
  versions.sort((a, b) => seedOf(a.key) - seedOf(b.key) || a.key.localeCompare(b.key));
  const used = new Set<string>();
  const take = (pool: 'REGULAR' | 'BONUS', domainId: string | null, difficulty: (typeof DIFFS)[number] | null): Pick => {
    const v = versions.find((x) => !used.has(x.id) && x.pool === pool && (!domainId || x.domain_id === domainId) && (!difficulty || x.difficulty === difficulty));
    if (!v) throw new AppError('PREFLIGHT_FAILED', `Question bank exhausted: no unused published ${pool.toLowerCase()} question${domainId ? ' in that domain' : ''}${difficulty ? ` (${difficulty})` : ''}. Import or publish more questions.`);
    used.add(v.id);
    return { versionId: v.id, domainId: v.domain_id, difficulty: v.difficulty };
  };
  return { take, available: versions };
}

/** Coverage report used by preflight: how many unused published questions exist vs what the plan needs. */
export async function bankCoverage(q: Queryable, rules: Rules, slotsToPlan: number) {
  const { available } = await picker(q);
  const domains = await many<{ id: string; slug: string }>(q, 'SELECT id, slug FROM domain ORDER BY sort');
  const sprintsNeeding = rules.questionScope === 'FRESH_PER_SPRINT' ? 4 : 1;
  const rows = domains.flatMap((d) =>
    DIFFS.map((diff) => ({
      domain: d.slug,
      difficulty: diff,
      need: rules.initialPerDomain[diff] * sprintsNeeding * slotsToPlan,
      have: available.filter((v) => v.pool === 'REGULAR' && v.domain_id === d.id && v.difficulty === diff).length,
    })),
  );
  return {
    initial: rows,
    reserves: { need: rules.reservesPerSlot * slotsToPlan, have: available.filter((v) => v.pool === 'REGULAR').length },
    bonuses: { need: rules.bonusesPerSlot * slotsToPlan, have: available.filter((v) => v.pool === 'BONUS').length },
  };
}

/**
 * Creates the slot's releases + instances from the blueprint: initial (per
 * sprint or one slot pool), reserves (manual, five per sprint by default) and
 * scheduled bonuses. Only allowed before the slot's first sprint starts.
 */
export async function buildSlotPlan(tx: Tx, actor: Actor, slotId: string, take?: (pool: 'REGULAR' | 'BONUS', domainId: string | null, d: (typeof DIFFS)[number] | null) => Pick) {
  const ev = await getEvent(tx);
  const rules = ev.rules;
  const slot = (await one<SlotRow>(tx, 'SELECT * FROM slot WHERE id=$1 FOR UPDATE', [slotId]))!;
  if (slot.current_sprint > 0 || !['CONFIGURING', 'READY', 'WAITING'].includes(slot.phase)) throw new AppError('INVALID_TRANSITION', 'The release plan can only be (re)built before the slot starts.');
  const released = await one(tx, `SELECT id FROM release WHERE slot_id=$1 AND status='RELEASED' LIMIT 1`, [slotId]);
  if (released) throw new AppError('INVALID_TRANSITION', 'This slot already has released questions.');
  // Drop any previous unreleased plan (no solves can exist).
  await tx.query(`DELETE FROM question_instance WHERE slot_id=$1`, [slotId]);
  await tx.query(`DELETE FROM release WHERE slot_id=$1`, [slotId]);
  const pick = take ?? (await picker(tx)).take;
  const sprints = await many<SprintRow>(tx, 'SELECT * FROM sprint WHERE slot_id=$1 ORDER BY number', [slotId]);
  const domains = await many<{ id: string; prefix: string; slug: string }>(tx, 'SELECT id, prefix, slug FROM domain ORDER BY sort');
  const reward = (d: string, bonus = false) => (bonus ? rules.rewards.BONUS : rules.rewards[d as (typeof DIFFS)[number]]);
  const hint = (d: string, bonus = false) => (bonus ? rules.hintCosts.BONUS : rules.hintCosts[d as (typeof DIFFS)[number]]);
  let created = 0;

  const addRelease = async (r: { sprintId: string | null; type: 'INITIAL' | 'RESERVE' | 'BONUS'; label: string; status: 'PENDING' | 'SCHEDULED'; offset: number | null; expires: boolean; key: string; announcement?: string }) =>
    (await one<{ id: string }>(
      tx,
      `INSERT INTO release(slot_id, sprint_id, type, label, status, offset_seconds, expires_at_sprint_end, blueprint_key, announcement)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [slotId, r.sprintId, r.type, r.label, r.status, r.offset, r.expires, r.key, r.announcement ?? null],
    ))!.id;
  const addInstance = async (releaseId: string, kind: 'INITIAL' | 'RESERVE' | 'BONUS', p: Pick, label: string, expiresWith: string | null) => {
    await tx.query(
      `INSERT INTO question_instance(slot_id, release_id, question_version_id, domain_id, kind, label, difficulty, reward, hint_cost, expires_with_sprint_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [slotId, releaseId, p.versionId, p.domainId, kind, label, p.difficulty, reward(p.difficulty, kind === 'BONUS'), hint(p.difficulty, kind === 'BONUS'), expiresWith],
    );
    created++;
  };

  // Initial questions
  const initialSprints = rules.questionScope === 'FRESH_PER_SPRINT' ? sprints : [null];
  for (const sp of initialSprints) {
    const rid = await addRelease({
      sprintId: sp?.id ?? null, type: 'INITIAL', label: sp ? `Sprint ${sp.number} initial set` : 'Slot question pool', status: 'SCHEDULED', offset: 0,
      expires: !!sp, key: sp ? `initial-s${sp.number}` : 'initial-pool',
    });
    for (const d of domains) {
      let n = 0;
      for (const diff of DIFFS) {
        for (let k = 0; k < rules.initialPerDomain[diff]; k++) {
          n++;
          await addInstance(rid, 'INITIAL', pick('REGULAR', d.id, diff), sp ? `${d.prefix}-S${sp.number}-${String(n).padStart(2, '0')}` : `${d.prefix}-${String(n).padStart(2, '0')}`, sp?.id ?? null);
        }
      }
    }
  }
  // Reserves: one slot pool of single-question releases across mixed domains. The organizer
  // releases them with Refill, which tops up the domains depleted by solves (see refillSlot).
  // Unused reserves carry over to later sprints; released ones expire with their sprint.
  const fresh = rules.questionScope === 'FRESH_PER_SPRINT';
  for (let k = 0; k < rules.reservesPerSlot; k++) {
    const d = domains[k % domains.length];
    const diff = RESERVE_PATTERN[Math.floor(k / domains.length) % RESERVE_PATTERN.length];
    const n = String(k + 1).padStart(2, '0');
    const rid = await addRelease({ sprintId: null, type: 'RESERVE', label: `Reserve ${n} · ${d.slug}`, status: 'PENDING', offset: null, expires: fresh, key: `reserve-${n}` });
    await addInstance(rid, 'RESERVE', pick('REGULAR', d.id, diff), `RSV-${n}`, null);
  }
  // Bonuses: MANUAL (default) = a slot pool released by the organizer from time to time;
  // SCHEDULED = released automatically at the blueprint's active-minute offsets.
  if (rules.bonusMode === 'MANUAL') {
    for (let k = 0; k < rules.bonusesPerSlot; k++) {
      const n = String(k + 1).padStart(2, '0');
      const rid = await addRelease({
        sprintId: null, type: 'BONUS', label: `Bonus ${n}`, status: 'PENDING', offset: null, expires: true, key: `bonus-pool-${n}`,
        announcement: 'IMPOSTER DETECTED — an emergency bonus problem is live!',
      });
      await addInstance(rid, 'BONUS', pick('BONUS', null, null), `BONUS-${n}`, null);
    }
  } else {
    let bn = 0;
    for (const sp of sprints) {
      const offsets = rules.blueprint.bonusOffsetsMinutes[sp.number - 1];
      for (let k = 0; k < offsets.length; k++) {
        bn++;
        const rid = await addRelease({
          sprintId: sp.id, type: 'BONUS', label: `Bonus ${bn} (sprint ${sp.number}, +${offsets[k]} min)`, status: 'SCHEDULED', offset: scaledOffsetSeconds(rules, offsets[k]),
          expires: true, key: `bonus-s${sp.number}-${k + 1}`, announcement: 'IMPOSTER DETECTED — an emergency bonus problem is live!',
        });
        await addInstance(rid, 'BONUS', pick('BONUS', null, null), `BONUS-${String(bn).padStart(2, '0')}`, null);
      }
    }
  }
  await audit(tx, actor, 'slot.plan_built', { type: 'slot', id: slotId }, { instances: created, scope: rules.questionScope, bonusMode: rules.bonusMode });
  return { instances: created };
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

// ---------------------------------------------------------------------------
// Organizer pools: refill depleted domains from the reserve pool, release bonuses one at a time
// ---------------------------------------------------------------------------

export interface DomainStock {
  domainId: string;
  slug: string;
  name: string;
  /** Released, unsolved, unexpired regular questions open to crews right now. */
  available: number;
  /** Solved in the current sprint. */
  solved: number;
  /** Target = the initial per-domain count; deficit = target − available. */
  target: number;
  deficit: number;
  /** Unreleased reserve questions of this domain still in the slot pool. */
  pool: number;
}

async function currentSprintRow(q: Queryable, slotId: string) {
  const slot = await one<SlotRow>(q, 'SELECT * FROM slot WHERE id=$1', [slotId]);
  if (!slot) throw new AppError('NOT_FOUND', 'Slot not found.');
  const sprint = slot.current_sprint ? await one<SprintRow>(q, 'SELECT * FROM sprint WHERE slot_id=$1 AND number=$2', [slotId, slot.current_sprint]) : undefined;
  return { slot, sprint };
}

/** Per-domain stock for the slot's current sprint, plus what is left in the reserve and bonus pools. */
export async function poolStatus(q: Queryable, slotId: string) {
  const ev = await getEvent(q);
  const { slot, sprint } = await currentSprintRow(q, slotId);
  const target = ev.rules.initialPerDomain.EASY + ev.rules.initialPerDomain.MEDIUM + ev.rules.initialPerDomain.HARD;
  const rows = await many<{ id: string; slug: string; name: string; available: number; solved: number; pool: number }>(
    q,
    `SELECT d.id, d.slug, d.name,
            count(qi.id) FILTER (WHERE r.status='RELEASED' AND qi.status='AVAILABLE' AND qi.kind<>'BONUS' AND (qi.expires_with_sprint_id IS NULL OR qi.expires_with_sprint_id=$2))::int AS available,
            count(qi.id) FILTER (WHERE qi.status='SOLVED' AND qi.kind<>'BONUS' AND qi.solved_sprint_id=$2)::int AS solved,
            count(qi.id) FILTER (WHERE r.type='RESERVE' AND r.status='PENDING')::int AS pool
       FROM domain d
       LEFT JOIN question_instance qi ON qi.domain_id=d.id AND qi.slot_id=$1
       LEFT JOIN release r ON r.id=qi.release_id
      GROUP BY d.id ORDER BY d.sort`,
    [slotId, sprint?.id ?? null],
  );
  const domains: DomainStock[] = rows.map((r) => ({ domainId: r.id, slug: r.slug, name: r.name, available: r.available, solved: r.solved, target, deficit: Math.max(0, target - r.available), pool: r.pool }));
  const bonus = await one<{ pending: number; released: number }>(
    q,
    `SELECT count(*) FILTER (WHERE status='PENDING' AND (sprint_id IS NULL OR sprint_id=$2))::int AS pending, count(*) FILTER (WHERE status='RELEASED')::int AS released
       FROM release WHERE slot_id=$1 AND type='BONUS'`,
    [slotId, sprint?.id ?? null],
  );
  return {
    slotId,
    sprint: sprint ? { number: sprint.number, status: sprint.status } : null,
    running: slot.phase === 'RUNNING' && sprint?.status === 'RUNNING',
    domains,
    reservesLeft: domains.reduce((a, d) => a + d.pool, 0),
    totalDeficit: domains.reduce((a, d) => a + d.deficit, 0),
    bonusesLeft: bonus?.pending ?? 0,
    bonusesReleased: bonus?.released ?? 0,
    bonusMode: ev.rules.bonusMode,
  };
}

/**
 * Releases up to `count` reserve questions, one at a time, each into the domain
 * with the largest deficit (target − available) that still has reserves —
 * compensating for questions that disappeared through solves. `domain`
 * restricts the refill to one domain. Part of the plan: no fairness reason needed.
 */
export async function refillSlot(tx: Tx, actor: Actor, slotId: string, opts: { count?: number; domain?: string } = {}) {
  await tx.query('SELECT id FROM slot WHERE id=$1 FOR UPDATE', [slotId]);
  const status = await poolStatus(tx, slotId);
  if (!status.running) throw new AppError('SPRINT_NOT_RUNNING', 'Refill releases questions into a running sprint. Start (or resume) the sprint first.');
  const want = Math.min(Math.max(1, Math.floor(opts.count ?? (status.totalDeficit || 1))), 50);
  const stock = new Map(status.domains.map((d) => [d.slug, { ...d }]));
  if (opts.domain && !stock.has(opts.domain)) throw new AppError('VALIDATION_FAILED', 'Unknown domain.');
  const released: { label: string; domain: string; release: string }[] = [];
  for (let i = 0; i < want; i++) {
    const candidates = [...stock.values()].filter((d) => d.pool > 0 && (!opts.domain || d.slug === opts.domain));
    if (!candidates.length) break;
    // Largest deficit first; ties → most solved this sprint → domain order.
    candidates.sort((a, b) => b.target - b.available - (a.target - a.available) || b.solved - a.solved);
    const d = candidates[0];
    const r = await one<{ id: string; label: string }>(
      tx,
      `SELECT r.id, qi.label FROM release r JOIN question_instance qi ON qi.release_id=r.id
        WHERE r.slot_id=$1 AND r.type='RESERVE' AND r.status='PENDING' AND qi.domain_id=$2 ORDER BY r.blueprint_key LIMIT 1`,
      [slotId, d.domainId],
    );
    if (!r) {
      d.pool = 0;
      i--;
      continue;
    }
    await releaseNow(tx, actor, r.id);
    released.push({ label: r.label, domain: d.slug, release: r.id });
    d.pool--;
    d.available++;
  }
  if (!released.length) throw new AppError('POOL_EMPTY', opts.domain ? `No reserve questions left for ${opts.domain} in this slot.` : 'The reserve pool of this slot is empty.');
  await audit(tx, actor, 'release.refill', { type: 'slot', id: slotId }, { requested: want, released: released.map((r) => `${r.label}:${r.domain}`) });
  return { released, status: await poolStatus(tx, slotId) };
}

/** Releases the next bonus question of the slot's pool (MANUAL bonus mode). Open to every crew; first correct wins. */
export async function releaseNextBonus(tx: Tx, actor: Actor, slotId: string) {
  await tx.query('SELECT id FROM slot WHERE id=$1 FOR UPDATE', [slotId]);
  const { sprint } = await currentSprintRow(tx, slotId);
  const r = await one<{ id: string }>(
    tx,
    `SELECT id FROM release WHERE slot_id=$1 AND type='BONUS' AND status='PENDING' AND (sprint_id IS NULL OR sprint_id=$2) ORDER BY blueprint_key LIMIT 1`,
    [slotId, sprint?.id ?? null],
  );
  if (!r) throw new AppError('POOL_EMPTY', 'No bonus questions left in this slot’s pool.');
  const out = await releaseNow(tx, actor, r.id);
  return { release: out.release, status: await poolStatus(tx, slotId) };
}
