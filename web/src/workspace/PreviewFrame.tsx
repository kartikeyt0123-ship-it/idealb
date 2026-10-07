/**
 * Isolated live preview. The iframe is `sandbox="allow-scripts"` WITHOUT
 * allow-same-origin (opaque origin: no cookies, storage or platform access).
 * It is remounted for every render; once it posts `ready` we send the document.
 * Only messages whose source is this iframe's window and that carry the
 * `__amongBugsPreview` marker are accepted.
 *
 * alert()/confirm()/prompt() inside the preview are relayed as level 'alert'
 * (some puzzles reveal the flag that way). Keyboard puzzles: the iframe is
 * focusable — click it (or Tab to it) and press keys; keys never reach the ship.
 */
import { useLayoutEffect, useRef } from 'react';

export type PreviewConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'alert' | 'system';

export function PreviewFrame({
  doc, nonce, onConsole, onRendered, protect = false,
}: {
  doc: string | null;
  nonce: number;
  onConsole: (level: PreviewConsoleLevel, text: string) => void;
  onRendered: () => void;
  /** Ask the sandbox to block copy / context menu / print shortcuts inside the page (deterrence only). */
  protect?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const cb = useRef({ onConsole, onRendered });
  cb.current = { onConsole, onRendered };

  useLayoutEffect(() => {
    if (doc == null) return;
    let sent = false;
    const onMessage = (ev: MessageEvent) => {
      const win = frame.current?.contentWindow;
      if (!win || ev.source !== win) return;
      const data = ev.data as { __amongBugsPreview?: unknown; type?: unknown; level?: unknown; text?: unknown } | null;
      if (!data || typeof data !== 'object' || data.__amongBugsPreview !== true) return;
      if (data.type === 'ready' && !sent) {
        sent = true;
        // Opaque-origin sandbox: '*' is the only usable target origin; the doc is the crew's own code.
        win.postMessage({ type: 'render', doc, protect }, '*');
      } else if (data.type === 'console') {
        const level = data.level === 'warn' || data.level === 'error' || data.level === 'info' || data.level === 'alert' ? data.level : 'log';
        cb.current.onConsole(level, typeof data.text === 'string' ? data.text.slice(0, 2000) : String(data.text));
      } else if (data.type === 'rendered') {
        cb.current.onRendered();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [doc, nonce, protect]);

  if (doc == null) return <p className="p-4 font-mono text-xs text-muted">No index.html in this system — nothing to preview.</p>;
  return (
    <iframe
      key={`${nonce}:${protect ? 1 : 0}`}
      ref={frame}
      title="Live preview (sandboxed) — click inside to use the keyboard"
      src="/sandbox/preview.html"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      tabIndex={0}
      onPointerDown={() => frame.current?.focus()}
      className="h-full w-full rounded-b-lg border-0 bg-white outline-none focus-visible:ring-2 focus-visible:ring-primary"
    />
  );
}
