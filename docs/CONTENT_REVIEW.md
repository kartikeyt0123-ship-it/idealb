# Demo challenge content — review checklist

All seeded content is **DEMO material**. Organizers must review it before using any of it at the real event.
Sources are in `server/src/content/templates/*.ts`. Each template produces four variants (v0–v3)
with different data and answers:

| Variant | Used for |
|---|---|
| v0 | Game 1 Sprint 1 |
| v1 | Game 1 Sprint 2 |
| v2 | Game 2 Sprint 1 |
| v3 | Game 2 Sprint 2 |

## Automated consistency proof

```bash
npm run build -w runner
npm run content:check            # all domains + imposters
npm run content:check -- --domain web
```

For every variant, the check proves that:

- the buggy starter **fails** the hidden tests and the private solution **passes** all of them;
- typed answers verify, and the fixed program prints exactly the accepted answer while the starter does not;
- the four variants have distinct statements and distinct answers or test sets;
- each domain has 5 templates (2 easy / 2 medium / 1 hard), and there are at least 4 imposters.

Last run: **136 variants checked, 0 problems** (120 regular + 16 imposter variants).

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
| Imposter | imposter-o2-rounding | HARD | Python | tests | banker's rounding |
| Imposter | imposter-reactor-threshold | HARD | JS | tests | binary search bounds |
| Imposter | imposter-comms-median | HARD | JS (web) | harness | lexicographic sort, wrong middle |
| Imposter | imposter-nav-drift | HARD | JS | numeric exact | negative modulo heading |

## Review checklist per problem

1. Is the statement clear and unambiguous, and does it state the exact submission and comparison rule?
2. Is the difficulty right, and is it solvable in time (especially imposters in the REHEARSAL preset)?
3. Does the hint help without giving the full fix?
4. Run **Verify with runner** in Problem Library after any edit. Published versions are frozen;
   edit by creating a new draft version.
5. Subjective design judging is **not** implemented by design. Design tasks are deterministic
   (computed layout values or tested utility functions).
