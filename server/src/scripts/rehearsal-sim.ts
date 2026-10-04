/**
 * OPT-IN REHEARSAL / LOAD SIMULATOR — never runs in normal mode.
 *
 *   npm run rehearsal:sim -w server -- --yes [--crews 100] [--sessions 4] [--duration 60] [--base http://127.0.0.1:4000] [--start]
 *
 * Creates clearly-named "SIM ####" crews through the real admin API (enabled for the
 * current day), signs each in from several sessions, and drives realistic traffic
 * through the real API: snapshot polling, wrong answers, correct solves, hint
 * purchases and runs, while one observer socket measures standings propagation.
 * Reports p50/p95/max latency per operation. Requires DEMO_MODE=true.
 * The simulated crews are real database rows: run it only on a rehearsal database
 * (npm run reset:demo -- --yes afterwards).
 */
import { io } from 'socket.io-client';
import { loadConfig } from '../config.js';
import { imposterTemplates, regularTemplates } from '../content/index.js';
import { createPool, many } from '../db.js';

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const CREWS = Number(arg('crews', '100'));
const SESSIONS = Number(arg('sessions', '4'));
const DURATION = Number(arg('duration', '60'));
const BASE = arg('base', 'http://127.0.0.1:4000').replace(/\/$/, '');
const START = argv.includes('--start');
/** Seconds between a simulated device's actions (real crews read/think between attempts). */
const THINK = Number(arg('think', '8'));

const cfg = loadConfig();
if (!cfg.demoMode || !argv.includes('--yes')) {
  console.error('[sim] Opt-in only: requires DEMO_MODE=true and --yes. Creates SIM crews in the database.');
  process.exit(1);
}

class Jar {
  cookie = '';
  async req(method: string, path: string, body?: unknown, key?: string) {
    const t0 = performance.now();
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(method !== 'GET' ? { 'content-type': 'application/json', 'x-requested-with': 'amongbugs' } : {}),
        ...(key ? { 'idempotency-key': key } : {}),
      },
      body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc?.startsWith('ab_sid=')) this.cookie = sc.split(';')[0];
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json as any, ms: performance.now() - t0 };
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

async function main() {
  const db = createPool(cfg.databaseUrl, 4);
  const admin = new Jar();
  const adminEmail = process.env.SIM_ADMIN_EMAIL ?? 'admin@crm.local';
  const adminPw = process.env.SIM_ADMIN_PASSWORD ?? 'idealab';
  const al = await admin.req('POST', '/api/auth/login', { mode: 'COMMANDER', identifier: adminEmail, password: adminPw });
  if (al.status !== 200) throw new Error(`admin login failed: ${JSON.stringify(al.body)}`);
  const ov = await admin.req('GET', '/api/admin/overview');
  const dayNo = ov.body.currentDay?.day_number;
  if (!dayNo) throw new Error('No current day configured.');
  const game = ov.body.games.find((g: { dayId: string }) => g.dayId === ov.body.currentDay.id);
  console.log(`[sim] day ${dayNo}, ${game.name}, phase ${game.phase}`);

  // 1) create SIM crews through the admin API
  const stamp = Date.now().toString(36).slice(-4).toUpperCase();
  const creds: { email: string; password: string }[] = [];
  for (let i = 0; i < CREWS; i += 50) {
    const batch = Array.from({ length: Math.min(50, CREWS - i) }, (_, j) => {
      const n = i + j + 1;
      return {
        teamName: `SIM ${stamp} ${String(n).padStart(3, '0')}`,
        captainEmail: `sim-${stamp.toLowerCase()}-${n}@example.test`,
        members: [1, 2, 3].map((m) => ({ name: `Sim Member ${m}`, institution: 'Simulation', year: '1st year', branch: 'SIM' })),
        requestedDays: 'BOTH',
        color: '#7dace9',
        activeDays: [dayNo],
      };
    });
    const r = await admin.req('POST', '/api/admin/crews', { crews: batch, via: 'IMPORT' });
    if (r.status !== 201) throw new Error(`crew creation failed: ${JSON.stringify(r.body)}`);
    for (const c of r.body.created) creds.push({ email: c.email, password: c.temporaryPassword });
  }
  console.log(`[sim] created ${creds.length} SIM crews`);

  if (START && ['WAITING', 'DRAFT', 'READY'].includes(game.phase)) {
    await admin.req('PATCH', `/api/admin/games/${game.id}/config`, { rankingMetricConfirmed: true });
    const s = await admin.req('POST', `/api/admin/games/${game.id}/start-sprint`, { sprint: 1, acknowledgeZeroElimination: true });
    console.log(`[sim] start sprint 1 → ${s.status} ${s.status !== 200 ? JSON.stringify(s.body).slice(0, 300) : ''}`);
  }

  // 2) sessions
  const jars: Jar[] = [];
  await Promise.all(
    creds.map(async (c) => {
      for (let s = 0; s < SESSIONS; s++) {
        const j = new Jar();
        const r = await j.req('POST', '/api/auth/login', { mode: 'CREW', identifier: c.email, password: c.password });
        record('login', r.ms, r.status);
        if (r.status === 200) jars.push(j);
      }
    }),
  );
  console.log(`[sim] ${jars.length} sessions signed in`);

  // Solutions for correct solves (simulator-only, read from server templates + DB mapping).
  const tasks = await many<{ id: string; source_template: string; source_variant: number; generation: number }>(
    db,
    `SELECT ti.id, pv.source_template, pv.source_variant, ti.generation FROM task_instance ti JOIN problem_version pv ON pv.id=ti.problem_version_id
      WHERE ti.game_id=$1 AND ti.sprint_id=(SELECT id FROM sprint WHERE game_id=$1 AND status='RUNNING' LIMIT 1)`,
    [game.id],
  );
  const solution = (t: (typeof tasks)[number]) => {
    const tpl = [...regularTemplates, ...imposterTemplates].find((x) => x.key === t.source_template)!;
    const v = tpl.variant(t.source_variant as 0 | 1 | 2 | 3);
    const files = Object.fromEntries(v.files.map((f) => [f.name, f.content]));
    return v.validation.mode === 'CODE_TESTS' ? { generation: t.generation, files: { ...files, ...v.solution.files } } : { generation: t.generation, answer: v.solution.answer };
  };

  // 3) observer socket for propagation latency
  const pending = new Map<string, number>();
  const prop: number[] = [];
  const obs = io(BASE, { path: '/socket.io', transports: ['websocket'], extraHeaders: { cookie: jars[0]?.cookie ?? '' } });
  obs.on('task.solved', (m: { taskId: string }) => {
    const t = pending.get(m.taskId);
    if (t) {
      prop.push(performance.now() - t);
      pending.delete(m.taskId);
    }
  });

  // 4) traffic
  const end = Date.now() + DURATION * 1000;
  let solves = 0;
  await Promise.all(
    jars.map(async (j, idx) => {
      await new Promise((r) => setTimeout(r, Math.random() * 3000));
      while (Date.now() < end) {
        const st = await j.req('GET', '/api/game/state');
        record('state', st.ms, st.status);
        const avail = (st.body?.tasks?.tasks ?? []).filter((t: { state: string }) => t.state === 'AVAILABLE');
        if (avail.length && st.body?.game?.phase === 'RUNNING') {
          const t = avail[Math.floor(Math.random() * avail.length)];
          const roll = Math.random();
          if (roll < 0.35) {
            const d = await j.req('GET', `/api/game/tasks/${t.id}`);
            record('open_task', d.ms, d.status);
          } else if (roll < 0.5) {
            const r = await j.req('POST', `/api/game/tasks/${t.id}/submit`, { generation: t.generation, answer: 'definitely-wrong', files: {} }, key());
            record('submit_wrong', r.ms, r.status);
          } else if (roll < 0.62 && idx % SESSIONS === 0) {
            const row = tasks.find((x) => x.id === t.id);
            if (row) {
              const before = performance.now();
              pending.set(t.id, before);
              const r = await j.req('POST', `/api/game/tasks/${t.id}/submit`, solution(row), key());
              record('submit_correct_attempt', r.ms, r.status);
              if (r.body?.correct) solves++;
            }
          } else if (roll < 0.7) {
            const r = await j.req('POST', `/api/game/tasks/${t.id}/hint`, {}, key());
            record('hint', r.ms, r.status);
          } else if (roll < 0.75) {
            const r = await j.req('POST', '/api/game/run', { target: { type: 'TASK', id: t.id }, files: {}, stdin: '' });
            record('run', r.ms, r.status);
          }
        }
        await new Promise((r) => setTimeout(r, THINK * 1000 * (0.6 + Math.random() * 0.8)));
      }
    }),
  );
  obs.close();

  console.log(`\n[sim] SIMULATED REHEARSAL REPORT — ${jars.length} sessions (${creds.length} crews × ${SESSIONS}), ${DURATION}s, ${solves} correct solves`);
  console.log('op'.padEnd(26), 'count'.padStart(6), 'p50ms'.padStart(8), 'p95ms'.padStart(8), 'maxms'.padStart(8), '5xx'.padStart(5));
  for (const [op, a] of Object.entries(lat)) {
    console.log(op.padEnd(26), String(a.length).padStart(6), pct(a, 50).toFixed(0).padStart(8), pct(a, 95).toFixed(0).padStart(8), Math.max(...a).toFixed(0).padStart(8), String(errs[op] ?? 0).padStart(5));
  }
  console.log('solve→broadcast'.padEnd(26), String(prop.length).padStart(6), pct(prop, 50).toFixed(0).padStart(8), pct(prop, 95).toFixed(0).padStart(8), (prop.length ? Math.max(...prop) : 0).toFixed(0).padStart(8));
  await db.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
