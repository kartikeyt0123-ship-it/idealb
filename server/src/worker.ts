/**
 * Durable competition worker. All schedules live in PostgreSQL (sprint
 * deadline_at, imposter deadlines), so a restart never re-rolls timers or
 * restarts a round: on boot it simply closes whatever is overdue, using the
 * authoritative deadline as the close time. Safe to run several replicas —
 * every transition is a locked, idempotent transaction.
 */
import { loadConfig } from './config.js';
import { createPool, many, withTx, type Db } from './db.js';
import { SYSTEM } from './services/audit.js';
import { expireImposters } from './services/imposter.js';
import { closeSprint } from './services/lifecycle.js';
import { emit, Rooms } from './services/outbox.js';
import { migrate } from './migrate.js';

export async function tick(db: Db): Promise<{ closed: number; imposters: number; released: number }> {
  let closed = 0;
  const due = await many<{ game_id: string }>(
    db,
    `SELECT s.game_id FROM sprint s JOIN game g ON g.id=s.game_id
      WHERE s.status='RUNNING' AND g.phase='RUNNING' AND s.number=g.current_sprint AND s.deadline_at <= clock_timestamp()`,
  );
  for (const d of due) {
    const r = await withTx(db, (tx) => closeSprint(tx, SYSTEM, d.game_id, 'DEADLINE')).catch((err) => {
      if ((err as { code?: string }).code !== 'INVALID_TRANSITION') console.error('[worker] close failed', (err as Error).message);
      return null;
    });
    if (r) closed++;
  }
  const imposters = await expireImposters(db);
  // Announce timed task releases (release_offset reached) once.
  let released = 0;
  const releasing = await many<{ game_id: string; n: number }>(
    db,
    `SELECT s.game_id, count(*)::int AS n FROM task_instance ti JOIN sprint s ON s.id=ti.sprint_id
      WHERE s.status='RUNNING' AND ti.release_offset_seconds > 0
        AND EXTRACT(EPOCH FROM (clock_timestamp() - s.started_at)) - s.paused_total_ms/1000.0 >= ti.release_offset_seconds
        AND ti.release_offset_seconds > EXTRACT(EPOCH FROM (clock_timestamp() - s.started_at)) - s.paused_total_ms/1000.0 - 1.0
      GROUP BY s.game_id`,
  );
  for (const r of releasing) {
    await withTx(db, (tx) => emit(tx, 'task.available', [Rooms.game(r.game_id), Rooms.admin], { gameId: r.game_id, count: r.n }));
    released += r.n;
  }
  return { closed, imposters, released };
}

export async function housekeeping(db: Db) {
  await db.query(`DELETE FROM outbox_event WHERE created_at < now() - interval '2 hours'`);
  await db.query(`DELETE FROM idempotency_record WHERE created_at < now() - interval '3 days'`);
  await db.query(`DELETE FROM session WHERE expires_at < now() - interval '7 days'`);
  await db.query(`UPDATE run_job SET status='FAILED', error='Abandoned', finished_at=now() WHERE status IN ('QUEUED','RUNNING') AND created_at < now() - interval '2 minutes'`);
}

async function main() {
  const cfg = loadConfig();
  const db = createPool(cfg.databaseUrl, 5);
  await migrate(db);
  const name = `worker-${process.pid}`;
  console.log(`[worker] ${name} started`);
  let stopping = false;
  let lastHouse = 0;
  const loop = async () => {
    while (!stopping) {
      const t0 = Date.now();
      try {
        const r = await tick(db);
        if (r.closed || r.imposters) console.log(`[worker] closed ${r.closed} sprint(s), resolved ${r.imposters} imposter(s)`);
        await db.query(
          `INSERT INTO worker_heartbeat(name, beat_at, info) VALUES ('competition-worker', now(), $1)
           ON CONFLICT (name) DO UPDATE SET beat_at=now(), info=EXCLUDED.info`,
          [JSON.stringify({ pid: process.pid, host: name, lastTickMs: Date.now() - t0 })],
        );
        if (Date.now() - lastHouse > 60_000) {
          await housekeeping(db);
          lastHouse = Date.now();
        }
      } catch (err) {
        console.error('[worker] tick failed:', (err as Error).message);
      }
      await new Promise((r) => setTimeout(r, Math.max(100, 500 - (Date.now() - t0))));
    }
  };
  const done = loop();
  const stop = async () => {
    stopping = true;
    await done;
    await db.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

if (process.argv[1] && /worker\.(ts|js)$/.test(process.argv[1])) {
  void main();
}
