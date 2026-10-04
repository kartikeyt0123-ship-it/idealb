import type { RunLanguage } from '../content/types.js';

export interface RunnerResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  outputTruncated: boolean;
  durationMs: number;
  language: RunLanguage;
  runtime: string;
}

export class RunnerError extends Error {
  constructor(message: string, readonly code: 'RUNNER_UNAVAILABLE' | 'RUNNER_BUSY' | 'RUNNER_REJECTED' | 'RUNTIME_UNAVAILABLE') {
    super(message);
  }
}

export interface RunnerConfig {
  url: string;
  token: string;
}

export async function runnerExecute(
  cfg: RunnerConfig,
  req: { language: RunLanguage; files: Record<string, string>; entry: string; stdin?: string; timeoutMs?: number },
  signal?: AbortSignal,
): Promise<RunnerResult> {
  let res: Response;
  try {
    res = await fetch(`${cfg.url.replace(/\/$/, '')}/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify(req),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new RunnerError('The code runner is unreachable. Ask an organizer to check the runner service.', 'RUNNER_UNAVAILABLE');
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 503) throw new RunnerError('The code runner is busy. Try again in a few seconds.', 'RUNNER_BUSY');
  if (res.status === 501) throw new RunnerError(String(body.message ?? 'Runtime unavailable.'), 'RUNTIME_UNAVAILABLE');
  if (!res.ok) throw new RunnerError(String(body.message ?? `Runner rejected the job (${res.status}).`), 'RUNNER_REJECTED');
  return body as unknown as RunnerResult;
}

export async function runnerHealth(cfg: RunnerConfig): Promise<{ ok: boolean; runtimes?: Record<string, string | null>; error?: string }> {
  try {
    const res = await fetch(`${cfg.url.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(2000) });
    return (await res.json()) as { ok: boolean; runtimes: Record<string, string | null> };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
