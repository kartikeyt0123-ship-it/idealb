/**
 * Question bank ↔ slots: what each slot gets, and when.
 *
 *  - Plan: before Sprint 1 a slot gets an INITIAL set per domain (default 7 easy,
 *    5 medium, 3 hard — rule `initialPerDomain`), auto-picked and editable
 *    (remove / add specific questions / rebuild with other counts). It is
 *    released when the organizer starts Sprint 1. With questionScope SLOT_POOL
 *    (default) released questions stay active for the whole slot.
 *  - Stock: per domain × difficulty, how many are active right now, solved,
 *    released and still planned, against the target.
 *  - Releases: the organizer picks bank questions (any domain / difficulty,
 *    as regular or bonus) and releases them now, or queues them for the next
 *    sprint start; "Top up" auto-picks enough to bring a domain back to target.
 *  - Reuse: questions used before (other slots, earlier sprints) may be used
 *    again. The picker prefers questions new to the slot, then the least used.
 */
import { createHash } from 'node:crypto';
import { many, one, type Queryable, type Tx } from '../db.js';
import { AppError } from '../errors.js';
import { audit, type Actor } from './audit.js';
import { getEvent, type SlotRow, type SprintRow } from './context.js';
import { emit, Rooms } from './outbox.js';
import { releaseNow } from './releases.js';
import { scaledOffsetSeconds, type Rules } from './rules.js';

export const DIFFS = ['EASY', 'MEDIUM', 'HARD'] as const;
export type Diff = (typeof DIFFS)[number];

interface Candidate {
  versionId: string;
  questionId: string;
  key: string;
  title: string;
  domainId: string;
  domain: string;
  difficulty: Diff;
  pool: 'REGULAR' | 'BONUS';
  usedInSlot: number;
  usedTotal: number;
}

/** Published, non-archived latest versions with usage counts (overall and in `slotId`). */
async function candidates(q: Queryable, slotId: string | null): Promise<Candidate[]> {
  return many<Candidate>(
    q,
    `SELECT v.id AS "versionId", q.id AS "questionId", q.key, v.title, q.domain_id AS "domainId", d.slug AS domain, v.difficulty, q.pool,
            (SELECT count(*)::int FROM question_instance qi JOIN question_version v2 ON v2.id=qi.question_version_id WHERE v2.question_id=q.id AND qi.slot_id=$1) AS "usedInSlot",
            (SELECT count(*)::int FROM question_instance qi JOIN question_version v2 ON v2.id=qi.question_version_id WHERE v2.question_id=q.id) AS "usedTotal"
       FROM question q JOIN domain d ON d.id=q.domain_id
       JOIN LATERAL (SELECT * FROM question_version WHERE question_id=q.id AND status='PUBLISHED' ORDER BY version_no DESC LIMIT 1) v ON true
      WHERE NOT q.archived`,
    [slotId],
  );
}

/** Deterministic per-slot shuffle so slots get different questions without randomness in tests. */
const mix = (slotId: string, key: string) => createHash('sha256').update(`${slotId}:${key}`).digest().readUInt32BE(0);

function makePicker(all: Candidate[], slotId: string, exclude: Set<string>) {
  const used = new Set<string>(exclude);
  return (f: { domainId?: string | null; difficulty?: Diff | null; pool?: 'REGULAR' | 'BONUS' | 'ANY' }): Candidate | undefined => {
    const pool = f.pool ?? 'REGULAR';
    const list = all
      .filter((c) => !used.has(c.questionId) && (pool === 'ANY' || c.pool === pool) && (!f.domainId || c.domainId === f.domainId) && (!f.difficulty || c.difficulty === f.difficulty))
      .sort((a, b) => a.usedInSlot - b.usedInSlot || a.usedTotal - b.usedTotal || mix(slotId, a.key) - mix(slotId, b.key));
    const pick = list[0];
    if (pick) used.add(pick.questionId);
    return pick;
  };
}

async function slotRow(q: Queryable, slotId: string) {
  const slot = await one<SlotRow>(q, 'SELECT * FROM slot WHERE id=$1', [slotId]);
  if (!slot) throw new AppError('NOT_FOUND', 'Slot not found.');
  return slot;
}

/** Next free instance label per domain prefix in a slot (CORE-01, CORE-02 …; BONUS-01 …). */
async function labeler(tx: Tx, slotId: string) {
  const rows = await many<{ label: string }>(tx, 'SELECT label FROM question_instance WHERE slot_id=$1', [slotId]);
  const taken = new Set(rows.map((r) => r.label));
  return (prefix: string) => {
    for (let n = 1; ; n++) {
      const l = `${prefix}-${String(n).padStart(2, '0')}`;
      if (!taken.has(l)) {
        taken.add(l);
        return l;
      }
    }
  };
}

async function insertInstance(tx: Tx, rules: Rules, slotId: string, releaseId: string, c: { versionId: string; domainId: string; difficulty: Diff }, kind: 'INITIAL' | 'RESERVE' | 'BONUS', label: string, expiresWith: string | null) {
  const bonus = kind === 'BONUS';
  await tx.query(
    `INSERT INTO question_instance(slot_id, release_id, question_version_id, domain_id, kind, label, difficulty, reward, hint_cost, expires_with_sprint_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [slotId, releaseId, c.versionId, c.domainId, kind, label, c.difficulty, bonus ? rules.rewards.BONUS : rules.rewards[c.difficulty], bonus ? rules.hintCosts.BONUS : rules.hintCosts[c.difficulty], expiresWith],
  );
}

// ---------------------------------------------------------------------------
// Coverage of the bank vs what unplanned slots need (used by overview)
// ---------------------------------------------------------------------------

export async function bankCoverage(q: Queryable, rules: Rules, slotsToPlan: number) {
  const all = await candidates(q, null);
  const domains = await many<{ id: string; slug: string }>(q, 'SELECT id, slug FROM domain ORDER BY sort');
  const sprintsNeeding = rules.questionScope === 'FRESH_PER_SPRINT' ? 4 : 1;
  return {
    reuse: true,
    initial: domains.flatMap((d) =>
      DIFFS.map((diff) => ({
        domain: d.slug,
        difficulty: diff,
        need: rules.initialPerDomain[diff] * sprintsNeeding * Math.min(1, slotsToPlan),
        have: all.filter((v) => v.pool === 'REGULAR' && v.domainId === d.id && v.difficulty === diff).length,
      })),
    ),
    reserves: { need: 0, have: all.filter((v) => v.pool === 'REGULAR').length },
    bonuses: { need: 0, have: all.length },
  };
}

// ---------------------------------------------------------------------------
// Slot plan (initial set) — auto-picked, editable before the slot starts
// ---------------------------------------------------------------------------

export type Counts = Partial<Record<Diff, number>>;

/**
 * (Re)builds the slot's unreleased INITIAL set(s): `counts` per domain (default
 * the rule's initialPerDomain, e.g. 7/5/3). With SLOT_POOL one set is released
 * at Sprint 1; with FRESH_PER_SPRINT one set per sprint. Never touches released
 * questions. Optional `domains` limits the rebuild to some domains.
 */
export async function buildSlotPlan(tx: Tx, actor: Actor, slotId: string, opts: { counts?: Counts; perDomain?: Record<string, Counts>; domains?: string[] } = {}) {
  const ev = await getEvent(tx);
  const rules = ev.rules;
  const slot = (await one<SlotRow>(tx, 'SELECT * FROM slot WHERE id=$1 FOR UPDATE', [slotId]))!;
  if (!slot) throw new AppError('NOT_FOUND', 'Slot not found.');
  if (['REVIEW', 'COMPLETED'].includes(slot.phase)) throw new AppError('INVALID_TRANSITION', 'This slot is finished.');
  const sprints = await many<SprintRow>(tx, 'SELECT * FROM sprint WHERE slot_id=$1 ORDER BY number', [slotId]);
  const pending = sprints.filter((s) => s.status === 'READY');
  const targets = rules.questionScope === 'FRESH_PER_SPRINT' ? pending : slot.current_sprint === 0 ? sprints.filter((s) => s.number === 1) : [];
  if (!targets.length) throw new AppError('INVALID_TRANSITION', 'The initial set was already released. Use Release / Top up to add questions.');
  const domains = (await many<{ id: string; slug: string; prefix: string }>(tx, 'SELECT id, slug, prefix FROM domain ORDER BY sort')).filter((d) => !opts.domains?.length || opts.domains.includes(d.slug));
  // Drop the unreleased initial plan for the affected sprints / domains.
  const releases = await many<{ id: string }>(tx, `SELECT id FROM release WHERE slot_id=$1 AND type='INITIAL' AND status IN ('PENDING','SCHEDULED') AND sprint_id = ANY($2)`, [slotId, targets.map((s) => s.id)]);
  if (releases.length) {
    await tx.query(`DELETE FROM question_instance WHERE release_id = ANY($1) AND domain_id = ANY($2)`, [releases.map((r) => r.id), domains.map((d) => d.id)]);
  }
  const keep = await many<{ question_id: string }>(tx, `SELECT DISTINCT v.question_id FROM question_instance qi JOIN question_version v ON v.id=qi.question_version_id WHERE qi.slot_id=$1`, [slotId]);
  const pick = makePicker(await candidates(tx, slotId), slotId, new Set(keep.map((k) => k.question_id)));
  const label = await labeler(tx, slotId);
  const short: string[] = [];
  let created = 0;
  for (const sp of targets) {
    let rid = (await one<{ id: string }>(tx, `SELECT id FROM release WHERE slot_id=$1 AND type='INITIAL' AND sprint_id=$2 AND status IN ('PENDING','SCHEDULED') LIMIT 1`, [slotId, sp.id]))?.id;
    if (!rid) {
      rid = (await one<{ id: string }>(
        tx,
        `INSERT INTO release(slot_id, sprint_id, type, label, status, offset_seconds, expires_at_sprint_end, blueprint_key) VALUES ($1,$2,'INITIAL',$3,'SCHEDULED',0,$4,$5) RETURNING id`,
        [slotId, sp.id, `Sprint ${sp.number} initial set`, rules.questionScope === 'FRESH_PER_SPRINT', `initial-s${sp.number}`],
      ))!.id;
    }
    for (const d of domains) {
      const counts = { ...rules.initialPerDomain, ...(opts.counts ?? {}), ...(opts.perDomain?.[d.slug] ?? {}) };
      for (const diff of DIFFS) {
        for (let k = 0; k < (counts[diff] ?? 0); k++) {
          const c = pick({ domainId: d.id, difficulty: diff });
          if (!c) {
            short.push(`${d.slug}/${diff}`);
            break;
          }
          await insertInstance(tx, rules, slotId, rid, c, 'INITIAL', label(d.prefix), rules.questionScope === 'FRESH_PER_SPRINT' ? sp.id : null);
          created++;
        }
      }
    }
  }
  // Legacy automatic bonus schedule (rule bonusMode SCHEDULED).
  if (rules.bonusMode === 'SCHEDULED' && slot.current_sprint === 0) {
    await tx.query(`DELETE FROM question_instance WHERE release_id IN (SELECT id FROM release WHERE slot_id=$1 AND type='BONUS' AND status='SCHEDULED')`, [slotId]);
    await tx.query(`DELETE FROM release WHERE slot_id=$1 AND type='BONUS' AND status='SCHEDULED'`, [slotId]);
    let bn = 0;
    for (const sp of sprints) {
      for (const [k, minutes] of rules.blueprint.bonusOffsetsMinutes[sp.number - 1].entries()) {
        const c = pick({ pool: 'BONUS' }) ?? pick({ difficulty: 'HARD' });
        if (!c) break;
        bn++;
        const rid = (await one<{ id: string }>(
          tx,
          `INSERT INTO release(slot_id, sprint_id, type, label, status, offset_seconds, expires_at_sprint_end, blueprint_key, announcement) VALUES ($1,$2,'BONUS',$3,'SCHEDULED',$4,true,$5,$6) RETURNING id`,
          [slotId, sp.id, `Bonus ${bn} (sprint ${sp.number}, +${minutes} min)`, scaledOffsetSeconds(rules, minutes), `bonus-s${sp.number}-${k + 1}`, 'IMPOSTER DETECTED — an emergency bonus problem is live!'],
        ))!.id;
        await insertInstance(tx, rules, slotId, rid, c, 'BONUS', label('BONUS'), null);
        created++;
      }
    }
  }
  await audit(tx, actor, 'slot.plan_built', { type: 'slot', id: slotId }, { instances: created, counts: opts.counts ?? rules.initialPerDomain, perDomain: opts.perDomain ?? null, domains: opts.domains ?? 'all', short });
  await emit(tx, 'slot.updated', [Rooms.organizers], { slotId });
  return { instances: created, short };
}

/** Pending (unreleased) initial set of a slot, grouped for the editor. */
export async function initialSet(q: Queryable, slotId: string) {
  return many(
    q,
    `SELECT qi.id, qi.label, qi.difficulty, qi.reward, d.slug AS domain, d.name AS domain_name, v.title, q.key, sp.number AS sprint, v.workspace
       FROM question_instance qi JOIN release r ON r.id=qi.release_id JOIN domain d ON d.id=qi.domain_id
       JOIN question_version v ON v.id=qi.question_version_id JOIN question q ON q.id=v.question_id LEFT JOIN sprint sp ON sp.id=r.sprint_id
      WHERE qi.slot_id=$1 AND r.status IN ('PENDING','SCHEDULED') ORDER BY sp.number NULLS LAST, d.sort, array_position(ARRAY['EASY','MEDIUM','HARD'], qi.difficulty), qi.label`,
    [slotId],
  );
}

/** Removes one question from a not-yet-released set. */
export async function removePlanned(tx: Tx, actor: Actor, slotId: string, instanceId: string) {
  const row = await one<{ id: string; label: string }>(
    tx,
    `SELECT qi.id, qi.label FROM question_instance qi JOIN release r ON r.id=qi.release_id WHERE qi.id=$1 AND qi.slot_id=$2 AND r.status IN ('PENDING','SCHEDULED') FOR UPDATE OF qi`,
    [instanceId, slotId],
  );
  if (!row) throw new AppError('INVALID_TRANSITION', 'Only questions that have not been released yet can be removed.');
  await tx.query('DELETE FROM question_instance WHERE id=$1', [instanceId]);
  await audit(tx, actor, 'slot.plan_removed', { type: 'slot', id: slotId }, { label: row.label });
  await emit(tx, 'slot.updated', [Rooms.organizers], { slotId });
  return { removed: row.label };
}

// ---------------------------------------------------------------------------
// Live stock: per domain × difficulty
// ---------------------------------------------------------------------------

export async function slotStock(q: Queryable, slotId: string) {
  const ev = await getEvent(q);
  const slot = await slotRow(q, slotId);
  const sprint = slot.current_sprint ? await one<SprintRow>(q, 'SELECT * FROM sprint WHERE slot_id=$1 AND number=$2', [slotId, slot.current_sprint]) : undefined;
  const rows = await many<{ domain: string; name: string; difficulty: Diff; active: number; solved: number; solved_sprint: number; released: number; planned: number }>(
    q,
    `SELECT d.slug AS domain, d.name, x.diff AS difficulty,
            count(qi.id) FILTER (WHERE r.status='RELEASED' AND qi.status='AVAILABLE' AND qi.kind<>'BONUS' AND (qi.expires_with_sprint_id IS NULL OR qi.expires_with_sprint_id=$2))::int AS active,
            count(qi.id) FILTER (WHERE qi.status='SOLVED' AND qi.kind<>'BONUS')::int AS solved,
            count(qi.id) FILTER (WHERE qi.status='SOLVED' AND qi.kind<>'BONUS' AND qi.solved_sprint_id=$2)::int AS solved_sprint,
            count(qi.id) FILTER (WHERE r.status='RELEASED' AND qi.kind<>'BONUS')::int AS released,
            count(qi.id) FILTER (WHERE r.status IN ('PENDING','SCHEDULED') AND qi.kind<>'BONUS')::int AS planned
       FROM domain d CROSS JOIN (VALUES ('EASY',1),('MEDIUM',2),('HARD',3)) AS x(diff, o)
       LEFT JOIN question_instance qi ON qi.domain_id=d.id AND qi.slot_id=$1 AND qi.difficulty=x.diff
       LEFT JOIN release r ON r.id=qi.release_id
      GROUP BY d.slug, d.name, d.sort, x.diff, x.o ORDER BY d.sort, x.o`,
    [slotId, sprint?.id ?? null],
  );
  const bank = await candidates(q, slotId);
  const bonus = await one<{ active: number; solved: number; released: number }>(
    q,
    `SELECT count(*) FILTER (WHERE r.status='RELEASED' AND qi.status='AVAILABLE' AND (qi.expires_with_sprint_id IS NULL OR qi.expires_with_sprint_id=$2))::int AS active,
            count(*) FILTER (WHERE qi.status='SOLVED')::int AS solved, count(*) FILTER (WHERE r.status='RELEASED')::int AS released
       FROM question_instance qi JOIN release r ON r.id=qi.release_id WHERE qi.slot_id=$1 AND qi.kind='BONUS'`,
    [slotId, sprint?.id ?? null],
  );
  const domains = [...new Set(rows.map((r) => r.domain))].map((slug) => {
    const rs = rows.filter((r) => r.domain === slug);
    const byDifficulty = Object.fromEntries(rs.map((r) => {
      const inBank = bank.filter((b) => b.domain === slug && b.difficulty === r.difficulty && b.pool === 'REGULAR');
      return [r.difficulty, {
        active: r.active, solved: r.solved, solvedThisSprint: r.solved_sprint, released: r.released, planned: r.planned,
        target: ev.rules.initialPerDomain[r.difficulty], low: r.active < ev.rules.initialPerDomain[r.difficulty],
        bankTotal: inBank.length, bankFresh: inBank.filter((b) => b.usedInSlot === 0).length,
      }];
    })) as Record<Diff, { active: number; solved: number; solvedThisSprint: number; released: number; planned: number; target: number; low: boolean; bankTotal: number; bankFresh: number }>;
    const sum = (k: 'active' | 'solved' | 'released' | 'planned' | 'target') => DIFFS.reduce((a, d) => a + byDifficulty[d][k], 0);
    return { slug, name: rs[0].name, byDifficulty, totals: { active: sum('active'), solved: sum('solved'), released: sum('released'), planned: sum('planned'), target: sum('target') } };
  });
  return {
    slotId,
    slot: { number: slot.number, name: slot.name, phase: slot.phase, currentSprint: slot.current_sprint, opened: !!slot.opened_at },
    sprint: sprint ? { number: sprint.number, status: sprint.status } : null,
    running: slot.phase === 'RUNNING' && sprint?.status === 'RUNNING',
    targets: ev.rules.initialPerDomain,
    domains,
    bonus: bonus ?? { active: 0, solved: 0, released: 0 },
    totals: { active: domains.reduce((a, d) => a + d.totals.active, 0), planned: domains.reduce((a, d) => a + d.totals.planned, 0), target: domains.reduce((a, d) => a + d.totals.target, 0) },
  };
}

// ---------------------------------------------------------------------------
// Bank browser for one slot (with usage) and releases from the bank
// ---------------------------------------------------------------------------

export async function bankForSlot(q: Queryable, slotId: string, f: { domain?: string; difficulty?: Diff; search?: string; freshOnly?: boolean } = {}) {
  await slotRow(q, slotId);
  const all = await candidates(q, slotId);
  const s = f.search?.trim().toLowerCase();
  return all
    .filter((c) => (!f.domain || c.domain === f.domain) && (!f.difficulty || c.difficulty === f.difficulty) && (!f.freshOnly || c.usedInSlot === 0) && (!s || `${c.key} ${c.title}`.toLowerCase().includes(s)))
    .sort((a, b) => a.domain.localeCompare(b.domain) || DIFFS.indexOf(a.difficulty) - DIFFS.indexOf(b.difficulty) || a.key.localeCompare(b.key, undefined, { numeric: true }));
}

/**
 * Releases chosen bank questions into a slot. `when`:
 *   NOW         visible to every crew of the slot immediately (sprint must be running)
 *   NEXT_START  added to the set released when the next sprint starts
 * `bonus` releases them as BONUS (IMPOSTER DETECTED, bonus reward). Previously
 * used questions may be released again (organizer's choice).
 */
export async function releaseFromBank(tx: Tx, actor: Actor, slotId: string, args: { versionIds: string[]; bonus?: boolean; when?: 'NOW' | 'NEXT_START'; announcement?: string }) {
  if (!args.versionIds.length || args.versionIds.length > 120) throw new AppError('VALIDATION_FAILED', 'Select 1-120 questions.');
  const ev = await getEvent(tx);
  const slot = (await one<SlotRow>(tx, 'SELECT * FROM slot WHERE id=$1 FOR UPDATE', [slotId]))!;
  if (!slot) throw new AppError('NOT_FOUND', 'Slot not found.');
  if (['REVIEW', 'COMPLETED'].includes(slot.phase)) throw new AppError('INVALID_TRANSITION', 'This slot is finished.');
  const sprints = await many<SprintRow>(tx, 'SELECT * FROM sprint WHERE slot_id=$1 ORDER BY number', [slotId]);
  const cur = sprints.find((s) => s.number === slot.current_sprint);
  const running = slot.phase === 'RUNNING' && cur?.status === 'RUNNING';
  const when = args.when ?? (running ? 'NOW' : 'NEXT_START');
  if (when === 'NOW' && !running) throw new AppError('SPRINT_NOT_RUNNING', 'Release now needs a running sprint. Choose "next sprint start" instead.');
  const next = sprints.find((s) => s.status === 'READY');
  if (when === 'NEXT_START' && !next) throw new AppError('INVALID_TRANSITION', 'No sprint left to start in this slot.');
  const versions = await many<{ id: string; domain_id: string; difficulty: Diff; prefix: string; status: string }>(
    tx,
    `SELECT v.id, q.domain_id, v.difficulty, d.prefix, v.status FROM question_version v JOIN question q ON q.id=v.question_id JOIN domain d ON d.id=q.domain_id WHERE v.id = ANY($1)`,
    [args.versionIds],
  );
  if (versions.length !== new Set(args.versionIds).size || versions.some((v) => v.status !== 'PUBLISHED')) throw new AppError('VALIDATION_FAILED', 'Only published questions can be released.');
  const kind = args.bonus ? 'BONUS' : when === 'NEXT_START' ? 'INITIAL' : 'RESERVE';
  let rid: string;
  if (kind === 'INITIAL') {
    // Join the next sprint's start set (create it if needed).
    rid = (await one<{ id: string }>(tx, `SELECT id FROM release WHERE slot_id=$1 AND type='INITIAL' AND sprint_id=$2 AND status IN ('PENDING','SCHEDULED') LIMIT 1`, [slotId, next!.id]))?.id
      ?? (await one<{ id: string }>(tx, `INSERT INTO release(slot_id, sprint_id, type, label, status, offset_seconds, expires_at_sprint_end) VALUES ($1,$2,'INITIAL',$3,'SCHEDULED',0,$4) RETURNING id`, [slotId, next!.id, `Sprint ${next!.number} start set`, ev.rules.questionScope === 'FRESH_PER_SPRINT']))!.id;
  } else {
    const n = (await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM release WHERE slot_id=$1 AND type=$2`, [slotId, kind]))!.n + 1;
    const target = when === 'NOW' ? cur! : next!;
    rid = (await one<{ id: string }>(
      tx,
      `INSERT INTO release(slot_id, sprint_id, type, label, status, offset_seconds, expires_at_sprint_end, announcement) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [slotId, when === 'NOW' ? null : target.id, kind, `${kind === 'BONUS' ? 'Bonus' : 'Top-up'} ${n}`, when === 'NOW' ? 'PENDING' : 'SCHEDULED', when === 'NOW' ? null : 0, kind === 'BONUS' || ev.rules.questionScope === 'FRESH_PER_SPRINT', kind === 'BONUS' ? (args.announcement ?? 'IMPOSTER DETECTED — an emergency bonus problem is live!') : (args.announcement ?? null)],
    ))!.id;
  }
  const label = await labeler(tx, slotId);
  for (const v of versions) await insertInstance(tx, ev.rules, slotId, rid, { versionId: v.id, domainId: v.domain_id, difficulty: v.difficulty }, kind, label(kind === 'BONUS' ? 'BONUS' : v.prefix), null);
  await audit(tx, actor, 'release.from_bank', { type: 'release', id: rid }, { slot: slot.number, count: versions.length, kind, when });
  if (when === 'NOW') await releaseNow(tx, actor, rid);
  else await emit(tx, 'slot.updated', [Rooms.organizers], { slotId });
  return { releaseId: rid, count: versions.length, kind, when };
}

/**
 * Tops a slot up to target: for each (domain, difficulty) with fewer active
 * questions than the target, auto-picks the difference from the bank and
 * releases it (now while running, else at the next sprint start).
 * Optional filters restrict it to one domain and/or difficulty, or `count` adds exactly N per cell.
 */
export async function topUp(tx: Tx, actor: Actor, slotId: string, f: { domain?: string; difficulty?: Diff; count?: number } = {}) {
  const stock = await slotStock(tx, slotId);
  const when = stock.running ? 'NOW' : 'NEXT_START';
  const keep = await many<{ question_id: string }>(tx, `SELECT DISTINCT v.question_id FROM question_instance qi JOIN question_version v ON v.id=qi.question_version_id WHERE qi.slot_id=$1 AND (qi.status='AVAILABLE')`, [slotId]);
  const pick = makePicker(await candidates(tx, slotId), slotId, new Set(keep.map((k) => k.question_id)));
  const domains = await many<{ id: string; slug: string }>(tx, 'SELECT id, slug FROM domain ORDER BY sort');
  const chosen: string[] = [];
  const short: string[] = [];
  for (const d of stock.domains) {
    if (f.domain && d.slug !== f.domain) continue;
    const dom = domains.find((x) => x.slug === d.slug)!;
    for (const diff of DIFFS) {
      if (f.difficulty && diff !== f.difficulty) continue;
      const cell = d.byDifficulty[diff];
      const need = f.count ?? Math.max(0, cell.target - cell.active - (when === 'NEXT_START' ? cell.planned : 0));
      for (let k = 0; k < need; k++) {
        const c = pick({ domainId: dom.id, difficulty: diff });
        if (!c) {
          short.push(`${d.slug}/${diff}`);
          break;
        }
        chosen.push(c.versionId);
      }
    }
  }
  if (!chosen.length) return { released: 0, when, short, message: short.length ? 'The bank has no more questions for that selection.' : 'Every domain is at or above its target — nothing to top up.' };
  const r = await releaseFromBank(tx, actor, slotId, { versionIds: chosen, when });
  return { released: r.count, when, short, releaseId: r.releaseId };
}
