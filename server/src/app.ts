import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ZodError } from 'zod';
import { originAllowed, type AppConfig } from './config.js';
import { createPool, type Db } from './db.js';
import { AppError } from './errors.js';
import type { Deps } from './http.js';
import { Realtime } from './realtime.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { gameRoutes } from './routes/game.js';
import { createLimiters } from './security/rateLimit.js';
import { zodFieldErrors } from './services/teams.js';
import { RunService } from './services/runs.js';

const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

/** The participant preview sandbox: no network, no parent origin, rendered inside sandbox="allow-scripts". */
const SANDBOX_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

export interface BuiltApp {
  app: FastifyInstance;
  deps: Deps;
  realtime: Realtime;
  close: () => Promise<void>;
}

export async function buildApp(cfg: AppConfig, opts: { db?: Db } = {}): Promise<BuiltApp> {
  const db = opts.db ?? createPool(cfg.databaseUrl);
  const app = Fastify({
    logger: cfg.logLevel === 'silent' ? false : { level: cfg.logLevel, redact: ['req.headers.cookie', 'req.headers.authorization'] },
    trustProxy: cfg.trustProxy,
    bodyLimit: 512 * 1024,
  });
  await app.register(cookie);

  const deps: Deps = { db, cfg, limiters: createLimiters(), runs: new RunService(db, cfg) };

  // CSRF / origin protection for every state-changing API call: a custom header
  // (forces a CORS preflight we never grant cross-origin) + Origin allow-list.
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    if (req.headers['x-requested-with'] !== 'amongbugs') throw new AppError('FORBIDDEN', 'Missing request header.');
    if (!originAllowed(cfg, req.headers.origin, req.headers.host)) throw new AppError('FORBIDDEN', 'Origin not allowed.');
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
    if (req.url.startsWith('/sandbox/')) {
      reply.header('content-security-policy', SANDBOX_CSP);
    } else if (!req.url.startsWith('/api/') && !req.url.startsWith('/socket.io')) {
      reply.header('content-security-policy', APP_CSP);
      reply.header('x-frame-options', 'DENY');
    }
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: err.code, message: err.message, details: err.details ?? null });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'VALIDATION_FAILED', message: 'Some fields are invalid.', details: { fields: zodFieldErrors(err) } });
    }
    const e = err as { statusCode?: number; code?: string; message: string };
    if (e.statusCode === 413 || e.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.code(413).send({ error: 'PAYLOAD_TOO_LARGE', message: 'Request too large.' });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: 'BAD_REQUEST', message: e.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'INTERNAL', message: 'Ship systems hit an unexpected fault. Try again; organizers have the logs.' });
  });

  app.get('/api/health', async () => {
    await db.query('SELECT 1');
    return { ok: true, time: new Date().toISOString() };
  });

  await authRoutes(app, deps);
  await gameRoutes(app, deps);
  await adminRoutes(app, deps);

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown endpoint.' });
    // SPA fallback when serving the built web app.
    if (cfg.webDistDir && existsSync(join(cfg.webDistDir, 'index.html'))) return reply.type('text/html').sendFile('index.html');
    return reply.code(404).send({ error: 'NOT_FOUND', message: 'Not found.' });
  });

  if (cfg.webDistDir && existsSync(cfg.webDistDir)) {
    await app.register(fastifyStatic, { root: cfg.webDistDir, prefix: '/', wildcard: false, index: ['index.html'] });
  }

  await app.ready();
  const realtime = new Realtime(app.server, db, cfg);
  deps.realtime = realtime;
  await realtime.start();
  const reaper = setInterval(() => void deps.runs.reapCancelled().catch(() => undefined), 2000);

  return {
    app,
    deps,
    realtime,
    close: async () => {
      clearInterval(reaper);
      await realtime.stop();
      await app.close();
      if (!opts.db) await db.end();
    },
  };
}
