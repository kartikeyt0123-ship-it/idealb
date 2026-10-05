/**
 * Production bootstrap (no demo content, no known passwords):
 *   ADMIN_BOOTSTRAP_EMAIL=... ADMIN_BOOTSTRAP_PASSWORD=... ADMIN_BOOTSTRAP_NAME="..." \
 *   EVENT_NAME="AMONG BUG" EVENT_DAY1=2026-10-08 EVENT_DAY2=2026-10-09 npm run bootstrap -w server
 * Creates the event skeleton (2 days × 2 slots × 4 sprints, six domains, prize
 * labels) if missing, with every rule UNCONFIRMED, and a SUPER_ADMIN if that
 * email does not exist yet. Crews are imported later from CSV/XLSX.
 */
import { loadConfig } from '../config.js';
import { createPool, one, withTx } from '../db.js';
import { migrate } from '../migrate.js';
import { hashPassword } from '../security/crypto.js';
import { ensureEventStructure } from '../seed/structure.js';

const cfg = loadConfig();
const email = (process.env.ADMIN_BOOTSTRAP_EMAIL ?? '').trim().toLowerCase();
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? '';
const name = process.env.ADMIN_BOOTSTRAP_NAME ?? 'Event Organizer';
const day1 = process.env.EVENT_DAY1 ?? '';
const day2 = process.env.EVENT_DAY2 ?? '';
if (!email || password.length < 12) {
  console.error('[bootstrap] Set ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD (>= 12 chars).');
  process.exit(1);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(day1) || !/^\d{4}-\d{2}-\d{2}$/.test(day2)) {
  console.error('[bootstrap] Set EVENT_DAY1 and EVENT_DAY2 as YYYY-MM-DD (Asia/Kolkata).');
  process.exit(1);
}
const db = createPool(cfg.databaseUrl, 2);
await migrate(db);
const hash = await hashPassword(password);
await withTx(db, async (tx) => {
  const r = await ensureEventStructure(tx, { name: process.env.EVENT_NAME ?? 'AMONG BUG', isDemo: false, days: [day1, day2] });
  console.log(r.created ? '[bootstrap] event skeleton created: review and confirm every rule in the console before starting Slot 1.' : '[bootstrap] event exists — unchanged.');
  const org = await one(tx, 'SELECT id FROM organizer_user WHERE email_normalized=$1', [email]);
  if (!org) {
    await tx.query(`INSERT INTO organizer_user(email, email_normalized, display_name, role, password_hash, created_via) VALUES ($1,$1,$2,'SUPER_ADMIN',$3,'BOOTSTRAP')`, [email, name, hash]);
    console.log(`[bootstrap] SUPER_ADMIN ${email} created.`);
  } else console.log(`[bootstrap] organizer ${email} already exists — unchanged.`);
});
await db.end();
