/**
 * Leaderboards (sprint / slot cumulative / overall) and CSV/XLSX exports.
 */
import { Download } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { V1, type LeaderboardResponse } from '../lib/api';
import { Badge, Label } from '../components/ui';
import { CARD, DataTable, ExportLink, Loadable, SectionHead, Segmented, SlotPicker, TD, TR, useAdminData, useConsole, useSlotPick } from './kit';

type Scope = 'sprint-1' | 'sprint-2' | 'sprint-3' | 'sprint-4' | 'cumulative' | 'event';

export function BoardsTab() {
  const { overview, can } = useConsole();
  const [slotId, setSlotId] = useSlotPick();
  const [scope, setScope] = useState<Scope>('cumulative');
  const slot = overview.slots.find((s) => s.id === slotId);
  const sprintN = scope.startsWith('sprint-') ? Number(scope.slice(7)) : null;
  const url = scope === 'event'
    ? `${V1}/leaderboards?scope=event`
    : slotId ? `${V1}/leaderboards?scope=${sprintN ? 'sprint' : 'cumulative'}&slotId=${slotId}${sprintN ? `&sprint=${sprintN}` : ''}` : null;
  const st = useAdminData<LeaderboardResponse>(url);

  let status: string;
  if (scope === 'event') status = st.data?.status ?? (overview.event.phase === 'FINALIZED' ? 'FINAL' : 'PROVISIONAL');
  else if (sprintN) {
    const sp = slot?.sprints.find((x) => x.number === sprintN);
    status = !sp ? '—' : sp.status === 'RUNNING' || sp.status === 'PAUSED' ? 'LIVE' : sp.status === 'READY' ? 'NOT STARTED' : 'FROZEN';
  } else status = slot?.phase === 'COMPLETED' ? 'FINAL' : slot?.phase === 'RUNNING' ? 'LIVE · PROVISIONAL' : 'PROVISIONAL';

  const exp = (kind: string, fmt: 'csv' | 'xlsx', extra = '') => `${V1}/admin/exports/${kind}?format=${fmt}${extra}`;
  const slotQ = `&slotId=${slotId}`;

  return (
    <div className="space-y-6">
      <div className={CARD}>
        <SectionHead label="STANDINGS" title="Leaderboards">
          <Badge>{status}</Badge>
          {st.data && <Badge>{st.data.metric}</Badge>}
        </SectionHead>
        <div className="mb-3 space-y-3">
          {scope !== 'event' && <SlotPicker value={slotId} onChange={setSlotId} />}
          <Segmented
            label="Board scope"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'sprint-1', label: 'SPRINT 1' }, { value: 'sprint-2', label: 'SPRINT 2' }, { value: 'sprint-3', label: 'SPRINT 3' }, { value: 'sprint-4', label: 'SPRINT 4' },
              { value: 'cumulative', label: 'SLOT CUMULATIVE' }, { value: 'event', label: 'OVERALL' },
            ]}
          />
        </div>
        {scope === 'event' && status !== 'FINAL' && <p className="mb-3 text-[11px] text-[#ebd68c]">PROVISIONAL — the overall ranking becomes final only after every slot is completed and the event is finalized.</p>}
        <Loadable state={st} title="Leaderboard" empty={(d) => d.rows.length === 0}>
          {(d) => (
            <>
              <DataTable head={['RANK', 'CREW', 'TEAM', ...(scope === 'event' ? ['SLOT'] : []), 'SCORE', 'S1', 'S2', 'S3', 'S4', 'SOLVES', 'STATUS']}>
                {d.rows.map((r) => (
                  <tr key={r.crewId} className={TR}>
                    <td className={`${TD} font-mono`}>{r.rank ?? '—'}</td>
                    <td className={`${TD} font-mono`}><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: r.color }} />{r.crewId}</td>
                    <td className={TD}>{r.name}</td>
                    {scope === 'event' && <td className={TD}>{r.slotNumber}</td>}
                    <td className={`${TD} font-mono text-[#e8cf8e]`}>{r.score}</td>
                    {['1', '2', '3', '4'].map((k) => <td key={k} className={`${TD} font-mono`}>{r.perSprint?.[k] ?? 0}</td>)}
                    <td className={`${TD} font-mono`}>{r.solves}</td>
                    <td className={TD}><Badge>{r.zone ? `${r.status} · ${r.zone}` : r.status}</Badge></td>
                  </tr>
                ))}
              </DataTable>
              {d.inactive && d.inactive.length > 0 && (
                <div className="mt-3">
                  <Label className="mb-1">INACTIVE (ELIMINATED / DISQUALIFIED)</Label>
                  <div className="text-xs text-muted">{d.inactive.map((r) => `${r.crewId} ${r.name} (${r.status})`).join(' · ')}</div>
                </div>
              )}
            </>
          )}
        </Loadable>
      </div>

      {can('exports') && (
        <div className={CARD}>
          <SectionHead label="EXPORTS" title="CSV / XLSX downloads (never passwords)" />
          <div className="space-y-3 text-xs">
            <Row label="Crews"><Pair href={(f) => exp('teams', f)} /></Row>
            <Row label="Overall standings"><Pair href={(f) => exp('overall', f)} /></Row>
            <Row label={`Slot standings · ${slot?.name ?? ''}`}><Pair disabled={!slotId} href={(f) => exp('slot-standings', f, slotQ)} /></Row>
            <Row label={`Sprint standings · ${slot?.name ?? ''}`}>
              {[1, 2, 3, 4].map((n) => <Pair key={n} prefix={`S${n}`} disabled={!slotId} href={(f) => exp('sprint-standings', f, `${slotQ}&sprint=${n}`)} />)}
            </Row>
            {can('audit.read') && <Row label={`Ledger · ${slot?.name ?? ''}`}><Pair disabled={!slotId} href={(f) => exp('ledger', f, slotQ)} /></Row>}
            {can('audit.read') && <Row label="Audit log (latest 500)"><Pair href={(f) => exp('audit', f)} /></Row>}
          </div>
          <p className="mt-3 text-[10px] text-muted">Slot-scoped exports use the slot selected above. Every download is recorded in the audit log.</p>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-56 shrink-0">{label}</span>
      {children}
    </div>
  );
}

function Pair({ href, disabled, prefix }: { href: (f: 'csv' | 'xlsx') => string; disabled?: boolean; prefix?: string }) {
  return (
    <>
      <ExportLink disabled={disabled} href={href('csv')}><Download size={10} /> {prefix ? `${prefix} ` : ''}CSV</ExportLink>
      <ExportLink disabled={disabled} href={href('xlsx')}><Download size={10} /> {prefix ? `${prefix} ` : ''}XLSX</ExportLink>
    </>
  );
}
