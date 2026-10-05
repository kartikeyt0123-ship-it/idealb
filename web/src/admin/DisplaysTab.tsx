/**
 * Projector displays: revocable display links (key shown once) and quick-open
 * buttons (the organizer cookie also authorises /display/* in this browser).
 */
import { ExternalLink, MonitorPlay, Plus } from 'lucide-react';
import { useState } from 'react';
import { V1, api } from '../lib/api';
import { Badge, Button, Field, Label } from '../components/ui';
import { CARD, CopyButton, DataTable, Loadable, Notice, NumInput, SMALL, SUBCARD, SectionHead, TD, TR, fmtDate, fmtTime, useAdminData, useConsole, useRun } from './kit';

interface DisplayLink { id: string; label: string; created_at: string; expires_at: string; revoked_at: string | null; created_by: string; live_sessions: number }
interface Created { id: string; label: string; expiresAt: string; key: string; url: string }

export function DisplaysTab() {
  const { overview, can } = useConsole();
  return (
    <div className="space-y-6">
      {can('display.manage') && <Links />}
      <div className={CARD}>
        <SectionHead label="QUICK OPEN" title="Open a projector view in this browser" />
        <p className="mb-3 text-[11px] text-muted">Your organizer session authorises these screens in this browser. For a separate projector machine, create a display link.</p>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Open href="/display/overall">Overall (provisional until final)</Open>
          </div>
          {overview.slots.map((s) => (
            <div key={s.id} className={`${SUBCARD} flex flex-wrap items-center gap-2`}>
              <span className="w-48 text-xs font-bold">{s.name} · {fmtDate(s.date)}</span>
              <Open href={`/display/slots/${s.id}`}>Slot cumulative</Open>
              {s.sprints.map((sp) => <Open key={sp.id} href={`/display/slots/${s.id}/sprints/${sp.id}`}>{`Sprint ${sp.number} · ${sp.status}`}</Open>)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Open({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border-2 border-[#52717e] bg-[#2d4654] px-3 py-2 font-mono text-[9px] tracking-wider text-[#d6e1e1] hover:bg-[#3a5a63]">
      <ExternalLink size={10} /> {children}
    </a>
  );
}

function Links() {
  const { confirm } = useConsole();
  const { run, busy } = useRun();
  const st = useAdminData<DisplayLink[]>(`${V1}/admin/display-links`);
  const [label, setLabel] = useState('Main hall projector');
  const [hours, setHours] = useState('24');
  const [created, setCreated] = useState<Created | null>(null);
  const create = async () => {
    const r = await run('create', () => api.post<Created>(`${V1}/admin/display-links`, { label: label.trim(), hours: Math.min(168, Math.max(1, Number(hours) || 24)) }), 'Display link created — copy it now, it is shown only once.');
    if (r) {
      setCreated(r);
      void st.reload();
    }
  };
  const revoke = async (l: DisplayLink) => {
    if (!(await confirm({ title: `Revoke “${l.label}”`, effects: ['The link stops working immediately.', `${l.live_sessions} connected screen(s) are disconnected.`], confirmLabel: 'Revoke link' }))) return;
    if (await run(l.id, () => api.del(`${V1}/admin/display-links/${l.id}`), 'Display link revoked.')) void st.reload();
  };
  return (
    <div className={CARD}>
      <SectionHead label="PROJECTOR LINKS" title="Revocable display links" />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1"><Field label="LABEL"><input className="input" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} /></Field></div>
        <div className="w-28"><Field label="VALID (HOURS)"><NumInput value={hours} onChange={setHours} min={1} max={168} ariaLabel="Hours valid" /></Field></div>
        <div className="mb-4"><Button className={SMALL} disabled={!label.trim() || !!busy} onClick={() => void create()}><Plus size={12} /> Create link</Button></div>
      </div>
      {created && (
        <div className="mb-4 rounded-lg border-2 border-[#a8935a] bg-[#3a3626] p-4">
          <Label className="!text-[#e7c784]">SHOWN ONCE — COPY IT NOW</Label>
          <div className="mt-2 break-all font-mono text-xs text-[#f2f0e7]">{created.url}</div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <CopyButton text={created.url} label="Copy URL" />
            <a href={created.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[10px] text-[#e6c887] hover:underline"><MonitorPlay size={11} /> open</a>
            <Button secondary className={SMALL} onClick={() => setCreated(null)}>I copied it — hide</Button>
          </div>
          <p className="mt-2 text-[10px] text-[#ebd68c]">Anyone with this URL can view the projector standings until {fmtTime(created.expiresAt)} or until you revoke it. The key is not stored in readable form and cannot be shown again.</p>
        </div>
      )}
      <Loadable state={st} title="Display links" empty={(d) => d.length === 0}>
        {(rows) => (
          <DataTable head={['LABEL', 'CREATED', 'BY', 'EXPIRES', 'LIVE SCREENS', 'STATE', '']}>
            {rows.map((l) => {
              const expired = Date.parse(l.expires_at) <= Date.now();
              return (
                <tr key={l.id} className={TR}>
                  <td className={TD}>{l.label}</td>
                  <td className={TD}>{fmtTime(l.created_at)}</td>
                  <td className={TD}>{l.created_by}</td>
                  <td className={TD}>{fmtTime(l.expires_at)}</td>
                  <td className={`${TD} font-mono`}>{l.live_sessions}</td>
                  <td className={TD}><Badge>{l.revoked_at ? 'REVOKED' : expired ? 'EXPIRED' : 'ACTIVE'}</Badge></td>
                  <td className={TD}>{!l.revoked_at && !expired && <Button danger className={SMALL} disabled={!!busy} onClick={() => void revoke(l)}>Revoke</Button>}</td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Loadable>
      <div className="mt-3"><Notice>Display screens show approved standings fields only — never emails, members, answers or admin data.</Notice></div>
    </div>
  );
}
