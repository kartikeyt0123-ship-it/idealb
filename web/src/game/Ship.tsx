import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CircleHelp, LayoutGrid, LogOut, Maximize2, PauseCircle, Radio, Siren, Trophy, Volume2, VolumeX, X } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessCard, Badge, Button, Coin, Crewmate, Label, ShipDialog, StatePanel, Timer, useToast } from '../components/ui';
import { api, ApiError, serverNow, syncClock, V1, type CrewIdentity, type CrewState, type DomainDto, type QuestionCard, type SprintDto } from '../lib/api';
import { useRealtime, type ConnState, type Topic } from '../lib/realtime';
import { isMuted, setMuted, sfx } from '../lib/sound';
import { BonusPanel, Comms, Ejected, FlightManual, QuestionDeck, RankingsDialog, Results, SolvedNotice, SPRINTS_PER_SLOT, SprintClosed, StationsMenu, Survived } from './Dialogs';
import { formatSlotDate } from './format';
import { DEFAULT_DOMAINS, interactables, ROOM_LINES, ROOM_NAMES, ROOM_SHORT, ShipWorld } from './ShipWorld';
import { isTypingTarget, useShipEngine } from './useShipEngine';

// Monaco is heavy: load the engineering terminal on first use.
const TaskWorkspace = lazy(() => import('../workspace').then((m) => ({ default: m.TaskWorkspace })));

type Overlay =
  | { type: 'card' }
  | { type: 'help' }
  | { type: 'rankings'; tab?: 'SPRINT' | 'SLOT' | 'OVERALL' }
  | { type: 'menu' }
  | { type: 'comms' }
  | { type: 'bonus' }
  | { type: 'tasks'; domain: number }
  | { type: 'workspace'; id: string; bonus: boolean; domain?: number }
  | { type: 'success'; reward: number; wallet: number; bonus: boolean; before: { sprintRank: number | null; slotRank: number | null }; domain?: number }
  | { type: 'closed'; sprint: number }
  | { type: 'ejected' }
  | { type: 'survived'; sprint: number }
  | { type: 'results' };

/** Errors meaning "this crew can no longer see the slot" → back to the gate (StatusScreen). */
const ACCESS_CODES = ['SLOT_UNASSIGNED', 'ACCOUNT_DISABLED', 'TEAM_DISQUALIFIED', 'TEAM_ARCHIVED', 'WRONG_SLOT'];

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

/** Sprint number the crew is waiting for (null when all four are done). */
function nextSprintNumber(currentSprint: number, sprint: SprintDto | null): number | null {
  if (!sprint || currentSprint < 1) return 1;
  if (sprint.status === 'READY') return sprint.number;
  if (sprint.status === 'CLOSED' || sprint.status === 'FINALIZED') return sprint.number < SPRINTS_PER_SLOT ? sprint.number + 1 : null;
  return null;
}

const CONN_LABEL: Record<ConnState, string> = { online: 'LINKED', connecting: 'LINKING', reconnecting: 'RELINKING', offline: 'OFFLINE' };

export function Ship({ me, onLogout, onAccessLost }: { me: CrewIdentity; onLogout: (notice?: string) => void; onAccessLost: () => void }) {
  const toast = useToast();
  const [state, setState] = useState<CrewState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [solvedElsewhere, setSolvedElsewhere] = useState<Map<string, string>>(() => new Map());
  const [bonusDismissed, setBonusDismissed] = useState('');
  const [muted, setMutedState] = useState(isMuted());
  const [now, setNow] = useState(serverNow());
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const overlayRef = useRef<Overlay | null>(null);
  overlayRef.current = overlay;
  const myCrewId = state?.identity.crewId ?? me.team.crewId;

  // ---------------- data ----------------
  const inflight = useRef<AbortController | null>(null);
  const fetchState = useCallback(async () => {
    inflight.current?.abort();
    const ac = new AbortController();
    inflight.current = ac;
    try {
      const s = await api.get<CrewState>(`${V1}/slots/mine/state`, ac.signal);
      syncClock(s.serverTime);
      setState(s);
      setLoadError(null);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      if (e instanceof ApiError) {
        if (e.status === 401) return onLogout('Your session ended. Sign in again.');
        if (ACCESS_CODES.includes(e.code)) return onAccessLost();
        setLoadError(e.message);
      } else setLoadError('Could not reach the ship server.');
    }
  }, [onLogout, onAccessLost]);

  const debounce = useRef<number | undefined>(undefined);
  const refetchSoon = useCallback(() => {
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => {
      void fetchState();
      setRefreshKey((k) => k + 1);
    }, 200);
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
      window.clearTimeout(debounce.current);
      inflight.current?.abort();
      window.removeEventListener('resize', resize);
    };
  }, [fetchState]);

  const conn = useRealtime(
    true,
    (topic: Topic, msg) => {
      refetchSoon();
      switch (topic) {
        case 'session.revoked':
          onLogout('You were signed out (signed in on too many devices, password changed, or an organizer action).');
          break;
        case 'eligibility.changed':
          onAccessLost();
          break;
        case 'team.disqualified':
          if (msg.crewId === myCrewId) onAccessLost();
          break;
        case 'sprint.started':
          sfx.alarm();
          toast(`Sprint ${msg.sprint} is live. Find the bugs!`, 'good');
          setOverlay((o) => (o && ['closed', 'survived'].includes(o.type) ? null : o));
          break;
        case 'sprint.paused':
          toast('The organizers paused the sprint. Hold position.', 'alert');
          break;
        case 'sprint.resumed':
          toast('Sprint resumed. The clock is running again.', 'good');
          break;
        case 'sprint.closed':
          sfx.alarm();
          if (msg.sprint) {
            markSeen(`ab-closed:${String(msg.slotId ?? '')}:${String(msg.sprint)}`);
            setOverlay((o) => (o?.type === 'success' ? o : { type: 'closed', sprint: Number(msg.sprint) }));
          }
          break;
        case 'question.released':
          sfx.good();
          toast(msg.type === 'RESERVE' ? `Reserve batch released${msg.count ? ` — ${msg.count} new system(s)` : ''}.` : `New systems released${msg.count ? ` — ${msg.count}` : ''}.`, 'info');
          break;
        case 'question.solved':
          if (msg.instanceId && msg.crewId !== myCrewId) setSolvedElsewhere((m) => new Map(m).set(String(msg.instanceId), `${msg.crewName ?? 'Another crew'} (${msg.crewId ?? ''})`));
          if (msg.crewId && msg.crewId !== myCrewId) toast(`${msg.crewName} ${msg.kind === 'BONUS' ? 'won the emergency bonus' : 'fixed'} ${msg.label}.`);
          break;
        case 'bonus.released':
          sfx.alarm();
          setBonusDismissed('');
          toast('IMPOSTER DETECTED — emergency bonus released! First correct answer wins.', 'alert');
          break;
        case 'announcement.created':
          sfx.alarm();
          toast(`TRANSMISSION: ${msg.message}`, msg.kind === 'ALERT' ? 'alert' : 'info');
          break;
        case 'slot.finalized':
          sfx.great();
          toast('Slot results are final.', 'good');
          break;
        case 'event.finalized':
          toast('The overall standings are now FINAL.', 'good');
          break;
        default:
          break;
      }
    },
    refetchSoon,
  );

  // ---------------- derived ----------------
  const slot = state?.slot ?? null;
  const sprint = state?.sprint ?? null;
  const domains: DomainDto[] = state?.domains?.length ? state.domains : DEFAULT_DOMAINS;
  const domainKey = domains.map((d) => `${d.slug}:${d.counts.available}:${d.counts.total}:${d.counts.solvedByYou}:${d.counts.expired}`).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableDomains = useMemo(() => domains, [domainKey]);
  const identity = { name: state?.identity.name ?? me.team.name, crewId: myCrewId, color: state?.identity.color ?? me.team.color };
  const live = !!slot && slot.phase === 'RUNNING' && !!sprint && (sprint.status === 'RUNNING' || sprint.status === 'PAUSED');
  const paused = sprint?.status === 'PAUSED';
  const remaining = sprint
    ? sprint.status === 'RUNNING' && sprint.deadlineAt
      ? Math.max(0, Math.ceil((Date.parse(sprint.deadlineAt) - now) / 1000))
      : sprint.status === 'PAUSED'
        ? (sprint.remainingSeconds ?? 0)
        : null
    : null;
  const myStatus = state?.me.status ?? 'ACTIVE';
  const readOnly = myStatus === 'ELIMINATED' ? 'Your crew was ejected from this slot. The ship is read-only.' : myStatus === 'DISQUALIFIED' ? 'Your crew was disqualified. The ship is read-only.' : null;
  const zone = state?.me.zone ?? null;
  const ended = slot?.phase === 'REVIEW' || slot?.phase === 'COMPLETED';
  const waitingFor = state && !live && !ended ? nextSprintNumber(slot!.currentSprint, sprint) : null;
  const waitingText = waitingFor ? `Waiting for the organizer to start Sprint ${waitingFor}.` : ended ? 'All four sprints are complete.' : null;
  const regularCards = useMemo(() => (state?.questions ?? []).filter((q) => q.kind !== 'BONUS'), [state?.questions]);
  const bonuses = state?.bonuses ?? [];
  const openBonuses = bonuses.filter((b) => b.state === 'AVAILABLE');
  const bonusKey = openBonuses.map((b) => b.id).join(',');
  const viewWidth = (900 * size.w) / size.h;
  const roomWidth = Math.max(1100, viewWidth);

  // Phase-driven overlays: replayed from the snapshot so a missed socket message never hides an outcome.
  useEffect(() => {
    if (!state) return;
    const k = `${state.identity.crewId}:${state.slot.id}`;
    if (state.slot.phase === 'COMPLETED' && state.result && !seen(`ab-results:${k}`)) {
      markSeen(`ab-results:${k}`);
      setOverlay((o) => (o?.type === 'workspace' ? o : { type: 'results' }));
      return;
    }
    const le = state.lastElimination;
    if (le && !seen(`ab-elim:${k}:${le.sprint}`)) {
      markSeen(`ab-elim:${k}:${le.sprint}`);
      setOverlay(le.youEliminated ? { type: 'ejected' } : { type: 'survived', sprint: le.sprint });
      return;
    }
    const sp = state.sprint;
    if (sp && (sp.status === 'CLOSED' || sp.status === 'FINALIZED') && !ended && !seen(`ab-closed:${state.slot.id}:${sp.number}`)) {
      markSeen(`ab-closed:${state.slot.id}:${sp.number}`);
      setOverlay((o) => (o?.type === 'success' ? o : { type: 'closed', sprint: sp.number }));
    }
  }, [state, ended]);

  // When the sprint stops (closed by the organizers), leave an open workspace for the "time is up" screen.
  const wasLive = useRef(live);
  useEffect(() => {
    if (wasLive.current && !live && overlayRef.current?.type === 'workspace') setOverlay(sprint ? { type: 'closed', sprint: sprint.number } : null);
    wasLive.current = live;
  }, [live, sprint]);

  // ---------------- interactions ----------------
  const onInteract = useCallback((id: string) => {
    sfx.open();
    if (id === 'command') setOverlay({ type: 'bonus' });
    else if (id === 'manifest') setOverlay({ type: 'card' });
    else if (id === 'rankings') setOverlay({ type: 'rankings' });
    else if (id.startsWith('station-')) setOverlay({ type: 'tasks', domain: Number(id.split('-')[1]) });
  }, []);

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

  function toggleMute() {
    const m = !isMuted();
    setMuted(m);
    setMutedState(m);
    if (!m) sfx.open();
  }
  const toggleMuteRef = useRef(toggleMute);
  toggleMuteRef.current = toggleMute;

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || overlayRef.current) return;
      const k = e.key.toLowerCase();
      if (k === 'e' && !e.repeat) {
        if (!engine.interact()) toast('Walk closer to a glowing station, console or crew manifest.');
      } else if (k === 'i') setOverlay({ type: 'card' });
      else if (k === 'm') toggleMuteRef.current();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [engine.interact, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = useCallback(() => setOverlay(null), []);
  const currentRoom = engine.room;
  const nearLabel = engine.near ? interactables(roomWidth, stableDomains).find((x) => x.id === engine.near)?.label : null;
  const openCard = (c: QuestionCard, domain?: number) => setOverlay({ type: 'workspace', id: c.id, bonus: c.kind === 'BONUS', domain });

  // ---------------- render: dialogs ----------------
  const dialog = (() => {
    if (!overlay) return null;
    switch (overlay.type) {
      case 'card':
        return (
          <ShipDialog open onClose={close} label="Access card">
            <div className="py-3 text-center">
              <Label className="mb-5 !text-primary">ONE CREW. ONE SHARED IDENTITY.</Label>
              <AccessCard name={identity.name} crewId={identity.crewId} color={identity.color} roleLabel={slot ? `COMPETITOR · SLOT ${slot.number}` : 'COMPETITOR'} />
              {state && <p className="mt-6 text-xs text-muted">{state.identity.members.map((m) => m.name).join(' · ')}</p>}
              {slot && <p className="mt-2 font-mono text-[10px] text-[#a9c7c4]">{[slot.name, slot.dayLabel, formatSlotDate(slot.date)].filter(Boolean).join(' · ')}</p>}
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
            <StationsMenu domains={stableDomains} bonusOpen={live ? openBonuses.length : 0} onPick={(id) => onInteract(id)} />
          </ShipDialog>
        );
      case 'comms':
        return (
          <ShipDialog open onClose={close} label="Comms log">
            <Comms items={state?.announcements ?? []} />
          </ShipDialog>
        );
      case 'bonus':
        return (
          <ShipDialog open onClose={close} label="Emergency console" variant="imposter" header="AMONG BUG / EMERGENCY CONSOLE">
            <BonusPanel bonuses={bonuses} live={live} readOnly={readOnly} onOpen={(c) => openCard(c)} />
          </ShipDialog>
        );
      case 'rankings':
        return (
          <ShipDialog open onClose={close} label="Crew rankings" wide>
            {state ? <RankingsDialog state={state} refreshKey={refreshKey} initialTab={overlay.tab} /> : <StatePanel kind="loading" title="Receiving telemetry…" />}
          </ShipDialog>
        );
      case 'tasks': {
        const d = stableDomains[overlay.domain] ?? stableDomains[0];
        return (
          <ShipDialog open onClose={close} label={`${d.name} station`}>
            <QuestionDeck domain={d} cards={regularCards.filter((q) => q.domain === d.slug)} live={live} waiting={waitingText} readOnly={readOnly} onOpen={(c) => openCard(c, overlay.domain)} />
          </ShipDialog>
        );
      }
      case 'workspace': {
        if (!state) return null;
        const back = () => setOverlay(overlay.domain !== undefined ? { type: 'tasks', domain: overlay.domain } : overlay.bonus ? { type: 'bonus' } : null);
        const card = state.questions.find((q) => q.id === overlay.id);
        const solvedBy = solvedElsewhere.get(overlay.id) ?? (card?.state === 'SOLVED' ? (card.solvedByCrew ?? 'another crew') : null);
        return (
          <ShipDialog open onClose={back} label="Engineering terminal" wide="full" closeOnBackdrop={false} variant={overlay.bonus ? 'imposter' : 'default'}>
            <Suspense fallback={<StatePanel kind="loading" title="Powering up the engineering terminal…" />}>
              <TaskWorkspace
                questionId={overlay.id}
                bonus={overlay.bonus}
                crew={identity}
                wallet={state.me.wallet}
                rank={state.me.sprintRank}
                metric={state.event.metric}
                contextLabel={`${state.slot.name.toUpperCase()} · SPRINT ${sprint?.number ?? state.slot.currentSprint}/${SPRINTS_PER_SLOT}`}
                deadlineAt={sprint?.status === 'RUNNING' ? sprint.deadlineAt : null}
                pausedRemaining={paused ? (sprint?.remainingSeconds ?? 0) : null}
                live={live}
                readOnlyReason={readOnly}
                solvedElsewhereBy={solvedBy}
                onExit={back}
                onSolved={(r) => {
                  sfx.great();
                  setOverlay({ type: 'success', reward: r.reward, wallet: r.wallet, bonus: overlay.bonus, before: { sprintRank: state.me.sprintRank, slotRank: state.me.slotRank }, domain: overlay.domain });
                  refetchSoon();
                }}
                onChanged={refetchSoon}
              />
            </Suspense>
          </ShipDialog>
        );
      }
      case 'success':
        return (
          <ShipDialog open onClose={close} label="Task complete">
            <SolvedNotice
              reward={overlay.reward}
              wallet={state?.me.wallet ?? overlay.wallet}
              bonus={overlay.bonus}
              before={overlay.before}
              after={{ sprintRank: state?.me.sprintRank ?? null, slotRank: state?.me.slotRank ?? null }}
              color={identity.color}
              onDone={() => setOverlay(overlay.domain !== undefined ? { type: 'tasks', domain: overlay.domain } : null)}
            />
          </ShipDialog>
        );
      case 'closed':
        return (
          <ShipDialog open onClose={close} label="Sprint closed" variant="void">
            <SprintClosed sprint={overlay.sprint} last={overlay.sprint >= SPRINTS_PER_SLOT} onRankings={() => setOverlay({ type: 'rankings', tab: 'SPRINT' })} />
          </ShipDialog>
        );
      case 'ejected':
        return (
          <ShipDialog open onClose={close} label="Crew ejected" variant="void">
            <Ejected crew={identity} rank={state?.me.slotRank ?? null} score={state?.me.cumulative ?? 0} onDone={() => setOverlay({ type: 'rankings', tab: 'SLOT' })} />
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
          <ShipDialog open onClose={close} label="Slot results">
            <Results result={state?.result?.rows ?? null} fallback={state?.leaderboards.slot.rows ?? []} meCrewId={myCrewId} slotName={slot?.name ?? 'Slot'} completed={slot?.phase === 'COMPLETED'} />
            <div className="mt-6 flex justify-center">
              <Button secondary onClick={() => setOverlay({ type: 'rankings', tab: 'OVERALL' })}>
                Overall standings <Trophy size={14} />
              </Button>
            </div>
          </ShipDialog>
        );
    }
  })();

  // ---------------- render: HUD pieces ----------------
  const statusLine = !state
    ? 'CONNECTING…'
    : slot?.phase === 'COMPLETED'
      ? 'SLOT COMPLETE · RESULTS FINAL'
      : slot?.phase === 'REVIEW'
        ? 'ALL SPRINTS COMPLETE · RESULTS UNDER REVIEW'
        : live
          ? null
          : waitingFor
            ? sprint && (sprint.status === 'CLOSED' || sprint.status === 'FINALIZED')
              ? `SPRINT ${sprint.number} CLOSED · WAITING FOR THE ORGANIZER TO START SPRINT ${waitingFor}`
              : `WAITING FOR THE ORGANIZER TO START SPRINT ${waitingFor}`
            : 'ALL SPRINTS COMPLETE';

  const rankText = (r: number | null | undefined) => (r ? `#${String(r).padStart(2, '0')}` : '—');
  const stat = (label: string, value: ReactNode, extra = '') => (
    <div className={`min-w-0 text-right ${extra}`}>
      <Label className="!text-[7px] sm:!text-[8px]">{label}</Label>
      <div className="mt-0.5 font-mono text-xs text-[#ccded6] sm:text-sm">{value}</div>
    </div>
  );
  const divider = <div className="h-6 w-px shrink-0 bg-[#668478]/30" />;
  const stats = (
    <>
      {stat('SPRINT', (state?.me.sprintScore ?? 0).toLocaleString())}
      {divider}
      {stat('TOTAL', (state?.me.cumulative ?? 0).toLocaleString())}
      {divider}
      <div className="min-w-0">
        <Label className="!text-[7px] sm:!text-[8px]">IDEACOINS</Label>
        <div className="mt-0.5 flex items-center gap-1.5">
          <Coin size={16} />
          <motion.span key={state?.me.wallet} initial={{ scale: 1.16, color: '#f4d689' }} animate={{ scale: 1, color: '#dfdebf' }} className="font-mono text-xs font-semibold sm:text-sm">
            {(state?.me.wallet ?? 0).toLocaleString()}
          </motion.span>
        </div>
      </div>
      {divider}
      {stat('SPRINT RANK', rankText(state?.me.sprintRank))}
      {divider}
      {stat('SLOT RANK', <>{rankText(state?.me.slotRank)}<span className="text-[10px] text-muted">/{state?.me.activeCount ?? '—'}</span></>)}
    </>
  );

  const dpad = (k: string, icon: ReactNode, label: string) => (
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

  const showBonusBanner = live && !readOnly && openBonuses.length > 0 && !overlay && bonusDismissed !== bonusKey;

  return (
    <div ref={containerRef} className="fixed inset-0 overflow-hidden bg-[#0b1923] text-[#edf0e5]" role="application" aria-label={`${state?.event.name ?? 'AMONG BUG'} spaceship`}>
      <div inert={overlay ? true : undefined} className={`absolute inset-0 transition-[filter,transform] duration-700 animate-[boot_1.5s_ease-out] ${overlay ? 'scale-[1.035]' : 'scale-100'}`}>
        <ShipWorld
          ref={worldRef}
          width={viewWidth}
          roomWidth={roomWidth}
          domains={stableDomains}
          standings={state?.leaderboards.slot.rows ?? []}
          identity={identity}
          tasksLocked={!live}
          bonusAlert={live && openBonuses.length > 0}
          near={engine.near}
          onInteract={approach}
          playerRef={engine.playerRef}
          walkingRef={engine.walkingRef}
          doorOpen={engine.doors}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-[#06121f]/95 via-[#091722]/60 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-[#061521]/95 to-transparent" />
      {live && (zone === 'DANGER' || (remaining !== null && remaining < 10 && !paused)) && (
        <div className="pointer-events-none absolute inset-0 animate-[warning_3s_ease-in-out_infinite] bg-[#bd554d]/10 shadow-[inset_0_0_120px_#a9323830]" />
      )}

      {/* ---------------- HUD ---------------- */}
      <header inert={overlay ? true : undefined} className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 px-3 pt-3 sm:px-8 sm:pt-6">
        <button onClick={() => setOverlay({ type: 'card' })} aria-label="View access card" className="flex min-w-0 max-w-[55%] items-center gap-2 rounded-xl border border-[#9ecac1]/20 bg-[#102737]/80 p-2 pr-3 backdrop-blur sm:max-w-none sm:gap-3 sm:pr-4">
          <Crewmate color={identity.color} size={36} state="still" />
          <div className="min-w-0 text-left">
            <div className="max-w-[140px] truncate font-display text-xs font-bold tracking-wide sm:text-sm">{identity.name}</div>
            <div className="mt-0.5 font-mono text-[8px] text-[#a3c2c3] sm:text-[9px]">{identity.crewId}</div>
            <div className="mt-1">
              {state && myStatus !== 'ACTIVE' ? (
                <Badge>{myStatus === 'ELIMINATED' ? 'EJECTED' : 'DISQUALIFIED'}</Badge>
              ) : live && zone ? (
                <Badge>{`${zone} · PROVISIONAL`}</Badge>
              ) : (
                <Badge>ACTIVE</Badge>
              )}
            </div>
          </div>
        </button>

        <div className="absolute left-1/2 top-[118px] w-[min(92vw,560px)] -translate-x-1/2 text-center sm:top-6 sm:w-[min(46vw,560px)]">
          <Label className="!text-[8px]">
            {slot ? [slot.name, slot.dayLabel, formatSlotDate(slot.date)].filter(Boolean).join(' · ').toUpperCase() : 'AMONG BUG'}
          </Label>
          {slot && (
            <div className="mt-1 font-display text-[11px] font-bold tracking-[.2em] text-[#bfe3d6]">
              SPRINT S{Math.max(1, sprint?.number ?? slot.currentSprint)}/{SPRINTS_PER_SLOT}
              {paused ? ' · PAUSED' : ''}
            </div>
          )}
          {statusLine ? (
            <div className="mx-auto mt-2 max-w-[90vw] font-display text-[10px] font-bold tracking-[.16em] text-[#e5cf8f] sm:text-xs">{statusLine}</div>
          ) : paused ? (
            <div className="mt-1 flex items-center justify-center gap-2">
              <PauseCircle size={20} className="text-[#ebd68c]" />
              <Timer seconds={remaining ?? 0} className="block text-xl !text-[#ebd68c] sm:text-3xl" />
            </div>
          ) : (
            <Timer seconds={remaining ?? 0} className="mt-1 block text-xl sm:text-3xl" />
          )}
          {ended && !overlay && (
            <button onClick={() => setOverlay({ type: 'results' })} className="mt-2 rounded-md border border-[#e5cf8f]/40 bg-[#3a3a33]/70 px-3 py-1 font-display text-[10px] font-bold tracking-wider text-[#e9d6a0] hover:bg-[#4a4a3f]">
              <Trophy size={11} className="mr-1 inline" /> VIEW SLOT RESULTS
            </button>
          )}
          {live && zone === 'DANGER' && <Label className="mt-1 !text-[7px] !text-[#e5a18d]">⚠ IN THE ELIMINATION ZONE</Label>}
          <div className="mt-4 hidden items-center justify-center gap-2 lg:flex" aria-label="Ship orientation map">
            {ROOM_SHORT.map((r, i) => (
              <div key={r} className="flex items-center gap-2">
                <div className="flex flex-col items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${currentRoom === i ? 'bg-primary shadow-[0_0_8px_#8ae4cf]' : 'bg-[#547581]'}`} />
                  <span className={`font-mono text-[7px] tracking-widest ${currentRoom === i ? 'text-primary' : 'text-[#829aa8]'}`}>{r}</span>
                </div>
                {i < 3 && <span className="mb-4 h-px w-12 bg-[#547581]/40" />}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-end gap-3">
          <button onClick={() => setOverlay({ type: 'rankings' })} aria-label="Open rankings" className="hidden items-center gap-3 rounded-xl border border-[#a6c9bc]/20 bg-[#102737]/80 px-4 py-2.5 text-left backdrop-blur hover:border-primary/40 sm:flex">
            {stats}
          </button>
          <div className="flex items-center gap-2">
            <span title={`Connection: ${conn}`} aria-label={`Connection ${conn}`} className={`mr-1 flex items-center gap-1 font-mono text-[8px] ${conn === 'online' ? 'text-primary' : 'text-[#e5a18d]'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${conn === 'online' ? 'bg-primary' : 'animate-pulse bg-[#e5a18d]'}`} />
              <span className="hidden sm:inline">{CONN_LABEL[conn]}</span>
            </span>
            {[
              { icon: LayoutGrid, label: 'Open station menu', action: () => setOverlay({ type: 'menu' }), always: true },
              { icon: Trophy, label: 'Crew rankings', action: () => setOverlay({ type: 'rankings' }), always: true },
              { icon: Radio, label: 'Comms log', action: () => setOverlay({ type: 'comms' }), always: false },
              { icon: muted ? VolumeX : Volume2, label: muted ? 'Unmute sound' : 'Mute sound', action: toggleMute, always: false },
              {
                icon: Maximize2,
                label: 'Toggle fullscreen',
                action: () => (document.fullscreenElement ? void document.exitFullscreen() : void containerRef.current?.requestFullscreen().catch(() => toast('Fullscreen is unavailable here.'))),
                always: false,
              },
              { icon: CircleHelp, label: 'Flight manual', action: () => setOverlay({ type: 'help' }), always: true },
              { icon: LogOut, label: 'Exit ship (sign out)', action: () => onLogout(), always: true },
            ].map((b) => (
              <button key={b.label} title={b.label} aria-label={b.label} onClick={b.action} className={`h-7 w-7 items-center justify-center rounded-lg border border-[#6b9292]/30 bg-[#0d2535]/70 text-[#adc8c7] transition hover:bg-[#36565e] ${b.always ? 'flex' : 'hidden sm:flex'}`}>
                <b.icon size={13} />
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Mobile stats strip */}
      <button inert={overlay ? true : undefined} onClick={() => setOverlay({ type: 'rankings' })} aria-label="Open rankings" className="absolute inset-x-3 top-[70px] z-20 flex items-center justify-between gap-2 rounded-xl border border-[#a6c9bc]/20 bg-[#102737]/85 px-3 py-1.5 backdrop-blur sm:hidden">
        {stats}
      </button>

      {loadError && (
        <div role="alert" className="absolute left-1/2 top-48 z-30 w-[90%] max-w-md -translate-x-1/2 rounded-lg border border-[#c67c6b] bg-[#4e2f3b]/95 px-4 py-2 text-center text-xs">
          {loadError}{' '}
          <button className="ml-2 underline" onClick={() => void fetchState()}>
            Retry
          </button>
        </div>
      )}

      <AnimatePresence>
        {showBonusBanner && (
          <motion.div
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -50, opacity: 0 }}
            role="alert"
            className="absolute left-1/2 top-[190px] z-30 flex w-[92%] max-w-[620px] -translate-x-1/2 items-center gap-3 rounded-xl border-2 border-[#bf7263] bg-[#542f37]/95 p-3 shadow-xl sm:top-[150px]"
          >
            <Siren size={25} className="shrink-0 animate-pulse text-[#f2bc94]" />
            <div className="min-w-0 flex-1">
              <div className="font-display text-xs font-bold text-[#f5d8b5]">IMPOSTER DETECTED — EMERGENCY BONUS</div>
              <p className="mt-1 text-[10px] text-[#d2adab]">
                {openBonuses.length === 1 ? `${openBonuses[0].title} · +${openBonuses[0].reward} IdeaCoins` : `${openBonuses.length} bonus problems open · up to +${Math.max(...openBonuses.map((b) => b.reward))} IdeaCoins`} · open to every crew · first correct answer wins
              </p>
            </div>
            <Button danger onClick={() => (openBonuses.length === 1 ? openCard(openBonuses[0]) : setOverlay({ type: 'bonus' }))} className="!px-3 !py-2 !text-[9px]">
              Investigate
            </Button>
            <button aria-label="Dismiss bonus alert" onClick={() => setBonusDismissed(bonusKey)} className="rounded p-1 text-[#d2adab] hover:bg-white/10">
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {state && readOnly && !overlay && (
        <div className="absolute left-1/2 top-[190px] z-20 -translate-x-1/2 rounded-lg border border-[#bd7568] bg-[#4e2f3b]/95 p-4 text-center sm:top-36">
          <Label className="!text-[#edb191]">{myStatus === 'ELIMINATED' ? 'CREW EJECTED · READ-ONLY' : 'CREW DISQUALIFIED · READ-ONLY'}</Label>
          <button onClick={() => setOverlay(myStatus === 'ELIMINATED' ? { type: 'ejected' } : { type: 'rankings', tab: 'SLOT' })} className="mt-2 text-xs underline">
            View crew status
          </button>
        </div>
      )}

      {/* Bottom HUD */}
      <div className="pointer-events-none absolute bottom-8 left-8 hidden max-w-[260px] sm:block">
        <div className="mb-2 flex items-center gap-2 font-mono text-[8px] tracking-widest text-[#e5c38a]">
          <span className="h-1 w-1 rounded-full bg-[#e5c38a]" />
          YOUR MISSION
        </div>
        <p className="font-display text-[17px] font-semibold leading-tight text-[#dce5d7]">
          {live ? (
            <>
              Find the bug.
              <br />
              Fix the code first.
            </>
          ) : waitingFor ? (
            <>
              Stand by in the lobby.
              <br />
              Sprint {waitingFor} starts soon.
            </>
          ) : (
            <>
              Mission complete.
              <br />
              Check the rankings.
            </>
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
          {[state?.event.name ?? 'AMONG BUG', state?.event.edition].filter(Boolean).join(' · ').toUpperCase()}
          {state?.event.isDemo ? ' · DEMO EVENT' : ''}
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
