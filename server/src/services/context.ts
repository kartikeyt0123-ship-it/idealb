import { many, one, type Queryable } from '../db.js';
import { AppError } from '../errors.js';
import { parseRules, type Rules } from './rules.js';

export interface EventRow {
  id: string;
  name: string;
  organizer: string;
  edition: string;
  venue: string;
  timezone: string;
  is_demo: boolean;
  rules: Rules;
  rule_confirmations: Record<string, { by: string; byName: string; at: string }>;
  rules_frozen_at: Date | null;
  phase: 'OPEN' | 'FINAL_REVIEW' | 'FINALIZED';
  finalized_at: Date | null;
  version: number;
}

export interface DayRow { id: string; day_number: number; label: string; date: string }

export type SlotPhase = 'CONFIGURING' | 'READY' | 'WAITING' | 'RUNNING' | 'REVIEW' | 'COMPLETED';

export interface SlotRow {
  id: string;
  event_id: string;
  day_id: string;
  number: number;
  name: string;
  scheduled_start_at: Date | null;
  capacity: number;
  phase: SlotPhase;
  current_sprint: number;
  finalized_at: Date | null;
  version: number;
}

export interface SprintRow {
  id: string;
  slot_id: string;
  number: number;
  status: 'READY' | 'RUNNING' | 'PAUSED' | 'CLOSED' | 'FINALIZED';
  duration_seconds: number;
  eliminate_count: number;
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
  slot_id: string;
  team_id: string;
  status: 'ACTIVE' | 'ELIMINATED' | 'DISQUALIFIED';
  eliminated_sprint: number | null;
  wallet_balance: number;
  earned_total: number;
  spent_total: number;
  grant_total: number;
  score_adjust: number;
  tasks_solved: number;
  version: number;
}

export interface TeamRow {
  id: string;
  crew_id: string;
  name: string;
  email: string;
  captain_name: string;
  color: string;
  account_enabled: boolean;
  status: 'ACTIVE' | 'ARCHIVED';
  must_change_password: boolean;
}

export async function getEvent(q: Queryable): Promise<EventRow> {
  const ev = await one<EventRow>(q, 'SELECT * FROM event ORDER BY created_at LIMIT 1');
  if (!ev) throw new AppError('NOT_CONFIGURED', 'The event has not been configured yet.');
  ev.rules = parseRules(ev.rules);
  return ev;
}

export async function listDays(q: Queryable, eventId: string): Promise<DayRow[]> {
  return many<DayRow>(q, `SELECT id, day_number, label, to_char(date, 'YYYY-MM-DD') AS date FROM event_day WHERE event_id=$1 ORDER BY day_number`, [eventId]);
}

export async function listSlots(q: Queryable, eventId: string): Promise<(SlotRow & { day_number: number; day_label: string; date: string })[]> {
  return many(
    q,
    `SELECT s.*, d.day_number, d.label AS day_label, to_char(d.date, 'YYYY-MM-DD') AS date
       FROM slot s JOIN event_day d ON d.id=s.day_id WHERE s.event_id=$1 ORDER BY s.number`,
    [eventId],
  );
}

export async function getSlot(q: Queryable, slotId: string): Promise<SlotRow> {
  const s = await one<SlotRow>(q, 'SELECT * FROM slot WHERE id=$1', [slotId]);
  if (!s) throw new AppError('NOT_FOUND', 'Slot not found.');
  return s;
}

export async function getSprints(q: Queryable, slotId: string): Promise<SprintRow[]> {
  return many<SprintRow>(q, 'SELECT * FROM sprint WHERE slot_id=$1 ORDER BY number', [slotId]);
}

export async function activeDisqualification(q: Queryable, teamId: string) {
  return one<{ id: string; reason: string }>(q, `SELECT id, reason FROM disqualification WHERE team_id=$1 AND revoked_at IS NULL LIMIT 1`, [teamId]);
}

export interface CrewContext {
  event: EventRow;
  team: TeamRow;
  slot: SlotRow;
  enrollment: EnrollmentRow;
}

/**
 * Authorises a crew for ITS assigned slot. Called on every protected read /
 * write and socket subscription, so disabling an account or reassigning a
 * slot applies to existing sessions immediately. A slot id in a URL never
 * authorises anything — callers must compare it with ctx.slot.id.
 */
export async function resolveCrew(q: Queryable, teamId: string): Promise<CrewContext> {
  const event = await getEvent(q);
  const team = await one<TeamRow>(q, 'SELECT id, crew_id, name, email, captain_name, color, account_enabled, status, must_change_password FROM team WHERE id=$1', [teamId]);
  if (!team) throw new AppError('UNAUTHENTICATED', 'Crew not found.');
  if (team.status === 'ARCHIVED') throw new AppError('TEAM_ARCHIVED', 'This crew has been archived by the organizers.');
  if (!team.account_enabled) throw new AppError('ACCOUNT_DISABLED', 'Your crew account is disabled. Contact the organizers.');
  const dq = await activeDisqualification(q, teamId);
  if (dq) throw new AppError('TEAM_DISQUALIFIED', 'Your crew has been disqualified. Contact the organizers.', { reason: dq.reason });
  const enrollment = await one<EnrollmentRow>(q, 'SELECT * FROM slot_enrollment WHERE team_id=$1', [teamId]);
  if (!enrollment) throw new AppError('SLOT_UNASSIGNED', 'Your crew has not been assigned to a slot yet. Contact the organizers.');
  const slot = (await one<SlotRow>(q, 'SELECT * FROM slot WHERE id=$1', [enrollment.slot_id]))!;
  return { event, team, slot, enrollment };
}

export function requireActiveEnrollment(ctx: CrewContext) {
  if (ctx.enrollment.status === 'ELIMINATED') throw new AppError('TEAM_ELIMINATED', 'Your crew was eliminated. Systems are read-only.');
  if (ctx.enrollment.status === 'DISQUALIFIED') throw new AppError('TEAM_DISQUALIFIED', 'Your crew has been disqualified.');
}

/** Seconds of *active* (unpaused) sprint time elapsed at `nowMs`. */
export function activeElapsedSeconds(s: SprintRow, nowMs: number): number {
  if (!s.started_at) return 0;
  const end = s.status === 'PAUSED' && s.paused_at ? new Date(s.paused_at).getTime() : s.closed_at ? new Date(s.closed_at).getTime() : nowMs;
  return Math.max(0, (end - new Date(s.started_at).getTime() - Number(s.paused_total_ms)) / 1000);
}

export async function dbNow(q: Queryable): Promise<number> {
  const r = await one<{ t: Date }>(q, 'SELECT clock_timestamp() AS t');
  return new Date(r!.t).getTime();
}
