# Demo access (developer-only)

> **Private / demo-only.** These sample accounts exist only in a database seeded with
> `DEMO_MODE=true npm run seed:demo`. Never seed them into an event database.
> Before the real event, use `npm run bootstrap -w server` with your own admin credentials
> and real crews. All names, emails and institutions below are fictitious
> (`.local` and the reserved `.test` domain).

## Commander (super admin)

| Email | Password | Role |
|---|---|---|
| `admin@crm.local` | `idealab` | `SUPER_ADMIN` · display name *IDEALab Commander* |

The password is hashed with scrypt like every other account. It is not shown in the
login UI, not returned by any API and not present in the browser bundle.

## Public demo crew

| Crew | Crew ID | Login | Password | Days |
|---|---|---|---|---|
| NEXORA | `CRW-042` | `nexora@example.test` (or `CRW-042`) | `CrewDemo123!` | Day 1 + Day 2 |

## Other seeded crews

Login = `<slug>@example.test` or the crew ID. Password = `Demo-<Slug>-2026`, with the first
letter of the slug capitalised. For example, `byteforce@example.test` uses `Demo-Byteforce-2026`.

| # | Crew | Crew ID | Login | Password | Approved days | Requested |
|---|---|---|---|---|---|---|
| 1 | BYTEFORCE | CRW-001 | byteforce@example.test | Demo-Byteforce-2026 | Day 1 | Day 1 |
| 2 | CODEX | CRW-002 | codex@example.test | Demo-Codex-2026 | Day 1 | Day 1 |
| 3 | DEBUGGERS | CRW-003 | debuggers@example.test | Demo-Debuggers-2026 | Day 1 | Both |
| 4 | NULLPTR | CRW-004 | nullptr@example.test | Demo-Nullptr-2026 | Day 1 | Day 1 |
| 5 | STACKSMASH | CRW-005 | stacksmash@example.test | Demo-Stacksmash-2026 | Day 1 | Day 1 |
| 6 | SEGFAULT | CRW-006 | segfault@example.test | Demo-Segfault-2026 | Day 2 | Day 2 |
| 7 | BITSHIFT | CRW-007 | bitshift@example.test | Demo-Bitshift-2026 | Day 2 | Day 2 |
| 8 | KERNEL PANIC | CRW-008 | kernelpanic@example.test | Demo-Kernelpanic-2026 | Day 2 | Both |
| 9 | LAMBDA LEGION | CRW-009 | lambdalegion@example.test | Demo-Lambdalegion-2026 | Day 2 | Day 2 |
| 10 | HEAPSTERS | CRW-010 | heapsters@example.test | Demo-Heapsters-2026 | Day 2 | Day 2 |
| 11 | NEXORA | CRW-042 | nexora@example.test | CrewDemo123! | Day 1 + 2 | Both |
| 12 | SYNTAX SQUAD | CRW-012 | syntaxsquad@example.test | Demo-Syntaxsquad-2026 | Day 1 + 2 | Both |
| 13 | QUANTUM QUILLS | CRW-013 | quantumquills@example.test | Demo-Quantumquills-2026 | Day 1 + 2 | Both |
| 14 | LOOP TROOP | CRW-014 | looptroop@example.test | Demo-Looptroop-2026 | Day 1 + 2 | Both |
| 15 | RECURSIA | CRW-015 | recursia@example.test | Demo-Recursia-2026 | Day 1 + 2 | Both |
| 16 | VOID WALKERS | CRW-016 | voidwalkers@example.test | Demo-Voidwalkers-2026 | pending | Day 1 |
| 17 | PIXEL PIRATES | CRW-017 | pixelpirates@example.test | Demo-Pixelpirates-2026 | pending | Day 2 |
| 18 | CACHE CREW | CRW-018 | cachecrew@example.test | Demo-Cachecrew-2026 | pending | Both |
| 19 | ASYNC ARMADA | CRW-019 | asyncarmada@example.test | Demo-Asyncarmada-2026 | pending | Both |
| 20 | GLITCH GUILD | CRW-020 | glitchguild@example.test | Demo-Glitchguild-2026 | pending | Day 1 |

This gives 10 eligible crews per game. The demo eliminates 2 after Sprint 1 and 3 after Sprint 2,
so each game goes 10 → 8 → 5.

## Demo game setup

- Event day selection: **MANUAL**, Day 1 selected. Switch days in Command Console → Game & Sprint → Event day.
- Game 1 is mapped to Day 1 and Game 2 to Day 2. Both start in `WAITING` and no sprint runs automatically.
- The ranking rule is `NET_COINS`, and the commander must confirm it before Sprint 1 can start.
- Sprints run for 30 minutes (STANDARD preset). The **REHEARSAL** preset (120 s) is one click away.
- Rewards are 150 / 400 / 700 and hint costs 30 / 80 / 140 by difficulty. Wallets start at 0.
- Each sprint has 30 regular tasks: 6 domains × 5, split 2 easy / 2 medium / 1 hard.
- Variants are assigned so no answer repeats: v0 → G1S1, v1 → G1S2, v2 → G2S1, v3 → G2S2.
- There is one imposter draft per sprint (IMPOSTER-A1/B1/A2/B2). Each pays 900 with a hint cost of 100.
  The claim window is 60 s and the solve window 480 s (STANDARD), or 20 s and 70 s (REHEARSAL).
- Prize labels are placeholders ("organizer to confirm prize"). No amounts are invented.

## Private solutions

Reference solutions live server-side in `server/src/content/templates/*.ts` (`solution` fields).
Commanders with the `SUPER_ADMIN` or `CONTENT_EDITOR` role can see them in Command Console → Problem Library.
They are never sent to participants.
