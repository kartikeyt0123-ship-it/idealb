/** Thin typed client for the AMONG BUGS API. Cookies are HttpOnly; nothing secret is stored in the browser. */

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

export const api = {
  get: <T>(url: string, signal?: AbortSignal) => request<T>('GET', url, undefined, { signal }),
  post: <T>(url: string, body?: unknown, idempotencyKey?: string) => request<T>('POST', url, body, { idempotencyKey }),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

// ---------------------------------------------------------------------------
// Shared types (mirror server DTOs)
// ---------------------------------------------------------------------------

export type GamePhase =
  | 'DRAFT' | 'READY' | 'WAITING' | 'RUNNING' | 'PAUSED' | 'CLOSED'
  | 'ELIMINATION_REVIEW' | 'WAITING_NEXT_SPRINT' | 'GAME_RESULT_REVIEW' | 'COMPLETED';

export interface SprintDto {
  number: number;
  status: 'PENDING' | 'RUNNING' | 'PAUSED' | 'CLOSED' | 'FINALIZED';
  durationSeconds: number;
  eliminateCount: number | null;
  startedAt: string | null;
  deadlineAt: string | null;
  pausedAt: string | null;
  closedAt: string | null;
  remainingSeconds: number | null;
  version: number;
}

export interface GameDto {
  id: string;
  number: number;
  name: string;
  phase: GamePhase;
  currentSprint: number;
  rankingMetric: 'NET_COINS' | 'GROSS_EARNED';
  prizePlaces: number;
  imposterMode: 'RESERVE' | 'OPEN';
  imposterBlocksRegular: boolean;
  durationPreset: string;
  version: number;
}

export interface Standing {
  crewId: string;
  name: string;
  color: string;
  status: 'ACTIVE' | 'ELIMINATED' | 'DISQUALIFIED';
  eliminatedSprint: number | null;
  score: number;
  earned: number;
  spent: number;
  tasksSolved: number;
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
  counts: { total: number; available: number; locked: number; solvedByYou: number; solvedByOthers: number; closed: number };
}

export interface TaskCard {
  id: string;
  label: string;
  domain: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  reward: number;
  hintCost: number;
  state: 'LOCKED' | 'AVAILABLE' | 'SOLVED_BY_YOU' | 'SOLVED' | 'CLOSED' | 'DISABLED';
  title: string | null;
  solvedByCrew: string | null;
  generation: number;
  releaseInSeconds: number | null;
  hintUnlocked: boolean;
}

export interface ImposterDto {
  id: string;
  label: string;
  title: string;
  difficulty: string;
  reward: number;
  hintCost: number;
  mode: 'RESERVE' | 'OPEN';
  status: 'OFFERED' | 'RESERVED' | 'SOLVED' | 'EXPIRED' | 'CANCELLED';
  claimDeadlineAt: string | null;
  openDeadlineAt: string | null;
  claimOpen: boolean;
  reservedByMe: boolean;
  reservation: { crew: string; status: string; solveDeadlineAt: string | null; mine: boolean } | null;
  solvedBy: string | null;
}

export interface Announcement {
  id: string;
  message: string;
  kind: string;
  created_at: string;
}

export interface ParticipantState {
  serverTime: string;
  identity: { role: 'COMPETITOR'; teamId: string; crewId: string; name: string; color: string; members: { name: string; is_captain: boolean }[]; mustChangePassword: boolean };
  event: { name: string; isDemo: boolean };
  day: { number: number; label: string };
  game: GameDto;
  sprint: SprintDto | null;
  sprints: SprintDto[];
  me: {
    status: 'ACTIVE' | 'ELIMINATED' | 'DISQUALIFIED';
    eliminatedSprint: number | null;
    wallet: number;
    earned: number;
    spent: number;
    score: number;
    rank: number | null;
    zone: 'SAFE' | 'UNCERTAIN' | 'DANGER' | null;
    tasksSolved: number;
    activeReservationId: string | null;
    activeCount: number;
  };
  standings: { active: Standing[]; inactive: Standing[] };
  domains: DomainDto[];
  tasks: { sprint: number | null; tasks: TaskCard[] };
  imposter: ImposterDto | null;
  announcements: Announcement[];
  lastElimination: { sprint: number; confirmedAt: string; youEliminated: boolean; count: number } | null;
  prizes: { place: number; label: string }[];
  result: { rows: ResultRow[]; confirmedAt: string } | null;
}

export interface ResultRow {
  place: number;
  crewId: string;
  name: string;
  color: string;
  score: number;
  earned: number;
  spent: number;
  prize: string | null;
}

export interface CommanderShipState {
  serverTime: string;
  identity: { role: 'COMMANDER'; name: string; adminRole: string };
  event: { name: string; isDemo: boolean };
  day: { number: number; label: string } | null;
  game: GameDto | null;
  sprint?: SprintDto | null;
  standings?: { active: Standing[]; inactive: Standing[] };
  domains?: DomainDto[];
  announcements?: Announcement[];
}

export interface TeamStatus {
  role: 'COMPETITOR';
  team: { id: string; crewId: string; name: string; email: string; color: string; requestedDays: 'DAY1' | 'DAY2' | 'BOTH'; mustChangePassword: boolean };
  members: { position: number; name: string; institution: string; year: string; branch: string; is_captain: boolean }[];
  days: { day_number: number; label: string; active: boolean }[];
  currentDay: { number: number; label: string } | null;
  access: { state: string; message: string; day?: number; gameNumber?: number };
  event: { name: string; isDemo: boolean };
}

export interface CommanderStatus {
  role: 'COMMANDER';
  admin: { id: string; name: string; email: string; role: 'SUPER_ADMIN' | 'OPERATOR' | 'CONTENT_EDITOR' };
}

export type Me = TeamStatus | CommanderStatus | { role: null };

export interface TaskFile {
  name: string;
  language: string;
  content: string;
  readOnly: boolean;
}

export interface TaskDetail {
  id: string;
  kind: 'REGULAR' | 'IMPOSTER';
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
  status: string;
  solvedBy?: string | null;
  hint: { cost: number; unlocked: boolean; text: string | null };
  sprintDeadlineAt?: string | null;
  solveDeadlineAt?: string | null;
  reservationStatus?: string | null;
}

export interface SubmitResult {
  correct: boolean;
  result: 'CORRECT' | 'INCORRECT';
  reward?: number;
  wallet: number;
  message: string;
  judge: { passed: boolean; total: number; passedCount: number; firstFailure?: { index: number; reason: string; stderrTail?: string } } | null;
}

export interface RunResult {
  jobId: string;
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';
  language: string;
  result: { stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; outputTruncated: boolean; durationMs: number; runtime: string } | null;
  error: string | null;
}

export const CREW_COLORS: [string, string][] = [
  ['Cyan', '#51cfdf'], ['Red', '#f37983'], ['Green', '#86cd97'], ['Yellow', '#edd478'], ['Purple', '#b298e7'],
  ['Orange', '#efae77'], ['Pink', '#d693b9'], ['Blue', '#7dace9'], ['Lime', '#b3d77c'], ['White', '#dfe7ea'],
];
