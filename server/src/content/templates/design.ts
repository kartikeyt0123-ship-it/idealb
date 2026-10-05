import type { StarterFile, TaskTemplate } from '../types.js';
import { webHarness } from './web.js';

/**
 * DESIGN LAB / Designing.
 *
 * All tasks are deterministic: either a CSS layout computation answered as a
 * number (the expected value is computed here from the variant parameters,
 * following the CSS spec), or a JS design-utility function verified with
 * hidden tests through the shared web harness.
 *
 * `variant(seed)` works for any integer seed >= 0: themes come from pools
 * indexed by the seed, numbers/colours from a pure-arithmetic PRNG seeded by
 * (seed, template salt), and answers from reference implementations below.
 */

function mustReplace(src: string, from: string, to: string): string {
  if (!src.includes(from)) throw new Error(`fix target not found: ${from}`);
  return src.split(from).join(to);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Formats a number for display in statements/answers without float noise. */
function fmt(n: number): string {
  return String(round2(n));
}

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

function bySeed<T>(pool: readonly T[], seed: number): T {
  return pool[seed % pool.length];
}

const BASE_CSS = `body { font-family: sans-serif; background: #1b1424; color: #f1e6ee; padding: 16px; margin: 0; }
h1 { color: #dea4ca; font-size: 20px; }
`;

function previewFiles(html: string, css: string): StarterFile[] {
  return [
    { name: 'index.html', language: 'html', content: html },
    { name: 'style.css', language: 'css', content: css },
  ];
}

function jsFiles(html: string, css: string, script: string): StarterFile[] {
  return [...previewFiles(html, css), { name: 'script.js', language: 'javascript', content: script }];
}

/* ------------------------------------------------------------------ */
/* EASY: content-box width computation                                 */
/* ------------------------------------------------------------------ */

const CARDS = ['crew-card', 'vote-card', 'task-card', 'map-card', 'chat-card', 'skin-card', 'pet-card', 'hat-card'];

const boxWidth: TaskTemplate = {
  key: 'design-box-width',
  domain: 'design',
  difficulty: 'EASY',
  variant: (seed) => {
    const r = rngFor(seed, 101);
    const card = bySeed(CARDS, seed);
    const padL = r.int(4, 40);
    const padR = r.int(4, 40);
    const padV = r.int(4, 24);
    const border = r.int(1, 6);
    const margin = r.int(6, 40);
    // Distinct answer for seeds 0..256.
    const answer = 240 + perm(seed, 97, 31, 257);
    const width = answer - padL - padR - 2 * border;
    const slot = answer - r.int(6, 30);
    const html = `<!doctype html>
<html>
<head><link rel="stylesheet" href="style.css"></head>
<body>
  <h1>Design Lab: .${card}</h1>
  <div class="${card}">Crewmate profile</div>
</body>
</html>
`;
    const css = `${BASE_CSS}* { box-sizing: content-box; }
.${card} {
  width: ${width}px;
  padding: ${padV}px ${padR}px ${padV}px ${padL}px;
  border: ${border}px solid #dea4ca;
  margin: 0 ${margin}px;
  background: #2c2238;
}
`;
    return {
      title: `How wide is .${card}?`,
      statement: `The Design Lab mock-up for the .${card} component (declared width: ${width}px) overflows its ${slot}px slot on the ship's tablet. Before resizing anything, the crew needs the exact rendered width.\n\nUsing style.css (box-sizing is content-box for every element), what is the rendered width of .${card} in pixels — the width of its border box (content + padding + border, NOT margin), i.e. what getBoundingClientRect().width reports?`,
      workspace: 'DESIGN',
      runLanguage: null,
      files: previewFiles(html, css),
      answerFormat: 'Submit a single number of pixels without units (e.g. 312). Compared numerically; must be exact (tolerance 0).',
      validation: { mode: 'NUMERIC', answer, tolerance: 0 },
      hint: 'With content-box, `width` only sets the content area. Add the left and right padding and both borders; margins sit outside the box.',
      solution: {
        explanation: `${width} (content) + ${padL} + ${padR} (left/right padding) + 2 x ${border} (border) = ${answer}px. The ${margin}px margins are outside the border box, and the ${padV}px vertical padding does not affect width.`,
        answer: String(answer),
      },
    };
  },
};

/* ------------------------------------------------------------------ */
/* EASY: hexToRgb slice bug                                            */
/* ------------------------------------------------------------------ */

function refHexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
}

/** What the buggy starter computes (blue = slice(3, 5)). */
function buggyHexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(3, 5), 16)})`;
}

type Rng = ReturnType<typeof rngFor>;

function randHex(r: Rng, upper = false): string {
  const s = '#' + [0, 1, 2].map(() => r.int(0, 255).toString(16).padStart(2, '0')).join('');
  return upper ? s.toUpperCase() : s;
}

/** Random colour whose buggy conversion differs from the correct one. */
function revealingHex(r: Rng, upper = false): string {
  for (;;) {
    const c = randHex(r, upper);
    if (buggyHexToRgb(c) !== refHexToRgb(c)) return c;
  }
}

const PALETTES = ['Skeld Neon', 'Polus Frost', 'Mira Sunset', 'Airship Brass', 'Fungle Moss', 'Reactor Glow', 'Vent Shadow', 'Comet Dust'];

const hexToRgb: TaskTemplate = {
  key: 'design-hex-to-rgb',
  domain: 'design',
  difficulty: 'EASY',
  variant: (seed) => {
    const r = rngFor(seed, 202);
    const palette = bySeed(PALETTES, seed);
    const colors = [revealingHex(r), randHex(r), randHex(r, r.next() < 0.5), randHex(r)];
    const html = `<!doctype html>
<html>
<head><link rel="stylesheet" href="style.css"></head>
<body>
  <h1>${palette} palette</h1>
  <div id="swatches" class="swatches"></div>
  <script src="script.js"></script>
</body>
</html>
`;
    const css = `${BASE_CSS}.swatches { display: flex; gap: 8px; flex-wrap: wrap; }
.swatch { width: 120px; height: 80px; border-radius: 8px; font: 11px monospace; padding: 4px; color: #000; background: #fff; }
`;
    const script = `// ${palette} swatch builder
const PALETTE = ${JSON.stringify(colors)};

// Converts "#rrggbb" (any letter case) to "rgb(r, g, b)" with decimal channels.
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(3, 5), 16);
  return 'rgb(' + r + ', ' + g + ', ' + b + ')';
}

if (typeof document !== 'undefined') {
  const box = document.getElementById('swatches');
  for (const hex of PALETTE) {
    const div = document.createElement('div');
    div.className = 'swatch';
    div.style.background = hexToRgb(hex);
    div.textContent = hex + ' -> ' + hexToRgb(hex);
    box.appendChild(div);
  }
}
`;
    const fixed = mustReplace(script, 'const b = parseInt(h.slice(3, 5), 16);', 'const b = parseInt(h.slice(4, 6), 16);');
    const cases = [
      colors,
      ['#000000', '#FFFFFF'],
      [revealingHex(r, true), randHex(r), `#0${r.int(0, 9)}0${r.int(0, 9)}0${r.int(1, 9)}`],
      [colors[r.int(0, 3)].toUpperCase(), revealingHex(r)],
    ];
    const tests = cases.map((c, i) => ({ name: `hex-${i + 1}`, stdin: JSON.stringify({ hexes: c }), expected: c.map(refHexToRgb).join('\n') }));
    return {
      title: `${palette} swatches look wrong`,
      statement: `The ${palette} palette preview in the Design Lab shows swatches in a slightly wrong tint — ${colors[0]} comes out as ${buggyHexToRgb(colors[0])} instead of ${refHexToRgb(colors[0])}.\n\nFix hexToRgb(hex) in script.js so "#rrggbb" (upper or lower case) converts to the string "rgb(r, g, b)" with decimal channel values, e.g. "#ff8000" -> "rgb(255, 128, 0)". Use Refresh Preview to compare the swatches. Final verification calls hexToRgb() with hidden colors.`,
      workspace: 'DESIGN',
      runLanguage: 'javascript',
      runEntry: 'script.js',
      files: jsFiles(html, css, script),
      answerFormat: 'Submit your edited files. Hidden tests print hexToRgb(hex) for several colors, one per line, compared exactly (format "rgb(r, g, b)").',
      validation: {
        mode: 'CODE_TESTS',
        language: 'javascript',
        entry: 'harness.js',
        harness: [webHarness(`console.log(input.hexes.map(function (h) { return ctx.hexToRgb(h); }).join('\\n'));`)],
        tests,
      },
      hint: 'Each channel is two hex digits. Write out the character positions of "rrggbb" and compare them with the slice() ranges.',
      solution: { explanation: 'The blue channel sliced characters 3..5 (overlapping green); it must be slice(4, 6).', files: { 'script.js': fixed } },
    };
  },
};

/* ------------------------------------------------------------------ */
/* MEDIUM: grid fr track width                                         */
/* ------------------------------------------------------------------ */

const PANELS = ['admin-map', 'vitals-panel', 'cams-grid', 'log-board', 'nav-chart', 'fuel-gauge', 'crew-roster', 'sample-rack'];

const gridTrack: TaskTemplate = {
  key: 'design-grid-track',
  domain: 'design',
  difficulty: 'MEDIUM',
  variant: (seed) => {
    const r = rngFor(seed, 313);
    const panel = bySeed(PANELS, seed);
    const n = r.int(3, 4);
    // Tracks: number = fixed px, string 'Nfr' = flexible. At least one of each.
    let kinds: boolean[];
    do {
      kinds = Array.from({ length: n }, () => r.next() < 0.5);
    } while (!kinds.includes(true) || !kinds.includes(false));
    const tracks: (number | string)[] = kinds.map((isFr) => (isFr ? `${r.int(1, 4)}fr` : r.int(8, 26) * 10));
    const frIdx = tracks.map((t, i) => (typeof t === 'string' ? i : -1)).filter((i) => i >= 0);
    const targetIdx = r.pick(frIdx);
    const pad = r.int(8, 36);
    const border = r.int(1, 5);
    const gap = r.int(4, 14) * 2;
    const fixedSum = tracks.reduce<number>((s, t) => s + (typeof t === 'number' ? t : 0), 0);
    const frSum = tracks.reduce<number>((s, t) => s + (typeof t === 'string' ? parseFloat(t) : 0), 0);
    // Free space >= 360px, so every fr track is far wider than its one-digit content.
    const free = 360 + perm(seed, 53, 11, 401);
    const width = free + fixedSum + gap * (n - 1) + 2 * pad + 2 * border;
    const inner = width - 2 * pad - 2 * border; // box-sizing: border-box
    const target = tracks[targetIdx] as string;
    const answer = round2((free * parseFloat(target)) / frSum);
    const template = tracks.map((t) => (typeof t === 'number' ? `${t}px` : t)).join(' ');
    const cells = tracks.map((_, i) => `    <div class="cell c${i + 1}">${i + 1}</div>`).join('\n');
    const html = `<!doctype html>
<html>
<head><link rel="stylesheet" href="style.css"></head>
<body>
  <h1>Design Lab: .${panel}</h1>
  <div class="${panel}">
${cells}
  </div>
</body>
</html>
`;
    const css = `${BASE_CSS}.${panel} {
  box-sizing: border-box;
  width: ${width}px;
  padding: ${pad}px;
  border: ${border}px solid #dea4ca;
  display: grid;
  grid-template-columns: ${template};
  gap: ${gap}px;
}
.cell { background: #2c2238; min-height: 60px; text-align: center; }
`;
    const ordinal = ['1st', '2nd', '3rd', '4th'][targetIdx];
    return {
      title: `Grid track width in .${panel}`,
      statement: `The ${panel.replace('-', ' ')} layout on the bridge display uses a ${width}px-wide CSS grid (see style.css). The engineers need the exact width of the ${ordinal} column (.c${targetIdx + 1}) to export icons at the right size.\n\nGiven the container's width, box-sizing, padding, border, gap and grid-template-columns: ${template}, what is the width in pixels of the ${ordinal} column track? (The cells contain only a short number, so content never forces a track wider.)`,
      workspace: 'DESIGN',
      runLanguage: null,
      files: previewFiles(html, css),
      answerFormat: 'Submit a number of pixels without units, rounded to 2 decimal places (e.g. 123.45). Compared numerically with tolerance 0.01.',
      validation: { mode: 'NUMERIC', answer, tolerance: 0.01 },
      hint: 'With border-box, padding and border come out of the declared width first. Then subtract the fixed tracks and every gap between columns; only what remains is shared by the fr units.',
      solution: {
        explanation: `Content width = ${width} - 2x${pad} - 2x${border} = ${inner}. Free space = ${inner} - ${fixedSum} (fixed) - ${n - 1}x${gap} (gaps) = ${free}. 1fr = ${free}/${frSum}; ${target} = ${fmt(answer)}px.`,
        answer: fmt(answer),
      },
    };
  },
};

/* ------------------------------------------------------------------ */
/* MEDIUM: WCAG contrast ratio + level                                 */
/* ------------------------------------------------------------------ */

function refChannel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function refLum(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * refChannel(r) + 0.7152 * refChannel(g) + 0.0722 * refChannel(b);
}
function refContrast(fg: string, bg: string): number {
  const l1 = refLum(fg);
  const l2 = refLum(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function refLevel(ratio: number, large: boolean): string {
  const aa = large ? 3 : 4.5;
  const aaa = large ? 4.5 : 7;
  if (ratio >= aaa) return 'AAA';
  if (ratio >= aa) return 'AA';
  return 'FAIL';
}

const SCREENS = ['Emergency Button', 'Vote Screen', 'Task List', 'Kill Cooldown HUD', 'Chat Panel', 'Map Overlay', 'Lobby Menu', 'Settings Page'];

const contrastCheck: TaskTemplate = {
  key: 'design-contrast-check',
  domain: 'design',
  difficulty: 'MEDIUM',
  variant: (seed) => {
    const r = rngFor(seed, 404);
    const screen = bySeed(SCREENS, seed);
    type Pair = { fg: string; bg: string; large: boolean };
    const grey = () => {
      const g = r.int(0, 255).toString(16).padStart(2, '0');
      return `#${g}${g}${g}`;
    };
    const colour = () => (r.next() < 0.3 ? grey() : randHex(r));
    // Five pairs: one dark-on-light (fg darker than bg, so the unordered ratio drops below 1),
    // one light-on-dark, three random. Large flags random.
    const pairs: Pair[] = [];
    for (let i = 0; i < 5; i++) {
      let fg = colour();
      let bg = colour();
      while (refLum(fg) === refLum(bg)) bg = colour();
      const lf = refLum(fg);
      const lb = refLum(bg);
      if ((i === 0 && lf > lb) || (i === 1 && lf < lb)) [fg, bg] = [bg, fg];
      pairs.push({ fg, bg, large: r.next() < 0.4 });
    }
    const pairs0 = pairs;
    const html = `<!doctype html>
<html>
<head><link rel="stylesheet" href="style.css"></head>
<body>
  <h1>${screen} contrast audit</h1>
  <table id="audit"></table>
  <script src="script.js"></script>
</body>
</html>
`;
    const css = `${BASE_CSS}table { border-collapse: collapse; font-family: monospace; }
td { padding: 6px 10px; border: 1px solid #4b3a5a; }
`;
    const script = `// ${screen} accessibility audit (WCAG 2.x contrast)
const PAIRS = ${JSON.stringify(pairs0)};

// sRGB channel 0..255 -> linear value
function channel(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

// Relative luminance of "#rrggbb"
function luminance(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// WCAG contrast ratio, always >= 1 regardless of argument order.
function contrastRatio(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  return (l1 + 0.05) / (l2 + 0.05);
}

// 'AAA', 'AA' or 'FAIL'.
// Normal text: AA needs >= 4.5, AAA needs >= 7.
// Large text:  AA needs >= 3,   AAA needs >= 4.5.
function wcagLevel(ratio, largeText) {
  const aa = largeText ? 4.5 : 3;
  const aaa = largeText ? 7 : 4.5;
  if (ratio >= aaa) return 'AAA';
  if (ratio >= aa) return 'AA';
  return 'FAIL';
}

if (typeof document !== 'undefined') {
  const table = document.getElementById('audit');
  for (const p of PAIRS) {
    const r = contrastRatio(p.fg, p.bg);
    const tr = document.createElement('tr');
    tr.innerHTML = '<td style="color:' + p.fg + ';background:' + p.bg + '">Sample</td><td>' + r.toFixed(2) + ':1</td><td>' + wcagLevel(r, p.large) + (p.large ? ' (large)' : '') + '</td>';
    table.appendChild(tr);
  }
}
`;
    const fixed = mustReplace(
      mustReplace(script, 'return (l1 + 0.05) / (l2 + 0.05);', 'return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);'),
      "const aa = largeText ? 4.5 : 3;\n  const aaa = largeText ? 7 : 4.5;",
      "const aa = largeText ? 3 : 4.5;\n  const aaa = largeText ? 4.5 : 7;",
    );
    const fmtRow = (p: Pair) => {
      const ratio = refContrast(p.fg, p.bg);
      return `${ratio.toFixed(2)} ${refLevel(ratio, p.large)}`;
    };
    const cases: Pair[][] = [
      pairs0,
      // Black text on white: the unordered ratio is ~0.05, so the starter always fails this case.
      [{ fg: '#000000', bg: '#ffffff', large: false }, { fg: '#ffffff', bg: '#000000', large: true }, { fg: colour(), bg: colour(), large: r.next() < 0.5 }],
      [pairs0[2], { ...pairs0[2], large: !pairs0[2].large }],
      [{ fg: pairs0[1].bg, bg: pairs0[1].fg, large: true }, { fg: pairs0[3].fg, bg: pairs0[3].fg, large: false }],
    ];
    const tests = cases.map((c, i) => ({ name: `contrast-${i + 1}`, stdin: JSON.stringify({ pairs: c }), expected: c.map(fmtRow).join('\n') }));
    const p0 = pairs0[0];
    const shownBuggy = ((refLum(p0.fg) + 0.05) / (refLum(p0.bg) + 0.05)).toFixed(2);
    return {
      title: `${screen} contrast audit`,
      statement: `The accessibility audit for the ${screen} reports nonsense: the pair ${p0.fg} on ${p0.bg} scores ${shownBuggy}:1 (below 1:1!), and large headings are judged more strictly than body text.\n\nFix script.js:\n- contrastRatio(fg, bg) must return the WCAG contrast ratio (L_lighter + 0.05) / (L_darker + 0.05), so it is always >= 1 no matter which colour is passed first;\n- wcagLevel(ratio, largeText) must return 'AAA', 'AA' or 'FAIL' using: normal text AA >= 4.5, AAA >= 7; large text AA >= 3, AAA >= 4.5.\n\nThe luminance formula itself is correct. Final verification audits hidden colour pairs.`,
      workspace: 'DESIGN',
      runLanguage: 'javascript',
      runEntry: 'script.js',
      files: jsFiles(html, css, script),
      answerFormat: 'Submit your edited files. For each hidden pair the tests print "<ratio.toFixed(2)> <level>" (e.g. "4.54 AA"), one per line, compared exactly.',
      validation: {
        mode: 'CODE_TESTS',
        language: 'javascript',
        entry: 'harness.js',
        harness: [
          webHarness(`console.log(input.pairs.map(function (p) { const r = ctx.contrastRatio(p.fg, p.bg); return r.toFixed(2) + ' ' + ctx.wcagLevel(r, p.large); }).join('\\n'));`),
        ],
        tests,
      },
      hint: 'WCAG puts the LIGHTER luminance on top of the fraction — the code assumes the foreground is lighter. Then re-read the thresholds: large text is allowed a LOWER ratio.',
      solution: {
        explanation: `contrastRatio must use max/min of the two luminances (${p0.fg} on ${p0.bg} is really ${fmtRow(p0)}), and wcagLevel had the normal/large thresholds swapped.`,
        files: { 'script.js': fixed },
      },
    };
  },
};

/* ------------------------------------------------------------------ */
/* HARD: flex-shrink distribution                                      */
/* ------------------------------------------------------------------ */

const BARS = ['task-bar', 'chat-dock', 'vote-strip', 'hud-row', 'tool-belt', 'map-legend', 'emote-tray', 'alert-rail'];

const flexShrink: TaskTemplate = {
  key: 'design-flex-shrink',
  domain: 'design',
  difficulty: 'HARD',
  variant: (seed) => {
    const r = rngFor(seed, 505);
    const bar = bySeed(BARS, seed);
    const n = r.int(3, 4);
    const pad = r.int(10, 32);
    const border = r.int(1, 4);
    const gap = r.int(4, 12) * 2;
    const target = r.int(0, n - 1);
    const overflow = 60 + perm(seed, 61, 17, 211) % 140; // 60..199 px of negative free space
    let basis: number[];
    let shrink: number[];
    let mx: number[];
    let widths: number[];
    let free: number;
    let scaled: number[];
    let scaledSum: number;
    let outerSum: number;
    // Retry (deterministically) until shrink factors differ and every pod stays comfortably positive.
    for (;;) {
      basis = Array.from({ length: n }, () => r.int(12, 32) * 10);
      shrink = Array.from({ length: n }, () => r.int(1, 4));
      mx = Array.from({ length: n }, () => (r.next() < 0.35 ? r.int(2, 10) : 0));
      if (!mx.some((m) => m > 0)) mx[r.int(0, n - 1)] = r.int(2, 10);
      outerSum = basis.reduce((s, b, i) => s + b + 2 * mx[i], 0);
      free = -overflow;
      scaled = basis.map((b, i) => b * shrink[i]);
      scaledSum = scaled.reduce((s, x) => s + x, 0);
      widths = basis.map((b, i) => b + (free * scaled[i]) / scaledSum);
      if (new Set(shrink).size > 1 && widths.every((w) => w >= 40)) break;
    }
    const width = outerSum + gap * (n - 1) + free + 2 * pad + 2 * border;
    const inner = width - 2 * pad - 2 * border; // border-box container
    if (free >= 0 || widths.some((w) => w <= 0)) throw new Error('bad flex params');
    const answer = round2(widths[target]);
    const items = basis.map((_, i) => `    <div class="pod p${i + 1}">pod ${i + 1}</div>`).join('\n');
    const itemCss = basis
      .map((b, i) => `.p${i + 1} { flex: 0 ${shrink[i]} ${b}px;${mx[i] ? ` margin: 0 ${mx[i]}px;` : ''} }`)
      .join('\n');
    const html = `<!doctype html>
<html>
<head><link rel="stylesheet" href="style.css"></head>
<body>
  <h1>Design Lab: .${bar}</h1>
  <div class="${bar}">
${items}
  </div>
</body>
</html>
`;
    const css = `${BASE_CSS}.${bar} {
  box-sizing: border-box;
  width: ${width}px;
  padding: ${pad}px;
  border: ${border}px solid #dea4ca;
  display: flex;
  gap: ${gap}px;
}
.pod {
  box-sizing: border-box;
  min-width: 0;
  padding: 0;
  border: none;
  overflow: hidden;
  background: #2c2238;
  height: 48px;
}
${itemCss}
`;
    return {
      title: `Squeezed pods in .${bar}`,
      statement: `The ${width}px-wide .${bar} on the cockpit HUD holds ${n} pods whose flex-basis values add up to more than the space available, so the browser shrinks them. A designer guessed every pod shrinks by the same amount — the screenshots say otherwise.\n\nUsing style.css (container: border-box with padding, border and gap; pods: flex-grow 0, individual flex-shrink and flex-basis, some with horizontal margins, min-width 0, no padding or border), what is the final rendered width in pixels of .p${target + 1}?\n\nRemember how CSS flexbox distributes negative free space: it is not split equally, nor purely by flex-shrink.`,
      workspace: 'DESIGN',
      runLanguage: null,
      files: previewFiles(html, css),
      answerFormat: 'Submit a number of pixels without units, rounded to 2 decimal places (e.g. 133.2). Compared numerically with tolerance 0.01.',
      validation: { mode: 'NUMERIC', answer, tolerance: 0.01 },
      hint: 'Negative free space = content width - (sum of flex-basis + margins) - gaps. Each item absorbs a share proportional to flex-shrink x flex-basis (its "scaled shrink factor").',
      solution: {
        explanation: `Container content = ${width} - 2x${pad} - 2x${border} = ${inner}. Used = ${outerSum} (bases + margins) + ${n - 1}x${gap} (gaps), so free space = ${free}. Scaled shrink factors (shrink x basis) = [${scaled.join(', ')}], total ${scaledSum}. .p${target + 1} = ${basis[target]} + (${free}) x ${scaled[target]}/${scaledSum} = ${fmt(widths[target])}px.`,
        answer: fmt(answer),
      },
    };
  },
};

export const designTemplates: TaskTemplate[] = [boxWidth, hexToRgb, gridTrack, contrastCheck, flexShrink];
