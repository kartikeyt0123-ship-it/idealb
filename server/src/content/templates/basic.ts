import type { TaskTemplate } from '../types.js';

/**
 * REACTOR / Basic Programming.
 * Every template takes ANY non-negative integer seed. Names / words / divisors
 * are chosen by mixed-radix decomposition of the seed (so seeds 0..N-1 give
 * distinct combinations) and the hidden test data comes from a seeded LCG.
 * The bug concept stays identical across seeds; expected outputs are computed
 * by TypeScript reference implementations.
 */

/** Small deterministic LCG for generating test data (no Math.random). */
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

// ---------------------------------------------------------------------------
// EASY (JavaScript): off-by-one loop bound in the reactor monitor.
// ---------------------------------------------------------------------------
const reactorSum: TaskTemplate = {
  key: 'basic-reactor-sum',
  domain: 'basic',
  difficulty: 'EASY',
  variant: (seed) => {
    const SENSORS = ['power', 'coolant', 'oxygen', 'thrust', 'plasma', 'neutron', 'shield', 'turbine'];
    const BAYS = ['Upper', 'Lower', 'North', 'South', 'Aft', 'Fore', 'Core', 'Outer'];
    const [si, bi, ex] = mix(seed, [SENSORS.length, BAYS.length, 1000]);
    const sensors = SENSORS[si];
    const bay = `${BAYS[bi]} bay ${ex > 0 ? `R-${ex}` : 'R'}`;
    const starter = `// ${bay}: reactor ${sensors} monitor
// Input: first line N, second line N space-separated readings.
// Output: the total of ALL readings.
const lines = require('fs').readFileSync(0, 'utf8').trim().split('\\n');
const n = Number(lines[0]);
const readings = lines[1].trim().split(/\\s+/).map(Number);

let total = 0;
for (let i = 0; i < n - 1; i++) {
  total += readings[i];
}
console.log(total);
`;
    const fixed = starter.replace('i < n - 1', 'i < n');
    const r = lcg(SALT(seed, 101));
    const arr = (k: number, lo: number, hi: number) => {
      const a = Array.from({ length: k }, () => randInt(r, lo, hi));
      if (a[a.length - 1] === 0) a[a.length - 1] = randInt(r, 1, 9);
      return a;
    };
    const sets: number[][] = [arr(randInt(r, 4, 6), 1, 40), [randInt(r, 2, 99)], arr(randInt(r, 6, 9), 1, 12), arr(randInt(r, 3, 5), -60, 120), arr(randInt(r, 10, 15), 0, 500)];
    const tests = sets.map((a, i) => ({
      name: `case-${i + 1}`,
      stdin: `${a.length}\n${a.join(' ')}\n`,
      expected: String(a.reduce((x, y) => x + y, 0)),
    }));
    return {
      title: `Restore the ${sensors} total (${BAYS[bi]} bay)`,
      statement: `The ${sensors} monitor in the reactor's ${bay} is reporting a low total. It reads N sensor readings and must print the sum of every reading — but the last reading never seems to count.\n\nRepair the program so it prints the correct total for any input. Your code is verified against hidden test inputs.`,
      workspace: 'BASIC',
      runLanguage: 'javascript',
      runEntry: 'main.js',
      files: [{ name: 'main.js', language: 'javascript', content: starter }],
      sampleStdin: tests[0].stdin,
      answerFormat: 'Submit your repaired code. It runs against hidden inputs; stdout must match exactly (trailing whitespace ignored).',
      validation: { mode: 'CODE_TESTS', language: 'javascript', entry: 'main.js', tests },
      hint: 'There are N readings, but the loop condition stops one index early. Compare the loop bound with N.',
      solution: { explanation: 'Change the loop bound from `i < n - 1` to `i < n` so every reading is added.', files: { 'main.js': fixed } },
    };
  },
};

// ---------------------------------------------------------------------------
// EASY (Python): FizzBuzz-style condition order in the vent cycler.
// ---------------------------------------------------------------------------
/** Divisor pairs (a < b, b not a multiple of a) so "both" is a distinct case. */
const DIV_PAIRS: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let a = 2; a <= 7; a++) for (let b = a + 1; b <= 11; b++) if (b % a !== 0) out.push([a, b]);
  return out;
})();
const VENT_WORDS = ['O2', 'VENT', 'PUMP', 'SEAL', 'TICK', 'HUM', 'SCAN', 'PURGE', 'FLUX', 'GLOW', 'ZAP', 'BEEP', 'WARP', 'DOCK', 'SPIN', 'CORE'];

const o2Cycler: TaskTemplate = {
  key: 'basic-o2-vent-cycler',
  domain: 'basic',
  difficulty: 'EASY',
  variant: (seed) => {
    const ROOMS = ['O2 room', 'Admin', 'Electrical', 'Medbay', 'Storage', 'Navigation', 'Weapons', 'Shields'];
    const [pi, wi, oi, ri] = mix(seed, [DIV_PAIRS.length, VENT_WORDS.length, VENT_WORDS.length - 1, ROOMS.length]);
    const [a, b] = DIV_PAIRS[pi];
    const wa = VENT_WORDS[wi];
    const wb = VENT_WORDS[(wi + 1 + oi) % VENT_WORDS.length]; // offset 1..15, never equal to wa
    const room = ROOMS[(ri + seed) % ROOMS.length];
    const head = `# ${room} vent cycler
# Input: one integer N.
# For every cycle i from 1 to N print exactly one line:
#   "${wa}${wb}" if i is divisible by both ${a} and ${b}
#   "${wa}"   if i is divisible by ${a} only
#   "${wb}"   if i is divisible by ${b} only
#   the number i otherwise
import sys

n = int(sys.stdin.read().split()[0])
for i in range(1, n + 1):
`;
    const starter =
      head +
      `    if i % ${a} == 0:
        print("${wa}")
    elif i % ${b} == 0:
        print("${wb}")
    elif i % ${a} == 0 and i % ${b} == 0:
        print("${wa}${wb}")
    else:
        print(i)
`;
    const fixed =
      head +
      `    if i % ${a} == 0 and i % ${b} == 0:
        print("${wa}${wb}")
    elif i % ${a} == 0:
        print("${wa}")
    elif i % ${b} == 0:
        print("${wb}")
    else:
        print(i)
`;
    const ref = (n: number) => {
      const out: string[] = [];
      for (let i = 1; i <= n; i++) {
        if (i % a === 0 && i % b === 0) out.push(wa + wb);
        else if (i % a === 0) out.push(wa);
        else if (i % b === 0) out.push(wb);
        else out.push(String(i));
      }
      return out.join('\n');
    };
    let lcm = Math.max(a, b);
    while (lcm % a || lcm % b) lcm++;
    const r = lcg(SALT(seed, 202));
    const ns = [1, a, lcm, 2 * lcm + randInt(r, 1, 5), lcm + randInt(r, 10, 60)];
    const tests = ns.map((n, i) => ({ name: `cycle-${i + 1}`, stdin: `${n}\n`, expected: ref(n) }));
    return {
      title: `${room} vent cycler skips the double cycle`,
      statement: `The ${room} vent cycler prints a control word for every cycle from 1 to N. Cycles divisible by ${a} must print "${wa}", cycles divisible by ${b} must print "${wb}", and cycles divisible by BOTH must print "${wa}${wb}". Any other cycle prints its own number.\n\nThe crew noticed the combined "${wa}${wb}" word never appears, so the vents never fully purge. Repair main.py. It reads N from stdin and is verified against hidden values of N.`,
      workspace: 'BASIC',
      runLanguage: 'python',
      runEntry: 'main.py',
      files: [{ name: 'main.py', language: 'python', content: starter }],
      sampleStdin: `${lcm + 2}\n`,
      answerFormat: 'Submit your repaired main.py. It runs against hidden inputs; stdout must match exactly line by line (trailing whitespace ignored).',
      validation: { mode: 'CODE_TESTS', language: 'python', entry: 'main.py', tests },
      hint: 'An if/elif chain stops at the FIRST true condition. Which condition can never be reached in the current order?',
      solution: { explanation: `The "both" check was placed after the single-divisor checks, so it was unreachable (cycle ${lcm} printed "${wa}" instead of "${wa}${wb}"). Test divisibility by both ${a} and ${b} first.`, files: { 'main.py': fixed } },
    };
  },
};

// ---------------------------------------------------------------------------
// MEDIUM (Python): mutable default argument leaks crew between squads.
// ---------------------------------------------------------------------------
const squadRoster: TaskTemplate = {
  key: 'basic-squad-roster',
  domain: 'basic',
  difficulty: 'MEDIUM',
  variant: (seed) => {
    const SHIPS = ['The Skeld', 'Mira HQ', 'Polus Base', 'The Airship', 'The Fungle', 'Dleks Station', 'Orbital Dock 9', 'Outpost Kepler'];
    const FNS = ['build_roster', 'assemble_squad', 'collect_crew', 'muster', 'gather_team', 'enlist', 'form_squad', 'roll_call'];
    const [shi, fi, ex] = mix(seed, [SHIPS.length, FNS.length, 1000]);
    const ship = SHIPS[shi];
    const fnName = FNS[fi];
    const squadWord = ex === 0 ? 'Squad' : ['Squad', 'Team', 'Unit', 'Crew'][ex % 4];
    const body = (sig: string, init: string) => `# ${ship} squad roster
# Input: first line Q, then Q lines. Each line lists crew names separated by commas.
# For each squad print:  ${squadWord} k: <count> crew -> <NAMES>
# where NAMES are the squad's distinct names, UPPERCASE, sorted A-Z, separated by spaces.
# Names are case-insensitive ("kit" and "KIT" are the same crewmate); blank entries are ignored.
import sys


def ${fnName}(${sig}):
${init}    for raw in names:
        name = raw.strip().upper()
        if name and name not in roster:
            roster.append(name)
    return roster


lines = sys.stdin.read().splitlines()
q = int(lines[0])
for k in range(1, q + 1):
    squad = ${fnName}(lines[k].split(","))
    squad.sort()
    print("${squadWord} " + str(k) + ": " + str(len(squad)) + " crew -> " + " ".join(squad))
`;
    const starter = body('names, roster=[]', '');
    const fixed = body('names, roster=None', '    if roster is None:\n        roster = []\n');
    const pool = ['ava', 'Bo', 'cyan', 'Dex', 'echo', 'Finn', 'Gus', 'hana', 'Iris', 'Jax', 'kit', 'Lux', 'Mo', 'nova', 'Orin', 'Pax', 'Quinn', 'rhea', 'Sol', 'Tao', 'Uma', 'Vex', 'wren', 'Yuki'];
    const r = lcg(SALT(seed, 303));
    const caseFlip = (s: string) => (r() < 0.4 ? s.toUpperCase() : r() < 0.5 ? s.toLowerCase() : s);
    const squadLine = (size: number) => {
      const parts: string[] = [];
      for (let i = 0; i < size; i++) {
        const nm = caseFlip(pool[randInt(r, 0, pool.length - 1)]);
        parts.push((r() < 0.3 ? ' ' : '') + nm + (r() < 0.3 ? ' ' : ''));
      }
      if (size > 2 && r() < 0.5) parts.splice(1, 0, ' ');
      return parts.join(',');
    };
    const ref = (line: string) => {
      const out: string[] = [];
      for (const raw of line.split(',')) {
        const n = raw.trim().toUpperCase();
        if (n && !out.includes(n)) out.push(n);
      }
      return out.sort();
    };
    const makeTest = (squads: string[]) => {
      const stdin = `${squads.length}\n${squads.join('\n')}\n`;
      const expected = squads.map((s, i) => { const n = ref(s); return `${squadWord} ${i + 1}: ${n.length} crew -> ${n.join(' ')}`; }).join('\n');
      return { stdin, expected };
    };
    // Guaranteed leak witness: squad 2 never contains squad 1's first name.
    const pa = seed % pool.length;
    const pb = (pa + 1 + (Math.floor(seed / pool.length) % 7)) % pool.length;
    const pc = (pb + 3 + (seed % 5)) % pool.length === pa ? (pb + 2) % pool.length : (pb + 3 + (seed % 5)) % pool.length;
    const raw: string[][] = [
      [squadLine(randInt(r, 3, 7))],
      [squadLine(3), squadLine(4), squadLine(2)],
      [`${pool[pa]},${pool[pb]}`, `${pool[pb].toUpperCase()}, ${pool[pc]}`],
      [squadLine(5), ' , ,', squadLine(3), squadLine(6)],
      [squadLine(2), squadLine(2), squadLine(7), squadLine(1), squadLine(3)],
    ];
    const tests = raw.map((s, i) => ({ name: `roster-${i + 1}`, ...makeTest(s) }));
    return {
      title: `${ship} rosters keep growing`,
      statement: `Security on ${ship} prints one roster line per squad ("${squadWord} k: ..."). Each input line is a squad of comma-separated names; the roster must list that squad's distinct crewmates (case-insensitive), uppercase and sorted.\n\nThe first squad always looks right, but every following squad mysteriously contains crewmates from the earlier squads too. Find out why ${fnName}() remembers old crew and repair main.py. Verified against hidden inputs.`,
      workspace: 'BASIC',
      runLanguage: 'python',
      runEntry: 'main.py',
      files: [{ name: 'main.py', language: 'python', content: starter }],
      sampleStdin: tests[1].stdin,
      answerFormat: 'Submit your repaired main.py. It runs against hidden inputs; stdout must match exactly line by line (trailing whitespace ignored).',
      validation: { mode: 'CODE_TESTS', language: 'python', entry: 'main.py', tests },
      hint: `Python evaluates default argument values once, when the function is defined, not on every call. Look closely at the signature of ${fnName}().`,
      solution: { explanation: `The default \`roster=[]\` is a single list shared by every call of ${fnName}(), so names accumulate across squads. Use \`roster=None\` and create a fresh list inside the function.`, files: { 'main.py': fixed } },
    };
  },
};

// ---------------------------------------------------------------------------
// MEDIUM (JavaScript): max/min and digit sums break on negative readings.
// ---------------------------------------------------------------------------
const hullExtremes: TaskTemplate = {
  key: 'basic-hull-extremes',
  domain: 'basic',
  difficulty: 'MEDIUM',
  variant: (seed) => {
    const SENSORS = ['hull pressure', 'cryo temperature', 'shield flux', 'cabin pressure', 'engine vibration', 'antenna drift', 'fuel line pressure', 'gravity field'];
    const LABELS: [string, string][] = [['PEAK', 'LOW'], ['MAX', 'MIN'], ['HIGH', 'DROP'], ['TOP', 'FLOOR'], ['UPPER', 'LOWER'], ['CREST', 'TROUGH'], ['SUMMIT', 'BASE'], ['HI', 'LO']];
    const [si, li, ex] = mix(seed, [SENSORS.length, LABELS.length, 1000]);
    const sensor = SENSORS[si];
    const [HI, LO] = LABELS[li];
    const deck = `deck ${String.fromCharCode(65 + (ex % 26))}${ex >= 26 ? Math.floor(ex / 26) : ''}`;
    const code = (fixed: boolean) => `// ${sensor} extremes report (${deck})
// Input: first value N, then N integer readings (may be negative), whitespace separated.
// Output two lines:
//   ${HI} <largest reading> CHECK <digit sum of |largest|>
//   ${LO} <smallest reading> CHECK <digit sum of |smallest|>
// Example: reading -47 has digit sum 11.
const data = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);
const n = data[0];
const readings = data.slice(1, n + 1);

function digitSum(x) {
${fixed ? '  x = Math.abs(x);\n' : ''}  let s = 0;
  while (x > 0) {
    s += x % 10;
    x = Math.floor(x / 10);
  }
  return s;
}

let high = ${fixed ? 'readings[0]' : '0'};
let low = readings[0];
for (const r of readings) {
  if (r > high) high = r;
  if (r < low) low = r;
}
console.log('${HI} ' + high + ' CHECK ' + digitSum(high));
console.log('${LO} ' + low + ' CHECK ' + digitSum(low));
`;
    const ds = (x: number) => String(Math.abs(x)).split('').reduce((s, c) => s + Number(c), 0);
    const ref = (arr: number[]) => {
      const hi = Math.max(...arr);
      const lo = Math.min(...arr);
      return `${HI} ${hi} CHECK ${ds(hi)}\n${LO} ${lo} CHECK ${ds(lo)}`;
    };
    const r = lcg(SALT(seed, 404));
    const rand = (k: number, lo: number, hi: number) => Array.from({ length: k }, () => randInt(r, lo, hi));
    const sets: number[][] = [
      rand(5, 1, 99),
      rand(randInt(r, 4, 8), -999, -10),
      [-randInt(r, 11, 9999)],
      [0, 0, randInt(r, 1, 9), 0],
      rand(10, -5000, 5000),
      rand(5, 100, 9999),
    ];
    const tests = sets.map((arr, i) => ({ name: `readings-${i + 1}`, stdin: `${arr.length}\n${arr.join(' ')}\n`, expected: ref(arr) }));
    return {
      title: `${sensor[0].toUpperCase() + sensor.slice(1)} extremes ignore the cold side`,
      statement: `The ${sensor} monitor on ${deck} reports the largest and smallest of N readings, each followed by a CHECK value: the digit sum of the reading's absolute value (so -47 has CHECK 11).\n\nDuring a hull breach every reading went negative and the report printed "${HI} 0" with CHECK 0 for the low side, too. Repair main.js so both lines are correct for any readings, including all-negative ones. Verified against hidden inputs.`,
      workspace: 'BASIC',
      runLanguage: 'javascript',
      runEntry: 'main.js',
      files: [{ name: 'main.js', language: 'javascript', content: code(false) }],
      sampleStdin: tests[1].stdin,
      answerFormat: 'Submit your repaired main.js. It runs against hidden inputs; stdout must match exactly (trailing whitespace ignored).',
      validation: { mode: 'CODE_TESTS', language: 'javascript', entry: 'main.js', tests },
      hint: 'Two things assume readings are positive: the starting value of the running maximum, and the loop condition inside digitSum().',
      solution: { explanation: 'Start the maximum at readings[0] instead of 0, and take Math.abs(x) at the start of digitSum so negative values are summed correctly.', files: { 'main.js': code(true) } },
    };
  },
};

// ---------------------------------------------------------------------------
// HARD (Python): Roman numeral codes with subtractive pairs, both directions.
// ---------------------------------------------------------------------------
const ROMAN: [number, string][] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];
function toRoman(n: number): string {
  let out = '';
  for (const [val, sym] of ROMAN) while (n >= val) { out += sym; n -= val; }
  return out;
}
function fromRoman(s: string): number {
  const V: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let t = 0;
  for (let i = 0; i < s.length; i++) {
    const c = V[s[i]];
    const nx = i + 1 < s.length ? V[s[i + 1]] : 0;
    t += c < nx ? -c : c;
  }
  return t;
}

const romanCodes: TaskTemplate = {
  key: 'basic-roman-launch-codes',
  domain: 'basic',
  difficulty: 'HARD',
  variant: (seed) => {
    const SYSTEMS = ['launch', 'airlock', 'escape pod', 'cargo bay', 'shuttle bay', 'armory', 'vault', 'docking clamp'];
    const CONSOLES = ['primary', 'backup', 'bridge', 'auxiliary', 'emergency', 'remote', 'legacy', 'field'];
    const [si, ci, ex] = mix(seed, [SYSTEMS.length, CONSOLES.length, 1000]);
    const sys = SYSTEMS[si];
    const consoleName = `${CONSOLES[ci]} console${ex ? ` #${ex + 1}` : ''}`;
    const code = (fixed: boolean) => `# ${sys} code translator (${consoleName})
# Input: whitespace-separated tokens. Each token is either a decimal number (1..3999)
# or a Roman numeral (any letter case).
# For each token print:  <token> = <converted value>
#   decimal -> Roman numeral (uppercase, standard subtractive form, e.g. 1994 -> MCMXCIV)
#   Roman   -> decimal
# Finally print:  TOTAL = <Roman numeral of the sum of all token values>
import sys

VALUES = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
PAIRS = [
${fixed
      ? '    (1000, "M"), (900, "CM"), (500, "D"), (400, "CD"),\n    (100, "C"), (90, "XC"), (50, "L"), (40, "XL"),\n    (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I"),'
      : '    (1000, "M"), (500, "D"), (100, "C"), (50, "L"),\n    (10, "X"), (5, "V"), (1, "I"),'}
]


def to_int(s):
    total = 0
    for i in range(len(s)):
        v = VALUES[s[i]]
        if i > 0 and VALUES[s[i - 1]] < v:
            total += v - ${fixed ? '2 * ' : ''}VALUES[s[i - 1]]
        else:
            total += v
    return total


def to_roman(n):
    out = ""
    for value, sym in PAIRS:
        while n >= value:
            out += sym
            n -= value
    return out


total = 0
for token in sys.stdin.read().split():
    if token.isdigit():
        n = int(token)
        print(token + " = " + to_roman(n))
    else:
        n = to_int(token.upper())
        print(token + " = " + str(n))
    total += n
print("TOTAL = " + to_roman(total))
`;
    const ref = (tokens: string[]) => {
      let total = 0;
      const out: string[] = [];
      for (const t of tokens) {
        if (/^\d+$/.test(t)) { const n = Number(t); out.push(`${t} = ${toRoman(n)}`); total += n; }
        else { const n = fromRoman(t.toUpperCase()); out.push(`${t} = ${n}`); total += n; }
      }
      out.push(`TOTAL = ${toRoman(total)}`);
      return out.join('\n');
    };
    const r = lcg(SALT(seed, 505));
    const randomTokens = (k: number) => {
      const out: string[] = [];
      for (let i = 0; i < k; i++) {
        const n = randInt(r, 1, Math.floor(3999 / k));
        const asRoman = r() < 0.5;
        const rs = toRoman(n);
        out.push(asRoman ? (r() < 0.3 ? rs.toLowerCase() : rs) : String(n));
      }
      return out;
    };
    // Values whose Roman form needs subtractive pairs (contain a 4 or 9 digit).
    const subtractive = () => {
      for (;;) {
        const n = randInt(r, 1, 1999);
        if (/[49]/.test(String(n))) return n;
      }
    };
    const s1 = subtractive();
    const s2 = subtractive();
    const s3 = subtractive();
    const edge: string[][] = [
      [String([4, 9, 40, 90, 400, 900][seed % 6]), String(s1), String(randInt(r, 10, 99))],
      [toRoman(s2), toRoman(randInt(r, 30, 49)).toLowerCase(), String(randInt(r, 90, 99))],
      [toRoman(randInt(r, 2000, 3999))],
      [toRoman(s3), String(randInt(r, 400, 499)), 'IX'],
    ];
    const sets = [edge[0], edge[1], edge[2], edge[3], randomTokens(4), randomTokens(6)];
    const tests = sets.map((t, i) => ({ name: `codes-${i + 1}`, stdin: t.join('\n') + '\n', expected: ref(t) }));
    return {
      title: `${sys[0].toUpperCase() + sys.slice(1)} codes translate wrong`,
      statement: `The ${sys} ${consoleName} stores its authorisation codes as Roman numerals, and the crew types some of them as plain numbers. The translator must convert every token in BOTH directions and finish with the TOTAL of all values, written as a Roman numeral.\n\nRoman numerals use subtractive pairs: IV = 4, IX = 9, XL = 40, XC = 90, CD = 400, CM = 900 (so 1994 = MCMXCIV). Right now "IX" decodes to the wrong number and 4 encodes as "IIII". Repair main.py so every conversion is correct for values 1..3999. Verified against hidden inputs.`,
      workspace: 'BASIC',
      runLanguage: 'python',
      runEntry: 'main.py',
      files: [{ name: 'main.py', language: 'python', content: code(false) }],
      sampleStdin: tests[1].stdin,
      answerFormat: 'Submit your repaired main.py. It runs against hidden inputs; stdout must match exactly line by line (trailing whitespace ignored).',
      validation: { mode: 'CODE_TESTS', language: 'python', entry: 'main.py', tests },
      hint: 'Two separate bugs. Decoding: when a smaller symbol precedes a larger one, it was ALREADY added on the previous step. Encoding: the greedy table needs every subtractive pair, not just the seven base symbols.',
      solution: {
        explanation: 'to_int must subtract the previous symbol twice (it was already added once): total += v - 2 * prev. to_roman needs the subtractive pairs 900, 400, 90, 40, 9, 4 in the greedy table.',
        files: { 'main.py': code(true) },
      },
    };
  },
};

export const basicTemplates: TaskTemplate[] = [reactorSum, o2Cycler, squadRoster, hullExtremes, romanCodes];
