import { Activity, Cpu, Database, Megaphone, PauseOctagon, Radio, Server } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { Badge, Button, Field, Label } from '../components/ui';
import { CARD, Countdown, Empty, Loadable, Notice, RED_CARD, SUBCARD, TD, TH, THEAD, TR, fmtTime, useAdminData, useConsole, useRun } from './kit';
import type { AuditRow, HealthReport } from './types';

export function StatusTab() {
  const { can } = useConsole();
  return (
    <div className="space-y-5">
      <EmergencyPause />
      <Health />
      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        {can('game.control') ? <Announcer /> : <div className={CARD}><Notice>Your role cannot broadcast announcements.</Notice></div>}
        {can('audit.read') ? <Audit /> : <div className={CARD}><Notice>Your role cannot read the audit log.</Notice></div>}
      </div>
    </div>
  );
}

function EmergencyPause() {
  const { overview, can, confirm } = useConsole();
  const { busy, run } = useRun();
  const running = overview.games.filter((g) => g.phase === 'RUNNING');
  if (!can('game.control')) return null;
  const pause = async (id: string, n: number, version: number) => {
    const ok = await confirm({ title: `EMERGENCY PAUSE · Game ${n}`, effects: ['The sprint clock stops for every crew immediately; submissions are rejected while paused.', 'Imposter windows are extended by the paused time on resume.', 'Resume from the GAME & SPRINT tab.'], confirmLabel: 'Pause now' });
    if (ok) await run(`pause-${id}`, () => api.post(`/api/admin/games/${id}/pause`, { expectedVersion: version }), `Game ${n} paused.`);
  };
  return (
    <section className={`${RED_CARD} flex flex-wrap items-center justify-between gap-4`} aria-label="Emergency pause">
      <div className="flex items-center gap-3">
        <PauseOctagon size={28} className="text-[#ffd8c7]" aria-hidden="true" />
        <div>
          <Label className="!text-[#f3b399]">EMERGENCY CONTROLS</Label>
          <p className="text-xs text-[#ceafb0]">{running.length ? `${running.length} game(s) running.` : 'No game is running.'} {overview.games.filter((g) => g.phase === 'PAUSED').map((g) => `Game ${g.number} is PAUSED.`).join(' ')}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {running.map((g) => (
          <Button key={g.id} danger disabled={busy === `pause-${g.id}`} onClick={() => void pause(g.id, g.number, g.version)}>
            <PauseOctagon size={14} /> Emergency pause · Game {g.number}
          </Button>
        ))}
      </div>
    </section>
  );
}

function Stat({ icon, label, ok, children }: { icon: ReactNode; label: string; ok: boolean; children: ReactNode }) {
  return (
    <div className={`rounded-lg border-2 p-4 ${ok ? 'border-[#416574] bg-[#13313c]' : 'border-[#9d635a] bg-[#442b34]/70'}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2">{icon}<Label>{label}</Label></span>
        <Badge>{ok ? 'ONLINE' : 'OFFLINE'}</Badge>
      </div>
      <div className="text-xs">{children}</div>
    </div>
  );
}

function Health() {
  const state = useAdminData<HealthReport>('/api/admin/health', { pollMs: 5000 });
  return (
    <section aria-label="Ship health">
      <div className="mb-3 flex items-center justify-between">
        <Label>SHIP STATUS · AUTO-REFRESH 5 S</Label>
        <Activity size={16} className="text-primary" aria-hidden="true" />
      </div>
      <Loadable state={state} title="Ship health">
        {(h) => {
          const workersOk = h.workers.length > 0 && h.workers.every((w) => w.healthy);
          return (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <Stat icon={<Database size={14} className="text-primary" />} label="DATABASE" ok={h.db.ok}>
                  <span className="font-mono text-2xl text-primary">{h.db.latencyMs}</span> <span className="text-muted">ms latency</span>
                </Stat>
                <Stat icon={<Server size={14} className="text-primary" />} label="WORKERS" ok={workersOk}>
                  {h.workers.length === 0 ? <span className="text-[#f3b399]">No worker heartbeat recorded.</span> : (
                    <ul className="space-y-1 font-mono text-[10px]">
                      {h.workers.map((w) => <li key={w.name} className={w.healthy ? '' : 'text-[#f3b399]'}>{w.name}: {w.ageSeconds}s ago {w.healthy ? '✓' : '✕ STALE'}</li>)}
                    </ul>
                  )}
                </Stat>
                <Stat icon={<Radio size={14} className="text-primary" />} label="REALTIME" ok={h.outbox.lag < 50}>
                  <span className="font-mono text-2xl text-primary">{h.sockets}</span> <span className="text-muted">sockets</span>
                  <span className="mt-1 block font-mono text-[10px] text-muted">outbox lag {h.outbox.lag} (#{String(h.outbox.latestId)} / delivered #{h.outbox.deliveredThrough})</span>
                </Stat>
                <Stat icon={<Cpu size={14} className="text-primary" />} label="CODE RUNNER" ok={h.runner.ok}>
                  {h.runner.ok ? (
                    <ul className="space-y-1 font-mono text-[10px]">
                      {Object.entries(h.runner.runtimes ?? {}).map(([k, v]) => <li key={k} className={v ? '' : 'text-[#f3b399]'}>{k}: {v ?? 'missing'}</li>)}
                    </ul>
                  ) : <span className="text-[#f3b399]">{h.runner.error ?? 'Unreachable'}</span>}
                </Stat>
                <Stat icon={<Activity size={14} className="text-primary" />} label="LIVE DEADLINES" ok>
                  {h.deadlines.length === 0 ? <span className="text-muted">No running sprint.</span> : (
                    <ul className="space-y-1 font-mono text-[10px]">
                      {h.deadlines.map((d) => <li key={`${d.game}-${d.sprint}`}>G{d.game} S{d.sprint} {d.status}: {d.status === 'RUNNING' ? <Countdown deadline={d.deadline_at} className="text-[10px]" /> : fmtTime(d.deadline_at)}</li>)}
                    </ul>
                  )}
                </Stat>
              </div>
            </div>
          );
        }}
      </Loadable>
    </section>
  );
}

function Announcer() {
  const { overview } = useConsole();
  const { busy, run } = useRun();
  const [gameId, setGameId] = useState<string>('');
  const [kind, setKind] = useState<'INFO' | 'ALERT'>('INFO');
  const [msg, setMsg] = useState('');
  const send = async () => {
    const r = await run('announce', () => api.post('/api/admin/announcements', { gameId: gameId || null, message: msg.trim(), kind }), 'Announcement broadcast.');
    if (r) setMsg('');
  };
  return (
    <section className={CARD} aria-label="Announcements">
      <Label className="mb-3"><Megaphone size={11} className="mr-1 inline" />SHIP-WIDE ANNOUNCEMENT</Label>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="AUDIENCE">
          <select className="input !py-2" value={gameId} onChange={(e) => setGameId(e.target.value)}>
            <option value="">Everyone (all games)</option>
            {overview.games.map((g) => <option key={g.id} value={g.id}>Game {g.number} crews</option>)}
          </select>
        </Field>
        <Field label="KIND">
          <select className="input !py-2" value={kind} onChange={(e) => setKind(e.target.value as 'INFO' | 'ALERT')}>
            <option value="INFO">INFO</option>
            <option value="ALERT">ALERT (red)</option>
          </select>
        </Field>
      </div>
      <Field label={`MESSAGE (${msg.trim().length}/500)`}>
        <textarea className="input min-h-[90px]" maxLength={500} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="e.g. Sprint 2 begins in 5 minutes — return to your stations." />
      </Field>
      <Button className="w-full" danger={kind === 'ALERT'} disabled={!msg.trim() || busy === 'announce'} onClick={() => void send()}>Broadcast</Button>
    </section>
  );
}

function Audit() {
  const state = useAdminData<AuditRow[]>('/api/admin/audit');
  const [q, setQ] = useState('');
  return (
    <section className={SUBCARD} aria-label="Audit log">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Label>AUDIT LOG · LATEST 150</Label>
        <label className="text-xs"><span className="sr-only">Filter audit log</span><input className="input !w-56 !py-1.5" placeholder="Filter action / actor…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      <Loadable state={state} title="Audit log" empty={(d) => d.length === 0}>
        {(rows) => {
          const n = q.trim().toLowerCase();
          const shown = n ? rows.filter((r) => `${r.action} ${r.actor_name ?? ''} ${r.reason ?? ''} ${r.target_type ?? ''}`.toLowerCase().includes(n)) : rows;
          if (!shown.length) return <Empty>No audit entries match.</Empty>;
          return (
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className={`${THEAD} sticky top-0 bg-[#142c38]`}>
                  <tr>{['TIME', 'ACTOR', 'ACTION', 'TARGET', 'REASON / DETAILS'].map((h) => <th key={h} className={TH} scope="col">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={String(r.id)} className={TR}>
                      <td className={`${TD} whitespace-nowrap font-mono text-[10px]`}>{fmtTime(r.created_at)}</td>
                      <td className={TD}>{r.actor_name ?? r.actor_type}<span className="block font-mono text-[9px] text-muted">{r.actor_type}</span></td>
                      <td className={`${TD} font-mono text-[10px] text-primary`}>{r.action}</td>
                      <td className={`${TD} font-mono text-[10px]`}>{r.target_type ?? '—'}</td>
                      <td className={`${TD} max-w-[360px]`}>
                        {r.reason && <span className="block">{r.reason}</span>}
                        {r.details != null && <span className="block truncate font-mono text-[9px] text-muted" title={JSON.stringify(r.details)}>{JSON.stringify(r.details)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </Loadable>
    </section>
  );
}
