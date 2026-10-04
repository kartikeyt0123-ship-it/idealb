/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto';
import { buildApp, type BuiltApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { imposterTemplates, regularTemplates } from '../src/content/index.js';
import { createPool, many, one, type Db } from '../src/db.js';
import { dropAll, migrate } from '../src/migrate.js';
import { seedDemo } from '../src/seed/demo.js';

export interface Env {
  cfg: AppConfig;
  db: Db;
  built: BuiltApp;
  close: () => Promise<void>;
}

/** Fresh schema + demo seed + app, against the suite's real PostgreSQL and runner. */
export async function freshEnv(opts: { listen?: boolean } = {}): Promise<Env> {
  const cfg = loadConfig({ logLevel: 'silent', nodeEnv: 'test', demoMode: true, allowedOrigins: ['http://localhost:5173'] });
  const db = createPool(cfg.databaseUrl, 30);
  await dropAll(db);
  await migrate(db, () => undefined);
  await seedDemo(db, cfg, () => undefined);
  const built = await buildApp(cfg, { db });
  if (opts.listen) await built.app.listen({ port: 0, host: '127.0.0.1' });
  return {
    cfg, db, built,
    close: async () => {
      await built.close();
      await db.end();
    },
  };
}

export interface Res<T = any> {
  status: number;
  body: T;
}

/** A browser-like client: keeps its own session cookie, sends the CSRF header. */
export class Client {
  cookie = '';
  constructor(private readonly env: Env) {}

  async req<T = any>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res<T>> {
    const r = await this.env.built.app.inject({
      method: method as any,
      url,
      headers: {
        ...(method === 'GET' ? {} : { 'content-type': 'application/json', 'x-requested-with': 'amongbugs' }),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      payload: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
    const set = r.headers['set-cookie'];
    const sc = Array.isArray(set) ? set : set ? [set] : [];
    for (const c of sc) {
      const [kv] = c.split(';');
      if (kv.startsWith('ab_sid=')) this.cookie = kv === 'ab_sid=' || /Expires=Thu, 01 Jan 1970/i.test(c) ? '' : kv;
    }
    let parsed: any = r.body;
    try {
      parsed = JSON.parse(r.body);
    } catch {
      /* text body */
    }
    return { status: r.statusCode, body: parsed };
  }
  get<T = any>(url: string) {
    return this.req<T>('GET', url);
  }
  post<T = any>(url: string, body?: unknown, idem = false) {
    return this.req<T>('POST', url, body, idem ? { 'idempotency-key': `k-${randomUUID()}` } : {});
  }
  postKey<T = any>(url: string, body: unknown, key: string) {
    return this.req<T>('POST', url, body, { 'idempotency-key': key });
  }
  patch<T = any>(url: string, body?: unknown) {
    return this.req<T>('PATCH', url, body);
  }
  clone() {
    const c = new Client(this.env);
    c.cookie = this.cookie;
    return c;
  }

  async loginCrew(identifier: string, password: string) {
    const r = await this.post('/api/auth/login', { mode: 'CREW', identifier, password });
    if (r.status !== 200) throw new Error(`crew login failed ${r.status} ${JSON.stringify(r.body)}`);
    return r;
  }
  async loginAdmin(identifier = 'admin@crm.local', password = 'idealab') {
    const r = await this.post('/api/auth/login', { mode: 'COMMANDER', identifier, password });
    if (r.status !== 200) throw new Error(`admin login failed ${r.status} ${JSON.stringify(r.body)}`);
    return r;
  }
}

export const CREW_PASSWORD = (slug: string) => (slug === 'nexora' ? 'CrewDemo123!' : `Demo-${slug.charAt(0).toUpperCase()}${slug.slice(1)}-2026`);

export async function crew(env: Env, slug: string) {
  const c = new Client(env);
  await c.loginCrew(`${slug}@example.test`, CREW_PASSWORD(slug));
  return c;
}
export async function commander(env: Env) {
  const c = new Client(env);
  await c.loginAdmin();
  return c;
}

export async function gameId(env: Env, n: number) {
  return (await one<{ id: string }>(env.db, 'SELECT id FROM game WHERE number=$1', [n]))!.id;
}

/** Confirms the ranking rule (sprint 1) and starts the given sprint as the commander. */
export async function startSprint(env: Env, admin: Client, game: number, sprint: number) {
  const gid = await gameId(env, game);
  if (sprint === 1) {
    const r = await admin.patch(`/api/admin/games/${gid}/config`, { rankingMetricConfirmed: true });
    if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  }
  const r = await admin.post(`/api/admin/games/${gid}/start-sprint`, { sprint });
  if (r.status !== 200) throw new Error(`start failed ${JSON.stringify(r.body)}`);
  return gid;
}

/** Private reference solution for a task instance (test-only; reads server-side templates). */
export async function solutionFor(env: Env, id: string, kind: 'TASK' | 'IMPOSTER' = 'TASK') {
  const row = await one<{ source_template: string; source_variant: number; generation: number }>(
    env.db,
    kind === 'TASK'
      ? 'SELECT pv.source_template, pv.source_variant, ti.generation FROM task_instance ti JOIN problem_version pv ON pv.id=ti.problem_version_id WHERE ti.id=$1'
      : 'SELECT pv.source_template, pv.source_variant, ir.generation FROM imposter_release ir JOIN problem_version pv ON pv.id=ir.problem_version_id WHERE ir.id=$1',
    [id],
  );
  const t = [...regularTemplates, ...imposterTemplates].find((x) => x.key === row!.source_template)!;
  const v = t.variant(row!.source_variant as 0 | 1 | 2 | 3);
  const files = Object.fromEntries(v.files.map((f) => [f.name, f.content]));
  if (v.validation.mode === 'CODE_TESTS') return { generation: row!.generation, files: { ...files, ...v.solution.files }, starter: files };
  return { generation: row!.generation, answer: v.solution.answer!, starter: files };
}

export async function taskIds(env: Env, game: number, sprint: number, where = '') {
  return many<{ id: string; label: string; mode: string; reward: number; hint_cost: number; hint: string }>(
    env.db,
    `SELECT ti.id, ti.label, pv.validation->>'mode' AS mode, pv.reward, pv.hint_cost, pv.hint FROM task_instance ti JOIN sprint s ON s.id=ti.sprint_id JOIN game g ON g.id=s.game_id
       JOIN problem_version pv ON pv.id=ti.problem_version_id WHERE g.number=$1 AND s.number=$2 ${where} ORDER BY ti.label`,
    [game, sprint],
  );
}

/** Moves a running sprint's deadline into the past (simulates time passing). The worker then closes it. */
export async function expireSprint(env: Env, game: number) {
  await env.db.query(
    `UPDATE sprint s SET deadline_at = clock_timestamp() - interval '1 second', started_at = started_at - make_interval(secs => duration_seconds)
       FROM game g WHERE g.id=s.game_id AND g.number=$1 AND s.status='RUNNING'`,
    [game],
  );
}

export async function solve(env: Env, c: Client, taskId: string) {
  const s = await solutionFor(env, taskId);
  return c.post(`/api/game/tasks/${taskId}/submit`, { generation: s.generation, answer: (s as any).answer, files: (s as any).files }, true);
}
