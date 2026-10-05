import type { CodeTest, TaskTemplate, TaskVariant } from '../types.js';

/**
 * ADMIN / Data Analysis (workspace DATA, Python 3 standard library only).
 * `variant(seed)` works for any integer seed >= 0. Names / column labels /
 * parameters are decoded from the seed (mixed radix, so seeds 0..63 always get
 * distinct statements) and every dataset is generated from a seeded LCG. Every
 * expected answer is computed by a TypeScript reference implementation below.
 */

const py = String.raw;

/** Seeded linear congruential generator returning floats in [0, 1). */
function rng(seed: number): () => number {
  let s = Math.imul((seed >>> 0) + 1, 2654435761) >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
/** Mix a seed, a per-template salt and an attempt counter into one LCG seed. */
function mix(seed: number, salt: number, attempt = 0): number {
  return (Math.imul(seed >>> 0, 1000003) + Math.imul(salt, 7919) + Math.imul(attempt, 104729)) >>> 0;
}
function ri(r: () => number, lo: number, hi: number): number {
  return lo + Math.floor(r() * (hi - lo + 1));
}
const at = <T>(arr: readonly T[], i: number): T => arr[((i % arr.length) + arr.length) % arr.length];
/** Pick k distinct items from pool (deterministic in r). */
function sample<T>(r: () => number, pool: readonly T[], k: number): T[] {
  const p = [...pool];
  const out: T[] = [];
  for (let i = 0; i < k && p.length; i++) out.push(p.splice(ri(r, 0, p.length - 1), 1)[0]);
  return out;
}
/** Integer tenths -> "21.4" (matches Python float parsing / printing). */
function tenths(n: number): string {
  return (n / 10).toFixed(1);
}
/** Python-compatible f"{x:.{d}f}": exact binary ties round half-to-even like CPython. */
function pyFixed(x: number, d: number): string {
  const m = 10 ** d;
  const y = x * m;
  if (Number.isInteger(y * 2) && !Number.isInteger(y)) {
    const f = Math.floor(y);
    const n = f % 2 === 0 ? f : f + 1;
    return (n / m).toFixed(d);
  }
  return x.toFixed(d);
}
const csvOf = (header: string, rows: string[]): string => [header, ...rows].join('\n') + '\n';

/**
 * Deterministic "distinct within each block of 64 seeds" selection for NUMERIC
 * templates: seed s tries attempts 0, 1, 2, ... until its keys (answer,
 * statement) differ from those of every earlier seed in the same block.
 * Results are memoised, so the cost is O(64) builds at most per block.
 */
type Built = { variant: TaskVariant; keys: string[] };
function blockUnique(cache: Map<number, Built>, seed: number, build: (seed: number, attempt: number) => Built | null): TaskVariant {
  const s0 = Math.max(0, Math.floor(seed));
  const start = s0 - (s0 % 64);
  for (let s = start; s <= s0; s++) {
    if (cache.has(s)) continue;
    const taken: Set<string>[] = [];
    for (let p = start; p < s; p++) cache.get(p)!.keys.forEach((k, j) => (taken[j] ??= new Set()).add(k));
    let first: Built | null = null;
    let chosen: Built | null = null;
    for (let a = 0; a < 4000 && !chosen; a++) {
      const c = build(s, a);
      if (!c) continue;
      first ??= c;
      if (c.keys.every((k, j) => !taken[j]?.has(k))) chosen = c;
    }
    chosen ??= first;
    if (!chosen) throw new Error(`no suitable dataset found for seed ${s}`);
    cache.set(s, chosen);
  }
  return structuredClone(cache.get(s0)!.variant);
}

const CREW = ['Red', 'Blue', 'Green', 'Pink', 'Orange', 'Yellow', 'Black', 'White', 'Purple', 'Brown', 'Cyan', 'Lime', 'Maroon', 'Rose', 'Banana', 'Gray', 'Tan', 'Coral'];
const SHIPS = ['The Skeld', 'Polus', 'Mira HQ', 'The Airship', 'The Fungle', 'Dleks', 'Nebula Outpost', 'Orbital Lab 9'];

// ---------------------------------------------------------------------------
// EASY · NUMERIC — header row counted in the denominator
// ---------------------------------------------------------------------------
const O2_COLS = ['o2_level', 'oxygen_pct', 'o2_pct', 'oxygen_level', 'o2_reading', 'air_o2', 'o2_sat', 'o2_percent'];
const o2Cache = new Map<number, Built>();

function buildO2(seed: number, attempt: number): Built | null {
  const ship = at(SHIPS, seed);
  const col = at(O2_COLS, Math.floor(seed / 8));
  const r = rng(mix(seed, 101, attempt));
  const n = ri(r, 15, 35);
  const lo = ri(r, 165, 205);
  const modules = sample(r, ['Reactor', 'MedBay', 'Navigation', 'Storage', 'Admin', 'Weapons', 'Shields', 'Comms', 'Electrical'], 5);
  const rows: string[] = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const o2 = ri(r, lo, lo + 60);
    sum += o2;
    rows.push(`${i + 1},${at(modules, ri(r, 0, 4))},${tenths(o2)},${ri(r, 1, 6)}`);
  }
  const csv = csvOf(`tick,module,${col},crew_count`, rows);
  const answer = Math.round((sum / n / 10) * 100) / 100;
  const buggy = sum / (n + 1) / 10;
  if (Math.abs(buggy - answer) < 0.05) return null; // never happens (gap >= 0.45), kept as a guard
  const starter = py`import csv

# Mean ${col} across every telemetry reading in telemetry.csv
with open('telemetry.csv', newline='') as f:
    rows = list(csv.reader(f))

total = 0.0
for row in rows[1:]:          # skip the header line
    total += float(row[2])    # ${col} column

average = total / len(rows)
print(round(average, 2))
`;
  const fixed = starter.replace('average = total / len(rows)', 'average = total / len(rows[1:])');
  const statement = `Life support on ${ship} logged ${n} oxygen readings into telemetry.csv (columns: tick, module, ${col}, crew_count). The analysis script analysis.py is supposed to print the mean ${col} across all ${n} readings, but the number it reports is suspiciously low — the crew suspects sabotage.\n\nFix analysis.py, run it, and submit the correct mean.`;
  const variant: TaskVariant = {
    title: `O2 average on ${ship}`,
    statement,
    workspace: 'DATA',
    runLanguage: 'python',
    runEntry: 'analysis.py',
    files: [
      { name: 'analysis.py', language: 'python', content: starter },
      { name: 'telemetry.csv', language: 'csv', content: csv, readOnly: true },
    ],
    answerFormat: `Submit a single number: the mean ${col} of all data rows, rounded to 2 decimals (e.g. 21.37). Accepted if within 0.01 of the true mean.`,
    validation: { mode: 'NUMERIC', answer, tolerance: 0.01 },
    hint: 'The loop skips the header, but count how many rows the total is divided by. Does that count include the header line?',
    solution: {
      explanation: `The divisor len(rows) includes the header line, so the sum of ${n} readings is divided by ${n + 1} (the buggy script prints about ${buggy.toFixed(2)}). Divide by the number of data rows (len(rows) - 1). Correct mean = ${answer.toFixed(2)}.`,
      files: { 'analysis.py': fixed },
      answer: answer.toFixed(2),
    },
  };
  return { variant, keys: [answer.toFixed(2), statement] };
}

const o2Mean: TaskTemplate = {
  key: 'data-o2-mean',
  domain: 'data',
  difficulty: 'EASY',
  variant: (seed) => blockUnique(o2Cache, seed, buildO2),
};

// ---------------------------------------------------------------------------
// EASY · CODE_TESTS — leaderboard sorted as strings instead of numbers
// ---------------------------------------------------------------------------
function leaderboard(csv: string, k: number): string {
  const rows = csv.split('\n').slice(1).filter((l) => l.trim() !== '').map((l) => l.split(','));
  const sorted = rows.map((r, i) => ({ name: r[0], coins: Number(r[1]), i })).sort((a, b) => b.coins - a.coins || a.i - b.i);
  return sorted.slice(0, k).map((r, idx) => `${idx + 1}. ${r.name} ${r.coins}`).join('\n');
}

const EVENTS = ['Cafeteria Raffle', 'Reactor Shift Bonus', 'Wiring Contest', 'Asteroid Blitz', 'Card Swipe Sprint', 'Fuel Run Derby', 'Scan Marathon', 'Vent Patrol Cup'];
const CURRENCIES = ['ideacoins', 'credits', 'tokens', 'stars', 'gems', 'points', 'chips', 'bolts'];

const coinLeaderboard: TaskTemplate = {
  key: 'data-coin-leaderboard',
  domain: 'data',
  difficulty: 'EASY',
  variant: (seed) => {
    const event = at(EVENTS, seed);
    const cur = at(CURRENCIES, Math.floor(seed / 8));
    const r0 = rng(mix(seed, 200));
    const k = ri(r0, 3, 6);
    const header = `crew,${cur}`;
    const mk = (salt: number, count: number): string => {
      const r = rng(mix(seed, salt));
      const names = [...CREW];
      const rows: string[] = [];
      for (let i = 0; i < count; i++) {
        const name = names.splice(ri(r, 0, names.length - 1), 1)[0];
        const digits = ri(r, 1, 4);
        const coins = digits === 1 ? ri(r, 2, 9) : digits === 2 ? ri(r, 10, 99) : digits === 3 ? ri(r, 100, 999) : ri(r, 1000, 2500);
        rows.push(`${name},${coins}`);
      }
      return csvOf(header, rows);
    };
    const main = mk(201, ri(r0, 12, 18));
    const tie = ri(r0, 20, 89);
    const big = ri(r0, 1000, 1999);
    const small = ri(r0, 2, 9);
    const [a, b, c, d, e, f] = sample(r0, CREW, 6);
    const inputs: [string, string][] = [
      ['ledger', main],
      ['second-ledger', mk(202, ri(r0, 7, 11))],
      ['ties-keep-file-order', csvOf(header, [`${a},${tie}`, `${b},${small}`, `${c},${tie}`, `${d},${big}`, `${e},${tie}`, `${f},${tie + ri(r0, 1, 9)}`])],
      ['single-crewmate', csvOf(header, [`${at(CREW, seed + 3)},${ri(r0, 1, 500)}`])],
      ['header-only', `${header}\n`],
    ];
    const tests: CodeTest[] = inputs.map(([name, stdin]) => ({ name, stdin, expected: leaderboard(stdin, k) }));
    const starter = py`import sys
import csv

# Reads a crew,${cur} CSV from stdin and prints the top earners.
TOP_K = ${String(k)}

rows = list(csv.reader(sys.stdin.read().splitlines()))[1:]
rows = [r for r in rows if r]

rows.sort(key=lambda r: r[1], reverse=True)

for rank, r in enumerate(rows[:TOP_K], start=1):
    print(f"{rank}. {r[0]} {r[1]}")
`;
    const fixed = starter.replace('rows.sort(key=lambda r: r[1], reverse=True)', 'rows.sort(key=lambda r: int(r[1]), reverse=True)');
    return {
      title: `${event} leaderboard`,
      statement: `The ${event} pays out ${cur}, and analysis.py prints the top ${k} crewmates by ${cur} earned. It reads the CSV (header ${header}) from standard input. Somebody noticed that a crewmate with a single-digit total is ranked above one with more than a thousand ${cur}.\n\nRules:\n- Print at most ${k} lines, highest ${cur} first, formatted as "<rank>. <crew> <${cur}>".\n- Crewmates with equal ${cur} keep their order from the file.\n- If there are fewer than ${k} crewmates, print them all; a header-only file prints nothing.\n\ntelemetry.csv holds this round's ledger (it is also the default stdin). Your fixed script is verified against hidden ledgers.`,
      workspace: 'DATA',
      runLanguage: 'python',
      runEntry: 'analysis.py',
      files: [
        { name: 'analysis.py', language: 'python', content: starter },
        { name: 'telemetry.csv', language: 'csv', content: main, readOnly: true },
      ],
      sampleStdin: main,
      answerFormat: 'Submit your repaired analysis.py. It is run on hidden CSV inputs passed via stdin; stdout must match exactly (trailing whitespace ignored).',
      validation: { mode: 'CODE_TESTS', language: 'python', entry: 'analysis.py', tests },
      hint: `csv.reader gives you strings. How does "${small}" compare to "${big}" when compared as text?`,
      solution: {
        explanation: `The sort key compares the ${cur} column as text, so "${small}" > "${big}". Sort by int(r[1]) (Python's sort is stable, so ties keep file order even with reverse=True).`,
        files: { 'analysis.py': fixed },
      },
    };
  },
};

// ---------------------------------------------------------------------------
// MEDIUM · NUMERIC — missing values counted as 0 + wrong even-count median
// ---------------------------------------------------------------------------
const CABINS = ['Engine', 'Galley', 'Bridge', 'Lab', 'Dorms', 'Greenhouse', 'Comms', 'Vault', 'Hangar', 'Office', 'Brig', 'Observatory'];
const TEMP_COLS = ['temp_c', 'temperature_c', 'deg_c', 'cabin_temp', 'temp_reading', 'heat_c'];
const MISSING = ['NA', 'N/A', 'null', '--'];
const medianCache = new Map<number, Built>();

function buildMedian(seed: number, attempt: number): Built | null {
  const r = rng(mix(seed, 300, attempt));
  const cabins = sample(r, CABINS, 3);
  const target = cabins[ri(r, 0, 2)];
  const col = at(TEMP_COLS, seed + Math.floor(seed / 6));
  const na = at(MISSING, Math.floor(seed / 4));
  const n = ri(r, 28, 38);
  const lo = ri(r, 140, 190);
  const rows: string[] = [];
  const valid: number[] = [];
  let missing = 0;
  const starterVals: number[] = [];
  for (let i = 0; i < n; i++) {
    const cabin = cabins[ri(r, 0, 2)];
    const roll = r();
    let raw: string;
    if (roll < 0.09) raw = '';
    else if (roll < 0.18) raw = na;
    else raw = tenths(ri(r, lo, lo + 140));
    rows.push(`${i + 1},${cabin},${raw}`);
    if (cabin !== target) continue;
    if (raw === '' || raw === na) {
      missing++;
      starterVals.push(0);
    } else {
      const t = Math.round(Number(raw) * 10);
      valid.push(t);
      starterVals.push(t);
    }
  }
  if (valid.length < 6 || valid.length % 2 !== 0 || missing < 2) return null;
  valid.sort((a, b) => a - b);
  starterVals.sort((a, b) => a - b);
  const a = valid[valid.length / 2 - 1];
  const b = valid[valid.length / 2];
  const answer = ((a + b) * 5) / 100; // (a+b)/2 tenths -> degrees, exact to 2 decimals
  const starterAns = starterVals[Math.floor(starterVals.length / 2)] / 10;
  const naiveUpper = b / 10; // only-missing-fixed variant
  const naiveLower = valid[Math.floor(valid.length / 2)] / 10;
  if (Math.abs(starterAns - answer) < 0.05 || Math.abs(naiveUpper - answer) < 0.05 || Math.abs(naiveLower - answer) < 0.05) return null;
  const csv = csvOf(`tick,cabin,${col}`, rows);
  const starter = py`import csv

TARGET = '${target}'

# Median cabin temperature for TARGET, ignoring missing readings ('' or '${na}').
temps = []
with open('telemetry.csv', newline='') as f:
    for row in csv.DictReader(f):
        if row['cabin'] != TARGET:
            continue
        raw = row['${col}'].strip()
        temps.append(float(raw) if raw not in ('', '${na}') else 0.0)

temps.sort()
median = temps[len(temps) // 2]
print(round(median, 2))
`;
  const fixed = py`import csv

TARGET = '${target}'

# Median cabin temperature for TARGET, ignoring missing readings ('' or '${na}').
temps = []
with open('telemetry.csv', newline='') as f:
    for row in csv.DictReader(f):
        if row['cabin'] != TARGET:
            continue
        raw = row['${col}'].strip()
        if raw in ('', '${na}'):
            continue
        temps.append(float(raw))

temps.sort()
mid = len(temps) // 2
if len(temps) % 2 == 0:
    median = (temps[mid - 1] + temps[mid]) / 2
else:
    median = temps[mid]
print(round(median, 2))
`;
  const statement = `The thermal sensors on the ${cabins.join(' / ')} cabins wrote ${n} readings to telemetry.csv (columns: tick, cabin, ${col}). Some sensors glitched: a missing reading is either an empty field or the text ${na}.\n\nanalysis.py should print the MEDIAN ${col} of the ${target} cabin, using only real readings (missing ones are ignored, not treated as 0). Remember: when the number of readings is even, the median is the average of the two middle values. The script's answer is off.\n\nFix analysis.py, run it, and submit the median.`;
  const variant: TaskVariant = {
    title: `${target} cabin temperature median`,
    statement,
    workspace: 'DATA',
    runLanguage: 'python',
    runEntry: 'analysis.py',
    files: [
      { name: 'analysis.py', language: 'python', content: starter },
      { name: 'telemetry.csv', language: 'csv', content: csv, readOnly: true },
    ],
    answerFormat: `Submit a single number: the median ${col} of the ${target} cabin, rounded to 2 decimals (e.g. 23.45). Accepted if within 0.01 of the true median.`,
    validation: { mode: 'NUMERIC', answer, tolerance: 0.01 },
    hint: 'Two separate problems: what gets appended when a reading is missing, and which element(s) form the middle when the list length is even?',
    solution: {
      explanation: `Missing readings ('' / '${na}') were appended as 0.0, dragging the median down (the buggy script prints ${starterAns.toFixed(2)}), and the median took a single element even though the ${target} cabin has ${valid.length} valid readings (even). Skip missing readings and average the two middle values (${(a / 10).toFixed(1)} and ${(b / 10).toFixed(1)}). Median = ${answer.toFixed(2)}.`,
      files: { 'analysis.py': fixed },
      answer: answer.toFixed(2),
    },
  };
  return { variant, keys: [answer.toFixed(2), statement] };
}

const cabinMedian: TaskTemplate = {
  key: 'data-cabin-median',
  domain: 'data',
  difficulty: 'MEDIUM',
  variant: (seed) => blockUnique(medianCache, seed, buildMedian),
};

// ---------------------------------------------------------------------------
// MEDIUM · CODE_TESTS — group-by accumulator overwritten + integer division
// ---------------------------------------------------------------------------
function deckReport(csv: string): string {
  const totals = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const line of csv.split('\n').slice(1)) {
    if (!line.trim()) continue;
    const [, deck, kw] = line.split(',');
    totals.set(deck, (totals.get(deck) ?? 0) + Number(kw));
    counts.set(deck, (counts.get(deck) ?? 0) + 1);
  }
  return [...totals.keys()]
    .sort()
    .map((d) => `${d} ${totals.get(d)} ${pyFixed(totals.get(d)! / counts.get(d)!, 2)}`)
    .join('\n');
}

const DECKS_A = ['Bridge', 'Cargo', 'Engine', 'Lab', 'Admin', 'Comms', 'Reactor', 'Shields'];
const DECKS_B = ['Armory', 'Galley', 'Medbay', 'Vault', 'Dock', 'Hydro', 'Nav', 'Weapons'];
const DECKS_C = ['Lounge', 'Brig', 'Observatory', 'Hangar', 'Chapel', 'Gym', 'Library', 'Kiln'];
const POWER_COLS = ['power_kw', 'draw_kw', 'load_kw', 'usage_kw'];

const deckPower: TaskTemplate = {
  key: 'data-deck-power',
  domain: 'data',
  difficulty: 'MEDIUM',
  variant: (seed) => {
    const r0 = rng(mix(seed, 400));
    const decks = [at(DECKS_A, seed), at(DECKS_B, Math.floor(seed / 8)), ...sample(r0, DECKS_C, ri(r0, 2, 3))].sort();
    const col = at(POWER_COLS, seed + Math.floor(seed / 16));
    const header = `tick,deck,${col}`;
    const mk = (salt: number, n: number, pool: string[]): string => {
      const r = rng(mix(seed, salt));
      const rows: string[] = [];
      for (let i = 0; i < n; i++) rows.push(`${i + 1},${pool[ri(r, 0, pool.length - 1)]},${ri(r, 3, 60)}`);
      return csvOf(header, rows);
    };
    const main = mk(401, ri(r0, 20, 30), decks);
    const one = at(decks, ri(r0, 0, decks.length - 1));
    const inputs: [string, string][] = [
      ['power-log', main],
      ['second-log', mk(402, ri(r0, 10, 14), sample(r0, decks, 3))],
      ['single-deck', csvOf(header, [`1,${one},${ri(r0, 3, 60)}`, `2,${one},${ri(r0, 3, 60)}`, `3,${one},${ri(r0, 3, 60)}`])],
      ['single-row', csvOf(header, [`${ri(r0, 1, 99)},${at(decks, seed + 1)},${ri(r0, 3, 99)}`])],
      ['header-only', `${header}\n`],
    ];
    const tests: CodeTest[] = inputs.map(([name, stdin]) => ({ name, stdin, expected: deckReport(stdin) }));
    const starter = py`import sys
import csv

# Per-deck power report. Input: CSV (${header}) on stdin.
rows = list(csv.DictReader(sys.stdin.read().splitlines()))

totals = {}
counts = {}
for row in rows:
    deck = row['deck']
    kw = int(row['${col}'])
    if deck not in totals:
        totals[deck] = 0
        counts[deck] = 0
    totals[deck] = kw
    counts[deck] += 1

for deck in sorted(totals):
    avg = totals[deck] // counts[deck]
    print(f"{deck} {totals[deck]} {avg:.2f}")
`;
    const fixed = starter
      .replace('    totals[deck] = kw\n', '    totals[deck] += kw\n')
      .replace('avg = totals[deck] // counts[deck]', 'avg = totals[deck] / counts[deck]');
    return {
      title: `Deck power report (${decks[0]} to ${decks[decks.length - 1]})`,
      statement: `Engineering logs every power draw as a CSV row ${header} (${col} is a whole number). analysis.py reads that CSV from standard input and must print one line per deck, decks in alphabetical order:\n\n\`\`\`\n<deck> <total ${col}> <average ${col} with 2 decimals>\n\`\`\`\n\nThis cycle's decks are ${decks.join(', ')}. The report currently shows totals that are far too small and averages that always end in .00. A header-only input prints nothing.\n\ntelemetry.csv holds this cycle's log (also the default stdin). Your fixed script is verified against hidden logs.`,
      workspace: 'DATA',
      runLanguage: 'python',
      runEntry: 'analysis.py',
      files: [
        { name: 'analysis.py', language: 'python', content: starter },
        { name: 'telemetry.csv', language: 'csv', content: main, readOnly: true },
      ],
      sampleStdin: main,
      answerFormat: 'Submit your repaired analysis.py. It is run on hidden CSV inputs passed via stdin; stdout must match exactly (trailing whitespace ignored). Averages are printed with Python f"{x:.2f}".',
      validation: { mode: 'CODE_TESTS', language: 'python', entry: 'analysis.py', tests },
      hint: "Look at what happens to a deck's running total on its second row. Then check which division operator produces the average.",
      solution: {
        explanation: 'The accumulator is overwritten (totals[deck] = kw) instead of accumulated (+=), and // performs floor division so the average loses its fraction. Use += and /.',
        files: { 'analysis.py': fixed },
      },
    };
  },
};

// ---------------------------------------------------------------------------
// HARD · CODE_TESTS — grouped moving-window anomaly detector with missing data
// ---------------------------------------------------------------------------
function anomalyReport(csv: string, w: number, thr: number): string {
  const hist = new Map<string, number[]>();
  const valid = new Map<string, number>();
  const anomalies = new Map<string, string[]>();
  for (const line of csv.split('\n').slice(1)) {
    if (!line.trim()) continue;
    const [tick, sensor, rawIn] = line.split(',');
    const raw = (rawIn ?? '').trim();
    if (!hist.has(sensor)) {
      hist.set(sensor, []);
      valid.set(sensor, 0);
      anomalies.set(sensor, []);
    }
    if (raw === '' || raw === 'NA') continue;
    const value = Number(raw);
    const h = hist.get(sensor)!;
    valid.set(sensor, valid.get(sensor)! + 1);
    if (h.length >= w) {
      const avg = h.slice(-w).reduce((a, b) => a + b, 0) / w;
      if (Math.abs(value - avg) > thr) anomalies.get(sensor)!.push(tick);
    }
    h.push(value);
  }
  return [...hist.keys()]
    .sort()
    .map((s) => `${s} ${valid.get(s)} ${anomalies.get(s)!.length ? anomalies.get(s)!.join(',') : 'none'}`)
    .join('\n');
}

const SENSORS_A = ['hull', 'oxygen', 'reactor', 'coolant', 'gravity', 'shield', 'airlock', 'cabin'];
const SENSORS_B = ['thruster', 'battery', 'comms', 'radiation', 'sonar', 'plasma', 'vent', 'beacon'];
const SENSORS_C = ['lidar', 'pump', 'hatch', 'fuel', 'pressure', 'magnet', 'gyro', 'antenna'];

const sensorAnomaly: TaskTemplate = {
  key: 'data-sensor-anomaly',
  domain: 'data',
  difficulty: 'HARD',
  variant: (seed) => {
    const r0 = rng(mix(seed, 500));
    const W = ri(r0, 3, 5);
    const T = ri(r0, 10, 30);
    const sensors = [at(SENSORS_A, seed), at(SENSORS_B, Math.floor(seed / 8)), at(SENSORS_C, ri(r0, 0, 7))].sort();
    const mk = (salt: number, n: number): string => {
      const r = rng(mix(seed, salt));
      const base = sensors.map(() => ri(r, 40, 90));
      const start = ri(r, 100, 900);
      const rows: string[] = [];
      for (let i = 0; i < n; i++) {
        const si = ri(r, 0, sensors.length - 1);
        const roll = r();
        let raw: string;
        if (roll < 0.06) raw = '';
        else if (roll < 0.14) raw = 'NA';
        else if (roll < 0.26) raw = String(base[si] + (r() < 0.5 ? -1 : 1) * ri(r, T + 6, T + 20));
        else raw = String(base[si] + ri(r, -4, 4));
        rows.push(`${start + i},${sensors[si]},${raw}`);
      }
      return csvOf('tick,sensor,value', rows);
    };
    const main = mk(501, ri(r0, 32, 38));
    const s0 = sensors[ri(r0, 0, 2)];
    const s1 = sensors.find((s) => s !== s0)!;
    const b = ri(r0, 40, 80);
    const small = csvOf('tick,sensor,value', [
      `1,${s0},${b}`,
      `2,${s1},NA`,
      `3,${s0},${b + 2}`,
      `4,${s0},`,
      `5,${s0},${b + 1}`,
      `6,${s1},`,
      `7,${s0},NA`,
      `8,${s0},${b + 3}`,
      `9,${s0},${b - 1}`,
      `10,${s0},${b + 1}`,
      `11,${s0},${b + T + 3}`,
      `12,${s0},${b + 2}`,
    ]);
    const inputs: [string, string][] = [
      ['sensor-log', main],
      ['second-log', mk(502, ri(r0, 26, 32))],
      ['missing-and-short', small],
      ['header-only', 'tick,sensor,value\n'],
    ];
    const tests: CodeTest[] = inputs.map(([name, stdin]) => ({ name, stdin, expected: anomalyReport(stdin, W, T) }));
    const starter = py`import sys
import csv

WINDOW = ${String(W)}        # number of PREVIOUS valid readings of the same sensor to average
THRESHOLD = ${String(T)}    # anomaly when |value - moving average| > THRESHOLD

rows = list(csv.DictReader(sys.stdin.read().splitlines()))

history = []
valid = {}
anomalies = {}
for row in rows:
    sensor = row['sensor']
    raw = (row['value'] or '').strip()
    valid.setdefault(sensor, 0)
    anomalies.setdefault(sensor, [])
    if raw == '':
        continue
    value = float(raw) if raw != 'NA' else 0.0
    valid[sensor] += 1
    history.append(value)
    if len(history) >= WINDOW:
        avg = sum(history[-WINDOW:]) / WINDOW
        if abs(value - avg) > THRESHOLD:
            anomalies[sensor].append(row['tick'])

for sensor in sorted(valid):
    ticks = ','.join(anomalies[sensor]) if anomalies[sensor] else 'none'
    print(f"{sensor} {valid[sensor]} {ticks}")
`;
    const fixed = py`import sys
import csv

WINDOW = ${String(W)}        # number of PREVIOUS valid readings of the same sensor to average
THRESHOLD = ${String(T)}    # anomaly when |value - moving average| > THRESHOLD

rows = list(csv.DictReader(sys.stdin.read().splitlines()))

history = {}
valid = {}
anomalies = {}
for row in rows:
    sensor = row['sensor']
    raw = (row['value'] or '').strip()
    valid.setdefault(sensor, 0)
    anomalies.setdefault(sensor, [])
    history.setdefault(sensor, [])
    if raw in ('', 'NA'):
        continue
    value = float(raw)
    valid[sensor] += 1
    hist = history[sensor]
    if len(hist) >= WINDOW:
        avg = sum(hist[-WINDOW:]) / WINDOW
        if abs(value - avg) > THRESHOLD:
            anomalies[sensor].append(row['tick'])
    hist.append(value)

for sensor in sorted(valid):
    ticks = ','.join(anomalies[sensor]) if anomalies[sensor] else 'none'
    print(f"{sensor} {valid[sensor]} {ticks}")
`;
    return {
      title: `Anomaly radar: ${sensors.join(', ')}`,
      statement: `Security wants to catch the impostor tampering with the ${sensors.join(', ')} sensors. analysis.py reads a CSV log (tick,sensor,value) from standard input and flags anomalies. The detector is producing nonsense.\n\nSpecification:\n- A reading is missing when value is empty or NA. Missing readings are ignored completely (they are not 0), but every sensor that appears in the log is still reported.\n- Each sensor is analysed independently, in log order.\n- A valid reading is an anomaly when at least ${W} earlier valid readings of the SAME sensor exist and |value - mean of the previous ${W} valid readings of that sensor| > ${T}. The current reading is not part of its own window. Anomalous readings still enter the history.\n- Output one line per sensor, sensors in alphabetical order:\n\n\`\`\`\n<sensor> <number_of_valid_readings> <comma-separated anomaly ticks in log order, or none>\n\`\`\`\n\nA header-only log prints nothing. telemetry.csv is this shift's log (also the default stdin). Your fixed script is verified against hidden logs.`,
      workspace: 'DATA',
      runLanguage: 'python',
      runEntry: 'analysis.py',
      files: [
        { name: 'analysis.py', language: 'python', content: starter },
        { name: 'telemetry.csv', language: 'csv', content: main, readOnly: true },
      ],
      sampleStdin: main,
      answerFormat: 'Submit your repaired analysis.py. It is run on hidden CSV logs passed via stdin; stdout must match exactly (trailing whitespace ignored).',
      validation: { mode: 'CODE_TESTS', language: 'python', entry: 'analysis.py', tests },
      hint: 'There are three sabotaged spots: how NA is treated, whose readings end up in the window, and whether the current reading is already in its own window when the average is computed.',
      solution: {
        explanation: `Three bugs: (1) NA was converted to 0.0 instead of being skipped; (2) a single shared history list mixed all sensors together — keep one history per sensor; (3) the value was appended before computing the moving average, so the window contained the current reading — compute the average over the previous WINDOW (${W}) readings first, then append. Threshold is ${T}.`,
        files: { 'analysis.py': fixed },
      },
    };
  },
};

export const dataTemplates: TaskTemplate[] = [o2Mean, coinLeaderboard, cabinMedian, deckPower, sensorAnomaly];
