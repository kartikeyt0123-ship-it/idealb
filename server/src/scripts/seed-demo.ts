/**
 * npm run seed:demo — installs the labelled DEMO fixture (demo organizer, 40 crews in
 * four slots, seeded question bank and slot release plans). Refuses unless DEMO_MODE=true.
 * Safe to re-run: never duplicates accounts, never overwrites changed passwords,
 * never touches existing game history.
 */
import { loadConfig } from '../config.js';
import { createPool } from '../db.js';
import { migrate } from '../migrate.js';
import { seedDemo } from '../seed/demo.js';

const cfg = loadConfig();
if (!cfg.demoMode) {
  console.error('[seed] Refusing to install demo accounts: set DEMO_MODE=true (never in production).');
  process.exit(1);
}
const db = createPool(cfg.databaseUrl, 3);
await migrate(db);
await seedDemo(db, cfg);
await db.end();
console.log('[seed] done. Demo logins: see docs/DEMO_ACCESS.md (developer-only).');
