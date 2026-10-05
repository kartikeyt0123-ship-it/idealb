import type { TaskTemplate } from '../types.js';

/**
 * COMMUNICATIONS / Web Development.
 *
 * Pattern for web tasks: participants edit index.html / style.css / script.js
 * and see a sandboxed live preview. Final verification is server-side: a hidden
 * Node harness loads script.js into a `vm` context and calls the page's
 * top-level `function` declarations with hidden inputs. DOM wiring in
 * script.js must be guarded with `if (typeof document !== 'undefined')` so it
 * is skipped under Node.
 *
 * Every template's `variant(seed)` is deterministic for any integer seed >= 0:
 * themes come from pools indexed by the seed, and all data/numbers come from a
 * small pure-arithmetic PRNG seeded by (seed, template salt). Expected outputs
 * are always computed by reference implementations below, never hand-written.
 */

/** Hidden harness shared by web tasks: evaluates script.js and runs `run(fns, input)` from the test stdin. */
export function webHarness(body: string): { name: string; content: string } {
  return {
    name: 'harness.js',
    content: `const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ctx = { console, Math, JSON, Number, String, Array, Object, Date, parseInt, parseFloat, isNaN };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8'), ctx, { filename: 'script.js', timeout: 2000 });
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
${body}
`,
  };
}

/* ------------------------------------------------------------------ */
/* Seeded helpers                                                      */
/* ------------------------------------------------------------------ */

/** Deterministic PRNG (mulberry32 mixing) seeded by the variant seed and a per-template salt. */
function rngFor(seed: number, salt: number) {
  let a = (Math.imul((seed % 4294967296) >>> 0, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b) ^ 0x6d2b79f5) >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)];
  const shuffle = <T>(arr: readonly T[]): T[] => {
    const c = arr.slice();
    for (let i = c.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [c[i], c[j]] = [c[j], c[i]];
    }
    return c;
  };
  return { next, int, pick, shuffle };
}

/** Injective map of seeds 0..p-1 onto 0..p-1 (p prime, mul not a multiple of p). */
function perm(seed: number, mul: number, add: number, p: number): number {
  return ((seed % p) * mul + add) % p;
}

/** Pool entry chosen by seed so consecutive seeds always get different themes. */
function bySeed<T>(pool: readonly T[], seed: number): T {
  return pool[seed % pool.length];
}

/* ------------------------------------------------------------------ */
/* EASY: cart subtotal adds price + qty                                */
/* ------------------------------------------------------------------ */

const SHOPS = [
  'Galley Supply', 'Med Bay Store', 'Cargo Exchange', 'Docking Kiosk', 'Reactor Canteen',
  'Navigation Outlet', 'Shields Depot', 'Storage Bazaar', 'Comms Corner', 'Electrical Surplus',
];
const PRODUCTS = [
  'Ration pack', 'Water cell', 'Thermal blanket', 'Bandage kit', 'Oxygen mask', 'Saline pouch',
  'Bolt crate', 'Wire spool', 'Fuse', 'Docking token', 'Map chip', 'Snack bar', 'Fuel canister',
  'Air filter', 'Keycard', 'Flashlight', 'Duct tape', 'Solder kit', 'Med scanner', 'Coffee pod',
  'Space socks', 'Visor wipe', 'Gear oil', 'Signal flare',
];

type CartItem = { name: string; price: number; qty: number };

const cartTotal: TaskTemplate = {
  key: 'web-cart-total',
  domain: 'web',
  difficulty: 'EASY',
  variant: (seed) => {
    const r = rngFor(seed, 11);
    const shop = bySeed(SHOPS, seed);
    const discount = r.pick([5, 10, 12, 15, 20, 25, 30]);
    const shuffled = r.shuffle(PRODUCTS);
    const count = r.int(3, 4);
    const items: CartItem[] = shuffled.slice(0, count).map((name) => ({ name, price: r.int(4, 80) * 5, qty: r.int(1, 5) }));
    // Guarantee the bug is visible: at least one line has qty > 1 (then price*qty != price+qty since price >= 20).
    items[r.int(0, count - 1)].qty = r.int(2, 6);

    const html = `<!doctype html>
<html>
<head><link rel="stylesheet" href="style.css"></head>
<body>
  <h1>${shop}</h1>
  <ul id="items"></ul>
  <p>Subtotal: <span id="subtotal"></span></p>
  <p>Crew discount (${discount}%): <span id="discount"></span></p>
  <p class="total">Total: <span id="total"></span> IdeaCoins</p>
  <script src="script.js"></script>
</body>
</html>
`;
    const css = `body { font-family: sans-serif; background: #10202b; color: #e6efe9; padding: 16px; }
h1 { color: #8ae4cf; }
.total { font-weight: bold; color: #e8cf8e; }
`;
    const script = `// ${shop} checkout
const ITEMS = ${JSON.stringify(items)};
const DISCOUNT_PERCENT = ${discount};

function subtotal(items) {
  let sum = 0;
  for (const item of items) {
    sum += item.price + item.qty;
  }
  return sum;
}

function applyDiscount(amount, percent) {
  return Math.round(amount - (amount * percent) / 100);
}

if (typeof document !== 'undefined') {
  const list = document.getElementById('items');
  for (const item of ITEMS) {
    const li = document.createElement('li');
    li.textContent = item.name + ' x' + item.qty + ' @ ' + item.price;
    list.appendChild(li);
  }
  const sub = subtotal(ITEMS);
  document.getElementById('subtotal').textContent = sub;
  document.getElementById('discount').textContent = '-' + (sub - applyDiscount(sub, DISCOUNT_PERCENT));
  document.getElementById('total').textContent = applyDiscount(sub, DISCOUNT_PERCENT);
}
`;
    const fixed = mustReplace(script, 'sum += item.price + item.qty;', 'sum += item.price * item.qty;');
    const refSub = (arr: CartItem[]) => arr.reduce((a, b) => a + b.price * b.qty, 0);
    const buggySub = items.reduce((a, b) => a + b.price + b.qty, 0);
    const p2 = shuffled.slice(count, count + 2);
    const cases: CartItem[][] = [
      items,
      [
        { name: p2[0], price: r.int(2, 40) * 5, qty: r.int(2, 9) },
        { name: p2[1], price: r.int(1, 99), qty: 1 },
      ],
      [{ name: shuffled[count + 2], price: r.int(50, 999), qty: r.int(2, 12) }],
      [
        { name: shuffled[count + 3], price: r.int(1, 9), qty: r.int(10, 40) },
        { name: shuffled[count + 4], price: r.int(1, 9), qty: 1 },
        { name: shuffled[count + 5], price: r.int(100, 400), qty: r.int(1, 3) },
      ],
      [],
    ];
    const tests = cases.map((c, i) => {
      const s = refSub(c);
      return {
        name: `cart-${i + 1}`,
        stdin: JSON.stringify({ items: c, percent: discount }),
        expected: `${s} ${Math.round(s - (s * discount) / 100)}`,
      };
    });
    return {
      title: `${shop} checkout overcharge`,
      statement: `The ${shop} terminal shows a total that makes no sense: for a cart of ${items.length} line items (${items.map((it) => `${it.qty} x ${it.name}`).join(', ')}) the subtotal reads ${buggySub} IdeaCoins, far less than the goods are worth. The page's script computes the subtotal and then applies a ${discount}% crew discount.\n\nFix script.js so subtotal(items) returns the sum of price × quantity for every item (an empty cart is 0). Use Run / Refresh Preview to check the page. Final verification calls subtotal() and applyDiscount() with hidden carts.`,
      workspace: 'WEB',
      runLanguage: 'javascript',
      runEntry: 'script.js',
      files: webFiles(html, css, script),
      answerFormat: 'Submit your edited files. Hidden tests print "<subtotal(items)> <applyDiscount(subtotal, percent)>" for several new carts and compare exactly.',
      validation: {
        mode: 'CODE_TESTS',
        language: 'javascript',
        entry: 'harness.js',
        harness: [webHarness(`const s = ctx.subtotal(input.items);\nconsole.log(s + ' ' + ctx.applyDiscount(s, input.percent));`)],
        tests,
      },
      hint: 'Each line item contributes its price multiplied by its quantity. Look closely at the operator inside the subtotal loop.',
      solution: {
        explanation: `subtotal() added price + qty for each line; it must add price * qty. For the page's cart the correct subtotal is ${refSub(items)} (the bug showed ${buggySub}); applyDiscount() is already correct.`,
        files: { 'script.js': fixed },
      },
    };
  },
};

/** Replace exactly-present text; throws during authoring if the buggy line drifted. */
function mustReplace(src: string, from: string, to: string): string {
  if (!src.includes(from)) throw new Error(`fix target not found: ${from}`);
  return src.split(from).join(to);
}

function webFiles(html: string, css: string, script: string) {
  return [
    { name: 'index.html', language: 'html' as const, content: html },
    { name: 'style.css', language: 'css' as const, content: css },
    { name: 'script.js', language: 'javascript' as const, content: script },
  ];
}

const BASE_CSS = `body { font-family: sans-serif; background: #10202b; color: #e6efe9; padding: 16px; }
h1 { color: #8ae4cf; }
`;

/* ------------------------------------------------------------------ */
/* EASY: mission timer mm:ss padding                                   */
/* ------------------------------------------------------------------ */

const MISSIONS = [
  'Emergency Meeting', 'Reactor Meltdown', 'O2 Depletion', 'Lights Sabotage',
  'Comms Blackout', 'Hull Breach', 'Seismic Stabilizer', 'Crash Course',
];

const missionTimer: TaskTemplate = {
  key: 'web-mission-timer',
  domain: 'web',
  difficulty: 'EASY',
  variant: (seed) => {
    const r = rngFor(seed, 22);
    const mission = bySeed(MISSIONS, seed);
    // Distinct start for seeds 0..592; the seconds part is always 0..9 so the bug is visible.
    const k = perm(seed, 131, 7, 593);
    const start = (1 + Math.floor(k / 10)) * 60 + (k % 10);
    const html = `<!doctype html>
<html>
<head><link rel="stylesheet" href="style.css"></head>
<body>
  <h1>${mission}</h1>
  <p>Time remaining: <span id="timer" class="timer"></span></p>
  <script src="script.js"></script>
</body>
</html>
`;
    const css = `${BASE_CSS}.timer { font-family: monospace; font-size: 48px; color: #e8cf8e; }
`;
    const script = `// ${mission} countdown display
const MISSION_SECONDS = ${start};

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

// Formats a whole number of seconds as "mm:ss" (minutes may exceed 99).
function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return pad2(minutes) + ':' + seconds;
}

if (typeof document !== 'undefined') {
  let left = MISSION_SECONDS;
  const el = document.getElementById('timer');
  el.textContent = formatTime(left);
  setInterval(function () {
    if (left > 0) left--;
    el.textContent = formatTime(left);
  }, 1000);
}
`;
    const fixed = mustReplace(script, "return pad2(minutes) + ':' + seconds;", "return pad2(minutes) + ':' + pad2(seconds);");
    const p2 = (n: number) => (n < 10 ? '0' + n : String(n));
    const ref = (t: number) => p2(Math.floor(t / 60)) + ':' + p2(t % 60);
    const inputs = [
      start,
      0,
      59,
      r.int(10, 99) * 60 + r.int(0, 9),
      6000 + r.int(0, 60) * 60 + r.int(1, 9),
      r.int(1, 9) * 60 + r.int(10, 59),
      r.int(0, 9),
    ];
    const tests = inputs.map((s, i) => ({ name: `timer-${i + 1}`, stdin: JSON.stringify({ seconds: s }), expected: ref(s) }));
    return {
      title: `${mission} timer glitch`,
      statement: `During the ${mission} the countdown on the Communications screen flickers between widths: at ${start} seconds it should read "${ref(start)}" but the crew sees "${ref(start).split(':')[0]}:${start % 60}" — the display breaks whenever the seconds part is below 10.\n\nFix formatTime(totalSeconds) in script.js so it always returns "mm:ss": minutes and seconds each padded to at least two digits with a leading zero (minutes may grow beyond two digits, e.g. 100:05). Final verification calls formatTime() with hidden values.`,
      workspace: 'WEB',
      runLanguage: 'javascript',
      runEntry: 'script.js',
      files: webFiles(html, css, script),
      answerFormat: 'Submit your edited files. Hidden tests call formatTime(seconds) and compare the returned string exactly (e.g. "02:05").',
      validation: {
        mode: 'CODE_TESTS',
        language: 'javascript',
        entry: 'harness.js',
        harness: [webHarness(`console.log(ctx.formatTime(input.seconds));`)],
        tests,
      },
      hint: 'Minutes are already zero-padded. Is the other half of the string treated the same way?',
      solution: {
        explanation: `The seconds part was not padded; wrap it with pad2() like the minutes. ${start}s must render as "${ref(start)}".`,
        files: { 'script.js': fixed },
      },
    };
  },
};

/* ------------------------------------------------------------------ */
/* MEDIUM: pagination off-by-one                                       */
/* ------------------------------------------------------------------ */

const LOGS = [
  'Security Camera Log', 'Vitals Log', 'Admin Swipe Log', 'Vent Sensor Log',
  'Door Access Log', 'Reactor Event Log', 'Shuttle Dock Log', 'Comms Relay Log',
];
const LOG_PREFIX = ['E', 'CAM', 'VIT', 'SW', 'VNT', 'DR', 'RX', 'EVT'];

const logPager: TaskTemplate = {
  key: 'web-log-pager',
  domain: 'web',
  difficulty: 'MEDIUM',
  variant: (seed) => {
    const r = rngFor(seed, 33);
    const log = bySeed(LOGS, seed);
    const prefix = r.pick(LOG_PREFIX);
    const perPage = r.int(3, 7);
    // Always a partial last page so Math.floor visibly loses entries.
    const total = perPage * r.int(2, 4) + r.int(1, perPage - 1);
    const base = 1 + perm(seed, 37, 5, 401);
    const entries = Array.from({ length: total }, (_, i) => `${prefix}${String(base + i).padStart(3, '0')}`);
    const html = `<!doctype html>
<html>
<head><link rel="stylesheet" href="style.css"></head>
<body>
  <h1>${log}</h1>
  <ol id="entries"></ol>
  <nav><button id="prev">Prev</button> <span id="label"></span> <button id="next">Next</button></nav>
  <script src="script.js"></script>
</body>
</html>
`;
    const css = `${BASE_CSS}nav { margin-top: 12px; }
button { background: #8ae4cf; border: 0; padding: 4px 10px; }
`;
    const script = `// ${log} viewer
const ENTRIES = ${JSON.stringify(entries)};
const PER_PAGE = ${perPage};

// Number of pages needed to show \`total\` entries, \`perPage\` per page.
// An empty log still shows 1 (empty) page.
function pageCount(total, perPage) {
  if (total <= 0) return 1;
  return Math.floor(total / perPage);
}

// Entries shown on 1-based page number \`page\`.
// Pages past the end return an empty list.
function pageItems(items, page, perPage) {
  const start = page * perPage;
  return items.slice(start, start + perPage);
}

if (typeof document !== 'undefined') {
  let page = 1;
  const render = function () {
    const list = document.getElementById('entries');
    list.innerHTML = '';
    for (const e of pageItems(ENTRIES, page, PER_PAGE)) {
      const li = document.createElement('li');
      li.textContent = e;
      list.appendChild(li);
    }
    document.getElementById('label').textContent = 'Page ' + page + ' / ' + pageCount(ENTRIES.length, PER_PAGE);
  };
  document.getElementById('prev').onclick = function () { if (page > 1) { page--; render(); } };
  document.getElementById('next').onclick = function () { if (page < pageCount(ENTRIES.length, PER_PAGE)) { page++; render(); } };
  render();
}
`;
    const fixed = mustReplace(
      mustReplace(script, 'return Math.floor(total / perPage);', 'return Math.ceil(total / perPage);'),
      'const start = page * perPage;',
      'const start = (page - 1) * perPage;',
    );
    const refCount = (t: number, p: number) => (t <= 0 ? 1 : Math.ceil(t / p));
    const refItems = (it: string[], page: number, p: number) => it.slice((page - 1) * p, (page - 1) * p + p);
    const lastPage = refCount(entries.length, perPage);
    const subLen = r.int(7, total);
    const subPer = r.int(2, 4);
    const cases: { items: string[]; page: number; perPage: number }[] = [
      { items: entries, page: 1, perPage },
      { items: entries, page: lastPage, perPage },
      { items: entries.slice(0, perPage * 2), page: 2, perPage },
      { items: [], page: 1, perPage },
      { items: entries.slice(0, subLen), page: r.int(2, refCount(subLen, subPer)), perPage: subPer },
      { items: entries, page: lastPage + 1, perPage },
    ];
    const tests = cases.map((c, i) => ({
      name: `page-${i + 1}`,
      stdin: JSON.stringify(c),
      expected: `${refCount(c.items.length, c.perPage)} | ${refItems(c.items, c.page, c.perPage).join(',')}`,
    }));
    return {
      title: `${log} pagination`,
      statement: `The ${log} has ${entries.length} entries (${entries[0]} to ${entries[entries.length - 1]}) shown ${perPage} per page, but the viewer never shows ${entries[0]} and the last few entries cannot be reached — the page counter claims there are only ${Math.floor(entries.length / perPage)} page(s).\n\nFix script.js:\n- pageCount(total, perPage) must return how many pages are needed to show every entry (an empty log still has 1 page).\n- pageItems(items, page, perPage) must return the entries on 1-based page number \`page\` (page 1 starts with the first entry; pages past the end are empty).\n\nFinal verification calls both functions with hidden logs.`,
      workspace: 'WEB',
      runLanguage: 'javascript',
      runEntry: 'script.js',
      files: webFiles(html, css, script),
      answerFormat: 'Submit your edited files. Hidden tests print "<pageCount> | <comma-joined pageItems>" for several logs and compare exactly.',
      validation: {
        mode: 'CODE_TESTS',
        language: 'javascript',
        entry: 'harness.js',
        harness: [webHarness(`console.log(ctx.pageCount(input.items.length, input.perPage) + ' | ' + ctx.pageItems(input.items, input.page, input.perPage).join(','));`)],
        tests,
      },
      hint: 'Two off-by-one errors: a partial last page still counts as a page, and page numbers start at 1 while array indices start at 0.',
      solution: {
        explanation: `pageCount must round up (Math.ceil): ${entries.length} entries at ${perPage}/page need ${lastPage} pages, not ${Math.floor(entries.length / perPage)}. pageItems must start at (page - 1) * perPage so page 1 begins with ${entries[0]}.`,
        files: { 'script.js': fixed },
      },
    };
  },
};

/* ------------------------------------------------------------------ */
/* MEDIUM: leaderboard sort + competition ranking                      */
/* ------------------------------------------------------------------ */

const BOARDS = [
  'Task Sprint', 'Wiring Rally', 'Asteroid Blitz', 'Fuel Relay',
  'Card Swipe Cup', 'Shield Dash', 'Download Derby', 'Engine Tune-up',
];
const CREW = [
  'Nova', 'Orion', 'Lyra', 'Vega', 'Atlas', 'Cora', 'Pip', 'Juno', 'Rex', 'Ivy', 'Bolt', 'Kai',
  'Zed', 'Mira', 'Ash', 'Luna', 'Echo', 'Dax', 'Tess', 'Finn', 'Oslo', 'Rune', 'Gale', 'Bea',
  'Yuki', 'Abe', 'Moe', 'Kit', 'Bix', 'Cam', 'Ari', 'Sol',
];

type Player = { name: string; score: number };

function refRank(ps: Player[], n: number): string {
  const s = ps.slice().sort((a, b) => (a.score !== b.score ? b.score - a.score : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return s.slice(0, n).map((p) => `${1 + ps.filter((q) => q.score > p.score).length}. ${p.name} ${p.score}`).join('\n');
}

const crewLeaderboard: TaskTemplate = {
  key: 'web-crew-leaderboard',
  domain: 'web',
  difficulty: 'MEDIUM',
  variant: (seed) => {
    const r = rngFor(seed, 44);
    const board = bySeed(BOARDS, seed);
    const crew = r.shuffle(CREW);
    const unit = r.pick([1, 5, 10]);
    const s4 = r.int(3, 40) * unit;
    const s3 = s4 + r.int(1, 15) * unit;
    const s2 = s3 + r.int(1, 15) * unit;
    const s1 = s2 + r.int(1, 15) * unit;
    // Every pattern contains a tie inside the top 4, so both bugs are always visible.
    const pattern = r.pick([
      [s1, s2, s2, s3, s3, s4],
      [s1, s1, s2, s3, s3, s4],
      [s1, s2, s2, s2, s3, s4],
      [s1, s1, s2, s2, s3, s4],
      [s1, s2, s3, s3, s4, s4],
    ]);
    const players: Player[] = r.shuffle(pattern).map((score, i) => ({ name: crew[i], score }));
    const topN = r.int(4, 5);
    const html = `<!doctype html>
<html>
<head><link rel="stylesheet" href="style.css"></head>
<body>
  <h1>${board} leaderboard</h1>
  <ol id="board" class="board"></ol>
  <script src="script.js"></script>
</body>
</html>
`;
    const css = `${BASE_CSS}.board { list-style: none; padding: 0; font-family: monospace; font-size: 18px; }
`;
    const script = `// ${board} leaderboard
const PLAYERS = ${JSON.stringify(players)};
const TOP_N = ${topN};

// Returns the top \`topN\` rows as strings "<rank>. <name> <score>".
// Order: higher score first; equal scores ordered by name A->Z.
// Ranking is "competition style": equal scores share a rank and the next
// rank skips (scores 90, 80, 80, 70 -> ranks 1, 2, 2, 4).
// Must not reorder the caller's array.
function rankCrew(players, topN) {
  const sorted = players.slice().sort(function (a, b) {
    if (a.score !== b.score) return b.score - a.score;
    return a.name < b.name ? 1 : -1;
  });
  const rows = [];
  for (let i = 0; i < sorted.length && i < topN; i++) {
    const rank = i + 1;
    rows.push(rank + '. ' + sorted[i].name + ' ' + sorted[i].score);
  }
  return rows;
}

if (typeof document !== 'undefined') {
  const ol = document.getElementById('board');
  for (const row of rankCrew(PLAYERS, TOP_N)) {
    const li = document.createElement('li');
    li.textContent = row;
    ol.appendChild(li);
  }
}
`;
    const fixed = mustReplace(
      mustReplace(script, 'return a.name < b.name ? 1 : -1;', 'return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;'),
      'const rank = i + 1;',
      'let rank = i + 1;\n    if (i > 0 && sorted[i].score === sorted[i - 1].score) rank = lastRank;\n    lastRank = rank;',
    ).replace('const rows = [];', 'const rows = [];\n  let lastRank = 0;');
    const tieScore = r.int(20, 90);
    const triple = r.int(10, 60);
    const cases: { players: Player[]; topN: number }[] = [
      { players, topN },
      { players, topN: players.length },
      { players: [{ name: crew[6], score: tieScore }, { name: crew[7], score: tieScore }, { name: crew[8], score: tieScore - r.int(1, 15) }], topN: 3 },
      { players: [{ name: crew[9], score: r.int(1, 99) }], topN: 3 },
      {
        players: [
          { name: crew[10], score: triple },
          { name: crew[11], score: triple + r.int(1, 20) },
          { name: crew[12], score: triple },
          { name: crew[13], score: triple },
        ],
        topN: r.int(2, 3),
      },
    ];
    const tests = cases.map((c, i) => ({ name: `board-${i + 1}`, stdin: JSON.stringify(c), expected: refRank(c.players, c.topN) }));
    const shownTie = players.filter((p) => players.filter((q) => q.score === p.score).length > 1).map((p) => p.name);
    return {
      title: `${board} leaderboard order`,
      statement: `The ${board} leaderboard on the Communications screen is unfair: crewmates with the same score (look at ${shownTie.slice(0, 2).join(' and ')}) appear in reverse alphabetical order, and tied crewmates get different rank numbers.\n\nFix rankCrew(players, topN) in script.js so it returns the top \`topN\` rows (the page shows the top ${topN}) as "<rank>. <name> <score>":\n- higher score first; equal scores ordered by name A to Z;\n- competition ranking: equal scores share a rank and the next rank skips (scores 90, 80, 80, 70 give ranks 1, 2, 2, 4);\n- never reorder the caller's array.\n\nFinal verification calls rankCrew() with hidden rosters.`,
      workspace: 'WEB',
      runLanguage: 'javascript',
      runEntry: 'script.js',
      files: webFiles(html, css, script),
      answerFormat: 'Submit your edited files. Hidden tests print the returned rows one per line and compare exactly.',
      validation: {
        mode: 'CODE_TESTS',
        language: 'javascript',
        entry: 'harness.js',
        harness: [webHarness(`const before = JSON.stringify(input.players);\nconst rows = ctx.rankCrew(input.players, input.topN);\nif (JSON.stringify(input.players) !== before) console.log('INPUT MUTATED');\nconsole.log(rows.join('\\n'));`)],
        tests,
      },
      hint: 'A sort comparator must return a negative number when a should come first. And a rank is not always the row position — look at the previous row.',
      solution: {
        explanation: `The tie-break comparator was reversed (it must return -1 when a.name < b.name), and ranks must repeat for equal scores (competition ranking) instead of always being i + 1. Correct page output:\n${refRank(players, topN)}`,
        files: { 'script.js': fixed },
      },
    };
  },
};

/* ------------------------------------------------------------------ */
/* HARD: cargo reducer that mutates shared state (breaks undo)         */
/* ------------------------------------------------------------------ */

type CargoAction = { type: 'ADD'; id: string; qty: number } | { type: 'REMOVE'; id: string } | { type: 'SET_QTY'; id: string; qty: number } | { type: 'UNDO' };
type CargoState = { items: { id: string; qty: number }[] };

function refCargoReducer(state: CargoState, a: CargoAction): CargoState {
  if (a.type === 'ADD') {
    const has = state.items.some((it) => it.id === a.id);
    return { items: has ? state.items.map((it) => (it.id === a.id ? { id: it.id, qty: it.qty + a.qty } : it)) : [...state.items, { id: a.id, qty: a.qty }] };
  }
  if (a.type === 'REMOVE') return { items: state.items.filter((it) => it.id !== a.id) };
  if (a.type === 'SET_QTY') {
    if (a.qty <= 0) return { items: state.items.filter((it) => it.id !== a.id) };
    return { items: state.items.map((it) => (it.id === a.id ? { id: it.id, qty: a.qty } : it)) };
  }
  return state;
}

function refCargoHistory(actions: CargoAction[]): string {
  let state: CargoState = { items: [] };
  const history = [state];
  for (const a of actions) {
    if (a.type === 'UNDO') {
      if (history.length > 1) history.pop();
      state = history[history.length - 1];
      continue;
    }
    state = refCargoReducer(state, a);
    history.push(state);
  }
  return history.map((s) => s.items.map((it) => `${it.id}:${it.qty}`).join(',') || '(empty)').join('\n');
}

const BAYS = [
  'Cargo Bay A', 'Storage Deck', 'Lower Engine Hold', 'Shuttle Locker',
  'Upper Engine Hold', 'Med Bay Cabinet', 'Armory Rack', 'Reactor Supply Room',
];
const CARGO_IDS = ['fuel', 'wire', 'bolt', 'card', 'oxy', 'med', 'food', 'tool', 'coil', 'gear', 'pipe', 'seal', 'map', 'key', 'lamp', 'rope'];

const cargoUndo: TaskTemplate = {
  key: 'web-cargo-undo',
  domain: 'web',
  difficulty: 'HARD',
  variant: (seed) => {
    const r = rngFor(seed, 55);
    const bay = bySeed(BAYS, seed);
    const [a, b, c, d] = r.shuffle(CARGO_IDS);
    const q = () => r.int(1, 9);
    // Sequences 1-4 always add to / re-set an EXISTING item, so the mutation bug always corrupts history.
    const scripts: CargoAction[][] = [
      [{ type: 'ADD', id: a, qty: q() }, { type: 'ADD', id: b, qty: q() }, { type: 'ADD', id: a, qty: q() }, { type: 'UNDO' }, { type: 'ADD', id: c, qty: q() }],
      [{ type: 'ADD', id: b, qty: q() }, { type: 'SET_QTY', id: b, qty: 10 + q() }, { type: 'ADD', id: d, qty: q() }, { type: 'UNDO' }, { type: 'UNDO' }],
      [
        { type: 'ADD', id: c, qty: q() }, { type: 'ADD', id: d, qty: q() }, { type: 'REMOVE', id: c }, { type: 'ADD', id: d, qty: q() },
        { type: 'UNDO' }, { type: 'SET_QTY', id: d, qty: 0 },
      ],
      [{ type: 'ADD', id: a, qty: q() }, { type: 'ADD', id: a, qty: q() }, { type: 'ADD', id: a, qty: q() }, { type: 'UNDO' }, { type: 'UNDO' }, { type: 'ADD', id: b, qty: q() }],
      [{ type: 'ADD', id: d, qty: q() }, { type: 'REMOVE', id: a }, { type: 'UNDO' }, { type: 'ADD', id: b, qty: q() }],
      [
        { type: 'ADD', id: a, qty: q() }, { type: 'ADD', id: c, qty: q() }, { type: 'SET_QTY', id: a, qty: 20 + q() }, { type: 'ADD', id: c, qty: q() },
        { type: 'UNDO' }, { type: 'UNDO' }, { type: 'UNDO' },
      ],
    ];
    const html = `<!doctype html>
<html>
<head><link rel="stylesheet" href="style.css"></head>
<body>
  <h1>${bay} manifest</h1>
  <ul id="manifest"></ul>
  <button id="add">Add 1 ${a}</button>
  <button id="undo">Undo</button>
  <script src="script.js"></script>
</body>
</html>
`;
    const css = `${BASE_CSS}button { background: #8ae4cf; border: 0; padding: 4px 10px; margin-right: 6px; }
`;
    const script = `// ${bay} cargo manifest with undo.
// State shape: { items: [ { id, qty }, ... ] }
// cargoReducer(state, action) must be PURE: it returns a new state and never
// changes \`state\` or any object inside it, because the undo history keeps
// references to every previous state.
//   { type: 'ADD', id, qty }     add qty to an existing item, or append a new item
//   { type: 'REMOVE', id }       remove the item
//   { type: 'SET_QTY', id, qty } set the quantity; qty <= 0 removes the item
function cargoReducer(state, action) {
  const items = state.items.slice();
  if (action.type === 'ADD') {
    const found = items.find(function (it) { return it.id === action.id; });
    if (found) {
      found.qty += action.qty;
    } else {
      items.push({ id: action.id, qty: action.qty });
    }
    return { items: items };
  }
  if (action.type === 'REMOVE') {
    return { items: items.filter(function (it) { return it.id !== action.id; }) };
  }
  if (action.type === 'SET_QTY') {
    if (action.qty <= 0) {
      return { items: items.filter(function (it) { return it.id !== action.id; }) };
    }
    const idx = items.findIndex(function (it) { return it.id === action.id; });
    if (idx !== -1) items[idx].qty = action.qty;
    return { items: items };
  }
  return state;
}

if (typeof document !== 'undefined') {
  const history = [{ items: [] }];
  const render = function () {
    const ul = document.getElementById('manifest');
    ul.innerHTML = '';
    for (const it of history[history.length - 1].items) {
      const li = document.createElement('li');
      li.textContent = it.id + ' x' + it.qty;
      ul.appendChild(li);
    }
  };
  document.getElementById('add').onclick = function () {
    history.push(cargoReducer(history[history.length - 1], { type: 'ADD', id: '${a}', qty: 1 }));
    render();
  };
  document.getElementById('undo').onclick = function () {
    if (history.length > 1) history.pop();
    render();
  };
  render();
}
`;
    const fixed = mustReplace(
      mustReplace(
        script,
        'found.qty += action.qty;',
        'items[items.indexOf(found)] = { id: found.id, qty: found.qty + action.qty };',
      ),
      'if (idx !== -1) items[idx].qty = action.qty;',
      'if (idx !== -1) items[idx] = { id: items[idx].id, qty: action.qty };',
    );
    const tests = scripts.map((actions, i) => ({ name: `history-${i + 1}`, stdin: JSON.stringify({ actions }), expected: refCargoHistory(actions) }));
    const ex = scripts[0];
    const exA1 = (ex[0] as { qty: number }).qty;
    const exA2 = (ex[2] as { qty: number }).qty;
    return {
      title: `${bay} undo corrupts history`,
      statement: `The ${bay} manifest has an Undo button, but Undo is lying: load ${exA1} ${a}, then ${exA2} more ${a}, press Undo — the crate still says ${exA1 + exA2} instead of ${exA1}. Older snapshots in the history seem to change by themselves.\n\nThe page keeps an array of every previous state and Undo simply goes back one entry, so cargoReducer(state, action) in script.js must be pure: it must return a new state and must never modify \`state\` or any item object inside it. Supported actions:\n\`\`\`\n{ type: 'ADD', id, qty }      add qty to an existing item, or append a new item at the end\n{ type: 'REMOVE', id }        remove the item\n{ type: 'SET_QTY', id, qty }  set the quantity; qty <= 0 removes the item\n\`\`\`\nItem order must be preserved. Final verification replays hidden action sequences (including undo) and prints every snapshot in the history.`,
      workspace: 'WEB',
      runLanguage: 'javascript',
      runEntry: 'script.js',
      files: webFiles(html, css, script),
      answerFormat: 'Submit your edited files. Hidden tests replay actions through cargoReducer, keep every returned state in a history (UNDO pops it), then print each snapshot as "id:qty,id:qty" (or "(empty)") one per line; output is compared exactly.',
      validation: {
        mode: 'CODE_TESTS',
        language: 'javascript',
        entry: 'harness.js',
        harness: [
          webHarness(`let state = { items: [] };
const history = [state];
for (const a of input.actions) {
  if (a.type === 'UNDO') {
    if (history.length > 1) history.pop();
    state = history[history.length - 1];
    continue;
  }
  state = ctx.cargoReducer(state, a);
  history.push(state);
}
console.log(history.map(function (s) { return s.items.map(function (it) { return it.id + ':' + it.qty; }).join(',') || '(empty)'; }).join('\\n'));`),
        ],
        tests,
      },
      hint: 'state.items.slice() copies the array, but the item objects inside are still shared with the previous state. Any line that assigns to a property of an existing item changes history too.',
      solution: {
        explanation: 'The array was shallow-copied but existing item objects were mutated (found.qty += ..., items[idx].qty = ...), corrupting earlier snapshots. Replace the item with a new object instead of mutating it, in both ADD and SET_QTY.',
        files: { 'script.js': fixed },
      },
    };
  },
};

export const webTemplates: TaskTemplate[] = [cartTotal, missionTimer, logPager, crewLeaderboard, cargoUndo];
