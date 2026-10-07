/**
 * IDEALab.dev question bank (https://github.com/Idealab-Sgsits/IDEALab.dev, data/*.json).
 *
 * Every problem is flag-based: the crew solves the task and submits the flag.
 * This module converts the repository format into AMONG BUG question versions:
 *
 *   core_compute   python editor; hidden validation appended at Run → prints FLAG when fixed
 *   data_decypher  python editor; hidden dataset setup prepended (plots returned as images)
 *   maker          micropython → python editor; json_tweak / api_intercept → JSON check
 *   cryptography   evidence board (text / html / hex sequence) + flag answer
 *   recon          terminal over a virtual filesystem, SQL over hidden tables, or evidence
 *   web            html / css / js files, preview-only hidden files, live sandboxed preview
 *
 * Hidden setup / validation / filesystems / tables / expected states go into the
 * SERVER-ONLY `runtime` and are never sent to crews.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Difficulty, FileLanguage, Runtime, StarterFile, TaskVariant, WorkspaceKind } from './types.js';

export const IDEALAB_REPO = 'https://github.com/Idealab-Sgsits/IDEALab.dev';
export const IDEALAB_DOMAIN_FILES = ['core_compute', 'cryptography', 'data_decypher', 'maker', 'recon', 'web'] as const;
export type IdealabDomain = (typeof IDEALAB_DOMAIN_FILES)[number];

/** The six ship stations = the six repository domains. */
export const IDEALAB_DOMAINS = [
  { slug: 'core_compute', name: 'Core Compute', room: 'REACTOR CORE', color: '#8ae4bf', symbol: '>_', prefix: 'CORE', workspace: 'BASIC' },
  { slug: 'cryptography', name: 'Cryptography', room: 'COMMS ARRAY', color: '#b5a2ec', symbol: '#', prefix: 'CRYPTO', workspace: 'EVIDENCE' },
  { slug: 'data_decypher', name: 'Data Decypher', room: 'DATABASE CORE', color: '#87b6e5', symbol: '≡', prefix: 'DATA', workspace: 'DATA' },
  { slug: 'maker', name: 'Maker Sandbox', room: 'ENGINEERING BAY', color: '#e1b775', symbol: '⚙', prefix: 'MAKER', workspace: 'JSON' },
  { slug: 'recon', name: 'Reconnaissance', room: 'SECURITY', color: '#e3a178', symbol: '⌕', prefix: 'RECON', workspace: 'SHELL' },
  { slug: 'web', name: 'Web Exploitation', room: 'COMMUNICATIONS', color: '#dea4ca', symbol: '</>', prefix: 'WEB', workspace: 'WEB' },
] as const;

export interface IdealabItem {
  id: string;
  name: string;
  difficulty: 'easy' | 'medium' | 'hard';
  base_coins?: number;
  type?: string;
  problem_statement: string;
  flag: string;
  hints: { level: number; cost: number; text: string }[];
  editor_state?: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  workspace?: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  evidence_board?: { type: string; content: unknown };
}

export interface ConvertedQuestion {
  key: string;
  domainSlug: IdealabDomain;
  difficulty: Difficulty;
  variant: TaskVariant;
}

const DIFF: Record<string, Difficulty> = { easy: 'EASY', medium: 'MEDIUM', hard: 'HARD' };

/** Decodes a *_b64 field; hidden_* fields without the suffix are decoded only when they are clean base64 text. */
function decodeField(key: string, value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  const looksB64 = /^[A-Za-z0-9+/=\s]+$/.test(value) && value.replace(/\s/g, '').length % 4 === 0;
  if (key.endsWith('_b64') || looksB64) {
    try {
      const text = Buffer.from(value, 'base64').toString('utf8');
      // Accept only if it round-trips and is printable text.
      if (Buffer.from(text, 'utf8').toString('base64').replace(/=+$/, '') === value.replace(/\s/g, '').replace(/=+$/, '') && !/[\u0000-\u0008\u000e-\u001f]/.test(text)) return text;
    } catch {
      /* not base64 */
    }
    if (key.endsWith('_b64')) throw new Error(`${key} is not valid base64`);
  }
  return value;
}
function hidden(w: Record<string, unknown>, base: string): string {
  return decodeField(`${base}_b64`, w[`${base}_b64`]) || decodeField(base, w[base]);
}
function parseJson(text: string, what: string): any { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what} is not valid JSON`);
  }
}
function langOf(name: string): FileLanguage {
  const ext = name.split('.').pop()?.toLowerCase();
  return ({ js: 'javascript', py: 'python', html: 'html', htm: 'html', css: 'css', json: 'json', md: 'markdown', csv: 'csv', sql: 'sql' } as Record<string, FileLanguage>)[ext ?? ''] ?? 'text';
}

const PY_KNOWN = new Set(
  ('print len range sum min max abs round int float str list dict set tuple sorted enumerate zip map filter any all isinstance type bool open None True False and or not in is if else elif for '
    + 'while def return import from as try except pass break continue lambda with global nonlocal assert del raise yield class hasattr getattr chr ord hex bin pow divmod reversed '
    + 'Exception ValueError TypeError KeyError IndexError ZeroDivisionError signal math random collections heapq np pd plt numpy pandas re json').split(' '),
);
/**
 * True when every name the hidden check uses is defined by the hidden setup, by
 * the check itself, or is a builtin — i.e. the check ignores the participant's code.
 */
export function checkIsSelfContained(prefix: string, suffix: string): boolean {
  const strip = (c: string) => c.replace(/(['"])(?:\\.|(?!\1).)*\1/g, '""').replace(/#.*$/gm, '');
  const used = new Set([...strip(suffix).matchAll(/(?<![.\w])([A-Za-z_]\w*)/g)].map((m) => m[1]));
  const assigned = (c: string) => {
    const out = new Set<string>();
    for (const m of c.matchAll(/^\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*[-+*/]?=(?!=)/gm)) m[1].split(',').forEach((x) => out.add(x.trim()));
    for (const m of c.matchAll(/\b(?:for|def|import|as|class)\s+([A-Za-z_]\w*)/g)) out.add(m[1]);
    for (const m of c.matchAll(/\bfor\s+([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)/g)) {
      out.add(m[1]);
      out.add(m[2]);
    }
    return out;
  };
  const own = assigned(suffix);
  const pre = assigned(prefix);
  return [...used].every((n) => own.has(n) || pre.has(n) || PY_KNOWN.has(n) || /^(i|j|k|x|e|_)$/.test(n));
}

const FLAG_FORMAT = 'Submit the flag exactly as revealed (e.g. EXAMPLE_FLAG_42). "FLAG: …" and flag{…} wrappers are accepted.';

export function convertIdealab(domain: IdealabDomain, item: IdealabItem, src: { repo?: string; commit?: string } = {}): ConvertedQuestion {
  const difficulty = DIFF[item.difficulty];
  if (!difficulty) throw new Error(`${item.id}: unknown difficulty ${item.difficulty}`);
  if (!item.flag) throw new Error(`${item.id}: missing flag`);
  const hints = (item.hints ?? []).slice().sort((a, b) => a.level - b.level).map((h, i) => ({ level: i + 1, cost: Math.max(0, Math.round(h.cost)), text: h.text }));
  let workspace: WorkspaceKind = 'EVIDENCE';
  let runLanguage: 'python' | 'javascript' | null = null;
  let runEntry: string | undefined;
  let files: StarterFile[] = [];
  let runtime: Runtime | undefined;
  let board: TaskVariant['board'];
  let answerFormat = FLAG_FORMAT;
  const w = (item.workspace ?? item.editor_state ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  const python = (kind: WorkspaceKind, prefix: string, suffix: string, plot = false) => {
    workspace = kind;
    runLanguage = 'python';
    runEntry = 'main.py';
    files = [{ name: 'main.py', language: 'python', content: String(w.visible_code ?? '') }];
    const gate = !!suffix.trim() && checkIsSelfContained(prefix, suffix);
    runtime = { kind: 'python', ...(prefix.trim() ? { prefix } : {}), ...(suffix.trim() ? { suffix } : {}), ...(plot ? { plot: true } : {}), ...(gate ? { gate: true } : {}) };
  };

  if (domain === 'core_compute') {
    python('BASIC', '', hidden(w, 'hidden_validation'));
    answerFormat = `Repair the code and press Run. When the fix is right the output prints FLAG: … ${FLAG_FORMAT}`;
  } else if (domain === 'data_decypher') {
    const plot = w.output_type === 'plot';
    python('DATA', hidden(w, 'hidden_setup'), hidden(w, 'hidden_validation'), plot);
    answerFormat = plot
      ? 'The dataset is pre-loaded. Plot it (Run shows the chart) and submit what it reveals.'
      : 'The dataset is pre-loaded. Write code that prints the answer, Run it, and submit the value as the flag.';
  } else if (domain === 'maker') {
    if (item.type === 'json_tweak' || item.type === 'api_intercept') {
      workspace = 'JSON';
      const isApi = item.type === 'api_intercept';
      const initial = String(isApi ? w.initial_payload : w.initial_state ?? '{}');
      const expectedRaw = isApi ? w.expected_payload : hidden(w, 'expected_state');
      const expected = typeof expectedRaw === 'string' ? parseJson(expectedRaw, `${item.id} expected state`) : expectedRaw;
      const render = hidden(w, 'visual_render');
      const visual = render ? parseJson(render, `${item.id} visual render`) : {};
      files = [{ name: isApi ? 'payload.json' : 'config.json', language: 'json', content: initial }];
      runtime = { kind: 'json', expected, success: String(visual.success_message ?? `FLAG: ${item.flag}`), ...(visual.component ? { component: String(visual.component) } : {}), ...(isApi ? { endpoint: String(w.endpoint ?? '') } : {}) };
      answerFormat = `${isApi ? `Edit the intercepted request body for ${w.endpoint ?? 'the endpoint'}` : 'Edit the JSON configuration'} and press Apply. When the device accepts it, it reveals the flag. ${FLAG_FORMAT}`;
    } else {
      python('BASIC', hidden(w, 'hidden_setup'), hidden(w, 'hidden_validation'));
      answerFormat = `Sensor data is pre-loaded. Write the firmware logic, Run it, and submit the printed value as the flag.`;
    }
  } else if (domain === 'cryptography') {
    const ev = item.evidence_board ?? { type: 'text', content: '' };
    board = { type: (['text', 'html', 'sequence'].includes(ev.type) ? ev.type : 'text') as 'text' | 'html' | 'sequence', content: typeof ev.content === 'string' ? ev.content : JSON.stringify(ev.content) };
    answerFormat = `Decode the evidence. ${FLAG_FORMAT}`;
  } else if (domain === 'recon') {
    if (w.database_schema_b64 || w.database_schema) {
      workspace = 'SQL';
      const tables = parseJson(hidden(w, 'database_schema'), `${item.id} database schema`);
      files = [{ name: 'query.sql', language: 'sql', content: String(w.default_query ?? 'SELECT 1;') }];
      runtime = { kind: 'sql', tables };
      answerFormat = `Query the evidence database (SQLite). ${FLAG_FORMAT}`;
    } else if (w.file_system_b64 || w.file_system) {
      workspace = 'SHELL';
      const fs = parseJson(hidden(w, 'file_system'), `${item.id} file system`) as Record<string, string>;
      runtime = { kind: 'shell', cwd: String(w.current_directory ?? '/home/agent'), user: String(w.current_user ?? 'agent'), fs, ...(w.initial_command ? { initialCommand: String(w.initial_command) } : {}) };
      answerFormat = `Investigate in the terminal (ls, cat, grep, find, base64 -d, tr, sort, …). ${FLAG_FORMAT}`;
    } else {
      const ev = (w.evidence_board ?? item.evidence_board ?? { type: 'text', content: '' }) as { type: string; content: unknown };
      board = { type: (['text', 'html', 'sequence'].includes(ev.type) ? ev.type : 'text') as 'text' | 'html' | 'sequence', content: typeof ev.content === 'string' ? ev.content : JSON.stringify(ev.content) };
      answerFormat = `Analyse the evidence. ${FLAG_FORMAT}`;
    }
  } else if (domain === 'web') {
    workspace = 'WEB';
    const entries = Object.entries((w.files ?? {}) as Record<string, { content: string; is_editable: boolean; is_visible: boolean }>);
    const active = String(w.active_file ?? '');
    entries.sort(([a], [b]) => (a === active ? -1 : b === active ? 1 : 0));
    files = entries.map(([path, f]) => {
      const name = path.replace(/^\/+/, '');
      return { name, language: langOf(name), content: String(f.content ?? ''), ...(f.is_editable ? {} : { readOnly: true }), ...(f.is_visible ? {} : { hidden: true }) };
    });
    if (!files.some((f) => f.name === 'index.html')) files.push({ name: 'index.html', language: 'html', content: '<div></div>', readOnly: true, hidden: true });
    answerFormat = `Inspect and edit the page; the live preview updates as you type. ${FLAG_FORMAT}`;
  }

  return sanitize({
    key: item.id,
    domainSlug: domain,
    difficulty,
    variant: {
      title: item.name,
      statement: item.problem_statement,
      workspace,
      runLanguage,
      ...(runEntry ? { runEntry } : {}),
      files,
      answerFormat,
      validation: { mode: 'EXACT_TEXT', answer: item.flag, caseSensitive: false, collapseWhitespace: true, flag: true },
      hint: hints[0]?.text ?? 'No hint for this problem.',
      ...(hints.length ? { hints } : {}),
      ...(runtime ? { runtime } : {}),
      ...(board ? { board } : {}),
      source: { repo: src.repo ?? IDEALAB_REPO, id: item.id, ...(src.commit ? { commit: src.commit } : {}), ...(item.type ? { type: item.type } : {}) },
      solution: {
        explanation: `IDEALab.dev ${item.id} (${item.type ?? domain}). Flag: ${item.flag}.${hints.length ? ` Intended path: ${hints.map((h) => h.text).join(' → ')}` : ''}`,
        answer: item.flag,
      },
    },
  });
}

/**
 * PostgreSQL text / jsonb cannot store U+0000. Binary-looking puzzle files use it,
 * so it becomes U+0001 (still non-printable: strings / xxd behave the same, except
 * that the byte shows as 01).
 */
function sanitize<T>(v: T): T {
  if (typeof v === 'string') return (v.includes('\u0000') ? v.split('\u0000').join('\u0001') : v) as T;
  if (Array.isArray(v)) return v.map(sanitize) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [sanitize(k), sanitize(x)])) as T;
  return v;
}

/** Converts a whole domain file; returns per-item errors instead of throwing. */
export function convertDomainFile(domain: IdealabDomain, items: unknown, src: { repo?: string; commit?: string } = {}) {
  if (!Array.isArray(items)) throw new Error(`${domain}.json must be a JSON array`);
  const ok: ConvertedQuestion[] = [];
  const errors: { id: string; error: string }[] = [];
  for (const it of items as IdealabItem[]) {
    try {
      ok.push(convertIdealab(domain, it, src));
    } catch (e) {
      errors.push({ id: String((it as { id?: string })?.id ?? '?'), error: (e as Error).message });
    }
  }
  return { ok, errors };
}

/** The vendored snapshot (server/src/content/idealab, copied to dist on build). */
export function loadSnapshot(): { source: { repo: string; ref: string; commit: string }; domains: Record<IdealabDomain, IdealabItem[]> } {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = [join(here, 'idealab'), join(here, '..', '..', 'src', 'content', 'idealab')].find((d) => existsSync(join(d, 'SOURCE.json')));
  if (!dir) throw new Error('IDEALab snapshot not found (server/src/content/idealab).');
  const source = JSON.parse(readFileSync(join(dir, 'SOURCE.json'), 'utf8'));
  const domains = Object.fromEntries(IDEALAB_DOMAIN_FILES.map((d) => [d, JSON.parse(readFileSync(join(dir, `${d}.json`), 'utf8'))])) as Record<IdealabDomain, IdealabItem[]>;
  return { source, domains };
}

/** Fetches data/<domain>.json for all six domains from a GitHub repository (raw.githubusercontent.com). */
export async function fetchFromGitHub(repoUrl: string, ref = 'main', signal?: AbortSignal) {
  const m = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(repoUrl.trim());
  if (!m) throw new Error('Use a GitHub repository URL like https://github.com/owner/repo');
  if (!/^[\w./-]{1,100}$/.test(ref)) throw new Error('Invalid branch / ref.');
  const [, owner, repo] = m;
  const commit = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`, { signal, headers: { accept: 'application/vnd.github+json', 'user-agent': 'among-bug' } })
    .then(async (r) => (r.ok ? ((await r.json()) as { sha?: string }).sha : undefined))
    .catch(() => undefined);
  const at = commit ?? ref;
  const domains = {} as Record<IdealabDomain, IdealabItem[]>;
  for (const d of IDEALAB_DOMAIN_FILES) {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${at}/data/${d}.json`;
    const r = await fetch(url, { signal, headers: { 'user-agent': 'among-bug' } });
    if (!r.ok) throw new Error(`Could not fetch data/${d}.json (${r.status}) from ${owner}/${repo}@${ref}.`);
    const text = await r.text();
    if (text.length > 5 * 1024 * 1024) throw new Error(`data/${d}.json is too large.`);
    domains[d] = JSON.parse(text);
  }
  return { source: { repo: `https://github.com/${owner}/${repo}`, ref, commit: commit ?? '' }, domains };
}
