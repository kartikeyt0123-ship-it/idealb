/** Explicit, documented error codes. The UI maps these to themed messages. */
export const ErrorCodes = {
  VALIDATION_FAILED: 400,
  BAD_REQUEST: 400,
  IMPORT_INVALID: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  ORGANIZER_CLEARANCE_REQUIRED: 403,
  ACCOUNT_DISABLED: 403,
  SLOT_UNASSIGNED: 403,
  SLOT_NOT_OPEN: 403,
  ATTENDANCE_REQUIRED: 403,
  WRONG_SLOT: 403,
  TEAM_ELIMINATED: 403,
  TEAM_DISQUALIFIED: 403,
  TEAM_ARCHIVED: 403,
  NOT_FOUND: 404,
  QUESTION_NOT_RELEASED: 404,
  NOT_CONFIGURED: 409,
  SESSION_LIMIT: 409,
  CONFLICT: 409,
  DUPLICATE_EMAIL: 409,
  DUPLICATE_TEAM_NAME: 409,
  IDEMPOTENCY_MISMATCH: 409,
  STALE_VERSION: 409,
  INVALID_TRANSITION: 409,
  PREFLIGHT_FAILED: 409,
  RULES_FROZEN: 409,
  RULES_UNCONFIRMED: 409,
  TIE_RESOLUTION_REQUIRED: 409,
  ANOTHER_SLOT_RUNNING: 409,
  SPRINT_NOT_RUNNING: 409,
  SPRINT_PAUSED: 409,
  SPRINT_CLOSED: 409,
  QUESTION_EXPIRED: 409,
  QUESTION_ALREADY_SOLVED: 409,
  QUESTION_DISABLED: 409,
  STALE_QUESTION: 409,
  INSUFFICIENT_FUNDS: 409,
  POOL_EMPTY: 409,
  HINT_UNAVAILABLE: 409,
  SLOT_CHANGE_BLOCKED: 409,
  MAIL_NOT_CONFIGURED: 409,
  RUNTIME_UNAVAILABLE: 503,
  RUNNER_UNAVAILABLE: 503,
  RUNNER_BUSY: 503,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.status = ErrorCodes[code];
  }
}

export const fail = (code: ErrorCode, message: string, details?: Record<string, unknown>): never => {
  throw new AppError(code, message, details);
};
