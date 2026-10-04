import { loadConfig } from '../config.js';
import { createPool } from '../db.js';
import { migrate } from '../migrate.js';

const cfg = loadConfig();
const db = createPool(cfg.databaseUrl, 2);
await migrate(db);
await db.end();
