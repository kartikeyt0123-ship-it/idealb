import { many, one, type Queryable } from '../db.js';
import { AppError } from '../errors.js';

export interface EventRow {
  id: string;
  name: string;
  timezone: string;
  day_selection_mode: 'AUTO' | 'MANUAL';
  manual_day_id: string | null;
  is_demo: boolean;
  session_limit: number;
  session_limit_policy: string;
  version: number;
}

export interface DayRow { id: string; day_number: number; label: string; date: string | null }

export interface GameRow {
  id: string;
  event_id: string;
  number: number;
  name: string;
  day_id: string | null;
  phase: GamePhase;
  current_sprint: number;
  ranking_metric: 'NET_COINS' | 'GROSS_EARNED';
  ranking_metric_confirmed: boolean;
  starting_coins: number;
  imposter_mode: 'RESERVE' | 'OPEN';
  imposter_blocks_regular: boolean;
  recycle_eliminated_solves: boolean;
  duration_preset: 'STANDARD' | 'REHEARSAL' | 'CUSTOM';
  prize_places: number;
  rules_frozen_at: Date | null;
  version: number;
}

export type GamePhase =
  | 'DRAFT' | 'READY' | 'WAITING' | 'RUNNING' | 'PAUSED' | 'CLOSED'
  | 'ELIMINATION_REVIEW' | 'WAITING_NEXT_SPRINT' | 'GAME_RESULT_REVIEW' | 'COMPLETED';

export interface SprintRow {
  id: string;
  game_id: string;
  number: number;
  status: 'PENDING' | 'RUNNING' | 'PAUSED' | 'CLOSED' | 'FINALIZED';
  duration_seconds: number;
  eliminate_count: number | null;
  started_at: Date | null;
  deadline_at: Date | null;
  paused_at: Date | null;
  paused_total_ms: number;
  closed_at: Date | null;
  close_reason: string | null;
  frozen_snapshot_id: string | null;
  version: number;
}

export interface EnrollmentRow {
  id: string;
  game_id: string;
  team_id: string;
  status: 'ACTIVE' | 'ELIMINATED' | 'DISQUALIFIED';
  eliminated_sprint: number | null;
  wallet_balance: number;
  earned_total: number;
  spent_total: number;
  grant_total: number;
  score_adjust: number;
  tasks_solved: number;
  active_reservation_id: string | null;
  version: number;
}

export interface TeamRow {
  id: string;
  crew_id: string;
  name: string;
  email: string;
  captain_name: string;
  color: string;
  requested_days: 'DAY1' | 'DAY2' | 'BOTH';
  status: 'ACTIVE' | 'ARCHIVED';
  must_change_password: boolean;
}

export async function getEvent(q: Queryable): Promise<EventRow> {
  const ev = await one<EventRow>(q, 'SELECT * FROM event ORDER BY created_at LIMIT 1');
  if (!ev) throw new AppError('NO_ACTIVE_DAY', 'The event has not been configured yet.');
  return ev;
}

/**
 * The competition day is chosen by server configuration only — never the
 * browser clock. AUTO mode compares today's date in the event timezone
 * (Asia/Kolkata) with event_day.date; MANUAL uses the organizer's selection.
 */
export async function currentDay(q: Queryable, ev?: EventRow): Promise<DayRow | null> {
  const event = ev ?? (await getEvent(q));
  if (event.day_selection_mode === 'MANUAL') {
    if (!event.manual_day_id) return null;
    return (await one<DayRow>(q, `SELECT id, day_number, label, to_char(date, 'YYYY-MM-DD') AS date FROM event_day WHERE id=$1`, [event.manual_day_id])) ?? null;
  }
  return (
    (await one<DayRow>(
      q,
      `SELECT id, day_number, label, to_char(date, 'YYYY-MM-DD') AS date FROM event_day
        WHERE event_id=$1 AND date = (now() AT TIME ZONE $2)::date`,
      [event.id, event.timezone],
    )) ?? null
  );
}

export async function listDays(q: Queryable, eventId: string): Promise<DayRow[]> {
  return many<DayRow>(q, `SELECT id, day_number, label, to_char(date, 'YYYY-MM-DD') AS date FROM event_day WHERE event_id=$1 ORDER BY day_number`, [eventId]);
}

export async function activeEventDisqualification(q: Queryable, teamId: string) {
  return one<{ id: string; reason: string }>(q, `SELECT id, reason FROM disqualification WHERE team_id=$1 AND scope='EVENT' AND revoked_at IS NULL LIMIT 1`, [teamId]);
}

export interface CompetitorContext {
  event: EventRow;
  team: TeamRow;
  day: DayRow;
  game: GameRow;
  enrollment: EnrollmentRow;
}

/**
 * Authorises a team for the *current* day's game. Called on every protected
 * game read/write and socket subscription so checkbox changes apply to
 * existing sessions immediately.
 */
export async function resolveCompetitor(q: Queryable, teamId: string): Promise<CompetitorContext> {
  const event = await getEvent(q);
  const team = await one<TeamRow>(q, 'SELECT id, crew_id, name, email, captain_name, color, requested_days, status, must_change_password FROM team WHERE id=$1', [teamId]);
  if (!team) throw new AppError('UNAUTHENTICATED', 'Crew not found.');
  if (team.status === 'ARCHIVED') throw new AppError('TEAM_ARCHIVED', 'This crew has been archived by the organizers.');
  const dq = await activeEventDisqualification(q, teamId);
  if (dq) throw new AppError('TEAM_DISQUALIFIED', 'Your crew has been disqualified from the event. Contact the organizers.', { reason: dq.reason });
  const day = await currentDay(q, event);
  if (!day) throw new AppError('NO_ACTIVE_DAY', 'No competition day is active right now. Contact the organizers.');
  const elig = await one<{ active: boolean }>(q, 'SELECT active FROM team_day_eligibility WHERE team_id=$1 AND day_id=$2', [teamId, day.id]);
  if (!elig?.active) {
    const anyActive = await one<{ n: number }>(q, 'SELECT count(*)::int AS n FROM team_day_eligibility WHERE team_id=$1 AND active', [teamId]);
    if (!anyActive?.n) throw new AppError('REGISTRATION_PENDING', 'Registration received — awaiting organizer activation.');
    throw new AppError('NOT_ACTIVATED_FOR_DAY', 'Your crew is not activated for this day. Contact the organizers.', { day: day.day_number });
  }
  const game = await one<GameRow>(q, 'SELECT * FROM game WHERE day_id=$1', [day.id]);
  if (!game) throw new AppError('NO_ACTIVE_DAY', 'No game is scheduled for today. Contact the organizers.');
  const enrollment = await one<EnrollmentRow>(q, 'SELECT * FROM game_enrollment WHERE game_id=$1 AND team_id=$2', [game.id, teamId]);
  if (!enrollment) throw new AppError('NOT_ACTIVATED_FOR_DAY', 'Your crew is not enrolled in today\'s game. Contact the organizers.');
  return { event, team, day, game, enrollment };
}

export function requireActiveEnrollment(ctx: CompetitorContext) {
  if (ctx.enrollment.status === 'ELIMINATED') throw new AppError('TEAM_ELIMINATED', 'Your crew was ejected from this game. Systems are read-only.');
  if (ctx.enrollment.status === 'DISQUALIFIED') throw new AppError('TEAM_DISQUALIFIED', 'Your crew has been disqualified from this game.');
}

/** Seconds of *active* (unpaused) sprint time elapsed at `nowMs`. */
export function activeElapsedSeconds(s: SprintRow, nowMs: number): number {
  if (!s.started_at) return 0;
  const end = s.status === 'PAUSED' && s.paused_at ? new Date(s.paused_at).getTime() : s.closed_at ? new Date(s.closed_at).getTime() : nowMs;
  return Math.max(0, (end - new Date(s.started_at).getTime() - Number(s.paused_total_ms)) / 1000);
}

export async function getSprint(q: Queryable, gameId: string, number: number): Promise<SprintRow | undefined> {
  return one<SprintRow>(q, 'SELECT * FROM sprint WHERE game_id=$1 AND number=$2', [gameId, number]);
}

export async function dbNow(q: Queryable): Promise<number> {
  const r = await one<{ t: Date }>(q, 'SELECT clock_timestamp() AS t');
  return new Date(r!.t).getTime();
}
