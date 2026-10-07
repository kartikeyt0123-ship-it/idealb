/**
 * Execution of the question-bank runtimes behind the crew's Run button.
 * Hidden material (setup, validation, filesystems, tables, expected states)
 * never leaves the server except as the program output it produces.
 *
 *  python  The participant's main.py runs between hidden setup and hidden check
 *          code in ONE process (the check calls the participant's functions).
 *          Hidden code is passed through stdin (never written to a readable file);
 *          the flag literal in the check is replaced by a per-run marker that the
 *          server swaps back only in the output. Figures → PNG images.
 *  sql     SQLite in the runner: hidden tables are loaded, the query's rows printed.
 *  json    Server-side: the edited JSON must deep-equal the expected state.
 *  shell   Server-side virtual terminal (services/shell.ts).
 */
import { randomBytes } from 'node:crypto';
import type { Runtime } from '../content/types.js';

export const PY_WRAPPER = String.raw`import sys, io, json, base64, traceback
_raw = sys.stdin.read()
_hdr, _sep, _ = _raw.partition('\n')
_m = json.loads(_hdr)
_b = lambda s: base64.b64decode(s).decode('utf-8')
_pre, _chk, _plot, _gate = _b(_m['p']), _b(_m['c']), _m['g'], _m.get('q', False)
sys.stdin = io.StringIO(_b(_m['i']))
del _raw, _hdr, _sep, _, _m

class _Tee(io.TextIOBase):
    def __init__(self, a, b):
        self.a, self.b = a, b
    def write(self, s):
        self.a.write(s)
        self.b.write(s)
        return len(s)
    def flush(self):
        self.a.flush()

def _main(pre, chk, plot, gate):
    import contextlib, re
    g = {'__name__': '__main__', '__builtins__': __builtins__}
    if pre:
        exec(compile(pre, '<setup>', 'exec'), g)
    with open('main.py', encoding='utf-8') as fh:
        src = fh.read()
    ok = True
    seen = io.StringIO()
    try:
        with contextlib.redirect_stdout(_Tee(sys.stdout, seen)):
            exec(compile(src, 'main.py', 'exec'), g)
    except SystemExit:
        pass
    except BaseException:
        ok = False
        tb = traceback.format_exc().splitlines()
        # Hide the wrapper frames; keep the participant's lines.
        keep = [l for l in tb if '<setup>' not in l and '__run__' not in l and 'exec(compile' not in l and 'contextlib' not in l]
        print('\n'.join(keep), file=sys.stderr)
    if ok and chk and not gate:
        try:
            exec(compile(chk, '<check>', 'exec'), g)
        except BaseException:
            pass
    elif ok and chk and gate:
        # The check recomputes the answer by itself: reveal its output only when the
        # participant's own output already contains a value the check computed.
        h = dict(g)
        out = io.StringIO()
        try:
            with contextlib.redirect_stdout(out):
                exec(compile(chk, '<check>', 'exec'), h)
        except BaseException:
            pass
        vals = set()
        for k, v in h.items():
            if k.startswith('__') or (k in g and g[k] is v):
                continue
            if isinstance(v, bool):
                continue
            if isinstance(v, (int, str)):
                vals.add(str(v).strip())
            elif isinstance(v, float):
                vals.update({repr(v), str(round(v, 2)), str(round(v, 3)), ('%g' % v)})
        tokens = set(re.findall(r'-?[\w.]+', seen.getvalue()))
        if out.getvalue().strip() and vals & tokens:
            sys.stdout.write(out.getvalue())
        elif out.getvalue().strip():
            print('\n[check] Your printed result is not the expected one yet.')
    if plot and 'matplotlib.pyplot' in sys.modules:
        plt = sys.modules['matplotlib.pyplot']
        for n in plt.get_fignums():
            buf = io.BytesIO()
            plt.figure(n).savefig(buf, format='png', dpi=72, bbox_inches='tight')
            print('@@AB_IMG@@' + base64.b64encode(buf.getvalue()).decode())
    sys.stdout.flush()
    if not ok:
        sys.exit(1)

_main(_pre, _chk, _plot, _gate)
del _pre, _chk, _plot, _gate
`;

const IMG = '@@AB_IMG@@';

export function buildPythonJob(rt: Extract<Runtime, { kind: 'python' }>, mainPy: string, stdin: string, flag: string | undefined) {
  const nonce = `@@AB_PASS_${randomBytes(9).toString('hex')}@@`;
  // The literal flag never reaches the runner: the check prints the marker instead.
  const check = flag ? (rt.suffix ?? '').split(flag).join(nonce) : (rt.suffix ?? '');
  const b = (s: string) => Buffer.from(s, 'utf8').toString('base64');
  const header = JSON.stringify({ p: b(rt.prefix ?? ''), c: b(check), g: !!rt.plot, q: !!rt.gate, i: b(stdin) });
  return {
    files: { '__run__.py': PY_WRAPPER, 'main.py': mainPy },
    entry: '__run__.py',
    stdin: header + '\n',
    finish: (stdout: string) => {
      const images: string[] = [];
      const kept: string[] = [];
      for (const line of stdout.split('\n')) {
        if (line.startsWith(IMG)) images.push(line.slice(IMG.length).trim());
        else kept.push(line);
      }
      let out = kept.join('\n');
      if (flag) out = out.split(nonce).join(flag);
      return { stdout: out, images };
    },
  };
}

export const SQL_RUNNER = String.raw`import sqlite3, json, sys
tables = json.load(open('tables.json', encoding='utf-8'))
con = sqlite3.connect(':memory:')
q = lambda n: '"' + str(n).replace('"', '""') + '"'
# SQLite reserves sqlite_* names: those come from the real catalogue (sqlite_master lists the tables
# created here). Tables the data lists in its own sqlite_master are created (empty) so they show up too.
listed = [r.get('name') for r in tables.get('sqlite_master', []) if isinstance(r, dict) and r.get('type', 'table') == 'table']
for name in listed:
    if name and not str(name).startswith('sqlite_') and name not in tables:
        tables[name] = []
for name, rows in list(tables.items()):
    if str(name).lower().startswith('sqlite_'):
        continue
    cols = []
    for r in rows:
        for k in r:
            if k not in cols:
                cols.append(k)
    if not cols:
        cols = ['id']
    con.execute('CREATE TABLE %s (%s)' % (q(name), ', '.join(q(c) for c in cols)))
    for r in rows:
        con.execute('INSERT INTO %s (%s) VALUES (%s)' % (q(name), ', '.join(q(c) for c in cols), ', '.join('?' for _ in cols)),
                    [json.dumps(r.get(c)) if isinstance(r.get(c), (dict, list)) else r.get(c) for c in cols])
sql = open('query.sql', encoding='utf-8').read()
cur = con.cursor()
try:
    for stmt in [s for s in sql.split(';') if s.strip()]:
        cur.execute(stmt)
        if cur.description:
            names = [d[0] for d in cur.description]
            rows = cur.fetchmany(200)
            cells = [[('NULL' if v is None else str(v)) for v in row] for row in rows]
            widths = [max([len(n)] + [len(r[i]) for r in cells]) for i, n in enumerate(names)]
            line = '+' + '+'.join('-' * (w + 2) for w in widths) + '+'
            print(line)
            print('| ' + ' | '.join(n.ljust(w) for n, w in zip(names, widths)) + ' |')
            print(line)
            for r in cells:
                print('| ' + ' | '.join(v.ljust(w) for v, w in zip(r, widths)) + ' |')
            print(line)
            print('(%d row%s)' % (len(rows), '' if len(rows) == 1 else 's'))
        else:
            print('OK (%d row(s) affected)' % cur.rowcount)
except sqlite3.Error as e:
    print('SQL error: %s' % e, file=sys.stderr)
    sys.exit(1)
`;

export function buildSqlJob(rt: Extract<Runtime, { kind: 'sql' }>, query: string) {
  return { files: { '__sql__.py': SQL_RUNNER, 'tables.json': JSON.stringify(rt.tables), 'query.sql': query }, entry: '__sql__.py' };
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  return v;
}

/** Maker JSON / API checks: parse the edited document and compare with the expected state. */
export function runJsonCheck(rt: Extract<Runtime, { kind: 'json' }>, content: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return { stdout: '', stderr: `Invalid JSON: ${(e as Error).message}\n`, exitCode: 1, success: false };
  }
  const ok = JSON.stringify(canonical(parsed)) === JSON.stringify(canonical(rt.expected));
  const target = rt.endpoint ? `${rt.endpoint}` : 'device';
  return ok
    ? { stdout: `${rt.endpoint ? `→ ${rt.endpoint}\n` : ''}✔ ${target} accepted the ${rt.endpoint ? 'request' : 'configuration'}.\n${rt.success}\n`, stderr: '', exitCode: 0, success: true }
    : { stdout: `${rt.endpoint ? `→ ${rt.endpoint}\n← 403 Forbidden\n` : ''}✖ ${target} rejected the ${rt.endpoint ? 'request' : 'configuration'}: the state does not match what the hardware expects.\n`, stderr: '', exitCode: 1, success: false };
}
