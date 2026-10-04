/** Non-scoring server "Run" (POST /api/game/run, poll while RUNNING, cancel). Never fakes output. */
import { Loader2, Play, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type RunResult } from '../lib/api';
import { Button } from '../components/ui';
import { errCode, errMessage } from './util';

export type RunState =
  | { phase: 'idle' }
  | { phase: 'running'; jobId: string | null; startedAt: number }
  | { phase: 'done'; run: RunResult }
  | { phase: 'error'; code: string; message: string };

const RUNNER_MESSAGES: Record<string, string> = {
  RUNNER_UNAVAILABLE: 'The code runner is offline. This is a real error — no output was produced.',
  RUNNER_BUSY: 'The code runner is at capacity. Wait a few seconds and run again.',
  RUNTIME_UNAVAILABLE: 'This system has no server-side runtime.',
  RATE_LIMITED: 'Runner cooling down — too many runs. Wait a few seconds.',
};

export function useServerRun(target: { type: 'TASK' | 'IMPOSTER'; id: string }) {
  const [state, setState] = useState<RunState>({ phase: 'idle' });
  const alive = useRef(true);
  const token = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      token.current++;
    };
  }, []);

  const run = useCallback(
    async (files: Record<string, string>, stdin: string) => {
      const my = ++token.current;
      const live = () => alive.current && token.current === my;
      setState({ phase: 'running', jobId: null, startedAt: Date.now() });
      try {
        let r = await api.post<RunResult>('/api/game/run', { target, files, stdin });
        const deadline = Date.now() + 60_000;
        while (live() && (r.status === 'RUNNING' || r.status === 'QUEUED')) {
          setState({ phase: 'running', jobId: r.jobId, startedAt: Date.now() });
          if (Date.now() > deadline) throw Object.assign(new Error('The run did not finish in time. Try again.'), { code: 'TIMEOUT' });
          await new Promise((res) => setTimeout(res, 900));
          if (!live()) return;
          r = await api.get<RunResult>(`/api/game/run/${encodeURIComponent(r.jobId)}`);
        }
        if (live()) setState({ phase: 'done', run: r });
      } catch (e) {
        if (!live()) return;
        const code = errCode(e);
        setState({ phase: 'error', code, message: RUNNER_MESSAGES[code] ? `${RUNNER_MESSAGES[code]} (${errMessage(e)})` : errMessage(e) });
      }
    },
    [target],
  );

  const cancel = useCallback(async () => {
    const jobId = state.phase === 'running' ? state.jobId : null;
    token.current++;
    if (!jobId) {
      setState({ phase: 'error', code: 'CANCELLED', message: 'Run cancelled.' });
      return;
    }
    try {
      const r = await api.post<RunResult>(`/api/game/run/${encodeURIComponent(jobId)}/cancel`, {});
      if (alive.current) setState({ phase: 'done', run: r });
    } catch (e) {
      if (alive.current) setState({ phase: 'error', code: errCode(e), message: errMessage(e) });
    }
  }, [state]);

  return { state, run, cancel };
}

export function RunButtons({ state, onRun, onCancel, disabled, label = 'Run' }: { state: RunState; onRun: () => void; onCancel: () => void; disabled: boolean; label?: string }) {
  const running = state.phase === 'running';
  return (
    <div className="flex items-center gap-2">
      {running ? (
        <Button danger className="!px-3 !py-1.5 !text-[10px]" onClick={onCancel}>
          <Square size={12} /> Cancel
        </Button>
      ) : null}
      <Button className="!px-3 !py-1.5 !text-[10px]" disabled={disabled || running} onClick={onRun}>
        {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
        {running ? 'Running…' : label}
      </Button>
    </div>
  );
}

export function RunConsole({ state, language }: { state: RunState; language: string | null }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[11.5px] leading-5" aria-live="polite">
        {state.phase === 'idle' && (
          <p className="text-primary">
            {'> diagnostic system ready'}
            <br />
            {`> press Run to execute on the server${language ? ` (${language})` : ''}…`}
          </p>
        )}
        {state.phase === 'running' && (
          <p className="flex items-center gap-2 text-primary">
            <Loader2 size={13} className="animate-spin" /> {'> RUNNING DIAGNOSTIC ON SERVER…'}
          </p>
        )}
        {state.phase === 'error' && (
          <div role="alert" className="text-[#f49386]">
            <div>{'> SYSTEM ERROR'}{state.code && state.code !== 'UNKNOWN' ? ` [${state.code}]` : ''}</div>
            <div className="whitespace-pre-wrap break-words">{state.message}</div>
          </div>
        )}
        {state.phase === 'done' && <RunOutput run={state.run} />}
      </div>
      <p className="shrink-0 border-t border-[#36515f] px-4 py-2 font-mono text-[9px] tracking-wide text-[#6c929d]">Run never awards IdeaCoins — only “Submit” is verified and scored.</p>
    </div>
  );
}

function RunOutput({ run }: { run: RunResult }) {
  if (run.status === 'CANCELLED') return <p className="text-[#ebd68c]">{'> run cancelled'}{run.error ? ` — ${run.error}` : ''}</p>;
  if (run.status === 'FAILED' || !run.result) return <p role="alert" className="whitespace-pre-wrap text-[#f49386]">{`> RUN FAILED — ${run.error ?? 'Runner error.'}`}</p>;
  const r = run.result;
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-[9px] tracking-[.16em] text-[#6c929d]">STDOUT</div>
        <pre className="whitespace-pre-wrap break-words text-[#d8ede3]">{r.stdout || <span className="text-[#537681]">(no output)</span>}</pre>
      </div>
      {r.stderr && (
        <div>
          <div className="mb-1 text-[9px] tracking-[.16em] text-[#c47c6f]">STDERR</div>
          <pre className="whitespace-pre-wrap break-words text-[#f49386]">{r.stderr}</pre>
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-white/10 pt-2 text-[10px] text-[#9fb8bf]">
        <span>
          exit code <b className={r.exitCode === 0 ? 'text-primary' : 'text-[#f49386]'}>{r.exitCode ?? '—'}</b>
        </span>
        <span>runtime {r.runtime}</span>
        <span>{r.durationMs} ms</span>
      </div>
      {r.timedOut && <p className="text-[10px] text-[#ebd68c]">⚠ Execution timed out — the process was stopped.</p>}
      {r.outputTruncated && <p className="text-[10px] text-[#ebd68c]">⚠ Output truncated — the program printed too much.</p>}
    </div>
  );
}
