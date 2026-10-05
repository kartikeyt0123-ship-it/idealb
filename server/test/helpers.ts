/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto';
import { buildApp, type BuiltApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { createPool, many, one, type Db } from '../src/db.js';
import { dropAll, migrate } from '../src/migrate.js';
import { demoCrewPassword, seedDemo } from '../src/seed/demo.js';

export interface Env {
  cfg: AppConfig;
  db: Db;
  built: BuiltApp;
  close: () => Promise<void>;
}

/** Fresh schema + demo seed + app, against the suite's real PostgreSQL and runner. */
/**
 * `ready` (default true) opens every slot and marks every crew present, so suites that are not
 * about kick-in / attendance can sign in and start sprints directly. controls.test.ts uses ready:false.
 */
export async function freshEnv(opts: { listen?: boolean; overrides?: Partial<AppConfig>; ready?: boolean } = {}): Promise<Env> {
  const cfg = loadConfig({ logLevel: 'silent', nodeEnv: 'test', demoMode: true, allowedOrigins: ['http://localhost:5173'], ...opts.overrides });
  const db = createPool(cfg.databaseUrl, 30);
  await dropAll(db);
  await migrate(db, () => undefined);
  await seedDemo(db, cfg, () => undefined);
  if (opts.ready !== false) {
    await db.query('UPDATE team SET checked_in_at=now() WHERE checked_in_at IS NULL');
    await db.query(`UPDATE slot SET opened_at=now(), phase=CASE WHEN phase IN ('CONFIGURING','READY') THEN 'WAITING' ELSE phase END`);
  }
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
  headers: Record<string, unknown>;
  raw: string;
}

/** A browser-like client: keeps its own cookies, sends the CSRF header. */
export class Client {
  cookies: Record<string, string> = {};
  constructor(private readonly env: Env) {}

  get cookieHeader() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async req<T = any>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res<T>> {
    const r = await this.env.built.app.inject({
      method: method as any,
      url,
      headers: {
        ...(method === 'GET' || method === 'DELETE' ? {} : { 'content-type': 'application/json' }),
        ...(method === 'GET' ? {} : { 'x-requested-with': 'amongbugs' }),
        ...(this.cookieHeader ? { cookie: this.cookieHeader } : {}),
        ...headers,
      },
      payload: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body ?? {}),
    });
    const set = r.headers['set-cookie'];
    for (const c of Array.isArray(set) ? set : set ? [set] : []) {
      const [kv] = c.split(';');
      const [k, v] = [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)];
      if (!v || /Expires=Thu, 01 Jan 1970/i.test(c)) delete this.cookies[k];
      else this.cookies[k] = v;
    }
    let parsed: any = r.body;
    try {
      parsed = JSON.parse(r.body);
    } catch {
      /* text body */
    }
    return { status: r.statusCode, body: parsed, headers: r.headers as Record<string, unknown>, raw: r.body };
  }
  get<T = any>(url: string) {
    return this.req<T>('GET', url);
  }
  post<T = any>(url: string, body?: unknown, idem = false, headers: Record<string, string> = {}) {
    return this.req<T>('POST', url, body, idem ? { 'idempotency-key': `k-${randomUUID()}`, ...headers } : headers);
  }
  postKey<T = any>(url: string, body: unknown, key: string) {
    return this.req<T>('POST', url, body, { 'idempotency-key': key });
  }
  patch<T = any>(url: string, body?: unknown) {
    return this.req<T>('PATCH', url, body);
  }
  del<T = any>(url: string) {
    return this.req<T>('DELETE', url);
  }
  clone() {
    const c = new Client(this.env);
    c.cookies = { ...this.cookies };
    return c;
  }
}

export const V = '/api/v1';

export async function crewLogin(env: Env, identifier: string, password: string) {
  const c = new Client(env);
  const r = await c.post(`${V}/auth/crew-login`, { identifier, password });
  if (r.status !== 200) throw new Error(`crew login failed ${r.status} ${JSON.stringify(r.body)}`);
  return c;
}

/** Sign in demo crew N (1..40) by CRW id. */
export async function crew(env: Env, n: number) {
  return crewLogin(env, `CRW-${String(n).padStart(3, '0')}`, demoCrewPassword(n));
}

export async function organizer(env: Env) {
  const c = new Client(env);
  const r = await c.post(`${V}/auth/organizer-login`, { email: 'admin@crm.local', password: 'idealab' });
  if (r.status !== 200) throw new Error(`organizer login failed ${r.status} ${JSON.stringify(r.body)}`);
  return c;
}

export async function slotId(env: Env, n: number) {
  return (await one<{ id: string }>(env.db, 'SELECT id FROM slot WHERE number=$1', [n]))!.id;
}

export async function startSprint(env: Env, org: Client, slot: number, sprint: number) {
  const r = await org.post(`${V}/admin/slots/${await slotId(env, slot)}/sprints/${sprint}/start`, {});
  if (r.status !== 200) throw new Error(`start failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

/** Forces the running sprint's deadline into the past (DB time), then runs the worker tick. */
export async function expireSprint(env: Env, slot: number) {
  await env.db.query(`UPDATE sprint SET deadline_at = clock_timestamp() - interval '1 second' WHERE slot_id=$1 AND status='RUNNING'`, [await slotId(env, slot)]);
  const { tick } = await import('../src/worker.js');
  return tick(env.db);
}

/** Correct payload for an instance, taken from the private solution (test-only access). */
export async function solutionFor(env: Env, instanceId: string) {
  const v = (await one<{ validation: any; solution: any; generation: number }>(
    env.db,
    `SELECT qv.validation, qv.solution, qi.generation FROM question_instance qi JOIN question_version qv ON qv.id=qi.question_version_id WHERE qi.id=$1`,
    [instanceId],
  ))!;
  if (v.validation.mode === 'CODE_TESTS') return { generation: v.generation, files: v.solution.files };
  return { generation: v.generation, answer: String(v.solution.answer) };
}

/** Released, available, answer-type (non-code) instances of a slot — fast to grade without the runner. */
export async function answerInstances(env: Env, slot: number, kind: 'INITIAL' | 'RESERVE' | 'BONUS' = 'INITIAL') {
  return many<{ id: string; label: string; reward: number; hint_cost: number; generation: number }>(
    env.db,
    `SELECT qi.id, qi.label, qi.reward, qi.hint_cost, qi.generation FROM question_instance qi
       JOIN release r ON r.id=qi.release_id JOIN question_version qv ON qv.id=qi.question_version_id
      WHERE qi.slot_id=$1 AND r.status='RELEASED' AND qi.status='AVAILABLE' AND qi.kind=$2 AND qv.validation->>'mode' <> 'CODE_TESTS'
      ORDER BY qi.label`,
    [await slotId(env, slot), kind],
  );
}

export async function solve(env: Env, c: Client, instanceId: string) {
  const p = await solutionFor(env, instanceId);
  return c.post(`${V}/question-instances/${instanceId}/submissions`, p, true);
}

/** Finish a slot: run its 4 sprints (solving `solvesPerSprint` per sprint by the given crews) and finalize. */
export async function runSlot(env: Env, org: Client, slot: number, crews: Client[]) {
  for (let s = 1; s <= 4; s++) {
    await startSprint(env, org, slot, s);
    const qs = await answerInstances(env, slot);
    for (let i = 0; i < crews.length && i < qs.length; i++) {
      const r = await solve(env, crews[i], qs[i].id);
      if (r.status !== 200 || !r.body.correct) throw new Error(`solve failed ${r.status} ${JSON.stringify(r.body)}`);
    }
    await expireSprint(env, slot);
  }
  let fin = await org.post(`${V}/admin/slots/${await slotId(env, slot)}/finalize`, {});
  if (fin.status === 409 && fin.body.error === 'TIE_RESOLUTION_REQUIRED') {
    fin = await org.post(`${V}/admin/slots/${await slotId(env, slot)}/finalize`, { resolution: { mode: 'SHARE', note: 'Tied crews share the place (published rule).' } });
  }
  if (fin.status !== 200) throw new Error(`finalize failed ${fin.status} ${JSON.stringify(fin.body)}`);
  return fin.body;
}
