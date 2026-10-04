import { Pause, Play, Plus, Rocket, Square, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api } from '../lib/api';
import { Badge, Button, Field, Label, useToast } from '../components/ui';
import { CARD, COIN_TEXT, Check, Countdown, Empty, Notice, NumInput, SMALL, SUBCARD, SectionHead, errText, fmtDuration, fmtTime, useConsole, useRun } from './kit';
import type { AdminGame, Preflight } from './types';

const PRE_START = ['DRAFT', 'READY', 'WAITING'];

export function GameTab() {
  const { overview, can } = useConsole();
  return (
    <div className="space-y-6">
      {can('event.config') && <EventDayControl key={`${overview.event.daySelectionMode}-${overview.event.manualDayId}-${overview.event.sessionLimit}-${overview.event.sessionLimitPolicy}`} />}
      {!can('event.config') && (
        <Notice>
          Today: {overview.currentDay ? `Day ${overview.currentDay.day_number} (${overview.currentDay.label})` : 'no active day'} · day selection {overview.event.daySelectionMode}. Only a SUPER_ADMIN can switch the event day.
        </Notice>
      )}
      {overview.games.length === 0 ? <Empty>No games configured for this event.</Empty> : overview.games.map((g) => <GameCard key={g.id} game={g} />)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event day control
// ---------------------------------------------------------------------------

function EventDayControl() {
  const { overview, confirm } = useConsole();
  const { busy, run } = useRun();
  const ev = overview.event;
  const manualDay = overview.days.find((d) => d.id === ev.manualDayId)?.day_number ?? null;
  const [mode, setMode] = useState<'AUTO' | 'MANUAL'>(ev.daySelectionMode);
  const [day, setDay] = useState<string>(manualDay ? String(manualDay) : '');
  const [limit, setLimit] = useState(String(ev.sessionLimit));
  const [policy, setPolicy] = useState(ev.sessionLimitPolicy);

  const applyDay = async () => {
    const target = mode === 'MANUAL' ? overview.days.find((d) => String(d.day_number) === day) : null;
    const r = await confirm({
      title: 'Change the event day',
      effects: [
        mode === 'AUTO' ? `Day selection becomes AUTO: the active day follows the calendar date (${ev.timezone}).` : target ? `Day ${target.day_number} (${target.label}) becomes the active day NOW, regardless of the date.` : 'MANUAL mode with no day: NO crew can enter the ship.',
        'This changes which crews can enter: only crews activated for the active day can play its game.',
        'Every connected client is told to resync immediately.',
      ],
      confirmLabel: 'Switch day',
    });
    if (!r) return;
    await run('event-day', () => api.patch('/api/admin/event', { daySelectionMode: mode, manualDayNumber: mode === 'MANUAL' && day ? Number(day) : null }), 'Event day updated.');
  };
  const applySessions = async () => {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1 || n > 20) return;
    await run('event-sessions', () => api.patch('/api/admin/event', { sessionLimit: n, sessionLimitPolicy: policy }), 'Session policy updated.');
  };

  return (
    <section className={CARD} aria-labelledby="event-day-h">
      <SectionHead label="EVENT DAY CONTROL · SUPER ADMIN" title="Which day is live?">
        <Badge>{overview.currentDay ? `ACTIVE: DAY ${overview.currentDay.day_number}` : 'NO ACTIVE DAY'}</Badge>
      </SectionHead>
      <h3 id="event-day-h" className="sr-only">Event day control</h3>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <span className="mb-1 block font-mono text-[9px] tracking-widest text-[#b3c4c8]">DAY SELECTION</span>
            <select className="input !w-auto !py-2" value={mode} onChange={(e) => setMode(e.target.value as 'AUTO' | 'MANUAL')}>
              <option value="AUTO">AUTO (by calendar date)</option>
              <option value="MANUAL">MANUAL override</option>
            </select>
          </label>
          {mode === 'MANUAL' && (
            <label className="text-xs">
              <span className="mb-1 block font-mono text-[9px] tracking-widest text-[#b3c4c8]">MANUAL DAY</span>
              <select className="input !w-auto !py-2" value={day} onChange={(e) => setDay(e.target.value)}>
                <option value="">None (ship closed)</option>
                {overview.days.map((d) => <option key={d.id} value={d.day_number}>Day {d.day_number} — {d.label}{d.date ? ` (${d.date})` : ''}</option>)}
              </select>
            </label>
          )}
          <Button danger className={SMALL} disabled={busy === 'event-day'} onClick={() => void applyDay()}>Apply day change…</Button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <span className="mb-1 block font-mono text-[9px] tracking-widest text-[#b3c4c8]">DEVICES PER CREW</span>
            <NumInput value={limit} onChange={setLimit} min={1} max={20} className="!w-24" ariaLabel="Session limit per crew" />
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-mono text-[9px] tracking-widest text-[#b3c4c8]">WHEN EXCEEDED</span>
            <select className="input !w-auto !py-2" value={policy} onChange={(e) => setPolicy(e.target.value as typeof policy)}>
              <option value="EVICT_OLDEST">Sign out oldest device</option>
              <option value="REJECT">Reject new sign-in</option>
            </select>
          </label>
          <Button secondary className={SMALL} disabled={busy === 'event-sessions'} onClick={() => void applySessions()}>Save session policy</Button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Game card
// ---------------------------------------------------------------------------

function GameCard({ game }: { game: AdminGame }) {
  const { overview, can } = useConsole();
  const day = overview.days.find((d) => d.id === game.dayId);
  const cur = game.sprints.find((s) => s.number === Math.max(1, game.currentSprint));
  return (
    <section className={CARD} aria-label={`Game ${game.number}`}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-5 rounded-lg border border-[#344d5b] bg-[#10252f] p-4">
        <div>
          <Label>GAME {game.number} · VERSION {game.version}</Label>
          <h3 className="mt-1 font-display text-xl font-bold">{game.name}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge>{game.phase.replace(/_/g, ' ')}</Badge>
            <span className="font-mono text-[10px] text-muted">{day ? `DAY ${day.day_number} · ${day.label}` : 'NOT MAPPED TO A DAY'}</span>
            {game.rulesFrozenAt && <span className="font-mono text-[9px] text-[#ebd68c]">RULES FROZEN {fmtTime(game.rulesFrozenAt)}</span>}
          </div>
        </div>
        <div className="text-right">
          <Label>{cur ? `SPRINT ${cur.number} · ${cur.status}` : 'NO SPRINT'}</Label>
          <div className="mt-1 text-3xl">
            {cur && (cur.status === 'RUNNING' || cur.status === 'PAUSED') ? <Countdown deadline={cur.deadlineAt} pausedAt={cur.status === 'PAUSED' ? cur.pausedAt : null} /> : <span className="font-mono text-muted">--:--</span>}
          </div>
          {cur?.status === 'PAUSED' && <span className="font-mono text-[10px] text-[#ebd68c]">PAUSED — CLOCK STOPPED</span>}
        </div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        {game.sprints.map((s) => (
          <div key={s.number} className={SUBCARD}>
            <div className="flex items-center justify-between">
              <Label>SPRINT {s.number}</Label>
              <Badge>{s.status}</Badge>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[11px]">
              <span>Duration: {fmtDuration(s.durationSeconds)}</span>
              <span>Eliminate K: {s.eliminateCount ?? 'NOT SET'}</span>
              <span className="text-muted">Start: {fmtTime(s.startedAt)}</span>
              <span className="text-muted">Deadline: {fmtTime(s.deadlineAt)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_minmax(320px,420px)]">
        <ConfigForm key={`${game.id}-${game.version}`} game={game} />
        <div className="space-y-5">
          {game.preflight && <PreflightPanel pf={game.preflight} sprint={game.nextSprint ?? 1} />}
          {can('game.control') ? <LifecycleControls game={game} /> : <Notice>Your role cannot control the game lifecycle.</Notice>}
        </div>
      </div>
    </section>
  );
}

function PreflightPanel({ pf, sprint }: { pf: Preflight; sprint: number }) {
  return (
    <div className={`rounded-lg border-2 p-4 ${pf.ok ? 'border-[#4f8c7f] bg-[#13313c]' : 'border-[#9d635a] bg-[#442b34]/70'}`} aria-live="polite">
      <div className="mb-3 flex items-center justify-between">
        <Label>PREFLIGHT · SPRINT {sprint}</Label>
        <Badge>{pf.ok ? 'GO — READY' : `${pf.blockers.length} BLOCKER(S)`}</Badge>
      </div>
      {pf.blockers.length > 0 && (
        <ul className="mb-3 space-y-1 text-[11px] text-[#f3b399]">
          {pf.blockers.map((b) => <li key={b}>✕ {b}</li>)}
        </ul>
      )}
      {pf.warnings.length > 0 && (
        <ul className="mb-3 space-y-1 text-[11px] text-[#ebd68c]">
          {pf.warnings.map((w) => <li key={w}>! {w}</li>)}
        </ul>
      )}
      {pf.summary.length > 0 && (
        <ul className="space-y-1 font-mono text-[10px] text-[#c9dcd8]">
          {pf.summary.map((s) => <li key={s}>› {s}</li>)}
        </ul>
      )}
    </div>
  );
}

function LifecycleControls({ game }: { game: AdminGame }) {
  const { confirm, reloadOverview } = useConsole();
  const { busy, run } = useRun();
  const toast = useToast();
  const [starting, setStarting] = useState(false);
  const pf = game.preflight;
  const next = game.nextSprint;
  const canStart = next !== null && (next === 1 ? PRE_START.includes(game.phase) : game.phase === 'WAITING_NEXT_SPRINT');

  const start = async () => {
    if (!next || !pf) return;
    const nextSprint = game.sprints.find((s) => s.number === next);
    const r = await confirm({
      title: next === 1 ? `Start Sprint 1 of Game ${game.number}` : `Activate Sprint 2 of Game ${game.number}`,
      tone: 'primary',
      effects: [
        `The ${fmtDuration(nextSprint?.durationSeconds ?? 0)} countdown starts immediately for every active crew.`,
        ...(next === 1 ? ['Ranking rule, imposter mode, starting coins and the day mapping FREEZE.'] : [`Eliminated-solve recycling: ${game.recycleEliminatedSolves ? 'ON' : 'OFF'}.`]),
        ...pf.summary,
      ],
      confirmLabel: next === 1 ? 'Start Sprint 1' : 'Activate Sprint 2',
    });
    if (!r) return;
    const send = (ack: boolean) => api.post(`/api/admin/games/${game.id}/start-sprint`, { sprint: next, expectedVersion: game.version, ...(ack ? { acknowledgeZeroElimination: true } : {}) });
    setStarting(true);
    try {
      await send(false);
      toast(`Sprint ${next} started.`, 'good');
    } catch (e) {
      setStarting(false);
      if (e instanceof ApiError && e.code === 'PREFLIGHT_FAILED' && e.details?.needsZeroAck) {
        const ack = await confirm({
          title: 'Sprint eliminates nobody (K = 0)',
          tone: 'warning',
          effects: ['No crew will be ejected at the end of this sprint.', 'This departs from the planned format and is recorded as an explicit organizer decision.'],
          ack: 'I acknowledge that this sprint eliminates zero crews.',
          confirmLabel: 'Start anyway',
        });
        if (!ack) return;
        await run('start', () => send(true), `Sprint ${next} started (K=0 acknowledged).`);
        return;
      }
      toast(errText(e), 'alert');
      void reloadOverview();
      return;
    }
    setStarting(false);
    void reloadOverview();
  };

  const pause = async () => {
    const r = await confirm({ title: `Pause Game ${game.number}`, tone: 'warning', effects: ['The sprint clock stops for every crew; submissions are rejected while paused.', 'Imposter claim/solve deadlines are shifted by the paused time on resume.'], confirmLabel: 'Pause sprint' });
    if (r) await run('pause', () => api.post(`/api/admin/games/${game.id}/pause`, { expectedVersion: game.version }), 'Sprint paused.');
  };
  const resume = async () => {
    const r = await confirm({ title: `Resume Game ${game.number}`, tone: 'primary', effects: ['The clock restarts; the deadline moves later by exactly the paused duration.'], confirmLabel: 'Resume sprint' });
    if (r) await run('resume', () => api.post(`/api/admin/games/${game.id}/resume`, { expectedVersion: game.version }), 'Sprint resumed.');
  };
  const close = async () => {
    const r = await confirm({
      title: `Close Sprint ${game.currentSprint} now`,
      effects: ['Scoring stops immediately for every crew; live imposters expire without award.', 'Standings are FROZEN and the game moves to ELIMINATION REVIEW.', 'This cannot be undone.'],
      reason: { label: 'REASON FOR EARLY CLOSE', min: 4 },
      confirmLabel: 'Close sprint now',
    });
    if (r) await run('close', () => api.post(`/api/admin/games/${game.id}/close-sprint`, { expectedVersion: game.version, reason: r.reason }), 'Sprint closed — elimination review pending.');
  };

  return (
    <div className="rounded-lg border-2 border-[#416574] bg-[#13313c] p-4">
      <Label className="mb-3">LIFECYCLE CONTROL</Label>
      <div className="flex flex-wrap gap-2">
        {canStart && (
          <Button disabled={!pf?.ok || starting || busy === 'start'} title={!pf?.ok ? 'Resolve the preflight blockers first' : undefined} onClick={() => void start()}>
            <Rocket size={14} /> {next === 1 ? 'Start Sprint 1' : 'Activate Sprint 2'}
          </Button>
        )}
        {game.phase === 'RUNNING' && <Button secondary disabled={busy === 'pause'} onClick={() => void pause()}><Pause size={14} /> Pause</Button>}
        {game.phase === 'PAUSED' && <Button disabled={busy === 'resume'} onClick={() => void resume()}><Play size={14} /> Resume</Button>}
        {(game.phase === 'RUNNING' || game.phase === 'PAUSED') && <Button danger disabled={busy === 'close'} onClick={() => void close()}><Square size={14} /> Close sprint now</Button>}
      </div>
      <div className="mt-3 space-y-2">
        {game.phase === 'WAITING_NEXT_SPRINT' && <Notice tone="warn">Waiting room: Sprint 1 eliminations are confirmed. Sprint 2 never starts automatically — activate it when the crews are ready.</Notice>}
        {game.phase === 'ELIMINATION_REVIEW' && <Notice tone="warn">Sprint {game.currentSprint} is closed. Review and confirm eliminations in the ELIMINATION tab.</Notice>}
        {game.phase === 'GAME_RESULT_REVIEW' && <Notice tone="warn">Final standings are frozen. Confirm results in the ELIMINATION tab.</Notice>}
        {game.phase === 'COMPLETED' && <Notice>Game complete — results confirmed.</Notice>}
        {canStart && !pf?.ok && <Notice tone="danger">Start is locked until every preflight blocker is resolved.</Notice>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function ConfigForm({ game }: { game: AdminGame }) {
  const { overview, can } = useConsole();
  const { busy, run } = useRun();
  const toast = useToast();
  const frozen = !!game.rulesFrozenAt;
  const editable = can('game.control');
  const s2 = game.sprints.find((s) => s.number === 2);
  const initDay = overview.days.find((d) => d.id === game.dayId)?.day_number;

  const [metric, setMetric] = useState(game.rankingMetric);
  const [metricOk, setMetricOk] = useState(game.rankingMetricConfirmed);
  const [durations, setDurations] = useState<Record<number, string>>(Object.fromEntries(game.sprints.map((s) => [s.number, String(Math.round((s.durationSeconds / 60) * 100) / 100)])));
  const [counts, setCounts] = useState<Record<number, string>>(Object.fromEntries(game.sprints.map((s) => [s.number, s.eliminateCount === null ? '' : String(s.eliminateCount)])));
  const [impMode, setImpMode] = useState(game.imposterMode);
  const [blocks, setBlocks] = useState(game.imposterBlocksRegular);
  const [recycle, setRecycle] = useState(game.recycleEliminatedSolves);
  const [coins, setCoins] = useState(String(game.startingCoins));
  const [prizes, setPrizes] = useState(game.prizes.map((p) => p.label));
  const [dayNumber, setDayNumber] = useState(initDay ? String(initDay) : '');
  const [notes, setNotes] = useState<string[]>([]);

  const save = async () => {
    const patch: Record<string, unknown> = {};
    if (!frozen) {
      if (metric !== game.rankingMetric || metricOk !== game.rankingMetricConfirmed) {
        patch.rankingMetric = metric;
        patch.rankingMetricConfirmed = metricOk;
      }
      if (impMode !== game.imposterMode) patch.imposterMode = impMode;
      if (blocks !== game.imposterBlocksRegular) patch.imposterBlocksRegular = blocks;
      if (coins !== String(game.startingCoins)) {
        const n = Number(coins);
        if (!Number.isInteger(n) || n < 0) return toast('Starting coins must be a non-negative integer.', 'alert');
        patch.startingCoins = n;
      }
      if (dayNumber && dayNumber !== String(initDay ?? '')) patch.dayNumber = Number(dayNumber);
    }
    const sd: { sprint: number; seconds: number }[] = [];
    const ec: { sprint: number; count: number | null }[] = [];
    for (const s of game.sprints) {
      if (s.status !== 'PENDING') continue;
      const secs = Math.round(Number(durations[s.number]) * 60);
      if (!Number.isFinite(secs) || secs < 30 || secs > 6 * 3600) return toast(`Sprint ${s.number}: duration must be 0.5–360 minutes.`, 'alert');
      if (secs !== s.durationSeconds) sd.push({ sprint: s.number, seconds: secs });
      const raw = counts[s.number].trim();
      const k = raw === '' ? null : Number(raw);
      if (k !== null && (!Number.isInteger(k) || k < 0)) return toast(`Sprint ${s.number}: elimination count must be a non-negative integer.`, 'alert');
      if (k !== s.eliminateCount) ec.push({ sprint: s.number, count: k });
    }
    if (sd.length) patch.sprintDurations = sd;
    if (ec.length) patch.eliminateCounts = ec;
    if (s2?.status === 'PENDING' && recycle !== game.recycleEliminatedSolves) patch.recycleEliminatedSolves = recycle;
    if (game.phase !== 'COMPLETED') {
      const cur = game.prizes.map((p) => p.label);
      if (prizes.length !== cur.length || prizes.some((p, i) => p.trim() !== cur[i])) {
        if (prizes.some((p) => !p.trim())) return toast('Every prize place needs a label.', 'alert');
        patch.prizes = prizes.map((label, i) => ({ place: i + 1, label: label.trim() }));
      }
    }
    if (!Object.keys(patch).length) return toast('No changes to save.', 'info');
    const r = await run('config', () => api.patch<{ notes: string[] }>(`/api/admin/games/${game.id}/config`, { ...patch, expectedVersion: game.version }), 'Game configuration saved.');
    if (r) setNotes(r.notes);
  };

  const preset = async (p: 'STANDARD' | 'REHEARSAL') => {
    const r = await run(`preset-${p}`, () => api.patch<{ notes: string[] }>(`/api/admin/games/${game.id}/config`, { durationPreset: p, expectedVersion: game.version }), `${p} preset applied.`);
    if (r) setNotes(r.notes);
  };

  const ro = !editable;
  return (
    <div className="space-y-5">
      <div className={SUBCARD}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Label>DURATION PRESET · CURRENT: {game.durationPreset}</Label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button secondary={game.durationPreset !== 'STANDARD'} className={SMALL} disabled={ro || busy === 'preset-STANDARD'} onClick={() => void preset('STANDARD')}>STANDARD · 30 MIN SPRINTS</Button>
          <Button danger={game.durationPreset === 'REHEARSAL'} secondary={game.durationPreset !== 'REHEARSAL'} className={SMALL} disabled={ro || busy === 'preset-REHEARSAL'} onClick={() => void preset('REHEARSAL')}>REHEARSAL · 120 S SPRINTS</Button>
        </div>
        <p className="mt-2 text-[10px] text-muted">Presets change only pending sprints and draft imposter windows. REHEARSAL is for dry runs only — never use it for the real competition.</p>
        {game.durationPreset === 'REHEARSAL' && <div className="mt-2"><Notice tone="warn">REHEARSAL TIMINGS ACTIVE — sprints last 2 minutes.</Notice></div>}
        {notes.length > 0 && <ul className="mt-2 space-y-1 font-mono text-[10px] text-primary" aria-live="polite">{notes.map((n) => <li key={n}>› {n}</li>)}</ul>}
      </div>

      <div className={SUBCARD}>
        <Label className="mb-3">RULES {frozen ? '· FROZEN (SPRINT 1 STARTED)' : '· EDITABLE UNTIL SPRINT 1 STARTS'}</Label>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="RANKING METRIC" hint={metric === 'NET_COINS' ? 'Score = earned − spent (hints cost score) + adjustments.' : 'Score = gross earned + adjustments (hints do not cost score).'}>
            <select className="input" value={metric} disabled={frozen || ro} onChange={(e) => { setMetric(e.target.value as typeof metric); setMetricOk(false); }}>
              <option value="NET_COINS">NET_COINS — net IdeaCoins</option>
              <option value="GROSS_EARNED">GROSS_EARNED — gross earned</option>
            </select>
          </Field>
          <Field label="MAPPED EVENT DAY">
            <select className="input" value={dayNumber} disabled={frozen || ro} onChange={(e) => setDayNumber(e.target.value)}>
              <option value="">— not mapped —</option>
              {overview.days.map((d) => <option key={d.id} value={d.day_number}>Day {d.day_number} — {d.label}</option>)}
            </select>
          </Field>
        </div>
        <div className="mb-4">
          <Check checked={metricOk} disabled={frozen || ro} onChange={setMetricOk} label={<b>I confirm this ranking rule ({metric}) for Game {game.number}</b>} />
        </div>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="IMPOSTER MODE">
            <select className="input" value={impMode} disabled={frozen || ro} onChange={(e) => setImpMode(e.target.value as typeof impMode)}>
              <option value="RESERVE">RESERVE — first crew to claim gets it</option>
              <option value="OPEN">OPEN — first correct answer wins</option>
            </select>
          </Field>
          <Field label="STARTING COINS (WALLET GRANT)" hint="Funding only — never counts as score.">
            <NumInput value={coins} onChange={setCoins} min={0} disabled={frozen || ro} ariaLabel="Starting coins" />
          </Field>
        </div>
        <Check checked={blocks} disabled={frozen || ro} onChange={setBlocks} label="Imposter blocks regular tasks (a crew holding an imposter cannot solve regular tasks)" />
      </div>

      <div className={SUBCARD}>
        <Label className="mb-3">SPRINTS</Label>
        <div className="grid gap-3 sm:grid-cols-2">
          {game.sprints.map((s) => {
            const locked = s.status !== 'PENDING' || ro;
            return (
              <fieldset key={s.number} className="rounded-lg border border-[#344d5b] p-3" disabled={locked}>
                <legend className="px-1 font-mono text-[9px] tracking-widest text-[#b3c4c8]">SPRINT {s.number} {s.status !== 'PENDING' && `· ${s.status} (LOCKED)`}</legend>
                <Field label="DURATION (MINUTES)">
                  <NumInput value={durations[s.number] ?? ''} onChange={(v) => setDurations({ ...durations, [s.number]: v })} min={0.5} max={360} step={0.5} ariaLabel={`Sprint ${s.number} duration in minutes`} />
                </Field>
                <Field label="ELIMINATE COUNT (K)" hint="Blank = not configured (blocks start). 0 requires explicit acknowledgement.">
                  <NumInput value={counts[s.number] ?? ''} onChange={(v) => setCounts({ ...counts, [s.number]: v })} min={0} ariaLabel={`Sprint ${s.number} eliminate count`} />
                </Field>
              </fieldset>
            );
          })}
        </div>
        <div className="mt-3">
          <Check checked={recycle} disabled={s2?.status !== 'PENDING' || ro} onChange={setRecycle} label="Sprint 2 policy: recycle tasks solved by eliminated crews (reopen them in Sprint 2)" />
        </div>
      </div>

      <div className={SUBCARD}>
        <div className="mb-3 flex items-center justify-between">
          <Label>PRIZES {game.phase === 'COMPLETED' ? '· FROZEN' : ''}</Label>
          <Button secondary className={SMALL} disabled={ro || game.phase === 'COMPLETED' || prizes.length >= 10} onClick={() => setPrizes([...prizes, ''])}><Plus size={12} /> Add place</Button>
        </div>
        {prizes.length === 0 && <p className="text-[11px] text-muted">No prize places configured.</p>}
        <ol className="space-y-2">
          {prizes.map((p, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className={`${COIN_TEXT} w-10 text-xs`}>#{i + 1}</span>
              <input className="input !py-2" aria-label={`Prize for place ${i + 1}`} value={p} maxLength={120} disabled={ro || game.phase === 'COMPLETED'} onChange={(e) => setPrizes(prizes.map((x, j) => (j === i ? e.target.value : x)))} />
              <button type="button" aria-label={`Remove place ${i + 1}`} className="p-2 text-[#eca291] disabled:opacity-30" disabled={ro || game.phase === 'COMPLETED' || i !== prizes.length - 1} onClick={() => setPrizes(prizes.slice(0, -1))}>
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ol>
      </div>

      {editable && (
        <div className="flex justify-end">
          <Button disabled={busy === 'config'} onClick={() => void save()}>{busy === 'config' ? 'Saving…' : 'Save configuration'}</Button>
        </div>
      )}
      <p className="font-mono text-[9px] text-muted">Saves send expectedVersion {game.version}; if another commander changed the game first, the console reloads and asks you to review the latest state.</p>
    </div>
  );
}
