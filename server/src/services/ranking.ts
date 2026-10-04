import { many, type Queryable } from '../db.js';
import type { GameRow } from './context.js';

export interface StandingRow {
  enrollmentId: string;
  teamId: string;
  crewId: string;
  name: string;
  color: string;
  status: 'ACTIVE' | 'ELIMINATED' | 'DISQUALIFIED';
  eliminatedSprint: number | null;
  wallet: number;
  earned: number;
  spent: number;
  scoreAdjust: number;
  score: number;
  tasksSolved: number;
  /** Shared competition rank among ACTIVE+eligible crews (1,1,3 ...). null for inactive. */
  rank: number | null;
  zone?: 'SAFE' | 'UNCERTAIN' | 'DANGER';
}

/**
 * The ONE scoring rule used by every HUD, leaderboard, preview and export.
 * NET_COINS   = earned - spent + score adjustments
 * GROSS_EARNED = earned + score adjustments
 * Wallet grants are funding, never score.
 */
export function scoreSql(metric: GameRow['ranking_metric']): string {
  return metric === 'GROSS_EARNED' ? '(ge.earned_total + ge.score_adjust)' : '(ge.earned_total - ge.spent_total + ge.score_adjust)';
}

export function compareStanding(a: StandingRow, b: StandingRow) {
  // Score desc; crew_id only for a stable DISPLAY order inside a tie. Never used to break ties for elimination.
  return b.score - a.score || a.crewId.localeCompare(b.crewId);
}

export function assignRanks(rows: StandingRow[]): StandingRow[] {
  const sorted = [...rows].sort(compareStanding);
  let prevScore: number | null = null;
  let prevRank = 0;
  sorted.forEach((r, i) => {
    if (prevScore === null || r.score !== prevScore) prevRank = i + 1;
    r.rank = prevRank;
    prevScore = r.score;
  });
  return sorted;
}

/** Live standings for a game. Participants counted only when enrolled, ACTIVE and eligible for the game's day. */
export async function computeStandings(q: Queryable, game: Pick<GameRow, 'id' | 'day_id' | 'ranking_metric'>): Promise<{ active: StandingRow[]; inactive: StandingRow[] }> {
  const rows = await many<Record<string, unknown>>(
    q,
    `SELECT ge.id AS enrollment_id, t.id AS team_id, t.crew_id, t.name, t.color, ge.status, ge.eliminated_sprint,
            ge.wallet_balance, ge.earned_total, ge.spent_total, ge.score_adjust, ge.tasks_solved,
            ${scoreSql(game.ranking_metric)} AS score,
            COALESCE(e.active, false) AS eligible,
            EXISTS (SELECT 1 FROM disqualification d WHERE d.team_id=t.id AND d.revoked_at IS NULL
                     AND (d.scope='EVENT' OR d.game_id=ge.game_id)) AS disqualified
       FROM game_enrollment ge
       JOIN team t ON t.id = ge.team_id
       LEFT JOIN team_day_eligibility e ON e.team_id = t.id AND e.day_id = $2
      WHERE ge.game_id = $1 AND t.status = 'ACTIVE'`,
    [game.id, game.day_id],
  );
  const all: (StandingRow & { eligible: boolean })[] = rows.map((r) => ({
    enrollmentId: r.enrollment_id as string,
    teamId: r.team_id as string,
    crewId: r.crew_id as string,
    name: r.name as string,
    color: r.color as string,
    status: (r.disqualified ? 'DISQUALIFIED' : r.status) as StandingRow['status'],
    eliminatedSprint: (r.eliminated_sprint as number | null) ?? null,
    wallet: r.wallet_balance as number,
    earned: r.earned_total as number,
    spent: r.spent_total as number,
    scoreAdjust: r.score_adjust as number,
    score: Number(r.score),
    tasksSolved: r.tasks_solved as number,
    rank: null,
    eligible: r.eligible as boolean,
  }));
  const strip = ({ eligible: _e, ...r }: StandingRow & { eligible: boolean }): StandingRow => r;
  const active = assignRanks(all.filter((r) => r.status === 'ACTIVE' && r.eligible).map(strip));
  const inactive = all
    .filter((r) => !(r.status === 'ACTIVE' && r.eligible))
    .map(strip)
    .sort(compareStanding);
  return { active, inactive };
}

/**
 * Provisional zones from the configured elimination count K (never static
 * percentages). Bottom K are DANGER, a tie group straddling the cut is
 * UNCERTAIN, as are the K positions just above the cut; the rest are SAFE.
 */
export function assignZones(active: StandingRow[], eliminateCount: number | null): StandingRow[] {
  const n = active.length;
  const k = eliminateCount ?? 0;
  if (k <= 0 || n === 0) return active.map((r) => ({ ...r, zone: 'SAFE' }));
  const cut = Math.max(0, n - k); // index of first eliminated position
  const cutScore = cut > 0 && cut < n ? active[cut].score : null;
  const tieAcross = cut > 0 && cut < n && active[cut - 1].score === active[cut].score;
  return active.map((r, i) => {
    let zone: StandingRow['zone'];
    if (tieAcross && r.score === cutScore) zone = 'UNCERTAIN';
    else if (i >= cut) zone = 'DANGER';
    else if (i >= cut - k) zone = 'UNCERTAIN';
    else zone = 'SAFE';
    return { ...r, zone };
  });
}

export interface TieConflict {
  score: number;
  tiedEnrollmentIds: string[];
  /** How many of the tied crews would have to go to eliminate exactly K. */
  needFromTie: number;
  strictlyBelow: string[];
}

export interface EliminationPreview {
  activeCount: number;
  eliminateCount: number;
  survivors: number;
  /** Crews eliminated when no tie crosses the cut. */
  proposed: string[];
  tie: TieConflict | null;
}

export function eliminationPreview(active: StandingRow[], k: number): EliminationPreview {
  const n = active.length;
  const kk = Math.min(Math.max(0, k), n);
  if (kk === 0) return { activeCount: n, eliminateCount: 0, survivors: n, proposed: [], tie: null };
  const cut = n - kk;
  if (cut > 0 && active[cut - 1].score === active[cut].score) {
    const s = active[cut].score;
    const tied = active.filter((r) => r.score === s).map((r) => r.enrollmentId);
    const below = active.filter((r) => r.score < s).map((r) => r.enrollmentId);
    return { activeCount: n, eliminateCount: kk, survivors: n - kk, proposed: [], tie: { score: s, tiedEnrollmentIds: tied, needFromTie: kk - below.length, strictlyBelow: below } };
  }
  return { activeCount: n, eliminateCount: kk, survivors: n - kk, proposed: active.slice(cut).map((r) => r.enrollmentId), tie: null };
}
