/**
 * SHELL workspace: a terminal over the question's server-side virtual
 * filesystem. Every command is POSTed to run-jobs as {command, cwd}; the
 * server returns {stdout, stderr, exitCode, cwd}. Nothing is simulated here
 * except `clear` (local scrollback) and ↑/↓ history. The working directory,
 * history and a capped scrollback are kept per question in sessionStorage.
 */
import { Loader2, TerminalSquare } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { api, V1, type RunResult } from '../lib/api';
import { errCode, errMessage, friendlyError } from './util';

interface Line {
  id: number;
  kind: 'cmd' | 'out' | 'err' | 'sys';
  text: string;
  prompt?: string;
}

interface Saved {
  cwd: string;
  history: string[];
  lines: Line[];
}

const MAX_LINES = 400;
const MAX_HISTORY = 100;

function load(key: string): Saved | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Saved;
    return typeof v?.cwd === 'string' && Array.isArray(v.history) && Array.isArray(v.lines) ? v : null;
  } catch {
    return null;
  }
}
function store(key: string, v: Saved) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage full / blocked: the session still works in memory */
  }
}

export function Terminal({
  questionId, storageKey, terminal, disabled, disabledReason, onError,
}: {
  questionId: string;
  /** Unique per crew + question + generation. */
  storageKey: string;
  terminal: { cwd: string; user: string; initialCommand: string | null };
  disabled: boolean;
  disabledReason: string | null;
  /** Lets the workspace react to closed / eliminated codes; returns the text to print. */
  onError: (code: string, message: string) => string | null;
}) {
  const saved = useRef(load(storageKey));
  const [cwd, setCwd] = useState(saved.current?.cwd ?? terminal.cwd);
  const [history, setHistory] = useState<string[]>(saved.current?.history ?? []);
  const [lines, setLines] = useState<Line[]>(saved.current?.lines ?? []);
  const [input, setInput] = useState(saved.current?.history.length ? '' : (terminal.initialCommand ?? ''));
  const [busy, setBusy] = useState(false);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const draft = useRef('');
  const nextId = useRef(Math.max(0, ...lines.map((l) => l.id)) + 1);
  const inputRef = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => store(storageKey, { cwd, history, lines: lines.slice(-MAX_LINES) }), [storageKey, cwd, history, lines]);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, busy]);

  const home = terminal.cwd.replace(/\/+$/, '') || '/';
  const shownCwd = cwd === home ? '~' : cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd;
  const prompt = `${terminal.user}@among-bug:${shownCwd}$`;

  const push = useCallback((add: Omit<Line, 'id'>[]) => {
    setLines((ls) => {
      const next = [...ls, ...add.map((l) => ({ ...l, id: nextId.current++ }))];
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, []);

  async function exec(raw: string) {
    const command = raw.replace(/\s+$/, '');
    setHistIdx(null);
    draft.current = '';
    setInput('');
    if (!command.trim()) {
      push([{ kind: 'cmd', text: '', prompt }]);
      return;
    }
    setHistory((h) => (h[h.length - 1] === command ? h : [...h, command].slice(-MAX_HISTORY)));
    if (command.trim() === 'clear' || command.trim() === 'reset') {
      setLines([]);
      return;
    }
    push([{ kind: 'cmd', text: command, prompt }]);
    if (disabled) {
      push([{ kind: 'err', text: disabledReason ?? 'The terminal is offline right now.' }]);
      return;
    }
    setBusy(true);
    try {
      let r = await api.post<RunResult>(`${V1}/question-instances/${encodeURIComponent(questionId)}/run-jobs`, { files: {}, stdin: '', command, cwd });
      // Shell jobs normally answer immediately; poll briefly just in case.
      for (let i = 0; i < 20 && (r.status === 'RUNNING' || r.status === 'QUEUED'); i++) {
        await new Promise((res) => setTimeout(res, 500));
        r = await api.get<RunResult>(`${V1}/run-jobs/${encodeURIComponent(r.jobId)}`);
      }
      if (!alive.current) return;
      if (!r.result) {
        push([{ kind: 'err', text: r.error ?? 'The command did not run.' }]);
        return;
      }
      const out: Omit<Line, 'id'>[] = [];
      if (r.result.stdout) out.push({ kind: 'out', text: r.result.stdout.replace(/\n$/, '') });
      if (r.result.stderr) out.push({ kind: 'err', text: r.result.stderr.replace(/\n$/, '') });
      if (r.result.outputTruncated) out.push({ kind: 'sys', text: '[output truncated]' });
      push(out);
      if (typeof r.result.cwd === 'string' && r.result.cwd) setCwd(r.result.cwd);
    } catch (e) {
      if (!alive.current) return;
      const code = errCode(e);
      const msg = onError(code, errMessage(e)) ?? friendlyError(code, errMessage(e));
      push([{ kind: 'err', text: code === 'RATE_LIMITED' ? `rate limited: ${msg}` : msg }]);
    } finally {
      if (alive.current) {
        setBusy(false);
        window.setTimeout(() => inputRef.current?.focus(), 0);
      }
    }
  }

  function onKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!busy) void exec(input);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!history.length) return;
      if (histIdx === null) draft.current = input;
      const i = histIdx === null ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(i);
      setInput(history[i]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIdx === null) return;
      const i = histIdx + 1;
      if (i >= history.length) {
        setHistIdx(null);
        setInput(draft.current);
      } else {
        setHistIdx(i);
        setInput(history[i]);
      }
    } else if (e.key.toLowerCase() === 'l' && e.ctrlKey) {
      e.preventDefault();
      setLines([]);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#071219]" onClick={() => window.getSelection()?.isCollapsed !== false && inputRef.current?.focus()}>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[12px] leading-[1.45]" role="log" aria-live="polite" aria-label="Terminal output">
        {lines.length === 0 && (
          <div className="mb-2 text-[#537681]">
            <TerminalSquare size={12} className="mr-1 inline" />
            Connected to among-bug. Commands run on the ship server (ls, cd, cat, grep, find, base64 -d, strings, xxd, awk, sed, …). `clear` clears the screen; ↑/↓ recall history.
            {terminal.initialCommand ? ` Suggested first command is pre-filled — press Enter to run it.` : ''}
          </div>
        )}
        {lines.map((l) =>
          l.kind === 'cmd' ? (
            <div key={l.id} className="whitespace-pre-wrap break-all">
              <span className="text-[#8ae4bf]">{l.prompt}</span> <span className="text-[#e8f2ee]">{l.text}</span>
            </div>
          ) : (
            <pre key={l.id} className={`whitespace-pre-wrap break-all ${l.kind === 'err' ? 'text-[#f49386]' : l.kind === 'sys' ? 'text-[#ebd68c]' : 'text-[#cfe3dc]'}`}>
              {l.text}
            </pre>
          ),
        )}
        <div className="flex items-center gap-2">
          <span className="shrink-0 whitespace-nowrap text-[#8ae4bf]">{prompt}</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value.slice(0, 4000));
              setHistIdx(null);
            }}
            onKeyDown={onKey}
            disabled={busy}
            aria-label="Terminal command"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-[12px] text-[#e8f2ee] caret-[#8ae4bf] outline-none"
          />
          {busy && <Loader2 size={12} className="shrink-0 animate-spin text-primary" />}
        </div>
      </div>
      <p className="shrink-0 border-t border-[#36515f] px-3 py-1.5 font-mono text-[9px] text-[#6c929d]">
        {disabled && disabledReason ? disabledReason : 'Virtual terminal · commands never award coins — submit the flag below.'}
      </p>
    </div>
  );
}
