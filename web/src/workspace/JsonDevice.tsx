/**
 * JSON workspace (maker json_tweak / api_intercept): a small device panel that
 * reflects the SERVER's verdict on the last Apply (bulb lights / padlock opens /
 * endpoint returns 200) plus the server's stdout, which carries the flag on
 * success. Nothing here decides success on the client.
 */
import { Loader2 } from 'lucide-react';
import type { RunState } from './serverRun';
import { Label } from '../components/ui';

type Verdict = 'idle' | 'busy' | 'ok' | 'fail';

function Bulb({ v }: { v: Verdict }) {
  const on = v === 'ok';
  return (
    <svg viewBox="0 0 80 110" width="80" height="110" aria-hidden="true">
      {on && <circle cx="40" cy="40" r="38" fill="#ffe27a" opacity="0.25" />}
      <path d="M40 8a30 30 0 0 0-17 54c4 3 6 7 6 12v6h22v-6c0-5 2-9 6-12A30 30 0 0 0 40 8z" fill={on ? '#ffe27a' : '#2b3d47'} stroke={on ? '#fff3b0' : '#5b7884'} strokeWidth="3" />
      {on && <path d="M32 50l8 10 8-10" fill="none" stroke="#b88a10" strokeWidth="3" />}
      <rect x="29" y="82" width="22" height="7" rx="2" fill="#8aa0a8" />
      <rect x="31" y="91" width="18" height="7" rx="2" fill="#7a8f97" />
      <rect x="35" y="100" width="10" height="5" rx="2" fill="#6a7d85" />
    </svg>
  );
}

function Padlock({ v }: { v: Verdict }) {
  const open = v === 'ok';
  return (
    <svg viewBox="0 0 90 110" width="82" height="100" aria-hidden="true">
      <path d={open ? 'M25 48V30a20 20 0 0 1 39-6' : 'M25 48V30a20 20 0 0 1 40 0v18'} fill="none" stroke={open ? '#8ae4bf' : '#8aa0a8'} strokeWidth="8" strokeLinecap="round" />
      <rect x="12" y="48" width="66" height="52" rx="8" fill={open ? '#1f5a4c' : v === 'fail' ? '#5a2a30' : '#2b3d47'} stroke={open ? '#8ae4bf' : v === 'fail' ? '#f49386' : '#5b7884'} strokeWidth="3" />
      <circle cx="45" cy="70" r="7" fill={open ? '#8ae4bf' : '#0d202c'} />
      <rect x="42" y="72" width="6" height="14" rx="2" fill={open ? '#8ae4bf' : '#0d202c'} />
    </svg>
  );
}

function Led({ v, label }: { v: Verdict; label: string }) {
  const color = v === 'ok' ? '#8ae4bf' : v === 'fail' ? '#f49386' : v === 'busy' ? '#ebd68c' : '#4b6670';
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="h-10 w-10 rounded-full border-2" style={{ background: color, borderColor: '#0d202c', boxShadow: v === 'ok' || v === 'fail' ? `0 0 18px ${color}` : 'none' }} />
      <span className="font-mono text-[10px] tracking-widest" style={{ color }}>
        {label}
      </span>
    </div>
  );
}

export function JsonDevice({ state, parseError, fileName, endpoint }: { state: RunState; parseError: string | null; fileName: string; endpoint: boolean }) {
  const run = state.phase === 'done' ? state.run : null;
  const r = run?.result ?? null;
  const verdict: Verdict = state.phase === 'running' ? 'busy' : r ? ((r.success ?? r.exitCode === 0) ? 'ok' : 'fail') : 'idle';
  const component = r?.component ?? null;
  const statusText = verdict === 'ok' ? (endpoint ? '200 OK' : 'ACCEPTED') : verdict === 'fail' ? (endpoint ? '403 FORBIDDEN' : 'REJECTED') : verdict === 'busy' ? 'APPLYING…' : 'STANDBY';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="flex flex-wrap items-center gap-5 rounded-lg border border-[#36515f] bg-[#0a1a24] p-4">
          <div className="flex h-[110px] w-[96px] items-center justify-center">
            {state.phase === 'running' ? (
              <Loader2 size={28} className="animate-spin text-[#ebd68c]" />
            ) : component === 'svg_bulb' ? (
              <Bulb v={verdict} />
            ) : component === 'svg_padlock' ? (
              <Padlock v={verdict} />
            ) : (
              <Led v={verdict} label={endpoint ? 'HTTP' : 'DEVICE'} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <Label>{endpoint ? 'API ENDPOINT' : 'DEVICE STATUS'}</Label>
            <div className={`mt-1 font-display text-lg font-bold tracking-wider ${verdict === 'ok' ? 'text-primary' : verdict === 'fail' ? 'text-[#f49386]' : 'text-[#cadbd7]'}`} role="status">
              {statusText}
            </div>
            <p className="mt-1 text-[11px] leading-5 text-[#9fb8bf]">
              Edit <span className="font-mono text-[#cadbd7]">{fileName}</span> in the editor, then press <b>Apply</b>. The server checks the state you send.
            </p>
          </div>
        </div>

        {parseError && (
          <p role="alert" className="mt-3 rounded border border-[#9d635a] bg-[#442b34]/70 px-3 py-2 font-mono text-[11px] text-[#ffd8c7]">
            JSON syntax error — {parseError}
          </p>
        )}

        <div className="mt-4 font-mono text-[11.5px] leading-5">
          {state.phase === 'error' && (
            <div role="alert" className="whitespace-pre-wrap text-[#f49386]">
              {'> '}
              {state.message}
            </div>
          )}
          {run && !r && <div className="text-[#f49386]">{`> ${run.error ?? 'The device did not answer.'}`}</div>}
          {r && (
            <>
              <div className="mb-1 text-[9px] tracking-[.16em] text-[#6c929d]">RESPONSE</div>
              <pre className={`whitespace-pre-wrap break-words ${verdict === 'ok' ? 'text-[#d8ede3]' : 'text-[#f3c1b4]'}`}>{r.stdout || '(no output)'}</pre>
              {r.stderr && <pre className="mt-2 whitespace-pre-wrap break-words text-[#f49386]">{r.stderr}</pre>}
            </>
          )}
          {state.phase === 'idle' && <p className="text-[#537681]">{'> waiting for the first Apply…'}</p>}
        </div>
      </div>
      <p className="shrink-0 border-t border-[#36515f] px-4 py-2 font-mono text-[9px] tracking-wide text-[#6c929d]">Apply never awards IdeaCoins — submit the revealed flag below.</p>
    </div>
  );
}
