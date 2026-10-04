import { ChevronDown, ChevronRight, KeyRound, Plus, Search, Upload } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { Badge, Button, Crewmate, Label } from '../components/ui';
import {
  COIN_TEXT, CopyButton, Check, Empty, ExportLink, LINK, Loadable, Notice, SMALL, SUBCARD, Segmented, TD, TH, THEAD, TR, fmtTime, useAdminData, useConsole, useRun,
} from './kit';
import type { BulkPreview, CrewList, CrewRow, SessionRow } from './types';
import { AddCrewForm, ImportCrews } from './CrewForms';

type Filter = 'ALL' | 'PENDING' | 'DAY1' | 'DAY2';
const PRE_START = ['DRAFT', 'READY', 'WAITING'];

export function CrewTab() {
  const { can } = useConsole();
  const state = useAdminData<CrewList>('/api/admin/crews');
  const [mode, setMode] = useState<'list' | 'add' | 'import'>('list');

  if (mode === 'add') return <AddCrewForm onDone={() => { setMode('list'); void state.reload(); }} />;
  if (mode === 'import') return <ImportCrews onDone={() => { setMode('list'); void state.reload(); }} />;

  return (
    <Loadable state={state} title="Crew manifest">
      {(d) => (
        <CrewManifest
          list={d}
          reload={state.reload}
          onAdd={can('crews.write') ? () => setMode('add') : undefined}
          onImport={can('crews.write') ? () => setMode('import') : undefined}
        />
      )}
    </Loadable>
  );
}

function CrewManifest({ list, reload, onAdd, onImport }: { list: CrewList; reload: () => Promise<void>; onAdd?: () => void; onImport?: () => void }) {
  const { overview, can, confirm } = useConsole();
  const { busy, run } = useRun();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [bulkDay, setBulkDay] = useState<number>(list.days[0]?.day_number ?? 1);
  const [bulk, setBulk] = useState<BulkPreview | null>(null);
  const [resetInfo, setResetInfo] = useState<{ crew: string; token: string; minutes: number; notice: string } | null>(null);
  const write = can('crews.write');

  const gameForDay = (dayNumber: number) => {
    const day = list.days.find((x) => x.day_number === dayNumber);
    const g = list.games.find((x) => x.dayId === day?.id);
    return g ? overview.games.find((x) => x.id === g.id) ?? null : null;
  };

  const crews = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return list.crews.filter((c) => {
      if (needle) {
        const hay = [c.name, c.crew_id, c.email, c.captain_name, ...(c.members ?? []).map((m) => `${m.name} ${m.institution}`)].join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      const days = c.days ?? {};
      if (filter === 'PENDING') return !Object.values(days).some((d) => d.active);
      if (filter === 'DAY1') return !!days['1']?.active;
      if (filter === 'DAY2') return !!days['2']?.active;
      return true;
    });
  }, [list.crews, q, filter]);

  const allSelected = crews.length > 0 && crews.every((c) => selected.has(c.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(crews.map((c) => c.id)));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const setEligibility = async (c: CrewRow, dayNumber: number, active: boolean) => {
    const g = gameForDay(dayNumber);
    const started = g && !PRE_START.includes(g.phase);
    if (started || !active) {
      const ok = await confirm({
        title: `${active ? 'Activate' : 'Deactivate'} ${c.name} for Day ${dayNumber}`,
        tone: started ? 'danger' : 'warning',
        effects: active
          ? [`${c.name} (${c.crew_id}) can enter Game ${g?.number ?? '?'} on Day ${dayNumber}.`, started ? `Game ${g?.number} has already started (${g?.phase}) — the crew joins mid-game with only the starting wallet.` : 'An enrollment is created with the configured starting coins.']
          : [`${c.name} (${c.crew_id}) immediately loses access for Day ${dayNumber}.`, started ? `Game ${g?.number} is in progress (${g?.phase}) — the crew drops out of the live standings. Coins are kept on record.` : 'Their enrollment is kept but they no longer count as active.'],
        confirmLabel: active ? 'Activate crew' : 'Deactivate crew',
      });
      if (!ok) return;
    }
    await run(`elig-${c.id}-${dayNumber}`, () => api.post(`/api/admin/crews/${c.id}/eligibility`, { dayNumber, active }), `${c.crew_id} ${active ? 'activated' : 'deactivated'} for Day ${dayNumber}.`);
    await reload();
  };

  const setCheckIn = async (c: CrewRow, dayNumber: number, checkedIn: boolean) => {
    await run(`ci-${c.id}-${dayNumber}`, () => api.post(`/api/admin/crews/${c.id}/check-in`, { dayNumber, checkedIn }), `${c.crew_id} ${checkedIn ? 'checked in' : 'check-in cleared'} for Day ${dayNumber}.`);
    await reload();
  };

  const setLifecycle = async (c: CrewRow, status: 'ACTIVE' | 'ARCHIVED') => {
    if (status === 'ARCHIVED') {
      const ok = await confirm({
        title: `Archive ${c.name}`,
        effects: [`${c.crew_id} is blocked from signing in and every device is signed out now.`, 'All scoring records are kept; archived crews drop out of standings.', 'You can restore the crew later.'],
        confirmLabel: 'Archive crew',
      });
      if (!ok) return;
    }
    await run(`life-${c.id}`, () => api.patch(`/api/admin/crews/${c.id}`, { status }), `${c.crew_id} ${status === 'ARCHIVED' ? 'archived' : 'restored'}.`);
    await reload();
  };

  const resetPassword = async (c: CrewRow) => {
    const ok = await confirm({
      title: `Issue password reset for ${c.name}`,
      tone: 'warning',
      effects: ['A one-time reset code valid for 30 minutes is generated and shown once.', `All ${c.live_sessions} live session(s) of ${c.crew_id} are signed out immediately.`, 'Any previous unused reset code stops working.'],
      confirmLabel: 'Issue reset code',
    });
    if (!ok) return;
    const r = await run(`reset-${c.id}`, () => api.post<{ resetToken: string; expiresInMinutes: number; notice: string }>(`/api/admin/crews/${c.id}/reset-password`, {}));
    if (r) setResetInfo({ crew: `${c.name} (${c.crew_id})`, token: r.resetToken, minutes: r.expiresInMinutes, notice: r.notice });
    await reload();
  };

  const previewBulk = async (active: boolean) => {
    const r = await run('bulk-preview', () => api.post<BulkPreview>('/api/admin/crews/eligibility/bulk', { teamIds: [...selected], dayNumber: bulkDay, active, apply: false }));
    if (r) setBulk(r);
  };
  const applyBulk = async () => {
    if (!bulk) return;
    const r = await run('bulk-apply', () => api.post<BulkPreview>('/api/admin/crews/eligibility/bulk', { teamIds: [...selected], dayNumber: bulk.preview.day, active: bulk.preview.active, apply: true }), (x) => `Applied: ${x.preview.changes.length} crew(s) ${x.preview.active ? 'enabled' : 'disabled'} for Day ${x.preview.day}.`);
    if (r) {
      setBulk(null);
      setSelected(new Set());
    }
    await reload();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Label>CREW MANIFEST · {list.crews.length} IDENTITIES · {crews.length} SHOWN</Label>
        <div className="flex flex-wrap gap-2">
          {can('exports') && <ExportLink href="/api/admin/export/crews">CREWS CSV</ExportLink>}
          {onImport && <Button secondary className={SMALL} onClick={onImport}><Upload size={12} /> Import</Button>}
          {onAdd && <Button className={SMALL} onClick={onAdd}><Plus size={12} /> Add crew</Button>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[220px] flex-1">
          <span className="sr-only">Search crews</span>
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input className="input !py-2 !pl-9" placeholder="Search team, crew ID, email, member, institution…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <Segmented<Filter>
          label="Filter crews"
          value={filter}
          onChange={setFilter}
          options={[{ value: 'ALL', label: 'ALL' }, { value: 'PENDING', label: 'PENDING (NO DAY)' }, { value: 'DAY1', label: 'DAY 1' }, { value: 'DAY2', label: 'DAY 2' }]}
        />
      </div>

      {write && selected.size > 0 && (
        <div className={SUBCARD}>
          <div className="flex flex-wrap items-center gap-3">
            <Label>BULK · {selected.size} SELECTED</Label>
            <label className="flex items-center gap-2 text-xs">
              Day
              <select className="input !w-auto !py-1.5" value={bulkDay} onChange={(e) => { setBulkDay(Number(e.target.value)); setBulk(null); }}>
                {list.days.map((d) => <option key={d.id} value={d.day_number}>Day {d.day_number} — {d.label}</option>)}
              </select>
            </label>
            <Button className={SMALL} disabled={busy === 'bulk-preview'} onClick={() => void previewBulk(true)}>Preview enable</Button>
            <Button danger className={SMALL} disabled={busy === 'bulk-preview'} onClick={() => void previewBulk(false)}>Preview disable</Button>
            <button type="button" className={LINK} onClick={() => { setSelected(new Set()); setBulk(null); }}>Clear selection</button>
          </div>
          {bulk && (
            <div className="mt-4 space-y-3" aria-live="polite">
              <div className="text-xs">
                {bulk.preview.active ? 'ENABLE' : 'DISABLE'} Day {bulk.preview.day}: <b>{bulk.preview.changes.length}</b> crew(s) will change, {bulk.preview.unchanged} already in that state.
              </div>
              {bulk.preview.changes.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {bulk.preview.changes.map((c) => <span key={c.crewId} className="rounded border border-[#3b6270] px-2 py-1 font-mono text-[10px]">{c.crewId} · {c.name}</span>)}
                </div>
              )}
              {bulk.preview.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
              <div className="flex gap-2">
                <Button secondary className={SMALL} onClick={() => setBulk(null)}>Cancel</Button>
                <Button danger={!bulk.preview.active} className={SMALL} disabled={!bulk.preview.changes.length || busy === 'bulk-apply'} onClick={() => void applyBulk()}>
                  Apply to {bulk.preview.changes.length} crew(s)
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {resetInfo && (
        <div className={`${SUBCARD} !border-[#dfbd77]/70`} role="status">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Label className="!text-[#e5cf8f]"><KeyRound size={10} className="mr-1 inline" />ONE-TIME RESET CODE · {resetInfo.crew}</Label>
              <div className="mt-2 select-all break-all font-mono text-lg text-[#abe9df]">{resetInfo.token}</div>
              <p className="mt-2 text-xs text-muted">The crew opens <b className="font-mono text-primary">/reset</b> and enters this code to choose a new password. Expires in {resetInfo.minutes} minutes. Shown once — it cannot be retrieved again.</p>
              <p className="mt-1 text-[11px] text-muted">{resetInfo.notice}</p>
            </div>
            <div className="flex gap-2">
              <CopyButton text={resetInfo.token} label="Copy code" />
              <Button secondary className={SMALL} onClick={() => setResetInfo(null)}>Done</Button>
            </div>
          </div>
        </div>
      )}

      {crews.length === 0 ? (
        <Empty>{list.crews.length ? 'No crews match this filter.' : 'No crews registered yet. Add or import crews to begin.'}</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border-2 border-[#426270] bg-[#142e3a]">
          <table className="w-full min-w-[1080px] text-left text-xs">
            <caption className="sr-only">Crew manifest</caption>
            <thead className={THEAD}>
              <tr>
                {write && (
                  <th className={TH} scope="col">
                    <input type="checkbox" aria-label="Select all shown crews" className="h-4 w-4 accent-[#8ae4cf]" checked={allSelected} onChange={toggleAll} />
                  </th>
                )}
                <th className={TH} scope="col">CREW</th>
                <th className={TH} scope="col">ROSTER</th>
                <th className={TH} scope="col">REQUESTED</th>
                {list.days.map((d) => <th key={d.id} className={TH} scope="col">DAY {d.day_number}</th>)}
                {list.games.map((g) => <th key={g.id} className={TH} scope="col">GAME {g.number}</th>)}
                <th className={TH} scope="col">SESSIONS</th>
                <th className={TH} scope="col">STATUS</th>
                <th className={TH} scope="col">CONTROLS</th>
              </tr>
            </thead>
            <tbody>
              {crews.map((c) => {
                const open = expanded === c.id;
                const dq = c.disqualifications ?? [];
                return (
                  <Fragment key={c.id}>
                    <tr className={`${TR} ${c.status === 'ARCHIVED' ? 'opacity-60' : ''}`}>
                      {write && (
                        <td className={TD}>
                          <input type="checkbox" aria-label={`Select ${c.name}`} className="h-4 w-4 accent-[#8ae4cf]" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                        </td>
                      )}
                      <td className={TD}>
                        <button type="button" className="flex items-center gap-2 text-left" aria-expanded={open} onClick={() => setExpanded(open ? null : c.id)}>
                          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          <Crewmate color={c.color} size={26} state="still" />
                          <span>
                            <span className="font-semibold">{c.name}</span>
                            <span className="mt-0.5 block font-mono text-[9px] text-muted">{c.crew_id} · {c.email}</span>
                          </span>
                        </button>
                      </td>
                      <td className={TD}>
                        <button type="button" className={LINK} onClick={() => setExpanded(open ? null : c.id)}>{c.members?.length ?? 0} members</button>
                        <span className="mt-0.5 block text-[10px] text-muted">Capt. {c.captain_name}</span>
                      </td>
                      <td className={`${TD} font-mono text-[10px]`}>{c.requested_days}</td>
                      {list.days.map((d) => {
                        const st = c.days?.[String(d.day_number)];
                        const active = !!st?.active;
                        return (
                          <td key={d.id} className={TD}>
                            <Check checked={active} disabled={!write || busy === `elig-${c.id}-${d.day_number}`} onChange={(v) => void setEligibility(c, d.day_number, v)} label={`Active Day ${d.day_number}`} />
                            {active && (
                              <div className="mt-1.5">
                                <Check
                                  checked={!!st?.checkedInAt}
                                  disabled={!write || busy === `ci-${c.id}-${d.day_number}`}
                                  onChange={(v) => void setCheckIn(c, d.day_number, v)}
                                  label={<span className="text-[10px] text-muted">{st?.checkedInAt ? `Checked in ${fmtTime(st.checkedInAt)}` : 'Check-in'}</span>}
                                />
                              </div>
                            )}
                          </td>
                        );
                      })}
                      {list.games.map((g) => {
                        const e = c.enrollments?.[String(g.number)];
                        return (
                          <td key={g.id} className={TD}>
                            {e ? (
                              <div className="space-y-1">
                                <Badge>{e.status}</Badge>
                                <div className={`${COIN_TEXT} text-[10px]`}>{e.wallet} wallet · {e.score} score</div>
                                <div className="font-mono text-[9px] text-muted">{e.rank ? `RANK #${e.rank}` : e.eliminatedSprint ? `OUT S${e.eliminatedSprint}` : 'UNRANKED'}</div>
                              </div>
                            ) : <span className="font-mono text-[9px] text-muted">NOT ENROLLED</span>}
                          </td>
                        );
                      })}
                      <td className={TD}>
                        <button type="button" className={LINK} onClick={() => setExpanded(open ? null : c.id)} aria-label={`${c.live_sessions} live sessions — show`}>
                          {c.live_sessions} live
                        </button>
                      </td>
                      <td className={TD}>
                        <div className="flex flex-col items-start gap-1">
                          <Badge>{c.status}</Badge>
                          {dq.length > 0 && <Badge>{`DISQUALIFIED · ${dq.map((x) => x.scope).join('/')}`}</Badge>}
                          {c.must_change_password && <span className="font-mono text-[8px] text-[#ebd68c]">TEMP PASSWORD</span>}
                        </div>
                      </td>
                      <td className={TD}>
                        <div className="flex flex-col items-start gap-1.5">
                          {write && <button type="button" className={LINK} disabled={busy === `reset-${c.id}`} onClick={() => void resetPassword(c)}>Reset password</button>}
                          {write && (c.status === 'ACTIVE'
                            ? <button type="button" className="font-mono text-[10px] text-[#eca291] hover:underline" disabled={busy === `life-${c.id}`} onClick={() => void setLifecycle(c, 'ARCHIVED')}>Archive</button>
                            : <button type="button" className="font-mono text-[10px] text-primary hover:underline" disabled={busy === `life-${c.id}`} onClick={() => void setLifecycle(c, 'ACTIVE')}>Restore</button>)}
                          {can('disqualify') && <button type="button" className="font-mono text-[10px] text-[#eca291] hover:underline" onClick={() => setExpanded(c.id)}>Disqualify…</button>}
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-[#344d5b] bg-[#10252f]">
                        <td colSpan={99} className="p-4">
                          <CrewDetail crew={c} list={list} reload={reload} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CrewDetail({ crew, list, reload }: { crew: CrewRow; list: CrewList; reload: () => Promise<void> }) {
  const { can, confirm } = useConsole();
  const { busy, run } = useRun();
  const sessions = useAdminData<SessionRow[]>(`/api/admin/crews/${crew.id}/sessions`);
  const [scope, setScope] = useState<'GAME' | 'EVENT'>('GAME');
  const [dqGame, setDqGame] = useState<string>(list.games[0]?.id ?? '');

  const revoke = async (s: SessionRow) => {
    const ok = await confirm({ title: 'Revoke session', tone: 'warning', effects: [`The device last seen ${fmtTime(s.last_seen_at)} (${s.ip ?? 'unknown IP'}) is signed out of ${crew.crew_id} immediately.`], confirmLabel: 'Revoke session' });
    if (!ok) return;
    await run(`rev-${s.id}`, () => api.del(`/api/admin/sessions/${s.id}`), 'Session revoked.');
    await sessions.reload();
    await reload();
  };

  const disqualify = async () => {
    const g = list.games.find((x) => x.id === dqGame);
    if (scope === 'GAME' && !g) return;
    const r = await confirm({
      title: `Disqualify ${crew.name}`,
      effects: scope === 'EVENT'
        ? [`${crew.crew_id} is disqualified from the WHOLE EVENT (every game).`, 'Running jobs are cancelled and any held imposter is released without award.', 'The crew is removed from standings; history is kept and the decision is audited.']
        : [`${crew.crew_id} is disqualified from Game ${g?.number} only.`, 'Running jobs are cancelled and any held imposter is released without award.', 'The crew is removed from that game\'s standings; the decision is audited.'],
      reason: { label: 'DISQUALIFICATION REASON', min: 8, placeholder: 'e.g. Shared answers with another crew (observed by judge, 11:42)' },
      confirmLabel: 'Disqualify crew',
    });
    if (!r) return;
    await run('dq', () => api.post(`/api/admin/crews/${crew.id}/disqualify`, { scope, gameId: scope === 'GAME' ? dqGame : undefined, reason: r.reason }), `${crew.crew_id} disqualified (${scope}).`);
    await reload();
  };

  const revokeDq = async (id: string) => {
    const r = await confirm({ title: 'Revoke disqualification', tone: 'warning', effects: [`${crew.crew_id} returns to its previous status (active, or eliminated if it was already ejected).`, 'Elimination history is not altered.'], reason: { label: 'CORRECTION REASON', min: 8 }, confirmLabel: 'Revoke disqualification' });
    if (!r) return;
    await run(`rdq-${id}`, () => api.post(`/api/admin/disqualifications/${id}/revoke`, { reason: r.reason }), 'Disqualification revoked.');
    await reload();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <Label className="mb-2">ROSTER</Label>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-xs">
            <thead className={THEAD}>
              <tr>{['#', 'NAME', 'INSTITUTION', 'YEAR', 'BRANCH', 'STUDENT ID'].map((h) => <th key={h} className="p-2 font-normal" scope="col">{h}</th>)}</tr>
            </thead>
            <tbody>
              {(crew.members ?? []).map((m) => (
                <tr key={m.position} className="border-b border-[#344d5b]">
                  <td className="p-2 font-mono">{m.position}</td>
                  <td className="p-2">{m.name}{m.isCaptain && <span className="ml-1 font-mono text-[8px] text-[#e5cf8f]">CAPTAIN</span>}</td>
                  <td className="p-2">{m.institution}</td>
                  <td className="p-2">{m.year}</td>
                  <td className="p-2">{m.branch}</td>
                  <td className="p-2 font-mono text-[10px]">{m.studentId ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 font-mono text-[9px] text-muted">CREATED {fmtTime(crew.created_at)} VIA {crew.created_via}</p>
      </div>

      <div className="space-y-4">
        <div>
          <Label className="mb-2">LIVE SESSIONS</Label>
          <Loadable state={sessions} title="Sessions">
            {(rows) => rows.length === 0 ? <Empty>No live sessions.</Empty> : (
              <ul className="space-y-2">
                {rows.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#344d5b] p-2 text-[11px]">
                    <span>
                      <span className="block max-w-[340px] truncate" title={s.user_agent ?? ''}>{s.user_agent ?? 'Unknown device'}</span>
                      <span className="font-mono text-[9px] text-muted">{s.ip ?? '—'} · seen {fmtTime(s.last_seen_at)} · expires {fmtTime(s.expires_at)}</span>
                    </span>
                    {can('crews.write') && <Button danger className={SMALL} disabled={busy === `rev-${s.id}`} onClick={() => void revoke(s)}>Revoke</Button>}
                  </li>
                ))}
              </ul>
            )}
          </Loadable>
        </div>

        {(crew.disqualifications ?? []).length > 0 && (
          <div>
            <Label className="mb-2">ACTIVE DISQUALIFICATIONS</Label>
            <ul className="space-y-2">
              {(crew.disqualifications ?? []).map((d) => (
                <li key={d.id} className="rounded-lg border border-[#9d635a] bg-[#442b34]/60 p-2 text-[11px]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[10px]">{d.scope}{d.gameId ? ` · GAME ${list.games.find((g) => g.id === d.gameId)?.number ?? '?'}` : ''} · {fmtTime(d.createdAt)}</span>
                    {can('disqualify') && <button type="button" className={LINK} disabled={busy === `rdq-${d.id}`} onClick={() => void revokeDq(d.id)}>Revoke…</button>}
                  </div>
                  <p className="mt-1 text-[#f3cfc3]">{d.reason}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {can('disqualify') && (
          <div className="rounded-lg border-2 border-[#9d635a] bg-[#442b34]/60 p-3">
            <Label className="mb-2 !text-[#f3b399]">DISQUALIFY CREW</Label>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs">
                <span className="mb-1 block font-mono text-[9px] tracking-widest text-[#b3c4c8]">SCOPE</span>
                <select className="input !w-auto !py-1.5" value={scope} onChange={(e) => setScope(e.target.value as 'GAME' | 'EVENT')}>
                  <option value="GAME">One game</option>
                  <option value="EVENT">Whole event</option>
                </select>
              </label>
              {scope === 'GAME' && (
                <label className="text-xs">
                  <span className="mb-1 block font-mono text-[9px] tracking-widest text-[#b3c4c8]">GAME</span>
                  <select className="input !w-auto !py-1.5" value={dqGame} onChange={(e) => setDqGame(e.target.value)}>
                    {list.games.map((g) => <option key={g.id} value={g.id}>Game {g.number} — {g.name}</option>)}
                  </select>
                </label>
              )}
              <Button danger className={SMALL} disabled={busy === 'dq' || (scope === 'GAME' && !dqGame)} onClick={() => void disqualify()}>Disqualify…</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

