/**
 * Operations: slot ledger, audit log and system health.
 */
import { useState } from 'react';
import { V1 } from '../lib/api';
import { Badge, Button, Label } from '../components/ui';
import { CARD, DataTable, Loadable, Notice, SMALL, SUBCARD, SectionHead, Segmented, SlotPicker, TD, TR, fmtTime, signed, useAdminData, useSlotPick } from './kit';

type Sub = 'ledger' | 'audit' | 'health';

export function OpsTab() {
  const [sub, setSub] = useState<Sub>('health');
  return (
    <div className="space-y-4">
      <Segmented label="Operations view" value={sub} onChange={setSub} options={[{ value: 'health', label: 'HEALTH' }, { value: 'ledger', label: 'LEDGER' }, { value: 'audit', label: 'AUDIT LOG' }]} />
      {sub === 'health' && <Health />}
      {sub === 'ledger' && <Ledger />}
      {sub === 'audit' && <Audit />}
    </div>
  );
}

interface LedgerRow { id: number; kind: string; sprint: number | null; wallet_delta: number; earned_delta: number; spent_delta: number; grant_delta: number; score_delta: number; wallet_after: number; source_type: string; reason: string | null; created_at: string; crew_id: string; team_name: string; actor: string | null }

function Ledger() {
  const [slotId, setSlotId] = useSlotPick();
  const [crew, setCrew] = useState('');
  const st = useAdminData<LedgerRow[]>(slotId ? `${V1}/admin/ledger?slotId=${slotId}` : null);
  return (
    <div className={CARD}>
      <SectionHead label="APPEND-ONLY" title="Coin ledger">
        <input className="input !py-2" placeholder="Filter crew / team" value={crew} onChange={(e) => setCrew(e.target.value)} aria-label="Filter ledger by crew" />
      </SectionHead>
      <div className="mb-3"><SlotPicker value={slotId} onChange={setSlotId} /></div>
      <Loadable state={st} title="Ledger" empty={(d) => d.length === 0}>
        {(rows) => (
          <DataTable head={['#', 'TIME', 'SPRINT', 'CREW', 'KIND', 'WALLET Δ', 'EARNED Δ', 'SPENT Δ', 'SCORE Δ', 'WALLET AFTER', 'SOURCE', 'REASON', 'ACTOR']}>
            {rows.filter((r) => !crew || `${r.crew_id} ${r.team_name}`.toLowerCase().includes(crew.toLowerCase())).map((r) => (
              <tr key={r.id} className={TR}>
                <td className={`${TD} font-mono`}>{r.id}</td>
                <td className={TD}>{fmtTime(r.created_at)}</td>
                <td className={`${TD} font-mono`}>{r.sprint ?? '—'}</td>
                <td className={TD}><span className="font-mono">{r.crew_id}</span> {r.team_name}</td>
                <td className={TD}><Badge>{r.kind}</Badge></td>
                <td className={`${TD} font-mono`}>{signed(r.wallet_delta)}</td>
                <td className={`${TD} font-mono`}>{signed(r.earned_delta)}</td>
                <td className={`${TD} font-mono`}>{signed(r.spent_delta)}</td>
                <td className={`${TD} font-mono`}>{signed(r.score_delta)}</td>
                <td className={`${TD} font-mono text-[#e8cf8e]`}>{r.wallet_after}</td>
                <td className={TD}>{r.source_type}</td>
                <td className={`${TD} max-w-[240px] whitespace-normal`}>{r.reason ?? ''}</td>
                <td className={TD}>{r.actor ?? 'system'}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Loadable>
    </div>
  );
}

interface AuditRow { id: number; actor_type: string; action: string; target_type: string | null; target_id: string | null; reason: string | null; details: unknown; created_at: string; actor_name: string | null }

function Audit() {
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState('');
  const limit = 200;
  const st = useAdminData<AuditRow[]>(`${V1}/admin/audit?limit=${limit}&offset=${offset}`);
  return (
    <div className={CARD}>
      <SectionHead label="APPEND-ONLY" title="Audit log">
        <input className="input !py-2" placeholder="Filter action / actor" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter audit log" />
        <Button secondary className={SMALL} disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - limit))}>Newer</Button>
        <Button secondary className={SMALL} disabled={(st.data?.length ?? 0) < limit} onClick={() => setOffset((o) => o + limit)}>Older</Button>
      </SectionHead>
      <Loadable state={st} title="Audit log" empty={(d) => d.length === 0}>
        {(rows) => (
          <DataTable head={['#', 'TIME', 'ACTOR', 'ACTION', 'TARGET', 'REASON', 'DETAILS']}>
            {rows.filter((r) => !q || `${r.action} ${r.actor_name ?? ''} ${r.actor_type}`.toLowerCase().includes(q.toLowerCase())).map((r) => (
              <tr key={r.id} className={TR}>
                <td className={`${TD} font-mono`}>{r.id}</td>
                <td className={TD}>{fmtTime(r.created_at)}</td>
                <td className={TD}>{r.actor_name ?? r.actor_type}<div className="text-[9px] text-muted">{r.actor_type}</div></td>
                <td className={`${TD} font-mono`}>{r.action}</td>
                <td className={`${TD} font-mono text-[10px]`}>{r.target_type ?? ''}{r.target_id ? `:${r.target_id.slice(0, 8)}` : ''}</td>
                <td className={`${TD} max-w-[220px] whitespace-normal`}>{r.reason ?? ''}</td>
                <td className={`${TD} max-w-[360px]`}><code className="block truncate text-[10px] text-muted" title={JSON.stringify(r.details)}>{r.details ? JSON.stringify(r.details) : ''}</code></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Loadable>
    </div>
  );
}

interface HealthResp {
  db: { ok: boolean; latencyMs: number; pool: { total: number; idle: number; waiting: number } };
  workers: { name: string; ageSeconds: number; healthy: boolean; info: unknown }[];
  outbox: { latestId: number; deliveredThrough: number; lag: number };
  runner: { ok: boolean; runtimes?: Record<string, string | null>; error?: string };
  runQueue: { active_runs: number } | null;
  sockets: number;
  deadlines: { slot: string; sprint: number; status: string; deadline_at: string }[];
  ledgerReconciled: boolean;
  ledgerDrift: unknown[];
  mail: { mode: string; smtpConfigured: boolean };
}

function Health() {
  const st = useAdminData<HealthResp>(`${V1}/admin/health`, { pollMs: 10_000 });
  return (
    <Loadable state={st} title="Health">
      {(h) => (
        <div className={CARD}>
          <SectionHead label="SHIP STATUS" title="System health (refreshes every 10 s)" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Tile k="DATABASE" ok={h.db.ok} v={`${h.db.latencyMs} ms · pool ${h.db.pool.total} (${h.db.pool.idle} idle, ${h.db.pool.waiting} waiting)`} />
            <Tile k="CODE RUNNER" ok={h.runner.ok} v={h.runner.ok ? Object.entries(h.runner.runtimes ?? {}).map(([k, v]) => `${k}: ${v ?? 'missing'}`).join(' · ') || 'ok' : h.runner.error ?? 'unreachable'} />
            <Tile k="OUTBOX" ok={h.outbox.lag < 50} v={`latest ${h.outbox.latestId} · delivered ${h.outbox.deliveredThrough} · lag ${h.outbox.lag}`} />
            <Tile k="LEDGER RECONCILED" ok={h.ledgerReconciled} v={h.ledgerReconciled ? 'cached totals match the ledger' : `${h.ledgerDrift.length} enrollment(s) drift`} />
            <Tile k="MAIL" ok={h.mail.mode !== 'NONE'} v={h.mail.mode === 'CAPTURE' ? 'CAPTURE — demo mail, not delivered externally' : `${h.mail.mode}${h.mail.smtpConfigured ? ' · SMTP configured' : ''}`} />
            <Tile k="REALTIME" ok v={`${h.sockets} socket(s) · ${h.runQueue?.active_runs ?? 0} active run(s)`} />
          </div>
          <div className={`${SUBCARD} mt-4`}>
            <Label className="mb-2">WORKERS</Label>
            {h.workers.length === 0 ? <Notice tone="warn">No worker heartbeat recorded — sprint deadlines and scheduled bonus releases need the worker.</Notice> : (
              <ul className="space-y-1 text-xs">{h.workers.map((w) => <li key={w.name}><Badge>{w.healthy ? 'ONLINE' : 'OFFLINE'}</Badge> <span className="font-mono">{w.name}</span> · last beat {w.ageSeconds}s ago</li>)}</ul>
            )}
          </div>
          {h.deadlines.length > 0 && (
            <div className={`${SUBCARD} mt-4`}>
              <Label className="mb-2">LIVE SPRINT DEADLINES</Label>
              <ul className="space-y-1 text-xs">{h.deadlines.map((d, i) => <li key={i}>{d.slot} · sprint {d.sprint} · {d.status} · deadline {fmtTime(d.deadline_at)}</li>)}</ul>
            </div>
          )}
          {!h.ledgerReconciled && <div className="mt-4"><Notice tone="danger"><pre className="whitespace-pre-wrap font-mono text-[10px]">{JSON.stringify(h.ledgerDrift, null, 1)}</pre></Notice></div>}
        </div>
      )}
    </Loadable>
  );
}

function Tile({ k, v, ok }: { k: string; v: string; ok: boolean }) {
  return (
    <div className={`rounded-lg border-2 p-3 ${ok ? 'border-[#3b6270] bg-[#112e3a]' : 'border-[#9d635a] bg-[#442b34]'}`}>
      <div className="flex items-center justify-between"><Label>{k}</Label><Badge>{ok ? 'ONLINE' : 'DANGER'}</Badge></div>
      <div className="mt-2 break-words text-xs">{v}</div>
    </div>
  );
}
