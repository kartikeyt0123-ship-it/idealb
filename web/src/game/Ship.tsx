import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CircleHelp, LayoutGrid, LogOut, Maximize2, Radio, Volume2, VolumeX, Zap } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CommandConsole } from '../admin/CommandConsole';
import { Badge, Button, Coin, Crewmate, Label, ShipDialog, Timer, useToast } from '../components/ui';
import { api, ApiError, serverNow, syncClock, type CommanderShipState, type CommanderStatus, type DomainDto, type ParticipantState, type TeamStatus } from '../lib/api';
import { useRealtime, type Topic } from '../lib/realtime';
import { isMuted, setMuted, sfx } from '../lib/sound';
import { CardReader, Comms, CommanderStation, Ejected, FlightManual, ImposterPanel, RankingsList, Results, SolvedNotice, SprintClosed, StationsMenu, Survived, TaskDeck } from './Dialogs';
import { AccessCard } from '../components/ui';
import { DEFAULT_DOMAINS, interactables, ROOM_LINES, ROOM_NAMES, ROOM_SHORT, ShipWorld } from './ShipWorld';
import { isTypingTarget, useShipEngine } from './useShipEngine';
import { cardIdentity } from '../screens/Gate';
import { StatePanel } from '../components/ui';

// Monaco is heavy: load the engineering terminal on first use.
const TaskWorkspace = lazy(() => import('../workspace').then((m) => ({ default: m.TaskWorkspace })));

type Overlay =
  | { type: 'card' }
  | { type: 'help' }
  | { type: 'scan' }
  | { type: 'console' }
  | { type: 'rankings' }
  | { type: 'menu' }
  | { type: 'comms' }
  | { type: 'tasks'; domain: number }
  | { type: 'workspace'; target: { type: 'TASK' | 'IMPOSTER'; id: string }; domain?: number }
  | { type: 'success'; reward: number; wallet: number; beforeRank: number | null; domain?: number }
  | { type: 'imposter' }
  | { type: 'closed'; sprint: number }
  | { type: 'ejected' }
  | { type: 'survived'; sprint: number }
  | { type: 'results' };

const ACCESS_CODES = ['NOT_ACTIVATED_FOR_DAY', 'REGISTRATION_PENDING', 'TEAM_DISQUALIFIED', 'NO_ACTIVE_DAY', 'TEAM_ARCHIVED'];

function seen(key: string) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function markSeen(key: string) {
  try {
    localStorage.setItem(key, '1');
  } catch {
    /* storage unavailable */
  }
}

export function Ship({ me, onLogout, onAccessLost }: { me: TeamStatus | CommanderStatus; onLogout: (notice?: string) => void; onAccessLost: () => void }) {
  const commander = me.role === 'COMMANDER';
  const toast = useToast();
  const [state, setState] = useState<ParticipantState | null>(null);
  const [cmd, setCmd] = useState<CommanderShipState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [solvedElsewhere, setSolvedElsewhere] = useState<Set<string>>(() => new Set());
  const [muted, setMutedState] = useState(isMuted());
  const [now, setNow] = useState(serverNow());
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const overlayRef = useRef<Overlay | null>(null);
  overlayRef.current = overlay;

  // ---------------- data ----------------
  const inflight = useRef<AbortController | null>(null);
  const fetchState = useCallback(async () => {
    inflight.current?.abort();
    const ac = new AbortController();
    inflight.current = ac;
    try {
      if (commander) {
        const s = await api.get<CommanderShipState>('/api/admin/ship-state', ac.signal);
        syncClock(s.serverTime);
        setCmd(s);
      } else {
        const s = await api.get<ParticipantState>('/api/game/state', ac.signal);
        syncClock(s.serverTime);
        setState(s);
      }
      setLoadError(null);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      if (e instanceof ApiError) {
        if (e.status === 401) return onLogout('Your session ended. Sign in again.');
        if (ACCESS_CODES.includes(e.code)) return onAccessLost();
        setLoadError(e.message);
      }
    }
  }, [commander, onLogout, onAccessLost]);

  const debounce = useRef<number | undefined>(undefined);
  const refetchSoon = useCallback(() => {
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => {
      void fetchState();
      setRefreshKey((k) => k + 1);
    }, 150);
  }, [fetchState]);

  useEffect(() => {
    void fetchState();
    const poll = setInterval(() => void fetchState(), 15_000);
    const tick = setInterval(() => setNow(serverNow()), 250);
    const resize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', resize);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      window.removeEventListener('resize', resize);
    };
  }, [fetchState]);

  const myCrewId = commander ? 'CMD-01' : (me as TeamStatus).team.crewId;
  const conn = useRealtime(
    true,
    (topic: Topic, msg) => {
      refetchSoon();
      switch (topic) {
        case 'session.revoked':
          onLogout('This device was signed out (logout, password change or organizer action).');
          break;
        case 'sprint.started':
          sfx.alarm();
          toast(`Sprint ${msg.sprint} is live. Find the bugs!`, 'good');
          setOverlay((o) => (o && ['closed', 'survived'].includes(o.type) ? null : o));
          break;
        case 'sprint.paused':
          toast('The commander paused the sprint. Hold position.', 'alert');
          break;
        case 'sprint.resumed':
          toast('Sprint resumed. Clock is running again.', 'good');
          break;
        case 'sprint.closed':
          sfx.alarm();
          if (!commander) setOverlay({ type: 'closed', sprint: Number(msg.sprint) });
          break;
        case 'task.solved':
          if (msg.taskId) setSolvedElsewhere((s) => new Set(s).add(String(msg.taskId)));
          if (msg.crewId && msg.crewId !== myCrewId && msg.label) toast(`${msg.crewName} repaired ${msg.label}.`);
          break;
        case 'imposter.offered':
          sfx.alarm();
          toast('IMPOSTER DETECTED — investigate the emergency problem!', 'alert');
          break;
        case 'imposter.reserved':
          if (!msg.mine && msg.crewName) toast(`${msg.crewName} claimed the imposter problem.`);
          break;
        case 'imposter.solved':
          if (msg.crewId !== myCrewId) toast(`${msg.crewName} eliminated the imposter.`);
          if (msg.releaseId) setSolvedElsewhere((s) => new Set(s).add(String(msg.releaseId)));
          break;
        case 'announcement.created':
          sfx.alarm();
          toast(`TRANSMISSION: ${msg.message}`, msg.kind === 'ALERT' ? 'alert' : 'info');
          break;
        case 'game.completed':
          sfx.great();
          break;
        default:
          break;
      }
    },
    refetchSoon,
  );

  // ---------------- derived ----------------
  const game = commander ? cmd?.game ?? null : state?.game ?? null;
  const sprint = commander ? cmd?.sprint ?? null : state?.sprint ?? null;
  const domains: DomainDto[] = (commander ? cmd?.domains : state?.domains) ?? DEFAULT_DOMAINS;
  const domainKey = domains.map((d) => d.slug).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableDomains = useMemo(() => domains, [domainKey]);
  const standings = (commander ? cmd?.standings : state?.standings) ?? { active: [], inactive: [] };
  const identity = commander
    ? { name: (me as CommanderStatus).admin.name.toUpperCase(), crewId: 'CMD-01', color: '#e5cf8f', commander: true }
    : { name: state?.identity.name ?? (me as TeamStatus).team.name, crewId: myCrewId, color: state?.identity.color ?? (me as TeamStatus).team.color, commander: false };
  const phase = game?.phase ?? 'WAITING';
  const running = phase === 'RUNNING' || phase === 'PAUSED';
  const remaining = sprint
    ? sprint.status === 'RUNNING' && sprint.deadlineAt
      ? Math.max(0, Math.ceil((Date.parse(sprint.deadlineAt) - now) / 1000))
      : sprint.status === 'PAUSED'
        ? sprint.remainingSeconds ?? 0
        : null
    : null;
  const zone = state?.me.zone ?? null;
  const viewWidth = (900 * size.w) / size.h;
  const roomWidth = Math.max(1100, viewWidth);

  // Phase-driven overlays: replayed from the snapshot so a missed socket message never hides an outcome.
  useEffect(() => {
    if (!state || commander) return;
    const k = `${state.identity.crewId}:${state.game.id}`;
    if (state.game.phase === 'COMPLETED' && state.result && !seen(`ab-results:${k}`)) {
      markSeen(`ab-results:${k}`);
      setOverlay({ type: 'results' });
      return;
    }
    const le = state.lastElimination;
    if (le && !seen(`ab-elim:${k}:${le.sprint}`)) {
      markSeen(`ab-elim:${k}:${le.sprint}`);
      setOverlay(le.youEliminated ? { type: 'ejected' } : { type: 'survived', sprint: le.sprint });
      return;
    }
    if (state.game.phase === 'ELIMINATION_REVIEW' && !seen(`ab-closed:${k}:${state.game.currentSprint}`)) {
      markSeen(`ab-closed:${k}:${state.game.currentSprint}`);
      setOverlay({ type: 'closed', sprint: state.game.currentSprint });
    }
  }, [state, commander]);

  // Close a workspace as soon as the sprint is no longer running.
  useEffect(() => {
    if (!running && overlay?.type === 'workspace') setOverlay(state?.game.phase === 'ELIMINATION_REVIEW' ? { type: 'closed', sprint: state.game.currentSprint } : null);
  }, [running, overlay?.type, state?.game.phase, state?.game.currentSprint]);

  // ---------------- interactions ----------------
  const onInteract = useCallback(
    (id: string) => {
      sfx.open();
      if (id === 'command') setOverlay({ type: 'scan' });
      else if (id === 'manifest') setOverlay({ type: 'card' });
      else if (id === 'rankings') setOverlay({ type: 'rankings' });
      else if (id.startsWith('station-')) setOverlay({ type: 'tasks', domain: Number(id.split('-')[1]) });
    },
    [],
  );

  const engine = useShipEngine({ viewWidth, roomWidth, domains: stableDomains, frozen: overlay !== null, onInteract, worldRef, containerRef });

  const approach = useCallback(
    (id: string) => {
      const r = engine.approach(id);
      if (r === 'walking') {
        const it = interactables(roomWidth, stableDomains).find((x) => x.id === id);
        if (it) toast(`Walking to ${it.label.toLowerCase()}…`);
      }
    },
    [engine, roomWidth, stableDomains, toast],
  );

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || overlayRef.current) return;
      const k = e.key.toLowerCase();
      if (k === 'e' && !e.repeat) {
        if (!engine.interact()) toast('Walk closer to a glowing station, console or crew manifest.');
      } else if (k === 'i') setOverlay({ type: 'card' });
      else if (k === 'm') toggleMute();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.interact, toast]);

  function toggleMute() {
    const m = !isMuted();
    setMuted(m);
    setMutedState(m);
    if (!m) sfx.open();
  }

  async function logout() {
    try {
      await api.post('/api/auth/logout', {});
    } catch {
      /* already signed out */
    }
    onLogout();
  }

  const close = useCallback(() => setOverlay(null), []);
  const imposter = state?.imposter ?? null;
  const claimBanner = !!imposter && imposter.status === 'OFFERED' && (imposter.claimOpen || imposter.mode === 'OPEN') && state?.me.status === 'ACTIVE';
  const currentRoom = engine.room;
  const nearLabel = engine.near ? interactables(roomWidth, stableDomains).find((x) => x.id === engine.near)?.label : null;

  // ---------------- render ----------------
  const dialog = (() => {
    if (!overlay) return null;
    switch (overlay.type) {
      case 'card':
        return (
          <ShipDialog open onClose={close} label="Access card">
            <div className="py-3 text-center">
              <Label className="mb-5 !text-primary">{commander ? 'COMMANDER IDENTITY' : 'ONE CREW. ONE SHARED IDENTITY.'}</Label>
              <AccessCard {...cardIdentity(me)} name={identity.name} color={identity.color} />
              {!commander && state && (
                <p className="mt-6 text-xs text-muted">
                  {state.identity.members.map((m) => m.name).join(' · ')}
                </p>
              )}
              <p className="mt-4 text-xs text-muted">Press I to view your card anywhere aboard the ship.</p>
            </div>
          </ShipDialog>
        );
      case 'help':
        return (
          <ShipDialog open onClose={close} label="Flight manual">
            <FlightManual state={state} />
          </ShipDialog>
        );
      case 'menu':
        return (
          <ShipDialog open onClose={close} label="Stations menu">
            <StationsMenu domains={stableDomains} commander={commander} onPick={(id) => onInteract(id)} />
          </ShipDialog>
        );
      case 'comms':
        return (
          <ShipDialog open onClose={close} label="Comms log">
            <Comms items={(commander ? cmd?.announcements : state?.announcements) ?? []} />
          </ShipDialog>
        );
      case 'scan':
        return (
          <ShipDialog open onClose={close} label="Command card reader">
            <CardReader
              identity={identity}
              onGranted={() => setOverlay({ type: 'console' })}
              onDenied={() => {
                setOverlay(null);
                engine.toLobby();
                toast('ACCESS DENIED — commander clearance required. Returned to the lobby.', 'alert');
              }}
            />
          </ShipDialog>
        );
      case 'console':
        return (
          <ShipDialog open onClose={close} label="Commander terminal" wide="full" closeOnBackdrop={false} header="AMONG BUGS / COMMAND CONTROL PANEL">
            <CommandConsole refreshKey={refreshKey} onClose={close} />
          </ShipDialog>
        );
      case 'rankings':
        return (
          <ShipDialog open onClose={close} label="Crew rankings">
            <Label className="!text-primary">OBSERVATION DECK / LIVE TELEMETRY</Label>
            <h2 className="mb-5 mt-2 font-display text-3xl font-bold">Crew rankings · {game?.name ?? ''}</h2>
            <RankingsList active={standings.active} inactive={standings.inactive} meCrewId={myCrewId} metric={game?.rankingMetric ?? 'NET_COINS'} eliminateCount={sprint?.eliminateCount ?? null} live={running} />
          </ShipDialog>
        );
      case 'tasks': {
        const d = stableDomains[overlay.domain] ?? stableDomains[0];
        return (
          <ShipDialog open onClose={close} label={`${d.name} station`}>
            {commander ? (
              <CommanderStation domain={d} onConsole={() => setOverlay({ type: 'scan' })} />
            ) : (
              <TaskDeck
                domain={d}
                tasks={state?.tasks.tasks ?? []}
                phase={phase}
                myStatus={state?.me.status ?? 'ACTIVE'}
                imposterLock={!!state?.game.imposterBlocksRegular && !!state?.me.activeReservationId}
                onOpen={(t) => setOverlay({ type: 'workspace', target: { type: 'TASK', id: t.id }, domain: overlay.domain })}
              />
            )}
          </ShipDialog>
        );
      }
      case 'workspace':
        if (!state) return null;
        return (
          <ShipDialog open onClose={() => setOverlay(overlay.domain !== undefined ? { type: 'tasks', domain: overlay.domain } : null)} label="Engineering terminal" wide="full" closeOnBackdrop={false} variant={overlay.target.type === 'IMPOSTER' ? 'imposter' : 'default'}>
            <Suspense fallback={<StatePanel kind="loading" title="Powering up the engineering terminal…" />}>
            <TaskWorkspace
              target={overlay.target}
              crew={{ crewId: state.identity.crewId, name: state.identity.name, color: state.identity.color }}
              wallet={state.me.wallet}
              rank={state.me.rank}
              contextLabel={`GAME ${state.game.number} · SPRINT ${state.game.currentSprint || 1}`}
              deadlineAt={state.sprint?.deadlineAt ?? null}
              paused={phase === 'PAUSED'}
              externallySolved={solvedElsewhere.has(overlay.target.id) && !(state.tasks.tasks.find((t) => t.id === overlay.target.id)?.state === 'SOLVED_BY_YOU')}
              onExit={() => setOverlay(overlay.domain !== undefined ? { type: 'tasks', domain: overlay.domain } : null)}
              onSolved={(r: { reward: number; wallet: number }) => {
                sfx.great();
                setOverlay({ type: 'success', reward: r.reward, wallet: r.wallet, beforeRank: state.me.rank, domain: overlay.domain });
                refetchSoon();
              }}
              onChanged={refetchSoon}
            />
            </Suspense>
          </ShipDialog>
        );
      case 'success':
        return (
          <ShipDialog open onClose={close} label="Task complete">
            <SolvedNotice reward={overlay.reward} wallet={state?.me.wallet ?? overlay.wallet} beforeRank={overlay.beforeRank} rank={state?.me.rank ?? null} color={identity.color} onDone={() => setOverlay(overlay.domain !== undefined ? { type: 'tasks', domain: overlay.domain } : null)} />
          </ShipDialog>
        );
      case 'imposter':
        return (
          <ShipDialog open onClose={close} label="Imposter problem" variant="imposter">
            <ImposterPanel imp={imposter} myStatus={state?.me.status ?? 'ACTIVE'} onRefresh={refetchSoon} onOpen={(id) => setOverlay({ type: 'workspace', target: { type: 'IMPOSTER', id } })} />
          </ShipDialog>
        );
      case 'closed':
        return (
          <ShipDialog open onClose={close} label="Sprint closed" variant="void">
            <SprintClosed sprint={overlay.sprint} />
          </ShipDialog>
        );
      case 'ejected':
        return (
          <ShipDialog open onClose={close} label="Crew ejected" variant="void">
            <Ejected crew={identity} rank={state?.me.rank ?? null} score={state?.me.score ?? 0} onDone={() => setOverlay({ type: 'rankings' })} />
          </ShipDialog>
        );
      case 'survived':
        return (
          <ShipDialog open onClose={close} label="Crew survived">
            <Survived crew={identity} sprint={overlay.sprint} onDone={close} />
          </ShipDialog>
        );
      case 'results':
        return (
          <ShipDialog open onClose={close} label="Final results">
            <Results rows={state?.result?.rows ?? []} prizes={state?.prizes ?? []} meCrewId={myCrewId} gameName={game?.name ?? 'Game'} />
          </ShipDialog>
        );
    }
  })();

  const statusLine = !game
    ? commander ? 'NO GAME MAPPED TO TODAY' : 'CONNECTING…'
    : phase === 'WAITING' || phase === 'DRAFT' || phase === 'READY'
      ? 'AWAITING COMMANDER ACTIVATION'
      : phase === 'WAITING_NEXT_SPRINT'
        ? 'AWAITING COMMANDER ACTIVATION · SPRINT 2'
        : phase === 'ELIMINATION_REVIEW'
          ? `SPRINT ${game.currentSprint} CLOSED · CHECKING CREW STATUS`
          : phase === 'GAME_RESULT_REVIEW'
            ? 'FINAL RESULTS UNDER REVIEW'
            : phase === 'COMPLETED'
              ? 'GAME COMPLETE'
              : null;

  const dpad = (k: string, icon: React.ReactNode, label: string) => (
    <button
      aria-label={`Move ${label}`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        engine.press(k, true);
      }}
      onPointerUp={() => engine.press(k, false)}
      onPointerCancel={() => engine.press(k, false)}
      onLostPointerCapture={() => engine.press(k, false)}
      className="flex h-10 w-10 touch-none items-center justify-center rounded-lg border-2 border-[#739897]/40 bg-[#1b3541]/90 text-[#bed9d4] active:bg-primary/20"
    >
      {icon}
    </button>
  );

  return (
    <div ref={containerRef} className="fixed inset-0 overflow-hidden bg-[#0b1923] text-[#edf0e5]" role="application" aria-label="Among Bugs spaceship exploration game">
      <div inert={overlay ? true : undefined} className={`absolute inset-0 transition-[filter,transform] duration-700 animate-[boot_1.5s_ease-out] ${overlay ? 'scale-[1.035]' : 'scale-100'}`}>
        <ShipWorld
          ref={worldRef}
          width={viewWidth}
          roomWidth={roomWidth}
          domains={stableDomains}
          standings={standings.active}
          identity={identity}
          tasksLocked={!running}
          near={engine.near}
          onInteract={approach}
          playerRef={engine.playerRef}
          walkingRef={engine.walkingRef}
          doorOpen={engine.doors}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-[#06121f]/95 via-[#091722]/60 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-[#061521]/95 to-transparent" />
      {running && (zone === 'DANGER' || (remaining !== null && remaining < 10 && phase === 'RUNNING')) && (
        <div className="pointer-events-none absolute inset-0 animate-[warning_3s_ease-in-out_infinite] bg-[#bd554d]/10 shadow-[inset_0_0_120px_#a9323830]" />
      )}

      {/* ---------------- HUD ---------------- */}
      <header inert={overlay ? true : undefined} className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 px-3 pt-3 sm:px-8 sm:pt-6">
        <button onClick={() => setOverlay({ type: 'card' })} aria-label="View access card" className="flex min-w-0 max-w-[48%] items-center gap-2 rounded-xl border border-[#9ecac1]/20 bg-[#102737]/80 p-2 pr-3 backdrop-blur sm:max-w-none sm:gap-3 sm:pr-4">
          <Crewmate color={identity.color} size={40} state="still" accessory={commander} />
          <div className="text-left">
            <div className="max-w-[140px] truncate font-display text-xs font-bold tracking-wide sm:text-sm">{identity.name}</div>
            <div className="mt-0.5 font-mono text-[8px] text-[#a3c2c3] sm:text-[9px]">{identity.crewId}</div>
            <div className="mt-1">
              {commander ? (
                <Badge>COMMANDER</Badge>
              ) : state?.me.status !== 'ACTIVE' && state ? (
                <Badge>{state.me.status === 'ELIMINATED' ? 'EJECTED' : 'DISQUALIFIED'}</Badge>
              ) : running && zone ? (
                <Badge>{`${zone} · PROVISIONAL`}</Badge>
              ) : (
                <Badge>ACTIVE</Badge>
              )}
            </div>
          </div>
        </button>

        <div className="absolute left-1/2 top-[104px] -translate-x-1/2 text-center sm:top-6">
          <Label className="!text-[8px]">
            {game ? `GAME ${game.number} · SPRINT ${String(Math.max(1, game.currentSprint)).padStart(2, '0')}${phase === 'PAUSED' ? ' · PAUSED' : ''}` : 'DEBUG + RUN'}
          </Label>
          {statusLine ? (
            <div className="mt-2 max-w-[60vw] font-display text-[10px] font-bold tracking-[.18em] text-[#e5cf8f] sm:text-xs">{statusLine}</div>
          ) : (
            <Timer seconds={remaining ?? 0} className="mt-1 block text-xl sm:text-3xl" />
          )}
          {running && zone === 'DANGER' && <Label className="mt-1 !text-[7px] !text-[#e5a18d]">⚠ IN THE EJECTION ZONE</Label>}
          <div className="mt-4 hidden items-center justify-center gap-2 sm:flex" aria-label="Ship orientation map">
            {ROOM_SHORT.map((r, i) => (
              <div key={r} className="flex items-center gap-2">
                <div className="flex flex-col items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${currentRoom === i ? 'bg-primary shadow-[0_0_8px_#8ae4cf]' : 'bg-[#547581]'}`} />
                  <span className={`font-mono text-[7px] tracking-widest ${currentRoom === i ? 'text-primary' : 'text-[#829aa8]'}`}>{r}</span>
                </div>
                {i < 3 && <span className="mb-4 h-px w-16 bg-[#547581]/40" />}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-end gap-3">
          {!commander && (
            <div className="flex items-center gap-2 rounded-xl border border-[#a6c9bc]/20 bg-[#102737]/80 px-2.5 py-2 backdrop-blur sm:gap-5 sm:px-5 sm:py-3">
              <div className="text-right">
                <Label className="hidden sm:block">CREW RANK</Label>
                <span className="mt-0.5 block font-mono text-sm text-[#ccded6]">{state?.me.rank ? `#${String(state.me.rank).padStart(2, '0')}` : '—'}</span>
              </div>
              <div className="h-6 w-px bg-[#668478]/30" />
              <div>
                <Label className="hidden sm:block">IDEACOINS</Label>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <Coin size={18} />
                  <motion.span key={state?.me.wallet} initial={{ scale: 1.16, color: '#f4d689' }} animate={{ scale: 1, color: '#dfdebf' }} className="font-mono text-sm font-semibold">
                    {(state?.me.wallet ?? 0).toLocaleString()}
                  </motion.span>
                </div>
              </div>
              {state && state.game.rankingMetric === 'NET_COINS' && state.me.score !== state.me.wallet && (
                <>
                  <div className="h-6 w-px bg-[#668478]/30" />
                  <div>
                    <Label className="hidden sm:block">SCORE</Label>
                    <span className="mt-0.5 block font-mono text-sm text-[#ccded6]">{state.me.score}</span>
                  </div>
                </>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            <span title={`Connection: ${conn}`} aria-label={`Connection ${conn}`} className={`mr-1 flex items-center gap-1 font-mono text-[8px] ${conn === 'online' ? 'text-primary' : 'text-[#e5a18d]'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${conn === 'online' ? 'bg-primary' : 'animate-pulse bg-[#e5a18d]'}`} />
              <span className="hidden sm:inline">{conn === 'online' ? 'LINKED' : 'RELINKING'}</span>
            </span>
            {[
              { icon: LayoutGrid, label: 'Open station menu', action: () => setOverlay({ type: 'menu' }) },
              { icon: Radio, label: 'Comms log', action: () => setOverlay({ type: 'comms' }) },
              { icon: muted ? VolumeX : Volume2, label: muted ? 'Unmute sound' : 'Mute sound', action: toggleMute },
              {
                icon: Maximize2,
                label: 'Toggle fullscreen',
                action: () => (document.fullscreenElement ? void document.exitFullscreen() : void containerRef.current?.requestFullscreen().catch(() => toast('Fullscreen is unavailable here.'))),
              },
              { icon: CircleHelp, label: 'Flight manual', action: () => setOverlay({ type: 'help' }) },
              { icon: LogOut, label: 'Exit ship (sign out)', action: () => void logout() },
            ].map((b) => (
              <button key={b.label} title={b.label} aria-label={b.label} onClick={b.action} className={`h-7 w-7 items-center justify-center rounded-lg border border-[#6b9292]/30 bg-[#0d2535]/70 text-[#adc8c7] transition hover:bg-[#36565e] ${['Toggle fullscreen', 'Comms log'].includes(b.label) || b.label.includes('ute sound') ? 'hidden sm:flex' : 'flex'}`}>
                <b.icon size={13} />
              </button>
            ))}
          </div>
        </div>
      </header>

      {loadError && (
        <div role="alert" className="absolute left-1/2 top-32 z-30 -translate-x-1/2 rounded-lg border border-[#c67c6b] bg-[#4e2f3b]/95 px-4 py-2 text-xs">
          {loadError} <button className="ml-2 underline" onClick={() => void fetchState()}>Retry</button>
        </div>
      )}

      <AnimatePresence>
        {claimBanner && !overlay && imposter && (
          <motion.div initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -50, opacity: 0 }} className="absolute left-1/2 top-[115px] z-30 flex w-[90%] max-w-[610px] -translate-x-1/2 items-center gap-3 rounded-xl border-2 border-[#bf7263] bg-[#542f37]/95 p-3 shadow-xl">
            <Zap size={25} className="shrink-0 text-[#f2bc94]" />
            <div className="min-w-0 flex-1">
              <div className="font-display text-xs font-bold text-[#f5d8b5]">IMPOSTER DETECTED</div>
              <p className="mt-1 text-[9px] text-[#d2adab]">
                Special problem · +{imposter.reward} IdeaCoins · {imposter.mode === 'OPEN' ? 'First correct crew wins' : 'First crew to claim wins access'}
              </p>
            </div>
            <Button danger onClick={() => setOverlay({ type: 'imposter' })} className="!px-3 !py-2 !text-[9px]">
              Investigate
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {!commander && imposter?.reservedByMe && !overlay && (
        <button onClick={() => setOverlay({ type: 'workspace', target: { type: 'IMPOSTER', id: imposter.id } })} className="absolute left-1/2 top-[115px] z-30 -translate-x-1/2 rounded-lg border-2 border-[#bf7263] bg-[#542f37]/95 px-4 py-2 font-display text-xs font-bold text-[#f5d8b5]">
          <Zap size={13} className="mr-2 inline" /> IMPOSTER PROTOCOL ACTIVE — RESUME
        </button>
      )}

      {state && state.me.status !== 'ACTIVE' && !overlay && (
        <div className="absolute left-1/2 top-36 z-20 -translate-x-1/2 rounded-lg border border-[#bd7568] bg-[#4e2f3b]/95 p-4 text-center">
          <Label className="!text-[#edb191]">{state.me.status === 'ELIMINATED' ? 'CREW EJECTED · READ-ONLY' : 'CREW DISQUALIFIED · READ-ONLY'}</Label>
          <button onClick={() => setOverlay({ type: state.me.status === 'ELIMINATED' ? 'ejected' : 'rankings' })} className="mt-2 text-xs underline">
            View final crew status
          </button>
        </div>
      )}

      {/* Bottom HUD */}
      <div className="pointer-events-none absolute bottom-8 left-8 hidden max-w-[240px] sm:block">
        <div className="mb-2 flex items-center gap-2 font-mono text-[8px] tracking-widest text-[#e5c38a]">
          <span className="h-1 w-1 rounded-full bg-[#e5c38a]" />
          {commander ? 'COMMAND DUTY' : 'YOUR MISSION'}
        </div>
        <p className="font-display text-[17px] font-semibold leading-tight text-[#dce5d7]">
          {commander ? (
            <>Swipe your card at the<br />command control panel.</>
          ) : (
            <>Find the bug.<br />Fix the code. Stay aboard.</>
          )}
        </p>
        <p className="mt-2 max-w-48 text-[10px] leading-5 text-[#8eabb4]">{ROOM_LINES[currentRoom]}</p>
      </div>
      <div className="absolute bottom-6 left-1/2 z-20 hidden -translate-x-1/2 flex-col items-center gap-3 sm:flex">
        <AnimatePresence mode="wait">
          {engine.near && !overlay && (
            <motion.button key={engine.near} initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} onClick={() => engine.interact()} className="mb-1 flex items-center gap-3 rounded-lg border-2 border-primary/40 bg-[#0e303b]/95 px-5 py-3 shadow-[0_5px_0_#071723]">
              <kbd className="rounded border border-primary/50 bg-primary/10 px-2 py-1 font-mono text-xs text-primary">E</kbd>
              <span className="font-display text-[10px] font-semibold tracking-wider">{nearLabel}</span>
            </motion.button>
          )}
        </AnimatePresence>
        <div className="flex items-center gap-5 text-[#b8cec8]">
          <div className="flex items-center gap-1">
            {['W', 'A', 'S', 'D'].map((k) => (
              <kbd key={k} className="flex h-6 w-6 items-center justify-center rounded border border-[#719093]/50 bg-[#17313e]/90 font-mono text-[10px]">
                {k}
              </kbd>
            ))}
            <span className="ml-2 text-[10px]">move</span>
          </div>
          <div className="flex items-center gap-1">
            <kbd className="flex h-6 w-6 items-center justify-center rounded border border-[#719093]/50 bg-[#17313e]/90 font-mono text-[10px]">E</kbd>
            <span className="ml-2 text-[10px]">interact</span>
          </div>
          <span className="text-[10px] text-[#7e9da9]">or scroll to explore</span>
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-8 right-8 hidden text-right sm:block">
        <Label className="!text-[#7e9faa]">YOU ARE HERE</Label>
        <div className="mt-2 flex items-center justify-end gap-2 font-display text-xs font-bold tracking-[.12em]">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          {String(currentRoom).padStart(2, '0')} / {ROOM_NAMES[currentRoom]}
        </div>
        <div className="mt-3 font-mono text-[7px] tracking-wider text-[#668594]">
          AMONG BUGS · DEBUG + RUN{(commander ? cmd?.event.isDemo : state?.event.isDemo) ? ' · DEMO EVENT' : ''}
        </div>
      </div>

      {/* Touch controls */}
      <div className="absolute bottom-5 left-5 z-30 grid grid-cols-3 gap-1 sm:hidden">
        <span />
        {dpad('w', <ArrowUp size={18} />, 'up')}
        <span />
        {dpad('a', <ArrowLeft size={18} />, 'left')}
        {dpad('s', <ArrowDown size={18} />, 'down')}
        {dpad('d', <ArrowRight size={18} />, 'right')}
      </div>
      <button onClick={() => (engine.interact() ? undefined : setOverlay({ type: 'menu' }))} className={`absolute bottom-7 right-5 z-30 flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-full border-[3px] bg-[#163644]/95 text-[#afdfd1] shadow-[0_5px_0_#071421] sm:hidden ${engine.near ? 'border-primary' : 'border-[#4e727b]'}`}>
        <span className="font-display text-xl font-bold">E</span>
        <span className="font-mono text-[7px]">INTERACT</span>
      </button>
      <div className="absolute bottom-28 left-1/2 -translate-x-1/2 text-center sm:hidden">
        <Label className="whitespace-nowrap !text-[8px] !text-primary">{nearLabel ?? ROOM_NAMES[currentRoom]}</Label>
      </div>

      {dialog}
    </div>
  );
}
