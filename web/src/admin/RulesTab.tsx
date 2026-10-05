/**
 * Rule review: every competition default with its confirmation state, the rule
 * editor (until rules freeze at the first sprint start) and event info.
 */
import { CheckCircle2, CircleDashed, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { V1, api } from '../lib/api';
import { Badge, Button, Field, Label } from '../components/ui';
import { CARD, Check, Loadable, Notice, NumInput, SMALL, SUBCARD, SectionHead, Select, errText, fmtTime, toApiError, useAdminData, useConsole, useRun } from './kit';
import type { RuleReviewRow, Rules } from './types';

interface RulesResponse { rules: Rules; frozenAt: string | null; version: number; isDemo: boolean; review: RuleReviewRow[] }

export function RulesTab() {
  const st = useAdminData<RulesResponse>(`${V1}/admin/rules`);
  return (
    <div className="space-y-6">
      <Loadable state={st} title="Rules">
        {(d) => (
          <>
            <Review data={d} reload={st.reload} />
            <RuleEditor data={d} reload={st.reload} />
          </>
        )}
      </Loadable>
      <EventInfo />
    </div>
  );
}

function Review({ data, reload }: { data: RulesResponse; reload: () => Promise<void> }) {
  const { can } = useConsole();
  const { run, busy } = useRun();
  const unconfirmed = data.review.filter((r) => !r.confirmed).length;
  const toggle = async (r: RuleReviewRow) => {
    if (await run(r.key, () => api.post(`${V1}/admin/rules/${r.key}/confirmation`, { confirmed: !r.confirmed }), r.confirmed ? `${r.title} un-confirmed.` : `${r.title} confirmed.`)) void reload();
  };
  return (
    <div className={CARD}>
      <SectionHead label="RULE REVIEW" title="Competition rules">
        {data.isDemo && <Badge>DEMO DEFAULTS</Badge>}
        <Badge>{unconfirmed ? `${unconfirmed} UNCONFIRMED` : 'ALL CONFIRMED'}</Badge>
        <Badge>{data.frozenAt ? `FROZEN ${fmtTime(data.frozenAt)}` : 'EDITABLE'}</Badge>
      </SectionHead>
      <p className="mb-4 text-[11px] leading-5 text-muted">
        Every rule is UNCONFIRMED until an organizer confirms it here. {data.isDemo ? 'The demo event may run on the labelled defaults; a production event requires every rule to be confirmed before the first sprint.' : 'Sprints cannot start until every rule is confirmed.'} Changing a rule removes its confirmation. Rules freeze when the first sprint of any slot starts.
      </p>
      <div className="space-y-2">
        {data.review.map((r) => (
          <div key={r.key} className={`${SUBCARD} flex flex-wrap items-start justify-between gap-3`}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {r.confirmed ? <CheckCircle2 size={14} className="text-primary" /> : <CircleDashed size={14} className="text-[#ebd68c]" />}
                <span className="font-display text-sm font-bold">{r.title}</span>
                {r.fairness && <Badge>FAIRNESS</Badge>}
                {r.confirmed ? <Badge>{`CONFIRMED · ${r.confirmed.byName}`}</Badge> : <Badge>UNCONFIRMED</Badge>}
              </div>
              <p className="mt-1 text-xs leading-5 text-[#d3dedd]">{r.description}</p>
              {r.confirmed && <div className="mt-1 font-mono text-[10px] text-muted">confirmed {fmtTime(r.confirmed.at)}</div>}
            </div>
            {can('rules.manage') && (
              <Button secondary={!!r.confirmed} className={SMALL} disabled={!!busy || (!!data.frozenAt && !!r.confirmed)} onClick={() => void toggle(r)}>
                {r.confirmed ? 'Un-confirm' : 'Confirm'}
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RuleEditor({ data, reload }: { data: RulesResponse; reload: () => Promise<void> }) {
  const { can, reloadOverview } = useConsole();
  const [r, setR] = useState<Rules>(data.rules);
  const [adv, setAdv] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ changed: string[]; notes: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setR(data.rules), [data.rules]);
  const frozen = !!data.frozenAt;
  const disabled = frozen || !can('rules.manage');

  const diff = (): Record<string, unknown> => {
    const p: Record<string, unknown> = {};
    for (const k of Object.keys(r) as (keyof Rules)[]) if (JSON.stringify(r[k]) !== JSON.stringify(data.rules[k])) p[k] = r[k];
    return p;
  };
  const save = async () => {
    setErr(null);
    let patch = diff();
    if (adv.trim()) {
      try {
        patch = { ...patch, ...(JSON.parse(adv) as Record<string, unknown>) };
      } catch {
        setErr('Advanced patch is not valid JSON.');
        return;
      }
    }
    if (!Object.keys(patch).length) {
      setErr('Nothing changed.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.patch<{ rules: Rules; changed: string[]; notes: string[] }>(`${V1}/admin/rules`, patch);
      setOut({ changed: res.changed, notes: res.notes });
      setAdv('');
      await reload();
      void reloadOverview();
    } catch (e) {
      const er = toApiError(e);
      setErr(er.code === 'RULES_FROZEN' ? 'Rules are frozen: a sprint has already started.' : errText(er));
      if (er.code === 'STALE_VERSION') void reload();
    } finally {
      setBusy(false);
    }
  };
  const num = (v: string) => (v.trim() === '' ? 0 : Number(v));
  const set = <K extends keyof Rules>(k: K, v: Rules[K]) => setR((x) => ({ ...x, [k]: v }));
  const diffs = ['EASY', 'MEDIUM', 'HARD', 'BONUS'] as const;

  return (
    <div className={CARD}>
      <SectionHead label="RULE EDITOR" title="Change rules (before the first sprint)" />
      {frozen && <div className="mb-3"><Notice tone="warn">Rules are frozen since {fmtTime(data.frozenAt)} — a sprint has started. They can no longer be changed.</Notice></div>}
      {!can('rules.manage') && <div className="mb-3"><Notice>Your role cannot change rules.</Notice></div>}
      <fieldset disabled={disabled} className="space-y-4 disabled:opacity-60">
        <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="PRESET" hint="REHEARSAL = 2-minute sprints">
            <Select ariaLabel="Preset" value={r.preset} onChange={(v) => set('preset', v)} options={['STANDARD', 'REHEARSAL', 'CUSTOM'].map((x) => ({ value: x as Rules['preset'], label: x }))} />
          </Field>
          <Field label="SPRINT MINUTES"><NumInput value={String(r.sprintMinutes)} onChange={(v) => set('sprintMinutes', num(v))} min={0.5} max={240} step={0.5} ariaLabel="Sprint minutes" /></Field>
          <Field label="QUESTION SCOPE">
            <Select ariaLabel="Question scope" value={r.questionScope} onChange={(v) => set('questionScope', v)} options={[{ value: 'FRESH_PER_SPRINT', label: 'FRESH_PER_SPRINT' }, { value: 'SLOT_POOL', label: 'SLOT_POOL' }]} />
          </Field>
          <Field label="RANKING METRIC">
            <Select ariaLabel="Ranking metric" value={r.rankingMetric} onChange={(v) => set('rankingMetric', v)} options={[{ value: 'GROSS_EARNED', label: 'GROSS_EARNED' }, { value: 'NET_COINS', label: 'NET_COINS' }]} />
          </Field>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className={SUBCARD}>
            <Label className="mb-2">REWARDS</Label>
            <div className="grid grid-cols-4 gap-2">
              {diffs.map((d) => <label key={d} className="text-[10px]"><span className="text-muted">{d}</span><NumInput value={String(r.rewards[d])} onChange={(v) => set('rewards', { ...r.rewards, [d]: num(v) })} min={0} ariaLabel={`Reward ${d}`} /></label>)}
            </div>
          </div>
          <div className={SUBCARD}>
            <Label className="mb-2">HINT COSTS</Label>
            <div className="grid grid-cols-4 gap-2">
              {diffs.map((d) => <label key={d} className="text-[10px]"><span className="text-muted">{d}</span><NumInput value={String(r.hintCosts[d])} onChange={(v) => set('hintCosts', { ...r.hintCosts, [d]: num(v) })} min={0} ariaLabel={`Hint cost ${d}`} /></label>)}
            </div>
          </div>
        </div>
        <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="STARTING WALLET"><NumInput value={String(r.startingWallet)} onChange={(v) => set('startingWallet', num(v))} min={0} ariaLabel="Starting wallet" /></Field>
          <Field label="SESSIONS PER CREW"><NumInput value={String(r.sessionLimit)} onChange={(v) => set('sessionLimit', num(v))} min={1} max={20} ariaLabel="Session limit" /></Field>
          <Field label="SESSION LIMIT POLICY">
            <Select ariaLabel="Session policy" value={r.sessionLimitPolicy} onChange={(v) => set('sessionLimitPolicy', v)} options={[{ value: 'EVICT_OLDEST', label: 'EVICT_OLDEST' }, { value: 'REJECT', label: 'REJECT' }]} />
          </Field>
          <div className="pt-6"><Check checked={r.singleRunningSlot} onChange={(v) => set('singleRunningSlot', v)} label="Only one slot may run at a time" /></div>
          <Field label="BONUS RELEASE" hint="MANUAL = you release the 10 bonus questions from time to time">
            <Select ariaLabel="Bonus release mode" value={r.bonusMode ?? 'MANUAL'} onChange={(v) => set('bonusMode', v)} options={[{ value: 'MANUAL', label: 'MANUAL (organizer)' }, { value: 'SCHEDULED', label: 'SCHEDULED (blueprint offsets)' }]} />
          </Field>
          <div className="pt-6"><Check checked={r.attendanceGatesLogin ?? true} onChange={(v) => set('attendanceGatesLogin', v)} label="Attendance enables login (crews must be marked present)" /></div>
        </div>
        <div className={SUBCARD}>
          <Check checked={r.elimination.enabled} onChange={(v) => set('elimination', { ...r.elimination, enabled: v })} label="Elimination enabled (bottom N crews after each sprint, frozen standings)" />
          {r.elimination.enabled && (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {[0, 1, 2, 3].map((i) => (
                <label key={i} className="text-[10px]"><span className="text-muted">After sprint {i + 1}</span>
                  <NumInput value={String(r.elimination.counts[i] ?? 0)} onChange={(v) => set('elimination', { ...r.elimination, counts: r.elimination.counts.map((c, j) => (j === i ? num(v) : c)) })} min={0} ariaLabel={`Eliminate after sprint ${i + 1}`} />
                </label>
              ))}
            </div>
          )}
        </div>
        <details>
          <summary className="cursor-pointer font-mono text-[10px] text-[#e6c887]">ADVANCED: blueprint / distribution as a JSON patch</summary>
          <p className="my-2 text-[10px] text-muted">Current: initialPerDomain {JSON.stringify(r.initialPerDomain)}, reservesPerSlot {r.reservesPerSlot}, bonusesPerSlot {r.bonusesPerSlot}, blueprint {JSON.stringify(r.blueprint)}</p>
          <textarea className="input min-h-[80px] font-mono text-[11px]" placeholder='{"blueprint":{"bonusOffsetsMinutes":[[8,16,24],[8,16,24],[10,20],[10,20]]}}' value={adv} onChange={(e) => setAdv(e.target.value)} />
        </details>
      </fieldset>
      {err && <div className="mt-3"><Notice tone="danger">{err}</Notice></div>}
      {out && (
        <div className="mt-3">
          <Notice>
            Saved. Changed (lost confirmation): {out.changed.length ? out.changed.join(', ') : 'none'}.
            {out.notes.map((n, i) => <div key={i}>• {n}</div>)}
          </Notice>
        </div>
      )}
      {!disabled && (
        <div className="mt-4 flex justify-end gap-2">
          <Button secondary className={SMALL} onClick={() => { setR(data.rules); setAdv(''); setErr(null); }}>Reset</Button>
          <Button className={SMALL} disabled={busy} onClick={() => void save()}><Save size={12} /> Save rules</Button>
        </div>
      )}
    </div>
  );
}

function EventInfo() {
  const { overview, can } = useConsole();
  const { run, busy } = useRun();
  const ev = overview.event;
  const [f, setF] = useState({ name: ev.name, organizer: ev.organizer, edition: ev.edition, venue: ev.venue });
  const [prizes, setPrizes] = useState(overview.prizes.map((p) => p.label));
  useEffect(() => {
    setF({ name: ev.name, organizer: ev.organizer, edition: ev.edition, venue: ev.venue });
    setPrizes(overview.prizes.map((p) => p.label));
  }, [ev.name, ev.organizer, ev.edition, ev.venue, overview.prizes]);
  if (!can('rules.manage')) return null;
  const final = ev.phase === 'FINALIZED';
  const save = () => run('event', () => api.patch(`${V1}/admin/event`, {
    ...f,
    ...(final ? {} : { prizes: prizes.map((l) => l.trim()).filter(Boolean).map((label, i) => ({ place: i + 1, label })) }),
  }), 'Event info saved.');
  return (
    <div className={CARD}>
      <SectionHead label="EVENT INFO" title="Display name, organizer, edition, venue, prizes" />
      <div className="grid gap-x-4 sm:grid-cols-2">
        {(['name', 'organizer', 'edition', 'venue'] as const).map((k) => (
          <Field key={k} label={k.toUpperCase()}><input className="input" maxLength={80} value={f[k]} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} /></Field>
        ))}
      </div>
      <Label className="mb-2">PRIZES (PLACE 1..N){final ? ' — FROZEN, RESULTS ARE FINAL' : ''}</Label>
      <div className="space-y-2">
        {prizes.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-8 font-mono text-xs">#{i + 1}</span>
            <input className="input !py-2" maxLength={80} disabled={final} value={p} onChange={(e) => setPrizes((ps) => ps.map((x, j) => (j === i ? e.target.value : x)))} />
            {!final && <button type="button" className="font-mono text-[10px] text-[#ee9582]" onClick={() => setPrizes((ps) => ps.filter((_, j) => j !== i))}>remove</button>}
          </div>
        ))}
      </div>
      {!final && prizes.length < 10 && <button type="button" className="mt-2 font-mono text-[10px] text-[#e6c887]" onClick={() => setPrizes((ps) => [...ps, ''])}>+ add prize</button>}
      <div className="mt-4 flex justify-end"><Button className={SMALL} disabled={!!busy} onClick={() => void save()}><Save size={12} /> Save event info</Button></div>
    </div>
  );
}
