/**
 * Slot question control — what each slot's crews can see, per domain × difficulty.
 *
 *  - Live stock matrix (6 IDEALab domains × Easy / Medium / Hard): active vs the
 *    target (rule initialPerDomain, default 7/5/3), solved, queued for the next
 *    sprint start, and how many bank questions are still new to this slot.
 *  - Top up: auto-picks published bank questions (new to the slot first, then the
 *    least used) to bring a cell / domain / every low cell back to target, or +1.
 *  - Pick & release from the bank: the organizer chooses exact questions, as
 *    regular or BONUS, released NOW (running sprint) or at the NEXT sprint start.
 *  - Initial set editor: before Sprint 1 the auto-built set can be pruned,
 *    extended from the bank or rebuilt with other counts.
 * Previously used questions may be released again (organizer's choice).
 * Server: server/src/services/bank.ts.
 */
import { ExternalLink, Hammer, PackagePlus, Plus, RefreshCw, Siren, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { V1, api } from '../lib/api';
import { Badge, Button, Field, Label } from '../components/ui';
import {
  CARD, Check, Empty, Loadable, Modal, Notice, NumInput, SMALL, SUBCARD, SectionHead, Segmented, intOrNull, useAdminData, useConsole, useRun, type Loaded,
} from './kit';
import { DIFFS, type BankResponse, type Difficulty, type OverviewSlot, type PlannedRow, type SlotBankRow, type SlotStock, type StockCell, type StockDomain, type TopUpResult } from './types';

const FINISHED = ['REVIEW', 'COMPLETED'];
const DIFF_SHORT: Record<Difficulty, string> = { EASY: 'E', MEDIUM: 'M', HARD: 'H' };
const DIFF_LABEL: Record<Difficulty, string> = { EASY: 'Easy', MEDIUM: 'Medium', HARD: 'Hard' };

type When = 'NOW' | 'NEXT_START';

/** What counts toward the target right now: active, plus queued questions while releases wait for the next start. */
function have(c: StockCell, when: When) {
  return c.active + (when === 'NEXT_START' ? c.planned : 0);
}

function tone(h: number, target: number): 'ok' | 'warn' | 'bad' | 'none' {
  if (target <= 0) return 'none';
  if (h >= target) return 'ok';
  if (h === 0 || h < target / 2) return 'bad';
  return 'warn';
}
const TONE_BOX: Record<ReturnType<typeof tone>, string> = {
  ok: 'border-[#344d5b] bg-[#112a35]',
  none: 'border-[#344d5b] bg-[#112a35]',
  warn: 'border-[#c9a45c] bg-[#3a3424]',
  bad: 'border-[#b8705f] bg-[#442b34]',
};
const TONE_TEXT: Record<ReturnType<typeof tone>, string> = { ok: 'text-[#9fe0c9]', none: 'text-muted', warn: 'text-[#ebd68c]', bad: 'text-[#ee9582]' };

function whenOf(stock: SlotStock): When {
  return stock.running ? 'NOW' : 'NEXT_START';
}
function whenText(stock: SlotStock) {
  if (FINISHED.includes(stock.slot.phase)) return 'slot finished — no more releases';
  if (stock.running) return 'NOW (sprint running)';
  if (stock.slot.currentSprint === 0) return 'AT SPRINT 1 START (initial set)';
  return 'AT THE NEXT SPRINT START';
}

export function useSlotStock(slotId: string) {
  const [poll, setPoll] = useState(false);
  const st = useAdminData<SlotStock>(`${V1}/admin/slots/${slotId}/stock`, { pollMs: poll ? 10_000 : undefined });
  const running = !!st.data?.running;
  if (running !== poll) setPoll(running);
  return st;
}

/** Shared top-up command (confirm → POST top-up → toast). */
function useTopUp(stock: SlotStock | null, after: () => void) {
  const { confirm, can } = useConsole();
  const { run, busy } = useRun();
  const allowed = !!stock && can('releases.manage') && !FINISHED.includes(stock.slot.phase);
  const topUp = async (f: { domain?: string; difficulty?: Difficulty; count?: number }, what: string) => {
    if (!stock) return;
    const when = whenOf(stock);
    const ok = await confirm({
      title: `Top up · ${what}`,
      tone: 'primary',
      effects: [
        f.count
          ? `Adds ${f.count} question(s) for each selected domain / difficulty.`
          : `Adds enough questions to bring each selected domain / difficulty back to its target (${DIFFS.map((d) => `${stock.targets[d]} ${DIFF_LABEL[d].toLowerCase()}`).join(', ')}).`,
        'Auto-picks PUBLISHED bank questions — new to this slot first, then the least used (previously used questions may be reused).',
        when === 'NOW' ? 'Every crew of this slot sees them immediately.' : 'They are queued and released when the next sprint starts.',
      ],
      confirmLabel: when === 'NOW' ? 'Release now' : 'Queue for next start',
    });
    if (!ok) return;
    await run(`top-${what}`, () => api.post<TopUpResult>(`${V1}/admin/slots/${stock.slotId}/top-up`, f), (r) => {
      const base = r.released ? `${r.released} question(s) ${r.when === 'NOW' ? 'released now' : 'queued for the next sprint start'}.` : r.message ?? 'Nothing to top up.';
      return r.short.length ? `${base} Bank ran short for: ${r.short.join(', ')}.` : base;
    });
    after();
  };
  return { topUp, busy, allowed };
}

// ---------------------------------------------------------------------------
// Full control (RELEASES tab)
// ---------------------------------------------------------------------------

export function QuestionControl({ slot }: { slot: OverviewSlot }) {
  const { can } = useConsole();
  const stock = useSlotStock(slot.id);
  const plan = useAdminData<PlannedRow[]>(`${V1}/admin/slots/${slot.id}/plan`);
  const [picker, setPicker] = useState<{ when: When; domain?: string; difficulty?: Difficulty; bonus?: boolean } | null>(null);
  const reloadAll = () => {
    void stock.reload();
    void plan.reload();
  };
  const domains = stock.data?.domains.map((d) => ({ slug: d.slug, name: d.name })) ?? [];
  return (
    <>
      <div className={CARD}>
        <Loadable state={stock} title="Question stock">
          {(s) => (
            <StockMatrix
              stock={s}
              onChanged={reloadAll}
              onPick={can('content.read') && can('releases.manage') ? (o) => setPicker({ when: whenOf(s), ...o }) : undefined}
            />
          )}
        </Loadable>
      </div>
      <PlanEditor slot={slot} plan={plan} stockDomains={stock.data?.domains ?? []} onChanged={reloadAll} onAdd={can('content.read') && can('releases.manage') ? () => setPicker({ when: 'NEXT_START' }) : undefined} />
      {picker && stock.data && (
        <BankPicker
          slotId={slot.id}
          domains={domains}
          running={stock.data.running}
          initial={picker}
          onClose={() => setPicker(null)}
          onDone={() => {
            setPicker(null);
            reloadAll();
          }}
        />
      )}
    </>
  );
}

function StockMatrix({ stock, onChanged, onPick }: { stock: SlotStock; onChanged: () => void; onPick?: (o: { domain?: string; difficulty?: Difficulty; bonus?: boolean }) => void }) {
  const { topUp, busy, allowed } = useTopUp(stock, onChanged);
  const when = whenOf(stock);
  const finished = FINISHED.includes(stock.slot.phase);
  const lowCells = stock.domains.flatMap((d) => DIFFS.filter((x) => have(d.byDifficulty[x], when) < d.byDifficulty[x].target).map((x) => `${d.slug}/${x}`));
  const totalHave = stock.domains.reduce((a, d) => a + DIFFS.reduce((b, x) => b + have(d.byDifficulty[x], when), 0), 0);
  return (
    <div>
      <SectionHead label={`LIVE STOCK · SLOT ${stock.slot.number}`} title={`${stock.slot.name} · questions per domain`}>
        <Badge>{stock.sprint ? `SPRINT ${stock.sprint.number} · ${stock.sprint.status}` : 'BEFORE SPRINT 1'}</Badge>
        <Badge>{stock.running ? 'LIVE' : stock.slot.phase}</Badge>
      </SectionHead>
      <div className="mb-3 grid gap-2 text-center sm:grid-cols-4">
        <Tile k="ACTIVE NOW" v={`${stock.totals.active}/${stock.totals.target}`} />
        <Tile k="QUEUED FOR NEXT START" v={stock.totals.planned} />
        <Tile k="BONUS ACTIVE · SOLVED · RELEASED" v={`${stock.bonus.active} · ${stock.bonus.solved} · ${stock.bonus.released}`} />
        <Tile k="RELEASES GO OUT" v={whenText(stock)} small />
      </div>
      <p className="mb-3 text-[11px] leading-5 text-muted">
        Target per domain: {DIFFS.map((d) => `${stock.targets[d]} ${DIFF_LABEL[d].toLowerCase()}`).join(' · ')} (rule <i>initial per domain</i>). Cells turn amber / red when {when === 'NOW' ? 'active' : 'active + queued'} questions drop below target.
        Previously used questions may be released again — top-ups prefer questions new to this slot, then the least used.
        {stock.running ? ' Refreshes every 10 s while the sprint runs.' : ''}
      </p>
      {(allowed || onPick) && !finished && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {allowed && (
            <Button className={SMALL} disabled={!!busy || lowCells.length === 0} onClick={() => void topUp({}, 'all low cells')} title={lowCells.length ? lowCells.join(', ') : 'Every cell is at target'}>
              <PackagePlus size={12} /> Top up all low ({lowCells.length})
            </Button>
          )}
          {onPick && (
            <Button secondary className={SMALL} onClick={() => onPick({})}>
              <Plus size={12} /> Pick &amp; release from bank
            </Button>
          )}
          {onPick && (
            <Button danger className={SMALL} onClick={() => onPick({ bonus: true })}>
              <Siren size={12} /> Release bonus…
            </Button>
          )}
          <span className="font-mono text-[10px] text-muted">{totalHave}/{stock.totals.target} {when === 'NOW' ? 'active' : 'active + queued'}</span>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-[#344d5b]">
        <table className="w-full min-w-[860px] text-left text-xs" aria-label="Question stock by domain and difficulty">
          <thead className="border-b border-[#496370] font-mono text-[9px] tracking-wider text-muted">
            <tr>
              <th className="p-3 font-normal">DOMAIN</th>
              {DIFFS.map((d) => <th key={d} className="p-3 font-normal">{d} · TARGET {stock.targets[d]}</th>)}
              <th className="p-3 font-normal">TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {stock.domains.map((d) => (
              <DomainRow key={d.slug} d={d} when={when} canAct={allowed && !finished} busy={!!busy} onTopUp={topUp} onPick={onPick && !finished ? onPick : undefined} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tile({ k, v, small }: { k: string; v: string | number; small?: boolean }) {
  return (
    <div className="rounded-lg border border-[#344d5b] bg-[#112a35] px-2 py-2">
      <div className={`font-mono text-[#e8cf8e] ${small ? 'text-[11px]' : 'text-sm'}`}>{v}</div>
      <div className="font-mono text-[8px] tracking-wider text-muted">{k}</div>
    </div>
  );
}

function DomainRow({ d, when, canAct, busy, onTopUp, onPick }: {
  d: StockDomain; when: When; canAct: boolean; busy: boolean;
  onTopUp: (f: { domain?: string; difficulty?: Difficulty; count?: number }, what: string) => Promise<void>;
  onPick?: (o: { domain?: string; difficulty?: Difficulty }) => void;
}) {
  const dh = DIFFS.reduce((a, x) => a + have(d.byDifficulty[x], when), 0);
  const dlow = DIFFS.some((x) => have(d.byDifficulty[x], when) < d.byDifficulty[x].target);
  return (
    <tr className="border-b border-[#344d5b] align-top">
      <td className="p-3">
        <div className="font-display text-sm font-bold">{d.name}</div>
        <div className="font-mono text-[9px] text-muted">{d.slug}</div>
      </td>
      {DIFFS.map((x) => {
        const c = d.byDifficulty[x];
        const h = have(c, when);
        const t = tone(h, c.target);
        return (
          <td key={x} className="p-2">
            <div className={`rounded-lg border p-2 ${TONE_BOX[t]}`} title={`${d.name} ${x}: ${c.active} active, ${c.planned} queued, ${c.solved} solved (${c.solvedThisSprint} this sprint), ${c.released} released so far; bank ${c.bankFresh} new to this slot of ${c.bankTotal} published`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className={`font-mono text-lg ${TONE_TEXT[t]}`}>{c.active}<span className="text-[11px] text-muted">/{c.target}</span></span>
                <span className="font-mono text-[9px] text-muted">active</span>
              </div>
              <div className="mt-1 font-mono text-[9px] leading-4 text-muted">
                <div>{c.solved} solved{c.solvedThisSprint ? ` · ${c.solvedThisSprint} this sprint` : ''}</div>
                <div className={c.planned ? 'text-[#c9dcd8]' : ''}>{c.planned} queued (not released)</div>
                <div className={c.bankFresh === 0 ? 'text-[#ee9582]' : ''}>bank {c.bankFresh} new / {c.bankTotal}</div>
              </div>
              {(canAct || onPick) && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {canAct && (
                    <button type="button" className="rounded border border-[#52717e] bg-[#2d4654] px-1.5 py-0.5 font-mono text-[9px] text-[#e8cf8e] hover:bg-[#3a5a63] disabled:opacity-40" disabled={busy || h >= c.target || c.bankTotal === 0} onClick={() => void onTopUp({ domain: d.slug, difficulty: x }, `${d.name} ${DIFF_LABEL[x]}`)}>
                      + Top up
                    </button>
                  )}
                  {canAct && (
                    <button type="button" className="rounded border border-[#52717e] bg-[#2d4654] px-1.5 py-0.5 font-mono text-[9px] text-[#d6e1e1] hover:bg-[#3a5a63] disabled:opacity-40" disabled={busy || c.bankTotal === 0} onClick={() => void onTopUp({ domain: d.slug, difficulty: x, count: 1 }, `${d.name} ${DIFF_LABEL[x]} +1`)}>
                      +1
                    </button>
                  )}
                  {onPick && (
                    <button type="button" className="rounded border border-[#52717e] bg-[#2d4654] px-1.5 py-0.5 font-mono text-[9px] text-[#d6e1e1] hover:bg-[#3a5a63]" onClick={() => onPick({ domain: d.slug, difficulty: x })}>
                      pick…
                    </button>
                  )}
                </div>
              )}
            </div>
          </td>
        );
      })}
      <td className="p-3">
        <div className={`font-mono text-sm ${TONE_TEXT[tone(dh, d.totals.target)]}`}>{d.totals.active}<span className="text-[10px] text-muted">/{d.totals.target}</span></div>
        <div className="font-mono text-[9px] text-muted">{d.totals.solved} solved · {d.totals.planned} queued</div>
        {canAct && (
          <Button secondary className={`${SMALL} mt-2`} disabled={busy || !dlow} onClick={() => void onTopUp({ domain: d.slug }, d.name)}>
            Top up domain
          </Button>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Compact summary (SLOTS & SPRINTS cards)
// ---------------------------------------------------------------------------

export function StockSummary({ slot }: { slot: OverviewSlot }) {
  const { goTo } = useConsole();
  const stock = useSlotStock(slot.id);
  const s = stock.data;
  const { topUp, busy, allowed } = useTopUp(s, () => void stock.reload());
  if (!s) {
    return stock.error ? <Notice tone="danger">Question stock unavailable: {stock.error.message}</Notice> : <div className="font-mono text-[10px] text-muted">Loading question stock…</div>;
  }
  const when = whenOf(s);
  const lowDomains = s.domains.filter((d) => DIFFS.some((x) => have(d.byDifficulty[x], when) < d.byDifficulty[x].target));
  const finished = FINISHED.includes(s.slot.phase);
  return (
    <div className={SUBCARD}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Label>{`QUESTION STOCK${s.sprint ? ` · SPRINT ${s.sprint.number} ${s.sprint.status}` : ' · BEFORE SPRINT 1'}`}</Label>
        <span className="font-mono text-[10px] text-muted">
          {s.totals.active}/{s.totals.target} active · {s.totals.planned} queued · bonus {s.bonus.active} live
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {s.domains.map((d) => {
          const h = DIFFS.reduce((a, x) => a + have(d.byDifficulty[x], when), 0);
          const t = lowDomains.includes(d) ? tone(h, d.totals.target) : 'ok';
          return (
            <div key={d.slug} className={`rounded-lg border p-2 text-center ${TONE_BOX[t === 'ok' ? 'ok' : t]}`} title={`${d.name}: ${DIFFS.map((x) => `${DIFF_SHORT[x]} ${have(d.byDifficulty[x], when)}/${d.byDifficulty[x].target}`).join(' · ')}`}>
              <div className="truncate font-mono text-[9px] tracking-wider text-muted">{d.name.toUpperCase()}</div>
              <div className={`font-mono text-sm ${TONE_TEXT[t]}`}>{h}<span className="text-[10px] text-muted">/{d.totals.target}</span></div>
              <div className="font-mono text-[9px] text-muted">{DIFFS.map((x) => `${DIFF_SHORT[x]}${have(d.byDifficulty[x], when)}`).join(' ')}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {allowed && !finished && (
          <Button className={SMALL} disabled={!!busy || lowDomains.length === 0} onClick={() => void topUp({}, `${s.slot.name} · all low`)}>
            <PackagePlus size={12} /> Top up all low{lowDomains.length ? ` (${lowDomains.length} domain${lowDomains.length === 1 ? '' : 's'})` : ''}
          </Button>
        )}
        {goTo && (
          <Button secondary className={SMALL} onClick={() => goTo('releases', slot.id)}>
            <ExternalLink size={12} /> Open question control
          </Button>
        )}
        <span className="text-[10px] text-muted">Releases go out {whenText(s).toLowerCase()}.</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pick & release from the bank
// ---------------------------------------------------------------------------

function usage(r: SlotBankRow) {
  const elsewhere = r.usedTotal - r.usedInSlot;
  if (r.usedInSlot > 0) return { text: `used in this slot ${r.usedInSlot}×${elsewhere > 0 ? ` · elsewhere ${elsewhere}×` : ''}`, cls: 'text-[#ebd68c]' };
  if (elsewhere > 0) return { text: `new to this slot · used elsewhere ${elsewhere}×`, cls: 'text-[#c9dcd8]' };
  return { text: 'new to this slot', cls: 'text-[#9fe0c9]' };
}

export function BankPicker({ slotId, domains, running, initial, onClose, onDone }: {
  slotId: string;
  domains: { slug: string; name: string }[];
  running: boolean;
  initial: { when: When; domain?: string; difficulty?: Difficulty; bonus?: boolean };
  onClose: () => void;
  onDone: () => void;
}) {
  const { confirm } = useConsole();
  const { run, busy } = useRun();
  const bank = useAdminData<SlotBankRow[]>(`${V1}/admin/slots/${slotId}/bank`);
  const meta = useAdminData<BankResponse>(`${V1}/admin/questions`);
  const workspaceOf = useMemo(() => new Map((meta.data?.questions ?? []).map((q) => [q.version_id, q.workspace])), [meta.data]);
  const [domain, setDomain] = useState<string>(initial.domain ?? 'ALL');
  const [diffs, setDiffs] = useState<Difficulty[]>(initial.difficulty ? [initial.difficulty] : [...DIFFS]);
  const [search, setSearch] = useState('');
  const [freshOnly, setFreshOnly] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [bonus, setBonus] = useState(!!initial.bonus);
  const [when, setWhen] = useState<When>(running ? initial.when : 'NEXT_START');
  const [announcement, setAnnouncement] = useState('');

  const all = bank.data ?? [];
  const countIn = (slug: string) => all.filter((r) => r.domain === slug && diffs.includes(r.difficulty) && (!freshOnly || r.usedInSlot === 0)).length;
  const shown = all.filter((r) =>
    (domain === 'ALL' || r.domain === domain) && diffs.includes(r.difficulty) && (!freshOnly || r.usedInSlot === 0) && (!search || `${r.key} ${r.title}`.toLowerCase().includes(search.toLowerCase())));
  const allShownPicked = shown.length > 0 && shown.every((r) => picked.includes(r.versionId));
  const pickedRows = all.filter((r) => picked.includes(r.versionId));
  const reused = pickedRows.filter((r) => r.usedInSlot > 0).length;
  const domName = (slug: string) => domains.find((d) => d.slug === slug)?.name ?? slug;
  const toggleDiff = (d: Difficulty) => setDiffs((x) => (x.includes(d) ? (x.length > 1 ? x.filter((y) => y !== d) : x) : [...x, d]));

  const submit = async () => {
    const byDomain = new Map<string, number>();
    for (const r of pickedRows) byDomain.set(r.domain, (byDomain.get(r.domain) ?? 0) + 1);
    const ok = await confirm({
      title: `${bonus ? 'Release as BONUS' : 'Release'} · ${picked.length} question(s)`,
      tone: bonus ? 'warning' : 'primary',
      effects: [
        `${[...byDomain.entries()].map(([d, n]) => `${domName(d)} ×${n}`).join(', ')}.`,
        bonus ? 'Released as BONUS: IMPOSTER DETECTED alert, open to every crew, bonus reward.' : 'Released as regular questions with the normal difficulty reward.',
        when === 'NOW' ? 'Every crew of this slot sees them immediately.' : 'Queued — released when the next sprint starts (before Sprint 1 this adds to the initial set).',
        ...(reused ? [`${reused} of them were already used in this slot — they will be released again (allowed).`] : []),
      ],
      confirmLabel: when === 'NOW' ? 'Release now' : 'Queue for next start',
    });
    if (!ok) return;
    const r = await run('bank-release', () => api.post<{ count: number; when: When; kind: string }>(`${V1}/admin/slots/${slotId}/releases`, {
      versionIds: picked, bonus, when, announcement: announcement.trim() || undefined,
    }), (x) => `${x.count} question(s) ${x.when === 'NOW' ? 'released now' : 'queued for the next sprint start'}${x.kind === 'BONUS' ? ' as BONUS' : ''}.`);
    if (r) onDone();
  };

  return (
    <Modal open onClose={onClose} title="Pick & release questions from the bank" label="QUESTION BANK → SLOT" wide>
      <div className="space-y-3 text-xs">
        <Notice>
          Only PUBLISHED questions are listed. <b>Previously used questions may be reused</b> — the usage column shows whether a question is new to this slot, was already used here, or was used in other slots. Tick “only new to this slot” to hide repeats.
        </Notice>
        <Segmented
          label="Domain"
          value={domain}
          onChange={setDomain}
          options={[{ value: 'ALL', label: `ALL (${domains.reduce((a, d) => a + countIn(d.slug), 0)})` }, ...domains.map((d) => ({ value: d.slug, label: `${d.name.toUpperCase()} (${countIn(d.slug)})` }))]}
        />
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Difficulty" className="flex gap-1">
            {DIFFS.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={diffs.includes(d)}
                onClick={() => toggleDiff(d)}
                className={`rounded-md border-2 px-2.5 py-1 font-display text-[9px] font-bold ${diffs.includes(d) ? 'border-[#b3f3d9] bg-[#8ae4cf] text-[#14342f]' : 'border-[#52717e] bg-[#2d4654] text-[#d6e1e1]'}`}
              >
                {DIFF_SHORT[d]} · {DIFF_LABEL[d]}
              </button>
            ))}
          </div>
          <input className="input !w-auto min-w-[200px] flex-1 !py-2" placeholder="Search key or title" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search bank" />
          <Check checked={freshOnly} onChange={setFreshOnly} label="Only new to this slot" />
        </div>
        <Loadable state={bank} title="Bank questions">
          {() => (
            <div className="rounded-lg border border-[#344d5b]">
              <div className="flex items-center justify-between gap-2 border-b border-[#344d5b] px-3 py-2">
                <Check
                  checked={allShownPicked}
                  onChange={(v) => setPicked((p) => (v ? [...new Set([...p, ...shown.map((r) => r.versionId)])] : p.filter((id) => !shown.some((r) => r.versionId === id))))}
                  label={`Select all shown (${shown.length})`}
                  disabled={shown.length === 0}
                />
                <span className="font-mono text-[10px] text-muted">{picked.length} selected{picked.length > 120 ? ' — max 120 per release' : ''}</span>
              </div>
              <div className="max-h-[46vh] overflow-y-auto">
                {shown.length === 0 ? <p className="p-4 text-center text-muted">No published questions match these filters.</p> : shown.map((r) => {
                  const u = usage(r);
                  const ws = workspaceOf.get(r.versionId);
                  return (
                    <label key={r.versionId} className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#2c4452] px-3 py-2 hover:bg-[#1b3a47]">
                      <input type="checkbox" className="h-4 w-4 accent-[#8ae4cf]" checked={picked.includes(r.versionId)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.versionId] : p.filter((x) => x !== r.versionId)))} />
                      <span className="w-40 truncate font-mono text-[10px] text-muted" title={r.key}>{r.key}</span>
                      <span className="min-w-[160px] flex-1 font-bold">{r.title}</span>
                      {domain === 'ALL' && <span className="font-mono text-[9px] text-muted">{domName(r.domain)}</span>}
                      <Badge>{r.difficulty}</Badge>
                      {ws && <Badge>{ws}</Badge>}
                      {r.pool === 'BONUS' && <Badge>BONUS POOL</Badge>}
                      <span className={`font-mono text-[10px] ${u.cls}`}>{u.text}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </Loadable>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="mb-2">RELEASE AS</Label>
            <Segmented label="Release as" value={bonus ? 'BONUS' : 'REGULAR'} onChange={(v) => setBonus(v === 'BONUS')} options={[{ value: 'REGULAR', label: 'REGULAR' }, { value: 'BONUS', label: 'BONUS (IMPOSTER DETECTED)' }]} />
          </div>
          <div>
            <Label className="mb-2">WHEN</Label>
            <Segmented
              label="When"
              value={when}
              onChange={setWhen}
              options={[...(running ? [{ value: 'NOW' as When, label: 'NOW' }] : []), { value: 'NEXT_START' as When, label: 'NEXT SPRINT START' }]}
            />
            {!running && <div className="mt-1 text-[10px] text-muted">“Now” needs a running sprint.</div>}
          </div>
        </div>
        <Field label={bonus ? 'ANNOUNCEMENT (OPTIONAL — DEFAULT: IMPOSTER DETECTED…)' : 'ANNOUNCEMENT (OPTIONAL)'}>
          <input className="input" maxLength={200} value={announcement} onChange={(e) => setAnnouncement(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button secondary className={SMALL} onClick={onClose}>Cancel</Button>
          <Button danger={bonus} className={SMALL} disabled={!!busy || picked.length === 0 || picked.length > 120} onClick={() => void submit()}>
            {when === 'NOW' ? 'Release' : 'Queue'} {picked.length} {bonus ? 'as bonus' : ''}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Initial set editor (unreleased questions)
// ---------------------------------------------------------------------------

function PlanEditor({ slot, plan, stockDomains, onChanged, onAdd }: {
  slot: OverviewSlot;
  plan: Loaded<PlannedRow[]>;
  stockDomains: StockDomain[];
  onChanged: () => void;
  onAdd?: () => void;
}) {
  const { overview, can } = useConsole();
  const { run, busy } = useRun();
  const manage = can('releases.manage');
  const finished = FINISHED.includes(slot.phase);
  const canRebuild = manage && !finished && (slot.currentSprint === 0 || overview.rules.questionScope === 'FRESH_PER_SPRINT');
  const rows = plan.data ?? [];
  if (finished && rows.length === 0) return null;
  if (!canRebuild && rows.length === 0 && !plan.loading) {
    return (
      <div className={CARD}>
        <SectionHead label="QUEUED" title="Queued for the next sprint start" />
        <Empty>Nothing queued. Use “Pick &amp; release from bank” with <b>Next sprint start</b>, or Top up while no sprint is running.</Empty>
      </div>
    );
  }
  const sprints = [...new Set(rows.map((r) => r.sprint))];
  const order = stockDomains.length ? stockDomains.map((d) => d.slug) : [...new Set(rows.map((r) => r.domain))];
  const nameOf = (slug: string) => stockDomains.find((d) => d.slug === slug)?.name ?? rows.find((r) => r.domain === slug)?.domain_name ?? slug;
  const remove = async (r: PlannedRow) => {
    await run(`rm-${r.id}`, () => api.del(`${V1}/admin/slots/${slot.id}/plan/${r.id}`), `${r.label} removed from the set.`);
    onChanged();
  };
  const targets = overview.rules.initialPerDomain;
  return (
    <div className={CARD}>
      <SectionHead label={slot.currentSprint === 0 ? 'INITIAL SET' : 'QUEUED'} title={slot.currentSprint === 0 ? 'Initial set · released when Sprint 1 starts' : 'Queued for the next sprint start'}>
        <Badge>{`${rows.length} QUESTION(S)`}</Badge>
        <Button secondary className={SMALL} onClick={() => void plan.reload()} ariaLabel="Reload set"><RefreshCw size={11} /></Button>
        {onAdd && !finished && <Button className={SMALL} onClick={onAdd}><Plus size={12} /> Add from bank</Button>}
      </SectionHead>
      <p className="mb-3 text-[11px] leading-5 text-muted">
        Auto-built from the bank ({DIFFS.map((d) => `${targets[d]} ${DIFF_LABEL[d].toLowerCase()}`).join(', ')} per domain). Remove questions you do not want, add specific ones from the bank, or rebuild with other counts. Nothing is visible to crews until the sprint starts.
      </p>
      <Loadable state={plan} title="Unreleased set">
        {() => (rows.length === 0 ? <Empty>No unreleased questions. {canRebuild ? 'Build the initial set below.' : ''}</Empty> : (
          <div className="space-y-4">
            {sprints.map((sp) => (
              <div key={String(sp)}>
                {sprints.length > 1 && <Label className="mb-2">{sp ? `SPRINT ${sp}` : 'NEXT START'}</Label>}
                <div className="space-y-2">
                  {order.map((slug) => {
                    const dr = rows.filter((r) => r.sprint === sp && r.domain === slug);
                    if (!dr.length) return null;
                    return (
                      <details key={slug} className={SUBCARD} open>
                        <summary className="cursor-pointer">
                          <span className="font-display text-sm font-bold">{nameOf(slug)}</span>
                          <span className="ml-2 font-mono text-[10px] text-muted">
                            {DIFFS.map((d) => `${DIFF_SHORT[d]} ${dr.filter((r) => r.difficulty === d).length}/${targets[d]}`).join(' · ')}
                          </span>
                        </summary>
                        <div className="mt-2 grid gap-2 md:grid-cols-3">
                          {DIFFS.map((d) => {
                            const list = dr.filter((r) => r.difficulty === d);
                            return (
                              <div key={d}>
                                <div className={`mb-1 font-mono text-[9px] tracking-wider ${list.length < targets[d] ? 'text-[#ebd68c]' : 'text-muted'}`}>{d} · {list.length}/{targets[d]}</div>
                                {list.length === 0 ? <div className="rounded border border-dashed border-[#3b5664] p-2 text-center text-[10px] text-muted">none</div> : (
                                  <ul className="space-y-1">
                                    {list.map((r) => (
                                      <li key={r.id} className="flex items-start gap-2 rounded border border-[#344d5b] bg-[#112a35] px-2 py-1">
                                        <div className="min-w-0 flex-1">
                                          <div className="flex items-center gap-1">
                                            <span className="font-mono text-[9px] text-[#e8cf8e]">{r.label}</span>
                                            <span className="font-mono text-[9px] text-muted">{r.workspace}</span>
                                            {r.label.startsWith('BONUS') && <span className="font-mono text-[9px] text-[#ee9582]">BONUS</span>}
                                          </div>
                                          <div className="truncate text-[11px]" title={`${r.key} · ${r.title}`}>{r.title}</div>
                                        </div>
                                        {manage && (
                                          <button type="button" aria-label={`Remove ${r.label}`} title="Remove from the set" disabled={!!busy} onClick={() => void remove(r)} className="shrink-0 rounded border border-[#9d635a] p-0.5 text-[#ee9582] hover:bg-[#442b34] disabled:opacity-40">
                                            <X size={11} />
                                          </button>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}
      </Loadable>
      {canRebuild && <RebuildForm slot={slot} domains={stockDomains} hasRows={rows.length > 0} onDone={onChanged} />}
    </div>
  );
}

function RebuildForm({ slot, domains, hasRows, onDone }: { slot: OverviewSlot; domains: StockDomain[]; hasRows: boolean; onDone: () => void }) {
  const { overview, confirm } = useConsole();
  const { run, busy } = useRun();
  const def = overview.rules.initialPerDomain;
  const [counts, setCounts] = useState<Record<Difficulty, string>>({ EASY: String(def.EASY), MEDIUM: String(def.MEDIUM), HARD: String(def.HARD) });
  const [over, setOver] = useState<Record<string, Partial<Record<Difficulty, string>>>>({});
  const [include, setInclude] = useState<Record<string, boolean>>({});
  const [short, setShort] = useState<string[] | null>(null);
  const included = (slug: string) => include[slug] ?? true;
  const parsed = DIFFS.map((d) => intOrNull(counts[d]));
  const valid = parsed.every((n) => n !== null && n >= 0 && n <= 50);

  const build = async () => {
    const c = Object.fromEntries(DIFFS.map((d, i) => [d, parsed[i]!])) as Record<Difficulty, number>;
    const perDomain: Record<string, Partial<Record<Difficulty, number>>> = {};
    for (const [slug, o] of Object.entries(over)) {
      const e = Object.fromEntries(DIFFS.flatMap((d) => {
        const n = intOrNull(o[d] ?? '');
        return n === null ? [] : [[d, Math.max(0, n)]];
      }));
      if (Object.keys(e).length) perDomain[slug] = e;
    }
    const scope = domains.filter((d) => included(d.slug)).map((d) => d.slug);
    const partial = scope.length < domains.length;
    if (!scope.length) return;
    const ok = await confirm({
      title: `${hasRows ? 'Rebuild' : 'Build'} initial set · ${slot.name}`,
      tone: 'warning',
      effects: [
        `Per domain: ${DIFFS.map((d) => `${c[d]} ${DIFF_LABEL[d].toLowerCase()}`).join(', ')}${Object.keys(perDomain).length ? ` (overrides for ${Object.keys(perDomain).join(', ')})` : ''}.`,
        partial ? `Only these domains are rebuilt: ${scope.join(', ')}. Others keep their current set.` : 'Every domain is rebuilt.',
        hasRows ? 'Replaces the unreleased initial questions of those domains (manual additions there are dropped).' : 'No set exists yet.',
        'Picks PUBLISHED questions only (new to this slot first, then the least used). Never auto-publishes.',
      ],
      confirmLabel: hasRows ? 'Rebuild set' : 'Build set',
    });
    if (!ok) return;
    const r = await run('plan', () => api.post<{ instances: number; short: string[] }>(`${V1}/admin/slots/${slot.id}/plan`, {
      counts: c, ...(Object.keys(perDomain).length ? { perDomain } : {}), ...(partial ? { domains: scope } : {}),
    }), (x) => `Initial set built: ${x.instances} question(s).${x.short.length ? ` Bank short: ${x.short.join(', ')}.` : ''}`);
    if (r) {
      setShort(r.short);
      onDone();
    }
  };

  return (
    <div className={`${SUBCARD} mt-4`}>
      <Label className="mb-2">{hasRows ? 'REBUILD THE SET' : 'BUILD THE INITIAL SET'}</Label>
      <div className="flex flex-wrap items-end gap-3">
        {DIFFS.map((d) => (
          <label key={d} className="block w-24">
            <span className="mb-1 block font-mono text-[9px] text-muted">{d} / DOMAIN</span>
            <NumInput value={counts[d]} onChange={(v) => setCounts((x) => ({ ...x, [d]: v }))} min={0} max={50} ariaLabel={`${d} per domain`} />
          </label>
        ))}
        <Button secondary className={SMALL} onClick={() => setCounts({ EASY: String(def.EASY), MEDIUM: String(def.MEDIUM), HARD: String(def.HARD) })}>Reset to rule ({def.EASY}/{def.MEDIUM}/{def.HARD})</Button>
        <Button className={SMALL} disabled={!!busy || !valid || !domains.some((d) => included(d.slug))} onClick={() => void build()}>
          <Hammer size={12} /> {hasRows ? 'Rebuild' : 'Build'} initial set
        </Button>
      </div>
      {domains.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer font-mono text-[10px] tracking-wider text-[#e6c887]">PER-DOMAIN OVERRIDES &amp; SCOPE (OPTIONAL)</summary>
          <p className="my-2 text-[10px] text-muted">Leave a cell empty to use the counts above. Untick a domain to keep its current set untouched.</p>
          <div className="overflow-x-auto">
            <table className="text-left text-xs">
              <thead className="font-mono text-[9px] text-muted"><tr><th className="p-1">REBUILD</th><th className="p-1">DOMAIN</th>{DIFFS.map((d) => <th key={d} className="p-1">{d}</th>)}</tr></thead>
              <tbody>
                {domains.map((d) => (
                  <tr key={d.slug}>
                    <td className="p-1"><input type="checkbox" className="h-4 w-4 accent-[#8ae4cf]" aria-label={`Rebuild ${d.name}`} checked={included(d.slug)} onChange={(e) => setInclude((x) => ({ ...x, [d.slug]: e.target.checked }))} /></td>
                    <td className="p-1">{d.name}</td>
                    {DIFFS.map((x) => (
                      <td key={x} className="w-20 p-1">
                        <NumInput value={over[d.slug]?.[x] ?? ''} onChange={(v) => setOver((o) => ({ ...o, [d.slug]: { ...o[d.slug], [x]: v } }))} min={0} max={50} ariaLabel={`${d.name} ${x}`} disabled={!included(d.slug)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {short && short.length > 0 && <div className="mt-3"><Notice tone="warn">The bank ran short for: {short.join(', ')}. Publish more questions in QUESTION BANK (or sync from GitHub) and rebuild, or lower the counts.</Notice></div>}
      {short && short.length === 0 && <div className="mt-3"><Notice>Set built with the requested counts.</Notice></div>}
    </div>
  );
}
