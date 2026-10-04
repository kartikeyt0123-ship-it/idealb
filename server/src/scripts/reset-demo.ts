/**
 * npm run reset:demo -- --yes — DESTROYS the isolated demo database contents and re-seeds.
 * Explicit, separate from seeding. Refuses without DEMO_MODE=true and --yes.
 */
import { loadConfig } from '../config.js';
import { createPool, one } from '../db.js';
import { dropAll, migrate } from '../migrate.js';
import { seedDemo } from '../seed/demo.js';

const cfg = loadConfig();
if (!cfg.demoMode) {
  console.error('[reset] Refusing: DEMO_MODE=true is required.');
  process.exit(1);
}
if (!process.argv.includes('--yes')) {
  console.error('[reset] This wipes ALL data in the demo database. Re-run with --yes to confirm.');
  process.exit(1);
}
const db = createPool(cfg.databaseUrl, 3);
const ev = await one<{ is_demo: boolean }>(db, 'SELECT is_demo FROM event LIMIT 1').catch(() => undefined);
if (ev && !ev.is_demo) {
  console.error('[reset] Refusing: this database holds a non-demo event.');
  process.exit(1);
}
await dropAll(db);
await migrate(db);
await seedDemo(db, cfg);
await db.end();
console.log('[reset] demo database reset and re-seeded.');
