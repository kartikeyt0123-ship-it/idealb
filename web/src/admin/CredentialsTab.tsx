/**
 * Credentials: explicit preview → confirm → send. In CAPTURE (demo) mode mail
 * is stored locally for organizers and is NEVER delivered externally.
 */
import { KeyRound, Mail, Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { V1, api } from '../lib/api';
import { Badge, Button, Label, StatePanel } from '../components/ui';
import {
  CARD, Check, DataTable, Loadable, Notice, SMALL, SUBCARD, SectionHead, Select, TD, TR, errText, fmtDate, fmtTime, useAdminData, useConsole, useRun,
} from './kit';
import type { TeamRow } from './types';

interface CredPreview {
  channel: 'CAPTURE' | 'SMTP' | 'NONE' | string;
  channelNote: string;
  recipients: { teamId: string; crewId: string; name: string; email: string; slot: string | null; warnings: string[] }[];
  sample: { subject: string; body: string } | null;
}
interface CredResult { channel: string; demoCapture: boolean; deliveredExternally?: boolean; results: { crewId: string; email: string; status: 'CAPTURED' | 'SENT' | 'FAILED'; error?: string }[] }

function ChannelBanner({ channel, note }: { channel: string; note: string }) {
  const capture = channel === 'CAPTURE';
  return (
    <div className={`rounded-lg border-2 px-4 py-3 ${capture ? 'border-[#a8935a] bg-[#3a3626]' : channel === 'NONE' ? 'border-[#9d635a] bg-[#442b34]' : 'border-[#5f9c90] bg-[#1d3a46]'}`}>
      <Label className="!text-[#e7c784]">DELIVERY CHANNEL · {channel}</Label>
      <div className="mt-1 font-display text-sm font-bold">{capture ? 'Demo mail, not delivered externally' : channel === 'NONE' ? 'Mail is not configured' : 'SMTP delivery'}</div>
      <p className="mt-1 text-[11px] leading-5 text-[#d3dedd]">{note}</p>
    </div>
  );
}

/** Preview → confirm → send for a fixed set of crews (used by the Crews bulk bar and this tab). */
export function CredentialFlow({ teamIds, onDone }: { teamIds: string[]; onDone?: () => void }) {
  const { confirm, can } = useConsole();
  const { run, busy } = useRun();
  const [reason, setReason] = useState<'INITIAL' | 'RESET'>('INITIAL');
  const [pv, setPv] = useState<CredPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<CredResult | null>(null);
  const key = teamIds.join(',');
  useEffect(() => {
    setPv(null);
    setResult(null);
    setErr(null);
  }, [key, reason]);
  if (!can('credentials.send')) return <Notice tone="danger">Your role cannot send credentials.</Notice>;
  const preview = async () => {
    setErr(null);
    try {
      setPv(await api.post<CredPreview>(`${V1}/admin/credential-deliveries/preview`, { teamIds, reason }));
    } catch (e) {
      setErr(errText(e));
    }
  };
  const send = async () => {
    if (!pv) return;
    const capture = pv.channel === 'CAPTURE';
    const ok = await confirm({
      title: `Send ${reason === 'RESET' ? 'new temporary passwords' : 'credentials'} to ${pv.recipients.length} crew(s)`,
      tone: 'warning',
      body: <ChannelBanner channel={pv.channel} note={pv.channelNote} />,
      effects: [
        'A new temporary password is generated server-side for each crew; existing passwords stop working.',
        'Every signed-in device of these crews is signed out.',
        capture ? 'Messages are captured in the demo mail inbox — they are NOT delivered to the crews.' : 'Messages are sent by SMTP to each captain email.',
      ],
      ack: 'I reviewed the recipients and want to send now.',
      confirmLabel: capture ? 'Capture demo mail' : 'Send credentials',
    });
    if (!ok) return;
    const r = await run('send', () => api.post<CredResult>(`${V1}/admin/credential-deliveries`, { teamIds, reason, confirm: true }), (x) => (x.demoCapture ? `${x.results.length} message(s) captured locally (demo mail, not delivered externally).` : `${x.results.filter((y) => y.status === 'SENT').length} sent, ${x.results.filter((y) => y.status === 'FAILED').length} failed.`));
    if (r) {
      setResult(r);
      onDone?.();
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label>
          <span className="mb-1 block font-mono text-[9px] text-muted">REASON</span>
          <Select ariaLabel="Reason" value={reason} onChange={setReason} options={[{ value: 'INITIAL', label: 'INITIAL — first credentials' }, { value: 'RESET', label: 'RESET — new temporary password' }]} />
        </label>
        <Button secondary className={SMALL} disabled={!teamIds.length} onClick={() => void preview()}>Preview {teamIds.length} recipient(s)</Button>
      </div>
      {err && <Notice tone="danger">{err}</Notice>}
      {pv && !result && (
        <>
          <ChannelBanner channel={pv.channel} note={pv.channelNote} />
          <DataTable head={['CREW', 'TEAM', 'EMAIL', 'SLOT', 'WARNINGS']}>
            {pv.recipients.map((r) => (
              <tr key={r.teamId} className={TR}>
                <td className={`${TD} font-mono`}>{r.crewId}</td>
                <td className={TD}>{r.name}</td>
                <td className={TD}>{r.email}</td>
                <td className={TD}>{r.slot ?? '—'}</td>
                <td className={TD}>{r.warnings.length ? r.warnings.map((w) => <div key={w} className="text-[#ebd68c]">⚠ {w}</div>) : <span className="text-muted">—</span>}</td>
              </tr>
            ))}
          </DataTable>
          {pv.sample && (
            <div className={SUBCARD}>
              <Label className="mb-2">SAMPLE MESSAGE (PASSWORD GENERATED ON SEND)</Label>
              <div className="mb-2 font-bold">{pv.sample.subject}</div>
              <pre className="whitespace-pre-wrap font-mono text-[11px] text-[#d3dedd]">{pv.sample.body}</pre>
            </div>
          )}
          <div className="flex justify-end">
            <Button className={SMALL} disabled={!!busy || pv.channel === 'NONE' || !pv.recipients.length} onClick={() => void send()}><Send size={12} /> {pv.channel === 'CAPTURE' ? 'Capture demo mail…' : 'Send…'}</Button>
          </div>
        </>
      )}
      {result && (
        <div className="space-y-3">
          {result.demoCapture ? <Notice tone="warn">Demo mail, not delivered externally — read the captured messages in the demo mail inbox below.</Notice> : result.deliveredExternally === false ? <Notice tone="warn">Messages were not delivered externally (mail sink).</Notice> : null}
          <DataTable head={['CREW', 'EMAIL', 'STATUS', 'ERROR']}>
            {result.results.map((r) => (
              <tr key={r.crewId} className={TR}>
                <td className={`${TD} font-mono`}>{r.crewId}</td>
                <td className={TD}>{r.email}</td>
                <td className={TD}><Badge>{r.status}</Badge></td>
                <td className={`${TD} text-[#f3b399]`}>{r.error ?? ''}</td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
    </div>
  );
}

export function CredentialsTab() {
  const { overview, can } = useConsole();
  const teams = useAdminData<TeamRow[]>(`${V1}/admin/teams`);
  const [slotF, setSlotF] = useState('ALL');
  const [credF, setCredF] = useState('NONE');
  const [sel, setSel] = useState<string[]>([]);
  const shown = useMemo(() => (teams.data ?? []).filter((t) => (slotF === 'ALL' || String(t.slot_number) === slotF) && (credF === 'ALL' || t.credential_status === credF)), [teams.data, slotF, credF]);
  return (
    <div className="space-y-6">
      {can('credentials.send') && (
        <div className={CARD}>
          <SectionHead label="EXPLICIT DELIVERY" title="Send crew credentials">
            <Select ariaLabel="Slot filter" value={slotF} onChange={setSlotF} options={[{ value: 'ALL', label: 'All slots' }, ...overview.slots.map((s) => ({ value: String(s.number), label: `${s.name} · ${fmtDate(s.date)}` }))]} />
            <Select ariaLabel="Credential filter" value={credF} onChange={setCredF} options={['ALL', 'NONE', 'ISSUED', 'DELIVERED'].map((x) => ({ value: x, label: x === 'ALL' ? 'Any credentials' : `Credentials ${x}` }))} />
          </SectionHead>
          <p className="mb-3 text-[11px] text-muted">Credentials are never sent automatically (not on import, not on crew creation). Select crews, preview, then confirm.</p>
          <Loadable state={teams} title="Crews">
            {() => (
              <div className="mb-4 max-h-64 overflow-y-auto rounded-lg border border-[#344d5b]">
                <div className="flex items-center gap-3 border-b border-[#344d5b] px-3 py-2 text-xs">
                  <Check checked={shown.length > 0 && shown.every((t) => sel.includes(t.id))} onChange={(v) => setSel(v ? [...new Set([...sel, ...shown.map((t) => t.id)])] : sel.filter((id) => !shown.some((t) => t.id === id)))} label={`Select all shown (${shown.length})`} />
                  <span className="ml-auto text-muted">{sel.length} selected</span>
                </div>
                {shown.map((t) => (
                  <label key={t.id} className="flex cursor-pointer items-center gap-3 border-b border-[#344d5b] px-3 py-2 text-xs hover:bg-[#1b3a47]">
                    <input type="checkbox" className="accent-[#8ae4cf]" checked={sel.includes(t.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, t.id] : s.filter((x) => x !== t.id)))} />
                    <span className="font-mono">{t.crew_id}</span>
                    <span className="font-bold">{t.name}</span>
                    <span className="text-muted">{t.email}</span>
                    <span className="text-muted">{t.slot_name ?? 'unassigned'}</span>
                    <Badge>{t.credential_status}</Badge>
                  </label>
                ))}
              </div>
            )}
          </Loadable>
          <CredentialFlow teamIds={sel} onDone={() => void teams.reload()} />
        </div>
      )}
      <DeliveryLog />
      {can('mail.read') && <MailInbox />}
    </div>
  );
}

interface Delivery { id: string; crew_id: string; channel: string; recipient: string; status: string; error: string | null; reason: string; created_at: string }

function DeliveryLog() {
  const st = useAdminData<Delivery[]>(`${V1}/admin/credential-deliveries`);
  return (
    <div className={CARD}>
      <SectionHead label="LOG" title="Credential delivery log (no passwords)" />
      <Loadable state={st} title="Deliveries" empty={(d) => d.length === 0}>
        {(rows) => (
          <DataTable head={['TIME', 'CREW', 'CHANNEL', 'RECIPIENT', 'REASON', 'STATUS', 'ERROR']}>
            {rows.map((d) => (
              <tr key={d.id} className={TR}>
                <td className={TD}>{fmtTime(d.created_at)}</td>
                <td className={`${TD} font-mono`}>{d.crew_id}</td>
                <td className={TD}>{d.channel === 'CAPTURE' ? 'CAPTURE (demo, not delivered)' : d.channel}</td>
                <td className={TD}>{d.recipient}</td>
                <td className={TD}>{d.reason}</td>
                <td className={TD}><Badge>{d.status}</Badge></td>
                <td className={`${TD} text-[#f3b399]`}>{d.error ?? ''}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Loadable>
    </div>
  );
}

interface CapturedMail { id: string; recipient: string; subject: string; body: string; created_at: string; reason: string; crew_id: string }

function MailInbox() {
  const [open, setOpen] = useState(false);
  const st = useAdminData<{ note: string; messages: CapturedMail[] }>(open ? `${V1}/admin/mail-capture` : null);
  const [view, setView] = useState<string | null>(null);
  return (
    <div className={CARD}>
      <SectionHead label="DEMO MAIL" title="Captured mail inbox">
        <Badge>DEMO · NOT DELIVERED EXTERNALLY</Badge>
        <Button secondary className={SMALL} onClick={() => setOpen((o) => !o)}><Mail size={12} /> {open ? 'Hide' : 'Open inbox'}</Button>
      </SectionHead>
      <p className="text-[11px] text-muted">These messages were captured locally in demo mode. They contain temporary passwords — handle them like credentials.</p>
      {open && (
        <div className="mt-3">
          <Loadable state={st} title="Captured mail">
            {(d) => d.messages.length === 0 ? <StatePanel kind="empty" title="Inbox empty" message={d.note} /> : (
              <div className="space-y-2">
                <Notice tone="warn">{d.note}</Notice>
                {d.messages.map((m) => (
                  <div key={m.id} className={SUBCARD}>
                    <button type="button" className="flex w-full flex-wrap items-center gap-3 text-left text-xs" onClick={() => setView((v) => (v === m.id ? null : m.id))} aria-expanded={view === m.id}>
                      <KeyRound size={12} className="text-[#e6c887]" />
                      <span className="font-mono">{m.crew_id}</span>
                      <span className="font-bold">{m.subject}</span>
                      <span className="text-muted">to {m.recipient}</span>
                      <span className="ml-auto text-muted">{fmtTime(m.created_at)}</span>
                    </button>
                    {view === m.id && <pre className="mt-3 whitespace-pre-wrap font-mono text-[11px] text-[#d3dedd]">{m.body}</pre>}
                  </div>
                ))}
              </div>
            )}
          </Loadable>
        </div>
      )}
    </div>
  );
}
