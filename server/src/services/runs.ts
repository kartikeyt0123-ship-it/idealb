import type { AppConfig } from '../config.js';
import type { StarterFile } from '../content/types.js';
import { one, type Db } from '../db.js';
import { AppError } from '../errors.js';
import { runnerExecute, RunnerError } from '../grading/runnerClient.js';
import type { CrewContext } from './context.js';
import { instanceForRun } from './questions.js';

/**
 * Non-scoring "Run" jobs, executed by the isolated runner service. Results are
 * stored on run_job and returned as untrusted text. A run never awards coins.
 * The runner is a separate process, so an infinite loop or overload cannot
 * stall logins or scoring.
 */
export class RunService {
  private inflight = new Map<string, AbortController>();
  constructor(private readonly db: Db, private readonly cfg: AppConfig) {}

  async create(ctx: CrewContext, sessionId: string, instanceId: string, files: Record<string, string>, stdin: string) {
    if (ctx.enrollment.status !== 'ACTIVE') throw new AppError(ctx.enrollment.status === 'ELIMINATED' ? 'TEAM_ELIMINATED' : 'TEAM_DISQUALIFIED', 'Your crew can no longer run code.');
    if (ctx.slot.phase !== 'RUNNING') throw new AppError('SPRINT_NOT_RUNNING', 'Code can only be run while your slot sprint is running.');
    if (typeof stdin !== 'string' || stdin.length > 20_000) throw new AppError('VALIDATION_FAILED', 'stdin must be text up to 20 KB.');
    const { i, v } = await instanceForRun(this.db, ctx, instanceId);
    if (!v.run_language || !v.run_entry) throw new AppError('RUNTIME_UNAVAILABLE', 'This question has no server runtime. Use the live preview or submit your answer.');
    const merged = mergeFiles(v.files, files);
    const job = (await one<{ id: string }>(
      this.db,
      `INSERT INTO run_job(slot_id, enrollment_id, session_id, instance_id, language, status) VALUES ($1,$2,$3,$4,$5,'RUNNING') RETURNING id`,
      [ctx.slot.id, ctx.enrollment.id, sessionId, i.id, v.run_language],
    ))!;
    const ac = new AbortController();
    this.inflight.set(job.id, ac);
    const exec = (async () => {
      try {
        const r = await runnerExecute(this.cfg.runner, { language: v.run_language!, files: merged, entry: v.run_entry!, stdin, timeoutMs: 4000 }, ac.signal);
        const result = { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, timedOut: r.timedOut, outputTruncated: r.outputTruncated, durationMs: r.durationMs, runtime: r.runtime };
        await this.db.query(`UPDATE run_job SET status='DONE', result=$2, finished_at=now() WHERE id=$1 AND status='RUNNING'`, [job.id, JSON.stringify(result)]);
      } catch (err) {
        const msg = err instanceof RunnerError ? err.message : (err as Error).name === 'AbortError' ? 'Cancelled.' : 'Runner error.';
        await this.db.query(`UPDATE run_job SET status=CASE WHEN status='RUNNING' THEN 'FAILED' ELSE status END, error=$2, finished_at=now() WHERE id=$1`, [job.id, msg]);
      } finally {
        this.inflight.delete(job.id);
      }
    })();
    await Promise.race([exec, new Promise((r) => setTimeout(r, 9000))]);
    return this.status(ctx, job.id);
  }

  async status(ctx: CrewContext, jobId: string) {
    const j = await one<{ id: string; enrollment_id: string; status: string; result: unknown; error: string | null; language: string }>(this.db, 'SELECT id, enrollment_id, status, result, error, language FROM run_job WHERE id=$1', [jobId]);
    if (!j || j.enrollment_id !== ctx.enrollment.id) throw new AppError('NOT_FOUND', 'Run not found.');
    return { jobId: j.id, status: j.status, language: j.language, result: j.result, error: j.error };
  }

  async cancel(ctx: CrewContext, jobId: string) {
    const j = await one<{ enrollment_id: string }>(this.db, 'SELECT enrollment_id FROM run_job WHERE id=$1', [jobId]);
    if (!j || j.enrollment_id !== ctx.enrollment.id) throw new AppError('NOT_FOUND', 'Run not found.');
    await this.db.query(`UPDATE run_job SET status='CANCELLED', finished_at=now(), error='Cancelled by crew' WHERE id=$1 AND status IN ('QUEUED','RUNNING')`, [jobId]);
    this.inflight.get(jobId)?.abort();
    return this.status(ctx, jobId);
  }

  /** Abort in-process jobs cancelled elsewhere (sprint close, disqualification). */
  async reapCancelled() {
    if (!this.inflight.size) return;
    const r = await this.db.query(`SELECT id FROM run_job WHERE id = ANY($1) AND status='CANCELLED'`, [[...this.inflight.keys()]]);
    for (const row of r.rows) this.inflight.get(row.id)?.abort();
  }
}

export function mergeFiles(starter: StarterFile[], submitted: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  let size = 0;
  for (const f of starter) {
    const v = !f.readOnly && typeof submitted?.[f.name] === 'string' ? submitted[f.name] : f.content;
    size += v.length;
    out[f.name] = v;
  }
  if (size > 250_000) throw new AppError('PAYLOAD_TOO_LARGE', 'Code is too large to run.');
  return out;
}
