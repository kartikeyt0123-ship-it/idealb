/**
 * Production bootstrap (no demo content, no known passwords):
 *   ADMIN_BOOTSTRAP_EMAIL=... ADMIN_BOOTSTRAP_PASSWORD=... ADMIN_BOOTSTRAP_NAME="..." \
 *   EVENT_NAME="AAROHAN 2026 · DEBUG + RUN" EVENT_DAY1=2026-10-03 EVENT_DAY2=2026-10-04 npm run bootstrap -w server
 * Creates the event skeleton (2 days, 2 games × 2 sprints, six domains) if missing,
 * and a SUPER_ADMIN account if that email does not exist yet.
 */
import { loadConfig } from '../config.js';
import { createPool, one, withTx } from '../db.js';
import { migrate } from '../migrate.js';
import { hashPassword } from '../security/crypto.js';
import { upsertDomains } from '../services/content.js';

const cfg = loadConfig();
const email = (process.env.ADMIN_BOOTSTRAP_EMAIL ?? '').trim().toLowerCase();
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? '';
const name = process.env.ADMIN_BOOTSTRAP_NAME ?? 'Event Commander';
if (!email || password.length < 12) {
  console.error('[bootstrap] Set ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD (>= 12 chars).');
  process.exit(1);
}
const db = createPool(cfg.databaseUrl, 2);
await migrate(db);
const hash = await hashPassword(password);
await withTx(db, async (tx) => {
  await upsertDomains(tx);
  const existing = await one(tx, 'SELECT id FROM event LIMIT 1');
  if (!existing) {
    const ev = (await one<{ id: string }>(tx, `INSERT INTO event(name, day_selection_mode, is_demo) VALUES ($1, 'AUTO', false) RETURNING id`, [process.env.EVENT_NAME ?? 'DEBUG + RUN']))!;
    for (const n of [1, 2]) {
      const day = (await one<{ id: string }>(tx, `INSERT INTO event_day(event_id, day_number, label, date) VALUES ($1,$2,$3,$4) RETURNING id`, [ev.id, n, `Day ${n}`, process.env[`EVENT_DAY${n}`] ?? null]))!;
      const g = (await one<{ id: string }>(tx, `INSERT INTO game(event_id, number, name, day_id, phase) VALUES ($1,$2,$3,$4,'DRAFT') RETURNING id`, [ev.id, n, `Game ${n} · Day ${n}`, day.id]))!;
      for (const s of [1, 2]) await tx.query('INSERT INTO sprint(game_id, number, duration_seconds) VALUES ($1,$2,1800)', [g.id, s]);
    }
    console.log('[bootstrap] event skeleton created (elimination counts and prizes must be configured in the command console).');
  }
  const admin = await one(tx, 'SELECT id FROM admin_user WHERE email_normalized=$1', [email]);
  if (!admin) {
    await tx.query(`INSERT INTO admin_user(email, email_normalized, display_name, role, password_hash, created_via) VALUES ($1,$1,$2,'SUPER_ADMIN',$3,'BOOTSTRAP')`, [email, name, hash]);
    console.log(`[bootstrap] SUPER_ADMIN ${email} created.`);
  } else console.log(`[bootstrap] admin ${email} already exists — unchanged.`);
});
await db.end();
