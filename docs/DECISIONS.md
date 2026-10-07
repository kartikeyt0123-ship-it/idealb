# Rules, conflicts and decisions (four-slot format)

The source of truth for the format is the four-slot brief `AMONG_BUG_Four_Slots_Claude_Code_Prompt.md`
(supplied by the organizers, not stored in this repo). It supersedes
the earlier two-game / two-sprint brief. This file records how conflicts were resolved and which
defaults are **demo defaults that organizers must confirm**.

## Format

| Item | Implemented |
|---|---|
| Name | Display name **AMONG BUG** (centralised in `event.name`, editable in the console). Organizer IDEALab.h, edition AAROHAN 2026, venue SGSITS Indore, timezone Asia/Kolkata. |
| Days and slots | 2 days (demo dates **8 and 9 October 2026**), 2 slots per day: Slot 1, Slot 2 on day 1 and Slot 3, Slot 4 on day 2. Every crew is enrolled in **exactly one** slot (`slot_enrollment.team_id` is unique). |
| Sprints | 4 sprints per slot, 30 active minutes each (STANDARD). The organizer **explicitly starts every sprint**; dates and clock times never start anything. |
| Slot kick-in | Each slot is **opened** by an organizer (Open slot). Before that, its crews can sign in but wait on a "slot not opened" screen. After it, crews board and roam the ship, but **nothing is visible or solvable until the organizer starts Sprint 1**. Sprint 1 cannot start before the slot is open (preflight blocker). Boarding can be closed again only before Sprint 1. |
| Attendance | Rule `attendanceGatesLogin` (default on): a crew can sign in only after it is marked **present**. The roll call is in Crews → Slot rosters. Unmarking signs the crew out. A blank `checked_in` cell on re-import keeps the current value. |
| Question bank and flow per slot | The bank is the organizers' **IDEALab.dev** repository (360 flag problems, 6 domains: Core Compute, Cryptography, Data Decypher, Maker Sandbox, Reconnaissance, Web Exploitation), synced from GitHub. Each slot gets an **initial set of 15 per domain (7 easy, 5 medium, 3 hard)**, auto-picked (new-to-the-slot first, then least used) and **editable before Sprint 1** (remove questions, add specific ones, rebuild with other counts per domain). It is released when the organizer starts Sprint 1. Released questions **stay active for the whole slot** and expire when the slot's last sprint closes. The organizer watches the **live stock** (domain × difficulty: active, solved, planned vs target) and releases more at any time: **Top up** (auto-pick back to target) or **pick specific bank questions**, as regular or bonus, now or at the next sprint start. **Previously used questions may be reused.** These are organizer decisions, not fairness deviations. |
| Concurrency | One running slot at a time (rule `singleRunningSlot`, enforced in preflight under an advisory lock). |
| First solve | The first correct, server-accepted answer closes a question **within its slot only**. Slots never share question versions, so there is no cross-slot answer leakage. |
| Leaderboards | Sprint board (starts at zero each sprint: only ledger rows attributed to that sprint count), slot cumulative board (sum of the four sprints), overall board across slots (**PROVISIONAL** until the event is finalized). |
| Registration | No public registration. Crews are imported from CSV/XLSX by organizers. The old `/api/auth/register` does not exist (404). |
| Credentials | Never sent on import. **Send Credentials** is an explicit organizer action with a preview. Demo mode captures mail locally ("demo mail, not delivered externally"). With a local SMTP sink (Mailpit, `MAIL_SINK=true`) the console says so too. Without a transport, sending is refused (`MAIL_NOT_CONFIGURED`), never reported as delivered. |

## Demo defaults — UNCONFIRMED until confirmed in Rules review

Every rule below is listed in the console's **Rules review** with an UNCONFIRMED badge. Demo
mode may start on unconfirmed rules (preflight shows a warning). **A non-demo event cannot start
a sprint until every rule is confirmed.** Changing a rule clears its confirmation. Rules freeze
when the first sprint of any slot starts.

| Rule key | Demo default | Alternatives |
|---|---|---|
| `questionScope` | **SLOT_POOL**: released questions stay active for all four sprints of the slot; solves count for the sprint in which they are accepted | FRESH_PER_SPRINT: a fresh set every sprint, expiring at sprint end |
| `initialPerDomain` | **7 easy / 5 medium / 3 hard** per domain = 90 per slot, released at Sprint 1; also the top-up target | any counts (per slot editable per domain) |
| `extraPools` | Top-ups and bonuses chosen by the organizer from the bank at any time | |
| `rewards` | 150 / 400 / **750**, bonus 900 IdeaCoins (the repository's base_coins) | |
| `hintCosts` | Each question's own hint ladder (repository: usually 25 / 50 / 100; a few have two levels, bought in order); fallback 25 / 50 / 100, bonus 100; starting wallet 0 | |
| `rankingMetric` | **GROSS_EARNED**: score = coins earned; hints reduce the spendable wallet only | NET_COINS: earned − spent |
| `bonusPolicy` | Open to every active crew in the slot; first correct verified answer wins. No claim / reserve step. | |
| `elimination` | **Disabled** (the latest format does not restate elimination) | Optional per-sprint counts; ties at the cutoff need a published decision |
| `tiePolicy` | Shared rank. Ties involving prize places need a published decision (share the place, or a manual order with a note). Never broken by team ID. | |
| `attendance` | Marking a crew present enables its login (`attendanceGatesLogin: true`) | off: enabled crews can always sign in |
| `sessions` | Up to 4 concurrent devices per crew, one shared wallet; the oldest device is signed out | REJECT extra sign-ins |
| `recycling` | Solved / expired questions never reopen automatically; the organizer may release any question again (reuse) | |
| `protection` | **On**: crew screens block copy / cut / right-click / print / screenshot shortcuts and blank the screen when it loses focus; crew watermark. Best effort — browsers cannot stop phone cameras | off |
| `schedule` | 4 × 30 active minutes, each sprint started by an organizer after the slot is opened. With `bonusMode: SCHEDULED`, bonuses 3 / 3 / 2 / 2 at active minutes [8, 16, 24], [8, 16, 24], [10, 20], [10, 20]. The **REHEARSAL** preset makes a sprint 120 s and scales the offsets (8 min → 32 s). | CUSTOM minutes |
| `singleRunningSlot` | Only one slot may run at a time | allow parallel slots |

## Fairness across slots

- Every slot gets its plan from the **same blueprint**, so question counts, difficulty mix, release
  times and reward budget are identical. Each slot uses different question versions.
- Preflight compares every slot's plan with the others (counts and reward budget per sprint and
  type). It warns "not comparable" when they differ. Raw totals are **not normalised**; the
  overall board is therefore labelled provisional until organizers finalize it.
- **Manual or early releases are fairness deviations.** They need a reason (≥ 8 characters for
  manual releases), are flagged in the release plan and preflight, and are written to the audit
  log. A sprint that closes cancels its unreleased releases; they are never replayed later.

## Conflict resolutions

| Earlier brief said | Now |
|---|---|
| Two independent games (Game 1 → Day 1, Game 2 → Day 2), two sprints each, elimination after each sprint | Four slots × four sprints; one slot per crew; elimination optional and off by default |
| Self-registration with organizer approval per day | Organizer import only (CSV/XLSX with preview and commit) |
| Imposter: first claim reserves it exclusively, then a solve window | Bonus questions are open to everyone in the slot; first correct wins |
| NET_COINS default score | GROSS_EARNED default (NET_COINS optional) |
| 4 fixed variants per template | Seedable templates (`variant(seed)`); the demo bank has 1,296 questions from 34 templates |
| Card-swipe gate in the ship for commanders | Organizers sign in with **Organizer Login** and use `/command`; crews get ACCESS DENIED there |

## Slot changes after scoring

Re-importing or editing a crew never resets its password, history or slot silently. A slot change
for a crew that already has ledger rows is **blocked** (`SLOT_CHANGE_BLOCKED`), both in the editor
and in imports. Scores are never transferred between opponents; such a case is an audited
correction (pause, adjust with compensating ledger entries, note in the audit log).

## Question pool sufficiency

Each domain has 25 easy / 20 medium / 15 hard questions; a slot starts with 7 / 5 / 3 per domain.
Four slots plus top-ups exceed the fresh supply, so later slots reuse questions (by design). The
picker prefers questions the slot has not seen, then the least used overall. Solutions of reused
questions may circulate between slots — run a slot's top-ups from questions marked *new to this
slot* in the picker when that matters.

## Known data issues in the repository

See [CONTENT_REVIEW.md](CONTENT_REVIEW.md): `core_compute_21` and `recon_60` are broken upstream;
`maker_41`–`maker_60` are protected by an automatic output gate.
