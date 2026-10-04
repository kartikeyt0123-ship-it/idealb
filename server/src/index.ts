import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';

const cfg = loadConfig();
const db = createPool(cfg.databaseUrl);
await migrate(db);
const built = await buildApp(cfg, { db });
await built.app.listen({ port: cfg.port, host: cfg.host });
console.log(`[api] AMONG BUGS API on http://${cfg.host}:${cfg.port} (demo mode: ${cfg.demoMode})`);

const shutdown = async (sig: string) => {
  console.log(`[api] ${sig} received, shutting down`);
  await built.close().catch(() => undefined);
  await db.end().catch(() => undefined);
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
