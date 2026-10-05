/**
 * Crews: searchable table, edit / create, sessions, disqualification, ledger
 * adjustments, bulk slot assignment and credential delivery.
 */
import { Coins, KeyRound, MonitorSmartphone, Pencil, Plus, ShieldAlert, ShieldCheck, Users } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { V1, api } from '../lib/api';
import { Badge, Button, Field, Label, StatePanel, useToast } from '../components/ui';
import {
  CARD, Check, DataTable, Loadable, Modal, Notice, NumInput, SMALL, SectionHead, Select, TD, TR, errText, fmtDate, fmtTime, toApiError, useAdminData, useConsole, useRun,
} from './kit';
import { CredentialFlow } from './CredentialsTab';
import type { TeamMember, TeamRow } from './types';

export function CrewsTab() {
  const { overview, can } = useConsole();
  const st = useAdminData<TeamRow[]>(`${V1}/admin/teams`);
  const [q, setQ] = useState('');
  const [slotF, setSlotF] = useState('ALL');
  const [credF, setCredF] = useState('ALL');
  const [sel, setSel] = useState<string[]>([]);
  const [edit, setEdit] = useState<TeamRow | 'new' | null>(null);
  const [sessions, setSessions] = useState<TeamRow | null>(null);
  const [adjust, setAdjust] = useState<TeamRow | null>(null);
  const [bulk, setBulk] = useState<'assign' | 'creds' | null>(null);

  const rows = useMemo(() => (st.data ?? []).filter((t) => {
    if (slotF === 'NONE' && t.slot_number !== null) return false;
    if (slotF !== 'ALL' && slotF !== 'NONE' && String(t.slot_number) !== slotF) return false;
    if (credF !== 'ALL' && t.credential_status !== credF) return false;
    if (q && !`${t.crew_id} ${t.name} ${t.email} ${t.captain_name}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [st.data, q, slotF, credF]);
  const allSel = rows.length > 0 && rows.every((r) => sel.includes(r.id));

  return (
    <div className="space-y-4">
      <div className={CARD}>
        <SectionHead label="CREW MANIFEST" title={`Crews (${st.data?.length ?? '…'})`}>
          {can('teams.write') && <Button className={SMALL} onClick={() => setEdit('new')}><Plus size={12} /> New crew</Button>}
        </SectionHead>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <input className="input !py-2" placeholder="Search crew ID, team, email, captain…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search crews" />
          <Select ariaLabel="Filter by slot" value={slotF} onChange={setSlotF} options={[{ value: 'ALL', label: 'All slots' }, { value: 'NONE', label: 'Unassigned' }, ...overview.slots.map((s) => ({ value: String(s.number), label: `${s.name} · ${fmtDate(s.date)}` }))]} />
          <Select ariaLabel="Filter by credentials" value={credF} onChange={setCredF} options={['ALL', 'NONE', 'ISSUED', 'DELIVERED'].map((x) => ({ value: x, label: x === 'ALL' ? 'All credentials' : `Credentials ${x}` }))} />
        </div>
        {sel.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#3b6270] bg-[#112e3a] px-3 py-2 text-xs">
            <span>{sel.length} selected</span>
            {can('teams.write') && <Button secondary className={SMALL} onClick={() => setBulk('assign')}><Users size={11} /> Assign slot</Button>}
            {can('credentials.send') && <Button secondary className={SMALL} onClick={() => setBulk('creds')}><KeyRound size={11} /> Send credentials</Button>}
            <Button secondary className={SMALL} onClick={() => setSel([])}>Clear</Button>
          </div>
        )}
      </div>
      <Loadable state={st} title="Crews" empty={(d) => d.length === 0}>
        {() => (
          <DataTable
            label="Crews"
            head={[
              <input key="all" type="checkbox" aria-label="Select all shown" className="accent-[#8ae4cf]" checked={allSel} onChange={(e) => setSel(e.target.checked ? [...new Set([...sel, ...rows.map((r) => r.id)])] : sel.filter((id) => !rows.some((r) => r.id === id)))} />,
              'CREW', 'TEAM', 'CAPTAIN EMAIL', 'SLOT', 'ENABLED', 'CHECKED IN', 'CREDENTIALS', 'SESSIONS', 'CUMULATIVE', 'STATUS', 'ACTIONS',
            ]}
          >
            {rows.map((t) => {
              const dq = t.disqualifications?.[0];
              return (
                <tr key={t.id} className={TR}>
                  <td className={TD}><input type="checkbox" aria-label={`Select ${t.crew_id}`} className="accent-[#8ae4cf]" checked={sel.includes(t.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, t.id] : s.filter((x) => x !== t.id)))} /></td>
                  <td className={`${TD} font-mono`}><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: t.color }} />{t.crew_id}</td>
                  <td className={TD}><div className="font-bold">{t.name}</div><div className="text-[10px] text-muted">{t.captain_name} · {t.members?.length ?? 0} members</div></td>
                  <td className={TD}>{t.email}</td>
                  <td className={TD}>{t.slot_number ? <>{t.slot_name}<div className="text-[10px] text-muted">{fmtDate(t.slot_date)}</div></> : <span className="text-[#ebd68c]">unassigned</span>}</td>
                  <td className={TD}><Badge>{t.account_enabled ? 'ENABLED' : 'DISABLED'}</Badge></td>
                  <td className={TD}>{t.checked_in_at ? <span title={fmtTime(t.checked_in_at)}>✓</span> : '—'}</td>
                  <td className={TD}><Badge>{t.credential_status}</Badge>{t.last_credential_at && <div className="text-[10px] text-muted">{fmtTime(t.last_credential_at)}</div>}</td>
                  <td className={`${TD} font-mono`}>{t.sessions}</td>
                  <td className={`${TD} font-mono text-[#e8cf8e]`}>{t.standing ? `${t.standing.cumulative}${t.standing.rank ? ` · #${t.standing.rank}` : ''}` : '—'}</td>
                  <td className={TD}>{t.enrollment_status ? <Badge>{t.enrollment_status}</Badge> : '—'}{t.status === 'ARCHIVED' && <Badge>ARCHIVED</Badge>}</td>
                  <td className={TD}>
                    <div className="flex flex-wrap gap-1">
                      {can('teams.write') && <IconBtn label="Edit" onClick={() => setEdit(t)}><Pencil size={11} /></IconBtn>}
                      <IconBtn label="Sessions" onClick={() => setSessions(t)}><MonitorSmartphone size={11} /></IconBtn>
                      {can('coins.adjust') && t.enrollment_id && <IconBtn label="Adjust coins" onClick={() => setAdjust(t)}><Coins size={11} /></IconBtn>}
                      {can('disqualify') && (dq ? <RevokeDq dqId={dq.id} crew={t.crew_id} reload={st.reload} /> : <Disqualify team={t} reload={st.reload} />)}
                    </div>
                    {dq && <div className="mt-1 max-w-[200px] whitespace-normal text-[10px] text-[#ee9582]">DQ: {dq.reason}</div>}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Loadable>
      {edit && <TeamForm team={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void st.reload(); }} />}
      {sessions && <SessionsDialog team={sessions} onClose={() => { setSessions(null); void st.reload(); }} />}
      {adjust && <AdjustDialog team={adjust} onClose={() => { setAdjust(null); void st.reload(); }} />}
      {bulk === 'assign' && <BulkAssign teamIds={sel} onClose={() => { setBulk(null); void st.reload(); }} />}
      {bulk === 'creds' && (
        <Modal open onClose={() => { setBulk(null); void st.reload(); }} title="Send credentials to selected crews" label="CREDENTIALS" wide>
          <CredentialFlow teamIds={sel} onDone={() => void st.reload()} />
        </Modal>
      )}
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className="inline-flex items-center gap-1 rounded-md border border-[#52717e] bg-[#2d4654] px-2 py-1 font-mono text-[9px] text-[#d6e1e1] hover:bg-[#3a5a63]">
      {children}
      <span>{label}</span>
    </button>
  );
}

function Disqualify({ team, reload }: { team: TeamRow; reload: () => Promise<void> }) {
  const { confirm } = useConsole();
  const { run } = useRun();
  const go = async () => {
    const r = await confirm({ title: `Disqualify ${team.crew_id} · ${team.name}`, effects: ['The crew is removed from standings and cannot submit.', 'Running code jobs are cancelled.', 'Can be revoked later as an audited correction.'], reason: { label: 'DISQUALIFICATION REASON', min: 8 }, confirmLabel: 'Disqualify' });
    if (!r) return;
    if (await run('dq', () => api.post(`${V1}/admin/teams/${team.id}/disqualify`, { reason: r.reason }), `${team.crew_id} disqualified.`)) void reload();
  };
  return <IconBtn label="Disqualify" onClick={() => void go()}><ShieldAlert size={11} /></IconBtn>;
}

function RevokeDq({ dqId, crew, reload }: { dqId: string; crew: string; reload: () => Promise<void> }) {
  const { confirm } = useConsole();
  const { run } = useRun();
  const go = async () => {
    const r = await confirm({ title: `Revoke disqualification of ${crew}`, tone: 'warning', reason: { label: 'CORRECTION REASON', min: 8 }, confirmLabel: 'Revoke DQ' });
    if (!r) return;
    if (await run('rdq', () => api.post(`${V1}/admin/disqualifications/${dqId}/revoke`, { reason: r.reason }), `Disqualification of ${crew} revoked.`)) void reload();
  };
  return <IconBtn label="Revoke DQ" onClick={() => void go()}><ShieldCheck size={11} /></IconBtn>;
}

// ---------------------------------------------------------------------------
// Create / edit
// ---------------------------------------------------------------------------

const blankMember = (): TeamMember => ({ name: '', institution: '', year: '', branch: '', studentId: '' });

function TeamForm({ team, onClose, onSaved }: { team: TeamRow | null; onClose: () => void; onSaved: () => void }) {
  const { overview } = useConsole();
  const toast = useToast();
  const [name, setName] = useState(team?.name ?? '');
  const [email, setEmail] = useState(team?.email ?? '');
  const [crewId, setCrewId] = useState('');
  const [members, setMembers] = useState<TeamMember[]>(() => {
    const m: TeamMember[] = (team?.members ?? []).map((x) => ({ name: x.name, institution: x.institution ?? '', year: x.year ?? '', branch: x.branch ?? '', studentId: x.studentId ?? '' }));
    while (m.length < 3) m.push(blankMember());
    return m;
  });
  const [enabled, setEnabled] = useState(team?.account_enabled ?? true);
  const [checked, setChecked] = useState(!!team?.checked_in_at);
  const [slot, setSlot] = useState(team?.slot_number ? String(team.slot_number) : 'none');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ msg: string; code: string } | null>(null);

  const cleanMembers = members.filter((m) => m.name.trim()).map((m) => ({ name: m.name.trim(), institution: m.institution.trim(), year: m.year.trim(), branch: m.branch.trim(), ...(m.studentId?.trim() ? { studentId: m.studentId.trim() } : {}) }));
  const slotNum = slot === 'none' ? null : Number(slot);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (!team) {
        const r = await api.post<{ crewId: string }>(`${V1}/admin/teams`, { teamName: name.trim(), crewId: crewId.trim() || undefined, captainEmail: email.trim(), members: cleanMembers, slot: slotNum, accountEnabled: enabled, checkedIn: checked });
        toast(`${r.crewId} created. No credentials were sent.`, 'good');
      } else {
        const patch: Record<string, unknown> = {};
        if (name.trim() !== team.name) patch.teamName = name.trim();
        if (email.trim() !== team.email) patch.captainEmail = email.trim();
        const before = JSON.stringify((team.members ?? []).map((m) => [m.name, m.institution, m.year, m.branch, m.studentId ?? '']));
        const after = JSON.stringify(cleanMembers.map((m) => [m.name, m.institution, m.year, m.branch, m.studentId ?? '']));
        if (before !== after) patch.members = cleanMembers;
        if (enabled !== team.account_enabled) patch.accountEnabled = enabled;
        if (checked !== !!team.checked_in_at) patch.checkedIn = checked;
        if (slotNum !== team.slot_number) patch.slot = slotNum;
        if (!Object.keys(patch).length) {
          onClose();
          return;
        }
        await api.patch(`${V1}/admin/teams/${team.id}`, patch);
        toast(`${team.crew_id} updated.`, 'good');
      }
      onSaved();
    } catch (e) {
      const er = toApiError(e);
      setErr({ msg: errText(er), code: er.code });
    } finally {
      setBusy(false);
    }
  };
  const setM = (i: number, k: keyof TeamMember, v: string) => setMembers((ms) => ms.map((m, j) => (j === i ? { ...m, [k]: v } : m)));

  return (
    <Modal open onClose={onClose} title={team ? `Edit ${team.crew_id} · ${team.name}` : 'Create crew'} label="CREW RECORD" wide>
      {err && (
        <div className="mb-3">
          <Notice tone="danger">
            {err.code === 'SLOT_CHANGE_BLOCKED' && <strong>SLOT CHANGE BLOCKED · </strong>}
            {err.msg}
          </Notice>
        </div>
      )}
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="TEAM NAME"><input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="CAPTAIN EMAIL"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        {!team && <Field label="CREW ID (OPTIONAL)" hint="Leave empty to auto-assign CRW-###."><input className="input" value={crewId} placeholder="CRW-001" onChange={(e) => setCrewId(e.target.value)} /></Field>}
        <Field label="SLOT" hint={team?.standing ? 'Slot changes are blocked once the crew has scored.' : undefined}>
          <Select ariaLabel="Slot" value={slot} onChange={setSlot} options={[{ value: 'none', label: 'Unassigned' }, ...overview.slots.map((s) => ({ value: String(s.number), label: `${s.name} · ${fmtDate(s.date)} (${s.counts.crews}/${s.capacity})` }))]} />
        </Field>
      </div>
      <div className="mb-4 flex flex-wrap gap-6">
        <Check checked={enabled} onChange={setEnabled} label="Account enabled" />
        <Check checked={checked} onChange={setChecked} label="Checked in" />
      </div>
      <Label className="mb-2">MEMBERS (3–4, FIRST IS CAPTAIN)</Label>
      <div className="space-y-2">
        {members.map((m, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1.4fr_1.4fr_.7fr_.7fr_.8fr_auto]">
            <input className="input !py-2" aria-label={`Member ${i + 1} name`} placeholder={i === 0 ? 'Captain name' : `Member ${i + 1} name`} value={m.name} onChange={(e) => setM(i, 'name', e.target.value)} />
            <input className="input !py-2" aria-label={`Member ${i + 1} institution`} placeholder="Institution" value={m.institution} onChange={(e) => setM(i, 'institution', e.target.value)} />
            <input className="input !py-2" aria-label={`Member ${i + 1} year`} placeholder="Year" value={m.year} onChange={(e) => setM(i, 'year', e.target.value)} />
            <input className="input !py-2" aria-label={`Member ${i + 1} branch`} placeholder="Branch" value={m.branch} onChange={(e) => setM(i, 'branch', e.target.value)} />
            <input className="input !py-2" aria-label={`Member ${i + 1} student ID`} placeholder="Student ID" value={m.studentId ?? ''} onChange={(e) => setM(i, 'studentId', e.target.value)} />
            <button type="button" className="font-mono text-[10px] text-[#ee9582] disabled:opacity-30" disabled={members.length <= 3} onClick={() => setMembers((ms) => ms.filter((_, j) => j !== i))}>remove</button>
          </div>
        ))}
      </div>
      {members.length < 4 && <button type="button" className="mt-2 font-mono text-[10px] text-[#e6c887]" onClick={() => setMembers((ms) => [...ms, blankMember()])}>+ add member</button>}
      <div className="mt-5 flex justify-end gap-2">
        <Button secondary className={SMALL} onClick={onClose}>Cancel</Button>
        <Button className={SMALL} disabled={busy || !name.trim() || !email.trim() || cleanMembers.length < 3} onClick={() => void save()}>{team ? 'Save changes' : 'Create crew'}</Button>
      </div>
      {!team && <p className="mt-2 text-[10px] text-muted">Creating a crew never sends credentials. Use CREDENTIALS to send them explicitly.</p>}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

interface SessionRow { id: string; created_at: string; last_seen_at: string; expires_at: string; user_agent: string | null; ip: string | null }

function SessionsDialog({ team, onClose }: { team: TeamRow; onClose: () => void }) {
  const { can, confirm } = useConsole();
  const { run } = useRun();
  const st = useAdminData<SessionRow[]>(`${V1}/admin/teams/${team.id}/sessions`);
  const revoke = async (s: SessionRow) => {
    if (!(await confirm({ title: 'Sign out this device?', tone: 'warning', effects: [`${s.user_agent ?? 'Unknown device'} (${s.ip ?? 'no IP'}) is signed out immediately.`], confirmLabel: 'Sign out device' }))) return;
    if (await run('rev', () => api.del(`${V1}/admin/sessions/${s.id}`), 'Device signed out.')) void st.reload();
  };
  return (
    <Modal open onClose={onClose} title={`Sessions · ${team.crew_id} ${team.name}`} label="ACTIVE DEVICES" wide>
      <Loadable state={st} title="Sessions" empty={(d) => d.length === 0}>
        {(rows) => (
          <DataTable head={['DEVICE', 'IP', 'SIGNED IN', 'LAST SEEN', 'EXPIRES', '']}>
            {rows.map((s) => (
              <tr key={s.id} className={TR}>
                <td className={`${TD} max-w-[280px] whitespace-normal`}>{s.user_agent ?? '—'}</td>
                <td className={`${TD} font-mono`}>{s.ip ?? '—'}</td>
                <td className={TD}>{fmtTime(s.created_at)}</td>
                <td className={TD}>{fmtTime(s.last_seen_at)}</td>
                <td className={TD}>{fmtTime(s.expires_at)}</td>
                <td className={TD}>{can('teams.write') && <Button danger className={SMALL} onClick={() => void revoke(s)}>Revoke</Button>}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Loadable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Ledger adjustment
// ---------------------------------------------------------------------------

function AdjustDialog({ team, onClose }: { team: TeamRow; onClose: () => void }) {
  const { run, busy } = useRun();
  const [amount, setAmount] = useState('');
  const [target, setTarget] = useState<'WALLET' | 'SCORE' | 'BOTH' | 'GRANT'>('WALLET');
  const [sprint, setSprint] = useState('none');
  const [reason, setReason] = useState('');
  const n = Number(amount);
  const ok = Number.isInteger(n) && n !== 0 && reason.trim().length >= 4 && !(target === 'GRANT' && n < 0);
  const submit = async () => {
    const r = await run('adj', () => api.post<{ wallet: number }>(`${V1}/admin/enrollments/${team.enrollment_id}/adjustments`, { amount: n, target, reason: reason.trim(), sprint: sprint === 'none' ? null : Number(sprint) }), (x) => `Adjustment recorded. Wallet now ${x.wallet}.`);
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} title={`Ledger adjustment · ${team.crew_id} ${team.name}`} label="COMPENSATING ENTRY">
      <Notice>Adjustments are immutable ledger entries (never edits). Current wallet {team.standing?.wallet ?? '—'}, cumulative {team.standing?.cumulative ?? '—'}.</Notice>
      <div className="mt-4 grid gap-x-4 sm:grid-cols-3">
        <Field label="AMOUNT (±)"><NumInput value={amount} onChange={setAmount} ariaLabel="Amount" /></Field>
        <Field label="TARGET" hint="WALLET: spendable only · SCORE: ranking only · BOTH · GRANT (+ only)">
          <Select ariaLabel="Target" value={target} onChange={setTarget} options={['WALLET', 'SCORE', 'BOTH', 'GRANT'].map((x) => ({ value: x as 'WALLET', label: x }))} />
        </Field>
        <Field label="SPRINT">
          <Select ariaLabel="Sprint" value={sprint} onChange={setSprint} options={[{ value: 'none', label: 'No sprint' }, ...[1, 2, 3, 4].map((x) => ({ value: String(x), label: `Sprint ${x}` }))]} />
        </Field>
      </div>
      <Field label="REASON (MIN 4 CHARACTERS — AUDITED)"><textarea className="input min-h-[60px]" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="flex justify-end gap-2">
        <Button secondary className={SMALL} onClick={onClose}>Cancel</Button>
        <Button danger className={SMALL} disabled={!ok || !!busy} onClick={() => void submit()}>Record adjustment</Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Bulk slot assignment (preview → apply)
// ---------------------------------------------------------------------------

interface AssignPreview { applied: boolean; preview: { slot: number | null; moving: string[]; blocked: string[]; capacity: number | null; after: number | null } }

function BulkAssign({ teamIds, onClose }: { teamIds: string[]; onClose: () => void }) {
  const { overview } = useConsole();
  const { run, busy } = useRun();
  const toast = useToast();
  const [slot, setSlot] = useState(String(overview.slots[0]?.number ?? 'none'));
  const [pv, setPv] = useState<AssignPreview | null>(null);
  const slotNum = slot === 'none' ? null : Number(slot);
  const preview = async () => {
    try {
      setPv(await api.post<AssignPreview>(`${V1}/admin/teams/bulk-assign`, { teamIds, slot: slotNum, apply: false }));
    } catch (e) {
      toast(errText(e), 'alert');
    }
  };
  const apply = async () => {
    const r = await run('assign', () => api.post<AssignPreview>(`${V1}/admin/teams/bulk-assign`, { teamIds, slot: slotNum, apply: true }), (x) => `${x.preview.moving.length} crew(s) assigned.`);
    if (r) onClose();
  };
  const over = pv && pv.preview.capacity !== null && pv.preview.after !== null && pv.preview.after > pv.preview.capacity;
  return (
    <Modal open onClose={onClose} title={`Assign ${teamIds.length} crew(s) to a slot`} label="BULK ASSIGN">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="TARGET SLOT">
          <Select ariaLabel="Target slot" value={slot} onChange={(v) => { setSlot(v); setPv(null); }} options={[...overview.slots.map((s) => ({ value: String(s.number), label: `${s.name} · ${fmtDate(s.date)} (${s.counts.crews}/${s.capacity})` })), { value: 'none', label: 'Unassign' }]} />
        </Field>
        <div className="mb-4"><Button secondary className={SMALL} onClick={() => void preview()}>Preview</Button></div>
      </div>
      {pv && (
        <div className="space-y-2 text-xs">
          <div>Moving: {pv.preview.moving.length ? pv.preview.moving.join(', ') : 'none'}</div>
          {pv.preview.blocked.length > 0 && <Notice tone="danger">Blocked (already scored — slot changes after scoring are not allowed): {pv.preview.blocked.join(', ')}</Notice>}
          {pv.preview.capacity !== null && <div>Capacity after: {pv.preview.after}/{pv.preview.capacity}</div>}
          {over && <Notice tone="danger">This would exceed the slot capacity.</Notice>}
          <div className="flex justify-end gap-2 pt-2">
            <Button secondary className={SMALL} onClick={onClose}>Cancel</Button>
            <Button className={SMALL} disabled={!!busy || !!over || pv.preview.moving.length === 0} onClick={() => void apply()}>Apply assignment</Button>
          </div>
        </div>
      )}
      {!pv && <StatePanel kind="empty" title="Preview the assignment first" message="Nothing changes until you apply." />}
    </Modal>
  );
}

