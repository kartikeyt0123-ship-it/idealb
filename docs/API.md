# AMONG BUGS — API contract

Base path: `/api`. All responses are JSON unless noted. Authentication uses an HttpOnly
`ab_sid` session cookie (`SameSite=Lax`, `Secure` in production).

Every state-changing request (POST/PUT/PATCH/DELETE) must send the
`X-Requested-With: amongbugs` header. If an `Origin` header is present, it must be in
`ALLOWED_ORIGINS`. Scoring mutations also take an `Idempotency-Key` header
(8–100 chars, `[A-Za-z0-9_-]`). A retry with the same key returns the original response;
reusing a key with a different payload returns `409 IDEMPOTENCY_MISMATCH`.

Errors are returned as `{ "error": CODE, "message": "human text", "details": {...} | null }`.
Validation errors carry `details.fields` (`{ fieldPath: message }`).

## Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Bad input (see `details.fields`) |
| `UNAUTHENTICATED` / `INVALID_CREDENTIALS` | 401 | No or invalid session / wrong password |
| `COMMANDER_CLEARANCE_REQUIRED` | 403 | Crew session hit a commander endpoint (card swipe denied) |
| `FORBIDDEN` | 403 | Admin role lacks the permission |
| `REGISTRATION_PENDING` | 403 | Registered crew with no approved day |
| `NOT_ACTIVATED_FOR_DAY` | 403 | Crew not approved for today's day / game |
| `NO_ACTIVE_DAY` | 403 | Event has no current day / game |
| `TEAM_ELIMINATED` / `TEAM_DISQUALIFIED` / `TEAM_ARCHIVED` | 403 | Crew can no longer act |
| `IMPOSTER_NOT_OWNER` | 403 | Another crew holds the imposter |
| `NOT_FOUND` / `TASK_NOT_RELEASED` | 404 | Unknown, or not released yet (no content leaked) |
| `DUPLICATE_EMAIL` / `DUPLICATE_TEAM_NAME` | 409 | Registration conflicts (field-specific) |
| `SESSION_LIMIT` | 409 | Device limit reached (only with the `REJECT` policy) |
| `STALE_VERSION` / `INVALID_TRANSITION` | 409 | Admin acted on an old version, or the state does not allow it |
| `PREFLIGHT_FAILED` | 409 | Sprint start blocked; `details.preflight` explains why |
| `TIE_RESOLUTION_REQUIRED` | 409 | A tie crosses the cutoff or a prize boundary and needs a decision |
| `SPRINT_NOT_RUNNING` / `SPRINT_PAUSED` / `SPRINT_CLOSED` / `TASK_WINDOW_CLOSED` | 409 | Timing / phase rejections |
| `TASK_ALREADY_SOLVED` | 409 | "This problem has already been solved by another crew. Move on to the next task." |
| `TASK_DISABLED` / `STALE_TASK` | 409 | Disabled by the commander / reopened as a new generation |
| `INSUFFICIENT_FUNDS` / `HINT_UNAVAILABLE` | 409 | Hint purchase rejected (no charge) |
| `IMPOSTER_CLAIMED` / `IMPOSTER_WINDOW_CLOSED` / `IMPOSTER_MODE_ACTIVE` | 409 | Imposter rules |
| `RATE_LIMITED` | 429 | Slow down |
| `RUNNER_UNAVAILABLE` / `RUNNER_BUSY` / `RUNTIME_UNAVAILABLE` | 503 | Real runner errors (never faked output) |

## Public and auth

| Method & path | Body | Notes |
|---|---|---|
| `GET /api/health` | – | DB liveness |
| `GET /api/meta` | – | Event name, demo flag, crew colours. The demo crew hint is included only when `DEMO_MODE=true`. |
| `POST /api/auth/register` | `{teamName, captainEmail, password, confirmPassword, members[3..4]{name,institution,year,branch,studentId?}, requestedDays: DAY1\|DAY2\|BOTH, color, rulesAccepted:true}` + `Idempotency-Key` | 201 `{crewId, teamName, status:'PENDING_ACTIVATION'}`. Strict schema: no roles, coins or days can be set. |
| `POST /api/auth/login` | `{mode:'CREW'\|'COMMANDER', identifier, password}` | CREW accepts captain email or crew ID and returns team status. COMMANDER returns the admin profile. |
| `POST /api/auth/logout` | – | Revokes the server session |
| `GET /api/auth/me` | – | `{role:null}` / team status (`access.state`) / commander |
| `POST /api/auth/change-password` | `{currentPassword, newPassword}` | Signs out the crew's other devices |
| `POST /api/auth/reset` | `{token, password}` | Completes an organizer-issued reset code (30 min) |

## Crew game (authorised for the current day's game on every call)

| Method & path | Notes |
|---|---|
| `GET /api/game/state` | Full snapshot: identity, game, sprint(s), me (wallet / score / rank / zone), standings, domains with counts, task cards (no titles while locked), imposter offer, announcements, last elimination, prizes, result |
| `GET /api/game/tasks` | Task cards for the visible sprint |
| `GET /api/game/tasks/:id` | Statement, files, answer format, public validation info, hint `{cost, unlocked, text}` (text only after purchase). ACTIVE crews only. |
| `POST /api/game/tasks/:id/submit` | `{generation, answer?}` or `{generation, files?}` + `Idempotency-Key` → `{correct, result, reward?, wallet, judge}` |
| `POST /api/game/tasks/:id/hint` | `Idempotency-Key` → `{hint, cost, charged, wallet}` |
| `POST /api/game/run` | `{target:{type:'TASK'\|'IMPOSTER', id}, files, stdin}` → run job (`DONE` usually inline). Never awards coins. |
| `GET /api/game/run/:id` · `POST /api/game/run/:id/cancel` | Poll / cancel your own run |
| `GET /api/game/imposter/:id` | Owner only (RESERVE mode) |
| `POST /api/game/imposter/:id/reserve` · `/submit` · `/hint` · `/abandon` | First reservation wins. Submit / hint take `Idempotency-Key`. |
| `GET /api/game/wallet` | Own ledger entries |
| `POST /api/command/authorize` | Card-swipe check: commander → `{granted:true}`; crew → `403 COMMANDER_CLEARANCE_REQUIRED` |

## Commander (role-checked; see `server/src/http.ts` for the role → permission map)

| Area | Endpoints |
|---|---|
| Overview | `GET /api/admin/overview` (event, days, games with sprints, standings, preflight, imposters, prizes, results), `GET /api/admin/ship-state` |
| Event | `PATCH /api/admin/event {daySelectionMode, manualDayNumber, sessionLimit, sessionLimitPolicy}` |
| Crews | `GET /api/admin/crews`, `POST /api/admin/crews {crews[], via}` (one-time temporary passwords), `PATCH /api/admin/crews/:id`, `POST …/:id/eligibility {dayNumber, active}`, `POST /api/admin/crews/eligibility/bulk {teamIds, dayNumber, active, apply}`, `POST …/:id/check-in`, `POST …/:id/reset-password`, `GET …/:id/sessions`, `DELETE /api/admin/sessions/:id`, `POST …/:id/disqualify {scope, gameId?, reason}`, `POST /api/admin/disqualifications/:id/revoke {reason}` |
| Game control | `PATCH /api/admin/games/:id/config` (ranking rule plus confirmation, preset, durations, eliminate counts, imposter mode, recycling, starting coins, prizes, day) · `GET …/preflight?sprint=n` · `POST …/start-sprint {sprint, expectedVersion?, acknowledgeZeroElimination?}` · `POST …/pause` · `POST …/resume` · `POST …/close-sprint {reason}` |
| Elimination & results | `GET …/elimination` · `POST …/elimination/confirm {resolution?:{mode, eliminateEnrollmentIds?, note}}` · `GET …/results` · `POST …/results/confirm {resolution?:{mode:'SHARE'\|'MANUAL_ORDER', order?, note}}` |
| Tasks | `GET /api/admin/games/:id/tasks` · `PATCH /api/admin/tasks/:id {releaseOffsetSeconds?, closeOffsetSeconds?, disabled?}` |
| Imposters | `PATCH /api/admin/imposters/:id` (draft) · `POST …/release` · `POST …/cancel {reason}` · `POST …/rearm` |
| IdeaCoins | `GET /api/admin/games/:id/ledger` · `POST /api/admin/enrollments/:id/adjust {amount, target: WALLET\|SCORE\|BOTH\|GRANT, reason}` |
| Library | `GET /api/admin/problems` · `GET /api/admin/problem-versions/:id` (solution only for SUPER_ADMIN / CONTENT_EDITOR) · `POST /api/admin/problems` · `PUT /api/admin/problem-versions/:id` (drafts only) · `POST /api/admin/problems/:id/new-version` · `POST …/verify` (runs solution + starter through the runner) · `POST …/publish` · `POST …/assign {gameId, sprint, releaseOffsetSeconds?, closeOffsetSeconds?, asImposter?}` · `GET /api/admin/problems/export` |
| Ops | `POST /api/admin/announcements` · `GET /api/admin/audit` · `GET /api/admin/health` · `GET /api/admin/export/{standings\|ledger\|results\|crews}.csv?gameId=` (formula-injection safe) |

## Realtime (Socket.IO, path `/socket.io`)

Sockets authenticate from the session cookie, and the server assigns rooms: `all`, `admin`,
`team:<id>` and `game:<id>`. The `game:<id>` room is joined only while the crew is eligible.
Clients cannot request rooms.

Each event carries `eventId` (outbox id; used to drop duplicates) and `serverTime`.
Clients treat events as "something changed" hints and re-fetch `GET /api/game/state`.
They also re-fetch on every (re)connect, which the server signals with `hello`.

Topics: `eligibility.changed`, `session.revoked`, `event.changed`, `game.updated`, `sprint.started|paused|resumed|closed`,
`task.available|solved|reopened`, `wallet.updated`, `hint.unlocked`, `standings.updated`,
`imposter.offered|reserved|expired|solved|cancelled`, `team.eliminated`, `team.disqualified`, `game.completed`,
`announcement.created`, `crews.changed`, `content.changed`.

Broad rooms never receive answers, hints, statements or another crew's private data.
