/**
 * Durable competition worker. All schedules live in PostgreSQL (sprint
 * deadline_at, release offsets), so a restart never re-rolls timers or
 * restarts a round: on boot it simply closes whatever is overdue, using the
 * authoritative deadline as the close time. Safe to run several replicas —
 * every transition is a locked, idempotent transaction.
 */
import { loadConfig } from './config.js';
import { createPool, many, withTx, type Db } from './db.js';
import { SYSTEM } from './services/audit.js';
import { closeSprint } from './services/lifecycle.js';
import { releaseDue } from './services/releases.js';
import { migrate } from './migrate.js';

export async function tick(db: Db): Promise<{ closed: number; released: number }> {
  let closed = 0;
  const due = await many<{ slot_id: string }>(
    db,
    `SELECT s.slot_id FROM sprint s JOIN slot sl ON sl.id=s.slot_id
      WHERE s.status='RUNNING' AND sl.phase='RUNNING' AND s.number=sl.current_sprint AND s.deadline_at <= clock_timestamp()`,
  );
  for (const d of due) {
    const r = await withTx(db, (tx) => closeSprint(tx, SYSTEM, d.slot_id, 'DEADLINE')).catch((err) => {
      if ((err as { code?: string }).code !== 'INVALID_TRANSITION') console.error('[worker] close failed', (err as Error).message);
      return null;
    });
    if (r) closed++;
  }
  // Scheduled releases (initial sets, bonuses) by active sprint time; paused sprints never release.
  const released = await releaseDue(db);
  return { closed, released };
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
        if (r.closed || r.released) console.log(`[worker] closed ${r.closed} sprint(s), released ${r.released} batch(es)`);
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
