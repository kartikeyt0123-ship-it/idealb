/**
 * Isolated live preview. The iframe is `sandbox="allow-scripts"` WITHOUT
 * allow-same-origin (opaque origin: no cookies, storage or platform access).
 * It is remounted for every render; once it posts `ready` we send the document.
 * Only messages whose source is this iframe's window and that carry the
 * `__amongBugsPreview` marker are accepted.
 */
import { useLayoutEffect, useRef } from 'react';

export type PreviewConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'system';

export function PreviewFrame({ doc, nonce, onConsole, onRendered }: { doc: string | null; nonce: number; onConsole: (level: PreviewConsoleLevel, text: string) => void; onRendered: () => void }) {
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
        win.postMessage({ type: 'render', doc }, '*');
      } else if (data.type === 'console') {
        const level = data.level === 'warn' || data.level === 'error' || data.level === 'info' ? data.level : 'log';
        cb.current.onConsole(level, typeof data.text === 'string' ? data.text.slice(0, 2000) : String(data.text));
      } else if (data.type === 'rendered') {
        cb.current.onRendered();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [doc, nonce]);

  if (doc == null) return <p className="p-4 font-mono text-xs text-muted">No index.html in this system — nothing to preview.</p>;
  return (
    <iframe
      key={nonce}
      ref={frame}
      title="Live preview (sandboxed)"
      src="/sandbox/preview.html"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      className="h-full w-full rounded-b-lg border-0 bg-white"
    />
  );
}
