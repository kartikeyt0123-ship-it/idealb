import { ArrowLeft, CheckCircle2, Download, FilePlus2, Lock, Search, ShieldCheck, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { Badge, Button, Field, Label } from '../components/ui';
import { CARD, COIN_TEXT, Check, Empty, ExportLink, Loadable, Notice, NumInput, SMALL, SUBCARD, SectionHead, TD, TH, THEAD, TR, fmtTime, useAdminData, useConsole, useRun } from './kit';
import { DOMAINS, ProblemEditor } from './ProblemEditor';
import type { ProblemRow, ProblemVersionDetail } from './types';

type View = { kind: 'list' } | { kind: 'detail'; versionId: string } | { kind: 'edit'; versionId: string | null };

export function LibraryTab() {
  const [view, setView] = useState<View>({ kind: 'list' });
  if (view.kind === 'detail') return <VersionDetail key={view.versionId} versionId={view.versionId} onBack={() => setView({ kind: 'list' })} onEdit={(id) => setView({ kind: 'edit', versionId: id })} />;
  if (view.kind === 'edit') return <EditLoader versionId={view.versionId} onCancel={() => setView(view.versionId ? { kind: 'detail', versionId: view.versionId } : { kind: 'list' })} onSaved={(id) => setView({ kind: 'detail', versionId: id })} />;
  return <ProblemList onOpen={(id) => setView({ kind: 'detail', versionId: id })} onNew={() => setView({ kind: 'edit', versionId: null })} />;
}

function EditLoader({ versionId, onCancel, onSaved }: { versionId: string | null; onCancel: () => void; onSaved: (id: string) => void }) {
  const state = useAdminData<ProblemVersionDetail>(versionId ? `/api/admin/problem-versions/${versionId}` : null);
  if (!versionId) return <ProblemEditor version={null} onCancel={onCancel} onSaved={onSaved} />;
  return <Loadable state={state} title="Draft">{(v) => <ProblemEditor key={v.id} version={v} onCancel={onCancel} onSaved={onSaved} />}</Loadable>;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

function ProblemList({ onOpen, onNew }: { onOpen: (versionId: string) => void; onNew: () => void }) {
  const { can } = useConsole();
  const state = useAdminData<ProblemRow[]>('/api/admin/problems');
  const [q, setQ] = useState('');
  const [domain, setDomain] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Label>PROBLEM LIBRARY · TASK DATABASE</Label>
        <div className="flex flex-wrap gap-2">
          {can('content.solutions') && <ExportLink href="/api/admin/problems/export"><Download size={11} /> EXPORT JSON (PRIVATE)</ExportLink>}
          {can('content.write') && <Button className={SMALL} onClick={onNew}><FilePlus2 size={12} /> New problem</Button>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[220px] flex-1">
          <span className="sr-only">Search problems</span>
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input className="input !py-2 !pl-9" placeholder="Search title or key…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <FilterSelect label="Domain" value={domain} onChange={setDomain} options={DOMAINS.map((d) => [d, d])} />
        <FilterSelect label="Kind" value={kind} onChange={setKind} options={[['REGULAR', 'Regular'], ['IMPOSTER', 'Imposter']]} />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={[['DRAFT', 'Draft'], ['PUBLISHED', 'Published']]} />
      </div>
      <Loadable state={state} title="Problem library" empty={(d) => d.length === 0}>
        {(rows) => {
          const n = q.trim().toLowerCase();
          const shown = rows.filter((r) => (!domain || r.domain === domain) && (!kind || r.kind === kind) && (!status || r.status === status) && (!n || `${r.title} ${r.key}`.toLowerCase().includes(n)));
          if (!shown.length) return <Empty>No problems match these filters.</Empty>;
          return (
            <div className="overflow-x-auto rounded-xl border-2 border-[#426270] bg-[#142e3a]">
              <table className="w-full min-w-[980px] text-left text-xs">
                <caption className="sr-only">Problems</caption>
                <thead className={THEAD}>
                  <tr>{['PROBLEM', 'ROOM', 'KIND', 'LATEST', 'DIFFICULTY', 'REWARD / HINT', 'VALIDATION', 'USES', ''].map((h) => <th key={h} className={TH} scope="col">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} className={`${TR} ${r.archived ? 'opacity-50' : ''}`}>
                      <td className={TD}>
                        <span className="font-semibold">{r.title}</span>
                        {r.is_demo && <span className="ml-2 rounded border border-[#e5ce90]/40 px-1 font-mono text-[8px] text-[#e5ce90]">DEMO</span>}
                        <span className="mt-0.5 block font-mono text-[9px] text-muted">{r.key}</span>
                      </td>
                      <td className={`${TD} font-mono`}>{r.domain}</td>
                      <td className={TD}>{r.kind === 'IMPOSTER' ? <span className="font-mono text-[10px] text-[#f3b399]">IMPOSTER</span> : <span className="font-mono text-[10px]">REGULAR</span>}</td>
                      <td className={TD}><span className="font-mono">v{r.version_no}</span> <Badge>{r.status}</Badge></td>
                      <td className={TD}><Badge>{r.difficulty}</Badge></td>
                      <td className={`${TD} ${COIN_TEXT}`}>{r.reward} / {r.hint_cost}</td>
                      <td className={`${TD} font-mono text-[10px]`}>{r.validation_mode ?? '—'}{r.run_language && <span className="block text-muted">{r.run_language}</span>}</td>
                      <td className={`${TD} font-mono`}>{r.uses}{r.imposter_uses > 0 && <span className="block text-[9px] text-[#f3b399]">{r.imposter_uses} imposter</span>}</td>
                      <td className={TD}><Button secondary className={SMALL} onClick={() => onOpen(r.version_id)}>Open</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </Loadable>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: readonly (readonly [string, string])[] }) {
  return (
    <label className="text-xs">
      <span className="sr-only">{label}</span>
      <select className="input !w-auto !py-2" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">All {label.toLowerCase()}s</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

function VersionDetail({ versionId, onBack, onEdit }: { versionId: string; onBack: () => void; onEdit: (id: string) => void }) {
  const state = useAdminData<ProblemVersionDetail>(`/api/admin/problem-versions/${versionId}`);
  return (
    <div className="space-y-4">
      <Button secondary className={SMALL} onClick={onBack}><ArrowLeft size={12} /> Library</Button>
      <Loadable state={state} title="Problem version">{(v) => <DetailBody v={v} reload={state.reload} onEdit={onEdit} />}</Loadable>
    </div>
  );
}

function DetailBody({ v, reload, onEdit }: { v: ProblemVersionDetail; reload: () => Promise<void>; onEdit: (id: string) => void }) {
  const { can, confirm } = useConsole();
  const { busy, run } = useRun();
  const [checks, setChecks] = useState<{ ok: boolean; checks: { name: string; ok: boolean; detail?: string }[] } | null>(null);
  const draft = v.status === 'DRAFT';
  const val = v.validation ?? {};
  const hasPrivate = v.solution !== undefined;

  const verify = async () => {
    const r = await run('verify', () => api.post<{ ok: boolean; checks: { name: string; ok: boolean; detail?: string }[] }>(`/api/admin/problem-versions/${v.id}/verify`, {}), (x) => (x.ok ? 'All verification checks passed.' : 'Verification found problems.'));
    if (r) setChecks(r);
  };
  const publish = async () => {
    const ok = await confirm({ title: `Publish v${v.version_no}`, tone: 'primary', effects: [`"${v.title}" v${v.version_no} becomes PUBLISHED and immutable.`, 'It can then be assigned to sprints. Further edits need a new draft version.', checks ? `Last verification: ${checks.ok ? 'PASSED' : 'FAILED'}.` : 'You have not run verification in this session.'], confirmLabel: 'Publish' });
    if (!ok) return;
    await run('publish', () => api.post(`/api/admin/problem-versions/${v.id}/publish`, {}), 'Version published.');
    await reload();
  };
  const newDraft = async () => {
    const r = await run('new-draft', () => api.post<{ versionId: string }>(`/api/admin/problems/${v.problem_id}/new-version`, {}), 'Draft version ready.');
    if (r) onEdit(r.versionId);
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
      <article className={CARD}>
        <SectionHead label={`${v.key} · ${v.domain.toUpperCase()} · ${v.kind}`} title={v.title}>
          <span className="font-mono text-xs">v{v.version_no}</span>
          <Badge>{v.status}</Badge>
          <Badge>{v.difficulty}</Badge>
        </SectionHead>
        <div className="mb-4 flex flex-wrap gap-4 font-mono text-[10px] text-muted">
          <span className="text-[#e8cf8e]">REWARD {v.reward} · HINT {v.hint_cost}</span>
          <span>WORKSPACE {v.workspace}</span>
          <span>RUN {v.run_language ? `${v.run_language} ${v.run_entry ?? ''}` : 'none'}</span>
          {v.published_at && <span>PUBLISHED {fmtTime(v.published_at)}</span>}
        </div>
        <Label className="mb-1">STATEMENT</Label>
        <div className="mb-4 whitespace-pre-wrap rounded-lg border border-[#344d5b] bg-[#10252f] p-3 text-sm leading-6">{v.statement}</div>
        <Label className="mb-1">ANSWER FORMAT</Label>
        <p className="mb-4 text-xs">{v.answer_format}</p>
        <Label className="mb-1">FILES ({v.files?.length ?? 0})</Label>
        <div className="mb-4 space-y-2">
          {(v.files ?? []).map((f) => (
            <details key={f.name} className="rounded-lg border border-[#344d5b]">
              <summary className="cursor-pointer px-3 py-2 font-mono text-[11px]">{f.name} <span className="text-muted">· {f.language}{f.readOnly ? ' · read-only' : ''}</span></summary>
              <pre className="max-h-[320px] overflow-auto border-t border-[#344d5b] bg-[#0d1d27] p-3 font-mono text-[11px] leading-5">{f.content}</pre>
            </details>
          ))}
        </div>
        {v.sample_stdin && (<><Label className="mb-1">SAMPLE STDIN</Label><pre className="mb-4 overflow-auto rounded-lg bg-[#0d1d27] p-3 font-mono text-[11px]">{v.sample_stdin}</pre></>)}
        <Label className="mb-1">HINT</Label>
        <p className="mb-4 text-xs">{v.hint}</p>

        <div className="rounded-lg border-2 border-[#9d635a] bg-[#442b34]/60 p-4">
          <div className="mb-2 flex items-center gap-2"><Lock size={12} className="text-[#f3b399]" /><Label className="!text-[#f3b399]">PRIVATE · VALIDATION & SOLUTION — NEVER SHOWN TO CREWS</Label></div>
          <div className="mb-3 font-mono text-[11px]">
            MODE {String(val.mode ?? '—')}
            {val.mode === 'EXACT_TEXT' && <> · case {val.caseSensitive ? 'sensitive' : 'insensitive'} · whitespace {val.collapseWhitespace ? 'collapsed' : 'exact'} · answer stored as keyed hash only</>}
            {val.mode === 'NUMERIC' && <> · answer {String(val.answer)} ± {String(val.tolerance)}</>}
            {val.mode === 'CODE_TESTS' && <> · {String(val.language)} · entry {String(val.entry)}</>}
          </div>
          {val.mode === 'CODE_TESTS' && Array.isArray(val.tests) && (
            <details className="mb-3 rounded border border-[#9d635a]/60">
              <summary className="cursor-pointer px-3 py-2 font-mono text-[10px]">{(val.tests as unknown[]).length} hidden tests</summary>
              <div className="max-h-[300px] space-y-2 overflow-auto p-3">
                {(val.tests as { name: string; stdin: string; expected: string }[]).map((t) => (
                  <div key={t.name} className="grid gap-2 font-mono text-[10px] sm:grid-cols-[100px_1fr_1fr]">
                    <span>{t.name}</span><pre className="whitespace-pre-wrap bg-[#2c1f27] p-1">{t.stdin}</pre><pre className="whitespace-pre-wrap bg-[#2c1f27] p-1">{t.expected}</pre>
                  </div>
                ))}
              </div>
            </details>
          )}
          {val.mode === 'CODE_TESTS' && typeof val.tests === 'string' && <p className="mb-3 font-mono text-[10px]">{val.tests}</p>}
          {hasPrivate ? (
            <>
              <Label className="mb-1 !text-[#f3b399]">SOLUTION EXPLANATION</Label>
              <p className="mb-2 whitespace-pre-wrap text-xs">{v.solution?.explanation || '—'}</p>
              {Object.entries(v.solution?.files ?? {}).map(([name, content]) => (
                <details key={name} className="mb-2 rounded border border-[#9d635a]/60">
                  <summary className="cursor-pointer px-3 py-2 font-mono text-[10px]">{name} (solution)</summary>
                  <pre className="max-h-[300px] overflow-auto bg-[#2c1f27] p-3 font-mono text-[11px]">{content}</pre>
                </details>
              ))}
            </>
          ) : <p className="text-[11px] text-[#ceafb0]">Your role cannot view private solutions.</p>}
        </div>
      </article>

      <aside className="space-y-4">
        <div className={SUBCARD}>
          <Label className="mb-3">VERSION ACTIONS</Label>
          <div className="flex flex-col gap-2">
            {draft && can('content.write') && <Button secondary onClick={() => onEdit(v.id)}>Edit draft</Button>}
            {!draft && can('content.write') && <Button secondary disabled={busy === 'new-draft'} onClick={() => void newDraft()}>New draft version</Button>}
            {can('content.solutions') && <Button secondary disabled={busy === 'verify'} onClick={() => void verify()}><ShieldCheck size={14} /> {busy === 'verify' ? 'Running in sandbox…' : 'Verify with runner'}</Button>}
            {draft && can('content.write') && <Button disabled={busy === 'publish'} onClick={() => void publish()}>Publish</Button>}
          </div>
          {checks && (
            <ul className="mt-4 space-y-2" aria-live="polite">
              {checks.checks.map((c) => (
                <li key={c.name} className="flex gap-2 text-[11px]">
                  {c.ok ? <CheckCircle2 size={14} className="shrink-0 text-primary" /> : <XCircle size={14} className="shrink-0 text-[#ee9582]" />}
                  <span>{c.name}{c.detail && <span className="block font-mono text-[10px] text-muted">{c.detail}</span>}</span>
                </li>
              ))}
              {checks.checks.length === 0 && <li className="text-[11px] text-muted">No automated checks apply to this validation mode.</li>}
            </ul>
          )}
          {draft && <p className="mt-3 text-[10px] text-muted">Drafts can't be assigned. Publish first.</p>}
        </div>
        {!draft && can('game.control') && <AssignForm v={v} />}
        <button type="button" className="font-mono text-[10px] text-muted hover:underline" onClick={() => void reload()}>Reload version</button>
      </aside>
    </div>
  );
}

function AssignForm({ v }: { v: ProblemVersionDetail }) {
  const { overview, confirm } = useConsole();
  const { busy, run } = useRun();
  const [gameId, setGameId] = useState(overview.games[0]?.id ?? '');
  const [sprint, setSprint] = useState(1);
  const [rel, setRel] = useState('0');
  const [cls, setCls] = useState('');
  const [asImp, setAsImp] = useState(v.kind === 'IMPOSTER');
  const game = overview.games.find((g) => g.id === gameId);
  const rehearsal = game?.durationPreset === 'REHEARSAL';
  const [reward, setReward] = useState(String(v.reward));
  const [hint, setHint] = useState(String(v.hint_cost));
  const [claim, setClaim] = useState(rehearsal ? '20' : '60');
  const [solve, setSolve] = useState(rehearsal ? '70' : '480');
  const sp = game?.sprints.find((s) => s.number === sprint);
  const open = sp?.status === 'PENDING' || sp?.status === 'PAUSED';
  const nums = useMemo(() => ({ rel: Number(rel), cls: cls.trim() === '' ? null : Number(cls) }), [rel, cls]);

  const assign = async () => {
    if (!game) return;
    const ok = await confirm({
      title: asImp ? 'Assign as imposter draft' : 'Assign as regular task',
      tone: 'primary',
      effects: asImp
        ? [`"${v.title}" v${v.version_no} becomes an imposter DRAFT for Game ${game.number}, Sprint ${sprint}.`, `Reward ${reward}, hint ${hint}, claim ${claim}s, solve ${solve}s. Release it later from the IMPOSTERS tab.`]
        : [`"${v.title}" v${v.version_no} becomes a new task in Game ${game.number}, Sprint ${sprint} (${v.domain} room).`, `Released at +${nums.rel}s${nums.cls ? `, closes at +${nums.cls}s` : ', open until sprint end'}.`, ...(sp?.status === 'PAUSED' ? ['The sprint is PAUSED — this is an emergency mid-sprint change.'] : [])],
      confirmLabel: 'Assign',
    });
    if (!ok) return;
    await run('assign', () => api.post<{ taskId?: string; label?: string; imposterId?: string }>(`/api/admin/problem-versions/${v.id}/assign`, {
      gameId, sprint,
      ...(asImp
        ? { asImposter: { reward: Number(reward), hintCost: Number(hint), claimSeconds: Number(claim), solveSeconds: Number(solve) } }
        : { releaseOffsetSeconds: nums.rel, closeOffsetSeconds: nums.cls }),
    }), (r) => (r.label ? `Assigned as ${r.label}.` : 'Imposter draft created.'));
  };

  return (
    <div className={SUBCARD}>
      <Label className="mb-3">ASSIGN TO GAME / SPRINT</Label>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="GAME">
          <select className="input !py-2" value={gameId} onChange={(e) => setGameId(e.target.value)}>
            {overview.games.map((g) => <option key={g.id} value={g.id}>Game {g.number}</option>)}
          </select>
        </Field>
        <Field label="SPRINT">
          <select className="input !py-2" value={sprint} onChange={(e) => setSprint(Number(e.target.value))}>
            {(game?.sprints ?? []).map((s) => <option key={s.number} value={s.number}>Sprint {s.number} · {s.status}</option>)}
          </select>
        </Field>
      </div>
      <div className="mb-3"><Check checked={asImp} onChange={setAsImp} label="Assign as imposter (draft)" /></div>
      {asImp ? (
        <div className="grid grid-cols-2 gap-x-3">
          <Field label="REWARD"><NumInput value={reward} onChange={setReward} min={0} ariaLabel="Imposter reward" /></Field>
          <Field label="HINT COST"><NumInput value={hint} onChange={setHint} min={0} ariaLabel="Imposter hint cost" /></Field>
          <Field label="CLAIM SECONDS (≥5)"><NumInput value={claim} onChange={setClaim} min={5} ariaLabel="Claim seconds" /></Field>
          <Field label="SOLVE SECONDS (≥15)"><NumInput value={solve} onChange={setSolve} min={15} ariaLabel="Solve seconds" /></Field>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-3">
          <Field label="RELEASE AT +S"><NumInput value={rel} onChange={setRel} min={0} ariaLabel="Release offset seconds" /></Field>
          <Field label="CLOSE AT +S (BLANK = END)"><NumInput value={cls} onChange={setCls} min={1} ariaLabel="Close offset seconds" /></Field>
        </div>
      )}
      {!open && <div className="mb-3"><Notice tone="warn">Sprint {sprint} is {sp?.status ?? 'unknown'} — tasks can only be added to a PENDING (or, in an emergency, PAUSED) sprint.</Notice></div>}
      {v.kind === 'REGULAR' && asImp && <div className="mb-3"><Notice tone="warn">This is a REGULAR problem being used as an imposter.</Notice></div>}
      <Button className="w-full" disabled={!game || !open || busy === 'assign'} onClick={() => void assign()}>Assign…</Button>
    </div>
  );
}
