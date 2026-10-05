/**
 * Overview: event header, one card per slot (grouped by day), explicit sprint
 * control with preflight, elimination review, slot / event finalization with
 * tie decisions, release-plan build and announcements.
 */
import { ArrowDown, ArrowUp, DoorClosed, DoorOpen, Flag, Hammer, Megaphone, Pause, Play, Rocket, Square, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { V1, api, type SprintDto } from '../lib/api';
import { Badge, Button, Field, Label, StatePanel, useToast } from '../components/ui';
import {
  CARD, Check, Countdown, Empty, Modal, Notice, NumInput, SMALL, SUBCARD, SectionHead, Select, errText, fmtDate, fmtDuration, fmtTime, toApiError, useConsole, useRun,
} from './kit';
import { PoolControls } from './PoolControls';
import type { OverviewSlot, Preflight, ReviewRow, TopConflict } from './types';

export function SlotsTab() {
  const { overview } = useConsole();
  const [finalize, setFinalize] = useState<{ kind: 'slot'; slot: OverviewSlot } | { kind: 'event' } | null>(null);
  const [elim, setElim] = useState<{ slot: OverviewSlot; sprint: number } | null>(null);
  const days = overview.days.length ? overview.days : [...new Set(overview.slots.map((s) => s.dayNumber))].map((n) => ({ id: String(n), day_number: n, label: `Day ${n}`, date: overview.slots.find((s) => s.dayNumber === n)?.date ?? '' }));
  return (
    <div className="space-y-6">
      <EventCard onFinalize={() => setFinalize({ kind: 'event' })} />
      {days.map((d) => {
        const slots = overview.slots.filter((s) => s.dayNumber === d.day_number);
        return (
          <section key={d.id} aria-label={`Day ${d.day_number}`}>
            <SectionHead label={`DAY ${d.day_number} · ${fmtDate(d.date)}`} title={d.label} />
            {slots.length === 0 ? <Empty>No slots on this day.</Empty> : (
              <div className="grid gap-4 xl:grid-cols-2">
                {slots.map((s) => <SlotCard key={s.id} slot={s} onFinalize={() => setFinalize({ kind: 'slot', slot: s })} onElimination={(n) => setElim({ slot: s, sprint: n })} />)}
              </div>
            )}
          </section>
        );
      })}
      <Announcements />
      {finalize && <FinalizeDialog target={finalize} onClose={() => setFinalize(null)} />}
      {elim && <EliminationDialog slot={elim.slot} sprint={elim.sprint} onClose={() => setElim(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event header
// ---------------------------------------------------------------------------

function EventCard({ onFinalize }: { onFinalize: () => void }) {
  const { overview, can } = useConsole();
  const ev = overview.event;
  const allDone = overview.slots.length > 0 && overview.slots.every((s) => s.phase === 'COMPLETED');
  const short = overview.bank.initial.filter((r) => r.have < r.need);
  const unconfirmedTitles = overview.unconfirmed.map((k) => overview.ruleReview.find((r) => r.key === k)?.title ?? k);
  return (
    <div className={CARD}>
      <SectionHead label="EVENT" title={`${ev.name} · ${ev.edition}`}>
        {ev.isDemo && <Badge>DEMO EVENT</Badge>}
        <Badge>{ev.phase === 'FINALIZED' ? 'OVERALL FINAL' : 'OVERALL PROVISIONAL'}</Badge>
        <Badge>{ev.rulesFrozenAt ? `RULES FROZEN ${fmtTime(ev.rulesFrozenAt)}` : 'RULES NOT FROZEN'}</Badge>
      </SectionHead>
      <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <KV k="ORGANIZER" v={ev.organizer} />
        <KV k="VENUE" v={ev.venue} />
        <KV k="TIMEZONE" v={ev.timezone} />
        <KV k="RANKING BASIS" v={overview.rules.rankingMetric} />
        <KV k="SPRINT LENGTH" v={`${overview.rules.preset} · ${overview.rules.preset === 'REHEARSAL' ? '2 min' : `${overview.rules.sprintMinutes} min`}`} />
        <KV k="QUESTION SCOPE" v={overview.rules.questionScope} />
        <KV k="ELIMINATION" v={overview.rules.elimination.enabled ? `ON · ${overview.rules.elimination.counts.join('/')}` : 'OFF'} />
        <KV k="PRIZES" v={overview.prizes.length ? overview.prizes.map((p) => `${p.place}. ${p.label}`).join(' · ') : '—'} />
      </div>
      <div className="mt-4 space-y-2">
        {overview.unconfirmed.length > 0 && (
          <Notice tone="warn">
            {overview.unconfirmed.length} rule(s) UNCONFIRMED{ev.isDemo ? ' (demo defaults — a production event requires every rule to be confirmed before the first sprint)' : ' — sprints cannot start until every rule is confirmed'}: {unconfirmedTitles.join(', ')}. Review them in RULES REVIEW.
          </Notice>
        )}
        {short.length > 0 && (
          <Notice tone="warn">
            Question bank short for slots without a release plan: {short.map((r) => `${r.domain}/${r.difficulty} ${r.have}/${r.need}`).join(', ')}. Reserves {overview.bank.reserves.have}/{overview.bank.reserves.need}, bonuses {overview.bank.bonuses.have}/{overview.bank.bonuses.need}.
          </Notice>
        )}
      </div>
      {overview.eventResult ? (
        <div className="mt-4">
          <Label className="mb-2">FINAL OVERALL RESULT · CONFIRMED {fmtTime(overview.eventResult.confirmed_at)}</Label>
          <Placements rows={overview.eventResult.rows} />
          {overview.eventResult.note && <p className="mt-2 text-[11px] text-muted">Decision note: {overview.eventResult.note}</p>}
        </div>
      ) : can('results.finalize') ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button className={SMALL} disabled={!allDone} onClick={onFinalize} title={allDone ? undefined : 'All four slots must be COMPLETED first'}>
            <Trophy size={12} /> Finalize overall results
          </Button>
          {!allDone && <span className="text-[11px] text-muted">Available when all four slots are COMPLETED ({overview.slots.filter((s) => s.phase === 'COMPLETED').length}/{overview.slots.length}).</span>}
        </div>
      ) : null}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <Label>{k}</Label>
      <div className="mt-1 break-words">{v}</div>
    </div>
  );
}

function Placements({ rows }: { rows: { place: number; crewId: string; name: string; score: number; slotNumber?: number; prize?: string | null }[] }) {
  return (
    <ol className="space-y-1 text-xs">
      {rows.slice(0, 10).map((r) => (
        <li key={r.crewId} className="flex flex-wrap items-center gap-2">
          <span className="w-8 font-mono text-[#e8cf8e]">#{r.place}</span>
          <span className="font-mono text-muted">{r.crewId}</span>
          <span className="font-bold">{r.name}</span>
          {r.slotNumber !== undefined && <span className="text-muted">slot {r.slotNumber}</span>}
          <span className="font-mono text-[#e8cf8e]">{r.score}</span>
          {r.prize && <Badge>{r.prize}</Badge>}
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Slot card
// ---------------------------------------------------------------------------

const PRE_START = ['CONFIGURING', 'READY', 'WAITING'];

function SlotCard({ slot, onFinalize, onElimination }: { slot: OverviewSlot; onFinalize: () => void; onElimination: (n: number) => void }) {
  const { overview, can, confirm } = useConsole();
  const { busy, run } = useRun();
  const toast = useToast();
  const cur = slot.sprints.find((s) => s.number === slot.currentSprint);
  const base = `${V1}/admin/slots/${slot.id}`;

  const start = async (n: number) => {
    let pf: Preflight;
    try {
      pf = await api.get<Preflight>(`${base}/sprints/${n}/preflight`);
    } catch (e) {
      toast(errText(e), 'alert');
      return;
    }
    const ok = await confirm({
      title: `Start ${slot.name} · sprint ${n}`,
      tone: pf.ok ? 'primary' : 'danger',
      blocked: !pf.ok,
      confirmLabel: pf.ok ? `Start sprint ${n} now` : 'Blocked by preflight',
      ack: pf.ok ? 'I reviewed the preflight. Start the sprint now (rules freeze on the first start).' : undefined,
      body: <PreflightView pf={pf} />,
      effects: pf.ok ? [`Sprint ${n} starts immediately; the timer runs on server time.`, 'The initial question set (60 questions, 10 per domain) is released to every crew in this slot.', overview.rules.bonusMode === 'SCHEDULED' ? 'Bonus releases follow their active-minute offsets.' : 'Reserves (Refill) and bonuses are released by you from the slot pools.'] : undefined,
    });
    if (!ok) return;
    await run('start', async () => {
      try {
        return await api.post(`${base}/sprints/${n}/start`, {});
      } catch (e) {
        const err = toApiError(e);
        const p = err.details?.preflight as Preflight | undefined;
        if (err.code === 'PREFLIGHT_FAILED' && p) throw new Error(`Preflight failed: ${p.blockers.join(' ')}`);
        throw err;
      }
    }, `Sprint ${n} started in ${slot.name}.`);
  };

  const pause = () => run('pause', () => api.post(`${base}/sprints/${slot.currentSprint}/pause`, {}), 'Sprint paused — timer and releases stopped.');
  const resume = () => run('resume', () => api.post(`${base}/sprints/${slot.currentSprint}/resume`, {}), 'Sprint resumed — the deadline shifted by the pause.');
  const close = async () => {
    const r = await confirm({
      title: `Close sprint ${slot.currentSprint} early`,
      effects: ['Standings freeze now.', 'Unsolved fresh questions expire; unreleased releases of this sprint are cancelled (never replayed).', 'Running code jobs are cancelled.'],
      reason: { label: 'REASON FOR CLOSING EARLY', min: 4 },
      confirmLabel: 'Close sprint',
    });
    if (!r) return;
    await run('close', () => api.post(`${base}/sprints/${slot.currentSprint}/close`, { note: r.reason }), 'Sprint closed. Standings frozen.');
  };
  const plan = async () => {
    const existing = slot.releases.length;
    const ok = await confirm({
      title: `Build release plan · ${slot.name}`,
      tone: 'warning',
      effects: [
        'Creates the slot plan: 4 × 60 initial questions (one fresh set per sprint), a 20-question reserve pool for refills and a 10-question bonus pool.',
        existing ? `Replaces the existing unreleased plan (${existing} release(s)).` : 'No plan exists yet.',
        'Picks unused PUBLISHED questions only (never auto-publishes).',
      ],
      confirmLabel: 'Build plan',
    });
    if (!ok) return;
    await run('plan', () => api.post<{ instances: number }>(`${base}/plan`, {}), (r) => `Plan built: ${r.instances} question instance(s).`);
  };

  const openSlot = async () => {
    const ok = await confirm({
      title: `Open ${slot.name} (kick-in)`,
      tone: 'primary',
      effects: [
        `Crews of ${slot.name} that are marked present can sign in, board the ship and roam.`,
        `${slot.counts.checked_in} of ${slot.counts.crews} crews are marked present${slot.counts.absent ? ` — ${slot.counts.absent} still absent (they cannot sign in until marked present)` : ''}.`,
        'No sprint starts and no question is visible until you start Sprint 1.',
      ],
      confirmLabel: 'Open slot',
    });
    if (!ok) return;
    await run('open', () => api.post(`${base}/open`, {}), `${slot.name} is open — crews can board.`);
  };
  const closeBoarding = async () => {
    const r = await confirm({
      title: `Close boarding · ${slot.name}`,
      tone: 'warning',
      effects: ['Signed-in crews of this slot return to the waiting screen.', 'Only possible before Sprint 1 starts.'],
      reason: { label: 'REASON', min: 4 },
      confirmLabel: 'Close boarding',
    });
    if (!r) return;
    await run('closeBoarding', () => api.post(`${base}/close-boarding`, { reason: r.reason }), 'Boarding closed.');
  };

  const elimOn = overview.rules.elimination.enabled;
  const closedSprints = slot.sprints.filter((s) => s.status === 'CLOSED');

  return (
    <article className={CARD} aria-label={slot.name}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <Label>{`SLOT ${slot.number} · ${slot.dayLabel ?? ''} · ${fmtDate(slot.date)}`}</Label>
          <h3 className="mt-1 font-display text-lg font-bold">{slot.name}</h3>
          {slot.scheduledStartAt && <div className="text-[11px] text-muted">Scheduled (informational): {fmtTime(slot.scheduledStartAt)}</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>{slot.openedAt ? 'BOARDING OPEN' : 'NOT OPEN'}</Badge>
          <Badge>{slot.phase}</Badge>
          {slot.currentSprint > 0 && <Badge>{`SPRINT ${slot.currentSprint}/4`}</Badge>}
        </div>
      </div>
      <div className="mb-3 grid grid-cols-4 gap-2 text-center">
        <Stat k="CREWS" v={`${slot.counts.crews}/${slot.capacity}`} />
        <Stat k="ENABLED" v={slot.counts.enabled} />
        <Stat k="PRESENT" v={`${slot.counts.checked_in}/${slot.counts.crews}`} />
        <Stat k="SESSIONS" v={slot.counts.sessions} />
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {slot.sprints.map((sp) => <SprintChip key={sp.id} sp={sp} current={sp.number === slot.currentSprint} />)}
      </div>
      {slot.releases.length === 0 && PRE_START.includes(slot.phase) && <div className="mb-3"><Notice tone="warn">No release plan yet. Build it before opening the slot.</Notice></div>}
      {!slot.openedAt && slot.releases.length > 0 && slot.phase !== 'COMPLETED' && (
        <div className="mb-3">
          <Notice tone="info">
            Step 1 · mark attendance (CREWS → roster) · Step 2 · <b>Open slot</b> so present crews can board and roam · Step 3 · start Sprint 1 when you approve.
          </Notice>
        </div>
      )}
      {slot.preflight && !slot.preflight.ok && slot.nextSprint && (
        <div className="mb-3"><Notice tone="danger">Sprint {slot.nextSprint} blocked: {slot.preflight.blockers.join(' ')}</Notice></div>
      )}

      <div className="flex flex-wrap gap-2">
        {can('slots.control') && !slot.openedAt && slot.phase !== 'COMPLETED' && (
          <Button className={SMALL} disabled={!!busy || slot.releases.length === 0} onClick={() => void openSlot()}>
            <DoorOpen size={12} /> Open slot (kick-in)
          </Button>
        )}
        {can('slots.control') && slot.openedAt && slot.currentSprint === 0 && (
          <Button secondary className={SMALL} disabled={!!busy} onClick={() => void closeBoarding()}>
            <DoorClosed size={12} /> Close boarding
          </Button>
        )}
        {can('slots.control') && slot.nextSprint && (
          <Button className={SMALL} disabled={!!busy || !slot.openedAt} title={slot.openedAt ? undefined : 'Open the slot first'} onClick={() => void start(slot.nextSprint!)}>
            <Rocket size={12} /> Start sprint {slot.nextSprint}
          </Button>
        )}
        {can('slots.control') && cur?.status === 'RUNNING' && (
          <Button secondary className={SMALL} disabled={!!busy} onClick={() => void pause()}><Pause size={12} /> Pause</Button>
        )}
        {can('slots.control') && cur?.status === 'PAUSED' && (
          <Button className={SMALL} disabled={!!busy} onClick={() => void resume()}><Play size={12} /> Resume</Button>
        )}
        {can('slots.control') && (cur?.status === 'RUNNING' || cur?.status === 'PAUSED') && (
          <Button danger className={SMALL} disabled={!!busy} onClick={() => void close()}><Square size={12} /> Close early</Button>
        )}
        {can('slots.control') && elimOn && closedSprints.map((sp) => (
          <Button key={sp.id} secondary className={SMALL} onClick={() => onElimination(sp.number)}><Flag size={12} /> Elimination review · sprint {sp.number}</Button>
        ))}
        {can('results.finalize') && slot.phase === 'REVIEW' && (
          <Button className={SMALL} onClick={onFinalize}><Trophy size={12} /> Finalize slot</Button>
        )}
        {can('releases.manage') && slot.currentSprint === 0 && PRE_START.includes(slot.phase) && (
          <Button secondary className={SMALL} disabled={!!busy} onClick={() => void plan()}><Hammer size={12} /> {slot.releases.length ? 'Rebuild release plan' : 'Build release plan'}</Button>
        )}
      </div>

      {slot.openedAt && slot.currentSprint > 0 && slot.phase !== 'COMPLETED' && (
        <div className="mt-4">
          <PoolControls slotId={slot.id} compact />
        </div>
      )}
      {slot.result && (
        <div className={`${SUBCARD} mt-4`}>
          <Label className="mb-2">SLOT RESULT · FINAL · {fmtTime(slot.result.confirmed_at)}</Label>
          <Placements rows={slot.result.rows} />
          {slot.result.note && <p className="mt-2 text-[11px] text-muted">Decision note: {slot.result.note}</p>}
        </div>
      )}
      {can('slots.control') && <SlotSettings slot={slot} />}
    </article>
  );
}

function Stat({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="rounded-lg border border-[#344d5b] bg-[#112a35] px-2 py-2">
      <div className="font-mono text-sm text-[#e8cf8e]">{v}</div>
      <div className="font-mono text-[8px] tracking-wider text-muted">{k}</div>
    </div>
  );
}

function SprintChip({ sp, current }: { sp: SprintDto; current: boolean }) {
  const live = sp.status === 'RUNNING' || sp.status === 'PAUSED';
  return (
    <div className={`rounded-lg border-2 p-2 text-center ${current && live ? 'border-[#8ae4cf] bg-[#173f45]' : 'border-[#344d5b] bg-[#112a35]'}`}>
      <div className="font-mono text-[9px] tracking-wider text-muted">SPRINT {sp.number}</div>
      <div className="my-1 font-display text-[10px] font-bold">{sp.status}</div>
      {live ? <Countdown deadline={sp.deadlineAt} pausedAt={sp.status === 'PAUSED' ? sp.pausedAt : null} className="text-sm" /> : <div className="font-mono text-[10px] text-muted">{sp.status === 'READY' ? fmtDuration(sp.durationSeconds) : sp.closedAt ? `closed ${new Date(sp.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '—'}</div>}
      {sp.status === 'PAUSED' && <div className="mt-1 font-mono text-[9px] text-[#ebd68c]">PAUSED</div>}
      {sp.eliminateCount > 0 && <div className="mt-1 font-mono text-[9px] text-[#ee9582]">−{sp.eliminateCount} after</div>}
    </div>
  );
}

function PreflightView({ pf }: { pf: Preflight }) {
  return (
    <div className="space-y-3">
      {pf.blockers.length > 0 && (
        <div>
          <Label className="mb-1 !text-[#ee9582]">BLOCKERS — THE SPRINT CANNOT START</Label>
          <ul className="list-disc space-y-1 pl-5 text-[#f3b399]">{pf.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </div>
      )}
      {pf.warnings.length > 0 && (
        <div>
          <Label className="mb-1 !text-[#ebd68c]">WARNINGS</Label>
          <ul className="list-disc space-y-1 pl-5 text-[#ebd68c]">{pf.warnings.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </div>
      )}
      {pf.summary.length > 0 && (
        <div>
          <Label className="mb-1">SUMMARY</Label>
          <ul className="list-disc space-y-1 pl-5">{pf.summary.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function SlotSettings({ slot }: { slot: OverviewSlot }) {
  const { run, busy } = useRun();
  const [cap, setCap] = useState(String(slot.capacity));
  const [name, setName] = useState(slot.name);
  useEffect(() => {
    setCap(String(slot.capacity));
    setName(slot.name);
  }, [slot.capacity, slot.name]);
  const preStart = slot.currentSprint === 0 && PRE_START.includes(slot.phase);
  return (
    <details className="mt-4">
      <summary className="cursor-pointer font-mono text-[10px] tracking-wider text-[#e6c887]">SLOT SETTINGS</summary>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block font-mono text-[9px] text-muted">NAME</span>
          <input className="input !py-2" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block w-24">
          <span className="mb-1 block font-mono text-[9px] text-muted">CAPACITY</span>
          <NumInput value={cap} onChange={setCap} min={1} max={500} ariaLabel="Capacity" />
        </label>
        <Button secondary className={SMALL} disabled={!!busy} onClick={() => void run('slot', () => api.patch(`${V1}/admin/slots/${slot.id}`, { name: name.trim(), capacity: Number(cap) }), 'Slot updated.')}>Save</Button>
        {preStart && (
          <label className="block">
            <span className="mb-1 block font-mono text-[9px] text-muted">READINESS</span>
            <Select
              ariaLabel="Slot readiness"
              value={slot.phase as 'CONFIGURING' | 'READY' | 'WAITING'}
              options={[{ value: 'CONFIGURING', label: 'CONFIGURING' }, { value: 'READY', label: 'READY' }, { value: 'WAITING', label: 'WAITING' }]}
              onChange={(v) => void run('phase', () => api.patch(`${V1}/admin/slots/${slot.id}`, { phase: v }), `Slot marked ${v}.`)}
            />
          </label>
        )}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Elimination review (only when the elimination rule is enabled)
// ---------------------------------------------------------------------------

interface ElimReview {
  k: number;
  enabled: boolean;
  preview: { activeCount: number; eliminateCount: number; survivors: number; proposed: string[]; tie: { score: number; tiedEnrollmentIds: string[]; needFromTie: number; strictlyBelow: string[] } | null };
  rows: { enrollmentId: string; crewId: string; name: string; cumulative: number; rank: number | null }[];
}

function EliminationDialog({ slot, sprint, onClose }: { slot: OverviewSlot; sprint: number; onClose: () => void }) {
  const { run, busy } = useRun();
  const [data, setData] = useState<ElimReview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'RETAIN_TIED' | 'ELIMINATE_TIED' | 'MANUAL_TIEBREAK'>('RETAIN_TIED');
  const [pick, setPick] = useState<string[]>([]);
  const [note, setNote] = useState('');
  useEffect(() => {
    api.get<ElimReview>(`${V1}/admin/slots/${slot.id}/sprints/${sprint}/elimination-review`).then(setData, (e) => setErr(errText(e)));
  }, [slot.id, sprint]);
  const tie = data?.preview.tie ?? null;
  const out = new Set(tie ? [...tie.strictlyBelow, ...(mode === 'ELIMINATE_TIED' ? tie.tiedEnrollmentIds : mode === 'MANUAL_TIEBREAK' ? pick : [])] : data?.preview.proposed ?? []);
  const valid = !tie || (note.trim().length >= 8 && (mode !== 'MANUAL_TIEBREAK' || pick.length === tie.needFromTie));
  const submit = async () => {
    const r = await run('final', () => api.post<{ eliminated: string[] }>(`${V1}/admin/slots/${slot.id}/sprints/${sprint}/finalize`, tie ? { resolution: { mode, note: note.trim(), eliminateEnrollmentIds: mode === 'MANUAL_TIEBREAK' ? pick : undefined } } : {}), (x) => `Sprint ${sprint} finalized; ${x.eliminated.length} crew(s) eliminated.`);
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} title={`${slot.name} · sprint ${sprint} elimination review`} label="FROZEN STANDINGS" wide>
      {err && <StatePanel kind="error" title="Review unavailable" message={err} />}
      {!data && !err && <StatePanel kind="loading" title="Loading frozen standings…" />}
      {data && (
        <div className="space-y-4 text-xs">
          <Notice tone={data.k > 0 ? 'warn' : 'info'}>
            {data.k > 0 ? `Configured: eliminate the bottom ${data.k} of ${data.preview.activeCount} active crew(s) based on the frozen cumulative standings.` : 'No elimination configured for this sprint — finalizing only locks it.'}
          </Notice>
          {tie && (
            <div className={SUBCARD}>
              <Label className="mb-2 !text-[#ebd68c]">TIE AT THE CUTOFF — SCORE {tie.score} · {tie.tiedEnrollmentIds.length} CREWS · {tie.needFromTie} MUST GO</Label>
              <div className="flex flex-wrap gap-4">
                {(['RETAIN_TIED', 'ELIMINATE_TIED', 'MANUAL_TIEBREAK'] as const).map((m) => (
                  <label key={m} className="flex items-center gap-2"><input type="radio" name="tie-mode" checked={mode === m} onChange={() => setMode(m)} className="accent-[#8ae4cf]" /> {m.replace('_', ' ')}</label>
                ))}
              </div>
              <Field label="PUBLISHED DECISION NOTE (MIN 8 CHARACTERS)">
                <textarea className="input min-h-[60px]" value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>
          )}
          <table className="w-full text-left">
            <thead className="font-mono text-[9px] text-muted"><tr><th className="p-2">RANK</th><th className="p-2">CREW</th><th className="p-2">CUMULATIVE</th><th className="p-2">OUTCOME</th></tr></thead>
            <tbody>
              {data.rows.map((r) => {
                const tied = tie?.tiedEnrollmentIds.includes(r.enrollmentId);
                return (
                  <tr key={r.enrollmentId} className="border-t border-[#344d5b]">
                    <td className="p-2 font-mono">{r.rank ?? '—'}</td>
                    <td className="p-2"><span className="font-mono text-muted">{r.crewId}</span> {r.name}</td>
                    <td className="p-2 font-mono text-[#e8cf8e]">{r.cumulative}</td>
                    <td className="p-2">
                      {tied && mode === 'MANUAL_TIEBREAK' ? (
                        <Check checked={pick.includes(r.enrollmentId)} onChange={(v) => setPick((p) => (v ? [...p, r.enrollmentId] : p.filter((x) => x !== r.enrollmentId)))} label="eliminate" />
                      ) : out.has(r.enrollmentId) ? <Badge>ELIMINATED</Badge> : tied ? <Badge>TIED · RETAINED</Badge> : <Badge>SAFE</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex justify-end gap-2">
            <Button secondary className={SMALL} onClick={onClose}>Cancel</Button>
            <Button danger className={SMALL} disabled={!valid || !!busy} onClick={() => void submit()}>Finalize sprint {sprint}{out.size ? ` (eliminate ${out.size})` : ''}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Slot / event finalization with tie decisions
// ---------------------------------------------------------------------------

interface ReviewData {
  rows: ReviewRow[];
  conflicts: TopConflict[];
  prizes?: { place: number; label: string }[];
}

function FinalizeDialog({ target, onClose }: { target: { kind: 'slot'; slot: OverviewSlot } | { kind: 'event' }; onClose: () => void }) {
  const { run, busy } = useRun();
  const [data, setData] = useState<ReviewData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'SHARE' | 'MANUAL_ORDER'>('SHARE');
  const [order, setOrder] = useState<string[][]>([]);
  const [note, setNote] = useState('');
  const isEvent = target.kind === 'event';
  const reviewUrl = isEvent ? `${V1}/admin/event/results-review` : `${V1}/admin/slots/${target.slot.id}/results-review`;
  const finalizeUrl = isEvent ? `${V1}/admin/event/finalize` : `${V1}/admin/slots/${target.slot.id}/finalize`;

  useEffect(() => {
    api.get<{ rows?: ReviewRow[]; board?: { active: ReviewRow[] }; conflicts: TopConflict[]; prizes?: { place: number; label: string }[] }>(reviewUrl).then(
      (r) => {
        const rows = r.rows ?? r.board?.active ?? [];
        setData({ rows, conflicts: r.conflicts, prizes: r.prizes });
        setOrder(r.conflicts.map((c) => [...c.enrollmentIds]));
      },
      (e) => setErr(errText(e)),
    );
  }, [reviewUrl]);

  const byId = new Map((data?.rows ?? []).map((r) => [r.enrollmentId, r]));
  const hasTies = (data?.conflicts.length ?? 0) > 0;
  const valid = !hasTies || note.trim().length >= 8;
  const move = (g: number, i: number, d: -1 | 1) => setOrder((o) => o.map((grp, gi) => {
    if (gi !== g) return grp;
    const n = [...grp];
    const j = i + d;
    if (j < 0 || j >= n.length) return grp;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  }));
  const submit = async () => {
    const body = hasTies ? { resolution: { mode, note: note.trim(), order: mode === 'MANUAL_ORDER' ? order.flat() : undefined } } : {};
    const r = await run('finalize', async () => {
      try {
        return await api.post(finalizeUrl, body);
      } catch (e) {
        const er = toApiError(e);
        if (er.code === 'TIE_RESOLUTION_REQUIRED' && Array.isArray(er.details?.conflicts)) {
          const c = er.details!.conflicts as TopConflict[];
          setData((d) => (d ? { ...d, conflicts: c } : d));
          setOrder(c.map((x) => [...x.enrollmentIds]));
        }
        throw er;
      }
    }, isEvent ? 'Overall results are FINAL.' : 'Slot result frozen.');
    if (r) onClose();
  };

  return (
    <Modal open onClose={onClose} title={isEvent ? 'Finalize overall results' : `Finalize ${target.slot.name}`} label="RESULT REVIEW" wide>
      {err && <StatePanel kind="error" title="Review unavailable" message={err} />}
      {!data && !err && <StatePanel kind="loading" title="Loading standings…" />}
      {data && (
        <div className="space-y-4 text-xs">
          <Notice tone="warn">
            {isEvent ? 'Freezes the overall ranking across all four slots and assigns prizes. This cannot be undone.' : 'Freezes this slot’s cumulative ranking after sprint 4. This cannot be undone.'}
          </Notice>
          <table className="w-full text-left">
            <thead className="font-mono text-[9px] text-muted"><tr><th className="p-2">RANK</th><th className="p-2">CREW</th>{isEvent && <th className="p-2">SLOT</th>}<th className="p-2">SCORE</th></tr></thead>
            <tbody>
              {data.rows.slice(0, 15).map((r) => (
                <tr key={r.enrollmentId} className="border-t border-[#344d5b]">
                  <td className="p-2 font-mono">{r.rank ?? '—'}</td>
                  <td className="p-2"><span className="font-mono text-muted">{r.crewId}</span> {r.name}</td>
                  {isEvent && <td className="p-2">{r.slotNumber}</td>}
                  <td className="p-2 font-mono text-[#e8cf8e]">{r.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasTies ? (
            <div className={SUBCARD}>
              <Label className="mb-2 !text-[#ebd68c]">TIE INVOLVING THE TOP PLACES — A PUBLISHED DECISION IS REQUIRED (NEVER BY TEAM ID)</Label>
              <div className="mb-3 flex flex-wrap gap-4">
                <label className="flex items-center gap-2"><input type="radio" name="place-mode" checked={mode === 'SHARE'} onChange={() => setMode('SHARE')} className="accent-[#8ae4cf]" /> SHARE (joint placement)</label>
                <label className="flex items-center gap-2"><input type="radio" name="place-mode" checked={mode === 'MANUAL_ORDER'} onChange={() => setMode('MANUAL_ORDER')} className="accent-[#8ae4cf]" /> MANUAL ORDER (published tiebreak)</label>
              </div>
              {order.map((grp, g) => (
                <div key={g} className="mb-3">
                  <div className="mb-1 font-mono text-[10px] text-muted">Score {data.conflicts[g]?.score} · positions {data.conflicts[g]?.positions.join(', ')}</div>
                  <ol className="space-y-1">
                    {grp.map((id, i) => (
                      <li key={id} className="flex items-center gap-2">
                        {mode === 'MANUAL_ORDER' && (
                          <>
                            <span className="w-5 font-mono">{i + 1}.</span>
                            <button aria-label="Move up" className="rounded border border-[#52717e] p-1 disabled:opacity-30" disabled={i === 0} onClick={() => move(g, i, -1)}><ArrowUp size={10} /></button>
                            <button aria-label="Move down" className="rounded border border-[#52717e] p-1 disabled:opacity-30" disabled={i === grp.length - 1} onClick={() => move(g, i, 1)}><ArrowDown size={10} /></button>
                          </>
                        )}
                        <span className="font-mono text-muted">{byId.get(id)?.crewId ?? id.slice(0, 8)}</span> {byId.get(id)?.name}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
              <Field label="DECISION NOTE (MIN 8 CHARACTERS — PUBLISHED AND AUDITED)">
                <textarea className="input min-h-[60px]" value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>
          ) : (
            <Notice>No ties involve the top places.</Notice>
          )}
          <div className="flex justify-end gap-2">
            <Button secondary className={SMALL} onClick={onClose}>Cancel</Button>
            <Button danger className={SMALL} disabled={!valid || !!busy} onClick={() => void submit()}><Trophy size={12} /> {isEvent ? 'Finalize overall results' : 'Finalize slot'}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

function Announcements() {
  const { overview, can } = useConsole();
  const { run, busy } = useRun();
  const [slotId, setSlotId] = useState<string>('ALL');
  const [kind, setKind] = useState<'INFO' | 'ALERT'>('INFO');
  const [msg, setMsg] = useState('');
  if (!can('slots.control')) return null;
  const send = async () => {
    const r = await run('ann', () => api.post(`${V1}/admin/announcements`, { slotId: slotId === 'ALL' ? null : slotId, message: msg.trim(), kind }), 'Announcement sent.');
    if (r) setMsg('');
  };
  return (
    <div className={CARD}>
      <SectionHead label="SHIP-WIDE COMMS" title="Announcement" />
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <textarea className="input min-h-[60px]" maxLength={500} placeholder="Message to crews (max 500 characters)" value={msg} onChange={(e) => setMsg(e.target.value)} aria-label="Announcement message" />
        <Select ariaLabel="Audience" value={slotId} onChange={setSlotId} options={[{ value: 'ALL', label: 'Everyone' }, ...overview.slots.map((s) => ({ value: s.id, label: s.name }))]} />
        <Select ariaLabel="Kind" value={kind} onChange={setKind} options={[{ value: 'INFO', label: 'INFO' }, { value: 'ALERT', label: 'ALERT' }]} />
      </div>
      <div className="mt-3 flex justify-end">
        <Button className={SMALL} disabled={!msg.trim() || !!busy} onClick={() => void send()}><Megaphone size={12} /> Send</Button>
      </div>
    </div>
  );
}
