/**
 * OPT-IN REHEARSAL / LOAD SIMULATOR — never runs in normal mode.
 *
 *   npm run rehearsal:sim -w server -- --yes [--slot 1] [--sessions 4] [--duration 60] [--think 8] [--all] [--start] [--base http://127.0.0.1:4000]
 *
 * Signs in the demo crews of one slot (CRW-001…CRW-040 seeded by `npm run seed:demo`)
 * from several devices each and drives realistic traffic through the real
 * /api/v1 endpoints: snapshot polling, question detail, wrong answers, correct
 * solves, hint purchases, rankings, while an observer socket in the same slot
 * measures solve → broadcast latency. `--all` also signs in the 30 crews of the
 * other slots (polling only — they must see nothing of the running slot).
 * `--start` makes the organizer start the slot's next sprint first.
 * Requires DEMO_MODE=true. It writes real rows (sessions, submissions, ledger):
 * run it on a rehearsal database and `npm run reset:demo -- --yes` afterwards.
 */
import { io } from 'socket.io-client';
import { loadConfig } from '../config.js';
import { createPool, many } from '../db.js';
import { demoCrewPassword } from '../seed/demo.js';

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const SLOT = Number(arg('slot', '1'));
const SESSIONS = Number(arg('sessions', '4'));
const DURATION = Number(arg('duration', '60'));
const THINK = Number(arg('think', '8'));
const BASE = arg('base', 'http://127.0.0.1:4000').replace(/\/$/, '');
const START = argv.includes('--start');
const ALL = argv.includes('--all');
const V = '/api/v1';

const cfg = loadConfig();
if (!cfg.demoMode || !argv.includes('--yes')) {
  console.error('[sim] Opt-in only: requires DEMO_MODE=true and --yes. Writes sessions, submissions and ledger rows.');
  process.exit(1);
}

class Jar {
  cookie = '';
  async req(method: string, path: string, body?: unknown, key?: string) {
    const t0 = performance.now();
    let res: Response;
    try {
      res = await fetch(BASE + path, {
        method,
        headers: {
          ...(this.cookie ? { cookie: this.cookie } : {}),
          ...(method !== 'GET' ? { 'content-type': 'application/json', 'x-requested-with': 'amongbugs', origin: BASE } : {}),
          ...(key ? { 'idempotency-key': key } : {}),
        },
        body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined,
      });
    } catch {
      return { status: 0, body: null as any, ms: performance.now() - t0 }; // eslint-disable-line @typescript-eslint/no-explicit-any
    }
    const sc = res.headers.get('set-cookie');
    if (sc?.startsWith('ab_sid=')) this.cookie = sc.split(';')[0];
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json as any, ms: performance.now() - t0 }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
}

const lat: Record<string, number[]> = {};
const errs: Record<string, number> = {};
function record(op: string, ms: number, status: number) {
  (lat[op] ??= []).push(ms);
  if (status >= 500 || status === 0) errs[op] = (errs[op] ?? 0) + 1;
}
const pct = (a: number[], p: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const key = () => `sim-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const db = createPool(cfg.databaseUrl, 4);
  const org = new Jar();
  const ol = await org.req('POST', `${V}/auth/organizer-login`, { email: process.env.SIM_ORGANIZER_EMAIL ?? 'admin@crm.local', password: process.env.SIM_ORGANIZER_PASSWORD ?? 'idealab' });
  if (ol.status !== 200) throw new Error(`organizer login failed: ${JSON.stringify(ol.body)}`);
  const ov = await org.req('GET', `${V}/admin/overview`);
  const slot = ov.body.slots.find((s: { number: number }) => s.number === SLOT);
  if (!slot) throw new Error(`Slot ${SLOT} not found.`);
  console.log(`[sim] ${slot.name} (${slot.date}) phase ${slot.phase}, sprint ${slot.currentSprint}/4`);
  if (START && slot.nextSprint) {
    const s = await org.req('POST', `${V}/admin/slots/${slot.id}/sprints/${slot.nextSprint}/start`, {});
    console.log(`[sim] start sprint ${slot.nextSprint} → ${s.status} ${s.status !== 200 ? JSON.stringify(s.body).slice(0, 300) : ''}`);
  }

  const crews = Array.from({ length: 40 }, (_, i) => i + 1).filter((n) => ALL || Math.ceil(n / 10) === SLOT);
  const jars: { jar: Jar; n: number; mine: boolean }[] = [];
  await Promise.all(
    crews.map(async (n) => {
      for (let s = 0; s < SESSIONS; s++) {
        const j = new Jar();
        const r = await j.req('POST', `${V}/auth/crew-login`, { identifier: `CRW-${String(n).padStart(3, '0')}`, password: demoCrewPassword(n) });
        record('login', r.ms, r.status);
        if (r.status === 200) jars.push({ jar: j, n, mine: Math.ceil(n / 10) === SLOT });
      }
    }),
  );
  console.log(`[sim] ${jars.length} sessions signed in (${crews.length} crews × ${SESSIONS})`);

  // Simulator-only answer key, read directly from the private solutions.
  const solutions = new Map(
    (
      await many<{ id: string; generation: number; validation: { mode: string }; solution: { answer?: string; files?: Record<string, string> } }>(
        db,
        `SELECT qi.id, qi.generation, qv.validation, qv.solution FROM question_instance qi JOIN question_version qv ON qv.id=qi.question_version_id WHERE qi.slot_id=$1`,
        [slot.id],
      )
    ).map((r) => [r.id, r.validation.mode === 'CODE_TESTS' ? { generation: r.generation, files: r.solution.files } : { generation: r.generation, answer: String(r.solution.answer) }]),
  );

  // Observer in the slot: solve → broadcast latency. A crew of another slot must see nothing.
  const pending = new Map<string, number>();
  const prop: number[] = [];
  let leaked = 0;
  const observer = jars.find((j) => j.mine)!;
  const obs = io(BASE, { path: '/socket.io', transports: ['websocket'], extraHeaders: { cookie: observer.jar.cookie, origin: BASE } });
  obs.on('question.solved', (m: { instanceId: string }) => {
    const t = pending.get(m.instanceId);
    if (t) {
      prop.push(performance.now() - t);
      pending.delete(m.instanceId);
    }
  });
  const outsider = jars.find((j) => !j.mine);
  const out = outsider ? io(BASE, { path: '/socket.io', transports: ['websocket'], extraHeaders: { cookie: outsider.jar.cookie, origin: BASE } }) : null;
  out?.on('question.solved', (m: { slotId: string }) => {
    if (m.slotId === slot.id) leaked++;
  });

  const end = Date.now() + DURATION * 1000;
  let solves = 0;
  await Promise.all(
    jars.map(async ({ jar, mine }, idx) => {
      await sleep(Math.random() * 3000);
      while (Date.now() < end) {
        const st = await jar.req('GET', `${V}/slots/mine/state`);
        record('state', st.ms, st.status);
        if (!mine) {
          if (st.body?.slot?.id === slot.id) leaked++;
          await sleep(THINK * 1000);
          continue;
        }
        const avail = [...(st.body?.questions ?? [])].filter((t: { state: string }) => t.state === 'AVAILABLE');
        if (avail.length && st.body?.sprint?.status === 'RUNNING') {
          const t = avail[Math.floor(Math.random() * avail.length)];
          const roll = Math.random();
          if (roll < 0.3) {
            const d = await jar.req('GET', `${V}/question-instances/${t.id}`);
            record('open_question', d.ms, d.status);
          } else if (roll < 0.45) {
            const r = await jar.req('POST', `${V}/question-instances/${t.id}/submissions`, { generation: t.generation, answer: 'definitely-wrong', files: {} }, key());
            record('submit_wrong', r.ms, r.status);
          } else if (roll < 0.58 && idx % SESSIONS === 0) {
            const sol = solutions.get(t.id);
            if (sol) {
              pending.set(t.id, performance.now());
              const r = await jar.req('POST', `${V}/question-instances/${t.id}/submissions`, sol, key());
              record('submit_correct_attempt', r.ms, r.status);
              if (r.body?.correct) solves++;
            }
          } else if (roll < 0.66) {
            const r = await jar.req('POST', `${V}/question-instances/${t.id}/hint-purchases`, {}, key());
            record('hint', r.ms, r.status);
          } else if (roll < 0.74) {
            const r = await jar.req('GET', `${V}/leaderboards?scope=${['sprint', 'cumulative', 'event'][Math.floor(Math.random() * 3)]}`);
            record('leaderboard', r.ms, r.status);
          }
        }
        await sleep(THINK * 1000 * (0.6 + Math.random() * 0.8));
      }
    }),
  );
  obs.close();
  out?.close();

  console.log(`\n[sim] SIMULATED REHEARSAL REPORT — ${slot.name}, ${jars.length} sessions, ${DURATION}s, ${solves} correct solves`);
  console.log('op'.padEnd(26), 'count'.padStart(6), 'p50ms'.padStart(8), 'p95ms'.padStart(8), 'maxms'.padStart(8), '5xx'.padStart(5));
  for (const [op, a] of Object.entries(lat)) {
    console.log(op.padEnd(26), String(a.length).padStart(6), pct(a, 50).toFixed(0).padStart(8), pct(a, 95).toFixed(0).padStart(8), Math.max(...a).toFixed(0).padStart(8), String(errs[op] ?? 0).padStart(5));
  }
  console.log('solve→broadcast'.padEnd(26), String(prop.length).padStart(6), pct(prop, 50).toFixed(0).padStart(8), pct(prop, 95).toFixed(0).padStart(8), (prop.length ? Math.max(...prop) : 0).toFixed(0).padStart(8));
  console.log(`cross-slot leaks observed: ${leaked}${ALL ? '' : ' (run with --all to check other slots)'}`);
  await db.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
