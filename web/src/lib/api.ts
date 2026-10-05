/** Thin typed client for the AMONG BUG API (/api/v1). Cookies are HttpOnly; nothing secret is stored in the browser. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
  }
  get fields(): Record<string, string> {
    return ((this.details?.fields as Record<string, string>) ?? {}) as Record<string, string>;
  }
}

let serverOffsetMs = 0;
/** Milliseconds to add to Date.now() to approximate server time (display only; the server is authoritative). */
export const serverNow = () => Date.now() + serverOffsetMs;
export function syncClock(serverTimeIso: string | undefined) {
  if (!serverTimeIso) return;
  const t = Date.parse(serverTimeIso);
  if (Number.isFinite(t)) serverOffsetMs = t - Date.now();
}

export function newKey(prefix = 'k') {
  const r = crypto.getRandomValues(new Uint8Array(12));
  return `${prefix}-${Array.from(r, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

async function request<T>(method: string, url: string, body?: unknown, opts: { idempotencyKey?: string; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      signal: opts.signal,
      headers: {
        ...(method !== 'GET' ? { 'content-type': 'application/json', 'x-requested-with': 'amongbugs' } : {}),
        ...(opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}),
      },
      body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Ship comms are down — check your connection. Retrying is safe.');
  }
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* plain text (CSV) */
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; message?: string; details?: Record<string, unknown> };
    throw new ApiError(res.status, d.error ?? 'HTTP_' + res.status, d.message ?? `Request failed (${res.status}).`, d.details ?? null);
  }
  return data as T;
}

/** Every endpoint lives under /api/v1 (see /api/v1/openapi.json). */
export const V1 = '/api/v1';

export const api = {
  get: <T>(url: string, signal?: AbortSignal) => request<T>('GET', url, undefined, { signal }),
  post: <T>(url: string, body?: unknown, idempotencyKey?: string) => request<T>('POST', url, body, { idempotencyKey }),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

// ---------------------------------------------------------------------------
// Shared types (mirror server DTOs — server/src/services/{snapshot,ranking,display,questions}.ts)
// ---------------------------------------------------------------------------

export type SlotPhase = 'CONFIGURING' | 'READY' | 'WAITING' | 'RUNNING' | 'REVIEW' | 'COMPLETED';
export type SprintStatus = 'READY' | 'RUNNING' | 'PAUSED' | 'CLOSED' | 'FINALIZED';
export type Metric = 'GROSS_EARNED' | 'NET_COINS';

export interface SprintDto {
  id: string;
  number: number;
  status: SprintStatus;
  durationSeconds: number;
  eliminateCount: number;
  startedAt: string | null;
  deadlineAt: string | null;
  pausedAt: string | null;
  closedAt: string | null;
  remainingSeconds: number | null;
  version: number;
}

export interface SlotDto {
  id: string;
  number: number;
  name: string;
  phase: SlotPhase;
  currentSprint: number;
  capacity: number;
  scheduledStartAt: string | null;
  finalizedAt: string | null;
  /** Set once an organizer opens (kicks in) the slot; its crews can board only after this. */
  openedAt: string | null;
  version: number;
  date: string | null;
  dayLabel: string | null;
}

/** Public leaderboard row (approved fields only). */
export interface BoardRow {
  crewId: string;
  name: string;
  color: string;
  slotNumber: number;
  status: 'ACTIVE' | 'ELIMINATED' | 'DISQUALIFIED';
  /** Score in the board's scope (sprint score on sprint boards, cumulative on slot/overall boards). */
  score: number;
  cumulative: number;
  perSprint: Record<string, number>;
  solves: number;
  rank: number | null;
  zone: 'SAFE' | 'UNCERTAIN' | 'DANGER' | null;
}

export interface DomainDto {
  slug: string;
  name: string;
  room: string;
  color: string;
  symbol: string;
  prefix: string;
  workspace: string;
  counts: { total: number; available: number; solvedByYou: number; solvedByOthers: number; expired: number };
}

export type QuestionKind = 'INITIAL' | 'RESERVE' | 'BONUS';

export interface QuestionCard {
  id: string;
  label: string;
  kind: QuestionKind;
  domain: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  reward: number;
  hintCost: number;
  state: 'AVAILABLE' | 'SOLVED_BY_YOU' | 'SOLVED' | 'EXPIRED' | 'DISABLED';
  title: string;
  solvedByCrew: string | null;
  generation: number;
  hintUnlocked: boolean;
}

export interface Announcement {
  id: string;
  message: string;
  kind: string;
  created_at: string;
}

/** GET /api/v1/slots/mine/state — the crew's complete authorised view of its own slot. */
export interface CrewState {
  serverTime: string;
  identity: { role: 'CREW'; teamId: string; crewId: string; name: string; color: string; members: { name: string; is_captain: boolean }[]; mustChangePassword: boolean };
  event: { name: string; edition: string; organizer: string; isDemo: boolean; metric: Metric; phase: 'OPEN' | 'FINAL_REVIEW' | 'FINALIZED' };
  slot: SlotDto;
  sprint: SprintDto | null;
  sprints: SprintDto[];
  me: {
    status: 'ACTIVE' | 'ELIMINATED' | 'DISQUALIFIED';
    wallet: number;
    earned: number;
    spent: number;
    sprintScore: number;
    cumulative: number;
    sprintRank: number | null;
    slotRank: number | null;
    solves: number;
    zone: 'SAFE' | 'UNCERTAIN' | 'DANGER' | null;
    activeCount: number;
  };
  leaderboards: { sprint: { number: number; rows: BoardRow[] }; slot: { rows: BoardRow[]; inactive: BoardRow[] } };
  domains: DomainDto[];
  questions: QuestionCard[];
  bonuses: QuestionCard[];
  announcements: Announcement[];
  lastElimination: { sprint: number; youEliminated: boolean; count: number } | null;
  result: { rows: ResultRow[]; confirmedAt: string } | null;
}

export interface ResultRow extends BoardRow {
  place: number;
  prize?: string | null;
}

/** GET /api/v1/leaderboards?scope=sprint|cumulative|event */
export interface LeaderboardResponse {
  scope: 'sprint' | 'cumulative' | 'event';
  metric: Metric;
  sprint?: number;
  status?: 'PROVISIONAL' | 'FINAL';
  rows: BoardRow[];
  inactive?: BoardRow[];
}

export interface CrewIdentity {
  role: 'CREW';
  team: { id: string; crewId: string; name: string; email: string; color: string; mustChangePassword: boolean };
  members: { name: string; institution: string; is_captain: boolean }[];
  /** state: ASSIGNED, or the reason the crew cannot play (SLOT_NOT_OPEN, ATTENDANCE_REQUIRED, SLOT_UNASSIGNED, ACCOUNT_DISABLED, TEAM_DISQUALIFIED, TEAM_ARCHIVED). */
  access: { state: string; message: string; slot?: { id: string; number: number; name: string; phase: SlotPhase; date: string; dayLabel: string; scheduledStartAt: string | null } };
}

export type OrganizerRole = 'SUPER_ADMIN' | 'OPERATOR' | 'CONTENT_EDITOR';
export interface OrganizerIdentity {
  role: 'ORGANIZER';
  organizer: { id: string; name: string; email: string; role: OrganizerRole; permissions: string[] };
}

export type Me = CrewIdentity | OrganizerIdentity | { role: null };

export interface Meta {
  event: { name: string; organizer: string; edition: string; venue: string; isDemo: boolean; timezone: string } | null;
  demoMode: boolean;
  registration: false;
  colors: [string, string][];
}

export interface TaskFile {
  name: string;
  language: string;
  content: string;
  readOnly: boolean;
}

/** GET /api/v1/question-instances/:id */
export interface QuestionDetail {
  id: string;
  kind: QuestionKind;
  label: string;
  generation: number;
  domain: { slug: string; name: string; room: string; color: string; symbol: string } | null;
  title: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  reward: number;
  statement: string;
  workspace: 'WEB' | 'DATA' | 'DS' | 'BASIC' | 'DESIGN' | 'MISC';
  runLanguage: 'javascript' | 'python' | null;
  runEntry: string | null;
  files: TaskFile[];
  sampleStdin: string | null;
  answerFormat: string;
  validation: { mode: 'EXACT_TEXT' | 'NUMERIC' | 'CODE_TESTS'; language?: string; testCount?: number; tolerance?: number; caseSensitive?: boolean; collapseWhitespace?: boolean };
  status: 'AVAILABLE' | 'SOLVED_BY_YOU' | 'SOLVED' | 'EXPIRED' | 'DISABLED';
  solvedBy: string | null;
  hint: { cost: number; unlocked: boolean; text: string | null };
  sprintDeadlineAt: string | null;
}

export interface SubmitResult {
  correct: boolean;
  result: 'CORRECT' | 'INCORRECT';
  reward?: number;
  wallet: number;
  message: string;
  judge: { passed: boolean; total: number; passedCount: number; firstFailure?: { index: number; reason: string; stderrTail?: string } } | null;
}

export interface HintResult {
  hint: string;
  cost: number;
  charged: boolean;
  wallet: number;
}

export interface RunResult {
  jobId: string;
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';
  language: string;
  result: { stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; outputTruncated: boolean; durationMs: number; runtime: string } | null;
  error: string | null;
}

/** Projector payloads (GET /api/v1/display/…). */
export interface DisplayState {
  serverTime: string;
  event: { name: string; edition: string; organizer: string; venue: string; phase: string; metric: Metric };
  slots: {
    id: string; number: number; name: string; date: string; dayLabel: string; phase: SlotPhase; currentSprint: number;
    sprint: { id: string; number: number; status: SprintStatus; deadlineAt: string | null; pausedAt: string | null; durationSeconds: number } | null;
    sprints: { id: string; number: number; status: SprintStatus }[];
  }[];
  scope: 'OVERALL' | 'SLOT' | 'SPRINT';
  status: 'LIVE' | 'FROZEN' | 'PROVISIONAL' | 'FINAL' | 'NOT_STARTED';
  slotId?: string;
  sprintNumber?: number;
  completedSlots?: number[];
  rows: { rank: number | null; crewId: string; name: string; color: string; slotNumber: number; score: number; cumulative: number; perSprint: Record<string, number>; solves: number }[];
}

export const CREW_COLORS: [string, string][] = [
  ['Cyan', '#51cfdf'], ['Red', '#f37983'], ['Green', '#86cd97'], ['Yellow', '#edd478'], ['Purple', '#b298e7'],
  ['Orange', '#efae77'], ['Pink', '#d693b9'], ['Blue', '#7dace9'], ['Lime', '#b3d77c'], ['White', '#dfe7ea'],
];

/** The display name is centralised server-side (event.name, default "AMONG BUG"); this is only the pre-load fallback. */
export const FALLBACK_EVENT_NAME = 'AMONG BUG';
