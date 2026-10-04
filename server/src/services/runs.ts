import type { AppConfig } from '../config.js';
import type { StarterFile } from '../content/types.js';
import { one, type Db } from '../db.js';
import { AppError } from '../errors.js';
import { runnerExecute, RunnerError } from '../grading/runnerClient.js';
import type { CompetitorContext } from './context.js';
import { taskWindow, type ProblemVersionRow, type TaskInstanceRow, displaySprint } from './tasks.js';
import type { SprintRow } from './context.js';

/**
 * Non-scoring "Run" jobs. Executed by the isolated runner service; results are
 * stored on run_job and returned as untrusted text. A Run never awards coins.
 */
export class RunService {
  private inflight = new Map<string, AbortController>();
  constructor(private readonly db: Db, private readonly cfg: AppConfig) {}

  async create(ctx: CompetitorContext, sessionId: string, target: { type: 'TASK' | 'IMPOSTER'; id: string }, files: Record<string, string>, stdin: string) {
    if (ctx.enrollment.status !== 'ACTIVE') throw new AppError(ctx.enrollment.status === 'ELIMINATED' ? 'TEAM_ELIMINATED' : 'TEAM_DISQUALIFIED', 'Your crew can no longer run code in this game.');
    if (ctx.game.phase === 'PAUSED') throw new AppError('SPRINT_PAUSED', 'The sprint is paused.');
    if (ctx.game.phase !== 'RUNNING') throw new AppError('SPRINT_NOT_RUNNING', 'Code can only be run while a sprint is running.');
    if (typeof stdin !== 'string' || stdin.length > 20_000) throw new AppError('VALIDATION_FAILED', 'stdin must be text up to 20 KB.');
    let pv: ProblemVersionRow;
    if (target.type === 'TASK') {
      const t = await one<TaskInstanceRow>(this.db, 'SELECT * FROM task_instance WHERE id=$1', [target.id]);
      if (!t || t.game_id !== ctx.game.id) throw new AppError('NOT_FOUND', 'Task not found.');
      const s = await displaySprint(this.db, ctx.game);
      const ts = await one<SprintRow>(this.db, 'SELECT * FROM sprint WHERE id=$1', [t.sprint_id]);
      if (!s || s.id !== t.sprint_id || taskWindow(t, ts!, Date.now()) === 'LOCKED') throw new AppError('TASK_NOT_RELEASED', 'This system is locked.');
      pv = (await one<ProblemVersionRow>(this.db, 'SELECT * FROM problem_version WHERE id=$1', [t.problem_version_id]))!;
    } else {
      const r = await one<{ id: string; game_id: string; problem_version_id: string; mode: string; status: string }>(this.db, 'SELECT id, game_id, problem_version_id, mode, status FROM imposter_release WHERE id=$1', [target.id]);
      if (!r || r.game_id !== ctx.game.id || r.status === 'DRAFT') throw new AppError('NOT_FOUND', 'Imposter not found.');
      if (r.mode === 'RESERVE') {
        const res = await one<{ enrollment_id: string }>(this.db, 'SELECT enrollment_id FROM imposter_reservation WHERE release_id=$1', [r.id]);
        if (!res || res.enrollment_id !== ctx.enrollment.id) throw new AppError('IMPOSTER_NOT_OWNER', 'Another crew has claimed this imposter problem.');
      }
      pv = (await one<ProblemVersionRow>(this.db, 'SELECT * FROM problem_version WHERE id=$1', [r.problem_version_id]))!;
    }
    if (!pv.run_language || !pv.run_entry) throw new AppError('RUNTIME_UNAVAILABLE', 'This task has no server-side runtime. Use the live preview or submit your answer.');
    const merged = mergeFiles(pv.files, files);
    const job = await one<{ id: string }>(
      this.db,
      `INSERT INTO run_job(game_id, enrollment_id, session_id, target_type, target_id, language, status) VALUES ($1,$2,$3,$4,$5,$6,'RUNNING') RETURNING id`,
      [ctx.game.id, ctx.enrollment.id, sessionId, target.type, target.id, pv.run_language],
    );
    const ac = new AbortController();
    this.inflight.set(job!.id, ac);
    const exec = (async () => {
      try {
        const r = await runnerExecute(this.cfg.runner, { language: pv.run_language!, files: merged, entry: pv.run_entry!, stdin, timeoutMs: 4000 }, ac.signal);
        const result = { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, timedOut: r.timedOut, outputTruncated: r.outputTruncated, durationMs: r.durationMs, runtime: r.runtime };
        await this.db.query(`UPDATE run_job SET status='DONE', result=$2, finished_at=now() WHERE id=$1 AND status='RUNNING'`, [job!.id, JSON.stringify(result)]);
      } catch (err) {
        const msg = err instanceof RunnerError ? err.message : (err as Error).name === 'AbortError' ? 'Cancelled.' : 'Runner error.';
        await this.db.query(`UPDATE run_job SET status=CASE WHEN status='RUNNING' THEN 'FAILED' ELSE status END, error=$2, finished_at=now() WHERE id=$1`, [job!.id, msg]);
      } finally {
        this.inflight.delete(job!.id);
      }
    })();
    // Wait briefly so most runs return in one round trip; the client polls otherwise.
    await Promise.race([exec, new Promise((r) => setTimeout(r, 9000))]);
    return this.status(ctx, job!.id);
  }

  async status(ctx: CompetitorContext, jobId: string) {
    const j = await one<{ id: string; enrollment_id: string; status: string; result: unknown; error: string | null; language: string }>(this.db, 'SELECT id, enrollment_id, status, result, error, language FROM run_job WHERE id=$1', [jobId]);
    if (!j || j.enrollment_id !== ctx.enrollment.id) throw new AppError('NOT_FOUND', 'Run not found.');
    return { jobId: j.id, status: j.status, language: j.language, result: j.result, error: j.error };
  }

  async cancel(ctx: CompetitorContext, jobId: string) {
    const j = await one<{ enrollment_id: string }>(this.db, 'SELECT enrollment_id FROM run_job WHERE id=$1', [jobId]);
    if (!j || j.enrollment_id !== ctx.enrollment.id) throw new AppError('NOT_FOUND', 'Run not found.');
    await this.db.query(`UPDATE run_job SET status='CANCELLED', finished_at=now(), error='Cancelled by crew' WHERE id=$1 AND status IN ('QUEUED','RUNNING')`, [jobId]);
    this.inflight.get(jobId)?.abort();
    return this.status(ctx, jobId);
  }

  /** Abort in-process jobs cancelled elsewhere (elimination, sprint close). */
  async reapCancelled() {
    if (!this.inflight.size) return;
    const ids = [...this.inflight.keys()];
    const r = await this.db.query(`SELECT id FROM run_job WHERE id = ANY($1) AND status='CANCELLED'`, [ids]);
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
