/** Small presentational building blocks for the task workspace. */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { ShipDialog } from '../components/ui';
import { parseCsv, parseStatement, readPref, writePref } from './util';

export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

/** ShipDialog pinned to the viewport (ShipDialog itself is `absolute`). */
export function Modal(props: { open: boolean; onClose: () => void; label: string; children: ReactNode; imposter?: boolean; closeOnBackdrop?: boolean }) {
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-[80]">
      <ShipDialog open onClose={props.onClose} label={props.label} variant={props.imposter ? 'imposter' : 'default'} closeOnBackdrop={props.closeOnBackdrop ?? true}>
        {props.children}
      </ShipDialog>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label, imposter, right }: { tabs: { id: T; label: string; icon?: ReactNode }[]; value: T; onChange: (t: T) => void; label: string; imposter?: boolean; right?: ReactNode }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: ReactKeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    onChange(tabs[n].id);
    refs.current[n]?.focus();
  };
  return (
    <div className={`flex min-h-[42px] items-center gap-1 border-b px-2 ${imposter ? 'border-[#6e4a4f]' : 'border-[#36515f]'}`}>
      <div role="tablist" aria-label={label} className="flex min-w-0 flex-1 gap-1 overflow-x-auto py-1">
        {tabs.map((t, i) => {
          const active = t.id === value;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              role="tab"
              type="button"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(t.id)}
              onKeyDown={(e) => onKey(e, i)}
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-[10px] tracking-wider transition ${
                active ? (imposter ? 'bg-[#5a3a43] text-[#ffd8c7]' : 'bg-[#1d3a48] text-primary') : 'text-[#8eafb8] hover:bg-white/5'
              }`}
            >
              {t.icon}
              {t.label.toUpperCase()}
            </button>
          );
        })}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}

/**
 * Two resizable side-by-side panels. Drag the splitter or focus it and use
 * Arrow keys (Shift = bigger steps), Home/End. Stacks vertically when `stacked`.
 */
export function SplitPanels({ left, right, stacked, minPx = 300, prefKey, imposter }: { left: ReactNode; right: ReactNode; stacked: boolean; minPx?: number; prefKey: string; imposter?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(() => {
    const v = Number(readPref(prefKey));
    return Number.isFinite(v) && v >= 15 && v <= 85 ? v : 52;
  });
  const [dragging, setDragging] = useState(false);

  const clamp = useCallback(
    (p: number) => {
      const w = box.current?.getBoundingClientRect().width ?? 1000;
      const minPct = Math.min(45, (minPx / Math.max(w, 1)) * 100);
      return Math.min(100 - minPct, Math.max(minPct, p));
    },
    [minPx],
  );
  useEffect(() => writePref(prefKey, String(Math.round(pct))), [pct, prefKey]);
  useEffect(() => {
    const on = () => setPct((p) => clamp(p));
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [clamp]);

  if (stacked) {
    return (
      <div className="flex flex-col gap-3">
        <div className="h-[62vh] min-h-[380px]">{left}</div>
        <div className="h-[55vh] min-h-[320px]">{right}</div>
      </div>
    );
  }

  const fromPointer = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return;
    setPct(clamp(((clientX - r.left) / r.width) * 100));
  };
  const onKey = (e: ReactKeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowLeft') setPct((p) => clamp(p - step));
    else if (e.key === 'ArrowRight') setPct((p) => clamp(p + step));
    else if (e.key === 'Home') setPct(clamp(0));
    else if (e.key === 'End') setPct(clamp(100));
    else return;
    e.preventDefault();
  };

  return (
    <div ref={box} className="relative flex h-full min-h-0 w-full">
      <div className="min-w-0" style={{ width: `calc(${pct}% - 6px)` }}>
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panels"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        tabIndex={0}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
        }}
        onPointerMove={(e) => dragging && fromPointer(e.clientX)}
        onPointerUp={(e) => {
          setDragging(false);
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => setDragging(false)}
        className="group mx-[2px] flex w-2 shrink-0 cursor-col-resize touch-none items-center justify-center rounded focus-visible:outline-2"
      >
        <span className={`h-16 w-1 rounded-full transition ${dragging ? (imposter ? 'bg-[#f0b8a2]' : 'bg-primary') : imposter ? 'bg-[#6e4a4f] group-hover:bg-[#c67c6b]' : 'bg-[#3c5c69] group-hover:bg-primary/70'}`} />
      </div>
      <div className="min-w-0 flex-1">{right}</div>
      {/* Shield iframes/Monaco from swallowing pointer events while dragging. */}
      {dragging && <div className="fixed inset-0 z-[70] cursor-col-resize" />}
    </div>
  );
}

/** Plain text with ``` fenced code blocks. Rendered as text nodes only (no HTML). */
export function Statement({ text }: { text: string }) {
  const blocks = parseStatement(text);
  return (
    <div className="space-y-3 text-[13px] leading-6 text-[#d3e1d9]">
      {blocks.map((b, i) =>
        b.kind === 'code' ? (
          <pre key={i} className="overflow-x-auto rounded-lg border border-[#36515f] bg-[#081822] p-3 font-mono text-[11.5px] leading-5 text-[#cadbd7]">
            {b.text}
          </pre>
        ) : (
          <p key={i} className="whitespace-pre-wrap break-words">
            {b.text}
          </p>
        ),
      )}
    </div>
  );
}

export function CsvTable({ text, name }: { text: string; name: string }) {
  const { rows, truncated } = parseCsv(text);
  if (!rows.length) return <p className="p-4 font-mono text-xs text-muted">{name} is empty.</p>;
  const [head, ...body] = rows;
  return (
    <div className="h-full overflow-auto">
      <table className="min-w-full border-collapse font-mono text-[11px]">
        <caption className="sr-only">{name} (read-only dataset)</caption>
        <thead className="sticky top-0 z-[1] bg-[#15303c]">
          <tr>
            <th className="border-b border-[#36515f] px-2 py-1.5 text-right text-[#537681]">#</th>
            {head.map((h, i) => (
              <th key={i} scope="col" className="whitespace-nowrap border-b border-[#36515f] px-3 py-1.5 text-left font-semibold text-primary">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className="odd:bg-white/[.02] hover:bg-white/[.05]">
              <td className="px-2 py-1 text-right text-[#537681]">{i + 1}</td>
              {head.map((_, j) => (
                <td key={j} className="whitespace-nowrap px-3 py-1 text-[#cadbd7]">
                  {r[j] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {truncated && <p className="p-3 font-mono text-[10px] text-[#ebd68c]">Showing the first {body.length} rows.</p>}
    </div>
  );
}
