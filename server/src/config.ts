import dotenv from 'dotenv';
import { resolve } from 'node:path';

// Load the repo-root .env (workspace scripts run with cwd=server/) and a local override.
dotenv.config({ path: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '..', '.env')], quiet: true } as dotenv.DotenvConfigOptions);

export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  demoMode: boolean;
  port: number;
  host: string;
  databaseUrl: string;
  /** Origins allowed to make credentialed, state-changing requests. */
  allowedOrigins: string[];
  cookieSecure: boolean;
  sessionTtlHours: number;
  sessionIdleMinutes: number;
  adminIdleMinutes: number;
  gradingSecret: string;
  runner: { url: string; token: string };
  /** Directory containing the built web app (served by the API in production). */
  webDistDir?: string;
  trustProxy: boolean;
  /** Seconds allowed for solve-deadline grace? Always 0: acceptance must commit before the deadline. */
  logLevel: string;
}

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const nodeEnv = (process.env.NODE_ENV as AppConfig['nodeEnv']) ?? 'development';
  const demoMode = (process.env.DEMO_MODE ?? 'false') === 'true';
  const cfg: AppConfig = {
    nodeEnv,
    demoMode,
    port: Number(process.env.PORT ?? 4000),
    host: process.env.HOST ?? '127.0.0.1',
    databaseUrl: required('DATABASE_URL', nodeEnv === 'production' ? undefined : 'postgres://postgres:amongbugs@127.0.0.1:54329/among_bugs'),
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4000,http://127.0.0.1:4000')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    cookieSecure: (process.env.COOKIE_SECURE ?? (nodeEnv === 'production' ? 'true' : 'false')) === 'true',
    sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 14),
    sessionIdleMinutes: Number(process.env.SESSION_IDLE_MINUTES ?? 180),
    adminIdleMinutes: Number(process.env.ADMIN_IDLE_MINUTES ?? 60),
    gradingSecret: required('GRADING_SECRET', nodeEnv === 'production' ? undefined : 'dev-only-grading-secret-change-me'),
    runner: {
      url: process.env.RUNNER_URL ?? 'http://127.0.0.1:4100',
      token: required('RUNNER_TOKEN', nodeEnv === 'production' ? undefined : 'dev-only-runner-token-change-me'),
    },
    webDistDir: process.env.WEB_DIST_DIR ? resolve(process.env.WEB_DIST_DIR) : undefined,
    trustProxy: (process.env.TRUST_PROXY ?? 'false') === 'true',
    logLevel: process.env.LOG_LEVEL ?? (nodeEnv === 'test' ? 'silent' : 'info'),
    ...overrides,
  };
  if (cfg.nodeEnv === 'production') {
    if (cfg.gradingSecret.length < 32) throw new Error('GRADING_SECRET must be at least 32 characters in production.');
    if (cfg.runner.token.length < 24) throw new Error('RUNNER_TOKEN must be at least 24 characters in production.');
  }
  return cfg;
}

/**
 * An Origin passes when it is explicitly allowed, or when it is the same origin
 * the request was sent to (page and API share a host, e.g. behind a tunnel or
 * reverse proxy). Cross-site origins are always rejected.
 */
export function originAllowed(cfg: AppConfig, origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  if (cfg.allowedOrigins.includes(origin)) return true;
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}
