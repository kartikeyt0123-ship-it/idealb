/**
 * Slot question control: live stock per domain × difficulty with top-ups,
 * pick & release from the bank (regular / bonus, now / next start), the
 * initial-set editor, the release log (release-now / cancel), manual override
 * releases (fairness deviations) and the slot's question instances.
 */
import { AlertTriangle, Ban, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { V1, api } from '../lib/api';
import { Badge, Button, Field, Label } from '../components/ui';
import {
  CARD, Check, DataTable, Empty, Loadable, Notice, SMALL, SUBCARD, SectionHead, Select, SlotPicker, TD, TR, fmtOffset, fmtTime, useAdminData, useConsole, useRun, useSlotPick,
} from './kit';
import { QuestionControl } from './QuestionControl';
import type { BankResponse, OverviewSlot, ReleaseRow } from './types';

export function ReleasesTab() {
  const { overview } = useConsole();
  const [slotId, setSlotId] = useSlotPick();
  const slot = overview.slots.find((s) => s.id === slotId);
  if (!slot) return <Empty>No slots configured.</Empty>;
  return (
    <div className="space-y-6">
      <SlotPicker value={slotId} onChange={setSlotId} />
      <QuestionControl key={slot.id} slot={slot} />
      <Plan slot={slot} />
      <ManualRelease slot={slot} />
      <Instances slotId={slot.id} />
    </div>
  );
}

function Plan({ slot }: { slot: OverviewSlot }) {
  const { can, confirm } = useConsole();
  const { run, busy } = useRun();
  const groups = useMemo(() => {
    const m = new Map<string, ReleaseRow[]>();
    for (const r of slot.releases) {
      const k = r.sprint === null ? 'Slot pool' : `Sprint ${r.sprint}`;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()];
  }, [slot.releases]);
  const deviations = slot.releases.filter((r) => r.manual || (r.deviation_reason && r.status !== 'CANCELLED'));

  const releaseNow = async (r: ReleaseRow) => {
    if (r.status === 'SCHEDULED') {
      const c = await confirm({
        title: `Release “${r.label}” early`,
        tone: 'warning',
        body: <Notice tone="warn">This release is scheduled at active time {fmtOffset(r.offset_seconds)}. Releasing early changes slot comparability and is recorded as a FAIRNESS DEVIATION.</Notice>,
        reason: { label: 'REASON (FAIRNESS DEVIATION)', min: 4 },
        confirmLabel: 'Release now',
      });
      if (!c) return;
      await run(r.id, () => api.post(`${V1}/admin/question-releases/${r.id}/release`, { reason: c.reason }), `${r.label} released.`);
    } else {
      const c = await confirm({ title: `Release “${r.label}” now`, tone: 'primary', effects: [`${r.questions} question(s) become visible to every crew in ${slot.name}.`], confirmLabel: 'Release now' });
      if (!c) return;
      await run(r.id, () => api.post(`${V1}/admin/question-releases/${r.id}/release`, {}), `${r.label} released.`);
    }
  };
  const cancel = async (r: ReleaseRow) => {
    const c = await confirm({ title: `Cancel “${r.label}”`, effects: ['The release will never be released (not replayed later).'], reason: { label: 'REASON', min: 4 }, confirmLabel: 'Cancel release' });
    if (!c) return;
    await run(r.id, () => api.post(`${V1}/admin/question-releases/${r.id}/cancel`, { reason: c.reason }), `${r.label} cancelled.`);
  };

  return (
    <div className={CARD}>
      <SectionHead label={`RELEASE LOG · ${slot.name.toUpperCase()}`} title="Initial sets · top-ups · bonus releases">
        <Badge>{slot.phase}</Badge>
        {deviations.length > 0 && <Badge>{`${deviations.length} FAIRNESS DEVIATION(S)`}</Badge>}
      </SectionHead>
      {slot.phase !== 'RUNNING' && <div className="mb-3"><Notice>Questions can only be released while this slot’s sprint is RUNNING (pause suspends releases).</Notice></div>}
      {groups.length === 0 ? <Empty>No releases yet. Build the initial set above (or from SLOTS &amp; SPRINTS) before Sprint 1.</Empty> : (
        <div className="space-y-4">
          {groups.map(([k, rows]) => (
            <div key={k}>
              <Label className="mb-2">{k.toUpperCase()}</Label>
              <DataTable head={['TYPE', 'LABEL', 'STATUS', 'OFFSET', 'Q', 'SOLVED', 'EXPIRED', 'AVAIL', 'BUDGET', 'DEVIATION', '']}>
                {rows.map((r) => (
                  <tr key={r.id} className={TR}>
                    <td className={TD}><Badge>{r.type}</Badge></td>
                    <td className={TD}>
                      <div className="font-bold">{r.label}</div>
                      {r.released_at && <div className="font-mono text-[10px] text-muted">released {fmtTime(r.released_at)}</div>}
                    </td>
                    <td className={TD}><Badge>{r.status}</Badge></td>
                    <td className={`${TD} font-mono`}>{fmtOffset(r.offset_seconds)}</td>
                    <td className={`${TD} font-mono`}>{r.questions}</td>
                    <td className={`${TD} font-mono`}>{r.solved}</td>
                    <td className={`${TD} font-mono`}>{r.expired}</td>
                    <td className={`${TD} font-mono`}>{r.available}</td>
                    <td className={`${TD} font-mono text-[#e8cf8e]`}>{r.budget}</td>
                    <td className={`${TD} max-w-[240px]`}>
                      {r.manual && <Badge>MANUAL</Badge>}
                      {r.deviation_reason && <div className="mt-1 whitespace-normal text-[10px] text-[#ebd68c]">{r.deviation_reason}</div>}
                    </td>
                    <td className={TD}>
                      {can('releases.manage') && (r.status === 'PENDING' || r.status === 'SCHEDULED') && (
                        <div className="flex gap-2">
                          <Button className={SMALL} disabled={!!busy || slot.phase !== 'RUNNING'} onClick={() => void releaseNow(r)}><Send size={11} /> Release now</Button>
                          <Button danger className={SMALL} disabled={!!busy} onClick={() => void cancel(r)}><Ban size={11} /> Cancel</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </DataTable>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ManualRelease({ slot }: { slot: OverviewSlot }) {
  const { can } = useConsole();
  const { run, busy } = useRun();
  const [open, setOpen] = useState(false);
  const bank = useAdminData<BankResponse>(open && can('content.read') ? `${V1}/admin/questions` : null);
  const [sprint, setSprint] = useState<string>(String(Math.max(1, slot.currentSprint)));
  const [type, setType] = useState<'RESERVE' | 'BONUS' | 'INITIAL'>('RESERVE');
  const [picked, setPicked] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [immediate, setImmediate] = useState(true);
  const [filter, setFilter] = useState('');
  if (!can('releases.manage')) return null;
  const published = (bank.data?.questions ?? []).filter((q) => q.status === 'PUBLISHED' && !q.archived && (type === 'BONUS' ? q.pool === 'BONUS' : true));
  const shown = published.filter((q) => !filter || `${q.key} ${q.title} ${q.domain} ${q.difficulty}`.toLowerCase().includes(filter.toLowerCase()));
  const ok = picked.length > 0 && picked.length <= 60 && reason.trim().length >= 8;
  const submit = async () => {
    const r = await run('manual', () => api.post<{ releaseId: string }>(`${V1}/admin/question-releases`, {
      slotId: slot.id, sprintNumber: sprint === 'none' ? null : Number(sprint), type, versionIds: picked, offsetSeconds: null, expiresAtSprintEnd: true,
      announcement: announcement.trim() || undefined, reason: reason.trim(), releaseImmediately: immediate,
    }), immediate ? 'Manual release created and released (fairness deviation recorded).' : 'Manual release created as PENDING (fairness deviation recorded).');
    if (r) {
      setPicked([]);
      setReason('');
      setAnnouncement('');
    }
  };
  return (
    <div className={CARD}>
      <SectionHead label="OVERRIDE" title="Manual override release">
        <Button secondary className={SMALL} onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Open form'}</Button>
      </SectionHead>
      <div className="flex items-start gap-2 rounded-lg border border-[#8c7a4a] bg-[#3a3626]/70 px-3 py-2 text-[11px] text-[#ebd68c]">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <span>A manual release is a FAIRNESS DEVIATION: the other slots do not get these questions. It is recorded with your reason in the release plan, preflight warnings and the audit log.</span>
      </div>
      {open && (
        <div className="mt-4 space-y-3">
          {!can('content.read') && <Notice tone="danger">Your role cannot read the question bank.</Notice>}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="SPRINT">
              <Select ariaLabel="Sprint" value={sprint} onChange={setSprint} options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: `Sprint ${n}` }))} />
            </Field>
            <Field label="TYPE">
              <Select ariaLabel="Release type" value={type} onChange={(v) => { setType(v); setPicked([]); }} options={[{ value: 'RESERVE', label: 'RESERVE' }, { value: 'BONUS', label: 'BONUS' }, { value: 'INITIAL', label: 'INITIAL' }]} />
            </Field>
            <Field label="FILTER PUBLISHED QUESTIONS">
              <input className="input !py-2" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="key, title, domain…" />
            </Field>
          </div>
          <Loadable state={bank} title="Published questions">
            {() => (
              <div className="max-h-72 overflow-y-auto rounded-lg border border-[#344d5b]">
                {shown.length === 0 ? <p className="p-3 text-xs text-muted">No published questions match.</p> : shown.map((q) => (
                  <label key={q.version_id} className="flex cursor-pointer items-center gap-3 border-b border-[#344d5b] px-3 py-2 text-xs hover:bg-[#1b3a47]">
                    <input type="checkbox" className="accent-[#8ae4cf]" checked={picked.includes(q.version_id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, q.version_id] : p.filter((x) => x !== q.version_id)))} />
                    <span className="font-mono text-muted">{q.key}</span>
                    <span className="font-bold">{q.title}</span>
                    <Badge>{q.domain}</Badge>
                    <Badge>{q.difficulty}</Badge>
                    <Badge>{q.pool}</Badge>
                    {q.uses > 0 && <span className="text-[10px] text-[#ebd68c]">already used ×{q.uses}</span>}
                  </label>
                ))}
              </div>
            )}
          </Loadable>
          <div className="text-[11px] text-muted">{picked.length} selected (1–60).</div>
          <Field label="REASON (MIN 8 CHARACTERS — FAIRNESS DEVIATION)">
            <textarea className="input min-h-[60px]" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field label="ANNOUNCEMENT (OPTIONAL)">
            <input className="input" maxLength={200} value={announcement} onChange={(e) => setAnnouncement(e.target.value)} />
          </Field>
          <Check checked={immediate} onChange={setImmediate} label="Release immediately (the sprint must be RUNNING); otherwise create it as PENDING" />
          <div className="flex justify-end">
            <Button danger className={SMALL} disabled={!ok || !!busy} onClick={() => void submit()}>Create manual release</Button>
          </div>
        </div>
      )}
    </div>
  );
}

interface Instance {
  id: string;
  label: string;
  kind: string;
  difficulty: string;
  reward: number;
  hint_cost: number;
  status: string;
  solved_at: string | null;
  title: string;
  domain: string;
  release: string;
  release_status: string;
  sprint: number | null;
  solver_crew: string | null;
  solver_name: string | null;
}

function Instances({ slotId }: { slotId: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('ALL');
  const st = useAdminData<Instance[]>(open ? `${V1}/admin/slots/${slotId}/question-instances` : null);
  return (
    <div className={CARD}>
      <SectionHead label="INSTANCES" title="Question instances in this slot">
        {open && <Select ariaLabel="Status filter" value={status} onChange={setStatus} options={['ALL', 'AVAILABLE', 'SOLVED', 'EXPIRED', 'DISABLED'].map((x) => ({ value: x, label: x }))} />}
        <Button secondary className={SMALL} onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Show'}</Button>
      </SectionHead>
      {open && (
        <Loadable state={st} title="Instances" empty={(d) => d.length === 0}>
          {(rows) => (
            <div className={SUBCARD}>
              <DataTable head={['SPRINT', 'RELEASE', 'LABEL', 'TITLE', 'DOMAIN', 'DIFF', 'REWARD', 'STATUS', 'SOLVER', 'SOLVED AT']}>
                {rows.filter((r) => status === 'ALL' || r.status === status).map((r) => (
                  <tr key={r.id} className={TR}>
                    <td className={`${TD} font-mono`}>{r.sprint ?? 'pool'}</td>
                    <td className={TD}>{r.release} <span className="text-[10px] text-muted">({r.release_status})</span></td>
                    <td className={`${TD} font-mono`}>{r.label}</td>
                    <td className={TD}>{r.title}</td>
                    <td className={TD}>{r.domain}</td>
                    <td className={TD}>{r.difficulty}</td>
                    <td className={`${TD} font-mono text-[#e8cf8e]`}>{r.reward}</td>
                    <td className={TD}><Badge>{r.status}</Badge></td>
                    <td className={TD}>{r.solver_crew ? `${r.solver_crew} · ${r.solver_name}` : '—'}</td>
                    <td className={TD}>{fmtTime(r.solved_at)}</td>
                  </tr>
                ))}
              </DataTable>
            </div>
          )}
        </Loadable>
      )}
    </div>
  );
}
