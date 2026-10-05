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
| `questionScope` | FRESH_PER_SPRINT: a fresh release of 60 questions each sprint (10 per domain), expiring at sprint end | SLOT_POOL: one 60-question pool per slot carried across the four sprints (solves count for the sprint in which they are accepted) |
| `initialPerDomain` | 5 easy / 3 medium / 2 hard per domain (30 / 18 / 12 across six domains) | any counts |
| `extraPools` | 20 reserves + 10 bonuses **per slot**, separate from the initial questions | PER_SPRINT scope |
| `rewards` | 150 / 400 / 700, bonus 900 IdeaCoins | |
| `hintCosts` | 30 / 80 / 140, bonus 100; starting wallet 0 | |
| `rankingMetric` | **GROSS_EARNED**: score = coins earned; hints reduce the spendable wallet only | NET_COINS: earned − spent |
| `bonusPolicy` | Open to every active crew in the slot; first correct verified answer wins. No claim / reserve step. | |
| `elimination` | **Disabled** (the latest format does not restate elimination) | Optional per-sprint counts; ties at the cutoff need a published decision |
| `tiePolicy` | Shared rank. Ties involving prize places need a published decision (share the place, or a manual order with a note). Never broken by team ID. | |
| `sessions` | Up to 4 concurrent devices per crew, one shared wallet; the oldest device is signed out | REJECT extra sign-ins |
| `recycling` | Off: solved or expired questions never reopen | |
| `schedule` | 4 × 30 active minutes. Reserves 5 per sprint. Bonuses 3 / 3 / 2 / 2 at active minutes [8, 16, 24], [8, 16, 24], [10, 20], [10, 20]. The **REHEARSAL** preset makes a sprint 120 s and scales the offsets (8 min → 32 s). | CUSTOM minutes |
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

With 10 crews and 60 questions per sprint, a sprint rarely runs out. If a slot does, release a
reserve batch (no reason needed: reserves are part of the plan) before considering a manual
override, which is a fairness deviation.
