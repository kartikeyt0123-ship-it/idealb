/**
 * A small, deterministic, side-effect-free shell over a virtual filesystem —
 * the terminal of the Reconnaissance questions. Nothing touches the real OS:
 * commands are interpreted in-process over the question's hidden file map.
 *
 * Supported: pipes (|), sequences (; &&), quotes, $VAR / ${VAR}, ~, and
 * ls cd pwd cat head tail grep find wc sort uniq cut tr base64 rev echo printf
 * strings xxd hexdump od awk sed whoami id hostname uname env printenv export
 * history file stat du date curl ss netstat ps which clear help true false.
 *
 * Conventions of the question bank: files live in the starting directory;
 * `env_dump.txt` provides environment variables; `mock_response.txt` is what
 * `curl` receives; a path that does not exist falls back to a file with the
 * same base name (e.g. /proc/net/tcp_summary → tcp_summary).
 */

export interface ShellRuntime {
  cwd: string;
  user?: string;
  fs: Record<string, string>;
}
export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  cwd: string;
}

const MAX_OUT = 64 * 1024;

class Fail extends Error {
  constructor(message: string, readonly code = 1) {
    super(message);
  }
}

function norm(path: string): string {
  const parts: string[] = [];
  for (const p of path.split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') parts.pop();
    else parts.push(p);
  }
  return '/' + parts.join('/');
}
const base = (p: string) => p.split('/').filter(Boolean).pop() ?? '';

class VFS {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>(['/']);
  constructor(rt: ShellRuntime) {
    const root = norm(rt.cwd || '/');
    for (const [name, content] of Object.entries(rt.fs ?? {})) {
      const full = norm(name.startsWith('/') ? name : `${root}/${name}`);
      this.files.set(full, String(content ?? ''));
    }
    const addDirs = (p: string) => {
      let cur = '';
      for (const part of p.split('/').filter(Boolean)) {
        cur += '/' + part;
        this.dirs.add(cur);
      }
    };
    addDirs(root);
    for (const f of this.files.keys()) addDirs(f.slice(0, f.lastIndexOf('/')) || '/');
  }
  isDir(p: string) {
    return this.dirs.has(p);
  }
  /** Exact path, else a unique file with the same base name (bank convention). */
  file(p: string): string | undefined {
    if (this.files.has(p)) return p;
    const b = base(p);
    const hits = [...this.files.keys()].filter((f) => base(f) === b);
    return hits.length === 1 ? hits[0] : undefined;
  }
  children(dir: string) {
    const prefix = dir === '/' ? '/' : dir + '/';
    const out = new Map<string, 'f' | 'd'>();
    for (const f of this.files.keys()) if (f.startsWith(prefix)) {
      const rest = f.slice(prefix.length);
      const first = rest.split('/')[0];
      out.set(first, rest.includes('/') ? 'd' : 'f');
    }
    for (const d of this.dirs) if (d !== dir && d.startsWith(prefix)) out.set(d.slice(prefix.length).split('/')[0], 'd');
    return [...out.entries()].sort(([a], [b]) => a.localeCompare(b));
  }
  under(dir: string) {
    const prefix = dir === '/' ? '/' : dir + '/';
    return [...this.files.keys()].filter((f) => f === dir || f.startsWith(prefix)).sort();
  }
}

// ---------------------------------------------------------------------------
// Tokenizer: words, pipes, sequences. Quotes and $VAR expansion.
// ---------------------------------------------------------------------------

type Tok = { t: 'word'; v: string; glob?: boolean } | { t: 'op'; v: '|' | ';' | '&&' | '>' | '>>' };

function tokenize(line: string, env: Record<string, string>): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let cur: string | null = null;
  let glob = false;
  const push = () => {
    if (cur !== null) out.push({ t: 'word', v: cur, ...(glob ? { glob: true } : {}) });
    cur = null;
    glob = false;
  };
  const expand = (s: string, j: number): [string, number] => {
    // s[j] === '$'
    if (s[j + 1] === '{') {
      const end = s.indexOf('}', j + 2);
      if (end < 0) return ['$', j + 1];
      return [env[s.slice(j + 2, end)] ?? '', end + 1];
    }
    const m = /^[A-Za-z_][A-Za-z0-9_]*|^\?/.exec(s.slice(j + 1));
    if (!m) return ['$', j + 1];
    return [env[m[0]] ?? '', j + 1 + m[0].length];
  };
  while (i < line.length) {
    const c = line[i];
    if (c === ' ' || c === '\t' || c === '\n') {
      push();
      i++;
    } else if (c === '|' || c === ';' || c === '>' || (c === '&' && line[i + 1] === '&')) {
      push();
      if (c === '&') {
        out.push({ t: 'op', v: '&&' });
        i += 2;
      } else if (c === '>' && line[i + 1] === '>') {
        out.push({ t: 'op', v: '>>' });
        i += 2;
      } else {
        out.push({ t: 'op', v: c as '|' | ';' | '>' });
        i++;
      }
    } else if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) throw new Fail('syntax error: unterminated quote', 2);
      cur = (cur ?? '') + line.slice(i + 1, end);
      i = end + 1;
    } else if (c === '"') {
      let j = i + 1;
      let buf = '';
      while (j < line.length && line[j] !== '"') {
        if (line[j] === '\\' && j + 1 < line.length && '"\\$`'.includes(line[j + 1])) {
          buf += line[j + 1];
          j += 2;
        } else if (line[j] === '$') {
          const [v, nj] = expand(line, j);
          buf += v;
          j = nj;
        } else buf += line[j++];
      }
      if (j >= line.length) throw new Fail('syntax error: unterminated quote', 2);
      cur = (cur ?? '') + buf;
      i = j + 1;
    } else if (c === '\\' && i + 1 < line.length) {
      cur = (cur ?? '') + line[i + 1];
      i += 2;
    } else if (c === '$') {
      const [v, ni] = expand(line, i);
      cur = (cur ?? '') + v;
      i = ni;
    } else if (c === '~' && cur === null && (line[i + 1] === undefined || line[i + 1] === '/' || line[i + 1] === ' ')) {
      cur = env.HOME;
      i++;
    } else {
      if (c === '*' || c === '?') glob = true;
      cur = (cur ?? '') + c;
      i++;
    }
  }
  push();
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parses short flags like -la / -n 5 / -5; returns flags, option values and operands. */
function opts(args: string[], withValue: string[] = []) {
  const flags = new Set<string>();
  const values: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      rest.push(...args.slice(i + 1));
      break;
    }
    if (/^-\d+$/.test(a)) {
      values.n = a.slice(1);
      continue;
    }
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) values[k] = v;
      else flags.add(k);
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      const letters = a.slice(1);
      for (let j = 0; j < letters.length; j++) {
        const l = letters[j];
        if (withValue.includes(l)) {
          values[l] = letters.slice(j + 1) || args[++i] || '';
          break;
        }
        flags.add(l);
      }
      continue;
    }
    rest.push(a);
  }
  return { flags, values, rest };
}

function globToRegex(g: string) {
  return new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
}
function expandSet(s: string): string {
  const esc = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
  const classes: Record<string, string> = {
    '[:upper:]': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '[:lower:]': 'abcdefghijklmnopqrstuvwxyz', '[:digit:]': '0123456789',
    '[:space:]': ' \t\n\r', '[:alpha:]': 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', '[:alnum:]': 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  };
  let t = esc;
  for (const [k, v] of Object.entries(classes)) t = t.split(k).join(v);
  let out = '';
  for (let i = 0; i < t.length; i++) {
    if (t[i + 1] === '-' && i + 2 < t.length) {
      const a = t.charCodeAt(i);
      const b = t.charCodeAt(i + 2);
      for (let c = a; c <= b; c++) out += String.fromCharCode(c);
      i += 2;
    } else out += t[i];
  }
  return out;
}
const lines = (s: string) => (s === '' ? [] : s.replace(/\n$/, '').split('\n'));
const joinLines = (l: string[]) => (l.length ? l.join('\n') + '\n' : '');
function hexdump(buf: Buffer, canonical: boolean) {
  const out: string[] = [];
  for (let off = 0; off < buf.length; off += 16) {
    const chunk = buf.subarray(off, off + 16);
    const hex = [...chunk].map((b) => b.toString(16).padStart(2, '0'));
    const ascii = [...chunk].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    if (canonical) out.push(`${off.toString(16).padStart(8, '0')}  ${hex.slice(0, 8).join(' ').padEnd(23)}  ${hex.slice(8).join(' ').padEnd(23)}  |${ascii}|`);
    else out.push(`${off.toString(16).padStart(8, '0')}: ${hex.join('').replace(/(.{4})/g, '$1 ').trim().padEnd(39)}  ${ascii}`);
  }
  return joinLines(out);
}

// ---------------------------------------------------------------------------
// Interpreter
// ---------------------------------------------------------------------------

export function runShell(rt: ShellRuntime, command: string, cwdIn?: string): ShellResult {
  const vfs = new VFS(rt);
  const home = norm(rt.cwd || '/');
  let cwd = cwdIn && vfs.isDir(norm(cwdIn)) ? norm(cwdIn) : home;
  const user = rt.user || 'agent';
  const env: Record<string, string> = { USER: user, LOGNAME: user, HOME: home, PWD: cwd, SHELL: '/bin/bash', PATH: '/usr/local/bin:/usr/bin:/bin', HOSTNAME: 'among-bug', TERM: 'xterm' };
  const envFile = vfs.file(norm(`${home}/env_dump.txt`));
  if (envFile) for (const l of lines(vfs.files.get(envFile)!)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(l.trim());
    if (m) env[m[1]] = m[2];
  }
  let stdout = '';
  let stderr = '';
  let status = 0;

  const resolve = (p: string) => norm(p.startsWith('/') ? p : `${cwd}/${p}`);
  const read = (p: string, cmd: string) => {
    const full = resolve(p);
    if (vfs.isDir(full) && !vfs.files.has(full)) throw new Fail(`${cmd}: ${p}: Is a directory`);
    const f = vfs.file(full);
    if (!f) throw new Fail(`${cmd}: ${p}: No such file or directory`);
    return vfs.files.get(f)!;
  };
  const inputOf = (files: string[], stdin: string, cmd: string) => (files.length ? files.map((f) => read(f, cmd)).join('') : stdin);

  const commands: Record<string, (args: string[], stdin: string) => string> = {
    pwd: () => cwd + '\n',
    whoami: () => user + '\n',
    id: () => `uid=1000(${user}) gid=1000(${user}) groups=1000(${user})\n`,
    hostname: () => 'among-bug\n',
    uname: (a) => (a.includes('-a') ? 'Linux among-bug 6.1.0-idealab #1 SMP x86_64 GNU/Linux\n' : 'Linux\n'),
    date: () => 'Thu Oct  8 10:00:00 IST 2026\n',
    true: () => '',
    false: () => {
      throw new Fail('', 1);
    },
    clear: () => '',
    help: () => 'Available: ls cd pwd cat head tail grep find wc sort uniq cut tr base64 rev echo printf strings xxd hexdump od awk sed whoami id env printenv history file stat du curl ss netstat ps which uname date\n',
    which: (a) => a.map((c) => (c in commands ? `/usr/bin/${c}` : '')).filter(Boolean).join('\n') + (a.length ? '\n' : ''),
    echo: (a) => {
      const { flags, rest } = opts(a);
      let s = rest.join(' ');
      if (flags.has('e')) s = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
      return flags.has('n') ? s : s + '\n';
    },
    printf: (a) => {
      const [fmt = '', ...vals] = a;
      let k = 0;
      return fmt.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/%[sd]/g, () => vals[k++] ?? '');
    },
    env: () => Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n',
    printenv: (a) => (a.length ? a.map((k) => env[k]).filter((v) => v !== undefined).join('\n') + '\n' : commands.env([], '')),
    export: (a) => {
      for (const x of a) {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(x);
        if (m) env[m[1]] = m[2];
      }
      return '';
    },
    cd: (a) => {
      const target = resolve(a[0] ?? home);
      if (!vfs.isDir(target)) throw new Fail(`cd: ${a[0]}: No such file or directory`);
      cwd = target;
      env.PWD = cwd;
      return '';
    },
    ls: (a) => {
      const { flags, rest } = opts(a);
      const all = flags.has('a') || flags.has('A');
      const long = flags.has('l');
      const targets = rest.length ? rest : ['.'];
      const out: string[] = [];
      for (const t of targets) {
        const full = resolve(t);
        if (!vfs.isDir(full)) {
          const f = vfs.file(full);
          if (!f) throw new Fail(`ls: cannot access '${t}': No such file or directory`, 2);
          out.push(long ? `-rw-r--r-- 1 ${user} ${user} ${String(vfs.files.get(f)!.length).padStart(6)} Oct  8 10:00 ${t}` : t);
          continue;
        }
        if (targets.length > 1) out.push(`${t}:`);
        let entries = vfs.children(full);
        if (!all) entries = entries.filter(([n]) => !n.startsWith('.'));
        if (flags.has('a')) entries = [['.', 'd'], ['..', 'd'], ...entries];
        if (long) {
          out.push(`total ${entries.length * 4}`);
          for (const [n, k] of entries) {
            const size = k === 'f' ? (vfs.files.get(norm(`${full}/${n}`))?.length ?? 0) : 4096;
            out.push(`${k === 'd' ? 'drwxr-xr-x' : '-rw-r--r--'} 1 ${user} ${user} ${String(size).padStart(6)} Oct  8 10:00 ${n}`);
          }
        } else if (entries.length) out.push(entries.map(([n]) => n).join(flags.has('1') ? '\n' : '  '));
      }
      return joinLines(out);
    },
    cat: (a, stdin) => {
      const { flags, rest } = opts(a);
      const text = inputOf(rest, stdin, 'cat');
      return flags.has('n') ? joinLines(lines(text).map((l, i) => `${String(i + 1).padStart(6)}\t${l}`)) : text;
    },
    head: (a, stdin) => {
      const { values, rest } = opts(a, ['n', 'c']);
      const text = inputOf(rest, stdin, 'head');
      if (values.c) return text.slice(0, Number(values.c));
      return joinLines(lines(text).slice(0, Number(values.n ?? 10)));
    },
    tail: (a, stdin) => {
      const { values, rest } = opts(a, ['n', 'c']);
      const text = inputOf(rest, stdin, 'tail');
      if (values.c) return text.slice(-Number(values.c));
      const n = values.n ?? '10';
      const l = lines(text);
      return joinLines(n.startsWith('+') ? l.slice(Number(n.slice(1)) - 1) : l.slice(-Number(n)));
    },
    grep: (a, stdin) => {
      const { flags, values, rest } = opts(a, ['e', 'm', 'A', 'B', 'C']);
      const pattern = values.e ?? rest.shift();
      if (pattern === undefined) throw new Fail('usage: grep [-ivnrcoE] PATTERN [FILE...]', 2);
      let re: RegExp;
      try {
        const src = flags.has('F') ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : flags.has('E') ? pattern : pattern.replace(/\\\|/g, '|').replace(/\\\(/g, '(').replace(/\\\)/g, ')');
        re = new RegExp(flags.has('w') ? `\\b(?:${src})\\b` : src, flags.has('i') ? 'gi' : 'g');
      } catch {
        throw new Fail(`grep: invalid pattern: ${pattern}`, 2);
      }
      const sources: [string, string][] = [];
      if (flags.has('r') || flags.has('R')) {
        for (const t of rest.length ? rest : ['.']) {
          const full = resolve(t);
          for (const f of vfs.isDir(full) ? vfs.under(full) : [vfs.file(full)].filter(Boolean) as string[]) sources.push([f.startsWith(cwd + '/') ? f.slice(cwd.length + 1) : f, vfs.files.get(f)!]);
        }
      } else if (rest.length) for (const f of rest) sources.push([f, read(f, 'grep')]);
      else sources.push(['(standard input)', stdin]);
      const multi = sources.length > 1 || flags.has('r') || flags.has('R');
      const after = Number(values.A ?? values.C ?? 0);
      const before = Number(values.B ?? values.C ?? 0);
      const out: string[] = [];
      let any = false;
      for (const [name, text] of sources) {
        let count = 0;
        const ls = lines(text);
        const shown = new Set<number>();
        ls.forEach((l, idx) => {
          re.lastIndex = 0;
          const hit = re.test(l) !== flags.has('v');
          if (!hit) return;
          count++;
          any = true;
          if (flags.has('c') || flags.has('l')) return;
          const pre = (k: number) => `${multi ? name + ':' : ''}${flags.has('n') ? k + 1 + ':' : ''}`;
          if (flags.has('o') && !flags.has('v')) {
            re.lastIndex = 0;
            for (const m of l.matchAll(re)) out.push(pre(idx) + m[0]);
            return;
          }
          for (let k = Math.max(0, idx - before); k <= Math.min(ls.length - 1, idx + after); k++) {
            if (shown.has(k)) continue;
            shown.add(k);
            out.push(pre(k) + ls[k]);
          }
        });
        if (flags.has('c')) out.push(`${multi ? name + ':' : ''}${count}`);
        if (flags.has('l') && count) out.push(name);
      }
      if (!any) status = 1;
      return joinLines(out);
    },
    find: (a) => {
      const startArgs: string[] = [];
      let i = 0;
      while (i < a.length && !a[i].startsWith('-')) startArgs.push(a[i++]);
      const tests: ((p: string, isDir: boolean) => boolean)[] = [];
      while (i < a.length) {
        const t = a[i++];
        const v = a[i++] ?? '';
        if (t === '-name' || t === '-iname') {
          const re = globToRegex(v);
          const reI = new RegExp(re.source, 'i');
          tests.push((p) => (t === '-iname' ? reI : re).test(base(p)));
        } else if (t === '-type') tests.push((_p, d) => (v === 'd' ? d : !d));
        else if (t === '-size') {
          const m = /^([+-]?)(\d+)([ckMG]?)$/.exec(v);
          const n = m ? Number(m[2]) * ({ c: 1, k: 1024, M: 1 << 20, G: 1 << 30, '': 512 } as Record<string, number>)[m[3]] : 0;
          tests.push((p, d) => {
            if (d) return false;
            const size = vfs.files.get(p)!.length;
            return m?.[1] === '+' ? size > n : m?.[1] === '-' ? size < n : size === n;
          });
        } else if (t === '-empty') {
          i--;
          tests.push((p, d) => !d && vfs.files.get(p)!.length === 0);
        } else if (t === '-path') {
          const re = globToRegex(v);
          tests.push((p) => re.test(p));
        } else if (t === '-inum' || t === '-perm' || t === '-user' || t === '-newer' || t === '-mtime') {
          // Metadata the virtual filesystem does not model: keep files, the evidence is in their content.
          tests.push((_p, d) => !d);
        } else if (t === '-print') i--;
        else throw new Fail(`find: unknown predicate '${t}'`);
      }
      const out: string[] = [];
      for (const s of startArgs.length ? startArgs : ['.']) {
        const full = resolve(s);
        if (!vfs.isDir(full) && !vfs.file(full)) throw new Fail(`find: '${s}': No such file or directory`);
        const display = (p: string) => (s === '.' ? '.' + p.slice(cwd === '/' ? 0 : cwd.length) : p.replace(full, s.replace(/\/$/, '')));
        const dirs = [...vfs.dirs].filter((d) => d === full || d.startsWith(full === '/' ? '/' : full + '/'));
        const entries: [string, boolean][] = [...dirs.map((d) => [d, true] as [string, boolean]), ...vfs.under(full).map((f) => [f, false] as [string, boolean])];
        if (!vfs.isDir(full)) entries.splice(0, entries.length, [vfs.file(full)!, false]);
        for (const [p, d] of entries.sort(([x], [y]) => x.localeCompare(y))) if (tests.every((t) => t(p, d))) out.push(display(p) || '.');
      }
      return joinLines(out);
    },
    wc: (a, stdin) => {
      const { flags, rest } = opts(a);
      const text = inputOf(rest, stdin, 'wc');
      const l = (text.match(/\n/g) ?? []).length;
      const w = text.split(/\s+/).filter(Boolean).length;
      const c = Buffer.byteLength(text);
      const parts = flags.size ? [flags.has('l') ? l : null, flags.has('w') ? w : null, flags.has('c') || flags.has('m') ? c : null].filter((x) => x !== null) : [l, w, c];
      return parts.join(' ') + (rest.length ? ` ${rest.join(' ')}` : '') + '\n';
    },
    sort: (a, stdin) => {
      const { flags, values, rest } = opts(a, ['k', 't']);
      let l = lines(inputOf(rest, stdin, 'sort'));
      const sep = values.t;
      const keyOf = (s: string) => {
        if (!values.k) return s;
        const [from] = values.k.split(',');
        const idx = parseInt(from, 10) - 1;
        const fields = sep ? s.split(sep) : s.trim().split(/\s+/);
        return fields[idx] ?? '';
      };
      const numeric = flags.has('n') || /n/.test(values.k ?? '');
      l.sort((x, y) => (numeric ? parseFloat(keyOf(x)) - parseFloat(keyOf(y)) || 0 : keyOf(x).localeCompare(keyOf(y))));
      if (flags.has('r')) l.reverse();
      if (flags.has('u')) l = [...new Set(l)];
      return joinLines(l);
    },
    uniq: (a, stdin) => {
      const { flags, rest } = opts(a);
      const out: [string, number][] = [];
      for (const l of lines(inputOf(rest, stdin, 'uniq'))) {
        if (out.length && out[out.length - 1][0] === l) out[out.length - 1][1]++;
        else out.push([l, 1]);
      }
      return joinLines(out.filter(([, n]) => (flags.has('d') ? n > 1 : flags.has('u') ? n === 1 : true)).map(([l, n]) => (flags.has('c') ? `${String(n).padStart(7)} ${l}` : l)));
    },
    cut: (a, stdin) => {
      const { values, rest } = opts(a, ['d', 'f', 'c']);
      const pick = (spec: string, n: number) => {
        const idx = new Set<number>();
        for (const part of spec.split(',')) {
          const [x, y] = part.split('-');
          const from = x ? Number(x) : 1;
          const to = y === undefined ? from : y ? Number(y) : n;
          for (let k = from; k <= to; k++) idx.add(k);
        }
        return [...idx].sort((p, q) => p - q);
      };
      return joinLines(lines(inputOf(rest, stdin, 'cut')).map((l) => {
        if (values.c) return pick(values.c, l.length).map((k) => l[k - 1] ?? '').join('');
        const d = values.d ?? '\t';
        const fs = l.split(d);
        return values.f ? pick(values.f, fs.length).map((k) => fs[k - 1]).filter((x) => x !== undefined).join(d) : l;
      }));
    },
    tr: (a, stdin) => {
      const { flags, rest } = opts(a);
      const s1 = expandSet(rest[0] ?? '');
      if (flags.has('d')) return [...stdin].filter((c) => !s1.includes(c)).join('');
      let s2 = expandSet(rest[1] ?? '');
      if (!s2) return stdin;
      while (s2.length < s1.length) s2 += s2[s2.length - 1];
      let out = [...stdin].map((c) => {
        const k = s1.indexOf(c);
        return k >= 0 ? s2[k] : c;
      }).join('');
      if (flags.has('s')) out = out.replace(new RegExp(`([${s2.replace(/[\]\\^-]/g, '\\$&')}])\\1+`, 'g'), '$1');
      return out;
    },
    base64: (a, stdin) => {
      const { flags, rest } = opts(a);
      const text = inputOf(rest, stdin, 'base64');
      if (flags.has('d') || flags.has('decode')) {
        const clean = text.replace(/\s+/g, '');
        if (!/^[A-Za-z0-9+/]*=*$/.test(clean)) throw new Fail('base64: invalid input');
        return Buffer.from(clean, 'base64').toString('utf8');
      }
      return Buffer.from(text, 'utf8').toString('base64') + '\n';
    },
    rev: (a, stdin) => joinLines(lines(inputOf(opts(a).rest, stdin, 'rev')).map((l) => [...l].reverse().join(''))),
    strings: (a, stdin) => {
      const text = inputOf(opts(a).rest, stdin, 'strings');
      return joinLines(text.match(/[\x20-\x7e]{4,}/g) ?? []);
    },
    xxd: (a, stdin) => hexdump(Buffer.from(inputOf(opts(a).rest, stdin, 'xxd'), 'utf8'), false),
    hexdump: (a, stdin) => hexdump(Buffer.from(inputOf(opts(a).rest, stdin, 'hexdump'), 'utf8'), true),
    od: (a, stdin) => hexdump(Buffer.from(inputOf(opts(a).rest, stdin, 'od'), 'utf8'), true),
    sed: (a, stdin) => {
      const { flags, rest } = opts(a);
      const script = rest.shift() ?? '';
      const text = inputOf(rest, stdin, 'sed');
      const s = /^s(.)(.*?)\1(.*?)\1([gi]*)$/.exec(script);
      if (s) {
        const re = new RegExp(s[2], s[4].includes('g') ? (s[4].includes('i') ? 'gi' : 'g') : s[4].includes('i') ? 'i' : '');
        return joinLines(lines(text).map((l) => l.replace(re, s[3].replace(/\\n/g, '\n').replace(/&/g, '$&'))));
      }
      const p = /^(\d+)(?:,(\d+))?p$/.exec(script);
      if (p && flags.has('n')) {
        const from = Number(p[1]);
        const to = p[2] ? Number(p[2]) : from;
        return joinLines(lines(text).filter((_l, i) => i + 1 >= from && i + 1 <= to));
      }
      throw new Fail("sed: only 's/re/repl/[g]' and -n 'Np' are supported here");
    },
    history: () => {
      const f = vfs.file(norm(`${home}/.bash_history`));
      return f ? joinLines(lines(vfs.files.get(f)!).map((l, i) => `${String(i + 1).padStart(5)}  ${l}`)) : '';
    },
    file: (a) => joinLines(a.map((p) => {
      const full = resolve(p);
      if (vfs.isDir(full)) return `${p}: directory`;
      const f = vfs.file(full);
      if (!f) return `${p}: cannot open (No such file or directory)`;
      const c = vfs.files.get(f)!;
      return `${p}: ${c.length === 0 ? 'empty' : /^#!/.test(c) ? 'Bourne-Again shell script, ASCII text executable' : /^[A-Za-z0-9+/=\s]+$/.test(c) && c.length % 4 === 0 ? 'ASCII text (looks like base64)' : 'ASCII text'}`;
    })),
    stat: (a) => joinLines(a.map((p) => {
      const f = vfs.file(resolve(p));
      if (!f) throw new Fail(`stat: cannot stat '${p}': No such file or directory`);
      return `  File: ${p}\n  Size: ${vfs.files.get(f)!.length}\tBlocks: 8\tregular file\nAccess: (0644/-rw-r--r--)  Uid: (1000/${user})`;
    })),
    du: (a) => {
      const { rest } = opts(a);
      const full = resolve(rest[0] ?? '.');
      return joinLines(vfs.under(full).map((f) => `${Math.max(1, Math.ceil(vfs.files.get(f)!.length / 1024))}\t${f}`));
    },
    ps: () => `  PID TTY          TIME CMD\n    1 pts/0    00:00:00 bash\n   42 pts/0    00:00:00 ps\n`,
    curl: (a) => {
      const { flags, rest } = opts(a, ['X', 'H', 'd', 'o']);
      if (!rest.length) throw new Fail('curl: no URL specified', 2);
      const f = vfs.file(norm(`${home}/mock_response.txt`));
      if (!f) throw new Fail(`curl: (7) Failed to connect to ${rest[0]}: Connection refused`, 7);
      const raw = vfs.files.get(f)!.replace(/\r\n/g, '\n');
      const cut = raw.indexOf('\n\n');
      const head = cut >= 0 ? raw.slice(0, cut) : raw;
      const body = cut >= 0 ? raw.slice(cut + 2) : '';
      if (flags.has('I')) return head + '\n';
      if (flags.has('i')) return head + '\n\n' + body + (body.endsWith('\n') ? '' : '\n');
      return body + (body.endsWith('\n') ? '' : '\n');
    },
    ss: () => {
      const f = [...vfs.files.keys()].find((k) => /LISTEN/.test(vfs.files.get(k)!));
      return f ? vfs.files.get(f)! + '\n' : 'Netid State Recv-Q Send-Q Local Address:Port\n';
    },
  };
  commands.netstat = commands.ss;
  commands.xargs = (a, stdin) => {
    const { flags, values, rest } = opts(a, ['n', 'I']);
    const items = stdin.split(/\s+/).filter(Boolean);
    const [name = 'echo', ...baseArgs] = rest;
    const fn = commands[name];
    if (!fn) throw new Fail(`xargs: ${name}: command not found`, 127);
    if (values.n || flags.has('L')) return items.map((it) => fn([...baseArgs, it], '')).join('');
    return fn([...baseArgs, ...items], '');
  };
  commands.awk = (a, stdin) => {
    const { values, rest } = opts(a, ['F', 'v']);
    const prog = rest.shift() ?? '';
    return runAwk(prog, inputOf(rest, stdin, 'awk'), values.F);
  };
  commands.egrep = (a, s) => commands.grep(['-E', ...a], s);
  commands.fgrep = (a, s) => commands.grep(['-F', ...a], s);
  commands.ll = (a, s) => commands.ls(['-la', ...a], s);
  commands.dir = commands.ls;
  commands.more = commands.cat;
  commands.less = commands.cat;
  commands.tac = (a, s) => joinLines(lines(inputOf(opts(a).rest, s, 'tac')).reverse());
  commands.bash = (a) => {
    throw new Fail(a.length ? `bash: executing scripts is disabled in this terminal — read it with cat ${a[0]}` : 'bash: nested shells are disabled in this terminal');
  };
  commands.sh = commands.bash;

  /** Unquoted * and ? match names in one directory (dotfiles only when the pattern starts with a dot). */
  const expandGlob = (word: string): string[] => {
    const slash = word.lastIndexOf('/');
    const dirPart = slash >= 0 ? word.slice(0, slash + 1) : '';
    const pat = word.slice(slash + 1);
    const dir = resolve(dirPart || '.');
    if (!vfs.isDir(dir) || /[*?]/.test(dirPart)) return [word];
    const re = globToRegex(pat);
    const hits = vfs.children(dir).map(([n]) => n).filter((n) => re.test(n) && (pat.startsWith('.') || !n.startsWith('.'))).map((n) => dirPart + n);
    return hits.length ? hits : [word];
  };

  let tokens: Tok[];
  try {
    tokens = tokenize(command.slice(0, 4000), env);
  } catch (e) {
    return { stdout: '', stderr: (e as Error).message + '\n', exitCode: 2, cwd };
  }
  // Split into sequences ( ; && ), then pipelines ( | ), with optional > redirect (session-only).
  const sequences: { op: ';' | '&&'; pipeline: { argv: string[]; redirect?: { file: string; append: boolean } }[] }[] = [];
  let seq: (typeof sequences)[number] = { op: ';', pipeline: [{ argv: [] }] };
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    const curCmd = seq.pipeline[seq.pipeline.length - 1];
    if (t.t === 'word') curCmd.argv.push(...(t.glob ? expandGlob(t.v) : [t.v]));
    else if (t.v === '|') seq.pipeline.push({ argv: [] });
    else if (t.v === '>' || t.v === '>>') {
      const target = tokens[++k];
      if (!target || target.t !== 'word') return { stdout: '', stderr: 'syntax error near unexpected token `newline\'\n', exitCode: 2, cwd };
      curCmd.redirect = { file: target.v, append: t.v === '>>' };
    } else {
      sequences.push(seq);
      seq = { op: t.v as ';' | '&&', pipeline: [{ argv: [] }] };
    }
  }
  sequences.push(seq);

  for (const s of sequences) {
    if (s.op === '&&' && status !== 0) continue;
    let data = '';
    status = 0;
    for (const c of s.pipeline) {
      if (!c.argv.length) continue;
      const [name, ...args] = c.argv;
      env['?'] = String(status);
      const fn = commands[name];
      try {
        if (!fn) throw new Fail(`${name}: command not found (type 'help' for the available commands)`, 127);
        data = fn(args, data);
        if (c.redirect) {
          const full = resolve(c.redirect.file);
          vfs.files.set(full, (c.redirect.append ? (vfs.files.get(full) ?? '') : '') + data);
          data = '';
        }
      } catch (e) {
        const f = e instanceof Fail ? e : new Fail(String((e as Error).message ?? e));
        if (f.message) stderr += f.message + '\n';
        status = f.code;
        data = '';
      }
      if (stdout.length + data.length > MAX_OUT) break;
    }
    stdout += data;
    if (stdout.length > MAX_OUT) {
      stdout = stdout.slice(0, MAX_OUT) + '\n[output truncated]\n';
      break;
    }
  }
  return { stdout, stderr, exitCode: status, cwd };
}

// ---------------------------------------------------------------------------
// A safe awk subset — interpreted, never evaluated as JavaScript:
//   [BEGIN | END | /re/ | expr] { print a, b; printf "%s\n", $1; x += $4; n++; y = expr } ...
// Expressions: $N $NF NF NR, numbers, "strings", variables, + - * / %, == != < > <= >=,
// ~ /re/, !~, && ||, ! and unary -, string concatenation by juxtaposition, parentheses.
// ---------------------------------------------------------------------------

type AwkTok = { k: 'num' | 'str' | 're' | 'id' | 'field' | 'op'; v: string };

function awkLex(src: string): AwkTok[] {
  const out: AwkTok[] = [];
  let i = 0;
  const prevIsValue = () => {
    const p = out[out.length - 1];
    return !!p && (p.k === 'num' || p.k === 'str' || p.k === 'id' || p.k === 'field' || (p.k === 'op' && p.v === ')'));
  };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^\d*\.?\d+/.exec(src.slice(i))!;
      out.push({ k: 'num', v: m[0] });
      i += m[0].length;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let b = '';
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < src.length) {
          const n = src[j + 1];
          b += n === 'n' ? '\n' : n === 't' ? '\t' : n;
          j += 2;
        } else b += src[j++];
      }
      out.push({ k: 'str', v: b });
      i = j + 1;
      continue;
    }
    if (c === '/' && !prevIsValue()) {
      let j = i + 1;
      let b = '';
      while (j < src.length && src[j] !== '/') {
        if (src[j] === '\\') {
          b += src[j] + (src[j + 1] ?? '');
          j += 2;
        } else b += src[j++];
      }
      out.push({ k: 're', v: b });
      i = j + 1;
      continue;
    }
    if (c === '$') {
      const m = /^\$(\d+|NF)/.exec(src.slice(i));
      if (!m) throw new Fail('awk: unsupported field reference');
      out.push({ k: 'field', v: m[1] });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_]\w*/.exec(src.slice(i))!;
      out.push({ k: 'id', v: m[0] });
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '++', '--', '!~'].includes(two)) {
      out.push({ k: 'op', v: two });
      i += 2;
      continue;
    }
    if ('{}();,+-*/%<>!~='.includes(c)) {
      out.push({ k: 'op', v: c });
      i++;
      continue;
    }
    throw new Fail(`awk: unexpected character '${c}'`);
  }
  return out;
}

type AwkNode =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 're'; v: string }
  | { t: 'var'; v: string }
  | { t: 'field'; v: string }
  | { t: 'bin'; op: string; l: AwkNode; r: AwkNode }
  | { t: 'not'; e: AwkNode }
  | { t: 'neg'; e: AwkNode }
  | { t: 'cat'; l: AwkNode; r: AwkNode };
type AwkStmt =
  | { t: 'print'; args: AwkNode[] }
  | { t: 'printf'; args: AwkNode[] }
  | { t: 'assign'; name: string; op: string; e?: AwkNode }
  | { t: 'expr'; e: AwkNode };
type AwkRule = { pattern: 'BEGIN' | 'END' | AwkNode | null; body: AwkStmt[] | null };

function awkParse(src: string): AwkRule[] {
  const toks = awkLex(src);
  let p = 0;
  const is = (v: string) => !!toks[p] && (toks[p].k === 'op' || toks[p].k === 'id') && toks[p].v === v;
  const eat = (v: string) => {
    if (!is(v)) throw new Fail(`awk: expected '${v}'`);
    p++;
  };
  const primary = (): AwkNode => {
    const t = toks[p++];
    if (!t) throw new Fail('awk: unexpected end of program');
    if (t.k === 'num') return { t: 'num', v: Number(t.v) };
    if (t.k === 'str') return { t: 'str', v: t.v };
    if (t.k === 're') return { t: 're', v: t.v };
    if (t.k === 'field') return { t: 'field', v: t.v };
    if (t.k === 'id') return { t: 'var', v: t.v };
    if (t.v === '(') {
      const e = expr();
      eat(')');
      return e;
    }
    if (t.v === '!') return { t: 'not', e: primary() };
    if (t.v === '-') return { t: 'neg', e: primary() };
    throw new Fail(`awk: unexpected '${t.v}'`);
  };
  const mul = (): AwkNode => {
    let l = primary();
    while (is('*') || is('/') || is('%')) {
      const op = toks[p++].v;
      l = { t: 'bin', op, l, r: primary() };
    }
    return l;
  };
  const add = (): AwkNode => {
    let l = mul();
    while (is('+') || is('-')) {
      const op = toks[p++].v;
      l = { t: 'bin', op, l, r: mul() };
    }
    return l;
  };
  const startsValue = () => {
    const t = toks[p];
    return !!t && (t.k === 'num' || t.k === 'str' || t.k === 'field' || t.k === 'id' || (t.k === 'op' && t.v === '('));
  };
  const concat = (): AwkNode => {
    let l = add();
    while (startsValue() && !['print', 'printf'].includes(toks[p].v)) l = { t: 'cat', l, r: add() };
    return l;
  };
  const cmp = (): AwkNode => {
    let l = concat();
    while (['==', '!=', '<', '>', '<=', '>=', '~', '!~'].some((o) => is(o))) {
      const op = toks[p++].v;
      l = { t: 'bin', op, l, r: concat() };
    }
    return l;
  };
  const and = (): AwkNode => {
    let l = cmp();
    while (is('&&')) {
      p++;
      l = { t: 'bin', op: '&&', l, r: cmp() };
    }
    return l;
  };
  const expr = (): AwkNode => {
    let l = and();
    while (is('||')) {
      p++;
      l = { t: 'bin', op: '||', l, r: and() };
    }
    return l;
  };
  const stmt = (): AwkStmt => {
    if (is('print') || is('printf')) {
      const kind = toks[p++].v as 'print' | 'printf';
      const args: AwkNode[] = [];
      if (!is(';') && !is('}')) {
        args.push(expr());
        while (is(',')) {
          p++;
          args.push(expr());
        }
      }
      return { t: kind, args };
    }
    const t = toks[p];
    const n = toks[p + 1];
    if (t?.k === 'id' && n?.k === 'op' && ['=', '+=', '-=', '*=', '/=', '++', '--'].includes(n.v)) {
      p += 2;
      return n.v === '++' || n.v === '--' ? { t: 'assign', name: t.v, op: n.v } : { t: 'assign', name: t.v, op: n.v, e: expr() };
    }
    return { t: 'expr', e: expr() };
  };
  const block = (): AwkStmt[] => {
    eat('{');
    const out: AwkStmt[] = [];
    while (!is('}')) {
      if (p >= toks.length) throw new Fail("awk: missing '}'");
      if (is(';')) {
        p++;
        continue;
      }
      out.push(stmt());
    }
    eat('}');
    return out;
  };
  const rules: AwkRule[] = [];
  while (p < toks.length) {
    if (is(';')) {
      p++;
      continue;
    }
    let pattern: AwkRule['pattern'] = null;
    if (is('BEGIN') || is('END')) pattern = toks[p++].v as 'BEGIN' | 'END';
    else if (!is('{')) pattern = expr();
    rules.push({ pattern, body: is('{') ? block() : null });
  }
  return rules;
}

function runAwk(prog: string, input: string, fsArg?: string): string {
  const rules = awkParse(prog);
  const vars: Record<string, string | number> = { NR: 0, NF: 0 };
  const sep = fsArg === undefined ? ' ' : fsArg === '\\t' ? '\t' : fsArg;
  let fields: string[] = [];
  let line = '';
  let out = '';
  const num = (v: string | number) => (typeof v === 'number' ? v : parseFloat(v) || 0);
  const str = (v: string | number) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)))) : v);
  const truthy = (v: string | number) => (typeof v === 'number' ? v !== 0 : v !== '');
  const isNumeric = (x: string | number) => typeof x === 'number' || /^\s*[-+]?\d+(\.\d+)?\s*$/.test(x);
  const ev = (n: AwkNode): string | number => {
    switch (n.t) {
      case 'num':
        return n.v;
      case 'str':
        return n.v;
      case 're':
        return new RegExp(n.v).test(line) ? 1 : 0;
      case 'var':
        return vars[n.v] ?? '';
      case 'field': {
        if (n.v === 'NF') return fields[fields.length - 1] ?? '';
        const k = Number(n.v);
        return k === 0 ? line : (fields[k - 1] ?? '');
      }
      case 'not':
        return truthy(ev(n.e)) ? 0 : 1;
      case 'neg':
        return -num(ev(n.e));
      case 'cat':
        return str(ev(n.l)) + str(ev(n.r));
      case 'bin': {
        if (n.op === '&&') return truthy(ev(n.l)) && truthy(ev(n.r)) ? 1 : 0;
        if (n.op === '||') return truthy(ev(n.l)) || truthy(ev(n.r)) ? 1 : 0;
        if (n.op === '~' || n.op === '!~') {
          const re = n.r.t === 're' ? new RegExp(n.r.v) : new RegExp(str(ev(n.r)));
          return (n.op === '~') === re.test(str(ev(n.l))) ? 1 : 0;
        }
        const l = ev(n.l);
        const r = ev(n.r);
        if (['==', '!=', '<', '>', '<=', '>='].includes(n.op)) {
          const both = isNumeric(l) && isNumeric(r);
          const a = both ? num(l) : str(l);
          const b = both ? num(r) : str(r);
          const res = { '==': a === b, '!=': a !== b, '<': a < b, '>': a > b, '<=': a <= b, '>=': a >= b } as Record<string, boolean>;
          return res[n.op] ? 1 : 0;
        }
        const a = num(l);
        const b = num(r);
        const res = { '+': a + b, '-': a - b, '*': a * b, '/': b === 0 ? 0 : a / b, '%': b === 0 ? 0 : a % b } as Record<string, number>;
        return res[n.op];
      }
    }
  };
  const exec = (body: AwkStmt[]) => {
    for (const s of body) {
      if (s.t === 'print') out += (s.args.length ? s.args.map((a) => str(ev(a))).join(' ') : line) + '\n';
      else if (s.t === 'printf') {
        const [f, ...a] = s.args.map(ev);
        let k = 0;
        out += str(f ?? '').replace(/%-?\d*(?:\.(\d+))?([sdf])/g, (_m, prec, c) => {
          const v = a[k++] ?? '';
          return c === 'd' ? String(Math.trunc(num(v))) : c === 'f' ? num(v).toFixed(prec ? Number(prec) : 6) : str(v);
        });
      } else if (s.t === 'assign') {
        const cur = vars[s.name] ?? 0;
        if (s.op === '++') vars[s.name] = num(cur) + 1;
        else if (s.op === '--') vars[s.name] = num(cur) - 1;
        else if (s.op === '=') vars[s.name] = ev(s.e!);
        else {
          const v = num(ev(s.e!));
          vars[s.name] = s.op === '+=' ? num(cur) + v : s.op === '-=' ? num(cur) - v : s.op === '*=' ? num(cur) * v : v === 0 ? 0 : num(cur) / v;
        }
      } else ev(s.e);
      if (out.length > MAX_OUT) throw new Fail('awk: output too large');
    }
  };
  for (const r of rules) if (r.pattern === 'BEGIN' && r.body) exec(r.body);
  for (const l of lines(input)) {
    line = l;
    vars.NR = num(vars.NR) + 1;
    fields = sep === ' ' ? l.trim().split(/\s+/).filter(Boolean) : l.split(sep);
    vars.NF = fields.length;
    for (const r of rules) {
      if (r.pattern === 'BEGIN' || r.pattern === 'END') continue;
      if (r.pattern && !truthy(ev(r.pattern))) continue;
      if (r.body) exec(r.body);
      else out += line + '\n';
    }
  }
  for (const r of rules) if (r.pattern === 'END' && r.body) exec(r.body);
  return out;
}
