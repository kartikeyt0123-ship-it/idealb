/**
 * Shared AMONG BUGS UI kit — ported from the published Figma Make design
 * (crewmate, buttons, coin, labels, timer, badges, access card, ship).
 */
import { AnimatePresence, motion } from 'motion/react';
import { Lightbulb, Radio, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type CrewState = 'idle' | 'still' | 'celebrating' | 'warning' | 'ejected' | 'thinking' | 'working';

export function Crewmate({ color = '#51cfdf', size = 48, state = 'idle', accessory = false, className = '' }: { color?: string; size?: number; state?: CrewState; accessory?: boolean; className?: string }) {
  return (
    <svg
      width={size}
      height={size * 1.15}
      viewBox="0 0 100 115"
      fill="none"
      role="img"
      aria-label={`${state} crewmate`}
      className={`${state === 'ejected' ? 'animate-[eject_6s_ease-in-out_infinite_alternate]' : state === 'idle' ? 'animate-[float_5s_ease-in-out_infinite]' : ''} ${className}`}
    >
      <ellipse cx="49" cy="109" rx="32" ry="4" fill="#000" opacity=".25" />
      <rect x="9" y="44" width="24" height="46" rx="10" fill={color} stroke="#111724" strokeWidth="5" />
      <path d="M28 43C28 23 40 14 57 14C76 14 87 25 87 46V98C87 104 82 106 76 106H65V87H51V106H35C29 106 26 102 26 97V49" fill={color} stroke="#111724" strokeWidth="5" strokeLinejoin="round" />
      <path d="M72 22C79 28 82 35 82 49V97H69V85C69 80 65 78 61 78H33V69C56 79 76 64 72 22Z" fill="#000" opacity=".13" />
      <path d="M47 37C47 30 55 28 68 28C85 28 94 32 94 44C94 56 85 60 70 60C54 60 45 54 45 45L47 37Z" fill="#91c3d3" stroke="#111724" strokeWidth="5" />
      <path d="M53 36C61 33 76 33 85 37" stroke="#e0f9ff" strokeWidth="7" strokeLinecap="round" />
      {accessory && (
        <>
          <path d="M36 19L45 4H74L81 20Z" fill="#e5cf82" stroke="#111724" strokeWidth="4" />
          <path d="M41 15H76" stroke="#111724" strokeWidth="4" />
          <rect x="86" y="40" width="9" height="21" rx="4" fill="#e5cf82" stroke="#111724" strokeWidth="3" />
          <path d="M91 56V68H77" stroke="#e5cf82" strokeWidth="4" strokeLinecap="round" />
        </>
      )}
      {state === 'celebrating' && <path d="M19 50L8 33L13 26" stroke={color} strokeWidth="10" strokeLinecap="round" />}
      {state === 'warning' && (
        <>
          <path d="M66 5L62 11" stroke="#ef6473" strokeWidth="3" />
          <path d="M84 6L87 13" stroke="#ef6473" strokeWidth="3" />
        </>
      )}
    </svg>
  );
}

export function Button({
  children, onClick, secondary = false, danger = false, disabled = false, type = 'button', className = '', title, ariaLabel,
}: {
  children: ReactNode; onClick?: () => void; secondary?: boolean; danger?: boolean; disabled?: boolean; type?: 'button' | 'submit'; className?: string; title?: string; ariaLabel?: string;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border-2 px-5 py-3 font-display text-xs font-bold tracking-wide shadow-[0_4px_0_#07141d] transition hover:-translate-y-0.5 active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 ${
        danger ? 'border-[#bf5b5e] bg-[#71343d] text-[#ffd8c7]' : secondary ? 'border-[#52717e] bg-[#2d4654] text-[#d6e1e1]' : 'border-[#b3f3d9] bg-[#8ae4cf] text-[#14342f]'
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function Coin({ size = 18 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full border-2 border-[#f2d78b] bg-[#9b7436] text-[#ffedb2] shadow-[inset_0_0_0_2px_#be954b]"
      style={{ width: size, height: size }}
    >
      <Lightbulb size={size * 0.65} />
    </span>
  );
}

export function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`font-mono text-[9px] font-medium tracking-[.16em] text-[#9fb8bf] ${className}`}>{children}</div>;
}

export function Timer({ seconds, className = '' }: { seconds: number; className?: string }) {
  const s = Math.max(0, Math.floor(seconds));
  return (
    <span
      role="timer"
      aria-label={`${Math.floor(s / 60)} minutes ${s % 60} seconds`}
      className={`font-mono font-semibold tabular-nums ${s < 60 ? 'text-[#f49386]' : s < 300 ? 'text-[#ebd68c]' : 'text-[#d8ede3]'} ${className}`}
    >
      {Math.floor(s / 60).toString().padStart(2, '0')}
      <span className="opacity-50">:</span>
      {(s % 60).toString().padStart(2, '0')}
    </span>
  );
}

export function Field({ label, children, error, hint }: { label: string; children: ReactNode; error?: string; hint?: string }) {
  return (
    <label className="mb-4 block">
      <span className="mb-2 block font-mono text-[9px] tracking-widest text-[#b3c4c8]">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-[10px] text-[#8eabb4]">{hint}</span>}
      {error && (
        <span role="alert" className="mt-1 block text-[11px] text-[#f3b399]">
          {error}
        </span>
      )}
    </label>
  );
}

const GOOD = ['SAFE', 'AVAILABLE', 'SOLVED', 'CORRECT', 'GRANTED', 'ACTIVE', 'ONLINE', 'YOU'];
const BAD = ['DANGER', 'HARD', 'DENIED', 'DISABLED', 'ELIMINATED', 'EJECTED', 'DISQUALIFIED', 'OFFLINE', 'CLOSED'];
export function Badge({ children }: { children: string }) {
  const t = GOOD.some((x) => children.includes(x));
  const n = !t && BAD.some((x) => children.includes(x));
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[9px] tracking-wider ${
        t ? 'border-primary/25 bg-primary/10 text-primary' : n ? 'border-[#ee9582]/25 bg-[#ee9582]/10 text-[#ee9582]' : 'border-[#e5ce90]/25 bg-[#e5ce90]/10 text-[#e5ce90]'
      }`}
    >
      <span className="h-1 w-1 rounded-full bg-current" />
      {children}
    </span>
  );
}

/** Institutional mark (text-based; replace with supplied logo assets when available). */
export function IdeaLabMark() {
  return (
    <div className="flex items-center gap-2">
      <Lightbulb size={24} className="text-[#e5cf8f]" />
      <div>
        <div className="font-display text-sm font-bold tracking-[.1em]">IDEA LAB</div>
        <div className="font-mono text-[7px] tracking-widest text-[#9ab2b8]">SGSITS INDORE</div>
      </div>
    </div>
  );
}

/**
 * The shared crew / commander access card. Generated from authenticated server
 * data. The barcode is decorative and derived from the public crew ID — it is
 * never a credential and never contains a token.
 */
export function AccessCard({ name, crewId, color, commander = false, small = false, roleLabel }: { name: string; crewId: string; color: string; commander?: boolean; small?: boolean; roleLabel?: string }) {
  const bars = Array.from(crewId + name).map((c) => c.charCodeAt(0));
  return (
    <div
      className={`relative overflow-hidden rounded-xl border-[3px] text-left ${commander ? 'border-[#dfbd77] bg-[#37414b]' : 'border-[#91d7ca] bg-[#21424c]'} p-5 shadow-[0_10px_0_#061823] ${small ? 'max-w-[290px]' : 'mx-auto max-w-[380px]'}`}
    >
      <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full border-[20px] border-white/[.025]" />
      <div className="flex items-center justify-between">
        <IdeaLabMark />
        <span className="font-display text-[10px] font-bold text-[#afd2cc]">DEBUG + RUN</span>
      </div>
      <div className="my-3 border-t border-white/15" />
      <Label className={commander ? '!text-[#e5cf8f]' : '!text-primary'}>{commander ? 'ADMIN COMMAND CARD' : 'CREW ACCESS CARD'}</Label>
      <div className="my-4 flex items-center gap-4">
        <Crewmate color={color} accessory={commander} size={small ? 58 : 84} state="still" />
        <div className="min-w-0">
          <Label>{commander ? 'COMMANDER' : 'TEAM'}</Label>
          <div className="mt-1 truncate font-display text-xl font-bold">{name}</div>
          <Label className="mt-2">{commander ? 'CLEARANCE' : 'CREW ID'}</Label>
          <div className="mt-1 font-mono text-xl text-[#abe9df]">{crewId}</div>
        </div>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <Label>ACCESS LEVEL</Label>
          <span className="mt-1 block font-mono text-[10px] text-[#e5cf8f]">{roleLabel ?? (commander ? 'COMMANDER' : 'COMPETITOR')}</span>
        </div>
        <div className="flex h-9 items-stretch gap-[2px]" aria-hidden="true">
          {Array.from({ length: 30 }, (_, i) => (
            <span key={i} className="bg-[#c6e5d9]/70" style={{ width: (bars[i % bars.length] + i) % 3 === 0 ? 3 : 1 }} />
          ))}
        </div>
      </div>
      <div className="mt-4 flex justify-between font-mono text-[7px] tracking-widest text-[#90b5b3]">
        <span>ONE CREW. ONE IDENTITY.</span>
        <span>IL / {crewId.replace(/\D/g, '').padStart(3, '0').slice(-3)}</span>
      </div>
    </div>
  );
}

export function ShipSilhouette() {
  return (
    <svg viewBox="0 0 360 160" className="h-full w-full animate-[float_8s_ease-in-out_infinite]" aria-hidden="true">
      <path d="M70 53L22 22L29 100L78 112M89 110L69 146L216 118" fill="#324b5d" stroke="#091a25" strokeWidth="6" />
      <path d="M59 55H235L330 88L273 116H83L54 91Z" fill="#66848e" stroke="#0b1b27" strokeWidth="7" />
      <path d="M139 53L173 16H229L257 60" fill="#789493" stroke="#0b1b27" strokeWidth="6" />
      <path d="M182 25H224L239 48H161Z" fill="#a5e8d5" />
      <path d="M88 67H242M99 102H265" stroke="#bad5bd" strokeWidth="3" />
      {[104, 137, 170, 203, 236].map((x) => (
        <rect key={x} x={x} y="77" width="19" height="14" rx="5" fill="#1c5159" stroke="#0e2733" strokeWidth="3" />
      ))}
      <path d="M274 75L308 88L273 103" fill="#a5e8d5" />
      <path d="M53 65L2 82L53 98" fill="#a5e8d5" opacity=".4" />
      <rect x="47" y="65" width="15" height="32" rx="6" fill="#365769" stroke="#102735" strokeWidth="3" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Modal shell ("AMONG BUGS / SHIP SYSTEM INTERFACE") with focus trap + Esc
// ---------------------------------------------------------------------------

export function ShipDialog({
  open, onClose, children, label, wide = false, variant = 'default', closeOnBackdrop = true, header = 'AMONG BUGS / SHIP SYSTEM INTERFACE',
}: {
  open: boolean; onClose: () => void; children: ReactNode; label: string; wide?: boolean | 'full'; variant?: 'default' | 'imposter' | 'void'; closeOnBackdrop?: boolean; header?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  // Keep the latest onClose without re-running the focus effect (parents re-render on every timer tick).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => {
      const el = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>('button, input, textarea, select');
      el?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const els = Array.from(ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]')).filter((x) => x.getClientRects().length > 0);
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      // Monaco manages its own Tab key; do not trap while it has focus.
      if ((document.activeElement as HTMLElement | null)?.closest('.monaco-editor')) return;
      if (e.shiftKey && (document.activeElement === first || !ref.current.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      if (prev?.isConnected) prev.focus?.();
    };
  }, [open]);

  const width = wide === 'full' ? 'max-w-[1500px]' : wide ? 'max-w-[1170px]' : 'max-w-[680px]';
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#04131e]/70 p-2 backdrop-blur-[3px] sm:p-6"
          style={variant === 'void' ? { backgroundColor: '#030811' } : undefined}
          onMouseDown={(e) => {
            if (closeOnBackdrop && e.target === e.currentTarget) closeRef.current();
          }}
        >
          <motion.section
            ref={ref}
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.25 }}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className={`relative my-auto max-h-[94vh] w-full overflow-y-auto rounded-[18px] border-[3px] p-4 shadow-[0_10px_0_#051521,0_30px_100px_#0009] sm:p-6 ${width} ${
              variant === 'void' ? 'starfield !border-transparent !bg-transparent !shadow-none' : variant === 'imposter' ? 'border-[#c67c6b] bg-[#392e3c]' : 'border-[#668991] bg-[#203b49]'
            }`}
          >
            <div className="mb-5 flex items-center justify-between border-b border-white/15 pb-3">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                <Label className="!text-[8px]">{header}</Label>
              </div>
              <button aria-label="Exit terminal" onClick={onClose} className="rounded-md border border-[#718e95]/40 bg-[#18333f] p-1.5 text-[#b9d2cd] hover:bg-[#3a5a63]">
                <X size={16} />
              </button>
            </div>
            {children}
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

const ToastCtx = createContext<(msg: string, tone?: 'info' | 'alert' | 'good') => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; tone: string; id: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const notify = useCallback((msg: string, tone: 'info' | 'alert' | 'good' = 'info') => {
    setToast({ msg, tone, id: Date.now() });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={notify}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-36 z-[90] flex justify-center sm:bottom-28">
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast.id}
              role="status"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={`pointer-events-auto flex w-max max-w-[90vw] items-center gap-3 rounded-lg border-2 px-4 py-3 text-xs shadow-xl ${
                toast.tone === 'alert' ? 'border-[#c67c6b] bg-[#4e2f3b]/95 text-[#ffd8c7]' : toast.tone === 'good' ? 'border-primary bg-[#13333f]/95 text-[#d7f5e9]' : 'border-[#89b7af] bg-[#13333f]/95 text-[#d7e9dd]'
              }`}
            >
              <Radio size={14} className="shrink-0 text-primary" />
              {toast.msg}
              <button aria-label="Dismiss notification" onClick={() => setToast(null)}>
                <X size={12} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

/** Loading / error / empty states used everywhere an integration can fail. */
export function StatePanel({ kind, title, message, action }: { kind: 'loading' | 'error' | 'empty'; title: string; message?: string; action?: ReactNode }) {
  return (
    <div className={`rounded-xl border-2 p-6 text-center ${kind === 'error' ? 'border-[#9d635a] bg-[#442b34]/70' : 'border-[#3b6270] bg-[#112e3a]/70'}`} role={kind === 'error' ? 'alert' : 'status'}>
      {kind === 'loading' && <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />}
      <div className="font-display text-sm font-bold">{title}</div>
      {message && <p className="mt-2 text-xs leading-5 text-muted">{message}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
