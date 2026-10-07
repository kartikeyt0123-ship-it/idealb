/**
 * Read-only evidence board (cryptography / OSINT).
 *  - text / sequence → monospace <pre>; sequence also offers a read-only byte grid
 *    (offsets, 16 bytes per row — no decoding, so it never solves the puzzle).
 *  - html → ONLY inside an iframe with `sandbox=""` (no allow-scripts, no
 *    same-origin): markup and CSS render, nothing can execute or reach the app.
 */
import { useMemo, useState } from 'react';

/** Parses hex / 0x.. / \xNN tokens. Returns null when the content is not a byte sequence. */
export function parseBytes(text: string): number[] | null {
  const tokens = text.replace(/\\x/gi, ' ').split(/[\s,;:]+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 8192) return null;
  const out: number[] = [];
  for (const t of tokens) {
    const s = t.replace(/^0x/i, '');
    if (/^[01]{8,}$/.test(s)) return null; // binary strings: leave them as they are
    if (/^[0-9a-f]{2}$/i.test(s)) out.push(parseInt(s, 16));
    else if (/^(?:[0-9a-f]{2})+$/i.test(s) && s.length <= 4096) for (let i = 0; i < s.length; i += 2) out.push(parseInt(s.slice(i, i + 2), 16));
    else return null;
  }
  return out;
}

export function EvidenceBoard({ board }: { board: { type: 'text' | 'html' | 'sequence'; content: string } }) {
  const [view, setView] = useState<'raw' | 'bytes'>('raw');
  const bytes = useMemo(() => (board.type === 'sequence' ? parseBytes(board.content) : null), [board]);

  if (board.type === 'html') {
    return (
      <div className="flex h-full min-h-[260px] flex-col">
        <iframe
          title="Evidence board (static, scripts disabled)"
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={board.content}
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
        <p className="shrink-0 border-t border-[#36515f] px-3 py-1.5 font-mono text-[9px] text-[#6c929d]">Static evidence page — scripts are disabled.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {board.type === 'sequence' && bytes && (
        <div className="flex shrink-0 gap-1 border-b border-[#36515f] px-2 py-1">
          {(['raw', 'bytes'] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} className={`rounded px-2 py-1 font-mono text-[10px] ${view === v ? 'bg-[#1d3a48] text-primary' : 'text-[#8eafb8] hover:bg-white/5'}`}>
              {v === 'raw' ? 'Sequence' : `Byte view (${bytes.length})`}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {view === 'bytes' && bytes ? (
          // Layout only (offset + 16 bytes per row): deliberately no ASCII / decimal decoding — that is the puzzle.
          <table className="m-3 border-collapse font-mono text-[11px] text-[#cadbd7]">
            <tbody>
              {Array.from({ length: Math.ceil(Math.min(bytes.length, 4096) / 16) }, (_, row) => (
                <tr key={row} className="border-t border-white/5">
                  <td className="pr-3 text-[#537681]">{(row * 16).toString(16).padStart(4, '0')}</td>
                  {bytes.slice(row * 16, row * 16 + 16).map((b, i) => (
                    <td key={i} className={`px-1 ${i === 8 ? 'pl-3' : ''}`}>
                      {b.toString(16).padStart(2, '0')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <pre className="whitespace-pre-wrap break-all p-4 font-mono text-[12px] leading-5 text-[#cadbd7]">{board.content || '(empty board)'}</pre>
        )}
      </div>
    </div>
  );
}
