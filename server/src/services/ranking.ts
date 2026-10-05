import { many, type Queryable } from '../db.js';
import type { Rules } from './rules.js';

/**
 * ONE scoring rule, used by every HUD, leaderboard, projector, export and result:
 *   GROSS_EARNED  score = Σ earned_delta + Σ score_delta     (hints reduce the wallet only)
 *   NET_COINS     score = Σ earned_delta − Σ spent_delta + Σ score_delta
 * Sprint score = the same formula over ledger rows attributed to that sprint.
 * Slot cumulative = over every row of the crew's slot. Grants never count as score.
 */
export type Metric = Rules['rankingMetric'];

export interface BoardRow {
  enrollmentId: string;
  teamId: string;
  crewId: string;
  name: string;
  color: string;
  slotId: string;
  slotNumber: number;
  status: 'ACTIVE' | 'ELIMINATED' | 'DISQUALIFIED';
  accountEnabled: boolean;
  /** Score in the selected scope (sprint or cumulative). */
  score: number;
  /** Cumulative slot score (same metric). */
  cumulative: number;
  /** Per-sprint scores { "1": n, ... } under the metric. */
  perSprint: Record<string, number>;
  wallet: number;
  earned: number;
  spent: number;
  solves: number;
  rank: number | null;
  zone?: 'SAFE' | 'UNCERTAIN' | 'DANGER' | null;
}

interface Agg {
  enrollment_id: string;
  sprint_number: number | null;
  earned: number;
  spent: number;
  score: number;
  solves: number;
}

export function scoreOf(metric: Metric, a: { earned: number; spent: number; score: number }) {
  return metric === 'NET_COINS' ? a.earned - a.spent + a.score : a.earned + a.score;
}

export function assignRanks<T extends { score: number; crewId: string; rank: number | null }>(rows: T[]): T[] {
  // Score desc; crew id only orders rows INSIDE a tie for display. Ties share the rank.
  const sorted = [...rows].sort((a, b) => b.score - a.score || a.crewId.localeCompare(b.crewId));
  let prevScore: number | null = null;
  let prevRank = 0;
  sorted.forEach((r, i) => {
    if (prevScore === null || r.score !== prevScore) prevRank = i + 1;
    r.rank = prevRank;
    prevScore = r.score;
  });
  return sorted;
}

/** Builds rows for a set of slots from the ledger (authoritative) — cached totals are only used for the wallet. */
async function rowsFor(q: Queryable, slotIds: string[], metric: Metric): Promise<BoardRow[]> {
  if (!slotIds.length) return [];
  const base = await many<Record<string, unknown>>(
    q,
    `SELECT se.id AS enrollment_id, t.id AS team_id, t.crew_id, t.name, t.color, se.slot_id, s.number AS slot_number, se.status,
            t.account_enabled, se.wallet_balance, se.tasks_solved,
            EXISTS (SELECT 1 FROM disqualification d WHERE d.team_id=t.id AND d.revoked_at IS NULL) AS dq
       FROM slot_enrollment se JOIN team t ON t.id=se.team_id JOIN slot s ON s.id=se.slot_id
      WHERE se.slot_id = ANY($1) AND t.status='ACTIVE'`,
    [slotIds],
  );
  const aggs = await many<Agg>(
    q,
    `SELECT l.enrollment_id, sp.number AS sprint_number,
            COALESCE(sum(l.earned_delta),0)::int AS earned, COALESCE(sum(l.spent_delta),0)::int AS spent,
            COALESCE(sum(l.score_delta),0)::int AS score, count(*) FILTER (WHERE l.kind IN ('SOLVE_REWARD','BONUS_REWARD'))::int AS solves
       FROM coin_ledger l LEFT JOIN sprint sp ON sp.id=l.sprint_id
      WHERE l.slot_id = ANY($1)
      GROUP BY l.enrollment_id, sp.number`,
    [slotIds],
  );
  const byEnr = new Map<string, Agg[]>();
  for (const a of aggs) byEnr.set(a.enrollment_id, [...(byEnr.get(a.enrollment_id) ?? []), a]);
  return base.map((b) => {
    const list = byEnr.get(b.enrollment_id as string) ?? [];
    const perSprint: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0 };
    let earned = 0;
    let spent = 0;
    let score = 0;
    let solves = 0;
    for (const a of list) {
      earned += a.earned;
      spent += a.spent;
      score += a.score;
      solves += a.solves;
      if (a.sprint_number) perSprint[String(a.sprint_number)] += scoreOf(metric, a);
    }
    const cumulative = scoreOf(metric, { earned, spent, score });
    return {
      enrollmentId: b.enrollment_id as string,
      teamId: b.team_id as string,
      crewId: b.crew_id as string,
      name: b.name as string,
      color: b.color as string,
      slotId: b.slot_id as string,
      slotNumber: b.slot_number as number,
      status: (b.dq ? 'DISQUALIFIED' : b.status) as BoardRow['status'],
      accountEnabled: b.account_enabled as boolean,
      score: cumulative,
      cumulative,
      perSprint,
      wallet: b.wallet_balance as number,
      earned,
      spent,
      solves,
      rank: null,
    };
  });
}

export interface Board {
  scope: 'SPRINT' | 'SLOT' | 'EVENT';
  metric: Metric;
  active: BoardRow[];
  inactive: BoardRow[];
}

function split(rows: BoardRow[], scope: Board['scope'], metric: Metric): Board {
  const active = assignRanks(rows.filter((r) => r.status === 'ACTIVE'));
  const inactive = rows.filter((r) => r.status !== 'ACTIVE').sort((a, b) => b.score - a.score || a.crewId.localeCompare(b.crewId));
  return { scope, metric, active, inactive };
}

/** Sprint board: only contributions attributed to that sprint — a new sprint starts at zero. */
export async function sprintBoard(q: Queryable, slotId: string, sprintNumber: number, metric: Metric): Promise<Board> {
  const rows = await rowsFor(q, [slotId], metric);
  for (const r of rows) r.score = r.perSprint[String(sprintNumber)] ?? 0;
  return split(rows, 'SPRINT', metric);
}

/** Slot cumulative board over all four sprints, with per-sprint columns. */
export async function slotBoard(q: Queryable, slotId: string, metric: Metric): Promise<Board> {
  return split(await rowsFor(q, [slotId], metric), 'SLOT', metric);
}

/** Overall board: every crew's cumulative total from its own slot, compared across all slots. */
export async function eventBoard(q: Queryable, eventId: string, metric: Metric): Promise<Board> {
  const slots = await many<{ id: string }>(q, 'SELECT id FROM slot WHERE event_id=$1', [eventId]);
  return split(await rowsFor(q, slots.map((s) => s.id), metric), 'EVENT', metric);
}

/**
 * Provisional elimination zones from a configured count K (only when the
 * elimination rule is enabled): bottom K DANGER, a tie straddling the cut and
 * the K places above it UNCERTAIN, the rest SAFE.
 */
export function assignZones(active: BoardRow[], k: number): BoardRow[] {
  const n = active.length;
  if (k <= 0 || n === 0) return active.map((r) => ({ ...r, zone: null }));
  const cut = Math.max(0, n - k);
  const tieAcross = cut > 0 && cut < n && active[cut - 1].score === active[cut].score;
  const cutScore = cut < n ? active[cut].score : null;
  return active.map((r, i) => ({
    ...r,
    zone: tieAcross && r.score === cutScore ? 'UNCERTAIN' : i >= cut ? 'DANGER' : i >= cut - k ? 'UNCERTAIN' : 'SAFE',
  }));
}

export interface TieConflict {
  score: number;
  tiedEnrollmentIds: string[];
  needFromTie: number;
  strictlyBelow: string[];
}

export function eliminationPreview(active: BoardRow[], k: number) {
  const n = active.length;
  const kk = Math.min(Math.max(0, k), n);
  if (kk === 0) return { activeCount: n, eliminateCount: 0, survivors: n, proposed: [] as string[], tie: null as TieConflict | null };
  const cut = n - kk;
  if (cut > 0 && active[cut - 1].score === active[cut].score) {
    const s = active[cut].score;
    const tied = active.filter((r) => r.score === s).map((r) => r.enrollmentId);
    const below = active.filter((r) => r.score < s).map((r) => r.enrollmentId);
    return { activeCount: n, eliminateCount: kk, survivors: n - kk, proposed: [] as string[], tie: { score: s, tiedEnrollmentIds: tied, needFromTie: kk - below.length, strictlyBelow: below } };
  }
  return { activeCount: n, eliminateCount: kk, survivors: n - kk, proposed: active.slice(cut).map((r) => r.enrollmentId), tie: null as TieConflict | null };
}

/** Ties that involve the top `places` positions need an explicit published decision before finalization. */
export function topTies(active: BoardRow[], places: number) {
  const groups = new Map<number, BoardRow[]>();
  active.forEach((r) => groups.set(r.score, [...(groups.get(r.score) ?? []), r]));
  const out: { score: number; enrollmentIds: string[]; positions: number[] }[] = [];
  for (const [score, grp] of groups) {
    if (grp.length < 2) continue;
    const positions = grp.map((r) => active.indexOf(r) + 1);
    if (Math.min(...positions) <= places) out.push({ score, enrollmentIds: grp.map((r) => r.enrollmentId), positions });
  }
  return out;
}

/** Public projection: approved standings fields only (no emails, wallets of others are fine as coins). */
export function publicRow(r: BoardRow) {
  return {
    crewId: r.crewId, name: r.name, color: r.color, slotNumber: r.slotNumber, status: r.status,
    score: r.score, cumulative: r.cumulative, perSprint: r.perSprint, solves: r.solves, rank: r.rank, zone: r.zone ?? null,
  };
}
