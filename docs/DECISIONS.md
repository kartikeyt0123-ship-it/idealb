# Rules, conflicts and decisions

## Conflict resolutions (as specified, implemented)

| Earlier source said | Implemented |
|---|---|
| Four-sprint event | Two independent games (Game 1 → Day 1, Game 2 → Day 2; mapping configurable), each with Sprint 1 and Sprint 2. |
| Five domains | Six data-driven domains: Web Development, Data, Data Structures, Basic Programming, Designing, Miscellaneous. |
| Regular tasks lock on selection | Regular tasks are open to every eligible crew. Opening never reserves. The first correct, server-accepted solution wins. |
| Next round starts automatically | Crews wait in the lobby. Sprint 2 starts only when a commander presses **Activate Sprint 2**. |
| Free hints | Hints cost IdeaCoins and are unlocked only by a successful server-side purchase. The hint text never reaches the browser before that. |
| Member accounts | One shared crew identity, card and character. The 3–4 member roster is stored without individual accounts. |
| Static safe / uncertain / danger percentages | Zones are derived from the configured elimination count K for the running sprint and labelled provisional. |
| Access denied returns to the command room | A denied swipe closes the reader and returns the crew to the safe lobby. No admin data is requested. |

## Provisional rules — organizers must confirm before the real event

| Topic | Provisional default (demo) | Where to change |
|---|---|---|
| Sprint durations | 30 min (STANDARD). REHEARSAL preset is 120 s. | Console → Game & Sprint |
| Elimination counts | Demo only: 2 after Sprint 1 and 3 after Sprint 2 (10 → 8 → 5). The real counts must be set for the real roster; preflight blocks impossible plans. | Game & Sprint |
| Score basis | `NET_COINS` (earned − spent; buying hints lowers score). `GROSS_EARNED` is available. It must be explicitly confirmed and is frozen at Sprint 1. | Game & Sprint |
| Prize places | 3 places with placeholder labels. No monetary amounts were invented. | Game & Sprint → prizes |
| Rewards / hint costs | 150 / 400 / 700 and 30 / 80 / 140 by difficulty. Imposters pay 900 with a hint cost of 100. | Problem Library (per version), Imposters |
| Ties at the elimination cutoff | Confirmation stops. Organizers choose: retain the tied group, eliminate the tied group, or record a manual published tiebreak (note required). | Elimination |
| Ties at prize places | Confirmation stops. Organizers choose: share the place, or a manual published order (note required). | Elimination → Results |
| Hint bought, then another crew wins the task | No refund. The purchase stays visible in game history; no new hints can be bought on a solved task. | Rule text |
| Cutoff | A solve counts only if the server accepts it **before** the authoritative deadline (DB clock, under lock). Code judging must finish before the deadline. | Fixed |
| Sprint-2 task policy | Fresh Sprint-2 tasks. `recycleEliminatedSolves` is off. If enabled, only tasks solved by ejected crews reopen as a new generation. | Game & Sprint |
| Problem reuse | Day 2 uses different variants (v2 / v3) from Day 1 (v0 / v1). No exposed answer is reused. | Library / assignment |
| Session limit | 4 devices per crew. A 5th sign-in evicts the least recently used device (or use `REJECT`). Drafts are per device. | Game & Sprint → event |
| Imposter mode | RESERVE (first claim wins exclusive access). While a crew holds it, that crew's regular submissions and hints are blocked server-side. OPEN (first correct wins) is available. | Game & Sprint |
| Imposter windows | Claim 60 s, solve 480 s (STANDARD); claim 20 s, solve 70 s (REHEARSAL). The effective solve deadline is the earlier of the solve window and the sprint end. Timeouts expire with no award; re-arm creates a new generation. | Imposters |
| Starting coins | 0. Grants are wallet funding, not score. | Game & Sprint |
| Disqualification | GAME scope affects one game; EVENT scope blocks both days. History is kept; corrections are audited. | Crew |

## Task pool sufficiency

Each sprint has 30 regular tasks and every task has exactly one winner. With many crews, a large
share will finish a sprint with zero, and zero-score ties at the cutoff become likely.
The preflight warns about this, and the tie workflow handles it explicitly.
The load rehearsal (100 crews) used up a whole sprint's pool within about two minutes of
aggressive simulated play. Add tasks or use timed release windows (release / close offsets per
task) if the roster is large. The scoring rule is never silently changed to hide this.
