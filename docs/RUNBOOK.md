# AMONG BUGS — Event-day runbook

Audience: the organizer or operator running DEBUG + RUN at AAROHAN 2026.

## 1. Topology (one authoritative database)

```
browsers ──HTTPS──▶ reverse proxy (TLS) ──▶ api (Fastify + Socket.IO, serves the web app)
                                            │        │
                                            │        └──internal "sandbox" network──▶ runner (Node + Python, no egress)
                                            ▼
                                       PostgreSQL ◀── worker (deadlines, imposter expiry, heartbeat)
```

- PostgreSQL is the **only** source of truth. Do not run a second score database (for example, a LAN copy
  and a cloud copy at the same time).
- The API can scale horizontally. Each instance delivers outbox events to its own sockets, and the
  dispatcher reads committed rows, so duplicates are harmless. The in-process rate limits then become
  per instance; move them to Redis if you run more than one instance.
- The worker can run as more than one replica. Every transition is a locked, idempotent transaction.

## 2. Before the event (T-1 day)

1. Create the `.env` from `.env.example` and set:
   - `NODE_ENV=production`, `DEMO_MODE=false`, `COOKIE_SECURE=true`, `TRUST_PROXY=true` (behind TLS).
   - `GRADING_SECRET` and `RUNNER_TOKEN` as long random strings, e.g. `openssl rand -hex 32`.
   - `ALLOWED_ORIGINS=https://your-domain`.
   - `POSTGRES_PASSWORD`.
2. Start the stack with `docker compose up -d --build`.
3. Bootstrap the event and your admin account. This creates no demo accounts and no known passwords:
   `docker compose run --rm -e ADMIN_BOOTSTRAP_EMAIL=you@org -e ADMIN_BOOTSTRAP_PASSWORD='…' api node server/dist/scripts/bootstrap.js`
4. Sign in at `/command` and check, for each game:
   - **Day mapping and dates.** Event day selection should be AUTO (Asia/Kolkata date). Use MANUAL for rehearsals.
   - **Elimination counts K1 and K2** for the real roster. Preflight shows "N active → eliminate K → M survive".
   - **Ranking rule.** Choose NET_COINS or GROSS_EARNED, then tick *confirm*. It is frozen when Sprint 1 starts.
   - **Prize places and labels.**
   - **Imposter mode** (claim vs open), the exclusivity toggle, and the claim/solve durations.
   - **Recycling policy** for Sprint 2 (off unless you decide otherwise).
5. Load the real problems in the Problem Library: create, **Verify with runner**, Publish, then Assign to a sprint.
   Re-use the demo set only after reviewing it (`docs/CONTENT_REVIEW.md`).
6. Approve crews: tick **Active Day 1 / Day 2** in Crew management. Bulk actions show a preview first.
7. Run a **full rehearsal** on a copy of the database with the REHEARSAL preset, plus `npm run rehearsal:sim` (see README).

## 3. During a sprint

| Situation | Action |
|---|---|
| Start | Game & Sprint → preflight must be green → **Start Sprint 1**. |
| Emergency (power, network, wrong task) | **Pause**. Every deadline (sprint, imposter claim/solve) shifts by the paused time on Resume. Fix the issue (e.g. disable a broken task), announce it, then **Resume**. |
| Broken task | Tasks tab → **Disable** (only unsolved tasks). To replace one: pause, assign a new published version, resume. |
| Crew must leave / cheats | Crew → **Disqualify** (GAME or EVENT scope, with a reason). Use Revoke with a reason to correct a mistake. |
| Lost device / password | Crew → **Reset password** gives a one-time 30-minute code; the crew uses `/reset`. Their sessions are revoked. |
| Too many devices | The session limit (default 4) evicts the oldest session. You can also revoke a session in the crew row. |
| Imposter | Imposters tab → **Release** (only while running). Cancel stops it with no award; Re-arm creates a new generation. |

The worker closes the sprint at the authoritative deadline. Submissions are rejected once that
deadline passes, even if the worker is late or down.

## 4. Between sprints

1. Sprint closed → the game is in **ELIMINATION_REVIEW** and standings are frozen.
2. Elimination tab: check the bottom K. If a **tie crosses the cutoff**, the console requires a decision first:
   retain the tied group, eliminate the tied group, or a manual published tiebreak. All three need a written
   note, which is audited.
3. **Confirm elimination.** It is idempotent; a second confirmation is rejected.
4. Survivors wait in the lobby. **Sprint 2 starts only when you press Activate Sprint 2.**
5. After Sprint 2, confirm eliminations, then review **Results**. Prize-boundary ties need a decision;
   **Confirm results** shows them to every crew.
6. Switch the event day (or let AUTO mode do it at midnight IST). Game 2 is independent: fresh wallets,
   tasks and eligibility.

## 5. Outages

| Failure | Behaviour | Response |
|---|---|---|
| API crash or restart | Sessions persist in the DB. Clients reconnect and re-fetch a full snapshot. | `docker compose restart api`. |
| Worker down | Deadlines are still enforced at request time. Closing and freezing standings waits for the worker. Ship Status shows the heartbeat age. | `docker compose restart worker`. On start it closes overdue sprints **at their original deadline**. |
| Database down | API returns errors and clients show "Ship comms are down". | Restore the DB. If the outage crossed a deadline, the sprint closes at the deadline when the worker resumes. It is never silently extended. Announce and use **Pause** if you need extra time. |
| Runner down | Run and code verification return a real error ("runner unreachable"). Typed-answer tasks still work. | `docker compose restart runner`. Ship Status shows runtimes. |

## 6. Backup and restore

```bash
docker compose exec db pg_dump -U amongbugs -Fc among_bugs > backup-$(date +%F-%H%M).dump   # every sprint boundary
docker compose exec -T db pg_restore -U amongbugs -d among_bugs --clean < backup-XXXX.dump
```

The ledger and audit tables are append-only (enforced by triggers). Use a full restore, never manual edits.

## 7. Health checks

- `GET /api/health` returns DB liveness (public).
- Command Console → **Ship Status** shows DB latency, worker heartbeat (healthy if under 10 s), outbox
  backlog, runner runtimes, connected sockets and live deadlines.
- Alert if the worker heartbeat is over 10 s old, outbox lag keeps growing, or the runner reports unhealthy.

## 8. Demo / rehearsal database

```bash
npm run reset:demo -- --yes   # wipes and re-seeds an isolated DEMO database (refuses on a non-demo event)
```
