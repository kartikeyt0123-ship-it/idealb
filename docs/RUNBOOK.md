# AMONG BUG — event-day runbook

Audience: the organizer / operator running AMONG BUG at AAROHAN 2026 (IDEALab.h, SGSITS Indore).
Format: 2 days × 2 slots × 4 sprints; each crew plays in exactly one slot.

## 1. Topology (one authoritative database)

```
browsers / projectors ──HTTPS──▶ reverse proxy (TLS) ──▶ api (Fastify + Socket.IO, serves the web app)
                                                          │        │
                                                          │        └─ internal "sandbox" network ─▶ runner (Node + Python, no egress)
                                                          ▼
                                                     PostgreSQL ◀── worker (deadlines, release scheduler, heartbeat)
                                                          api ──SMTP──▶ mail provider (or Mailpit in the demo compose)
```

- PostgreSQL is the **only** source of truth. Never run two score databases at once.
- Several API instances are possible: each delivers committed outbox events to its own sockets.
  The in-process rate limits then become per instance.
- Several worker replicas are safe: every transition is a locked, idempotent transaction.

## 2. Before the event (T-2 days)

1. `.env` from `.env.example`:
   - `NODE_ENV=production`, `DEMO_MODE=false`, `COOKIE_SECURE=true`, `TRUST_PROXY=true`.
   - Long random `GRADING_SECRET` and `RUNNER_TOKEN`.
   - `ALLOWED_ORIGINS` and `PUBLIC_URL` set to `https://your-domain`.
   - `POSTGRES_PASSWORD`.
   - Mail: `MAIL_MODE=smtp`, `SMTP_URL=smtps://user:pass@provider:465`, `MAIL_FROM`, `MAIL_SINK=false`.
2. `docker compose up -d --build`.
3. Bootstrap (no demo accounts, no known passwords):
   `docker compose run --rm -e ADMIN_BOOTSTRAP_EMAIL=you@org -e ADMIN_BOOTSTRAP_PASSWORD='…' -e EVENT_DAY1=2026-10-08 -e EVENT_DAY2=2026-10-09 api node server/dist/scripts/bootstrap.js`
4. Sign in at `/command` → **Rules review**. Read every rule and confirm it (or change it first).
   A production event cannot start a sprint while any rule is unconfirmed. Rules freeze at the first start.
5. **Question bank:** import or author questions → **Verify** → REVIEWED → PUBLISHED. The bank
   coverage table shows *need vs have* per domain and difficulty for the remaining slots. Then
   **Build release plan** for each slot. Preflight warns if slots are not comparable.
6. **Crews:** Import CSV/XLSX → fix row errors → Commit. Assign slots (in the file or with bulk
   assign) within capacity. Then **Send credentials** (preview first). Crews change their
   password at first sign-in.
7. **Displays:** create one display link per projector. The key is shown once; store it, or
   create a new link if you lose it.
8. Rehearse on a copy of the database with the REHEARSAL preset, plus
   `npm run rehearsal:sim -- --yes --slot 1 --all --start`.

## 3. Running a slot

| Step | Action |
|---|---|
| Doors open | Crews sign in; check-in is visible per crew. Unassigned / disabled crews see why they cannot play. |
| Start | Slots → *Slot n* → **Start sprint 1**. Preflight must have no blockers. Read the warnings: unconfirmed rules (demo only), crews without credentials, comparability, manual deviations. The initial set is released at start. |
| During | Bonuses release automatically at their active-time offsets. Reserves: **Release now** when stations run dry (part of the plan; no reason needed). |
| Emergency (power, network, broken question) | **Pause**: the deadline and every scheduled release stop and shift on Resume. Announce, fix, resume. |
| Early release of a scheduled batch / manual override | Allowed with a written reason; it is shown as a **fairness deviation** in the plan, preflight and audit log. |
| Device / account problems | Crews → sessions (revoke), disable / enable, **Send credentials (RESET)** for a new temporary password. |
| Misconduct | Crews → **Disqualify** with a reason (revocable with a reason; audited). |
| End of sprint | The worker closes it at the authoritative deadline (DB clock). Late submissions are rejected even if the worker is late. Unreleased releases are cancelled, never replayed. Standings freeze into a snapshot. |
| Next sprint | Crews wait. **Start sprint n+1** when ready (the previous sprint is finalized automatically when elimination is off). The sprint board restarts at zero; cumulative carries. |
| After sprint 4 | Slot is in REVIEW → **Finalize slot**. Ties involving the top 3 require a published decision (share, or a manual order with a note). |

Only one slot may run at a time (rule `singleRunningSlot`).

## 4. After all four slots

1. Check the overall board (provisional): Leaderboards → Overall.
2. **Finalize overall results**. Prize-place ties need a decision. The projectors switch from
   PROVISIONAL to FINAL.
3. Exports: overall / slot / sprint standings, ledger, audit (CSV or XLSX; formula-safe; never passwords).

## 5. Projectors

- Open the link from the Displays tab on the projector browser. The key in the URL fragment is
  exchanged for a display-only cookie and removed from the address bar.
- Routes: `/display/overall`, `/display/slots/:slotId`, `/display/slots/:slotId/sprints/:sprintId`
  (footer links switch between them).
- A projector sees only approved standings fields (rank, crew name / id / colour, slot, per-sprint
  and total scores, solves). Revoking the link disconnects it immediately.

## 6. Outages

| Failure | Behaviour | Response |
|---|---|---|
| API restart | Sessions are in the DB; clients reconnect and re-fetch a full snapshot. | `docker compose restart api` |
| Worker down | Deadlines are still enforced per request. Closing and scheduled releases wait for the worker. Health shows the heartbeat age. | `docker compose restart worker`. It closes overdue sprints at their stored deadline. |
| Database down | API errors; clients show "Ship comms are down". | Restore the DB; nothing is re-rolled. |
| Runner down | Run / code verification return a real error; typed answers still work. | `docker compose restart runner` |
| Mail provider down | Deliveries are recorded as FAILED and old credentials stay valid. | Fix SMTP and resend to the failed crews. |

## 7. Backup and restore

```bash
docker compose exec db pg_dump -U amongbugs -Fc among_bugs > backup-$(date +%F-%H%M).dump   # at every sprint boundary
docker compose exec -T db pg_restore -U amongbugs -d among_bugs --clean < backup-XXXX.dump
```

The ledger and audit tables are append-only (enforced by triggers). Correct mistakes with
compensating adjustments (Crews → adjust), never by editing rows.

## 8. Health

- `GET /api/v1/health` (public) shows DB liveness.
- Console → Health shows:
  - DB latency;
  - worker heartbeat (healthy if under 10 s);
  - outbox lag;
  - runner;
  - live deadlines;
  - **ledger reconciliation** (cached wallets = ledger sums);
  - mail mode.

## 9. Demo / rehearsal database

`npm run reset:demo -- --yes` wipes and re-seeds an isolated demo database. It refuses on a
non-demo event. See [DEMO_ACCESS.md](DEMO_ACCESS.md).
