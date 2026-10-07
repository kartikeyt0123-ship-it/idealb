/** Pure helpers for the task workspace (drafts, preview document, CSV, languages, errors). */
import { ApiError, type QuestionDetail, type TaskFile } from '../lib/api';

// ---------------------------------------------------------------------------
// Drafts (localStorage; best effort, never throws)
// ---------------------------------------------------------------------------

export interface DraftScope {
  crewId: string;
  questionId: string;
  generation: number;
}

const PREFIX = 'amongbug:draft:v2';
export const draftKey = (s: DraftScope, name: string) => `${PREFIX}:${s.crewId}:${s.questionId}:g${s.generation}:${name}`;

export function readDraft(s: DraftScope, name: string): string | null {
  try {
    return window.localStorage.getItem(draftKey(s, name));
  } catch {
    return null;
  }
}

/** Returns false when storage is unavailable or full. */
export function writeDraft(s: DraftScope, name: string, value: string | null): boolean {
  try {
    if (value === null) window.localStorage.removeItem(draftKey(s, name));
    else window.localStorage.setItem(draftKey(s, name), value);
    return true;
  } catch {
    return false;
  }
}

export function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(`amongbugs:pref:${key}`);
  } catch {
    return null;
  }
}
export function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(`amongbugs:pref:${key}`, value);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

export function monacoLanguage(file: Pick<TaskFile, 'name' | 'language'>): string {
  const l = (file.language || '').toLowerCase();
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (l === 'javascript' || l === 'js' || ext === 'js' || ext === 'mjs' || ext === 'cjs') return 'javascript';
  if (l === 'python' || l === 'py' || ext === 'py') return 'python';
  if (l === 'html' || ext === 'html' || ext === 'htm') return 'html';
  if (l === 'css' || ext === 'css') return 'css';
  if (l === 'json' || ext === 'json') return 'json';
  if (l === 'sql' || ext === 'sql') return 'sql';
  if (l === 'markdown' || ext === 'md') return 'markdown';
  return 'plaintext';
}

export const isCsv = (f: Pick<TaskFile, 'name' | 'language'>) => f.language?.toLowerCase() === 'csv' || /\.csv$/i.test(f.name);
export const isHtml = (f: Pick<TaskFile, 'name'>) => /\.html?$/i.test(f.name);

// ---------------------------------------------------------------------------
// Workspace kind
// ---------------------------------------------------------------------------

export type RightKind = 'WEB' | 'DATA' | 'RUN' | 'EVIDENCE' | 'SHELL' | 'SQL' | 'JSON';

export function rightKind(d: Pick<QuestionDetail, 'workspace' | 'runLanguage' | 'files' | 'runtimeKind'>): RightKind {
  const hasIndex = d.files.some((f) => f.name.toLowerCase() === 'index.html');
  if (d.workspace === 'SHELL' || d.runtimeKind === 'shell') return 'SHELL';
  if (d.workspace === 'SQL' || d.runtimeKind === 'sql') return 'SQL';
  if (d.workspace === 'JSON' || d.runtimeKind === 'json') return 'JSON';
  if (d.workspace === 'EVIDENCE') return 'EVIDENCE';
  if (d.workspace === 'WEB' || (d.workspace === 'DESIGN' && hasIndex)) return 'WEB';
  if (d.workspace === 'DATA') return 'DATA';
  if (d.runLanguage || d.runtimeKind === 'python' || d.runtimeKind === 'code') return 'RUN';
  if (hasIndex) return 'WEB';
  return 'EVIDENCE';
}

// ---------------------------------------------------------------------------
// Live preview document
// ---------------------------------------------------------------------------

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
}
function normalizeRef(ref: string): string {
  return ref.trim().replace(/[?#].*$/, '').replace(/^\.?\//, '');
}

/**
 * Build the full HTML document for the sandbox: index.html with local
 * <link rel=stylesheet>/<script src> (and local SVG image refs) replaced by the
 * current editor contents, inlined. Remote URLs are left untouched (the
 * sandbox's CSP blocks network anyway).
 */
export function buildPreviewDoc(files: TaskFile[], contents: Record<string, string>): string | null {
  const index = files.find((f) => f.name.toLowerCase() === 'index.html') ?? files.find(isHtml);
  if (!index) return null;
  const byName = new Map<string, string>();
  for (const f of files) byName.set(f.name.toLowerCase(), contents[f.name] ?? f.content);
  const lookup = (ref: string | null) => (ref == null ? undefined : byName.get(normalizeRef(ref).toLowerCase()));

  let html = byName.get(index.name.toLowerCase()) ?? '';
  const deferred: string[] = [];

  const used = new Set<string>([index.name.toLowerCase()]);
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase();
    const css = lookup(attr(tag, 'href'));
    if (!rel.split(/\s+/).includes('stylesheet') || css === undefined) return tag;
    used.add(normalizeRef(attr(tag, 'href') ?? '').toLowerCase());
    return `<style data-file="${normalizeRef(attr(tag, 'href') ?? '').replace(/"/g, '')}">\n${css.replace(/<\/style/gi, '<\\/style')}\n</style>`;
  });

  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (whole, attrs: string) => {
    const src = attr(`<script ${attrs}>`, 'src');
    const js = lookup(src);
    if (js === undefined) return whole;
    used.add(normalizeRef(src ?? '').toLowerCase());
    const keep = attrs.replace(/\s(?:src|defer|async)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '');
    const inline = `<script${keep}>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`;
    if (/\bdefer\b/i.test(attrs) || /type\s*=\s*["']?module/i.test(attrs)) {
      deferred.push(inline);
      return '';
    }
    return inline;
  });

  // Local SVG images referenced via src="x.svg" become data URIs.
  html = html.replace(/(<img\b[^>]*\bsrc\s*=\s*)(["'])([^"']+)\2/gi, (whole, pre: string, q: string, ref: string) => {
    const svg = /\.svg$/i.test(normalizeRef(ref)) ? lookup(ref) : undefined;
    return svg === undefined ? whole : `${pre}${q}data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}${q}`;
  });

  // Many puzzle pages never link their stylesheet / script. Inject every local
  // .css file not already linked into <head>, and every .js file not already
  // included at the end of <body> (file order), so the preview behaves as intended.
  const extraCss: string[] = [];
  for (const f of files) {
    const key = f.name.toLowerCase();
    if (used.has(key)) continue;
    const body = byName.get(key) ?? '';
    const tagName = f.name.replace(/"/g, '');
    if (/\.css$/i.test(f.name)) extraCss.push(`<style data-file="${tagName}">\n${body.replace(/<\/style/gi, '<\\/style')}\n</style>`);
    else if (/\.m?js$/i.test(f.name)) deferred.push(`<script data-file="${tagName}">\n${body.replace(/<\/script/gi, '<\\/script')}\n</script>`);
  }
  if (extraCss.length) {
    const css = extraCss.join('\n');
    if (/<\/head\s*>/i.test(html)) html = html.replace(/<\/head\s*>/i, () => `${css}\n</head>`);
    else if (/<body\b[^>]*>/i.test(html)) html = html.replace(/<body\b[^>]*>/i, (m) => `${css}\n${m}`);
    else html = css + html;
  }

  if (deferred.length) {
    const tail = deferred.join('\n');
    html = /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, () => `${tail}\n</body>`) : html + tail;
  }
  return html;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Small RFC-4180-ish parser (quoted fields, escaped quotes, CRLF). Caps rows. */
export function parseCsv(text: string, maxRows = 2000): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      if (rows.length > maxRows) return { rows: rows.slice(0, maxRows + 1), truncated: true };
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return { rows, truncated: false };
}

// ---------------------------------------------------------------------------
// Statement (plain text + ``` fences)
// ---------------------------------------------------------------------------

export type StatementBlock = { kind: 'p'; text: string } | { kind: 'code'; text: string; lang: string };

export function parseStatement(text: string): StatementBlock[] {
  const out: StatementBlock[] = [];
  const parts = (text ?? '').split('```');
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const nl = part.indexOf('\n');
      const first = nl >= 0 ? part.slice(0, nl).trim() : '';
      const isLang = nl >= 0 && /^[\w+#.-]{0,20}$/.test(first);
      const body = (isLang ? part.slice(nl + 1) : part).replace(/\n$/, '');
      out.push({ kind: 'code', text: body, lang: isLang ? first : '' });
    } else {
      for (const para of part.split(/\n\s*\n/)) {
        const t = para.replace(/^\n+|\n+$/g, '');
        if (t.trim()) out.push({ kind: 'p', text: t });
      }
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Decoy text for the encrypted hint (generated client-side; NOT the hint)
// ---------------------------------------------------------------------------

const WORDS = 'lorem ipsum dolor sit amet reactor vent oxygen wiring shields navigation conduit relay sector calibrate flux module ping array index buffer loop node signal hull'.split(' ');
export function decoyText(seed: string, words = 46): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const out: string[] = [];
  for (let i = 0; i < words; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ i;
    out.push(WORDS[Math.abs(h) % WORDS.length]);
  }
  return out.join(' ') + '.';
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const errCode = (e: unknown) => (e instanceof ApiError ? e.code : 'UNKNOWN');
export const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

/** The question can no longer be scored (sprint over, expired, disabled, withdrawn). */
export const CLOSED_CODES = new Set(['SPRINT_CLOSED', 'SPRINT_NOT_RUNNING', 'QUESTION_EXPIRED', 'QUESTION_DISABLED', 'QUESTION_NOT_RELEASED']);
export const SOLVED_CODES = new Set(['QUESTION_ALREADY_SOLVED']);
/** The crew itself can no longer compete. */
export const ELIMINATED_CODES = new Set(['TEAM_ELIMINATED', 'TEAM_DISQUALIFIED', 'ACCOUNT_DISABLED', 'TEAM_ARCHIVED', 'SLOT_UNASSIGNED']);

/** Friendly copy for the error codes a crew can hit while repairing a system. */
export function friendlyError(code: string, message: string): string {
  switch (code) {
    case 'QUESTION_ALREADY_SOLVED':
      return 'Another crew fixed this system first. Move on to the next one.';
    case 'QUESTION_EXPIRED':
      return 'This system expired with its sprint.';
    case 'SPRINT_CLOSED':
      return 'Time is up — the sprint has closed.';
    case 'SPRINT_NOT_RUNNING':
      return 'No sprint is running in your slot right now.';
    case 'SPRINT_PAUSED':
      return 'The organizers paused the sprint. Hold position — try again when it resumes.';
    case 'INSUFFICIENT_FUNDS':
      return message || 'Not enough IdeaCoins in your wallet.';
    case 'QUESTION_DISABLED':
      return 'The organizers disabled this system.';
    case 'QUESTION_NOT_RELEASED':
      return 'This system is not available to your crew.';
    case 'STALE_QUESTION':
      return 'This system was reset by the organizers. Reload it to get the new version.';
    case 'RATE_LIMITED':
      return message || 'Too many attempts. Wait a few seconds.';
    case 'RUNNER_UNAVAILABLE':
    case 'RUNNER_BUSY':
    case 'RUNTIME_UNAVAILABLE':
      return `The verification runner could not judge your code: ${message} Nothing was scored — try again shortly.`;
    case 'NETWORK':
      return `${message} Your submission may not have arrived; resubmitting is safe.`;
    default:
      return message;
  }
}
