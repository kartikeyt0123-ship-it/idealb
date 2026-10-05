# Demo access (developer-only)

These accounts exist **only** in a database seeded with `npm run seed:demo` / `npm run reset:demo -- --yes`
(both refuse unless `DEMO_MODE=true`). They are demo bootstrap data: hashed with scrypt in the
database, never compared in frontend code, never returned by any API, and never created by the
production bootstrap. The landing page does not show them.

| Who | Login | Password | Slot |
|---|---|---|---|
| Organizer (SUPER_ADMIN) | `admin@crm.local` | `idealab` | — |
| **Nexora** (public demo crew) | `nexora@example.test` or `CRW-001` | `CrewDemo123!` | Slot 1 · Day 1 · 8 Oct 2026 |
| Crews CRW-002 … CRW-040 | captain email or crew id | `Crew-NNN-Demo!` (e.g. `Crew-017-Demo!`) | CRW-001–010 → Slot 1, 011–020 → Slot 2, 021–030 → Slot 3, 031–040 → Slot 4 |

Captain emails are the team name in lowercase without spaces `@example.test`
(e.g. `byteforce@example.test`, `kernelpanic@example.test`).

Seeded crews already have credentials (status ISSUED) and are **not** forced to change their
password. **Attendance enables login**: only Nexora (CRW-001) starts marked present. Every other crew
gets "attendance has not been marked" until you tick **Present** in Console → Crews → Slot rosters.
**No slot is open yet**: signed-in crews wait on "Your slot has not opened yet" until you press
**Open slot (kick-in)**. Crews you import yourself have no credentials
until you use **Send credentials**. In demo mode the mail is captured in Console → Credentials →
*Demo mail inbox*.

## What the seed contains

| | |
|---|---|
| Event | AMONG BUG · IDEALab.h · AAROHAN 2026 · SGSITS Indore (demo) — every rule **UNCONFIRMED** |
| Days | Day 1 = 2026-10-08 (Slot 1 at 10:00, Slot 2 at 14:30), Day 2 = 2026-10-09 (Slot 3, Slot 4). Times are informational only. |
| Sprints | 4 per slot, 30 active minutes (STANDARD); switch to REHEARSAL (120 s) in Rules review |
| Question bank | 1,296 PUBLISHED demo questions from 34 seedable templates (30 regular, 4 bonus) |
| Release plans | per slot: 4 × 60 initial (fresh per sprint) + a 20-question reserve pool + a 10-question bonus pool = **270 instances**. 4 slots = 960 initial + 120 extras = **1,080 instances**, no question version shared between slots |
| Prizes | 3 placeholder labels (no amounts invented) |

## Quick rehearsal

1. Sign in at `/command` with the organizer account.
2. Rules review: set preset **REHEARSAL** (2-minute sprints), confirm rules as you like.
3. Crews → Slot rosters: tick **Present** for the Slot 1 crews (or **All present**).
4. Slots: Slot 1 → **Open slot (kick-in)**. Crews can now board and roam, but nothing is solvable yet.
5. Slot 1 → **Start sprint 1** (your approval; the preflight must be green).
6. In another browser (or a private window) sign in as Nexora. Solve, buy a hint, and watch the
   HUD (sprint score, cumulative, wallet, sprint rank, slot rank).
7. Releases (or the slot card): **Refill** tops up domains emptied by solves from the 20-question
   reserve pool; **Release bonus** sends the next of 10 bonus questions.
8. Displays: create a projector link and open it on a second screen.
9. Let the sprint expire (the worker closes it at the deadline), start sprints 2–4, then
   **Finalize slot**. Repeat for Slots 2–4 (only one slot may run at a time), then
   **Finalize overall results**.

To start over: `npm run reset:demo -- --yes`.
