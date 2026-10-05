# CLAUDE.md

Start with **README.md → "Future context (read this first)"**. It is the maintained handoff for
this repository: current format (four slots), architecture, invariants, where things live, how
to run and verify, and what is still open. Keep that section up to date when you change behaviour.

Quick rules for this repo:
- Spec of record: the four-slot brief `AMONG_BUG_Four_Slots_Claude_Code_Prompt.md` (supplied by the
  user, not stored in the repo; it supersedes the two-game brief). Its rules and how conflicts were
  resolved are in `docs/DECISIONS.md`.
- PostgreSQL is the only source of truth. Scoring goes through `server/src/services/questions.ts`
  (locks: slot → sprint → enrollment → question instance; DB clock for deadlines; idempotency keys).
  The ledger and audit log are append-only.
- Never add public registration, auto-send credentials, auto-publish questions, auto-start
  sprints, or report mail as delivered when it was only captured.
- Every `/api/v1` route is declared via `api(app)` in `server/src/routes/openapi.ts` (it feeds
  `/api/v1/openapi.json`).
- Verify with `npm run typecheck`, `npm test` (real PostgreSQL + runner), `npm run content:check`,
  and `npm run test:e2e` against `npm run dev`. Report results honestly.
- Commit only when the user asks.
