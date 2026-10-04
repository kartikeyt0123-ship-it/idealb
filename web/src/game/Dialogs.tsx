import { motion } from 'motion/react';
import { ArrowRight, CheckCircle2, CreditCard, LoaderCircle, Lock, LockKeyhole, Radio, Shield, Trophy, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, newKey, serverNow, type Announcement, type DomainDto, type ImposterDto, type ParticipantState, type ResultRow, type Standing, type TaskCard } from '../lib/api';
import { AccessCard, Badge, Button, Coin, Crewmate, Label, Timer } from '../components/ui';
import { sfx } from '../lib/sound';

// ---------------------------------------------------------------------------
// Station → task list
// ---------------------------------------------------------------------------

export function TaskDeck({ domain, tasks, phase, myStatus, imposterLock, onOpen }: {
  domain: DomainDto;
  tasks: TaskCard[];
  phase: string;
  myStatus: string;
  imposterLock: boolean;
  onOpen: (t: TaskCard) => void;
}) {
  const list = tasks.filter((t) => t.domain === domain.slug);
  const running = phase === 'RUNNING' || phase === 'PAUSED';
  return (
    <>
      <div className="mb-6 flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl border-2 border-[#577586] bg-[#14323e] font-mono text-2xl" style={{ color: domain.color }}>
          {domain.symbol}
        </div>
        <div>
          <Label>{`${domain.room} PROGRAMMING TERMINAL`}</Label>
          <h2 className="mt-1 font-display text-2xl font-bold">{domain.name}</h2>
        </div>
      </div>
      <p className="mb-5 text-xs text-muted">
        Every crew can open these systems. The first crew whose repair is verified by the ship server wins the IdeaCoins — opening a task never reserves it.
      </p>
      {!running && (
        <p className="mb-4 rounded-lg border border-[#e5cf8f]/30 bg-[#e5cf8f]/10 p-3 text-xs text-[#e9d6a0]">
          {phase === 'WAITING' || phase === 'WAITING_NEXT_SPRINT' ? 'Systems are sealed until the commander activates the sprint.' : 'The sprint is closed. Systems are read-only.'}
        </p>
      )}
      {myStatus !== 'ACTIVE' && <p className="mb-4 rounded-lg border border-[#c67c6b]/40 bg-[#4e2f3b]/60 p-3 text-xs text-[#f3c3ae]">Your crew was ejected from this game. Repairs are disabled.</p>}
      {imposterLock && <p className="mb-4 rounded-lg border border-[#c67c6b]/40 bg-[#4e2f3b]/60 p-3 text-xs text-[#f3c3ae]">Your crew holds an imposter protocol. Regular repairs are locked until it ends.</p>}
      {list.length === 0 && <p className="text-sm text-muted">No systems are assigned to this station in the current sprint.</p>}
      <div className="space-y-3">
        {list.map((t) => (
          <div key={t.id} className="rounded-lg border-2 border-[#365463] bg-[#142d39] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Label>{t.label}</Label>
                <h3 className="mt-1 text-sm font-medium">{t.title ?? 'Classified system'}</h3>
              </div>
              <div className="flex items-center gap-3">
                <Badge>{t.difficulty}</Badge>
                <span className="flex items-center gap-1.5 font-mono text-xs text-[#e8cf8e]">
                  <Coin size={15} />
                  {t.reward}
                </span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{t.state === 'SOLVED_BY_YOU' ? 'SOLVED · YOU' : t.state}</Badge>
                <span className="text-[9px] text-muted">
                  {t.state === 'LOCKED'
                    ? t.releaseInSeconds
                      ? `Releases in ${Math.floor(t.releaseInSeconds / 60)}m ${t.releaseInSeconds % 60}s`
                      : 'Sealed until release'
                    : t.state === 'AVAILABLE'
                      ? `Open to every crew · hint ${t.hintCost} IdeaCoins${t.hintUnlocked ? ' (unlocked)' : ''}`
                      : t.state === 'SOLVED_BY_YOU'
                        ? 'Your crew ejected this bug'
                        : t.state === 'SOLVED'
                          ? `Repaired by ${t.solvedByCrew}`
                          : t.state === 'CLOSED'
                            ? 'Repair window closed'
                            : 'Commander disabled this system'}
                </span>
              </div>
              <Button disabled={t.state === 'LOCKED' || t.state === 'DISABLED' || myStatus !== 'ACTIVE'} onClick={() => onOpen(t)} className="!px-3 !py-2" secondary={t.state !== 'AVAILABLE'}>
                {t.state === 'AVAILABLE' ? 'Begin repair' : 'Open task'}
                {t.state === 'LOCKED' ? <LockKeyhole size={12} /> : <ArrowRight size={12} />}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Rankings
// ---------------------------------------------------------------------------

export function RankingsList({ active, inactive, meCrewId, metric, eliminateCount, live }: { active: Standing[]; inactive: Standing[]; meCrewId?: string; metric: string; eliminateCount: number | null; live: boolean }) {
  const [tab, setTab] = useState<'ACTIVE' | 'OUT'>('ACTIVE');
  const rows = tab === 'ACTIVE' ? active : inactive;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2" role="tablist">
          {(['ACTIVE', 'OUT'] as const).map((t) => (
            <Button key={t} secondary={tab !== t} onClick={() => setTab(t)} className="!px-3 !py-2 !text-[9px]">
              {t === 'ACTIVE' ? `ACTIVE CREWS (${active.length})` : `EJECTED / OUT (${inactive.length})`}
            </Button>
          ))}
        </div>
        <Label>SCORE = {metric === 'NET_COINS' ? 'NET IDEACOINS (EARNED − SPENT)' : 'GROSS IDEACOINS EARNED'}</Label>
      </div>
      <div className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-muted">No crews here.</p>}
        {rows.map((e) => (
          <motion.div layout key={e.crewId} className={`flex items-center gap-3 rounded-lg border-2 px-4 py-3 ${e.crewId === meCrewId ? 'border-primary/40 bg-primary/10' : 'border-[#304b58] bg-[#112733]'}`}>
            <span className="w-8 font-mono text-sm text-[#8db4b7]">{e.rank ? String(e.rank).padStart(2, '0') : '—'}</span>
            <Crewmate color={e.color} size={34} state={e.status === 'ACTIVE' ? 'still' : 'warning'} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">
                {e.name} {e.crewId === meCrewId && <span className="ml-1 text-[9px] text-primary">YOU</span>}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[9px] text-[#90b1b5]">
                {e.crewId} · {e.tasksSolved} repairs · earned {e.earned} · spent {e.spent}
                {e.status !== 'ACTIVE' && <Badge>{e.status === 'ELIMINATED' ? `EJECTED S${e.eliminatedSprint ?? ''}` : e.status}</Badge>}
                {live && e.zone && <Badge>{`${e.zone} · PROVISIONAL`}</Badge>}
              </div>
            </div>
            <Coin size={15} />
            <span className="font-mono text-sm">{e.score.toLocaleString()}</span>
          </motion.div>
        ))}
      </div>
      {live && eliminateCount !== null && (
        <p className="mt-5 text-center text-[11px] text-muted">
          Bottom {eliminateCount} crew{eliminateCount === 1 ? '' : 's'} at sprint close will be ejected. Zones are provisional until the sprint closes; ties at the cutoff are settled by a published organizer decision.
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Flight manual
// ---------------------------------------------------------------------------

export function FlightManual({ state }: { state: ParticipantState | null }) {
  const k1 = state?.sprints?.[0]?.eliminateCount;
  const k2 = state?.sprints?.[1]?.eliminateCount;
  return (
    <>
      <Label className="!text-primary">FLIGHT MANUAL / 01</Label>
      <h2 className="mt-2 font-display text-3xl font-bold">The ship is your interface.</h2>
      <p className="my-5 text-sm leading-7 text-muted">
        Walk through the doors. Approach a machine. Press{' '}
        <kbd className="rounded border border-primary/40 bg-primary/10 px-2 text-primary">E</kbd> to use it. You can also click a machine and your crewmate will walk to it, or open the
        Stations menu in the top bar.
      </p>
      <div className="space-y-3">
        {[
          ['WASD / ARROWS', 'Move around the deck'],
          ['SCROLL / TRACKPAD', 'Walk left and right'],
          ['E', 'Interact with a nearby machine'],
          ['I', 'Show your team’s access card'],
          ['M', 'Mute or unmute sound cues'],
          ['ESC', 'Exit the current terminal'],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between rounded border border-[#3c5c69] bg-[#16313d] p-3 text-xs">
            <span className="font-mono text-primary">{k}</span>
            <span className="text-muted">{v}</span>
          </div>
        ))}
      </div>
      <div className="mt-6 space-y-2 text-xs leading-6 text-muted">
        <p>
          Open any system, repair it and verify. The first crew whose fix is accepted by the ship server earns the reward; other crews then see the system as repaired. Wrong answers keep it open
          for everyone. Running code never awards coins.
        </p>
        <p>Hints cost IdeaCoins{state?.game.rankingMetric === 'NET_COINS' ? ' and lower your score (score = earned − spent)' : ''}. A purchased hint is visible on every device of your crew.</p>
        <p>
          Each game has two sprints. {k1 !== undefined && k1 !== null ? `The bottom ${k1} crew(s) are ejected after Sprint 1` : 'Ejections after Sprint 1'}
          {k2 !== undefined && k2 !== null ? ` and the bottom ${k2} after Sprint 2` : ''}. Between sprints everyone waits in the lobby until the commander activates the next one.
        </p>
        <p>Imposter problems are emergency bonuses: in claim mode the first crew to claim gets exclusive access for a limited time.</p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Command card reader (swipe). The animation is presentation; the server decides.
// ---------------------------------------------------------------------------

export function CardReader({ identity, onGranted, onDenied }: { identity: { name: string; crewId: string; color: string; commander: boolean }; onGranted: () => void; onDenied: () => void }) {
  const [phase, setPhase] = useState<'READY' | 'SCANNING' | 'GRANTED' | 'DENIED' | 'ERROR'>('READY');
  const [drag, setDrag] = useState(0);
  const [err, setErr] = useState('');
  const start = useRef<number | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => void (mounted.current = false);
  }, []);

  async function swipe() {
    if (phase !== 'READY') return;
    setPhase('SCANNING');
    sfx.card();
    const minAnim = new Promise((r) => setTimeout(r, 900));
    try {
      await api.post('/api/command/authorize', {});
      await minAnim;
      if (!mounted.current) return;
      setPhase('GRANTED');
      sfx.great();
      setTimeout(() => mounted.current && onGranted(), 800);
    } catch (e) {
      await minAnim;
      if (!mounted.current) return;
      if (e instanceof ApiError && (e.status === 403 || e.status === 401)) {
        setPhase('DENIED');
        sfx.bad();
        // Close the reader and return to the safe lobby. No privileged data was requested.
        setTimeout(() => mounted.current && onDenied(), 2400);
      } else {
        setErr(e instanceof ApiError ? e.message : 'Reader offline.');
        setPhase('ERROR');
      }
    }
  }

  const color = phase === 'DENIED' ? 'border-[#ce7869]' : phase === 'GRANTED' ? 'border-primary' : 'border-[#60868d]';
  return (
    <div className="text-center">
      <Label className="!text-[#dec18a]">COMMAND AUTHENTICATION</Label>
      <h2 className="my-3 font-display text-2xl font-bold">
        {phase === 'READY' ? 'Swipe your ID card.' : phase === 'SCANNING' ? 'Scanning crew identity…' : phase === 'GRANTED' ? 'ACCESS GRANTED' : phase === 'DENIED' ? 'ACCESS DENIED' : 'Reader error'}
      </h2>
      <div ref={track} className={`relative mx-auto my-7 h-28 max-w-sm overflow-hidden rounded-xl border-[5px] bg-[#0b1e2a] ${color}`}>
        <div className="absolute inset-x-7 top-12 h-4 rounded bg-black shadow-[0_1px_0_#71949b]" />
        <div className={`absolute right-3 top-3 h-3 w-3 rounded-full ${phase === 'DENIED' ? 'bg-[#f49386]' : phase === 'GRANTED' ? 'bg-primary' : 'bg-[#e3c083]'}`} />
        <Label className="absolute inset-x-0 bottom-3">{phase === 'READY' ? 'DRAG THE CARD THROUGH THE SLOT' : phase}</Label>
        {phase === 'READY' && (
          <div
            role="slider"
            aria-label="Drag card through reader"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(drag)}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                void swipe();
              }
            }}
            onPointerDown={(e) => {
              start.current = e.clientX;
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (start.current === null) return;
              const w = track.current?.clientWidth ?? 300;
              setDrag(Math.max(0, Math.min(100, ((e.clientX - start.current) / (w - 100)) * 100)));
            }}
            onPointerUp={() => {
              start.current = null;
              if (drag > 70) void swipe();
              setDrag(0);
            }}
            className="absolute left-2 top-6 h-14 w-24 cursor-grab touch-none rounded border-2 border-primary bg-[#28606a] shadow-lg active:cursor-grabbing"
            style={{ transform: `translateX(${drag * 2.2}px) rotate(6deg)` }}
          >
            <CreditCard size={18} className="m-2 text-primary" />
          </div>
        )}
        {phase === 'SCANNING' && <motion.div initial={{ x: -300 }} animate={{ x: 340 }} transition={{ duration: 0.9 }} className="absolute left-0 top-6 h-14 w-24 rotate-6 rounded border-2 border-primary bg-[#28606a]" />}
      </div>
      {phase === 'DENIED' ? (
        <motion.div animate={{ x: [0, -6, 6, -3, 3, 0] }}>
          <Crewmate color={identity.color} state="warning" size={65} className="mx-auto mb-4" />
          <Badge>COMMANDER CLEARANCE REQUIRED</Badge>
          <p className="my-5 text-xs text-muted">This cockpit is above your pay grade, crewmate. Returning you to the lobby…</p>
        </motion.div>
      ) : phase === 'GRANTED' ? (
        <div className="my-8 font-display text-xl text-primary">Welcome, commander.</div>
      ) : phase === 'ERROR' ? (
        <>
          <p className="my-4 text-xs text-[#f3b399]">{err}</p>
          <Button secondary onClick={() => setPhase('READY')}>Try again</Button>
        </>
      ) : (
        <>
          <motion.div animate={{ y: phase === 'SCANNING' ? -20 : 0, opacity: phase === 'SCANNING' ? 0.5 : 1 }} className="mx-auto w-fit">
            <AccessCard name={identity.name} crewId={identity.crewId} color={identity.color} commander={identity.commander} small />
          </motion.div>
          <Button disabled={phase !== 'READY'} onClick={() => void swipe()} className="mt-6" ariaLabel="Swipe ID card">
            <CreditCard size={16} />
            {phase === 'SCANNING' ? 'Scanning…' : 'Swipe card'}
          </Button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Imposter
// ---------------------------------------------------------------------------

export function ImposterPanel({ imp, myStatus, onOpen, onRefresh }: { imp: ImposterDto | null; myStatus: string; onOpen: (id: string) => void; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 500);
    return () => clearInterval(t);
  }, []);
  const claimLeft = imp?.claimDeadlineAt ? Math.max(0, Math.ceil((Date.parse(imp.claimDeadlineAt) - serverNow()) / 1000)) : 0;
  const openLeft = imp?.openDeadlineAt ? Math.max(0, Math.ceil((Date.parse(imp.openDeadlineAt) - serverNow()) / 1000)) : 0;
  async function claim() {
    if (!imp) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.post(`/api/game/imposter/${imp.id}/reserve`, {}, newKey('imp'));
      sfx.great();
      onRefresh();
      onOpen(imp.id);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Claim failed.');
      sfx.bad();
      onRefresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="py-5 text-center">
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full border-[5px] border-[#876159] bg-[#af5754] shadow-[0_5px_0_#271d27]">
        <Zap size={36} />
      </div>
      <Label className="!text-[#f0af92]">EMERGENCY BROADCAST</Label>
      <h2 className="my-3 font-display text-3xl font-bold">IMPOSTER PROBLEM</h2>
      <p className="my-3 text-sm text-muted">{imp?.title ?? 'All systems clear. Stay alert.'}</p>
      {imp && (
        <>
          <div className="my-5 flex items-center justify-center gap-3">
            <Badge>{imp.difficulty}</Badge>
            <span className="flex items-center gap-2 font-mono text-lg text-[#e9ce91]">
              <Coin size={23} />
              {imp.reward}
            </span>
          </div>
          {imp.mode === 'OPEN' && imp.status === 'OFFERED' ? (
            <>
              <Label>OPEN TO ALL CREWS · FIRST CORRECT WINS</Label>
              <Timer seconds={openLeft} className="my-3 block text-4xl" />
              <Button danger disabled={myStatus !== 'ACTIVE' || openLeft === 0} onClick={() => onOpen(imp.id)}>
                Investigate <Zap size={14} />
              </Button>
            </>
          ) : imp.status === 'OFFERED' && imp.claimOpen ? (
            <>
              <Label>CLAIM WINDOW</Label>
              <Timer seconds={claimLeft} className="my-3 block text-4xl" />
              <p className="my-4 text-xs text-muted">The first crew to claim wins exclusive access for a limited time. While you hold it, your regular repairs are paused.</p>
              <Button danger disabled={busy || claimLeft === 0 || myStatus !== 'ACTIVE'} onClick={() => void claim()}>
                {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Zap size={14} />}
                Claim imposter problem
              </Button>
            </>
          ) : imp.reservedByMe ? (
            <Button danger onClick={() => onOpen(imp.id)}>
              Resume imposter protocol
            </Button>
          ) : (
            <>
              <h3 className="mt-6 font-display text-2xl text-[#f1b295]">{imp.status === 'SOLVED' ? 'IMPOSTER ELIMINATED' : imp.status === 'RESERVED' ? 'TOO LATE!' : 'SIGNAL LOST'}</h3>
              <p className="my-3 text-xs text-muted">
                {imp.status === 'SOLVED' ? `Eliminated by ${imp.solvedBy ?? 'another crew'}.` : imp.status === 'RESERVED' ? 'Another crew has claimed this imposter problem.' : 'This imposter window has expired.'}
              </p>
            </>
          )}
          {msg && <p role="alert" className="mt-4 text-xs text-[#f3b399]">{msg}</p>}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sprint outcomes
// ---------------------------------------------------------------------------

export function SprintClosed({ sprint }: { sprint: number }) {
  return (
    <div className="py-20 text-center">
      <LoaderCircle size={40} className="mx-auto mb-7 animate-spin text-[#e3bd86]" />
      <Label>SPRINT {String(sprint).padStart(2, '0')} COMPLETE</Label>
      <h2 className="mt-4 font-display text-2xl font-bold">CHECKING CREW STATUS…</h2>
      <p className="mt-5 text-xs text-muted">Standings are frozen. Remain calm, crewmate — the commander is reviewing ejections.</p>
    </div>
  );
}

export function Ejected({ crew, rank, score, onDone }: { crew: { crewId: string; name: string; color: string }; rank: number | null; score: number; onDone: () => void }) {
  const [skip, setSkip] = useState(false);
  return (
    <div className="relative overflow-hidden py-8 text-center">
      {!skip && (
        <div className="pointer-events-none absolute inset-x-0 top-6 h-32">
          <div className="absolute left-1/2 top-0 animate-[eject-fly_5s_linear_forwards]">
            <Crewmate color={crew.color} size={90} state="still" />
          </div>
        </div>
      )}
      <div className={skip ? '' : 'pt-36'}>
        {skip && <Crewmate color={crew.color} size={110} state="ejected" className="mx-auto mb-8" />}
        <Label>{crew.crewId}</Label>
        <h2 className="my-4 font-display text-4xl font-bold">{crew.name} WAS EJECTED.</h2>
        <p className="my-4 text-sm text-muted">Your crew is out of this game. The ship stays visible in read-only mode.</p>
        <p className="my-6 font-mono text-xs text-[#d6e9e0]">
          FINAL RANK {rank ? `#${rank}` : '—'} / {score} IDEACOINS
        </p>
        <div className="flex justify-center gap-3">
          {!skip && (
            <Button secondary onClick={() => setSkip(true)}>
              Skip animation
            </Button>
          )}
          <Button onClick={onDone}>
            View crew rankings <Trophy size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Survived({ crew, sprint, onDone }: { crew: { color: string }; sprint: number; onDone: () => void }) {
  return (
    <div className="py-8 text-center">
      <Crewmate color={crew.color} size={110} state="celebrating" className="mx-auto mb-7" />
      <Label className="!text-primary">SPRINT {sprint} COMPLETE / CREW STATUS VERIFIED</Label>
      <h2 className="my-4 font-display text-4xl font-bold text-primary">YOU SURVIVED.</h2>
      <p className="my-5 text-sm text-muted">{sprint === 1 ? 'Wait in the lobby — the commander will activate the next sprint.' : 'Final standings are under review.'}</p>
      <Button onClick={onDone}>
        Return to the ship <ArrowRight size={14} />
      </Button>
    </div>
  );
}

export function Results({ rows, prizes, meCrewId, gameName }: { rows: ResultRow[]; prizes: { place: number; label: string }[]; meCrewId?: string; gameName: string }) {
  const podium = rows.slice(0, Math.max(3, prizes.length));
  return (
    <div className="py-2">
      <div className="text-center">
        <Trophy size={40} className="mx-auto mb-3 text-[#e5cf8f]" />
        <Label className="!text-[#e5cf8f]">{gameName.toUpperCase()} · FINAL RESULTS</Label>
        <h2 className="mt-2 font-display text-3xl font-bold">Mission complete.</h2>
      </div>
      <div className="mt-6 space-y-2">
        {podium.map((r) => (
          <div key={r.crewId} className={`flex items-center gap-3 rounded-lg border-2 px-4 py-3 ${r.prize ? 'border-[#a88f5c] bg-[#3a3a33]/60' : 'border-[#304b58] bg-[#112733]'} ${r.crewId === meCrewId ? 'ring-2 ring-primary/50' : ''}`}>
            <span className="w-10 font-display text-xl font-bold text-[#e5cf8f]">#{r.place}</span>
            <Crewmate color={r.color} size={36} state={r.place === 1 ? 'celebrating' : 'still'} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{r.name}</div>
              <div className="font-mono text-[9px] text-muted">{r.crewId}</div>
            </div>
            {r.prize && <span className="hidden text-right text-[10px] text-[#e9d6a0] sm:block">{r.prize}</span>}
            <span className="font-mono">{r.score}</span>
          </div>
        ))}
      </div>
      {rows.length > podium.length && <p className="mt-4 text-center text-[11px] text-muted">{rows.length - podium.length} more surviving crew(s) listed in the rankings room.</p>}
    </div>
  );
}

export function Comms({ items }: { items: Announcement[] }) {
  return (
    <>
      <Label className="!text-primary">SHIP-WIDE TRANSMISSIONS</Label>
      <h2 className="mb-5 mt-2 font-display text-2xl font-bold">Comms log</h2>
      {items.length === 0 && <p className="text-sm text-muted">No transmissions yet.</p>}
      <div className="space-y-2">
        {items.map((a) => (
          <div key={a.id} className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${a.kind === 'ALERT' ? 'border-[#c67c6b]/50 bg-[#4e2f3b]/50' : 'border-[#3c5c69] bg-[#16313d]'}`}>
            <Radio size={14} className="mt-1 shrink-0 text-primary" />
            <div>
              <div>{a.message}</div>
              <div className="mt-1 font-mono text-[9px] text-muted">{new Date(a.created_at).toLocaleTimeString()}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function StationsMenu({ domains, commander, onPick }: { domains: DomainDto[]; commander: boolean; onPick: (id: string) => void }) {
  const items: [string, string, React.ReactNode][] = [
    ['command', 'Command control panel', <Shield key="s" size={14} />],
    ['manifest', commander ? 'Commander card' : 'Crew access card', <CreditCard key="c" size={14} />],
    ...domains.map((d, i) => [`station-${i}`, `${d.name} — ${d.room}`, <span key={d.slug} className="font-mono text-xs" style={{ color: d.color }}>{d.symbol}</span>] as [string, string, React.ReactNode]),
    ['rankings', 'Crew rankings', <Trophy key="t" size={14} />],
  ];
  return (
    <>
      <Label className="!text-primary">QUICK ACCESS</Label>
      <h2 className="mb-2 mt-2 font-display text-2xl font-bold">Open a station</h2>
      <p className="mb-5 text-xs text-muted">Keyboard and screen-reader friendly alternative to walking the ship.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map(([id, label, icon]) => (
          <button key={id} onClick={() => onPick(id)} className="flex items-center gap-3 rounded-lg border-2 border-[#365463] bg-[#142d39] px-4 py-3 text-left text-sm hover:border-primary/60">
            <span className="flex h-7 w-7 items-center justify-center rounded border border-[#4e6b79] text-primary">{icon}</span>
            {label}
          </button>
        ))}
      </div>
    </>
  );
}

export function SolvedNotice({ reward, wallet, beforeRank, rank, color, onDone }: { reward: number; wallet: number; beforeRank: number | null; rank: number | null; color: string; onDone: () => void }) {
  return (
    <div className="py-5 text-center">
      <div className="relative mx-auto mb-5 w-fit">
        <Crewmate color={color} size={115} state="celebrating" />
        {[0, 1, 2, 3].map((e) => (
          <motion.div key={e} initial={{ y: 0, x: e * 16 - 25, opacity: 1 }} animate={{ y: -95, opacity: 0 }} transition={{ duration: 1.6, delay: e * 0.2, repeat: Infinity }} className="absolute right-0 top-10">
            <Coin size={21} />
          </motion.div>
        ))}
      </div>
      <Label className="!text-primary">SYSTEM RESTORED · VERIFIED BY SHIP SERVER</Label>
      <h2 className="my-3 font-display text-4xl font-bold">TASK COMPLETE!</h2>
      <div className="font-display text-xl text-primary">BUG EJECTED.</div>
      <div className="my-6 flex items-center justify-center gap-2 font-mono text-2xl text-[#ead596]">
        <Coin size={29} />+{reward} IDEACOINS
      </div>
      <Label>CREW RANK</Label>
      <div className="my-3 flex items-center justify-center gap-4 font-mono text-2xl">
        <span className="text-muted">#{beforeRank ?? '—'}</span>
        <ArrowRight size={19} className="text-muted" />
        <span className="text-primary">#{rank ?? '—'}</span>
      </div>
      <p className="mb-6 text-xs text-muted">Balance: {wallet.toLocaleString()} IdeaCoins</p>
      <Button onClick={onDone}>
        Back to Task Deck <CheckCircle2 size={15} />
      </Button>
    </div>
  );
}

export function CommanderStation({ domain, onConsole }: { domain: DomainDto; onConsole: () => void }) {
  return (
    <div className="text-center">
      <Lock size={30} className="mx-auto mb-4 text-[#e5cf8f]" />
      <Label>{domain.room}</Label>
      <h2 className="my-2 font-display text-2xl font-bold">{domain.name}</h2>
      <p className="mb-5 text-sm text-muted">
        {domain.counts.available} available · {domain.counts.solvedByOthers} repaired · {domain.counts.total} total this sprint.
      </p>
      <p className="mb-6 text-xs text-muted">Commanders manage tasks, releases and windows from the command console.</p>
      <Button onClick={onConsole}>
        <Shield size={14} /> Go to command panel
      </Button>
    </div>
  );
}
