import { motion, AnimatePresence } from 'motion/react';
import { Radio, Trophy } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Crewmate, StatePanel } from '../components/ui';
import { api, ApiError, serverNow, syncClock, V1, type DisplayState } from '../lib/api';
import { useRealtime } from '../lib/realtime';

/**
 * Projector screens. They authenticate with a revocable display link: the key
 * travels in the URL fragment (#key=…, never sent to servers or logs), is
 * exchanged once for a display-only cookie, and is then removed from the
 * address bar. Payloads contain approved standings fields only.
 */
export type DisplayRoute = { kind: 'OVERALL' } | { kind: 'SLOT'; slotId: string } | { kind: 'SPRINT'; slotId: string; sprintId: string };

const UUID = '[0-9a-f-]{36}';
export function parseDisplayPath(path: string): DisplayRoute | null {
  if (path === '/display' || path === '/display/overall') return { kind: 'OVERALL' };
  let m = new RegExp(`^/display/slots/(${UUID})/sprints/(${UUID})$`, 'i').exec(path);
  if (m) return { kind: 'SPRINT', slotId: m[1], sprintId: m[2] };
  m = new RegExp(`^/display/slots/(${UUID})$`, 'i').exec(path);
  if (m) return { kind: 'SLOT', slotId: m[1] };
  return null;
}

function endpoint(r: DisplayRoute) {
  if (r.kind === 'OVERALL') return `${V1}/display/overall`;
  if (r.kind === 'SLOT') return `${V1}/display/slots/${r.slotId}`;
  return `${V1}/display/slots/${r.slotId}/sprints/${r.sprintId}`;
}

const STATUS_STYLE: Record<DisplayState['status'], string> = {
  LIVE: 'bg-[#f37983] text-[#1a0b10]',
  FROZEN: 'bg-[#7dace9] text-[#08131c]',
  PROVISIONAL: 'bg-[#edd478] text-[#1b1606]',
  FINAL: 'bg-[#86cd97] text-[#081a0e]',
  NOT_STARTED: 'bg-[#33505c] text-[#dfe7ea]',
};

function Countdown({ deadlineAt, pausedAt }: { deadlineAt: string | null; pausedAt: string | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, []);
  if (!deadlineAt) return null;
  const end = Date.parse(deadlineAt);
  const now = pausedAt ? Date.parse(pausedAt) : serverNow();
  const s = Math.max(0, Math.ceil((end - now) / 1000));
  const txt = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return (
    <span className={`font-mono text-5xl tabular-nums ${s <= 60 && !pausedAt ? 'text-[#f37983]' : 'text-[#edf0e5]'}`}>
      {txt}
      {pausedAt && <span className="ml-3 align-middle text-xl text-[#edd478]">PAUSED</span>}
    </span>
  );
}

export function DisplayScreen({ route }: { route: DisplayRoute }) {
  const [state, setState] = useState<DisplayState | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [authed, setAuthed] = useState(false);
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const s = await api.get<DisplayState>(endpoint(route));
      syncClock(s.serverTime);
      setState(s);
      setError(null);
      setAuthed(true);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Display offline — retrying.');
      setError({ code: err.code, message: err.message });
      if (err.status === 401) setAuthed(false);
    } finally {
      loading.current = false;
    }
  }, [route]);

  // Exchange a one-time key from the URL fragment, then drop it from the address bar.
  useEffect(() => {
    const key = new URLSearchParams(location.hash.replace(/^#/, '')).get('key');
    const go = async () => {
      if (key) {
        try {
          await api.post(`${V1}/display/session`, { key });
        } catch (e) {
          setError({ code: 'INVALID', message: e instanceof ApiError ? e.message : 'Display link rejected.' });
        }
        history.replaceState(null, '', location.pathname);
      }
      await load();
    };
    void go();
  }, [load]);

  useRealtime(authed, () => void load(), () => void load(), { display: true });
  useEffect(() => {
    const t = setInterval(() => void load(), 15_000); // safety net if a socket message is missed
    return () => clearInterval(t);
  }, [load]);

  if (!state) {
    return (
      <div className="starfield fixed inset-0 flex items-center justify-center bg-[#0b1923] p-6 text-[#edf0e5]">
        {error ? (
          <StatePanel kind="error" title={error.code === 'UNAUTHENTICATED' || error.code === 'INVALID' ? 'Projector not authorised' : 'Display unavailable'} message={error.code === 'UNAUTHENTICATED' ? 'Open this screen with a display link from the organizer console (Displays tab).' : error.message} />
        ) : (
          <StatePanel kind="loading" title="Connecting the projector…" />
        )}
      </div>
    );
  }

  const slot = state.slotId ? state.slots.find((s) => s.id === state.slotId) : undefined;
  const title = state.scope === 'OVERALL' ? 'Overall standings' : state.scope === 'SLOT' ? `${slot?.name} · cumulative` : `${slot?.name} · Sprint ${state.sprintNumber}`;
  const showSprints = state.scope !== 'SPRINT';
  const live = slot?.sprint && ['RUNNING', 'PAUSED'].includes(slot.sprint.status) && (state.scope !== 'SPRINT' || slot.sprint.number === state.sprintNumber) ? slot.sprint : null;
  const running = state.slots.find((s) => s.sprint && ['RUNNING', 'PAUSED'].includes(s.sprint.status));

  return (
    <div className="starfield fixed inset-0 overflow-hidden bg-[#0b1923] text-[#edf0e5]">
      <div className="mx-auto flex h-full max-w-[1800px] flex-col px-4 py-4 sm:px-10 sm:py-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="font-mono text-xs tracking-[0.3em] text-[#92b0b8]">{state.event.organizer} · {state.event.edition} · {state.event.venue}</div>
            <h1 className="mt-1 text-3xl font-black tracking-wide sm:text-5xl">{state.event.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className="text-xl text-[#cfe0e4] sm:text-2xl">{title}</span>
              <span className={`rounded px-2 py-1 font-mono text-sm font-bold tracking-widest ${STATUS_STYLE[state.status]}`}>{state.status === 'LIVE' ? '● LIVE' : state.status}</span>
              {slot && <span className="font-mono text-sm text-[#92b0b8]">{slot.dayLabel} · {slot.date}</span>}
            </div>
          </div>
          <div className="text-right">
            {live ? (
              <>
                <div className="font-mono text-xs tracking-widest text-[#92b0b8]">SPRINT {live.number} / 4</div>
                <Countdown deadlineAt={live.deadlineAt} pausedAt={live.pausedAt} />
              </>
            ) : running && state.scope === 'OVERALL' ? (
              <div className="flex items-center gap-2 font-mono text-sm text-[#f37983]"><Radio size={16} /> {running.name} · Sprint {running.sprint!.number} live</div>
            ) : null}
          </div>
        </header>

        {state.scope === 'OVERALL' && state.status === 'PROVISIONAL' && (
          <p className="mt-3 rounded border border-[#edd478]/40 bg-[#edd478]/10 px-3 py-2 text-sm text-[#edd478]">
            Provisional: {state.completedSlots?.length ?? 0} of 4 slots completed. Raw totals across slots are only comparable because every slot follows the same release blueprint; results become final when the organizers finalize the event.
          </p>
        )}

        <div className="mt-5 min-h-0 flex-1 overflow-auto rounded-xl border border-[#2b4652] bg-[#0f2230]/80">
          {state.rows.length === 0 ? (
            <div className="flex h-full items-center justify-center p-10"><StatePanel kind="empty" title="No crews on the board yet" /></div>
          ) : (
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 bg-[#132b3a] font-mono text-xs tracking-widest text-[#92b0b8]">
                <tr>
                  <th className="px-4 py-3">RANK</th>
                  <th className="px-4 py-3">CREW</th>
                  {state.scope === 'OVERALL' && <th className="px-4 py-3">SLOT</th>}
                  {showSprints && [1, 2, 3, 4].map((n) => <th key={n} className="px-3 py-3 text-right">S{n}</th>)}
                  <th className="px-4 py-3 text-right">SOLVES</th>
                  <th className="px-4 py-3 text-right">{state.scope === 'SPRINT' ? 'SPRINT SCORE' : 'TOTAL'}</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {state.rows.map((r) => (
                    <motion.tr key={r.crewId} layout transition={{ type: 'spring', stiffness: 260, damping: 30 }} className="border-t border-[#21394a] text-lg sm:text-2xl">
                      <td className="px-4 py-2 font-mono font-bold">
                        {r.rank === 1 ? <Trophy className="inline text-[#edd478]" size={26} /> : null} {r.rank ?? '—'}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3">
                          <Crewmate color={r.color} size={34} state="still" />
                          <div>
                            <div className="font-bold">{r.name}</div>
                            <div className="font-mono text-xs text-[#92b0b8]">{r.crewId}</div>
                          </div>
                        </div>
                      </td>
                      {state.scope === 'OVERALL' && <td className="px-4 py-2 font-mono text-base text-[#cfe0e4]">Slot {r.slotNumber}</td>}
                      {showSprints && [1, 2, 3, 4].map((n) => <td key={n} className="px-3 py-2 text-right font-mono text-base text-[#cfe0e4] tabular-nums">{r.perSprint[String(n)] ?? 0}</td>)}
                      <td className="px-4 py-2 text-right font-mono text-base tabular-nums">{r.solves}</td>
                      <td className="px-4 py-2 text-right font-mono font-black tabular-nums text-[#edd478]">{(state.scope === 'SPRINT' ? r.score : r.cumulative).toLocaleString('en-IN')}</td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          )}
        </div>

        <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-[#6f8e98]">
          <span>Ranked by {state.event.metric === 'GROSS_EARNED' ? 'IdeaCoins earned (hints do not reduce score)' : 'net IdeaCoins (earned − spent)'} · ties share a rank</span>
          <nav className="flex flex-wrap gap-3">
            <a className="underline" href="/display/overall">Overall</a>
            {state.slots.map((s) => (
              <a key={s.id} className="underline" href={`/display/slots/${s.id}`}>{s.name}</a>
            ))}
            {slot && slot.sprints.map((sp) => (
              <a key={sp.id} className="underline" href={`/display/slots/${slot.id}/sprints/${sp.id}`}>S{sp.number}</a>
            ))}
          </nav>
          {error && <span className="text-[#f37983]">{error.message}</span>}
        </footer>
      </div>
    </div>
  );
}
