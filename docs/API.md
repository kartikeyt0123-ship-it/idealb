# AMONG BUG — API contract (`/api/v1`)

The machine-readable contract is served by the API itself:
**`GET /api/v1/openapi.json`** (OpenAPI 3.0.3, generated from the same registry that declares
every route; a route cannot exist without being documented). `GET /api/v1/routes` lists them as JSON.

## Conventions

- JSON everywhere except exports and templates (CSV / XLSX downloads).
- Authentication: an HttpOnly session cookie `ab_sid` (`SameSite=Lax`, `Secure` in production)
  for crews and organizers. Projectors use a separate display-only cookie `ab_display`.
- Every state-changing request must send `X-Requested-With: amongbugs`. An `Origin`, when
  present, must be in `ALLOWED_ORIGINS` or be the same host the request was sent to.
- Scoring mutations (submissions, hint purchases) take an `Idempotency-Key` header
  (8–100 chars, `[A-Za-z0-9_-]`):
  - a retry with the same key returns the original response;
  - reusing a key with different data returns `409 IDEMPOTENCY_MISMATCH`.
- Organizer state changes accept an optional `If-Match: <version>` (slot or event version). On a
  mismatch they return `409 STALE_VERSION`.
- **A slot id in a crew URL never authorises anything.** The server always uses the crew's own
  enrollment:
  - another slot's id gives `403 WRONG_SLOT`;
  - another slot's (or an unreleased) question id gives `404`.
- There is **no registration endpoint**. Crews come from organizer imports.

Errors: `{ "error": CODE, "message": "human text", "details": {...} | null }`. Validation errors
carry `details.fields`.

## Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_FAILED`, `BAD_REQUEST` | 400 | Bad input |
| `IMPORT_INVALID` | 400 | Import has row errors / bad file / over capacity; nothing was written |
| `UNAUTHENTICATED`, `INVALID_CREDENTIALS` | 401 | No / invalid session, wrong password, crew without credentials yet |
| `ORGANIZER_CLEARANCE_REQUIRED` | 403 | A crew session hit an organizer endpoint |
| `FORBIDDEN` | 403 | Organizer role lacks the permission, or CSRF header / origin missing |
| `ACCOUNT_DISABLED`, `SLOT_UNASSIGNED`, `WRONG_SLOT` | 403 | Crew cannot act (disabled / no slot / not its slot) |
| `ATTENDANCE_REQUIRED` | 403 | Crew not marked present; login (and crew APIs) refused until the roll call |
| `SLOT_NOT_OPEN` | 403 | The crew's slot has not been opened (kick-in) yet; it waits |
| `TEAM_ELIMINATED`, `TEAM_DISQUALIFIED`, `TEAM_ARCHIVED` | 403 | Crew can no longer act |
| `NOT_FOUND`, `QUESTION_NOT_RELEASED` | 404 | Unknown, unreleased or other-slot (indistinguishable on purpose) |
| `CONFLICT`, `DUPLICATE_EMAIL`, `DUPLICATE_TEAM_NAME` | 409 | Uniqueness conflicts |
| `SESSION_LIMIT` | 409 | Device limit reached (only with the `REJECT` policy) |
| `STALE_VERSION`, `INVALID_TRANSITION` | 409 | Old version / the state does not allow it |
| `PREFLIGHT_FAILED` | 409 | Sprint start blocked; `details.preflight` lists blockers and warnings |
| `RULES_FROZEN`, `RULES_UNCONFIRMED` | 409 | Rules cannot change after the first start / must be confirmed |
| `ANOTHER_SLOT_RUNNING` | 409 | One running slot at a time |
| `TIE_RESOLUTION_REQUIRED` | 409 | A tie crosses an elimination cutoff or a prize place; send a resolution |
| `SPRINT_NOT_RUNNING`, `SPRINT_PAUSED`, `SPRINT_CLOSED` | 409 | Timing / phase rejections (deadline checked with the DB clock) |
| `QUESTION_ALREADY_SOLVED` | 409 | "This problem has already been solved by another crew. Move on to the next task." |
| `QUESTION_EXPIRED`, `QUESTION_DISABLED`, `STALE_QUESTION` | 409 | Question closed with its sprint / disabled / reset |
| `INSUFFICIENT_FUNDS`, `HINT_UNAVAILABLE` | 409 | Hint purchase rejected (no charge) |
| `SLOT_CHANGE_BLOCKED` | 409 | Crew already scored; slot changes are audited corrections |
| `MAIL_NOT_CONFIGURED` | 409 | No mail transport; nothing was sent |
| `IDEMPOTENCY_MISMATCH` | 409 | Key reused with different data |
| `PAYLOAD_TOO_LARGE` | 413 | Request / upload too large |
| `RATE_LIMITED` | 429 | Slow down |
| `RUNNER_UNAVAILABLE`, `RUNNER_BUSY`, `RUNTIME_UNAVAILABLE` | 503 | Real runner errors (never faked output) |

## Realtime (Socket.IO, path `/socket.io`)

The server assigns rooms from the session; clients cannot name rooms.

| Who | Rooms |
|---|---|
| Crew | `all`, `team:<id>`, and `slot:<id>` **only while** enabled, assigned and not disqualified |
| Organizer | `all`, `organizers` |
| Projector (connects with `?display=1` and the display cookie) | `all`, `display` |

Sessions are re-validated every 15 s, and revoked sessions are disconnected.

Every message carries `eventId` (for de-duplication) and `serverTime`. Treat messages as "something
changed" hints and re-fetch the authorised snapshot; re-fetch after every reconnect.

Topics:

| Group | Topics |
|---|---|
| Access | `eligibility.changed`, `session.revoked` |
| Event and slot | `event.changed`, `slot.updated`, `slot.finalized`, `event.finalized` |
| Sprints | `sprint.started`, `sprint.paused`, `sprint.resumed`, `sprint.closed`, `sprint.finalized` |
| Questions | `question.released`, `question.solved`, `question.expired`, `bonus.released` |
| Crew state | `wallet.updated`, `hint.unlocked`, `leaderboard.updated` |
| Crew status | `team.eliminated`, `team.disqualified` |
| Organizer | `announcement.created`, `teams.changed`, `content.changed` |

Broad rooms (`slot`, `display`, `all`) never receive answers, hints, statements, emails or other
private crew data. `bonus.released` carries titles only.

## Endpoints

Generated from the route registry (`server/src/routes/*.ts`). Auth `crew` / `organizer (permission)` / `display` / `public`.

### admin

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/admin/announcements` | organizer (slots.control) | Announce to one slot or everyone — body `{ slotId|null, message, kind }` |
| GET | `/api/v1/admin/audit` | organizer (audit.read) | Audit log — query `limit, offset` |
| GET | `/api/v1/admin/health` | organizer (audit.read) | DB, worker heartbeat, outbox lag, runner, ledger reconciliation, mail mode |
| GET | `/api/v1/admin/overview` | organizer (teams.read) | Event, slots, sprints, release plan, preflight and rule review |

### auth

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/auth/change-password` | crew | Crew changes its password (required after credential mail) — body `{ currentPassword, newPassword }` |
| POST | `/api/v1/auth/crew-login` | public | Crew sign-in with captain email or CRW id — body `{ identifier, password }` |
| POST | `/api/v1/auth/logout` | public | End this session |
| POST | `/api/v1/auth/organizer-login` | public | Organizer sign-in — body `{ email, password }` |
| GET | `/api/v1/me` | public | Who am I (crew identity + slot access, or organizer role) |
| GET | `/api/v1/meta` | public | Public event branding (no credentials, ever) |

### bank

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/v1/admin/question-versions/:id` | organizer (content.read) | One version (solution only with content.solutions) |
| PUT | `/api/v1/admin/question-versions/:id` | organizer (content.write) | Edit a DRAFT version — body `QuestionInput` |
| POST | `/api/v1/admin/question-versions/:id/status` | organizer (content.write) | DRAFT → REVIEWED → PUBLISHED (or ARCHIVED); never automatic — body `{ to }` |
| POST | `/api/v1/admin/question-versions/:id/verify` | organizer (content.write) | Run the private solution and starter through the real validator |
| POST | `/api/v1/admin/question-versions/bulk-status` | organizer (content.publish) | Move many versions at once (e.g. publish a reviewed domain) — body `{ versionIds, to }` |
| GET | `/api/v1/admin/questions` | organizer (content.read) | Question bank (latest version of each) |
| POST | `/api/v1/admin/questions` | organizer (content.write) | Create a question (as DRAFT) — body `QuestionInput` |
| POST | `/api/v1/admin/questions/:id/drafts` | organizer (content.write) | Start a new draft from the latest version |
| POST | `/api/v1/admin/questions/sync/commit` | organizer (content.publish) | Apply a previewed sync: new questions are created, changed ones get a new version (DRAFT, or PUBLISHED when chosen) — body `{ previewId, publish }` |
| POST | `/api/v1/admin/questions/sync/preview` | organizer (content.write) | Fetch the IDEALab.dev bank from GitHub (or the bundled snapshot) and preview new / changed / unchanged questions — body `{ repo?, ref?, source?: GITHUB|SNAPSHOT }` |

### boards

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/v1/leaderboards` | crew | Sprint, slot-cumulative or overall (provisional until finalized) standings — query `scope=sprint|cumulative|event, sprint=1..4, slotId (organizers)` |

### credentials

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/admin/credential-deliveries` | organizer (credentials.send) | Send credentials (explicit; demo mode captures locally, never delivered externally) — body `{ teamIds, reason, confirm: true }` |
| GET | `/api/v1/admin/credential-deliveries` | organizer (teams.read) | Delivery log (no passwords) |
| POST | `/api/v1/admin/credential-deliveries/preview` | organizer (credentials.send) | Preview who will receive credentials, and through which channel — body `{ teamIds, reason }` |
| GET | `/api/v1/admin/mail-capture` | organizer (mail.read) | Demo mail inbox (captured, not delivered externally) |

### crew

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/v1/question-instances/:id` | crew | Question detail (unreleased or other-slot ids are 404) |
| POST | `/api/v1/question-instances/:id/hint-purchases` | crew, Idempotency-Key | Buy the next (or a given) hint level (wallet only; ranking unaffected under GROSS_EARNED) — body `{ level? }` |
| POST | `/api/v1/question-instances/:id/run-jobs` | crew | Run: code in the isolated runner, a terminal command, a SQL query or a JSON check (never scores) — body `{ files, stdin, command?, cwd? }` |
| POST | `/api/v1/question-instances/:id/submissions` | crew, Idempotency-Key | Submit an answer; first correct in the slot wins — body `{ generation, answer? | files? }` |
| GET | `/api/v1/run-jobs/:id` | crew | Run job status / output |
| POST | `/api/v1/run-jobs/:id/cancel` | crew | Cancel a running job |
| GET | `/api/v1/slots/:slotId/questions` | crew | Released question cards visible in this sprint |
| GET | `/api/v1/slots/:slotId/state` | crew | Authorised snapshot of the crew's own slot (HUD, boards, question cards) |
| GET | `/api/v1/slots/mine/state` | crew | Snapshot of the signed-in crew's assigned slot |
| GET | `/api/v1/teams/me/ledger` | crew | The crew's own coin ledger |

### display

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/v1/admin/display-links` | organizer (display.manage) | Projector links |
| POST | `/api/v1/admin/display-links` | organizer (display.manage) | Create a revocable projector link (key shown once) — body `{ label, hours }` |
| DELETE | `/api/v1/admin/display-links/:id` | organizer (display.manage) | Revoke a projector link (its screens disconnect) |
| POST | `/api/v1/display/logout` | display | Close this projector session |
| GET | `/api/v1/display/overall` | display | Overall board across slots (PROVISIONAL until finalized) |
| POST | `/api/v1/display/session` | public | Open a projector session from a display link key — body `{ key }` |
| GET | `/api/v1/display/slots/:slotId` | display | Slot cumulative board |
| GET | `/api/v1/display/slots/:slotId/sprints/:sprintId` | display | Live / frozen sprint board |

### exports

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/v1/admin/exports/:kind` | organizer (exports) | CSV / XLSX exports (formula-safe, never passwords) — query `format=csv|xlsx, slotId, sprint` |

### import

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/v1/admin/imports/:id` | organizer (teams.read) | Read an import batch (preview or result) |
| GET | `/api/v1/admin/questions/import-template` | organizer (content.write) | Question bank CSV/XLSX template — query `format=csv|xlsx` |
| POST | `/api/v1/admin/questions/imports` | organizer (content.write) | Upload JSON / CSV / XLSX bank (+ linked assets) → preview — body `{ fileName, contentBase64, assets? }` |
| POST | `/api/v1/admin/questions/imports/:id/commit` | organizer (content.write) | Commit a previewed bank import (creates DRAFTs only) |
| GET | `/api/v1/admin/teams/import-template` | organizer (teams.write) | Download the team import template — query `format=csv|xlsx` |
| POST | `/api/v1/admin/teams/imports` | organizer (teams.write) | Upload CSV/XLSX → preview with mapping, row errors, duplicates (writes nothing) — body `{ fileName, contentBase64, mapping? }` |
| POST | `/api/v1/admin/teams/imports/:id/commit` | organizer (teams.write) | Commit a previewed import (idempotent; never sends credentials) |

### ledger

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/admin/enrollments/:id/adjustments` | organizer (coins.adjust) | Compensating ledger entry (wallet / score / both / grant) — body `{ amount, target, reason, sprint? }` |
| GET | `/api/v1/admin/ledger` | organizer (audit.read) | Slot ledger (optionally one crew) — query `slotId, enrollmentId?` |

### releases

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/admin/question-releases` | organizer (releases.manage) | Manual override release (recorded as a fairness deviation) — body `{ slotId, sprintNumber, type, versionIds, offsetSeconds, expiresAtSprintEnd, announcement?, reason, releaseImmediately }` |
| POST | `/api/v1/admin/question-releases/:id/cancel` | organizer (releases.manage) | Cancel an unreleased release — body `{ reason }` |
| POST | `/api/v1/admin/question-releases/:id/release` | organizer (releases.manage) | Release now (idempotent). Early release of a scheduled batch needs a reason — body `{ reason? }` |
| GET | `/api/v1/admin/slots/:slotId/bank` | organizer (content.read) | Bank questions for a slot with usage (new to this slot / used before) — query `domain, difficulty, search, freshOnly` |
| POST | `/api/v1/admin/slots/:slotId/plan` | organizer (releases.manage) | Build / rebuild the initial set (default 7 easy, 5 medium, 3 hard per domain) before the slot starts — body `{ counts?, perDomain?, domains? }` |
| GET | `/api/v1/admin/slots/:slotId/plan` | organizer (teams.read) | The unreleased question set(s) of a slot (initial set / next-start set) |
| DELETE | `/api/v1/admin/slots/:slotId/plan/:instanceId` | organizer (releases.manage) | Remove one question from the unreleased set |
| GET | `/api/v1/admin/slots/:slotId/question-instances` | organizer (teams.read) | Every instance in the slot plan with solver and status |
| POST | `/api/v1/admin/slots/:slotId/releases` | organizer (releases.manage) | Release chosen bank questions now (or at the next sprint start), as regular or bonus — body `{ versionIds, bonus?, when?: NOW|NEXT_START, announcement? }` |
| GET | `/api/v1/admin/slots/:slotId/stock` | organizer (teams.read) | Live stock per domain x difficulty: active, solved, released, planned vs target; bank availability |
| POST | `/api/v1/admin/slots/:slotId/top-up` | organizer (releases.manage) | Auto-pick and release enough questions to bring domains back to target (optionally one domain / difficulty, or N each) — body `{ domain?, difficulty?, count? }` |

### results

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/admin/event/finalize` | organizer (results.finalize) | Finalize overall results (all slots completed) — body `{ resolution? }` |
| GET | `/api/v1/admin/event/results-review` | organizer (results.finalize) | Overall results across the four slots |
| POST | `/api/v1/admin/slots/:slotId/finalize` | organizer (results.finalize) | Freeze the slot result after sprint 4 — body `{ resolution? }` |
| GET | `/api/v1/admin/slots/:slotId/results-review` | organizer (results.finalize) | Slot cumulative results + top-3 tie conflicts |

### rules

| Method | Path | Auth | Purpose |
|---|---|---|---|
| PATCH | `/api/v1/admin/event` | organizer (rules.manage) | Edit display name, organizer, edition, venue, prizes — body `{ name?, organizer?, edition?, venue?, prizes? }` |
| GET | `/api/v1/admin/rules` | organizer (teams.read) | Rule review: every competition default with confirmation state |
| PATCH | `/api/v1/admin/rules` | organizer (rules.manage) | Change rules before the first sprint (changed rules lose confirmation) — body `Partial<Rules>` |
| POST | `/api/v1/admin/rules/:key/confirmation` | organizer (rules.manage) | Confirm (or un-confirm) one reviewed rule — body `{ confirmed }` |

### slots

| Method | Path | Auth | Purpose |
|---|---|---|---|
| PATCH | `/api/v1/admin/slots/:slotId` | organizer (slots.control) | Edit slot name, capacity, informational start time, readiness |
| POST | `/api/v1/admin/slots/:slotId/close-boarding` | organizer (slots.control) | Undo an accidental kick-in (before Sprint 1 only) — body `{ reason }` |
| POST | `/api/v1/admin/slots/:slotId/open` | organizer (slots.control) | Open (kick in) the slot: its crews may board and roam; no sprint starts |
| POST | `/api/v1/admin/slots/:slotId/sprints/:n/close` | organizer (slots.control) | Close the sprint early (reason required); standings freeze — body `{ note }` |
| GET | `/api/v1/admin/slots/:slotId/sprints/:n/elimination-review` | organizer (slots.control) | Optional elimination preview for a closed sprint |
| POST | `/api/v1/admin/slots/:slotId/sprints/:n/finalize` | organizer (slots.control) | Finalize a closed sprint (applies optional elimination) — body `{ resolution? }` |
| POST | `/api/v1/admin/slots/:slotId/sprints/:n/pause` | organizer (slots.control) | Pause the running sprint (timer and releases stop) |
| GET | `/api/v1/admin/slots/:slotId/sprints/:n/preflight` | organizer (slots.control) | Start checklist for a sprint |
| POST | `/api/v1/admin/slots/:slotId/sprints/:n/resume` | organizer (slots.control) | Resume a paused sprint (deadline shifts by the pause) |
| POST | `/api/v1/admin/slots/:slotId/sprints/:n/start` | organizer (slots.control) | Explicitly start sprint n (never automatic) |

### teams

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/admin/disqualifications/:id/revoke` | organizer (disqualify) | Revoke a disqualification (audited correction) — body `{ reason }` |
| DELETE | `/api/v1/admin/sessions/:id` | organizer (teams.write) | Sign out one device |
| GET | `/api/v1/admin/teams` | organizer (teams.read) | All crews with slot, credentials, sessions and standing |
| POST | `/api/v1/admin/teams` | organizer (teams.write) | Create one crew manually (no credentials are sent) — body `TeamInput` |
| PATCH | `/api/v1/admin/teams/:id` | organizer (teams.write) | Edit crew, enable/disable, check-in, slot (blocked after scoring) — body `TeamPatch` |
| POST | `/api/v1/admin/teams/:id/disqualify` | organizer (disqualify) | Disqualify a crew (reason required) — body `{ reason }` |
| GET | `/api/v1/admin/teams/:id/sessions` | organizer (teams.read) | Active devices of a crew |
| POST | `/api/v1/admin/teams/attendance` | organizer (teams.write) | Roll call: mark crews present (enables login) or absent (signs them out) — body `{ teamIds, present }` |
| POST | `/api/v1/admin/teams/bulk-assign` | organizer (teams.write) | Assign many crews to a slot (preview unless apply=true) — body `{ teamIds, slot, apply }` |
