/** DTOs for the commander (admin) API — mirrors server/src/routes/admin.ts + services. */
import type { GameDto, ResultRow, SprintDto, Standing } from '../lib/api';

export type AdminRole = 'SUPER_ADMIN' | 'OPERATOR' | 'CONTENT_EDITOR';

export type Permission =
  | 'crews.read' | 'crews.write' | 'game.control' | 'coins.adjust' | 'content.read' | 'content.write'
  | 'content.solutions' | 'results.confirm' | 'disqualify' | 'event.config' | 'audit.read' | 'exports';

/** Client mirror of server/src/http.ts ROLE_PERMS (the server enforces; this only hides controls). */
export const ROLE_PERMS: Record<AdminRole, Permission[]> = {
  SUPER_ADMIN: ['crews.read', 'crews.write', 'game.control', 'coins.adjust', 'content.read', 'content.write', 'content.solutions', 'results.confirm', 'disqualify', 'event.config', 'audit.read', 'exports'],
  OPERATOR: ['crews.read', 'crews.write', 'game.control', 'coins.adjust', 'content.read', 'audit.read', 'exports'],
  CONTENT_EDITOR: ['crews.read', 'content.read', 'content.write', 'content.solutions'],
};

export interface DayRow {
  id: string;
  day_number: number;
  label: string;
  date: string | null;
}

export interface Preflight {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  summary: string[];
  activeCount: number;
  plan: { sprint: number; active: number; eliminate: number | null; survive: number | null }[];
}

export interface AdminStanding extends Standing {
  enrollmentId: string;
  teamId: string;
  wallet: number;
  scoreAdjust: number;
}

export type ImposterStatus = 'DRAFT' | 'OFFERED' | 'RESERVED' | 'SOLVED' | 'EXPIRED' | 'CANCELLED';

export interface AdminImposter {
  id: string;
  label: string;
  status: ImposterStatus;
  mode: 'RESERVE' | 'OPEN' | null;
  reward: number;
  hint_cost: number;
  claim_seconds: number;
  solve_seconds: number;
  released_at: string | null;
  claim_deadline_at: string | null;
  open_deadline_at: string | null;
  generation: number;
  resolution_note: string | null;
  sprint: number;
  title: string;
  difficulty: string;
  reservation: { crew: string; status: string; solveDeadlineAt: string | null } | null;
}

export interface AdminGame extends GameDto {
  dayId: string | null;
  rankingMetricConfirmed: boolean;
  startingCoins: number;
  recycleEliminatedSolves: boolean;
  rulesFrozenAt: string | null;
  sprints: SprintDto[];
  standings: { active: AdminStanding[]; inactive: AdminStanding[] };
  preflight: Preflight | null;
  nextSprint: number | null;
  prizes: { place: number; label: string }[];
  imposters: AdminImposter[];
  result: { rows: ResultRow[]; note: string | null; confirmed_at: string } | null;
}

export interface Overview {
  serverTime: string;
  event: {
    id: string;
    name: string;
    isDemo: boolean;
    timezone: string;
    daySelectionMode: 'AUTO' | 'MANUAL';
    manualDayId: string | null;
    sessionLimit: number;
    sessionLimitPolicy: 'EVICT_OLDEST' | 'REJECT';
  };
  days: DayRow[];
  currentDay: DayRow | null;
  games: AdminGame[];
  me: { name: string; role: AdminRole; email: string };
}

export interface CrewMember {
  position: number;
  name: string;
  institution: string;
  year: string;
  branch: string;
  studentId: string | null;
  isCaptain: boolean;
}

export interface CrewDisqualification {
  id: string;
  scope: 'GAME' | 'EVENT';
  gameId: string | null;
  reason: string;
  createdAt: string;
}

export type CrewEnrollment = Standing & { enrollmentId: string; wallet: number };

export interface CrewRow {
  id: string;
  crew_id: string;
  name: string;
  email: string;
  captain_name: string;
  color: string;
  requested_days: 'DAY1' | 'DAY2' | 'BOTH';
  status: 'ACTIVE' | 'ARCHIVED';
  created_via: string;
  created_at: string;
  must_change_password: boolean;
  live_sessions: number;
  members: CrewMember[] | null;
  days: Record<string, { active: boolean; checkedInAt: string | null }> | null;
  disqualifications: CrewDisqualification[] | null;
  enrollments: Record<string, CrewEnrollment | null>;
}

export interface CrewList {
  days: DayRow[];
  games: { id: string; number: number; name: string; dayId: string | null }[];
  crews: CrewRow[];
}

export interface SessionRow {
  id: string;
  created_at: string;
  last_seen_at: string | null;
  expires_at: string;
  user_agent: string | null;
  ip: string | null;
}

export interface BulkPreview {
  applied: boolean;
  preview: { day: number; active: boolean; changes: { crewId: string; name: string }[]; unchanged: number; warnings: string[] };
}

export interface CreatedCrew {
  crewId: string;
  teamName: string;
  email: string;
  temporaryPassword: string;
}

export interface AdminTask {
  id: string;
  label: string;
  status: string;
  generation: number;
  release_offset_seconds: number;
  close_offset_seconds: number | null;
  solved_at: string | null;
  sprint: number;
  domain: string;
  title: string;
  difficulty: string;
  reward: number;
  hint_cost: number;
  version_id: string;
  problem_key: string;
  solved_by_crew: string | null;
  solved_by_name: string | null;
  hints_bought: number;
  attempts: number;
}

export interface LedgerRow {
  id: string | number;
  kind: string;
  wallet_delta: number;
  earned_delta: number;
  spent_delta: number;
  grant_delta: number;
  score_delta: number;
  wallet_after: number;
  source_type: string;
  reason: string | null;
  created_at: string;
  crew_id: string;
  team_name: string;
  actor: string | null;
}

export interface TieConflict {
  score: number;
  tiedEnrollmentIds: string[];
  needFromTie: number;
  strictlyBelow: string[];
}

export type ReviewRow = Standing & { enrollmentId: string };

export interface EliminationReview {
  sprint: number;
  finalSprint: boolean;
  prizePlaces: number;
  preview: { activeCount: number; eliminateCount: number; survivors: number; proposed: string[]; tie: TieConflict | null };
  rows: ReviewRow[];
  gameVersion: number;
}

export interface ResultsReview {
  rows: ReviewRow[];
  prizes: { place: number; label: string }[];
  conflicts: { score: number; enrollmentIds: string[]; positions: number[] }[];
  gameVersion: number;
}

export interface ProblemRow {
  id: string;
  key: string;
  kind: 'REGULAR' | 'IMPOSTER';
  title: string;
  is_demo: boolean;
  archived: boolean;
  domain: string;
  domain_name: string;
  version_id: string;
  version_no: number;
  status: 'DRAFT' | 'PUBLISHED' | string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  reward: number;
  hint_cost: number;
  workspace: string;
  run_language: string | null;
  validation_mode: string | null;
  uses: number;
  imposter_uses: number;
}

export interface ProblemFile {
  name: string;
  language: string;
  content: string;
  readOnly?: boolean;
}

export interface ProblemVersionDetail {
  id: string;
  problem_id: string;
  version_no: number;
  status: string;
  title: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  statement: string;
  workspace: string;
  run_language: 'javascript' | 'python' | null;
  run_entry: string | null;
  files: ProblemFile[];
  sample_stdin: string | null;
  answer_format: string;
  validation: Record<string, unknown> & { mode?: string };
  hint: string;
  solution?: { explanation?: string; files?: Record<string, string>; answer?: string };
  reward: number;
  hint_cost: number;
  published_at: string | null;
  key: string;
  kind: 'REGULAR' | 'IMPOSTER';
  domain: string;
}

export interface HealthReport {
  db: { ok: boolean; latencyMs: number };
  workers: { name: string; ageSeconds: number; healthy: boolean; info: unknown }[];
  outbox: { latestId: number | string; deliveredThrough: number; lag: number };
  runner: { ok: boolean; runtimes?: Record<string, string | null>; error?: string };
  sockets: number;
  deadlines: { game: number; sprint: number; status: string; deadline_at: string }[];
}

export interface AuditRow {
  id: string | number;
  actor_type: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  reason: string | null;
  details: unknown;
  created_at: string;
  actor_name: string | null;
}
