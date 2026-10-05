import type { TaskTemplate } from '../types.js';

/**
 * STORAGE / Miscellaneous.
 * Puzzles and small fixes. Every template accepts ANY non-negative integer
 * seed: names / messages / formats come from mixed-radix digits of the seed,
 * data from a seeded LCG. Every answer and expected output is computed here
 * in TypeScript, never typed by hand.
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
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const NATO = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa'];

// ---------------------------------------------------------------------------
// EASY: Caesar-shifted ship log.
// ---------------------------------------------------------------------------
const CIPHER_ROOMS = ['ELECTRICAL', 'NAVIGATION', 'SHIELDS', 'SECURITY', 'STORAGE', 'MEDBAY', 'ADMIN', 'WEAPONS', 'REACTOR', 'CAFETERIA', 'COMMUNICATIONS', 'OXYGEN'];
const CIPHER_EVENTS = ['REACTOR DRILL', 'LIGHTS WENT OUT', 'LAST MEETING', 'OXYGEN ALARM', 'COMMS BLACKOUT', 'DOOR LOCKDOWN', 'CARD SWIPE', 'ASTEROID STORM'];
const CIPHER_TIMES = ['MIDNIGHT', 'DAWN', 'NOON', 'THE NEXT MEETING', 'SHIFT CHANGE', 'LIGHTS OUT', 'DOCKING', 'LAUNCH'];
const CIPHER_COLOURS = ['RED', 'BLUE', 'GREEN', 'PINK', 'ORANGE', 'YELLOW', 'BLACK', 'WHITE'];
const CIPHER_TEMPLATES: ((r: string, r2: string, e: string, t: string, c: string) => string)[] = [
  (r, _r2, e) => `MEET IN ${r} AFTER THE ${e}`,
  (r, r2) => `THE IMPOSTER VENTED FROM ${r} TO ${r2}`,
  (r, _r2, _e, t) => `CHECK THE CAMERAS IN ${r} BEFORE ${t}`,
  (r, _r2, _e, _t, c) => `THE WIRING TASK IN ${r} IS A TRAP SET BY ${c}`,
  (r, _r2, _e, t) => `DO NOT WALK ALONE TO ${r} AT ${t}`,
  (r, _r2, e, _t, c) => `I SAW ${c} LEAVE ${r} RIGHT BEFORE THE ${e}`,
];

const caesarLog: TaskTemplate = {
  key: 'misc-caesar-ship-log',
  domain: 'misc',
  difficulty: 'EASY',
  variant: (seed) => {
    const [ri, ti, xi, yi] = mix(seed, [CIPHER_ROOMS.length, CIPHER_TEMPLATES.length, 8, 8]);
    const room = CIPHER_ROOMS[ri];
    const room2 = CIPHER_ROOMS[(ri + 1 + xi) % CIPHER_ROOMS.length];
    const plain = CIPHER_TEMPLATES[ti](room, room2, CIPHER_EVENTS[(xi + yi) % 8], CIPHER_TIMES[(xi + 3 * yi) % 8], CIPHER_COLOURS[(ri + xi + yi) % 8]);
    const shift = 1 + ((seed * 11 + Math.floor(seed / 25)) % 25); // 1..25
    const OFFICERS = ['Lt. Cyan', 'Cmdr. Lime', 'Ens. Pink', 'Capt. Brown', 'Sgt. Tan', 'Dr. Coral', 'Adm. Maroon', 'Cpl. Rose'];
    const FOUND = ['Storage', 'a vent in Admin', 'the Medbay scanner', 'the Cafeteria table', 'the Reactor console', 'a crate in Cargo', 'the Comms desk', 'an escape pod'];
    const [oi, fi] = mix(seed, [OFFICERS.length, FOUND.length]);
    const officer = OFFICERS[oi];
    const enc = (s: string) => s.replace(/[A-Z]/g, (c) => LETTERS[(LETTERS.indexOf(c) + shift) % 26]);
    const log = `=== PRIVATE LOG: ${officer} ===
CIPHER NOTE: every letter was shifted FORWARD by ${shift} positions in the alphabet
(Z wraps around to A). Spaces were left untouched.

${enc(plain)}

=== END OF LOG ===
`;
    return {
      title: `Decode ${officer}'s private log`,
      statement: `A private log written by ${officer} was found in ${FOUND[fi]}. It is protected by a simple rotation cipher: each letter was moved forward by a fixed number of places in the alphabet before it was saved. The cipher note at the top of log.txt tells you the shift.\n\nDecode the hidden message and submit the plain English sentence.`,
      workspace: 'MISC',
      runLanguage: null,
      files: [{ name: 'log.txt', language: 'text', content: log, readOnly: true }],
      answerFormat: 'Type the decoded sentence (words separated by spaces). Comparison is case-insensitive; extra spaces between words are ignored.',
      validation: { mode: 'EXACT_TEXT', answer: plain, caseSensitive: false, collapseWhitespace: true },
      hint: `To decode, move every letter BACK by ${shift} places (A goes back to the end of the alphabet), or equivalently FORWARD by ${26 - shift}.`,
      solution: { explanation: `Shift each letter back by ${shift}: "${enc(plain)}" decodes to "${plain}".`, answer: plain },
    };
  },
};

// ---------------------------------------------------------------------------
// EASY: hex / binary signal frames.
// ---------------------------------------------------------------------------
const CODEWORDS = ['CAFETERIA', 'O2FILTER', 'MEDSCAN', 'UPPERENGINE', 'LOWERDECK', 'NAVCOM', 'SHIELDGEN', 'REACTOR', 'ADMINCARD', 'WEAPONS', 'STORAGE', 'SECURITY', 'COMMS', 'SPECIMEN', 'DROPSHIP', 'VAULT'];

const signalFrames: TaskTemplate = {
  key: 'misc-signal-frames',
  domain: 'misc',
  difficulty: 'EASY',
  variant: (seed) => {
    // (seed % 16, seed % 9) are jointly distinct for 144 consecutive seeds.
    const word = CODEWORDS[seed % CODEWORDS.length] + String((seed % 9) + 1);
    const binary = (seed + Math.floor(seed / 16)) % 2 === 1;
    const relay = `${NATO[seed % NATO.length]}-${10 + ((seed * 7) % 90)}`;
    const r = lcg(SALT(seed, 606));
    const fmt = (n: number) => (binary ? n.toString(2).padStart(8, '0') : n.toString(16).toUpperCase().padStart(2, '0'));
    const lines: string[] = [];
    let t = randInt(r, 100, 900);
    for (const ch of word) {
      const noise = randInt(r, 0, 2);
      for (let i = 0; i < noise; i++) lines.push(`[t=${String(t++).padStart(4, '0')}] PING ${fmt(randInt(r, 33, 126))}`);
      lines.push(`[t=${String(t++).padStart(4, '0')}] DATA ${fmt(ch.charCodeAt(0))}`);
    }
    lines.push(`[t=${String(t++).padStart(4, '0')}] PING ${fmt(randInt(r, 33, 126))}`);
    const enc = binary ? '8-bit binary' : 'two-digit hexadecimal';
    const log = `COMMS CAPTURE - relay ${relay}
Each frame carries one byte written in ${enc}.
PING frames are keep-alive noise. DATA frames carry ASCII characters of the codeword, in order.

${lines.join('\n')}
`;
    return {
      title: `Decode relay ${relay}'s codeword`,
      statement: `Comms intercepted a burst from relay ${relay} (see log.txt). Every frame holds one byte in ${enc}. Ignore the PING keep-alive frames; the DATA frames, read in order and converted to ASCII characters, spell a room codeword followed by a digit.\n\nSubmit the codeword.`,
      workspace: 'MISC',
      runLanguage: null,
      files: [{ name: 'log.txt', language: 'text', content: log, readOnly: true }],
      answerFormat: 'Type the codeword (letters and digits, no spaces). Comparison is case-insensitive.',
      validation: { mode: 'EXACT_TEXT', answer: word, caseSensitive: false, collapseWhitespace: true },
      hint: binary
        ? 'Convert each 8-bit DATA byte to decimal (e.g. 01000001 = 65) and look it up in an ASCII table (65 = A, 48 = 0).'
        : 'Convert each DATA hex byte to decimal (e.g. 41 hex = 65) and look it up in an ASCII table (65 = A, 48 = 0).',
      solution: { explanation: `Drop the PING frames; the ${word.length} DATA bytes (${enc}) decode to ${word}.`, answer: word },
    };
  },
};

// ---------------------------------------------------------------------------
// MEDIUM (JavaScript): crew-ID regex validator.
// ---------------------------------------------------------------------------
const crewIdRegex: TaskTemplate = {
  key: 'misc-crew-id-regex',
  domain: 'misc',
  difficulty: 'MEDIUM',
  variant: (seed) => {
    const SEPS = ['-', '_', ':', '#', '@', '~'];
    const SHIPS = ['The Skeld', 'Mira HQ', 'Polus', 'The Airship', 'The Fungle', 'Dleks', 'Kepler Dock', 'Orion Relay'];
    const [pi, si, di, shi] = mix(seed, [3, SEPS.length, 5, SHIPS.length]);
    const P = 2 + pi;
    const SEP = SEPS[si];
    const D = 2 + di;
    const ship = SHIPS[(shi + seed) % SHIPS.length];
    const re = new RegExp(`^[A-Z]{${P}}${SEP}\\d{${D}}$`);
    const code = (fixed: boolean) => `// ${ship} crew-ID scanner
// A valid crew ID is EXACTLY: ${P} uppercase letters A-Z, then "${SEP}", then ${D} digits.
// Nothing may come before or after it. Example: ${'ABCD'.slice(0, P)}${SEP}${'1234567'.slice(0, D)}
// Input: one ID per line. Output per non-empty line: <ID> VALID   or   <ID> INVALID
const lines = require('fs').readFileSync(0, 'utf8').split('\\n');
const CREW_ID = ${fixed ? `/^[A-Z]{${P}}${SEP}\\d{${D}}$/` : `/[A-z]{${P}}${SEP}\\d{${D}}/`};

for (const raw of lines) {
  const id = raw.trim();
  if (id === '') continue;
  console.log(id + ' ' + (CREW_ID.test(id) ? 'VALID' : 'INVALID'));
}
`;
    const r = lcg(SALT(seed, 707));
    const letters = (n: number) => Array.from({ length: n }, () => LETTERS[randInt(r, 0, 25)]).join('');
    const digits = (n: number) => Array.from({ length: n }, () => String(randInt(r, 0, 9))).join('');
    const valid = () => letters(P) + SEP + digits(D);
    const otherSep = SEP === '-' ? '_' : '-';
    const gens: (() => string)[] = [
      valid,
      () => letters(P).toLowerCase() + SEP + digits(D),
      () => valid() + String(randInt(r, 0, 9)),
      () => 'X' + valid(),
      () => { const l = letters(P); const k = randInt(r, 0, P - 1); return l.slice(0, k) + ['^', '[', '_', ']'][randInt(r, 0, 3)] + l.slice(k + 1) + SEP + digits(D); },
      () => letters(P) + SEP + digits(D - 1),
      () => letters(P) + otherSep + digits(D),
      () => letters(P - 1) + SEP + digits(D),
      valid,
    ];
    const makeTest = (ids: string[]) => ({
      stdin: ids.join('\n') + '\n',
      expected: ids.map((id) => `${id} ${re.test(id) ? 'VALID' : 'INVALID'}`).join('\n'),
    });
    const sets: string[][] = [
      [valid(), valid(), gens[5](), gens[6]()],
      [valid(), gens[2](), gens[3](), valid()], // gens[3] is always accepted by the buggy pattern
      [gens[1](), gens[4](), valid(), gens[4]()],
      Array.from({ length: 10 }, () => gens[randInt(r, 0, gens.length - 1)]()),
      gens.map((g) => g()),
    ];
    const tests = sets.map((ids, i) => ({ name: `ids-${i + 1}`, ...makeTest(ids) }));
    return {
      title: `${ship} ID scanner lets imposters in`,
      statement: `The ${ship} door scanner validates crew IDs with a regular expression. A valid ID is exactly ${P} uppercase letters (A-Z), then the separator "${SEP}", then exactly ${D} digits, with nothing before or after it.\n\nAn imposter walked in with a lowercase badge and another with extra characters glued on, and the scanner said VALID for both. Fix the regular expression in main.js so it accepts exactly the valid IDs and nothing else. Verified against hidden ID lists.`,
      workspace: 'MISC',
      runLanguage: 'javascript',
      runEntry: 'main.js',
      files: [{ name: 'main.js', language: 'javascript', content: code(false) }],
      sampleStdin: sets[4].join('\n') + '\n',
      answerFormat: 'Submit your repaired main.js. It runs against hidden inputs; stdout must match exactly (trailing whitespace ignored).',
      validation: { mode: 'CODE_TESTS', language: 'javascript', entry: 'main.js', tests },
      hint: 'A regex without anchors matches anywhere inside the string. Also check the character range A-z in an ASCII table: what lives between Z and a?',
      solution: { explanation: `Anchor the pattern with ^ and $ and use [A-Z] instead of [A-z]: /^[A-Z]{${P}}${SEP}\\d{${D}}$/.`, files: { 'main.js': code(true) } },
    };
  },
};

// ---------------------------------------------------------------------------
// MEDIUM (Python): Luhn checksum on access badges.
// ---------------------------------------------------------------------------
function luhnOk(code: string): boolean {
  const d = code.replace(/\D/g, '').split('').map(Number);
  let sum = 0;
  for (let i = d.length - 1, k = 0; i >= 0; i--, k++) {
    let x = d[i];
    if (k % 2 === 1) { x *= 2; if (x > 9) x -= 9; }
    sum += x;
  }
  return sum % 10 === 0;
}
/** The starter's (buggy) rule: doubles every second digit counted from the LEFT. */
function luhnBuggy(code: string): boolean {
  const d = code.replace(/\D/g, '').split('').map(Number);
  let sum = 0;
  d.forEach((x, i) => { if (i % 2 === 1) { x *= 2; if (x > 9) x -= 9; } sum += x; });
  return sum % 10 === 0;
}
function luhnCheckDigit(payload: string): string {
  for (let c = 0; c <= 9; c++) if (luhnOk(payload + c)) return String(c);
  throw new Error('unreachable');
}

const badgeLuhn: TaskTemplate = {
  key: 'misc-badge-checksum',
  domain: 'misc',
  difficulty: 'MEDIUM',
  variant: (seed) => {
    const VERDICTS: [string, string][] = [['ACCEPT', 'REJECT'], ['OPEN', 'LOCKED'], ['GRANTED', 'DENIED'], ['PASS', 'FAIL'], ['CLEAR', 'BLOCKED'], ['ALLOW', 'REFUSE'], ['VALID', 'FORGED'], ['ENTER', 'HALT']];
    const DOORS = ['Admin', 'Reactor', 'Navigation', 'Security', 'Medbay', 'Electrical', 'Weapons', 'Storage'];
    const [vi, di, ex] = mix(seed, [VERDICTS.length, DOORS.length, 1000]);
    const [OK, NO] = VERDICTS[vi];
    const door = `${DOORS[di]}${ex ? ` ${String.fromCharCode(65 + (ex % 26))}${Math.floor(ex / 26) || ''}` : ''}`;
    const code = (fixed: boolean) => `# ${door} door badge checker (Luhn checksum)
# Input: one badge number per line (may contain spaces between digit groups).
# Output per non-empty line:  <badge> -> ${OK}   or   <badge> -> ${NO}
#
# Luhn rule: starting from the RIGHTMOST digit (the check digit) and moving left,
# double every second digit; if doubling gives more than 9, subtract 9.
# The badge is valid when the sum of all resulting digits is divisible by 10.
import sys


def badge_ok(code):
    digits = [int(c) for c in code if c.isdigit()]
${fixed ? '    digits.reverse()\n' : ''}    total = 0
    for i, d in enumerate(digits):
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


for line in sys.stdin.read().splitlines():
    line = line.strip()
    if not line:
        continue
    print(line + " -> " + ("${OK}" if badge_ok(line) else "${NO}"))
`;
    const r = lcg(SALT(seed, 808));
    const badge = (len: number, makeValid: boolean, spaced: boolean) => {
      let p = '';
      for (let i = 0; i < len - 1; i++) p += String(randInt(r, i === 0 ? 1 : 0, 9));
      const cd = luhnCheckDigit(p);
      const last = makeValid ? cd : String((Number(cd) + randInt(r, 1, 9)) % 10);
      const full = p + last;
      return spaced ? (full.match(/.{1,4}/g) ?? [full]).join(' ') : full;
    };
    /** A genuine 16-digit badge that the buggy left-to-right rule rejects. */
    const witness = () => {
      for (;;) {
        const b = badge(16, true, true);
        if (!luhnBuggy(b)) return b;
      }
    };
    const ref = (lines: string[]) => lines.map((l) => `${l} -> ${luhnOk(l) ? OK : NO}`).join('\n');
    const sets: string[][] = [
      [badge(9, true, false), badge(11, false, false), badge(7, true, false)],
      [witness(), badge(16, false, true), badge(12, true, false)],
      [badge(10, true, false), badge(8, true, false), badge(14, false, false)],
      Array.from({ length: 8 }, (_, i) => badge(randInt(r, 6, 16), i % 3 !== 0, r() < 0.3)),
      Array.from({ length: 6 }, (_, i) => badge(8 + 2 * i, i % 2 === 0, false)),
    ];
    const tests = sets.map((s, i) => ({ name: `badges-${i + 1}`, stdin: s.join('\n') + '\n', expected: ref(s) }));
    return {
      title: `${door} door rejects real crew`,
      statement: `The ${door} door checks each badge number with the Luhn checksum and prints ${OK} or ${NO}. Strangely, it works for some badges but rejects genuine crewmates holding 16-digit badges and lets forged ones through.\n\nThe Luhn rule counts positions from the RIGHT end of the number (the check digit). Fix badge_ok() in main.py so it gives the right verdict for badges of every length, with or without spaces between digit groups. Verified against hidden badge lists.`,
      workspace: 'MISC',
      runLanguage: 'python',
      runEntry: 'main.py',
      files: [{ name: 'main.py', language: 'python', content: code(false) }],
      sampleStdin: tests[1].stdin,
      answerFormat: 'Submit your repaired main.py. It runs against hidden inputs; stdout must match exactly line by line (trailing whitespace ignored).',
      validation: { mode: 'CODE_TESTS', language: 'python', entry: 'main.py', tests },
      hint: 'The loop counts positions from the LEFT. That only matches the rule when the number has an odd number of digits.',
      solution: { explanation: 'Doubling must start from the second digit counted from the right. Reverse the digit list (or use (len - 1 - i) % 2 == 1) before applying the i % 2 == 1 test.', files: { 'main.py': code(true) } },
    };
  },
};

// ---------------------------------------------------------------------------
// HARD: two-imposter logic deduction, solver-verified unique.
// ---------------------------------------------------------------------------
type Claim =
  | { kind: 'not'; x: number }
  | { kind: 'exactlyOne'; x: number; y: number }
  | { kind: 'atLeastOne'; x: number; y: number }
  | { kind: 'neither'; x: number; y: number }
  | { kind: 'same'; x: number; y: number };

function claimTrue(c: Claim, imp: Set<number>): boolean {
  switch (c.kind) {
    case 'not': return !imp.has(c.x);
    case 'exactlyOne': return imp.has(c.x) !== imp.has(c.y);
    case 'atLeastOne': return imp.has(c.x) || imp.has(c.y);
    case 'neither': return !imp.has(c.x) && !imp.has(c.y);
    case 'same': return imp.has(c.x) === imp.has(c.y);
  }
}
function claimText(c: Claim, names: string[]): string {
  switch (c.kind) {
    case 'not': return `${names[c.x]} is not an imposter.`;
    case 'exactlyOne': return `Exactly one of ${names[c.x]} and ${names[c.y]} is an imposter.`;
    case 'atLeastOne': return `At least one of ${names[c.x]} and ${names[c.y]} is an imposter.`;
    case 'neither': return `Neither ${names[c.x]} nor ${names[c.y]} is an imposter.`;
    case 'same': return `${names[c.x]} and ${names[c.y]} are on the same side (both crew or both imposters).`;
  }
}
type Said = { speaker: number; claim: Claim };
function consistentPairs(n: number, said: Said[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const imp = new Set([i, j]);
      if (said.every((s) => claimTrue(s.claim, imp) === !imp.has(s.speaker))) out.push([i, j]);
    }
  return out;
}

const MEETING_COLOURS = ['RED', 'BLUE', 'GREEN', 'PINK', 'ORANGE', 'YELLOW', 'BLACK', 'WHITE', 'PURPLE', 'CYAN', 'LIME', 'BROWN'];
const COLOUR_PAIRS: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let i = 0; i < MEETING_COLOURS.length; i++) for (let j = i + 1; j < MEETING_COLOURS.length; j++) out.push([i, j]);
  return out;
})();

const logicMeeting: TaskTemplate = {
  key: 'misc-emergency-meeting-logic',
  domain: 'misc',
  difficulty: 'HARD',
  variant: (seed) => {
    // 29 is coprime with 66, so seeds 0..65 pick 66 different imposter colour pairs.
    const [ca, cb] = COLOUR_PAIRS[(seed * 29) % COLOUR_PAIRS.length];
    const r = lcg(SALT(seed, 909));
    const others = MEETING_COLOURS.map((_, i) => i).filter((i) => i !== ca && i !== cb);
    for (let i = others.length - 1; i > 0; i--) { const j = randInt(r, 0, i); [others[i], others[j]] = [others[j], others[i]]; }
    const chosen = [ca, cb, ...others.slice(0, 4)];
    for (let i = chosen.length - 1; i > 0; i--) { const j = randInt(r, 0, i); [chosen[i], chosen[j]] = [chosen[j], chosen[i]]; }
    const names = chosen.map((c) => MEETING_COLOURS[c]);
    const secret = [chosen.indexOf(ca), chosen.indexOf(cb)].sort((x, y) => x - y) as [number, number];
    const imp = new Set<number>(secret);
    const n = names.length;
    const kinds: Claim['kind'][] = ['not', 'exactlyOne', 'atLeastOne', 'neither', 'same'];
    let said: Said[] = [];
    // Deterministically retry (same seeded stream) until the transcript has exactly one solution.
    for (let attempt = 0; attempt < 50; attempt++) {
      said = [];
      for (let step = 0; step < 60; step++) {
        const speaker = step % n;
        const want = !imp.has(speaker);
        let claim: Claim | null = null;
        for (let tries = 0; tries < 200 && !claim; tries++) {
          const kind = kinds[randInt(r, 0, kinds.length - 1)];
          const x = randInt(r, 0, n - 1);
          const y = randInt(r, 0, n - 1);
          if (x === speaker || y === speaker || (kind !== 'not' && x === y)) continue;
          const c: Claim = kind === 'not' ? { kind, x } : { kind, x, y };
          if (claimTrue(c, imp) === want) claim = c;
        }
        if (!claim) continue;
        said.push({ speaker, claim });
        if (said.length >= n && consistentPairs(n, said).length === 1) break;
      }
      if (consistentPairs(n, said).length === 1) break;
    }
    const sol = consistentPairs(n, said);
    if (sol.length !== 1 || sol[0][0] !== secret[0] || sol[0][1] !== secret[1]) throw new Error('logic puzzle not uniquely solvable');
    const answer = [names[secret[0]], names[secret[1]]].sort().join(' ');
    const ROOMS = ['Cafeteria', 'Admin', 'Weapons', 'Lower Engine', 'Upper Engine', 'Medbay', 'Navigation', 'Shields', 'Storage', 'Electrical', 'O2', 'Security'];
    const room = ROOMS[seed % ROOMS.length];
    const log = `EMERGENCY MEETING TRANSCRIPT - ${room}
Crew present: ${names.join(', ')}

RULES (confirmed by the ship's computer):
- Exactly TWO of the six are imposters.
- Every statement made by a crewmate is TRUE.
- Every statement made by an imposter is FALSE.

${said.map((s, i) => `${String(i + 1).padStart(2, ' ')}. ${names[s.speaker]}: "${claimText(s.claim, names)}"`).join('\n')}
`;
    return {
      title: `Who vented in ${room}?`,
      statement: `An emergency meeting was called in ${room}. Six crewmates spoke (${names.join(', ')}); exactly two of them are imposters. Crewmates always tell the truth and imposters always lie (every single statement an imposter makes is false). The full transcript is in log.txt.\n\nOnly one pair of imposters is consistent with every statement. Find it before the vote ends.`,
      workspace: 'MISC',
      runLanguage: null,
      files: [{ name: 'log.txt', language: 'text', content: log, readOnly: true }],
      answerFormat: 'Type the two imposter colours in alphabetical order separated by a single space, e.g. "BLACK RED". Comparison is case-insensitive; extra spaces are ignored.',
      validation: { mode: 'EXACT_TEXT', answer, caseSensitive: false, collapseWhitespace: true },
      hint: 'There are only 15 possible pairs. For each pair, mark those two as liars and check whether every statement has the right truth value; a single contradiction eliminates the pair.',
      solution: { explanation: `Checking all 15 pairs against the ${said.length} statements, only ${answer} makes every crewmate statement true and every imposter statement false.`, answer },
    };
  },
};

export const miscTemplates: TaskTemplate[] = [caesarLog, signalFrames, crewIdRegex, badgeLuhn, logicMeeting];
