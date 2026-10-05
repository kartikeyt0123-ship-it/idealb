import { motion } from 'motion/react';
import { ArrowRight, CheckCircle2, CreditCard, Eye, LoaderCircle, Radio, RefreshCw, Siren, Trophy, Zap } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, V1, type Announcement, type BoardRow, type CrewState, type DomainDto, type LeaderboardResponse, type Metric, type QuestionCard, type ResultRow } from '../lib/api';
import { Badge, Button, Coin, Crewmate, Label, StatePanel } from '../components/ui';
import { formatTime } from './format';

export const SPRINTS_PER_SLOT = 4;

export const metricLine = (m: Metric) => (m === 'NET_COINS' ? 'SCORE = IDEACOINS EARNED − SPENT' : 'SCORE = IDEACOINS EARNED (HINTS DO NOT COUNT)');

// ---------------------------------------------------------------------------
// Question cards (stations + bonus panel)
// ---------------------------------------------------------------------------

function cardNote(c: QuestionCard): string {
  switch (c.state) {
    case 'AVAILABLE':
      return `Open to every crew · first correct fix wins · hint ${c.hintCost} IdeaCoins${c.hintUnlocked ? ' (unlocked)' : ''}`;
    case 'SOLVED_BY_YOU':
      return 'Your crew fixed this system';
    case 'SOLVED':
      return `Fixed by ${c.solvedByCrew ?? 'another crew'}`;
    case 'EXPIRED':
      return 'Expired with its sprint';
    default:
      return 'Disabled by the organizers';
  }
}

export function QuestionCardRow({ card, readOnly, onOpen }: { card: QuestionCard; readOnly: boolean; onOpen: (c: QuestionCard) => void }) {
  const bonus = card.kind === 'BONUS';
  const open = card.state === 'AVAILABLE' && !readOnly;
  const faded = card.state === 'EXPIRED' || card.state === 'DISABLED';
  return (
    <div className={`rounded-lg border-2 p-4 ${bonus ? 'border-[#a86a5f] bg-[#3a2630]' : 'border-[#365463] bg-[#142d39]'} ${faded ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Label className={bonus ? '!text-[#f0b8a2]' : ''}>{card.label}</Label>
            {card.kind === 'RESERVE' && <span className="rounded border border-[#e5cf8f]/40 px-1.5 font-mono text-[8px] tracking-widest text-[#e5cf8f]">RESERVE</span>}
            {bonus && <span className="rounded border border-[#f08f80]/50 bg-[#f08f80]/10 px-1.5 font-mono text-[8px] tracking-widest text-[#f5b8a6]">BONUS</span>}
          </div>
          <h3 className="mt-1 truncate text-sm font-medium">{card.title}</h3>
        </div>
        <div className="flex items-center gap-3">
          <Badge>{card.difficulty}</Badge>
          <span className="flex items-center gap-1.5 font-mono text-xs text-[#e8cf8e]">
            <Coin size={15} />
            {card.reward}
          </span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge>{card.state === 'SOLVED_BY_YOU' ? 'SOLVED · YOU' : card.state}</Badge>
          <span className="text-[10px] text-muted">{cardNote(card)}</span>
        </div>
        <Button disabled={card.state === 'DISABLED'} onClick={() => onOpen(card)} className="!px-3 !py-2" secondary={!open} danger={bonus && open}>
          {open ? (bonus ? 'Investigate' : 'Begin repair') : 'View'}
          {open ? <ArrowRight size={12} /> : <Eye size={12} />}
        </Button>
      </div>
    </div>
  );
}

export function QuestionDeck({ domain, cards, live, waiting, readOnly, onOpen }: {
  domain: DomainDto;
  cards: QuestionCard[];
  live: boolean;
  /** Text shown when no sprint is running (e.g. "Waiting for the organizer to start Sprint 2"). */
  waiting: string | null;
  readOnly: string | null;
  onOpen: (c: QuestionCard) => void;
}) {
  const c = domain.counts;
  return (
    <>
      <div className="mb-5 flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border-2 border-[#577586] bg-[#14323e] font-mono text-2xl" style={{ color: domain.color }}>
          {domain.symbol}
        </div>
        <div className="min-w-0">
          <Label>{`${domain.room} PROGRAMMING TERMINAL`}</Label>
          <h2 className="mt-1 font-display text-2xl font-bold">{domain.name}</h2>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-2 font-mono text-[9px] tracking-wider text-[#a9c7c4]">
        <span className="rounded border border-[#3c5c69] px-2 py-1">{c.available} OPEN</span>
        <span className="rounded border border-[#3c5c69] px-2 py-1">{c.solvedByYou} BY YOU</span>
        <span className="rounded border border-[#3c5c69] px-2 py-1">{c.solvedByOthers} BY OTHERS</span>
        {c.expired > 0 && <span className="rounded border border-[#3c5c69] px-2 py-1">{c.expired} EXPIRED</span>}
      </div>
      <p className="mb-4 text-xs text-muted">Every crew in your slot sees these systems. The first crew whose fix is verified by the ship server wins the IdeaCoins — opening a system never reserves it.</p>
      {!live && waiting && <p className="mb-4 rounded-lg border border-[#e5cf8f]/30 bg-[#e5cf8f]/10 p-3 text-xs text-[#e9d6a0]">{waiting}</p>}
      {readOnly && <p className="mb-4 rounded-lg border border-[#c67c6b]/40 bg-[#4e2f3b]/60 p-3 text-xs text-[#f3c3ae]">{readOnly}</p>}
      {cards.length === 0 && (
        <p className="text-sm text-muted">
          {live ? 'No systems released at this station yet. Reserve batches may arrive during the sprint.' : 'No systems here right now.'}
        </p>
      )}
      <div className="space-y-3">
        {cards.map((q) => (
          <QuestionCardRow key={q.id} card={q} readOnly={!!readOnly || !live} onOpen={onOpen} />
        ))}
      </div>
    </>
  );
}

/** Emergency console — every released bonus ("IMPOSTER DETECTED") of the current sprint. */
export function BonusPanel({ bonuses, live, readOnly, onOpen }: { bonuses: QuestionCard[]; live: boolean; readOnly: string | null; onOpen: (c: QuestionCard) => void }) {
  const open = bonuses.filter((b) => b.state === 'AVAILABLE');
  return (
    <div>
      <div className="py-3 text-center">
        <div className={`mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full border-[5px] border-[#876159] bg-[#af5754] shadow-[0_5px_0_#271d27] ${open.length && live ? 'animate-pulse' : ''}`}>
          <Siren size={36} />
        </div>
        <Label className="!text-[#f0af92]">EMERGENCY BROADCAST</Label>
        <h2 className="my-3 font-display text-3xl font-bold">{open.length ? 'IMPOSTER DETECTED' : 'ALL CLEAR'}</h2>
        <p className="mx-auto max-w-md text-sm text-muted">
          {open.length
            ? 'Emergency bonus problems are open to every crew in your slot. The first correct answer wins the bonus — there is no claiming.'
            : 'No emergency bonus is open right now. Organizers release them during sprints — you will hear the alarm.'}
        </p>
      </div>
      {readOnly && <p className="my-3 rounded-lg border border-[#c67c6b]/40 bg-[#4e2f3b]/60 p-3 text-xs text-[#f3c3ae]">{readOnly}</p>}
      <div className="mt-4 space-y-3">
        {bonuses.map((b) => (
          <QuestionCardRow key={b.id} card={b} readOnly={!!readOnly || !live} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rankings (Sprint · Slot · Overall)
// ---------------------------------------------------------------------------

type BoardTab = 'SPRINT' | 'SLOT' | 'OVERALL';

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex gap-1 rounded-lg border border-[#3c5c69] bg-[#12293a] p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-md px-3 py-1.5 font-display text-[10px] font-bold tracking-wider ${value === o.id ? 'bg-primary text-[#14342f]' : 'text-[#a9c0c2] hover:bg-white/5'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function BoardTable({ rows, meCrewId, perSprint = false, showSlot = false, scoreLabel, empty }: { rows: BoardRow[]; meCrewId: string; perSprint?: boolean; showSlot?: boolean; scoreLabel: string; empty: string }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] border-separate border-spacing-y-1.5 text-left text-sm">
        <thead>
          <tr className="font-mono text-[8px] tracking-widest text-[#8eabb4]">
            <th className="px-2 font-normal">RANK</th>
            <th className="px-2 font-normal">CREW</th>
            {showSlot && <th className="px-2 text-center font-normal">SLOT</th>}
            {perSprint && Array.from({ length: SPRINTS_PER_SLOT }, (_, i) => <th key={i} className="hidden px-2 text-right font-normal sm:table-cell">S{i + 1}</th>)}
            <th className="px-2 text-right font-normal">SOLVES</th>
            <th className="px-2 text-right font-normal">{scoreLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const mine = r.crewId === meCrewId;
            const cell = mine ? 'bg-primary/10 border-y-2 border-primary/40' : 'bg-[#112733] border-y-2 border-[#304b58]';
            return (
              <tr key={r.crewId} aria-current={mine ? 'true' : undefined}>
                <td className={`${cell} rounded-l-lg border-l-2 px-3 py-2.5 font-mono text-sm text-[#8db4b7] ${mine ? 'border-l-primary/40' : 'border-l-[#304b58]'}`}>{r.rank ? String(r.rank).padStart(2, '0') : '—'}</td>
                <td className={`${cell} px-2 py-2`}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Crewmate color={r.color} size={28} state={r.status === 'ACTIVE' ? 'still' : 'warning'} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">
                        {r.name} {mine && <span className="ml-1 text-[9px] text-primary">YOU</span>}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 font-mono text-[9px] text-[#90b1b5]">
                        {r.crewId}
                        {r.status !== 'ACTIVE' && <Badge>{r.status === 'ELIMINATED' ? 'EJECTED' : r.status}</Badge>}
                        {r.zone && <Badge>{`${r.zone} · PROVISIONAL`}</Badge>}
                      </div>
                    </div>
                  </div>
                </td>
                {showSlot && <td className={`${cell} px-2 text-center font-mono text-xs text-[#cfe0da]`}>{r.slotNumber}</td>}
                {perSprint &&
                  Array.from({ length: SPRINTS_PER_SLOT }, (_, i) => (
                    <td key={i} className={`${cell} hidden px-2 text-right font-mono text-xs text-[#a9c7c4] sm:table-cell`}>
                      {(r.perSprint?.[String(i + 1)] ?? 0).toLocaleString()}
                    </td>
                  ))}
                <td className={`${cell} px-2 text-right font-mono text-xs text-[#a9c7c4]`}>{r.solves}</td>
                <td className={`${cell} rounded-r-lg border-r-2 px-3 text-right font-mono text-sm ${mine ? 'border-r-primary/40' : 'border-r-[#304b58]'}`}>
                  <span className="inline-flex items-center gap-1.5">
                    <Coin size={13} />
                    {r.score.toLocaleString()}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function RankingsDialog({ state, refreshKey, initialTab = 'SPRINT' }: { state: CrewState; refreshKey: number; initialTab?: BoardTab }) {
  const me = state.identity.crewId;
  const current = Math.max(1, state.slot.currentSprint || state.leaderboards.sprint.number);
  const [tab, setTab] = useState<BoardTab>(initialTab);
  const [sprintN, setSprintN] = useState(current);
  const [remote, setRemote] = useState<{ key: string; data: LeaderboardResponse } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => setSprintN((n) => (n > current ? current : n)), [current]);

  const fromSnapshot = tab === 'SLOT' || (tab === 'SPRINT' && sprintN === state.leaderboards.sprint.number);
  const key = tab === 'OVERALL' ? 'event' : tab === 'SPRINT' ? `sprint:${sprintN}` : 'slot';
  useEffect(() => {
    if (fromSnapshot) {
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    const url = tab === 'OVERALL' ? `${V1}/leaderboards?scope=event` : `${V1}/leaderboards?scope=sprint&sprint=${sprintN}`;
    api
      .get<LeaderboardResponse>(url, ac.signal)
      .then((d) => setRemote({ key, data: d }))
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') setError(e instanceof ApiError ? e.message : 'Could not load standings.');
      })
      .finally(() => !ac.signal.aborted && setLoading(false));
    return () => ac.abort();
  }, [key, fromSnapshot, refreshKey, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  const remoteRows = remote?.key === key ? remote.data : null;
  const metric = state.event.metric;

  let body: ReactNode;
  if (tab === 'SLOT') {
    const inactive = state.leaderboards.slot.inactive;
    body = (
      <>
        <BoardTable rows={state.leaderboards.slot.rows} meCrewId={me} perSprint scoreLabel="TOTAL" empty="No standings yet — they appear once Sprint 1 starts." />
        {inactive.length > 0 && (
          <>
            <Label className="mb-1 mt-5">OUT OF CONTENTION</Label>
            <BoardTable rows={inactive} meCrewId={me} perSprint scoreLabel="TOTAL" empty="" />
          </>
        )}
      </>
    );
  } else if (fromSnapshot) {
    body = <BoardTable rows={state.leaderboards.sprint.rows} meCrewId={me} scoreLabel={`SPRINT ${sprintN}`} empty={`No scores in Sprint ${sprintN} yet — every crew starts the sprint at zero.`} />;
  } else if (!remoteRows) {
    body = error ? (
      <StatePanel kind="error" title="Standings unavailable" message={error} action={<Button secondary onClick={() => setRetry((r) => r + 1)}><RefreshCw size={13} /> Retry</Button>} />
    ) : (
      <StatePanel kind="loading" title="Receiving telemetry…" />
    );
  } else {
    body = (
      <BoardTable
        rows={remoteRows.rows}
        meCrewId={me}
        showSlot={tab === 'OVERALL'}
        scoreLabel={tab === 'OVERALL' ? 'TOTAL' : `SPRINT ${sprintN}`}
        empty={tab === 'OVERALL' ? 'No overall standings yet.' : `No scores in Sprint ${sprintN}.`}
      />
    );
  }

  return (
    <>
      <Label className="!text-primary">OBSERVATION DECK / {state.slot.name.toUpperCase()}</Label>
      <h2 className="mb-4 mt-2 font-display text-3xl font-bold">Crew rankings</h2>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Leaderboard scope"
          value={tab}
          onChange={setTab}
          options={[
            { id: 'SPRINT', label: 'SPRINT' },
            { id: 'SLOT', label: 'SLOT' },
            { id: 'OVERALL', label: 'OVERALL' },
          ]}
        />
        {tab === 'OVERALL' && remoteRows?.status && <Badge>{remoteRows.status === 'FINAL' ? 'FINAL' : 'PROVISIONAL'}</Badge>}
        {loading && <LoaderCircle size={14} className="animate-spin text-primary" aria-label="Loading" />}
      </div>
      {tab === 'SPRINT' && current > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Label>SPRINT</Label>
          {Array.from({ length: current }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setSprintN(n)}
              aria-pressed={sprintN === n}
              className={`rounded-md border px-2.5 py-1 font-mono text-[10px] ${sprintN === n ? 'border-primary bg-primary/15 text-primary' : 'border-[#3c5c69] text-[#a9c0c2] hover:border-primary/50'}`}
            >
              S{n}
            </button>
          ))}
        </div>
      )}
      <p className="mb-3 text-[11px] text-muted">
        {tab === 'SPRINT'
          ? 'Each sprint board starts at zero. Crews with equal scores share a rank.'
          : tab === 'SLOT'
            ? 'Cumulative score across the four sprints of your slot. Crews with equal scores share a rank.'
            : remoteRows?.status === 'FINAL'
              ? 'Final standings across all four slots.'
              : 'Combined standings across all four slots — PROVISIONAL until the organizers finalize the event.'}
      </p>
      {body}
      <Label className="mt-4 text-center">{metricLine(metric)}</Label>
    </>
  );
}

// ---------------------------------------------------------------------------
// Flight manual
// ---------------------------------------------------------------------------

export function FlightManual({ state }: { state: CrewState | null }) {
  const gross = (state?.event.metric ?? 'GROSS_EARNED') === 'GROSS_EARNED';
  return (
    <>
      <Label className="!text-primary">FLIGHT MANUAL / 01</Label>
      <h2 className="mt-2 font-display text-3xl font-bold">The ship is your interface.</h2>
      <p className="my-5 text-sm leading-7 text-muted">
        Walk through the doors. Approach a machine. Press <kbd className="rounded border border-primary/40 bg-primary/10 px-2 text-primary">E</kbd> to use it. You can also click a machine and your crewmate will walk to it, or open the
        Stations menu in the top bar.
      </p>
      <div className="space-y-3">
        {[
          ['WASD / ARROWS', 'Move around the deck'],
          ['SCROLL / TRACKPAD', 'Walk left and right'],
          ['E', 'Interact with a nearby machine'],
          ['I', 'Show your crew access card'],
          ['M', 'Mute or unmute sound cues'],
          ['ESC', 'Exit the current terminal'],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 rounded border border-[#3c5c69] bg-[#16313d] p-3 text-xs">
            <span className="font-mono text-primary">{k}</span>
            <span className="text-right text-muted">{v}</span>
          </div>
        ))}
      </div>
      <div className="mt-6 space-y-2 text-xs leading-6 text-muted">
        <p>Your slot has four sprints. Each one is started by the organizers; between sprints the ship waits in the lobby. Every sprint brings a fresh set of systems, which expire when the sprint ends.</p>
        <p>Open any system, repair it and verify. The first crew whose fix is accepted by the ship server earns the reward; wrong answers keep it open for everyone. Running code never awards coins.</p>
        <p>
          Hints cost IdeaCoins from your wallet{gross ? ' only — your ranking score counts IdeaCoins earned, so buying a hint never lowers your rank' : ' and lower your score (score = earned − spent)'}. A purchased hint is visible on every device of your crew.
        </p>
        <p>The sprint board starts at zero every sprint; the slot board adds all four sprints; the overall board compares every slot and stays provisional until the organizers finalize it.</p>
        <p>IMPOSTER DETECTED alerts are emergency bonus problems open to every crew — the first correct answer wins the bonus. Find them on the emergency bridge.</p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sprint outcomes
// ---------------------------------------------------------------------------

export function SprintClosed({ sprint, last, onRankings }: { sprint: number; last: boolean; onRankings: () => void }) {
  return (
    <div className="py-14 text-center">
      <LoaderCircle size={40} className="mx-auto mb-7 animate-spin text-[#e3bd86]" />
      <Label>SPRINT {String(sprint).padStart(2, '0')} COMPLETE</Label>
      <h2 className="mt-4 font-display text-2xl font-bold">TIME IS UP.</h2>
      <p className="mx-auto mt-5 max-w-md text-xs leading-6 text-muted">
        Unsolved systems from this sprint have expired and the sprint board is frozen.{' '}
        {last ? 'That was the final sprint — the organizers are reviewing the slot results.' : `Wait in the lobby — the organizers will start Sprint ${sprint + 1}.`}
      </p>
      <Button secondary className="mt-6" onClick={onRankings}>
        View sprint rankings <Trophy size={14} />
      </Button>
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
        <p className="my-4 text-sm text-muted">Your crew is out of this slot. The ship stays visible in read-only mode.</p>
        <p className="my-6 font-mono text-xs text-[#d6e9e0]">
          SLOT RANK {rank ? `#${rank}` : '—'} / {score.toLocaleString()} POINTS
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
      <p className="my-5 text-sm text-muted">{sprint < SPRINTS_PER_SLOT ? 'Wait in the lobby — the organizers will start the next sprint.' : 'Final standings are under review.'}</p>
      <Button onClick={onDone}>
        Return to the ship <ArrowRight size={14} />
      </Button>
    </div>
  );
}

export function Results({ result, fallback, meCrewId, slotName, completed }: { result: ResultRow[] | null; fallback: BoardRow[]; meCrewId: string; slotName: string; completed: boolean }) {
  const rows: (BoardRow & { place?: number; prize?: string | null })[] = result && result.length ? result : fallback;
  const mine = rows.find((r) => r.crewId === meCrewId);
  return (
    <div className="py-2">
      <div className="text-center">
        <Trophy size={40} className="mx-auto mb-3 text-[#e5cf8f]" />
        <Label className="!text-[#e5cf8f]">{slotName.toUpperCase()} · {completed && result ? 'FINAL SLOT RESULTS' : 'RESULTS UNDER REVIEW'}</Label>
        <h2 className="mt-2 font-display text-3xl font-bold">{completed ? 'Mission complete.' : 'All sprints complete.'}</h2>
        {mine && (
          <p className="mt-3 font-mono text-xs text-primary">
            YOUR CREW · #{mine.place ?? mine.rank ?? '—'} · {mine.score.toLocaleString()} POINTS
          </p>
        )}
        {!completed && <p className="mt-2 text-xs text-muted">The organizers are reviewing the slot. Standings below are provisional.</p>}
      </div>
      <div className="mt-6 space-y-2">
        {rows.length === 0 && <p className="text-center text-sm text-muted">No standings recorded.</p>}
        {rows.map((r) => {
          const place = r.place ?? r.rank;
          return (
            <div key={r.crewId} className={`flex items-center gap-3 rounded-lg border-2 px-4 py-3 ${r.prize ? 'border-[#a88f5c] bg-[#3a3a33]/60' : 'border-[#304b58] bg-[#112733]'} ${r.crewId === meCrewId ? 'ring-2 ring-primary/50' : ''}`}>
              <span className="w-10 font-display text-xl font-bold text-[#e5cf8f]">{place ? `#${place}` : '—'}</span>
              <Crewmate color={r.color} size={36} state={place === 1 ? 'celebrating' : 'still'} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{r.name}</div>
                <div className="font-mono text-[9px] text-muted">{r.crewId}</div>
              </div>
              {r.prize && <span className="hidden text-right text-[10px] text-[#e9d6a0] sm:block">{r.prize}</span>}
              <span className="font-mono">{r.score.toLocaleString()}</span>
            </div>
          );
        })}
      </div>
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
            <div className="min-w-0">
              <div className="break-words">{a.message}</div>
              <div className="mt-1 font-mono text-[9px] text-muted">{formatTime(a.created_at)}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function StationsMenu({ domains, bonusOpen, onPick }: { domains: DomainDto[]; bonusOpen: number; onPick: (id: string) => void }) {
  const items: [string, string, ReactNode][] = [
    ['command', bonusOpen ? `Emergency console — ${bonusOpen} bonus open` : 'Emergency console (bonus)', <Zap key="z" size={14} />],
    ['manifest', 'Crew access card', <CreditCard key="c" size={14} />],
    ...domains.map(
      (d, i) =>
        [`station-${i}`, `${d.name} — ${d.counts.available} open`, <span key={d.slug} className="font-mono text-xs" style={{ color: d.color }}>{d.symbol}</span>] as [string, string, ReactNode],
    ),
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
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[#4e6b79] text-primary">{icon}</span>
            {label}
          </button>
        ))}
      </div>
    </>
  );
}

export function SolvedNotice({ reward, wallet, bonus, before, after, color, onDone }: {
  reward: number;
  wallet: number;
  bonus: boolean;
  before: { sprintRank: number | null; slotRank: number | null };
  after: { sprintRank: number | null; slotRank: number | null };
  color: string;
  onDone: () => void;
}) {
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
      <h2 className="my-3 font-display text-4xl font-bold">{bonus ? 'IMPOSTER EJECTED!' : 'TASK COMPLETE!'}</h2>
      <div className="font-display text-xl text-primary">{bonus ? 'EMERGENCY BONUS WON.' : 'BUG EJECTED.'}</div>
      <div className="my-6 flex items-center justify-center gap-2 font-mono text-2xl text-[#ead596]">
        <Coin size={29} />+{reward} IDEACOINS
      </div>
      <div className="mx-auto grid max-w-xs grid-cols-2 gap-3">
        {(
          [
            ['SPRINT RANK', before.sprintRank, after.sprintRank],
            ['SLOT RANK', before.slotRank, after.slotRank],
          ] as const
        ).map(([l, b, a]) => (
          <div key={l} className="rounded-lg border border-[#3c5c69] bg-[#16313d] p-3">
            <Label>{l}</Label>
            <div className="mt-2 flex items-center justify-center gap-2 font-mono text-lg">
              <span className="text-muted">#{b ?? '—'}</span>
              <ArrowRight size={14} className="text-muted" />
              <span className="text-primary">#{a ?? '—'}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="mb-6 mt-4 text-xs text-muted">Wallet: {wallet.toLocaleString()} IdeaCoins</p>
      <Button onClick={onDone}>
        {bonus ? 'Back to the ship' : 'Back to the station'} <CheckCircle2 size={15} />
      </Button>
    </div>
  );
}
