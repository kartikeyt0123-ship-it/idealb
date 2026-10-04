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

const cartTotal: TaskTemplate = {
  key: 'web-cart-total',
  domain: 'web',
  difficulty: 'EASY',
  variant: (v) => {
    const shop = ['Galley Supply', 'Med Bay Store', 'Cargo Exchange', 'Docking Kiosk'][v];
    const discount = [10, 15, 20, 25][v];
    const items = [
      [['Ration pack', 120, 2], ['Water cell', 45, 4], ['Thermal blanket', 300, 1]],
      [['Bandage kit', 80, 3], ['Oxygen mask', 260, 1], ['Saline', 55, 2]],
      [['Bolt crate', 150, 2], ['Wire spool', 90, 3], ['Fuse', 25, 6]],
      [['Docking token', 200, 1], ['Map chip', 140, 2], ['Snack bar', 30, 5]],
    ][v] as [string, number, number][];
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
const ITEMS = ${JSON.stringify(items.map(([name, price, qty]) => ({ name, price, qty })))};
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
    const fixed = script.replace('sum += item.price + item.qty;', 'sum += item.price * item.qty;');
    const sub = (arr: { price: number; qty: number }[]) => arr.reduce((a, b) => a + b.price * b.qty, 0);
    const cases = [
      items.map(([name, price, qty]) => ({ name, price, qty })),
      [{ name: 'A', price: 10, qty: 3 }, { name: 'B', price: 7, qty: 1 }],
      [{ name: 'C', price: 99 + v, qty: 2 }],
      [{ name: 'D', price: 5, qty: 10 + v }, { name: 'E', price: 1, qty: 1 }],
    ];
    const tests = cases.map((c, i) => ({
      name: `cart-${i + 1}`,
      stdin: JSON.stringify({ items: c, percent: discount }),
      expected: `${sub(c)} ${Math.round(sub(c) - (sub(c) * discount) / 100)}`,
    }));
    return {
      title: `${shop} checkout overcharge`,
      statement: `The ${shop} terminal shows a total that makes no sense — a crate of three items costs less than one! The page's script computes the subtotal and then applies a ${discount}% crew discount.\n\nFix script.js so subtotal(items) returns the sum of price × quantity for every item. Use Run / Refresh Preview to check the page. Final verification calls subtotal() and applyDiscount() with hidden carts.`,
      workspace: 'WEB',
      runLanguage: 'javascript',
      runEntry: 'script.js',
      files: [
        { name: 'index.html', language: 'html', content: html },
        { name: 'style.css', language: 'css', content: css },
        { name: 'script.js', language: 'javascript', content: script },
      ],
      answerFormat: 'Submit your edited files. Hidden tests call subtotal(items) and applyDiscount(amount, percent) with new carts.',
      validation: {
        mode: 'CODE_TESTS',
        language: 'javascript',
        entry: 'harness.js',
        harness: [webHarness(`const s = ctx.subtotal(input.items);\nconsole.log(s + ' ' + ctx.applyDiscount(s, input.percent));`)],
        tests,
      },
      hint: 'Each line item contributes price multiplied by quantity. Look at the operator inside the subtotal loop.',
      solution: { explanation: 'subtotal() added price + qty; it must add price * qty.', files: { 'script.js': fixed } },
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

const missionTimer: TaskTemplate = {
  key: 'web-mission-timer',
  domain: 'web',
  difficulty: 'EASY',
  variant: (v) => {
    const mission = ['Emergency Meeting', 'Reactor Meltdown', 'O2 Depletion', 'Lights Sabotage'][v];
    const start = [125, 302, 487, 61][v];
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
    const ref = (t: number) => {
      const p = (n: number) => (n < 10 ? '0' + n : String(n));
      return p(Math.floor(t / 60)) + ':' + p(t % 60);
    };
    const inputs = [
      [start, 0, 59, 600 + 3 * v, 6007 + v],
      [start, 9, 60, 3599, 61 + 2 * v],
      [start, 7 + v, 70, 1205, 6000],
      [start, 5, 120 + v, 599, 9999],
    ][v];
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
      solution: { explanation: 'The seconds part was not padded; wrap it with pad2() like the minutes.', files: { 'script.js': fixed } },
    };
  },
};

/* ------------------------------------------------------------------ */
/* MEDIUM: pagination off-by-one                                       */
/* ------------------------------------------------------------------ */

const logPager: TaskTemplate = {
  key: 'web-log-pager',
  domain: 'web',
  difficulty: 'MEDIUM',
  variant: (v) => {
    const log = ['Security Camera Log', 'Vitals Log', 'Admin Swipe Log', 'Vent Sensor Log'][v];
    const perPage = [5, 4, 6, 3][v];
    const entries = Array.from({ length: [13, 11, 20, 10][v] }, (_, i) => `E${String(i + 1).padStart(2, '0')}`);
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
    const cases: { items: string[]; page: number; perPage: number }[] = [
      { items: entries, page: 1, perPage },
      { items: entries, page: lastPage, perPage },
      { items: entries.slice(0, perPage * 2), page: 2, perPage },
      { items: [], page: 1, perPage },
      { items: entries.slice(0, 7 + v), page: 2, perPage: 3 },
    ];
    const tests = cases.map((c, i) => ({
      name: `page-${i + 1}`,
      stdin: JSON.stringify(c),
      expected: `${refCount(c.items.length, c.perPage)} | ${refItems(c.items, c.page, c.perPage).join(',')}`,
    }));
    return {
      title: `${log} pagination`,
      statement: `The ${log} has ${entries.length} entries shown ${perPage} per page, but the viewer never shows entry E01 and the last few entries cannot be reached — the page counter claims there are only ${Math.floor(entries.length / perPage)} page(s).\n\nFix script.js:\n- pageCount(total, perPage) must return how many pages are needed to show every entry (an empty log still has 1 page).\n- pageItems(items, page, perPage) must return the entries on 1-based page number \`page\` (page 1 starts with the first entry; pages past the end are empty).\n\nFinal verification calls both functions with hidden logs.`,
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
        explanation: 'pageCount must round up (Math.ceil) and pageItems must start at (page - 1) * perPage.',
        files: { 'script.js': fixed },
      },
    };
  },
};

/* ------------------------------------------------------------------ */
/* MEDIUM: leaderboard sort + competition ranking                      */
/* ------------------------------------------------------------------ */

const crewLeaderboard: TaskTemplate = {
  key: 'web-crew-leaderboard',
  domain: 'web',
  difficulty: 'MEDIUM',
  variant: (v) => {
    const board = ['Task Sprint', 'Wiring Rally', 'Asteroid Blitz', 'Fuel Relay'][v];
    const names = [
      ['Nova', 'Orion', 'Lyra', 'Vega', 'Atlas', 'Cora'],
      ['Pip', 'Juno', 'Rex', 'Ivy', 'Bolt', 'Kai'],
      ['Zed', 'Mira', 'Ash', 'Luna', 'Echo', 'Dax'],
      ['Tess', 'Finn', 'Oslo', 'Rune', 'Gale', 'Bea'],
    ][v];
    const scores = [
      [420, 380, 420, 290, 380, 510],
      [150, 230, 150, 230, 90, 300],
      [700, 640, 700, 700, 520, 640],
      [88, 120, 88, 120, 120, 45],
    ][v];
    const players = names.map((name, i) => ({ name, score: scores[i] }));
    const topN = [4, 5, 4, 5][v];
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
    const ref = (ps: { name: string; score: number }[], n: number) => {
      const s = ps.slice().sort((a, b) => (a.score !== b.score ? b.score - a.score : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return s.slice(0, n).map((p) => `${1 + ps.filter((q) => q.score > p.score).length}. ${p.name} ${p.score}`).join('\n');
    };
    const cases: { players: { name: string; score: number }[]; topN: number }[] = [
      { players, topN },
      { players, topN: players.length },
      { players: [{ name: 'Yuki', score: 50 + v }, { name: 'Abe', score: 50 + v }, { name: 'Moe', score: 10 }], topN: 3 },
      { players: [{ name: 'Solo', score: 7 * (v + 1) }], topN: 3 },
      { players: [{ name: 'Kit', score: 30 }, { name: 'Bix', score: 40 }, { name: 'Cam', score: 30 }, { name: 'Ari', score: 30 }], topN: 2 + (v % 2) },
    ];
    const tests = cases.map((c, i) => ({ name: `board-${i + 1}`, stdin: JSON.stringify(c), expected: ref(c.players, c.topN) }));
    return {
      title: `${board} leaderboard order`,
      statement: `The ${board} leaderboard on the Communications screen is unfair: crewmates with the same score appear in reverse alphabetical order, and tied crewmates get different rank numbers.\n\nFix rankCrew(players, topN) in script.js so it returns the top \`topN\` rows as "<rank>. <name> <score>":\n- higher score first; equal scores ordered by name A to Z;\n- competition ranking: equal scores share a rank and the next rank skips (scores 90, 80, 80, 70 give ranks 1, 2, 2, 4);\n- never reorder the caller's array.\n\nFinal verification calls rankCrew() with hidden rosters.`,
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
        explanation: 'The tie-break comparator was reversed (should return -1 when a.name < b.name), and ranks must repeat for equal scores (competition ranking) instead of always being i + 1.',
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

const cargoUndo: TaskTemplate = {
  key: 'web-cargo-undo',
  domain: 'web',
  difficulty: 'HARD',
  variant: (v) => {
    const bay = ['Cargo Bay A', 'Storage Deck', 'Lower Engine Hold', 'Shuttle Locker'][v];
    const ids = [
      ['fuel', 'wire', 'bolt', 'card'],
      ['oxy', 'med', 'food', 'tool'],
      ['coil', 'gear', 'pipe', 'seal'],
      ['map', 'key', 'lamp', 'rope'],
    ][v];
    const [a, b, c, d] = ids;
    const scripts: CargoAction[][] = [
      [
        { type: 'ADD', id: a, qty: 2 + v }, { type: 'ADD', id: b, qty: 1 }, { type: 'ADD', id: a, qty: 3 }, { type: 'UNDO' }, { type: 'ADD', id: c, qty: 4 },
      ],
      [
        { type: 'ADD', id: b, qty: 5 }, { type: 'SET_QTY', id: b, qty: 9 + v }, { type: 'ADD', id: d, qty: 1 }, { type: 'UNDO' }, { type: 'UNDO' },
      ],
      [
        { type: 'ADD', id: c, qty: 1 }, { type: 'ADD', id: d, qty: 2 }, { type: 'REMOVE', id: c }, { type: 'ADD', id: d, qty: 6 + v }, { type: 'UNDO' }, { type: 'SET_QTY', id: d, qty: 0 },
      ],
      [
        { type: 'ADD', id: a, qty: 1 }, { type: 'ADD', id: a, qty: 1 }, { type: 'ADD', id: a, qty: 1 + v }, { type: 'UNDO' }, { type: 'UNDO' }, { type: 'ADD', id: b, qty: 3 },
      ],
      [
        { type: 'ADD', id: d, qty: 7 }, { type: 'REMOVE', id: a }, { type: 'UNDO' }, { type: 'ADD', id: b, qty: 2 * (v + 1) },
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
    return {
      title: `${bay} undo corrupts history`,
      statement: `The ${bay} manifest has an Undo button, but Undo is lying: after adding more ${a} to an existing crate and pressing Undo, the quantity stays at the new value. Older snapshots in the history seem to change by themselves.\n\nThe page keeps an array of every previous state and Undo simply goes back one entry, so cargoReducer(state, action) in script.js must be pure: it must return a new state and must never modify \`state\` or any item object inside it. Supported actions:\n\`\`\`\n{ type: 'ADD', id, qty }      add qty to an existing item, or append a new item at the end\n{ type: 'REMOVE', id }        remove the item\n{ type: 'SET_QTY', id, qty }  set the quantity; qty <= 0 removes the item\n\`\`\`\nItem order must be preserved. Final verification replays hidden action sequences (including undo) and prints every snapshot in the history.`,
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
        explanation: 'The array was shallow-copied but existing item objects were mutated (found.qty += ..., items[idx].qty = ...), corrupting earlier snapshots. Replace the item with a new object instead of mutating it.',
        files: { 'script.js': fixed },
      },
    };
  },
};

export const webTemplates: TaskTemplate[] = [cartTotal, missionTimer, logPager, crewLeaderboard, cargoUndo];
