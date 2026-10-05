/**
 * Organizer console DTOs. They mirror the server responses in
 * server/src/services/{admin,lifecycle,releases,teams,content,display,rules}.ts
 * and server/src/routes/admin.ts. Snake_case fields come straight from SQL rows.
 */
import type { SlotDto, SprintDto } from '../lib/api';

export type Permission =
  | 'teams.read' | 'teams.write' | 'credentials.send' | 'slots.control' | 'releases.manage' | 'coins.adjust'
  | 'content.read' | 'content.write' | 'content.publish' | 'content.solutions' | 'results.finalize' | 'disqualify'
  | 'rules.manage' | 'audit.read' | 'exports' | 'display.manage' | 'mail.read';

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type ReleaseType = 'INITIAL' | 'RESERVE' | 'BONUS';
export type ReleaseStatus = 'PENDING' | 'SCHEDULED' | 'RELEASED' | 'CANCELLED';

export interface Preflight {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  summary: string[];
  unconfirmedRules: string[];
}

export interface ReleaseRow {
  id: string;
  type: ReleaseType;
  label: string;
  status: ReleaseStatus;
  offset_seconds: number | null;
  manual: boolean;
  deviation_reason: string | null;
  released_at: string | null;
  announcement: string | null;
  sprint: number | null;
  questions: number;
  solved: number;
  expired: number;
  available: number;
  budget: number;
}

export interface OverviewSlot extends SlotDto {
  dayNumber: number;
  sprints: SprintDto[];
  counts: { crews: number; enabled: number; checked_in: number; absent: number; sessions: number };
  releases: ReleaseRow[];
  nextSprint: number | null;
  preflight: Preflight | null;
  result: { rows: ResultPlacement[]; note: string | null; confirmed_at: string } | null;
}

export interface ResultPlacement {
  place: number;
  enrollmentId?: string;
  crewId: string;
  name: string;
  score: number;
  slotNumber?: number;
  prize?: string | null;
}

export interface Rules {
  questionScope: 'FRESH_PER_SPRINT' | 'SLOT_POOL';
  initialPerDomain: Record<Difficulty, number>;
  extraScope: 'PER_SLOT' | 'PER_SPRINT';
  reservesPerSlot: number;
  bonusesPerSlot: number;
  rewards: Record<Difficulty | 'BONUS', number>;
  hintCosts: Record<Difficulty | 'BONUS', number>;
  startingWallet: number;
  rankingMetric: 'GROSS_EARNED' | 'NET_COINS';
  bonusPolicy: string;
  bonusMode: 'MANUAL' | 'SCHEDULED';
  attendanceGatesLogin: boolean;
  elimination: { enabled: boolean; counts: number[] };
  tiePolicy: string;
  sessionLimit: number;
  sessionLimitPolicy: 'EVICT_OLDEST' | 'REJECT';
  recycling: false;
  singleRunningSlot: boolean;
  sprintsPerSlot: 4;
  sprintMinutes: number;
  preset: 'STANDARD' | 'REHEARSAL' | 'CUSTOM';
  blueprint: { reservesPerSprint: number[]; bonusesPerSprint: number[]; bonusOffsetsMinutes: number[][] };
}

export interface RuleReviewRow {
  key: string;
  title: string;
  fairness: boolean;
  description: string;
  confirmed: { by: string; byName: string; at: string } | null;
}

export interface Coverage {
  initial: { domain: string; difficulty: Difficulty; need: number; have: number }[];
  reserves: { need: number; have: number };
  bonuses: { need: number; have: number };
}

export interface Overview {
  serverTime: string;
  event: {
    id: string; name: string; organizer: string; edition: string; venue: string; timezone: string; isDemo: boolean;
    phase: 'OPEN' | 'FINAL_REVIEW' | 'FINALIZED'; finalizedAt: string | null; rulesFrozenAt: string | null; version: number;
  };
  rules: Rules;
  ruleReview: RuleReviewRow[];
  unconfirmed: string[];
  days: { id: string; day_number: number; label: string; date: string }[];
  slots: OverviewSlot[];
  prizes: { place: number; label: string }[];
  eventResult: { rows: ResultPlacement[]; note: string | null; confirmed_at: string } | null;
  bank: Coverage;
  me: { name: string; email: string; role: string; permissions: Permission[] };
}

/** Full board row (organizer-only reviews include enrollment ids). */
export interface ReviewRow {
  enrollmentId: string;
  teamId?: string;
  crewId: string;
  name: string;
  color?: string;
  slotNumber?: number;
  score: number;
  cumulative: number;
  rank: number | null;
  solves?: number;
}

export interface TopConflict {
  score: number;
  enrollmentIds: string[];
  positions: number[];
}

export interface TeamMember {
  position?: number;
  name: string;
  institution: string;
  year: string;
  branch: string;
  studentId?: string | null;
}

export interface TeamRow {
  id: string;
  crew_id: string;
  name: string;
  email: string;
  captain_name: string;
  color: string;
  account_enabled: boolean;
  checked_in_at: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  credential_status: 'NONE' | 'ISSUED' | 'DELIVERED';
  created_via: string;
  has_credentials: boolean;
  must_change_password: boolean;
  slot_id: string | null;
  slot_number: number | null;
  slot_name: string | null;
  slot_date: string | null;
  enrollment_status: 'ACTIVE' | 'ELIMINATED' | 'DISQUALIFIED' | null;
  enrollment_id: string | null;
  sessions: number;
  members: TeamMember[] | null;
  disqualifications: { id: string; reason: string; createdAt: string }[] | null;
  last_credential_at: string | null;
  standing: { wallet: number; cumulative: number; perSprint: Record<string, number>; rank: number | null; solves: number } | null;
}

export interface BankQuestion {
  id: string;
  key: string;
  pool: 'REGULAR' | 'BONUS';
  title: string;
  is_demo: boolean;
  archived: boolean;
  domain: string;
  domain_name: string;
  version_id: string;
  version_no: number;
  status: 'DRAFT' | 'REVIEWED' | 'PUBLISHED' | 'ARCHIVED';
  difficulty: Difficulty;
  workspace: string;
  run_language: string | null;
  validation_mode: 'EXACT_TEXT' | 'NUMERIC' | 'CODE_TESTS';
  uses: number;
}

export interface BankResponse {
  questions: BankQuestion[];
  coverage: Coverage;
}

export const TEAM_IMPORT_COLUMNS = [
  'team_name', 'crew_id', 'captain_email',
  'member1_name', 'member1_institution', 'member1_year', 'member1_branch', 'member1_student_id',
  'member2_name', 'member2_institution', 'member2_year', 'member2_branch', 'member2_student_id',
  'member3_name', 'member3_institution', 'member3_year', 'member3_branch', 'member3_student_id',
  'member4_name', 'member4_institution', 'member4_year', 'member4_branch', 'member4_student_id',
  'slot', 'account_enabled', 'checked_in',
] as const;
export const REQUIRED_IMPORT_COLUMNS = ['team_name', 'captain_email', 'member1_name'];
