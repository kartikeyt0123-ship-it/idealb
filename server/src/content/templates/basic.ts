import type { TaskTemplate } from '../types.js';

/**
 * REACTOR / Basic Programming.
 * Pattern reference for authors: parameterise by `v`, keep the bug identical
 * in spirit across variants, change the data so answers differ.
 */

const reactorSum: TaskTemplate = {
  key: 'basic-reactor-sum',
  domain: 'basic',
  difficulty: 'EASY',
  variant: (v) => {
    const sensors = ['power', 'coolant', 'oxygen', 'thrust'][v];
    const starter = `// Reactor ${sensors} monitor
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
    const sets: number[][][] = [
      [[6, 8, 10, 18], [5], [1, 2, 3, 4, 5, 6], [100, -40, 7]],
      [[9, 9, 9, 15], [12], [2, 4, 6, 8, 10], [50, -25, 3, 1]],
      [[11, 3, 20, 7], [8], [3, 1, 4, 1, 5, 9], [70, -10, 2]],
      [[4, 16, 12, 9], [21], [10, 20, 30, 40], [-5, 5, 13, 1]],
    ];
    const tests = sets[v].map((arr, i) => ({
      name: `case-${i + 1}`,
      stdin: `${arr.length}\n${arr.join(' ')}\n`,
      expected: String(arr.reduce((a, b) => a + b, 0)),
    }));
    return {
      title: `Restore the ${sensors} total`,
      statement: `The reactor's ${sensors} monitor is reporting a low total. It reads N sensor readings and must print the sum of every reading — but the last reading never seems to count.\n\nRepair the program so it prints the correct total for any input. Your code is verified against hidden test inputs.`,
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

/** Small deterministic LCG for generating test data (no Math.random). */
function lcg(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const randInt = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

// ---------------------------------------------------------------------------
// EASY (Python): FizzBuzz-style condition order in the O2 vent cycler.
// ---------------------------------------------------------------------------
const o2Cycler: TaskTemplate = {
  key: 'basic-o2-vent-cycler',
  domain: 'basic',
  difficulty: 'EASY',
  variant: (v) => {
    const [a, b, wa, wb] = ([
      [3, 5, 'O2', 'VENT'],
      [4, 6, 'PUMP', 'SEAL'],
      [2, 7, 'TICK', 'HUM'],
      [3, 8, 'SCAN', 'PURGE'],
    ] as const)[v];
    const room = ['O2 room', 'Admin', 'Electrical', 'Medbay'][v];
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
    const lcm = (() => {
      let m = Math.max(a, b);
      while (m % a || m % b) m++;
      return m;
    })();
    const ns = [1, a, lcm, 2 * lcm + 3, 50 + 7 * v];
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
      solution: { explanation: `The "both" check was placed after the single-divisor checks, so it was unreachable. Test divisibility by both ${a} and ${b} first.`, files: { 'main.py': fixed } },
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
  variant: (v) => {
    const ship = ['The Skeld', 'Mira HQ', 'Polus Base', 'The Airship'][v];
    const fnName = ['build_roster', 'assemble_squad', 'collect_crew', 'muster'][v];
    const body = (sig: string, init: string) => `# ${ship} squad roster
# Input: first line Q, then Q lines. Each line lists crew names separated by commas.
# For each squad print:  Squad k: <count> crew -> <NAMES>
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
    print("Squad " + str(k) + ": " + str(len(squad)) + " crew -> " + " ".join(squad))
`;
    const starter = body('names, roster=[]', '');
    const fixed = body('names, roster=None', '    if roster is None:\n        roster = []\n');
    const pool = ['ava', 'Bo', 'cyan', 'Dex', 'echo', 'Finn', 'Gus', 'hana', 'Iris', 'Jax', 'kit', 'Lux', 'Mo', 'nova', 'Orin', 'Pax', 'Quinn', 'rhea', 'Sol', 'Tao'];
    const r = lcg(500 + v);
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
      const expected = squads.map((s, i) => { const n = ref(s); return `Squad ${i + 1}: ${n.length} crew -> ${n.join(' ')}`; }).join('\n');
      return { stdin, expected };
    };
    const raw: string[][] = [
      [squadLine(4 + v)],
      [squadLine(3), squadLine(4), squadLine(2)],
      [`${pool[v]},${pool[v + 1]}`, `${pool[v + 1].toUpperCase()}, ${pool[v + 5]}`],
      [squadLine(5), ' , ,', squadLine(3), squadLine(6)],
      [squadLine(2), squadLine(2), squadLine(7), squadLine(1), squadLine(3)],
    ];
    const tests = raw.map((s, i) => ({ name: `roster-${i + 1}`, ...makeTest(s) }));
    return {
      title: `${ship} rosters keep growing`,
      statement: `Security on ${ship} prints one roster line per squad. Each input line is a squad of comma-separated names; the roster must list that squad's distinct crewmates (case-insensitive), uppercase and sorted.\n\nThe first squad always looks right, but every following squad mysteriously contains crewmates from the earlier squads too. Find out why ${fnName}() remembers old crew and repair main.py. Verified against hidden inputs.`,
      workspace: 'BASIC',
      runLanguage: 'python',
      runEntry: 'main.py',
      files: [{ name: 'main.py', language: 'python', content: starter }],
      sampleStdin: tests[1].stdin,
      answerFormat: 'Submit your repaired main.py. It runs against hidden inputs; stdout must match exactly line by line (trailing whitespace ignored).',
      validation: { mode: 'CODE_TESTS', language: 'python', entry: 'main.py', tests },
      hint: `Python evaluates default argument values once, when the function is defined, not on every call. Look closely at the signature of ${fnName}().`,
      solution: { explanation: 'The default `roster=[]` is a single list shared by every call, so names accumulate across squads. Use `roster=None` and create a fresh list inside the function.', files: { 'main.py': fixed } },
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
  variant: (v) => {
    const sensor = ['hull pressure', 'cryo temperature', 'shield flux', 'cabin pressure'][v];
    const [HI, LO] = ([['PEAK', 'LOW'], ['MAX', 'MIN'], ['HIGH', 'DROP'], ['TOP', 'FLOOR']] as const)[v];
    const code = (fixed: boolean) => `// ${sensor} extremes report
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
    const r = lcg(900 + v);
    const rand = (k: number, lo: number, hi: number) => Array.from({ length: k }, () => randInt(r, lo, hi));
    const sets: number[][] = [
      [12 + v, 48, 7, 30 + v, 19],
      rand(6, -999, -10),
      [-(37 + 11 * v)],
      [0, 0, 5 + v, 0],
      rand(10, -5000, 5000),
      rand(5, 100, 9999),
    ];
    const tests = sets.map((arr, i) => ({ name: `readings-${i + 1}`, stdin: `${arr.length}\n${arr.join(' ')}\n`, expected: ref(arr) }));
    return {
      title: `${sensor} extremes ignore the cold side`,
      statement: `The ${sensor} monitor reports the largest and smallest of N readings, each followed by a CHECK value: the digit sum of the reading's absolute value (so -47 has CHECK 11).\n\nDuring a hull breach every reading went negative and the report printed "${HI} 0" with CHECK 0 for the low side, too. Repair main.js so both lines are correct for any readings, including all-negative ones. Verified against hidden inputs.`,
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
  variant: (v) => {
    const sys = ['launch', 'airlock', 'escape pod', 'cargo bay'][v];
    const code = (fixed: boolean) => `# ${sys} code translator
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
    const r = lcg(1300 + v);
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
    const edge: string[][] = [
      ['4', '9', String(14 + v * 5)],
      ['MCMXCIV', 'xl', String(90 + v)],
      [toRoman(3999 - 444 * v)],
      ['CDXLIV', String(400 + v), 'IX'],
    ];
    const sets = [edge[0], edge[1], edge[2], edge[3], randomTokens(4), randomTokens(6)];
    const tests = sets.map((t, i) => ({ name: `codes-${i + 1}`, stdin: t.join('\n') + '\n', expected: ref(t) }));
    return {
      title: `${sys[0].toUpperCase() + sys.slice(1)} codes translate wrong`,
      statement: `The ${sys} console stores its authorisation codes as Roman numerals, and the crew types some of them as plain numbers. The translator must convert every token in BOTH directions and finish with the TOTAL of all values, written as a Roman numeral.\n\nRoman numerals use subtractive pairs: IV = 4, IX = 9, XL = 40, XC = 90, CD = 400, CM = 900 (so 1994 = MCMXCIV). Right now "IX" decodes to the wrong number and 4 encodes as "IIII". Repair main.py so every conversion is correct for values 1..3999. Verified against hidden inputs.`,
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
