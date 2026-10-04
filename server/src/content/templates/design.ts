import type { StarterFile, TaskTemplate } from '../types.js';
import { webHarness } from './web.js';

/**
 * DESIGN LAB / Designing.
 *
 * All tasks are deterministic: either a CSS layout computation answered as a
 * number (the expected value is computed here from the variant parameters,
 * following the CSS spec), or a JS design-utility function verified with
 * hidden tests through the shared web harness.
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

const boxWidth: TaskTemplate = {
  key: 'design-box-width',
  domain: 'design',
  difficulty: 'EASY',
  variant: (v) => {
    const card = ['crew-card', 'vote-card', 'task-card', 'map-card'][v];
    const p = [
      { width: 280, padL: 16, padR: 24, border: 3, margin: 20 },
      { width: 320, padL: 12, padR: 12, border: 5, margin: 14 },
      { width: 250, padL: 30, padR: 18, border: 2, margin: 32 },
      { width: 360, padL: 20, padR: 28, border: 4, margin: 10 },
    ][v];
    const answer = p.width + p.padL + p.padR + 2 * p.border;
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
  width: ${p.width}px;
  padding: 10px ${p.padR}px 10px ${p.padL}px;
  border: ${p.border}px solid #dea4ca;
  margin: 0 ${p.margin}px;
  background: #2c2238;
}
`;
    return {
      title: `How wide is .${card}?`,
      statement: `The Design Lab mock-up for the .${card} component overflows its slot on the ship's tablet. Before resizing anything, the crew needs the exact rendered width.\n\nUsing style.css (box-sizing is content-box for every element), what is the rendered width of .${card} in pixels — the width of its border box (content + padding + border, NOT margin), i.e. what getBoundingClientRect().width reports?`,
      workspace: 'DESIGN',
      runLanguage: null,
      files: previewFiles(html, css),
      answerFormat: 'Submit a single number of pixels without units (e.g. 312). Compared numerically; must be exact (tolerance 0).',
      validation: { mode: 'NUMERIC', answer, tolerance: 0 },
      hint: 'With content-box, `width` only sets the content area. Add the left and right padding and both borders; margins sit outside the box.',
      solution: {
        explanation: `${p.width} (content) + ${p.padL} + ${p.padR} (padding) + 2 x ${p.border} (border) = ${answer}px. The ${p.margin}px margins are outside the border box.`,
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

const hexToRgb: TaskTemplate = {
  key: 'design-hex-to-rgb',
  domain: 'design',
  difficulty: 'EASY',
  variant: (v) => {
    const palette = ['Skeld Neon', 'Polus Frost', 'Mira Sunset', 'Airship Brass'][v];
    const colors = [
      ['#c51111', '#132ed1', '#117f2d', '#ed54ba'],
      ['#ef7d0d', '#f5f557', '#3f474e', '#d6e0f0'],
      ['#6b2fbb', '#71491e', '#38fedc', '#50ef39'],
      ['#ffffff', '#ec7578', '#b5a2ec', '#e8cf8e'],
    ][v];
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
    const cases = [colors, ['#000000', '#FFFFFF'], [`#0a0b0${v}`, '#ABCDEF'], [colors[v], '#123456']];
    const tests = cases.map((c, i) => ({ name: `hex-${i + 1}`, stdin: JSON.stringify({ hexes: c }), expected: c.map(refHexToRgb).join('\n') }));
    return {
      title: `${palette} swatches look wrong`,
      statement: `The ${palette} palette preview in the Design Lab shows every swatch in a slightly wrong tint — ${colors[0]} does not come out as ${refHexToRgb(colors[0])}.\n\nFix hexToRgb(hex) in script.js so "#rrggbb" (upper or lower case) converts to the string "rgb(r, g, b)" with decimal channel values, e.g. "#ff8000" -> "rgb(255, 128, 0)". Use Refresh Preview to compare the swatches. Final verification calls hexToRgb() with hidden colors.`,
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

const gridTrack: TaskTemplate = {
  key: 'design-grid-track',
  domain: 'design',
  difficulty: 'MEDIUM',
  variant: (v) => {
    const panel = ['admin-map', 'vitals-panel', 'cams-grid', 'log-board'][v];
    // Tracks: number = fixed px, string 'Nfr' = flexible.
    const p = [
      { width: 960, pad: 24, border: 2, gap: 16, tracks: [180, '1fr', '2fr'] as (number | string)[], target: 2 },
      { width: 1100, pad: 30, border: 4, gap: 20, tracks: ['3fr', 220, '2fr', 120] as (number | string)[], target: 0 },
      { width: 840, pad: 18, border: 3, gap: 12, tracks: [150, '1fr', 150, '3fr'] as (number | string)[], target: 3 },
      { width: 1024, pad: 32, border: 1, gap: 24, tracks: ['1fr', '1fr', 200, '4fr'] as (number | string)[], target: 3 },
    ][v];
    const inner = p.width - 2 * p.pad - 2 * p.border; // box-sizing: border-box
    const fixedSum = p.tracks.reduce<number>((s, t) => s + (typeof t === 'number' ? t : 0), 0);
    const frSum = p.tracks.reduce<number>((s, t) => s + (typeof t === 'string' ? parseFloat(t) : 0), 0);
    const free = inner - fixedSum - p.gap * (p.tracks.length - 1);
    const target = p.tracks[p.target];
    if (typeof target !== 'string' || free <= 0) throw new Error('bad grid params');
    const answer = round2((free * parseFloat(target)) / frSum);
    const template = p.tracks.map((t) => (typeof t === 'number' ? `${t}px` : t)).join(' ');
    const cells = p.tracks.map((_, i) => `    <div class="cell c${i + 1}">${i + 1}</div>`).join('\n');
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
  width: ${p.width}px;
  padding: ${p.pad}px;
  border: ${p.border}px solid #dea4ca;
  display: grid;
  grid-template-columns: ${template};
  gap: ${p.gap}px;
}
.cell { background: #2c2238; min-height: 60px; text-align: center; }
`;
    const ordinal = ['1st', '2nd', '3rd', '4th'][p.target];
    return {
      title: `Grid track width in .${panel}`,
      statement: `The ${panel.replace('-', ' ')} layout on the bridge display uses a CSS grid (see style.css). The engineers need the exact width of the ${ordinal} column (.c${p.target + 1}) to export icons at the right size.\n\nGiven the container's width, box-sizing, padding, border, gap and grid-template-columns: ${template}, what is the width in pixels of the ${ordinal} column track? (The cells contain only a short number, so content never forces a track wider.)`,
      workspace: 'DESIGN',
      runLanguage: null,
      files: previewFiles(html, css),
      answerFormat: 'Submit a number of pixels without units, rounded to 2 decimal places (e.g. 123.45). Compared numerically with tolerance 0.01.',
      validation: { mode: 'NUMERIC', answer, tolerance: 0.01 },
      hint: 'With border-box, padding and border come out of the declared width first. Then subtract the fixed tracks and every gap between columns; only what remains is shared by the fr units.',
      solution: {
        explanation: `Content width = ${p.width} - 2x${p.pad} - 2x${p.border} = ${inner}. Free space = ${inner} - ${fixedSum} (fixed) - ${p.tracks.length - 1}x${p.gap} (gaps) = ${free}. 1fr = ${free}/${frSum}; ${target} = ${answer}px.`,
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

const contrastCheck: TaskTemplate = {
  key: 'design-contrast-check',
  domain: 'design',
  difficulty: 'MEDIUM',
  variant: (v) => {
    const screen = ['Emergency Button', 'Vote Screen', 'Task List', 'Kill Cooldown HUD'][v];
    type Pair = { fg: string; bg: string; large: boolean };
    const pairs: Pair[][] = [
      [
        { fg: '#1b1424', bg: '#dea4ca', large: false },
        { fg: '#ffffff', bg: '#c51111', large: true },
        { fg: '#777777', bg: '#ffffff', large: false },
        { fg: '#f5f557', bg: '#3f474e', large: false },
        { fg: '#5a5a5a', bg: '#9a9a9a', large: true },
      ],
      [
        { fg: '#ffffff', bg: '#132ed1', large: false },
        { fg: '#e8cf8e', bg: '#10202b', large: true },
        { fg: '#666666', bg: '#eeeeee', large: false },
        { fg: '#888888', bg: '#ffffff', large: true },
        { fg: '#2b2b2b', bg: '#6a6a6a', large: false },
      ],
      [
        { fg: '#38fedc', bg: '#1b1424', large: false },
        { fg: '#ffffff', bg: '#117f2d', large: false },
        { fg: '#959595', bg: '#ffffff', large: true },
        { fg: '#ec7578', bg: '#ffffff', large: true },
        { fg: '#000000', bg: '#545454', large: false },
      ],
      [
        { fg: '#ef7d0d', bg: '#000000', large: true },
        { fg: '#ffffff', bg: '#6b2fbb', large: false },
        { fg: '#757575', bg: '#ffffff', large: false },
        { fg: '#b5a2ec', bg: '#2c2238', large: true },
        { fg: '#444444', bg: '#8f8f8f', large: true },
      ],
    ];
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
const PAIRS = ${JSON.stringify(pairs[v])};

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
      const r = refContrast(p.fg, p.bg);
      return `${r.toFixed(2)} ${refLevel(r, p.large)}`;
    };
    const cases: Pair[][] = [
      pairs[v],
      [{ fg: '#000000', bg: '#ffffff', large: false }, { fg: '#ffffff', bg: '#000000', large: true }],
      [pairs[v][2], { ...pairs[v][2], large: !pairs[v][2].large }],
      [{ fg: pairs[v][0].bg, bg: pairs[v][0].fg, large: true }, { fg: '#808080', bg: '#808080', large: false }],
    ];
    const tests = cases.map((c, i) => ({ name: `contrast-${i + 1}`, stdin: JSON.stringify({ pairs: c }), expected: c.map(fmtRow).join('\n') }));
    return {
      title: `${screen} contrast audit`,
      statement: `The accessibility audit for the ${screen} reports nonsense: some colour pairs score below 1:1, and large headings are judged more strictly than body text.\n\nFix script.js:\n- contrastRatio(fg, bg) must return the WCAG contrast ratio (L_lighter + 0.05) / (L_darker + 0.05), so it is always >= 1 no matter which colour is passed first;\n- wcagLevel(ratio, largeText) must return 'AAA', 'AA' or 'FAIL' using: normal text AA >= 4.5, AAA >= 7; large text AA >= 3, AAA >= 4.5.\n\nThe luminance formula itself is correct. Final verification audits hidden colour pairs.`,
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
        explanation: 'contrastRatio must use max/min of the two luminances, and wcagLevel had the normal/large thresholds swapped.',
        files: { 'script.js': fixed },
      },
    };
  },
};

/* ------------------------------------------------------------------ */
/* HARD: flex-shrink distribution                                      */
/* ------------------------------------------------------------------ */

const flexShrink: TaskTemplate = {
  key: 'design-flex-shrink',
  domain: 'design',
  difficulty: 'HARD',
  variant: (v) => {
    const bar = ['task-bar', 'chat-dock', 'vote-strip', 'hud-row'][v];
    const p = [
      { width: 600, pad: 20, border: 2, gap: 12, basis: [240, 180, 200], shrink: [1, 2, 1], mx: [0, 8, 0], target: 1 },
      { width: 720, pad: 24, border: 4, gap: 16, basis: [300, 260, 180], shrink: [3, 1, 2], mx: [6, 0, 6], target: 0 },
      { width: 480, pad: 16, border: 1, gap: 8, basis: [200, 150, 150], shrink: [1, 1, 3], mx: [0, 5, 0], target: 2 },
      { width: 840, pad: 30, border: 3, gap: 20, basis: [260, 220, 180, 160], shrink: [2, 1, 1, 3], mx: [0, 0, 10, 0], target: 3 },
    ][v];
    const n = p.basis.length;
    const inner = p.width - 2 * p.pad - 2 * p.border; // border-box container
    const outerSum = p.basis.reduce((s, b, i) => s + b + 2 * p.mx[i], 0);
    const free = inner - outerSum - p.gap * (n - 1);
    const scaled = p.basis.map((b, i) => b * p.shrink[i]);
    const scaledSum = scaled.reduce((s, x) => s + x, 0);
    const widths = p.basis.map((b, i) => b + (free * scaled[i]) / scaledSum);
    if (free >= 0 || widths.some((w) => w <= 0)) throw new Error('bad flex params');
    const answer = round2(widths[p.target]);
    const items = p.basis.map((_, i) => `    <div class="pod p${i + 1}">pod ${i + 1}</div>`).join('\n');
    const itemCss = p.basis
      .map((b, i) => `.p${i + 1} { flex: 0 ${p.shrink[i]} ${b}px;${p.mx[i] ? ` margin: 0 ${p.mx[i]}px;` : ''} }`)
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
  width: ${p.width}px;
  padding: ${p.pad}px;
  border: ${p.border}px solid #dea4ca;
  display: flex;
  gap: ${p.gap}px;
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
      statement: `The .${bar} on the cockpit HUD holds ${n} pods whose flex-basis values add up to more than the space available, so the browser shrinks them. A designer guessed every pod shrinks by the same amount — the screenshots say otherwise.\n\nUsing style.css (container: border-box with padding, border and gap; pods: flex-grow 0, individual flex-shrink and flex-basis, some with horizontal margins, min-width 0, no padding or border), what is the final rendered width in pixels of .p${p.target + 1}?\n\nRemember how CSS flexbox distributes negative free space: it is not split equally, nor purely by flex-shrink.`,
      workspace: 'DESIGN',
      runLanguage: null,
      files: previewFiles(html, css),
      answerFormat: 'Submit a number of pixels without units, rounded to 2 decimal places (e.g. 133.2). Compared numerically with tolerance 0.01.',
      validation: { mode: 'NUMERIC', answer, tolerance: 0.01 },
      hint: 'Negative free space = content width - (sum of flex-basis + margins) - gaps. Each item absorbs a share proportional to flex-shrink x flex-basis (its "scaled shrink factor").',
      solution: {
        explanation: `Container content = ${p.width} - 2x${p.pad} - 2x${p.border} = ${inner}. Used = ${outerSum} (bases + margins) + ${n - 1}x${p.gap} (gaps), so free space = ${free}. Scaled shrink factors (shrink x basis) = [${scaled.join(', ')}], total ${scaledSum}. .p${p.target + 1} = ${p.basis[p.target]} + (${free}) x ${scaled[p.target]}/${scaledSum} = ${fmt(widths[p.target])}px.`,
        answer: fmt(answer),
      },
    };
  },
};

export const designTemplates: TaskTemplate[] = [boxWidth, hexToRgb, gridTrack, contrastCheck, flexShrink];
