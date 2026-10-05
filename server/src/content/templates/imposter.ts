import type { TaskTemplate } from '../types.js';
import { webHarness } from './web.js';

/**
 * IMPOSTER DETECTED — per-slot BONUS emergency problems.
 * Compact, tricky, solvable in a few minutes by a strong team (HARD).
 * Every template accepts ANY non-negative integer seed: names come from
 * mixed-radix digits of the seed and data from a seeded LCG. All expected
 * outputs and answers are computed here by TypeScript reference code.
 */

function lcg(seed: number): () => number {
  let s = (seed * 2654435761 + 0x9e3779b9) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const randInt = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
/** Mixed-radix digits of the seed: distinct seeds below prod(sizes) give distinct index tuples. */
function mix(seed: number, sizes: number[]): number[] {
  let s = Math.max(0, Math.floor(seed));
  return sizes.map((n) => {
    const d = s % n;
    s = Math.floor(s / n);
    return d;
  });
}
const SALT = (seed: number, k: number) => Math.max(0, Math.floor(seed)) * 7919 + k;
const NATO = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa'];

// ---------------------------------------------------------------------------
// O2 sabotage (basic / Python): round() is banker's rounding.
// ---------------------------------------------------------------------------
const o2Rounding: TaskTemplate = {
  key: 'imposter-o2-rounding',
  domain: 'basic',
  difficulty: 'HARD',
  variant: (seed) => {
    const UNITS = ['TANK', 'CELL', 'VALVE', 'SCRUBBER', 'CANISTER', 'FILTER', 'LINE', 'PUMP'];
    const SECTORS = ['Skeld', 'Polus', 'Mira', 'Airship', 'Fungle', 'Dleks', 'Kepler', 'Orion'];
    const [ui, si, ex] = mix(seed, [UNITS.length, SECTORS.length, 1000]);
    const unit = UNITS[ui];
    const sector = `${SECTORS[si]}${ex ? `-${ex + 1}` : ''}`;
    const code = (fixed: boolean) => `# O2 ${unit.toLowerCase()} gauge (${sector})
# Input: one line per ${unit.toLowerCase()}: "<remaining> <capacity>" (integers, 0 <= remaining <= capacity, capacity > 0).
# Output per line:  ${unit} k: <percent>%
# percent = remaining / capacity * 100 rounded to the nearest integer, halves ROUND UP (12.5 -> 13).
import sys

k = 0
for line in sys.stdin.read().splitlines():
    parts = line.split()
    if len(parts) != 2:
        continue
    a, b = int(parts[0]), int(parts[1])
    k += 1
    pct = ${fixed ? '(200 * a + b) // (2 * b)' : 'round(a * 100 / b)'}
    print("${unit} " + str(k) + ": " + str(pct) + "%")
`;
    const pct = (a: number, b: number) => Math.floor((200 * a + b) / (2 * b));
    const r = lcg(SALT(seed, 1111));
    const randPairs = (k: number) => Array.from({ length: k }, () => { const b = randInt(r, 1, 900); return [randInt(r, 0, b), b] as [number, number]; });
    /** An exact half k + 0.5 with k EVEN: banker's rounding goes DOWN, half-up goes UP. */
    const evenHalf = (): [number, number] => {
      const k = 2 * randInt(r, 0, 49);
      const m = randInt(r, 1, 4);
      return [(2 * k + 1) * m, 200 * m];
    };
    /** An exact half with k ODD: both rounding rules agree. */
    const oddHalf = (): [number, number] => {
      const k = 2 * randInt(r, 0, 48) + 1;
      return [2 * k + 1, 200];
    };
    const sets: [number, number][][] = [
      [evenHalf(), [randInt(r, 0, 7), 8], evenHalf()],
      [[0, randInt(r, 3, 50)], ((b) => [b, b] as [number, number])(randInt(r, 3, 999)), [1, 3], [2, 3]],
      [oddHalf(), evenHalf(), [randInt(r, 1, 39), 40]],
      randPairs(8),
      [...randPairs(4), evenHalf()],
    ];
    const tests = sets.map((s, i) => ({
      name: `gauge-${i + 1}`,
      stdin: s.map(([a, b]) => `${a} ${b}`).join('\n') + '\n',
      expected: s.map(([a, b], j) => `${unit} ${j + 1}: ${pct(a, b)}%`).join('\n'),
    }));
    return {
      title: `O2 ${unit.toLowerCase()} gauges read low (${sector})`,
      statement: `IMPOSTER DETECTED — EMERGENCY BONUS. Sabotage in O2 on ${sector}! The ${unit.toLowerCase()} gauges sometimes show one percent less than they should, and the crew is venting oxygen they actually have. Each gauge reads "<remaining> <capacity>" and must print the percentage rounded to the nearest integer, where an exact half always rounds UP (12.5% -> 13%).\n\nThe code looks fine at first glance. Find what the imposter is exploiting and repair main.py before the oxygen runs out.`,
      workspace: 'BASIC',
      runLanguage: 'python',
      runEntry: 'main.py',
      files: [{ name: 'main.py', language: 'python', content: code(false) }],
      sampleStdin: tests[0].stdin,
      answerFormat: 'Submit your repaired main.py. It runs against hidden inputs; stdout must match exactly line by line (trailing whitespace ignored).',
      validation: { mode: 'CODE_TESTS', language: 'python', entry: 'main.py', tests },
      hint: "Python 3's round() uses banker's rounding: round(12.5) == 12. Do the rounding with integer arithmetic instead.",
      solution: { explanation: "round() rounds halves to the nearest EVEN integer. Use integer half-up rounding: (200 * a + b) // (2 * b).", files: { 'main.py': code(true) } },
    };
  },
};

// ---------------------------------------------------------------------------
// Reactor meltdown (ds / JavaScript): lower-bound binary search.
// ---------------------------------------------------------------------------
const reactorBsearch: TaskTemplate = {
  key: 'imposter-reactor-threshold',
  domain: 'ds',
  difficulty: 'HARD',
  variant: (seed) => {
    const SHIPS = ['Skeld', 'Polus', 'Mira', 'Airship', 'Fungle', 'Dleks', 'Kepler', 'Orion'];
    const [ci, si] = mix(seed, [26, SHIPS.length]);
    const core = `core ${String.fromCharCode(65 + ci)}${Math.floor(seed / 208) || ''} on ${SHIPS[si]}`;
    const code = (fixed: boolean) => `// Reactor ${core} meltdown predictor
// Input (whitespace separated): N, then N core temperatures in NON-DECREASING order (one per minute),
// then Q, then Q threshold values.
// Output: one line with Q numbers separated by spaces: for each threshold T, the FIRST minute index
// (0-based) whose temperature is >= T, or -1 if the core never reaches T.
const data = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);
let p = 0;
const n = data[p++];
const temps = data.slice(p, p + n);
p += n;
const q = data[p++];

function firstAtLeast(arr, t) {
  let lo = 0;
  let hi = ${fixed ? 'arr.length' : 'arr.length - 1'};
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] ${fixed ? '<' : '<='} t) lo = mid + 1;
    else hi = mid;
  }
  return ${fixed ? 'lo < arr.length ? lo : -1' : 'lo'};
}

const out = [];
for (let i = 0; i < q; i++) out.push(firstAtLeast(temps, data[p++]));
console.log(out.join(' '));
`;
    const ref = (arr: number[], t: number) => arr.findIndex((x) => x >= t);
    const r = lcg(SALT(seed, 2222));
    const series = (n: number) => {
      const a: number[] = [];
      let cur = randInt(r, 200, 400);
      for (let i = 0; i < n; i++) { cur += r() < 0.35 ? 0 : randInt(r, 1, 40); a.push(cur); }
      return a;
    };
    const queriesFor = (a: number[]) => [
      a[0] - 5,
      a[randInt(r, 0, a.length - 1)],
      a[a.length - 1],
      a[a.length - 1] + 1,
      a[randInt(r, 0, a.length - 1)] + 1,
      a[randInt(r, 0, a.length - 1)],
    ];
    const sets: { a: number[]; qs: number[] }[] = [];
    // Duplicates hit exactly (the <= bug skips the run) and a value above the max (no -1).
    const base = randInt(r, 300, 700);
    const step = randInt(r, 5, 30);
    const top = base + step + randInt(r, 10, 120);
    sets.push({ a: [base, base, base + step, base + step, base + step, top], qs: [base + step, base, top + 1, base + Math.floor(step / 2)] });
    const solo = randInt(r, 500, 950);
    sets.push({ a: [solo], qs: [solo, randInt(r, 1, 99), solo + randInt(r, 1, 5000)] });
    for (const n of [12, 25, 60]) { const a = series(n); sets.push({ a, qs: queriesFor(a) }); }
    const tests = sets.map(({ a, qs }, i) => ({
      name: `core-${i + 1}`,
      stdin: `${a.length}\n${a.join(' ')}\n${qs.length}\n${qs.join(' ')}\n`,
      expected: qs.map((t) => ref(a, t)).join(' '),
    }));
    return {
      title: `Reactor ${core} meltdown ETA is wrong`,
      statement: `IMPOSTER DETECTED — EMERGENCY BONUS. Reactor meltdown! The ${core} predictor looks up, for each danger threshold T, the first minute at which the (never-decreasing) core temperature is at least T, or -1 if it never gets there. Engineers say the predictions are off whenever the temperature hits T exactly, and the predictor never admits "never".\n\nThe imposter tampered with firstAtLeast(). Repair main.js. Verified against hidden temperature logs.`,
      workspace: 'DS',
      runLanguage: 'javascript',
      runEntry: 'main.js',
      files: [{ name: 'main.js', language: 'javascript', content: code(false) }],
      sampleStdin: tests[0].stdin,
      answerFormat: 'Submit your repaired main.js. It runs against hidden inputs; stdout must match exactly (trailing whitespace ignored).',
      validation: { mode: 'CODE_TESTS', language: 'javascript', entry: 'main.js', tests },
      hint: 'You want the first index with arr[i] >= t (a lower bound). Check the comparison, and what happens when every value is below t.',
      solution: { explanation: 'Use arr[mid] < t (not <=), search over [0, arr.length) and return -1 when lo === arr.length.', files: { 'main.js': code(true) } },
    };
  },
};

// ---------------------------------------------------------------------------
// Comms jam (web / JavaScript): default sort is lexicographic.
// ---------------------------------------------------------------------------
const commsMedian: TaskTemplate = {
  key: 'imposter-comms-median',
  domain: 'web',
  difficulty: 'HARD',
  variant: (seed) => {
    // (seed % 16, 37 * seed % 89) is jointly distinct for 1424 consecutive seeds.
    const band = `${NATO[seed % NATO.length]}-${((seed * 37) % 89) + 11}`;
    const r = lcg(SALT(seed, 5150));
    const freqs = (k: number) => Array.from({ length: k }, () => randInt(r, 0, 2) === 0 ? randInt(r, 60, 99) : randInt(r, 0, 1) ? randInt(r, 100, 999) : randInt(r, 1000, 2400));
    const scan = freqs(7 + (seed % 2));
    const html = `<!doctype html>
<html>
<head><link rel="stylesheet" href="style.css"></head>
<body>
  <h1>Comms band ${band}: jammer locator</h1>
  <p>Scanned frequencies (MHz): <span id="scan"></span></p>
  <p class="median">Jammer centre: <span id="median"></span> MHz</p>
  <script src="script.js"></script>
</body>
</html>
`;
    const css = `body { font-family: monospace; background: #0d1620; color: #d6e4f0; padding: 16px; }
h1 { color: #b5a2ec; }
.median { font-weight: bold; color: #e8cf8e; }
`;
    const script = (fixed: boolean) => `// Comms band ${band} jammer locator.
// The jammer sits at the MEDIAN of the scanned frequencies:
// sort ascending numerically; odd count -> middle value; even count -> average of the two middle values.
const SCAN = ${JSON.stringify(scan)};

function medianFrequency(freqs) {
  const sorted = ${fixed ? '[...freqs].sort((a, b) => a - b)' : 'freqs.sort()'};
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[${fixed ? 'mid - 1' : 'mid'}] + sorted[${fixed ? 'mid' : 'mid + 1'}]) / 2;
}

if (typeof document !== 'undefined') {
  document.getElementById('scan').textContent = SCAN.join(', ');
  document.getElementById('median').textContent = medianFrequency(SCAN.slice());
}
`;
    const median = (a: number[]) => {
      const s = [...a].sort((x, y) => x - y);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const caseSets: number[][][] = [
      // [small, smaller] sorts fine as strings but the even-count indices run off the end.
      [scan, [randInt(r, 5, 9), randInt(r, 1, 4)]],
      [[randInt(r, 80, 99), randInt(r, 100, 199), randInt(r, 1000, 2400)], [randInt(r, 90, 99), randInt(r, 1000, 2400), randInt(r, 100, 199), randInt(r, 60, 89)]],
      [freqs(9), freqs(10), [randInt(r, 1, 999)]],
      [freqs(11), freqs(6), freqs(4)],
      [[2000, 300, 40, randInt(r, 1, 9), 600, 7000], freqs(15)],
    ];
    const tests = caseSets.map((cases, i) => ({
      name: `scan-${i + 1}`,
      stdin: JSON.stringify({ cases }),
      expected: cases.map((c) => String(median(c))).join(' '),
    }));
    return {
      title: `Comms jam on band ${band}`,
      statement: `IMPOSTER DETECTED — EMERGENCY BONUS. Comms sabotaged! The locator for band ${band} triangulates the jammer at the median of the scanned frequencies (in MHz): sort them in ascending numeric order, take the middle value for an odd count, or the average of the two middle values for an even count.\n\nThe locator keeps pointing at the wrong spot. Repair medianFrequency() in script.js. Final verification calls medianFrequency() with hidden frequency scans.`,
      workspace: 'WEB',
      runLanguage: 'javascript',
      runEntry: 'script.js',
      files: [
        { name: 'index.html', language: 'html', content: html },
        { name: 'style.css', language: 'css', content: css },
        { name: 'script.js', language: 'javascript', content: script(false) },
      ],
      answerFormat: 'Submit your edited files. Hidden tests call medianFrequency(freqs) with new frequency lists and compare the returned numbers exactly.',
      validation: {
        mode: 'CODE_TESTS',
        language: 'javascript',
        entry: 'harness.js',
        harness: [webHarness(`console.log(input.cases.map((c) => String(ctx.medianFrequency(c))).join(' '));`)],
        tests,
      },
      hint: 'Array.prototype.sort() without a comparator compares values as STRINGS ("1000" < "95"). Also count the indices of the two middle elements for an even length.',
      solution: { explanation: 'Sort numerically with (a, b) => a - b, and for an even count average sorted[mid - 1] and sorted[mid].', files: { 'script.js': script(true) } },
    };
  },
};

// ---------------------------------------------------------------------------
// Navigation (misc / JavaScript): negative modulo silently drops moves.
// ---------------------------------------------------------------------------
const navDrift: TaskTemplate = {
  key: 'imposter-nav-drift',
  domain: 'misc',
  difficulty: 'HARD',
  variant: (seed) => {
    const DESTS = ['Polus', 'Mira HQ', 'The Airship', 'the Fungle', 'the Skeld', 'Dleks Station', 'Kepler Outpost', 'Orion Relay'];
    const SHIPS = ['Dropship', 'Shuttle Kite', 'Cargo Hauler', 'Scout Wasp', 'Frigate Lynx', 'Tug Otter', 'Courier Finch', 'Lander Moth'];
    const [di, si, ex] = mix(seed, [DESTS.length, SHIPS.length, 1000]);
    const dest = DESTS[di];
    const ship = `${SHIPS[si]}${ex ? ` Mk ${ex + 1}` : ''}`;
    const r = lcg(SALT(seed, 9090));
    let cmds: string[] = [];
    const sim = (fixed: boolean) => {
      let h = 0, x = 0, y = 0;
      for (const c of cmds) {
        const op = c[0];
        const n = Number(c.slice(1));
        if (op === 'L') h = fixed ? (((h - n) % 360) + 360) % 360 : (h - n) % 360;
        else if (op === 'R') h = (h + n) % 360;
        else if (h === 0) y += n;
        else if (h === 90) x += n;
        else if (h === 180) y -= n;
        else if (h === 270) x -= n;
      }
      return Math.abs(x) + Math.abs(y);
    };
    // Deterministically regenerate until the route exposes the bug AND its answer
    // falls in this seed's residue class mod 64 (so seeds 0..63 get distinct answers).
    let answer = -1;
    for (let attempt = 0; ; attempt++) {
      if (attempt > 20000) throw new Error('could not build a route');
      cmds = ['L90', `F${randInt(r, 3, 30)}`];
      const len = randInt(r, 26, 34);
      for (let i = 0; i < len; i++) {
        const k = randInt(r, 0, 9);
        if (k < 3) cmds.push(`L${[90, 180, 270][randInt(r, 0, 2)]}`);
        else if (k < 5) cmds.push(`R${[90, 180, 270][randInt(r, 0, 2)]}`);
        else cmds.push(`F${randInt(r, 1, 40)}`);
      }
      const good = sim(true);
      if (good !== sim(false) && good % 64 === seed % 64) { answer = good; break; }
    }
    const route = cmds.join(' ');
    const code = (fixed: boolean) => `// ${ship} autopilot course plotter to ${dest}
// Input: whitespace-separated commands.
//   L<deg> / R<deg>  turn left / right by deg degrees (always a multiple of 90)
//   F<n>             move n units forward in the current heading
// Start at (0, 0) facing north. Headings are clockwise: 0 = N, 90 = E, 180 = S, 270 = W.
// Output: the Manhattan distance |x| + |y| of the final position from the start.
const cmds = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/);
let heading = 0;
let x = 0;
let y = 0;
for (const c of cmds) {
  const op = c[0];
  const n = Number(c.slice(1));
  if (op === 'L') heading = ${fixed ? '(((heading - n) % 360) + 360) % 360' : '(heading - n) % 360'};
  else if (op === 'R') heading = (heading + n) % 360;
  else if (op === 'F') {
    if (heading === 0) y += n;
    else if (heading === 90) x += n;
    else if (heading === 180) y -= n;
    else if (heading === 270) x -= n;
  }
}
console.log(Math.abs(x) + Math.abs(y));
`;
    return {
      title: `Navigation drift on the way to ${dest}`,
      statement: `IMPOSTER DETECTED — EMERGENCY BONUS. Navigation hijacked! The ${ship} autopilot plots the course to ${dest} from a list of turn and move commands and reports how far (Manhattan distance |x| + |y|) the ship ends up from the start. The imposter made the plotter silently ignore some of the moves.\n\nThe official route is preloaded as the Run input (and in route.txt). Fix nav.js, run it on that route, and submit the distance it prints.`,
      workspace: 'MISC',
      runLanguage: 'javascript',
      runEntry: 'nav.js',
      files: [
        { name: 'nav.js', language: 'javascript', content: code(false) },
        { name: 'route.txt', language: 'text', content: route + '\n', readOnly: true },
      ],
      sampleStdin: route + '\n',
      answerFormat: 'Type the single integer printed by the fixed program for the official route. Exact match (tolerance 0).',
      validation: { mode: 'NUMERIC', answer, tolerance: 0 },
      hint: 'In JavaScript, (-90) % 360 is -90, not 270. Which branch handles heading -90?',
      solution: { explanation: `The % operator keeps the sign, so left turns produce negative headings that match no branch and the F moves are dropped. Normalise with ((h - n) % 360 + 360) % 360. The fixed program prints ${answer}.`, files: { 'nav.js': code(true) }, answer: String(answer) },
    };
  },
};

export const imposterTemplates: TaskTemplate[] = [o2Rounding, reactorBsearch, commsMedian, navDrift];
