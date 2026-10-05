/**
 * Live question stock for one slot: per-domain available / solved / deficit,
 * plus the two organizer pools —
 *  - 20 reserve questions (mixed domains): "Refill" releases them into the
 *    domains depleted by solves (largest deficit first);
 *  - 10 bonus questions (mixed domains): "Release bonus" sends the next one
 *    (IMPOSTER DETECTED, open to every crew, first correct wins).
 * Both act only while the slot's sprint is running; released extras expire
 * with their sprint, unreleased ones carry over.
 */
import { PackagePlus, Siren } from 'lucide-react';
import { useState } from 'react';
import { Button, Label } from '../components/ui';
import { V1, api } from '../lib/api';
import { Loadable, NumInput, SMALL, SUBCARD, Select, intOrNull, useAdminData, useConsole, useRun } from './kit';

export interface DomainStock {
  domainId: string;
  slug: string;
  name: string;
  available: number;
  solved: number;
  target: number;
  deficit: number;
  pool: number;
}
export interface PoolStatus {
  slotId: string;
  sprint: { number: number; status: string } | null;
  running: boolean;
  domains: DomainStock[];
  reservesLeft: number;
  totalDeficit: number;
  bonusesLeft: number;
  bonusesReleased: number;
  bonusMode: 'MANUAL' | 'SCHEDULED';
}

export function PoolControls({ slotId, compact = false }: { slotId: string; compact?: boolean }) {
  const state = useAdminData<PoolStatus>(`${V1}/admin/slots/${slotId}/pools`);
  return (
    <Loadable state={state} title="question stock">
      {(p) => <PoolBody p={p} compact={compact} onChanged={() => void state.reload()} />}
    </Loadable>
  );
}

function PoolBody({ p, compact, onChanged }: { p: PoolStatus; compact: boolean; onChanged: () => void }) {
  const { can, confirm } = useConsole();
  const { busy, run } = useRun();
  const [count, setCount] = useState('');
  const [domain, setDomain] = useState('AUTO');
  const base = `${V1}/admin/slots/${p.slotId}`;
  const manage = can('releases.manage');
  const n = intOrNull(count) ?? Math.max(1, p.totalDeficit);

  const refill = async () => {
    const target = domain === 'AUTO' ? 'the most depleted domains first' : domain;
    const ok = await confirm({
      title: `Refill ${n} question${n === 1 ? '' : 's'}`,
      effects: [`Releases ${n} reserve question(s) from this slot's pool into ${target}.`, 'Every crew of the slot sees them immediately; they expire when this sprint ends.', `${p.reservesLeft} reserve(s) left in the pool.`],
      confirmLabel: 'Release refill',
    });
    if (!ok) return;
    await run(
      'refill',
      () => api.post<{ released: { label: string; domain: string }[] }>(`${base}/refill`, { count: n, ...(domain === 'AUTO' ? {} : { domain }) }),
      (r) => `Released ${r.released.length}: ${r.released.map((x) => `${x.label} (${x.domain})`).join(', ')}.`,
    );
    setCount('');
    onChanged();
  };
  const bonus = async () => {
    const ok = await confirm({
      title: 'Release the next bonus question',
      tone: 'warning',
      effects: ['IMPOSTER DETECTED alert on every ship of this slot.', 'Open to every crew; the first correct answer wins the bonus reward.', `${p.bonusesLeft - 1} bonus question(s) will remain in the pool.`],
      confirmLabel: 'Release bonus',
    });
    if (!ok) return;
    await run('bonus', () => api.post(`${base}/bonus/next`, {}), 'Bonus released — IMPOSTER DETECTED.');
    onChanged();
  };

  return (
    <div className={SUBCARD}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Label>{`QUESTION STOCK${p.sprint ? ` · SPRINT ${p.sprint.number} ${p.sprint.status}` : ' · NO SPRINT YET'}`}</Label>
        <span className="font-mono text-[10px] text-muted">
          reserves left {p.reservesLeft} · bonuses left {p.bonusesLeft}{p.bonusMode === 'SCHEDULED' ? ' (auto-scheduled)' : ''}
        </span>
      </div>
      <div className={`grid gap-2 ${compact ? 'grid-cols-3 sm:grid-cols-6' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'}`}>
        {p.domains.map((d) => (
          <div key={d.slug} className={`rounded-lg border p-2 text-center ${d.deficit > 0 && p.running ? 'border-[#c9a45c] bg-[#3a3424]' : 'border-[#344d5b] bg-[#112a35]'}`} title={`${d.name}: ${d.available} open of ${d.target}, ${d.solved} solved this sprint, ${d.pool} reserve(s) left`}>
            <div className="truncate font-mono text-[9px] tracking-wider text-muted">{d.slug.toUpperCase()}</div>
            <div className="font-mono text-sm text-[#e8cf8e]">{d.available}<span className="text-[10px] text-muted">/{d.target}</span></div>
            <div className="font-mono text-[9px] text-muted">{d.solved} solved · {d.pool} rsv</div>
          </div>
        ))}
      </div>
      {manage && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block w-20">
            <span className="mb-1 block font-mono text-[9px] text-muted">COUNT</span>
            <NumInput value={count} onChange={setCount} min={1} max={50} ariaLabel="Refill count" className="!py-2" />
          </label>
          <label className="block">
            <span className="mb-1 block font-mono text-[9px] text-muted">DOMAIN</span>
            <Select
              value={domain}
              onChange={setDomain}
              ariaLabel="Refill domain"
              options={[{ value: 'AUTO', label: 'Most depleted (auto)' }, ...p.domains.map((d) => ({ value: d.slug, label: `${d.name} (${d.pool} left)` }))]}
            />
          </label>
          <Button className={SMALL} disabled={!p.running || p.reservesLeft === 0 || !!busy} onClick={() => void refill()} title={p.running ? undefined : 'Available while the sprint is running'}>
            <PackagePlus size={12} /> Refill {n}{p.totalDeficit ? ` · deficit ${p.totalDeficit}` : ''}
          </Button>
          <Button danger className={SMALL} disabled={!p.running || p.bonusesLeft === 0 || !!busy} onClick={() => void bonus()} title={p.running ? undefined : 'Available while the sprint is running'}>
            <Siren size={12} /> Release bonus ({p.bonusesLeft} left)
          </Button>
          {!p.running && <span className="text-[11px] text-muted">Refills and bonuses can be released while the sprint is running.</span>}
        </div>
      )}
    </div>
  );
}
