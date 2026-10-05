import { many, one, type Queryable } from '../db.js';
import type { CrewContext, SlotRow, SprintRow } from './context.js';
import { getEvent, getSprints } from './context.js';
import { hintInstanceIds, toCards, visibleRows, type CardRow } from './questions.js';
import { assignZones, publicRow, slotBoard, sprintBoard, type Board } from './ranking.js';

export function sprintDto(s: SprintRow | undefined, nowMs = Date.now()) {
  if (!s) return null;
  const deadline = s.deadline_at ? new Date(s.deadline_at).getTime() : null;
  let remaining: number | null = null;
  if (deadline !== null) {
    if (s.status === 'PAUSED' && s.paused_at) remaining = Math.max(0, Math.ceil((deadline - new Date(s.paused_at).getTime()) / 1000));
    else if (s.status === 'RUNNING') remaining = Math.max(0, Math.ceil((deadline - nowMs) / 1000));
    else remaining = 0;
  }
  return {
    id: s.id, number: s.number, status: s.status, durationSeconds: s.duration_seconds, eliminateCount: s.eliminate_count,
    startedAt: s.started_at, deadlineAt: s.deadline_at, pausedAt: s.paused_at, closedAt: s.closed_at, remainingSeconds: remaining, version: s.version,
  };
}

export function slotDto(s: SlotRow & { date?: string; day_label?: string }) {
  return { id: s.id, number: s.number, name: s.name, phase: s.phase, currentSprint: s.current_sprint, capacity: s.capacity, scheduledStartAt: s.scheduled_start_at, finalizedAt: s.finalized_at, openedAt: s.opened_at ?? null, version: s.version, date: s.date ?? null, dayLabel: s.day_label ?? null };
}

interface Shared {
  key: string;
  sprints: SprintRow[];
  current: SprintRow | undefined;
  sprintBoard: Board;
  slotBoard: Board;
  rows: CardRow[];
  domains: { slug: string; name: string; room: string; color: string; symbol: string; prefix: string; workspace: string }[];
  announcements: { id: string; message: string; kind: string; created_at: Date }[];
  lastBatch?: { sprint: number; ids: string[] };
  result?: { rows: unknown[]; confirmed_at: Date };
}

const cache = new Map<string, { at: number; data: Shared }>();

/** Cheap state version: any relevant change (ledger, instance, release, sprint, team, announcement…) changes it. */
async function stateKey(q: Queryable, slotId: string) {
  return JSON.stringify(
    await one(
      q,
      `SELECT s.version,
              (SELECT COALESCE(max(id),0) FROM coin_ledger WHERE slot_id=s.id) AS lv,
              (SELECT COALESCE(sum(version),0) FROM question_instance WHERE slot_id=s.id) AS qv,
              (SELECT COALESCE(sum(version),0) FROM release WHERE slot_id=s.id) AS rv,
              (SELECT COALESCE(sum(version),0) FROM sprint WHERE slot_id=s.id) AS sv,
              (SELECT COALESCE(sum(version),0) + count(*) FROM slot_enrollment WHERE slot_id=s.id) AS ev,
              (SELECT max(updated_at) FROM team) AS tv,
              (SELECT count(*) FROM announcement) AS av,
              (SELECT count(*) + count(revoked_at) FROM disqualification) AS dv,
              (SELECT e.version FROM event e WHERE e.id=s.event_id) AS evv
         FROM slot s WHERE s.id=$1`,
      [slotId],
    ),
  );
}

export async function sharedSlotState(q: Queryable, slot: SlotRow): Promise<Shared> {
  const key = await stateKey(q, slot.id);
  const hit = cache.get(slot.id);
  if (hit && hit.data.key === key && Date.now() - hit.at < 30_000) return hit.data;
  const ev = await getEvent(q);
  const sprints = await getSprints(q, slot.id);
  const current = sprints.find((s) => s.number === Math.max(1, slot.current_sprint));
  const [sb, cb, rows, domains, announcements, lastBatch, result] = await Promise.all([
    sprintBoard(q, slot.id, Math.max(1, slot.current_sprint), ev.rules.rankingMetric),
    slotBoard(q, slot.id, ev.rules.rankingMetric),
    visibleRows(q, slot),
    many<Shared['domains'][number]>(q, 'SELECT slug, name, room, color, symbol, prefix, workspace FROM domain ORDER BY sort'),
    many<Shared['announcements'][number]>(q, `SELECT id, message, kind, created_at FROM announcement WHERE event_id=$1 AND (slot_id=$2 OR slot_id IS NULL) ORDER BY created_at DESC LIMIT 12`, [ev.id, slot.id]),
    one<{ sprint: number; ids: string[] }>(q, `SELECT sp.number AS sprint, eb.eliminated_enrollment_ids AS ids FROM elimination_batch eb JOIN sprint sp ON sp.id=eb.sprint_id WHERE eb.slot_id=$1 ORDER BY eb.confirmed_at DESC LIMIT 1`, [slot.id]),
    one<{ rows: unknown[]; confirmed_at: Date }>(q, 'SELECT rows, confirmed_at FROM slot_result WHERE slot_id=$1', [slot.id]),
  ]);
  const k = ev.rules.elimination.enabled && ['RUNNING'].includes(slot.phase) ? ev.rules.elimination.counts[Math.max(1, slot.current_sprint) - 1] : 0;
  const data: Shared = { key, sprints, current, sprintBoard: sb, slotBoard: { ...cb, active: assignZones(cb.active, k) }, rows, domains, announcements, lastBatch: lastBatch ?? undefined, result: result ?? undefined };
  cache.set(slot.id, { at: Date.now(), data });
  return data;
}

/** Complete authorised state for a crew. Clients re-fetch it after any event or reconnect. */
export async function crewSnapshot(q: Queryable, ctx: CrewContext) {
  const now = Date.now();
  const sh = await sharedSlotState(q, ctx.slot);
  const [hints, members, day] = await Promise.all([
    hintInstanceIds(q, ctx.enrollment.id),
    many<{ name: string; is_captain: boolean }>(q, 'SELECT name, is_captain FROM team_member WHERE team_id=$1 ORDER BY position', [ctx.team.id]),
    one<{ date: string; label: string; day_number: number }>(q, `SELECT to_char(date, 'YYYY-MM-DD') AS date, label, day_number FROM event_day WHERE id=$1`, [ctx.slot.day_id]),
  ]);
  const cards = toCards(sh.rows, ctx.enrollment.id, hints);
  const mineSprint = sh.sprintBoard.active.find((r) => r.enrollmentId === ctx.enrollment.id);
  const mineSlot = sh.slotBoard.active.find((r) => r.enrollmentId === ctx.enrollment.id) ?? sh.slotBoard.inactive.find((r) => r.enrollmentId === ctx.enrollment.id);
  const domains = sh.domains.map((d) => {
    const cs = cards.filter((c) => c.domain === d.slug && c.kind !== 'BONUS');
    return {
      ...d,
      counts: {
        total: cs.length,
        available: cs.filter((c) => c.state === 'AVAILABLE').length,
        solvedByYou: cs.filter((c) => c.state === 'SOLVED_BY_YOU').length,
        solvedByOthers: cs.filter((c) => c.state === 'SOLVED').length,
        expired: cs.filter((c) => c.state === 'EXPIRED').length,
      },
    };
  });
  return {
    serverTime: new Date(now).toISOString(),
    identity: { role: 'CREW' as const, teamId: ctx.team.id, crewId: ctx.team.crew_id, name: ctx.team.name, color: ctx.team.color, members, mustChangePassword: ctx.team.must_change_password },
    event: { name: ctx.event.name, edition: ctx.event.edition, organizer: ctx.event.organizer, isDemo: ctx.event.is_demo, metric: ctx.event.rules.rankingMetric, phase: ctx.event.phase },
    slot: { ...slotDto(ctx.slot), date: day?.date ?? null, dayLabel: day?.label ?? null },
    sprint: sprintDto(sh.current, now),
    sprints: sh.sprints.map((s) => sprintDto(s, now)),
    me: {
      status: ctx.enrollment.status,
      wallet: ctx.enrollment.wallet_balance,
      earned: mineSlot?.earned ?? 0,
      spent: mineSlot?.spent ?? 0,
      sprintScore: mineSprint?.score ?? 0,
      cumulative: mineSlot?.cumulative ?? 0,
      sprintRank: mineSprint?.rank ?? null,
      slotRank: mineSlot?.rank ?? null,
      solves: mineSlot?.solves ?? 0,
      zone: mineSlot?.zone ?? null,
      activeCount: sh.slotBoard.active.length,
    },
    leaderboards: {
      sprint: { number: Math.max(1, ctx.slot.current_sprint), rows: sh.sprintBoard.active.map(publicRow) },
      slot: { rows: sh.slotBoard.active.map(publicRow), inactive: sh.slotBoard.inactive.map(publicRow) },
    },
    domains,
    questions: cards,
    bonuses: cards.filter((c) => c.kind === 'BONUS'),
    announcements: sh.announcements,
    lastElimination: sh.lastBatch ? { sprint: sh.lastBatch.sprint, youEliminated: sh.lastBatch.ids.includes(ctx.enrollment.id), count: sh.lastBatch.ids.length } : null,
    result: sh.result ? { rows: sh.result.rows, confirmedAt: sh.result.confirmed_at } : null,
  };
}
