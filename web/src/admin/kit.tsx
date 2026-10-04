/**
 * Commander console kit: shared context, data hooks, the in-console
 * confirmation dialog and small terminal-styled widgets.
 */
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, api, serverNow } from '../lib/api';
import { Button, Label, StatePanel, Timer, useToast } from '../components/ui';
import type { AdminGame, AdminRole, Overview, Permission } from './types';
import { ROLE_PERMS } from './types';

// ---------------------------------------------------------------------------
// Style tokens (Figma "Ship command terminal")
// ---------------------------------------------------------------------------

export const CARD = 'rounded-xl border-2 border-[#426270] bg-[#142e3a] p-4 sm:p-5';
export const SUBCARD = 'rounded-lg border-2 border-[#395362] bg-[#142c38] p-4';
export const RED_CARD = 'rounded-xl border-2 border-[#9d635a] bg-[#442b34] p-4 sm:p-5';
export const THEAD = 'border-b border-[#496370] font-mono text-[9px] tracking-wider text-muted';
export const TH = 'p-3 font-normal whitespace-nowrap';
export const TR = 'border-b border-[#344d5b] align-top';
export const TD = 'p-3';
export const SMALL = '!px-3 !py-2 !text-[9px]';
export const LINK = 'font-mono text-[10px] text-[#e6c887] hover:underline disabled:opacity-30 disabled:no-underline';
export const COIN_TEXT = 'font-mono text-[#e8cf8e]';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError(0, 'CLIENT', (e as Error)?.message ?? 'Unexpected console fault.');
}

/** Human message including the first field error, when the server sent any. */
export function errText(e: unknown): string {
  const err = toApiError(e);
  const fields = Object.entries(err.fields);
  if (err.code === 'STALE_VERSION') return 'STALE VERSION — the game changed since you loaded it. The latest state was reloaded; review it and try again.';
  if (fields.length && !fields.some(([, m]) => err.message.includes(m))) return `${err.message} (${fields[0][0]}: ${fields[0][1]})`;
  return err.message;
}

// ---------------------------------------------------------------------------
// Console context
// ---------------------------------------------------------------------------

export interface ConfirmOptions {
  title: string;
  /** Exact effect of the command, one line each. */
  effects?: ReactNode[];
  body?: ReactNode;
  tone?: 'danger' | 'primary' | 'warning';
  confirmLabel?: string;
  reason?: { label: string; min: number; placeholder?: string };
  /** Checkbox the commander must tick before confirming. */
  ack?: string;
}
export type ConfirmFn = (o: ConfirmOptions) => Promise<{ reason: string } | null>;

export interface ConsoleCtxValue {
  overview: Overview;
  role: AdminRole;
  refreshKey: number;
  can: (p: Permission) => boolean;
  reloadOverview: () => Promise<void>;
  confirm: ConfirmFn;
  standalone: boolean;
}

export const ConsoleCtx = createContext<ConsoleCtxValue | null>(null);
export function useConsole(): ConsoleCtxValue {
  const c = useContext(ConsoleCtx);
  if (!c) throw new Error('useConsole outside CommandConsole');
  return c;
}

export function canRole(role: AdminRole, p: Permission) {
  return ROLE_PERMS[role]?.includes(p) ?? false;
}

/**
 * Runs a mutation: tracks a busy key, toasts success / API errors, handles
 * STALE_VERSION by reloading the overview. Returns undefined on failure.
 */
export function useRun() {
  const toast = useToast();
  const { reloadOverview } = useConsole();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, success?: string | ((r: T) => string)): Promise<T | undefined> => {
      setBusy(key);
      try {
        const r = await fn();
        if (success) toast(typeof success === 'function' ? success(r) : success, 'good');
        void reloadOverview();
        return r;
      } catch (e) {
        const err = toApiError(e);
        toast(errText(err), 'alert');
        if (err.code === 'STALE_VERSION') void reloadOverview();
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [toast, reloadOverview],
  );
  return { busy, run };
}

// ---------------------------------------------------------------------------
// Data fetching with debounced realtime refresh
// ---------------------------------------------------------------------------

export interface Loaded<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => Promise<void>;
}

export function useAdminData<T>(url: string | null, opts: { pollMs?: number } = {}): Loaded<T> {
  const { refreshKey } = useConsole();
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; loading: boolean }>({ data: null, error: null, loading: !!url });
  const ctrl = useRef<AbortController | null>(null);
  const load = useCallback(
    async (silent: boolean) => {
      if (!url) return;
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const d = await api.get<T>(url, c.signal);
        if (!c.signal.aborted) setState({ data: d, error: null, loading: false });
      } catch (e) {
        if ((e as Error)?.name === 'AbortError' || c.signal.aborted) return;
        setState((s) => ({ data: s.data, error: toApiError(e), loading: false }));
      }
    },
    [url],
  );
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    setState({ data: null, error: null, loading: !!url });
    void load(false);
    return () => ctrl.current?.abort();
  }, [load, url]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = window.setTimeout(() => void loadRef.current(true), 250);
    return () => window.clearTimeout(t);
  }, [refreshKey]);

  useEffect(() => {
    if (!opts.pollMs) return;
    const t = window.setInterval(() => void loadRef.current(true), opts.pollMs);
    return () => window.clearInterval(t);
  }, [opts.pollMs]);

  const reload = useCallback(() => loadRef.current(true), []);
  return { ...state, reload };
}

/** Renders loading / error / empty states around a fetch. */
export function Loadable<T>({ state, title, empty, children }: { state: Loaded<T>; title: string; empty?: (d: T) => boolean; children: (d: T) => ReactNode }) {
  if (state.loading && !state.data) return <StatePanel kind="loading" title={`Loading ${title}…`} />;
  if (state.error && !state.data) {
    return (
      <StatePanel
        kind="error"
        title={`${title}: link failure`}
        message={`${state.error.message} [${state.error.code}]`}
        action={<Button secondary className={SMALL} onClick={() => void state.reload()}><RefreshCw size={12} /> Retry</Button>}
      />
    );
  }
  if (!state.data) return null;
  if (empty?.(state.data)) return <StatePanel kind="empty" title={`No ${title.toLowerCase()} yet`} />;
  return (
    <>
      {state.error && (
        <div role="alert" className="mb-3 rounded-lg border border-[#9d635a] bg-[#442b34]/70 px-3 py-2 text-[11px] text-[#f3b399]">
          Refresh failed — showing last known data. {state.error.message}
        </div>
      )}
      {children(state.data)}
    </>
  );
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

export function useNow(intervalMs = 1000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return serverNow();
}

/** Live countdown to a server deadline (paused-aware). */
export function Countdown({ deadline, pausedAt, className = '' }: { deadline: string | null; pausedAt?: string | null; className?: string }) {
  const now = useNow();
  if (!deadline) return <span className="font-mono text-muted">--:--</span>;
  const end = Date.parse(deadline);
  const ref = pausedAt ? Date.parse(pausedAt) : now;
  const secs = Math.max(0, Math.ceil((end - ref) / 1000));
  if (secs >= 3600) {
    const h = Math.floor(secs / 3600);
    return <span className={`font-mono tabular-nums text-[#d8ede3] ${className}`}>{h}h {Math.floor((secs % 3600) / 60)}m</span>;
  }
  return <Timer seconds={secs} className={className} />;
}

export function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtDuration(seconds: number) {
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  if (seconds > 60) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function signed(n: number) {
  return n > 0 ? `+${n}` : String(n);
}

// ---------------------------------------------------------------------------
// Small widgets
// ---------------------------------------------------------------------------

export function SectionHead({ label, title, children }: { label: string; title?: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <Label>{label}</Label>
        {title && <h3 className="mt-1 font-display text-lg font-bold">{title}</h3>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** Segmented selector (game pickers, sub-tabs) styled like the terminal's small buttons. */
export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-lg border-2 px-3 py-2 font-display text-[9px] font-bold tracking-wide shadow-[0_3px_0_#07141d] transition hover:-translate-y-0.5 ${
            o.value === value ? 'border-[#b3f3d9] bg-[#8ae4cf] text-[#14342f]' : 'border-[#52717e] bg-[#2d4654] text-[#d6e1e1]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function GamePicker({ value, onChange }: { value: string | null; onChange: (id: string) => void }) {
  const { overview } = useConsole();
  if (!overview.games.length) return null;
  return (
    <Segmented
      label="Choose game"
      value={value ?? ''}
      onChange={onChange}
      options={overview.games.map((g) => ({ value: g.id, label: `GAME ${g.number} · ${g.phase.replace(/_/g, ' ')}` }))}
    />
  );
}

/** Keeps a selected game id valid against the overview (defaults to the live one). */
export function useSelectedGame(): [AdminGame | null, (id: string) => void] {
  const { overview } = useConsole();
  const [id, setId] = useState<string | null>(null);
  const live = overview.games.find((g) => ['RUNNING', 'PAUSED', 'ELIMINATION_REVIEW', 'WAITING_NEXT_SPRINT', 'GAME_RESULT_REVIEW'].includes(g.phase));
  const g = overview.games.find((x) => x.id === id) ?? live ?? overview.games.find((x) => x.dayId === overview.currentDay?.id) ?? overview.games[0] ?? null;
  return [g, setId];
}

export function Check({ checked, onChange, label, disabled, title }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; title?: string }) {
  return (
    <label className={`inline-flex items-center gap-2 text-xs ${disabled ? 'opacity-50' : 'cursor-pointer'}`} title={title}>
      <input type="checkbox" className="h-4 w-4 accent-[#8ae4cf]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function NumInput({ value, onChange, min, max, step, disabled, ariaLabel, className = '' }: { value: string; onChange: (v: string) => void; min?: number; max?: number; step?: number; disabled?: boolean; ariaLabel?: string; className?: string }) {
  return (
    <input
      type="number"
      inputMode="numeric"
      className={`input !py-2 font-mono ${className}`}
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function intOrNull(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

export function ExportLink({ href, children, disabled }: { href: string; children: ReactNode; disabled?: boolean }) {
  if (disabled) return <span className="inline-flex items-center gap-1 rounded-md border border-[#344d5b] px-3 py-2 font-mono text-[9px] text-muted opacity-50">{children}</span>;
  return (
    <a href={href} download className="inline-flex items-center gap-1 rounded-md border-2 border-[#52717e] bg-[#2d4654] px-3 py-2 font-mono text-[9px] tracking-wider text-[#e8cf8e] hover:bg-[#3a5a63]">
      {children}
    </a>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-[#3b6270] p-4 text-center text-xs text-muted">{children}</p>;
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'danger'; children: ReactNode }) {
  const c = tone === 'danger' ? 'border-[#9d635a] bg-[#442b34]/70 text-[#f3b399]' : tone === 'warn' ? 'border-[#8c7a4a] bg-[#3a3626]/70 text-[#ebd68c]' : 'border-[#3b6270] bg-[#112e3a]/70 text-[#c9dcd8]';
  return <div className={`rounded-lg border px-3 py-2 text-[11px] leading-5 ${c}`}>{children}</div>;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const toast = useToast();
  return (
    <Button secondary className={SMALL} onClick={async () => toast((await copyText(text)) ? 'Copied to clipboard.' : 'Clipboard unavailable — select and copy manually.', 'info')}>
      {label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Confirmation dialog (alertdialog, portal, own focus trap)
// ---------------------------------------------------------------------------

interface PendingConfirm extends ConfirmOptions {
  resolve: (r: { reason: string } | null) => void;
}

export function useConfirmHost(): [ConfirmFn, ReactNode] {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const confirm = useCallback<ConfirmFn>((o) => new Promise((resolve) => setPending({ ...o, resolve })), []);
  const close = (r: { reason: string } | null) => {
    pending?.resolve(r);
    setPending(null);
  };
  const node = pending ? <ConfirmDialog key={pending.title} p={pending} onDone={close} /> : null;
  return [confirm, node];
}

function ConfirmDialog({ p, onDone }: { p: PendingConfirm; onDone: (r: { reason: string } | null) => void }) {
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => (ref.current?.querySelector<HTMLElement>('textarea, input') ?? ref.current?.querySelector<HTMLElement>('button'))?.focus());
    return () => {
      cancelAnimationFrame(raf);
      if (prev?.isConnected) prev.focus();
    };
  }, []);
  const reasonOk = !p.reason || reason.trim().length >= p.reason.min;
  const ok = reasonOk && (!p.ack || ack);
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onDone(null);
      return;
    }
    if (e.key === 'Tab' && ref.current) {
      e.stopPropagation();
      const els = Array.from(ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled])'));
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  const tone = p.tone ?? 'danger';
  const border = tone === 'primary' ? 'border-[#5f9c90] bg-[#1d3a46]' : tone === 'warning' ? 'border-[#a8935a] bg-[#3a3a36]' : 'border-[#bd816b] bg-[#3a303c]';
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center overflow-y-auto bg-[#05131d]/90 p-4" onKeyDown={onKey}>
      <section ref={ref} role="alertdialog" aria-modal="true" aria-labelledby="cmd-confirm-title" aria-describedby="cmd-confirm-body" className={`w-full max-w-lg rounded-xl border-2 p-6 text-left text-[#f2f0e7] shadow-[0_10px_0_#051521] sm:p-8 ${border}`}>
        <div className="mb-4 flex items-center gap-3">
          <AlertTriangle size={30} className={tone === 'primary' ? 'text-primary' : 'text-[#e5ac8e]'} aria-hidden="true" />
          <div>
            <Label className="!text-[#e7c784]">CONFIRM COMMAND</Label>
            <h2 id="cmd-confirm-title" className="font-display text-xl font-bold">{p.title}</h2>
          </div>
        </div>
        <div id="cmd-confirm-body" className="space-y-3 text-xs leading-6 text-[#d3dedd]">
          {p.body}
          {p.effects && p.effects.length > 0 && (
            <div>
              <Label className="mb-1">EXACT EFFECT</Label>
              <ul className="list-disc space-y-1 pl-5">
                {p.effects.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>
        {p.reason && (
          <label className="mt-4 block">
            <span className="mb-2 block font-mono text-[9px] tracking-widest text-[#b3c4c8]">{p.reason.label} (MIN {p.reason.min} CHARACTERS — RECORDED IN THE AUDIT LOG)</span>
            <textarea className="input min-h-[80px]" value={reason} placeholder={p.reason.placeholder} onChange={(e) => setReason(e.target.value)} aria-invalid={reason.length > 0 && !reasonOk} />
          </label>
        )}
        {p.ack && (
          <div className="mt-4">
            <Check checked={ack} onChange={setAck} label={p.ack} />
          </div>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button secondary onClick={() => onDone(null)}>
            Cancel
          </Button>
          <Button danger={tone !== 'primary'} disabled={!ok} onClick={() => onDone({ reason: reason.trim() })}>
            {p.confirmLabel ?? 'Confirm'}
          </Button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
