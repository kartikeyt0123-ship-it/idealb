# Demo challenge content — review checklist

All seeded content is **DEMO material**. Organizers must review it before using any of it at the real event.
Sources are in `server/src/content/templates/*.ts`. Every template is **seedable**:
`variant(seed)` is deterministic for every integer seed ≥ 0 (no `Math.random`, no dates), and
different seeds give different data, statements and answers.

The demo seed publishes 1,296 questions:

| Template group | Seeds per template | Count |
|---|---|---|
| 2 easy templates per domain | `s000`–`s049` | 6 domains × 2 × 50 = 600 |
| 2 medium templates per domain | `s000`–`s031` | 6 × 2 × 32 = 384 |
| 1 hard template per domain | `s000`–`s043` | 6 × 44 = 264 |
| 4 bonus templates | `s000`–`s011` | 4 × 12 = 48 |

Question keys look like `basic-reactor-sum-s007`. Each slot plan takes unused versions in seed
order, so no question version is ever shared between slots (enforced by the planner and checked by
the tests).

## Automated consistency proof

```bash
npm run build -w runner
npm run content:check                                   # all templates, runner proof for seeds 0-5, structural pass over 64 seeds
npm run content:check -- --domain web --seeds 0-63      # widen the runner proof
```

For every checked seed, the check proves that:

- the buggy starter **fails** the hidden tests and the private solution **passes** all of them;
- typed answers verify, and the fixed program prints exactly the accepted answer while the starter does not.

The structural pass (`--distinct 64`) checks every seed's shape and requires at least 90 % distinct
statements and answers or test sets per template (each template reached 64 / 64 when written).
It also checks that each domain has 5 templates (2 easy / 2 medium / 1 hard) and that there are
at least 4 bonus templates.

Last run: see the README "Verified" table.

## Templates

| Domain | Key | Difficulty | Lang | Validation | Bug |
|---|---|---|---|---|---|
| Web | web-cart-total | EASY | JS | hidden harness | subtotal adds price + qty instead of price × qty |
| Web | web-mission-timer | EASY | JS | harness | seconds not zero-padded |
| Web | web-log-pager | MEDIUM | JS | harness | page count floors; 1-based page offset |
| Web | web-crew-leaderboard | MEDIUM | JS | harness | tie order reversed; ties don't share a rank |
| Web | web-cargo-undo | HARD | JS | harness | reducer mutates shared items, corrupting undo history |
| Data | data-o2-mean | EASY | Python | numeric ±0.01 | header row counted |
| Data | data-coin-leaderboard | EASY | Python | tests | coin column sorted as strings |
| Data | data-cabin-median | MEDIUM | Python | numeric ±0.01 | NA counted as 0; even-count median |
| Data | data-deck-power | MEDIUM | Python | tests | `=` instead of `+=`; floor division |
| Data | data-sensor-anomaly | HARD | Python | tests | NA as 0, shared history, self-inclusive window |
| DS | ds-bracket-airlock | EASY | JS | tests | stack not checked empty at end |
| DS | ds-docking-lower-bound | EASY | Python | tests | `hi = len - 1` |
| DS | ds-cargo-queue | MEDIUM | JS | tests | two-stack queue transfer / size bugs |
| DS | ds-vent-bfs | MEDIUM | Python | tests | wrong neighbour list |
| DS | ds-relay-dijkstra | HARD | Python | tests | one-way edges, wrong relaxation, `inf` output |
| Basic | basic-reactor-sum | EASY | JS | tests | loop stops one early |
| Basic | basic-o2-vent-cycler | EASY | Python | tests | FizzBuzz condition order |
| Basic | basic-squad-roster | MEDIUM | Python | tests | mutable default argument |
| Basic | basic-hull-extremes | MEDIUM | JS | tests | max starts at 0; digit sum of negatives |
| Basic | basic-roman-launch-codes | HARD | Python | tests | subtractive pairs both ways |
| Design | design-box-width | EASY | – | numeric exact | content-box width arithmetic |
| Design | design-hex-to-rgb | EASY | JS | harness | wrong slice for blue |
| Design | design-grid-track | MEDIUM | – | numeric ±0.01 | fr track width with gaps / padding |
| Design | design-contrast-check | MEDIUM | JS | harness | contrast ratio order; WCAG levels swapped |
| Design | design-flex-shrink | HARD | – | numeric ±0.01 | weighted flex-shrink distribution |
| Misc | misc-caesar-ship-log | EASY | – | text (case-insensitive) | Caesar decode |
| Misc | misc-signal-frames | EASY | – | text | hex / binary frames to ASCII |
| Misc | misc-crew-id-regex | MEDIUM | JS | tests | unanchored regex, `[A-z]` |
| Misc | misc-badge-checksum | MEDIUM | Python | tests | Luhn parity from the wrong end |
| Misc | misc-emergency-meeting-logic | HARD | – | text | logic puzzle (solver-verified unique) |
| Bonus | imposter-o2-rounding | HARD | Python | tests | banker's rounding |
| Bonus | imposter-reactor-threshold | HARD | JS | tests | binary search bounds |
| Bonus | imposter-comms-median | HARD | JS (web) | harness | lexicographic sort, wrong middle |
| Bonus | imposter-nav-drift | HARD | JS | numeric exact | negative modulo heading |

## Review checklist per problem

1. Is the statement clear and unambiguous, and does it state the exact submission and comparison rule?
2. Is the difficulty right, and is it solvable in time (especially bonus questions in the REHEARSAL preset)?
3. Does the hint help without giving the full fix?
4. Run **Verify** in Question bank after any edit. Reviewed and published versions are frozen;
   edit by creating a new draft version. Publishing is always explicit (DRAFT → REVIEWED → PUBLISHED).
5. Subjective design judging is **not** implemented by design. Design tasks are deterministic
   (computed layout values or tested utility functions).
