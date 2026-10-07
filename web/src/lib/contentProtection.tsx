/**
 * Best-effort copy / screenshot DETERRENCE for crew screens (organizer rule
 * `event.protectContent`).
 *
 * IMPORTANT: a web page cannot truly prevent screenshots, screen recording,
 * OS snipping tools, browser extensions, devtools or a phone camera. Everything
 * here only raises the effort and leaves a visible crew watermark on any
 * capture. It is deterrence, not security — the server never relies on it.
 *
 * What it does while enabled:
 *  - blocks copy / cut (document events → preventDefault + toast), context menu,
 *    drag-start of text / images; paste and typing stay allowed;
 *  - blocks Ctrl/Cmd + C, X, P, S, U, Ctrl+Insert, Ctrl+Shift+I/J/C and F12 (best effort);
 *  - PrintScreen → tries to clear the clipboard and flashes a black screen;
 *  - covers the screen while the window is blurred / hidden (Snipping-tool style
 *    captures usually take focus first) — except when focus moved into an
 *    in-page iframe such as the live preview;
 *  - `@media print { body { display:none } }` and user-select:none (inputs,
 *    textareas and Monaco keep their own editing selection);
 *  - an optional faint tiled watermark with the crew id + name.
 */
import { useEffect, useRef, useState } from 'react';
import { useToast } from '../components/ui';

const STYLE_ID = 'ab-protect-style';
const CSS = `
@media print { body { display: none !important; } }
html.ab-protect body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
html.ab-protect input, html.ab-protect textarea, html.ab-protect [contenteditable="true"], html.ab-protect .ab-selectable { -webkit-user-select: text; user-select: text; }
html.ab-protect img, html.ab-protect svg { -webkit-user-drag: none; }
`;

const COPY_MSG = 'Copying is disabled during the competition.';

function isEditable(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (!!el.closest?.('.monaco-editor') || !!el.matches?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
}

/** Window (or tab) lost focus to something outside this page — iframes inside the page do not count. */
function focusLeftPage() {
  if (document.visibilityState === 'hidden') return true;
  if (document.hasFocus()) return false; // true also when a descendant iframe (the preview) has focus
  return document.activeElement?.tagName !== 'IFRAME';
}

export function useContentProtection(enabled: boolean) {
  const notify = useToast();
  const [covered, setCovered] = useState(false);
  const [flash, setFlash] = useState(false);
  const lastToast = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setCovered(false);
      return;
    }
    const root = document.documentElement;
    root.classList.add('ab-protect');
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    const ownStyle = !style;
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    const toast = () => {
      const now = Date.now();
      if (now - lastToast.current < 1500) return;
      lastToast.current = now;
      notify(COPY_MSG, 'alert');
    };
    let flashTimer: number | undefined;
    const blackout = () => {
      setFlash(true);
      window.clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => setFlash(false), 1500);
      // Overwrite whatever the OS just put on the clipboard (works only while focused; best effort).
      try {
        void navigator.clipboard?.writeText('').catch(() => undefined);
      } catch {
        /* clipboard API unavailable */
      }
    };

    // Capture phase on window: runs before Monaco / React handlers, which are stopped
    // so they cannot fill the clipboard themselves.
    const onClipboard = (e: ClipboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        e.clipboardData?.setData('text/plain', '');
      } catch {
        /* ignore */
      }
      toast();
    };
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onDrag = (e: DragEvent) => {
      if (isEditable(e.target) && !(e.target as HTMLElement).closest?.('.monaco-editor')) return; // dragging the caret inside an input is harmless
      e.preventDefault();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'PrintScreen') {
        blackout();
        return;
      }
      const blocked =
        e.key === 'F12' ||
        (mod && e.shiftKey && (k === 'i' || k === 'j' || k === 'c')) ||
        (mod && e.altKey && (k === 'i' || k === 'j' || k === 'c')) || // macOS devtools chords
        (mod && !e.shiftKey && (k === 'c' || k === 'x' || k === 'p' || k === 's' || k === 'u')) ||
        (mod && e.key === 'Insert');
      if (!blocked) return;
      e.preventDefault();
      e.stopPropagation();
      if (k === 'c' || k === 'x' || e.key === 'Insert') toast();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen') blackout();
    };

    const check = () => setCovered(focusLeftPage());
    const onBlur = () => window.setTimeout(check, 0); // activeElement / hasFocus settle after the event
    const onFocus = () => setCovered(false);
    const poll = window.setInterval(check, 800);

    window.addEventListener('copy', onClipboard, true);
    window.addEventListener('cut', onClipboard, true);
    window.addEventListener('contextmenu', onContext, true);
    window.addEventListener('dragstart', onDrag, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', check);
    return () => {
      root.classList.remove('ab-protect');
      if (ownStyle) style?.remove();
      window.clearInterval(poll);
      window.clearTimeout(flashTimer);
      window.removeEventListener('copy', onClipboard, true);
      window.removeEventListener('cut', onClipboard, true);
      window.removeEventListener('contextmenu', onContext, true);
      window.removeEventListener('dragstart', onDrag, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', check);
      setCovered(false);
      setFlash(false);
    };
  }, [enabled, notify]);

  return { covered: enabled && covered, flash: enabled && flash };
}

function escapeXml(s: string) {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] ?? c);
}

/** Faint diagonal tiled watermark (crew id + name). pointer-events:none — never blocks interaction. */
export function Watermark({ text, className = 'fixed inset-0 z-[96]' }: { text: string; className?: string }) {
  const label = escapeXml(text.slice(0, 80));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200"><text x="180" y="110" text-anchor="middle" transform="rotate(-24 180 100)" font-family="JetBrains Mono, monospace" font-size="15" fill="#ffffff" fill-opacity="0.07">${label}</text><text x="0" y="10" transform="rotate(-24 180 100)" font-family="JetBrains Mono, monospace" font-size="11" fill="#000000" fill-opacity="0.05">${label}</text></svg>`;
  return (
    <div
      aria-hidden="true"
      data-watermark=""
      className={`pointer-events-none select-none ${className}`}
      style={{ backgroundImage: `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`, backgroundRepeat: 'repeat' }}
    />
  );
}

/**
 * Mount once per protected screen (Ship). Renders the blur cover, the
 * PrintScreen blackout and (optionally) the watermark.
 */
export function ContentProtection({ enabled, watermark }: { enabled: boolean; watermark?: string | null }) {
  const { covered, flash } = useContentProtection(enabled);
  if (!enabled) return null;
  return (
    <>
      {watermark ? <Watermark text={watermark} /> : null}
      {covered && !flash && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="Screen hidden"
          onClick={() => window.focus()}
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-3 bg-[#05101a] text-center"
        >
          <div className="font-display text-xl font-bold tracking-[.14em] text-[#e5cf8f]">RETURN TO THE SHIP TO CONTINUE</div>
          <p className="max-w-sm px-6 text-xs leading-5 text-[#9fb8bf]">The terminal is hidden while this window is not focused. Click anywhere here to resume.</p>
        </div>
      )}
      {flash && (
        <div role="alert" className="fixed inset-0 z-[201] flex items-center justify-center bg-black text-center">
          <div className="font-display text-xl font-bold tracking-[.14em] text-[#f3ad92]">SCREENSHOTS ARE DISABLED</div>
        </div>
      )}
    </>
  );
}
