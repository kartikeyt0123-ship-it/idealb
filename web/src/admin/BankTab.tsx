/**
 * Question bank: coverage, list with DRAFT → REVIEWED → PUBLISHED workflow
 * (never automatic), verification, draft editing (JSON), creation and the
 * JSON / CSV / XLSX bank import (creates DRAFTs only).
 */
import { CloudDownload, Download, Eye, FilePlus2, LayoutGrid, List, ShieldCheck, Upload } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { V1, api } from '../lib/api';
import { Badge, Button, Label, StatePanel, useToast } from '../components/ui';
import {
  CARD, Check, DataTable, Empty, ExportLink, Loadable, Modal, Notice, SMALL, SUBCARD, SectionHead, Segmented, Select, TD, TR, errText, readFileBase64, readFileText, useAdminData, useConsole, useRun,
} from './kit';
import { DIFFS, type BankQuestion, type BankResponse, type SyncPreview, type SyncResult } from './types';

const DOMAIN_ORDER = ['core_compute', 'cryptography', 'data_decypher', 'maker', 'recon', 'web'];
const STATUSES = ['PUBLISHED', 'REVIEWED', 'DRAFT', 'ARCHIVED'] as const;
const STATUS_SHORT: Record<string, string> = { PUBLISHED: 'pub', REVIEWED: 'rev', DRAFT: 'draft', ARCHIVED: 'arch' };

export function BankTab() {
  const { can } = useConsole();
  const st = useAdminData<BankResponse>(`${V1}/admin/questions`);
  const [domain, setDomain] = useState('ALL');
  const [pool, setPool] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [workspace, setWorkspace] = useState('ALL');
  const [q, setQ] = useState('');
  const [view, setView] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  const [mode, setMode] = useState<'domains' | 'table'>('domains');
  const [sel, setSel] = useState<string[]>([]);
  const all = useMemo(() => st.data?.questions ?? [], [st.data]);
  const domains = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of all) if (!m.has(x.domain)) m.set(x.domain, x.domain_name ?? x.domain);
    const rank = (d: string) => (DOMAIN_ORDER.includes(d) ? DOMAIN_ORDER.indexOf(d) : 100);
    return [...m.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0])).map(([slug, name]) => ({ slug, name }));
  }, [all]);
  const workspaces = useMemo(() => [...new Set(all.map((x) => x.workspace))].sort(), [all]);
  const rows = all.filter((x) => (domain === 'ALL' || x.domain === domain) && (pool === 'ALL' || x.pool === pool) && (status === 'ALL' || x.status === status) && (workspace === 'ALL' || x.workspace === workspace) && (!q || `${x.key} ${x.title}`.toLowerCase().includes(q.toLowerCase())));
  const toggle = (ids: string[], on: boolean) => setSel((s) => (on ? [...new Set([...s, ...ids])] : s.filter((id) => !ids.includes(id))));
  const reload = async () => {
    await st.reload();
  };
  return (
    <div className="space-y-6">
      <Loadable state={st} title="Question bank">
        {(d) => (
          <>
            <Coverage data={d} />
            <div className={CARD}>
              <SectionHead label="BANK" title={`Questions (${d.questions.length}) · by domain & difficulty`}>
                <Button secondary={mode !== 'domains'} className={SMALL} onClick={() => setMode('domains')}><LayoutGrid size={12} /> By domain</Button>
                <Button secondary={mode !== 'table'} className={SMALL} onClick={() => setMode('table')}><List size={12} /> Table</Button>
                {can('content.write') && <Button className={SMALL} onClick={() => setCreate(true)}><FilePlus2 size={12} /> New question</Button>}
              </SectionHead>
              <div className="mb-3 grid gap-2 sm:grid-cols-5">
                <input className="input !py-2" placeholder="Search key or title" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search questions" />
                <Select ariaLabel="Domain" value={domain} onChange={setDomain} options={[{ value: 'ALL', label: 'All domains' }, ...domains.map((x) => ({ value: x.slug, label: x.name }))]} />
                <Select ariaLabel="Status" value={status} onChange={setStatus} options={['ALL', ...STATUSES].map((x) => ({ value: x, label: x === 'ALL' ? 'All statuses' : x }))} />
                <Select ariaLabel="Workspace" value={workspace} onChange={setWorkspace} options={[{ value: 'ALL', label: 'All workspaces' }, ...workspaces.map((x) => ({ value: x, label: x }))]} />
                <Select ariaLabel="Pool" value={pool} onChange={setPool} options={['ALL', 'REGULAR', 'BONUS'].map((x) => ({ value: x, label: x === 'ALL' ? 'All pools' : x }))} />
              </div>
              <BulkBar rows={all} sel={sel} shown={rows} onSelect={toggle} onClear={() => setSel([])} onDone={() => { setSel([]); void reload(); }} />
              {mode === 'domains' ? (
                rows.length === 0 ? <Empty>No questions match these filters.</Empty> : (
                  <div className="space-y-2">
                    {domains.filter((dm) => rows.some((x) => x.domain === dm.slug)).map((dm) => (
                      <DomainBlock key={dm.slug} name={dm.name} slug={dm.slug} rows={rows.filter((x) => x.domain === dm.slug)} sel={sel} onSelect={toggle} onView={setView} />
                    ))}
                  </div>
                )
              ) : (
                <DataTable
                  head={[
                    <input key="all" type="checkbox" aria-label="Select all shown" className="accent-[#8ae4cf]" checked={rows.length > 0 && rows.every((x) => sel.includes(x.version_id))} onChange={(e) => toggle(rows.map((x) => x.version_id), e.target.checked)} />,
                    'KEY', 'TITLE', 'DOMAIN', 'POOL', 'DIFF', 'WORKSPACE', 'MODE', 'VERSION', 'STATUS', 'USES', '',
                  ]}
                  empty={rows.length === 0}
                >
                  {rows.map((x) => <QuestionRow key={x.id} x={x} selected={sel.includes(x.version_id)} onSelect={(v) => toggle([x.version_id], v)} onView={() => setView(x.version_id)} reload={reload} />)}
                </DataTable>
              )}
            </div>
          </>
        )}
      </Loadable>
      {can('content.write') && <SyncPanel onDone={() => void reload()} />}
      {can('content.write') && <BankImport onDone={() => void reload()} />}
      {view && <VersionDialog versionId={view} onClose={() => { setView(null); void reload(); }} onSwitch={setView} />}
      {create && <CreateDialog onClose={() => setCreate(false)} onCreated={(vid) => { setCreate(false); void reload(); setView(vid); }} />}
    </div>
  );
}

function StatusLine({ rows }: { rows: BankQuestion[] }) {
  return (
    <span className="font-mono text-[9px] text-muted">
      {STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length] as const).filter(([, n]) => n > 0).map(([s, n]) => (
        <span key={s} className={`mr-2 ${s === 'PUBLISHED' ? 'text-[#9fe0c9]' : s === 'DRAFT' ? 'text-[#ebd68c]' : ''}`}>{STATUS_SHORT[s]} {n}</span>
      ))}
    </span>
  );
}

function DomainBlock({ name, slug, rows, sel, onSelect, onView }: { name: string; slug: string; rows: BankQuestion[]; sel: string[]; onSelect: (ids: string[], on: boolean) => void; onView: (versionId: string) => void }) {
  const ids = rows.map((r) => r.version_id);
  const allOn = ids.length > 0 && ids.every((id) => sel.includes(id));
  return (
    <details className={SUBCARD} open>
      <summary className="flex cursor-pointer flex-wrap items-center gap-3">
        <span className="font-display text-sm font-bold">{name}</span>
        <span className="font-mono text-[9px] text-muted">{slug}</span>
        <span className="font-mono text-[10px] text-[#e8cf8e]">{rows.length} question(s)</span>
        <span className="font-mono text-[10px] text-muted">{DIFFS.map((d) => `${d[0]} ${rows.filter((r) => r.difficulty === d).length}`).join(' · ')}</span>
        <StatusLine rows={rows} />
        <label className="ml-auto inline-flex items-center gap-1 font-mono text-[9px] text-muted" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" className="accent-[#8ae4cf]" checked={allOn} onChange={(e) => onSelect(ids, e.target.checked)} /> select domain
        </label>
      </summary>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {DIFFS.map((d) => {
          const list = rows.filter((r) => r.difficulty === d);
          const lids = list.map((r) => r.version_id);
          return (
            <div key={d} className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-2 border-b border-[#344d5b] pb-1">
                <span className="font-display text-[10px] font-bold">{d}</span>
                <span className="font-mono text-[10px] text-[#e8cf8e]">{list.length}</span>
                <StatusLine rows={list} />
                {list.length > 0 && (
                  <label className="ml-auto inline-flex items-center gap-1 font-mono text-[9px] text-muted">
                    <input type="checkbox" className="accent-[#8ae4cf]" checked={lids.every((id) => sel.includes(id))} onChange={(e) => onSelect(lids, e.target.checked)} /> all
                  </label>
                )}
              </div>
              {list.length === 0 ? <div className="rounded border border-dashed border-[#3b5664] p-2 text-center text-[10px] text-muted">none</div> : (
                <ul className="max-h-[340px] space-y-1 overflow-y-auto pr-1">
                  {list.map((r) => (
                    <li key={r.id} className="flex items-start gap-2 rounded border border-[#344d5b] bg-[#112a35] px-2 py-1">
                      <input type="checkbox" className="mt-0.5 accent-[#8ae4cf]" aria-label={`Select ${r.key}`} checked={sel.includes(r.version_id)} onChange={(e) => onSelect([r.version_id], e.target.checked)} />
                      <button type="button" className="min-w-0 flex-1 text-left hover:underline" onClick={() => onView(r.version_id)} title={`${r.key} — preview`}>
                        <div className="truncate text-[11px] font-bold">{r.title}</div>
                        <div className="flex flex-wrap gap-x-2 font-mono text-[9px] text-muted">
                          <span className="truncate">{r.key}</span>
                          <span>{r.workspace}</span>
                          <span>v{r.version_no}</span>
                          {r.uses > 0 ? <span className="text-[#ebd68c]">used {r.uses}×</span> : <span>unused</span>}
                          {r.pool === 'BONUS' && <span className="text-[#ee9582]">BONUS</span>}
                          {r.is_demo && <span>demo</span>}
                        </div>
                      </button>
                      <span className={`shrink-0 font-mono text-[9px] ${r.status === 'PUBLISHED' ? 'text-[#9fe0c9]' : r.status === 'DRAFT' ? 'text-[#ebd68c]' : 'text-muted'}`}>{r.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}

function BulkBar({ rows, sel, shown, onSelect, onClear, onDone }: { rows: BankQuestion[]; sel: string[]; shown: BankQuestion[]; onSelect: (ids: string[], on: boolean) => void; onClear: () => void; onDone: () => void }) {
  const { can, confirm } = useConsole();
  const { run, busy } = useRun();
  if (!can('content.publish')) return null;
  const picked = rows.filter((r) => sel.includes(r.version_id));
  const toPublish = picked.filter((r) => r.status === 'DRAFT' || r.status === 'REVIEWED');
  const toReview = picked.filter((r) => r.status === 'DRAFT');
  const toArchive = picked.filter((r) => r.status !== 'ARCHIVED');
  const notReady = shown.filter((r) => r.status === 'DRAFT' || r.status === 'REVIEWED');
  const go = async (to: 'REVIEWED' | 'PUBLISHED' | 'ARCHIVED', list: BankQuestion[]) => {
    const ok = await confirm({
      title: `${to === 'PUBLISHED' ? 'Publish' : to === 'ARCHIVED' ? 'Archive' : 'Mark reviewed'} · ${list.length} question(s)`,
      tone: to === 'ARCHIVED' ? 'danger' : 'primary',
      effects: [
        to === 'PUBLISHED' ? 'They become eligible for initial sets, top-ups and bank releases.' : to === 'ARCHIVED' ? 'They are withdrawn from future sets and releases (already released instances are unaffected).' : 'They move from DRAFT to REVIEWED.',
        `Domains: ${[...new Set(list.map((r) => r.domain_name ?? r.domain))].join(', ')}.`,
        ...(picked.length > list.length ? [`${picked.length - list.length} selected question(s) are skipped (already in that state or not eligible).`] : []),
      ],
      confirmLabel: to === 'PUBLISHED' ? 'Publish' : to === 'ARCHIVED' ? 'Archive' : 'Mark reviewed',
    });
    if (!ok) return;
    if (await run(`bulk-${to}`, () => api.post<{ moved: number }>(`${V1}/admin/question-versions/bulk-status`, { versionIds: list.map((r) => r.version_id), to }), (x) => `${x.moved} question(s) → ${to}.`)) onDone();
  };
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#3b6270] bg-[#112e3a] px-3 py-2 text-xs">
      <span className="font-mono text-[10px]">{sel.length} selected</span>
      {notReady.length > 0 && <Button secondary className={SMALL} onClick={() => onSelect(notReady.map((r) => r.version_id), true)}>Select unpublished shown ({notReady.length})</Button>}
      {sel.length > 0 && (
        <>
          <Button className={SMALL} disabled={!!busy || toPublish.length === 0} onClick={() => void go('PUBLISHED', toPublish)}>Publish ({toPublish.length})</Button>
          <Button secondary className={SMALL} disabled={!!busy || toReview.length === 0} onClick={() => void go('REVIEWED', toReview)}>Mark reviewed ({toReview.length})</Button>
          <Button danger className={SMALL} disabled={!!busy || toArchive.length === 0} onClick={() => void go('ARCHIVED', toArchive)}>Archive ({toArchive.length})</Button>
          <Button secondary className={SMALL} onClick={onClear}>Clear</Button>
        </>
      )}
      {sel.length === 0 && <span className="text-[10px] text-muted">Tick questions, a difficulty column or a whole domain to publish / archive in bulk.</span>}
    </div>
  );
}

function Coverage({ data }: { data: BankResponse }) {
  const c = data.coverage;
  const domains = [...new Set(c.initial.map((r) => r.domain))];
  const cell = (d: string, diff: string) => c.initial.find((r) => r.domain === d && r.difficulty === diff);
  return (
    <div className={CARD}>
      <SectionHead label="COVERAGE" title="PUBLISHED questions per domain vs. one initial set" />
      <p className="mb-2 text-[11px] text-muted">have / need for one slot&rsquo;s initial set. Questions may be reused across slots and rounds, so one full set per domain is enough to run every slot.</p>
      <DataTable head={['DOMAIN', 'EASY', 'MEDIUM', 'HARD']}>
        {domains.map((d) => (
          <tr key={d} className={TR}>
            <td className={TD}>{d}</td>
            {DIFFS.map((diff) => {
              const r = cell(d, diff);
              return <td key={diff} className={`${TD} font-mono ${r && r.have < r.need ? 'text-[#ee9582]' : 'text-[#9fe0c9]'}`}>{r ? `${r.have}/${r.need}` : '—'}</td>;
            })}
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

function QuestionRow({ x, selected, onSelect, onView, reload }: { x: BankQuestion; selected: boolean; onSelect: (v: boolean) => void; onView: () => void; reload: () => Promise<void> }) {
  const { can, confirm } = useConsole();
  const { run, busy } = useRun();
  const advance = async (to: 'REVIEWED' | 'PUBLISHED' | 'ARCHIVED') => {
    if (to !== 'REVIEWED' && !(await confirm({ title: `${to === 'PUBLISHED' ? 'Publish' : 'Archive'} ${x.key} v${x.version_no}`, tone: to === 'PUBLISHED' ? 'primary' : 'danger', effects: to === 'PUBLISHED' ? ['Becomes eligible for slot plans and manual releases.', 'Published versions are immutable (edit via a new draft).'] : ['The version is withdrawn from future plans.'], confirmLabel: to === 'PUBLISHED' ? 'Publish' : 'Archive' }))) return;
    if (await run(`${x.id}-${to}`, () => api.post(`${V1}/admin/question-versions/${x.version_id}/status`, { to }), `${x.key} → ${to}.`)) void reload();
  };
  return (
    <tr className={TR}>
      <td className={TD}><input type="checkbox" aria-label={`Select ${x.key}`} className="accent-[#8ae4cf]" checked={selected} onChange={(e) => onSelect(e.target.checked)} /></td>
      <td className={`${TD} font-mono`}>{x.key}{x.is_demo && <span className="ml-1 text-[9px] text-muted">demo</span>}</td>
      <td className={TD}>{x.title}</td>
      <td className={TD}>{x.domain_name ?? x.domain}</td>
      <td className={TD}>{x.pool}</td>
      <td className={TD}>{x.difficulty}</td>
      <td className={TD}>{x.workspace}</td>
      <td className={TD}>{x.validation_mode}</td>
      <td className={`${TD} font-mono`}>v{x.version_no}</td>
      <td className={TD}><Badge>{x.status}</Badge></td>
      <td className={`${TD} font-mono`}>{x.uses}</td>
      <td className={TD}>
        <div className="flex flex-wrap gap-1">
          <Button secondary className={SMALL} onClick={onView}><Eye size={11} /> View</Button>
          {can('content.write') && x.status === 'DRAFT' && <Button secondary className={SMALL} disabled={!!busy} onClick={() => void advance('REVIEWED')}>Mark reviewed</Button>}
          {can('content.publish') && x.status === 'REVIEWED' && <Button className={SMALL} disabled={!!busy} onClick={() => void advance('PUBLISHED')}>Publish</Button>}
          {can('content.write') && x.status !== 'ARCHIVED' && <Button danger className={SMALL} disabled={!!busy} onClick={() => void advance('ARCHIVED')}>Archive</Button>}
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Version view / verify / draft editor
// ---------------------------------------------------------------------------

type Version = Record<string, unknown> & {
  id: string; question_id: string; version_no: number; status: string; title: string; difficulty: string; statement: string; workspace: string;
  run_language: string | null; run_entry: string | null; files: { name: string; language: string; content: string; readOnly?: boolean }[];
  sample_stdin: string | null; answer_format: string; validation: Record<string, unknown>; hint: string;
  solution?: { explanation?: string; files?: Record<string, string>; answer?: string }; key: string; pool: string; domain: string;
  board?: { type: 'text' | 'html' | 'sequence'; content: string } | null;
  hints?: { level: number; cost: number; text: string }[] | null;
  source?: { repo?: string; id: string; commit?: string; type?: string; hash?: string } | null;
  runtime?: ({ kind: string; hidden?: boolean } & Record<string, unknown>) | null;
};

/** Converts a stored version into the authoring (QuestionInput) shape used by PUT / POST. */
function toInput(v: Version) {
  const val = { ...v.validation };
  return {
    key: v.key, domain: v.domain, pool: v.pool, title: v.title, difficulty: v.difficulty, statement: v.statement, workspace: v.workspace,
    runLanguage: v.run_language, runEntry: v.run_entry, files: v.files, sampleStdin: v.sample_stdin, answerFormat: v.answer_format,
    validation: val, hint: v.hint, solutionExplanation: v.solution?.explanation ?? '', solutionFiles: v.solution?.files, solutionAnswer: v.solution?.answer,
  };
}

function VersionDialog({ versionId, onClose, onSwitch }: { versionId: string; onClose: () => void; onSwitch: (id: string) => void }) {
  const { can } = useConsole();
  const { run, busy } = useRun();
  const toast = useToast();
  const [v, setV] = useState<Version | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [checks, setChecks] = useState<{ ok: boolean; checks: { name: string; ok: boolean; detail?: string }[] } | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const load = () => api.get<Version>(`${V1}/admin/question-versions/${versionId}`).then(setV, (e) => setErr(errText(e)));
  useEffect(() => {
    setV(null);
    setChecks(null);
    setEdit(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId]);
  const verify = async () => {
    const r = await run('verify', () => api.post<{ ok: boolean; checks: { name: string; ok: boolean; detail?: string }[] }>(`${V1}/admin/question-versions/${versionId}/verify`, {}));
    if (r) setChecks(r);
  };
  const newDraft = async () => {
    if (!v) return;
    const r = await run('draft', () => api.post<{ versionId: string }>(`${V1}/admin/questions/${v.question_id}/drafts`, {}), 'Draft ready.');
    if (r) onSwitch(r.versionId);
  };
  const saveDraft = async () => {
    if (edit === null) return;
    let body: unknown;
    try {
      body = JSON.parse(edit);
    } catch {
      toast('The draft is not valid JSON.', 'alert');
      return;
    }
    if (await run('save', () => api.put(`${V1}/admin/question-versions/${versionId}`, body), 'Draft saved.')) {
      setEdit(null);
      void load();
    }
  };
  const hiddenSolution = !can('content.solutions');
  return (
    <Modal open onClose={onClose} title={v ? `${v.key} · v${v.version_no} · ${v.title}` : 'Question version'} label="QUESTION VERSION" wide>
      {err && <StatePanel kind="error" title="Version unavailable" message={err} />}
      {!v && !err && <StatePanel kind="loading" title="Loading version…" />}
      {v && (
        <div className="space-y-4 text-xs">
          <div className="flex flex-wrap gap-2">
            <Badge>{v.status}</Badge><Badge>{v.domain}</Badge><Badge>{v.pool}</Badge><Badge>{v.difficulty}</Badge><Badge>{v.workspace}</Badge>
            {v.run_language && <Badge>{`${v.run_language} · ${v.run_entry}`}</Badge>}
          </div>
          <div className="flex flex-wrap gap-2">
            {can('content.write') && <Button secondary className={SMALL} disabled={!!busy} onClick={() => void verify()}><ShieldCheck size={11} /> Verify</Button>}
            {can('content.write') && v.status !== 'DRAFT' && <Button secondary className={SMALL} disabled={!!busy} onClick={() => void newDraft()}>New draft from this version</Button>}
            {can('content.write') && v.status === 'DRAFT' && edit === null && <Button className={SMALL} onClick={() => setEdit(JSON.stringify(toInput(v), null, 2))}>Edit draft (JSON)</Button>}
          </div>
          {checks && (
            <div className={SUBCARD}>
              <Label className="mb-2">{checks.ok ? 'VERIFICATION PASSED' : 'VERIFICATION FAILED'}</Label>
              <ul className="space-y-1">{checks.checks.map((c, i) => <li key={i} className={c.ok ? 'text-[#9fe0c9]' : 'text-[#f3b399]'}>{c.ok ? '✓' : '✗'} {c.name}{c.detail ? ` — ${c.detail}` : ''}</li>)}</ul>
            </div>
          )}
          {edit !== null ? (
            <div className="space-y-2">
              <Notice>Edit the authoring JSON. For EXACT_TEXT, leaving <code>validation.answer</code> empty keeps the stored secret answer.</Notice>
              <textarea className="input min-h-[420px] font-mono text-[11px]" spellCheck={false} value={edit} onChange={(e) => setEdit(e.target.value)} aria-label="Draft JSON" />
              <div className="flex justify-end gap-2">
                <Button secondary className={SMALL} onClick={() => setEdit(null)}>Discard</Button>
                <Button className={SMALL} disabled={!!busy} onClick={() => void saveDraft()}>Save draft</Button>
              </div>
            </div>
          ) : (
            <>
              <Block label="STATEMENT"><p className="whitespace-pre-wrap leading-5">{v.statement}</p></Block>
              {v.board && (
                <Block label={`BOARD · ${v.board.type.toUpperCase()}`}>
                  {v.board.type === 'html'
                    ? <iframe title="Board preview" sandbox="" srcDoc={v.board.content} className="h-64 w-full rounded bg-white" />
                    : <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-[#0d1f28] p-2 font-mono text-[11px]">{v.board.content}</pre>}
                </Block>
              )}
              <Block label="ANSWER FORMAT">{v.answer_format}</Block>
              {v.files.length > 0 && (
                <Block label="FILES">
                  {v.files.map((f) => (
                    <details key={f.name} className="mb-1">
                      <summary className="cursor-pointer font-mono">{f.name} · {f.language}{f.readOnly ? ' · read-only' : ''}</summary>
                      <pre className="mt-1 max-h-64 overflow-auto rounded bg-[#0d1f28] p-2 font-mono text-[11px]">{f.content}</pre>
                    </details>
                  ))}
                </Block>
              )}
              {v.sample_stdin && <Block label="SAMPLE STDIN"><pre className="font-mono">{v.sample_stdin}</pre></Block>}
              <Block label="VALIDATION"><pre className="max-h-48 overflow-auto font-mono text-[11px]">{JSON.stringify(v.validation, null, 2)}</pre></Block>
              {v.hints && v.hints.length > 0 ? (
                <Block label="HINTS (PAID, BOUGHT IN ORDER)">
                  <ol className="space-y-1">{v.hints.map((h) => <li key={h.level}><span className="font-mono text-[#e8cf8e]">L{h.level} · {h.cost} coins</span> — {h.text}</li>)}</ol>
                </Block>
              ) : <Block label="HINT">{v.hint}</Block>}
              {v.runtime && (
                <Block label="RUNTIME">
                  <span className="font-mono">{v.runtime.kind}</span>
                  {v.runtime.hidden ? <span className="ml-2 text-muted">hidden (setup, checks and expected state reveal the answer — requires content.solutions)</span> : (
                    <details className="mt-1"><summary className="cursor-pointer font-mono text-[10px] text-[#e6c887]">show runtime</summary><pre className="max-h-64 overflow-auto font-mono text-[11px]">{JSON.stringify(v.runtime, null, 2)}</pre></details>
                  )}
                </Block>
              )}
              {v.source && (
                <Block label="SOURCE">
                  <span className="font-mono text-[11px]">{v.source.repo ?? 'local'} · {v.source.id}{v.source.type ? ` · ${v.source.type}` : ''}{v.source.commit ? ` · ${v.source.commit.slice(0, 10)}` : ''}</span>
                </Block>
              )}
              {hiddenSolution ? <Notice>Private solution hidden (requires content.solutions).</Notice> : v.solution && (
                <Block label="PRIVATE SOLUTION">
                  <p className="whitespace-pre-wrap">{v.solution.explanation}</p>
                  {v.solution.answer && <div className="mt-1 font-mono">Answer: {v.solution.answer}</div>}
                  {v.solution.files && Object.entries(v.solution.files).map(([n, c]) => (
                    <details key={n}><summary className="cursor-pointer font-mono">{n}</summary><pre className="max-h-64 overflow-auto font-mono text-[11px]">{c}</pre></details>
                  ))}
                </Block>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={SUBCARD}>
      <Label className="mb-1">{label}</Label>
      <div>{children}</div>
    </div>
  );
}

const NEW_TEMPLATE = {
  key: 'my-new-question-1',
  domain: 'web',
  pool: 'REGULAR',
  title: 'New question title',
  difficulty: 'EASY',
  statement: 'Describe the bug and what the crew must find or fix (at least 20 characters).',
  workspace: 'BASIC',
  runLanguage: null,
  files: [],
  answerFormat: 'One word, exactly as asked',
  validation: { mode: 'EXACT_TEXT', answer: 'ANSWER', caseSensitive: false, collapseWhitespace: true },
  hint: 'A helpful nudge.',
  solutionExplanation: 'Private walkthrough explaining the answer.',
  solutionAnswer: 'ANSWER',
};

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (versionId: string) => void }) {
  const { run, busy } = useRun();
  const toast = useToast();
  const [text, setText] = useState(JSON.stringify(NEW_TEMPLATE, null, 2));
  const submit = async () => {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      toast('Not valid JSON.', 'alert');
      return;
    }
    const r = await run('create', () => api.post<{ questionId: string; versionId: string }>(`${V1}/admin/questions`, body), 'Question created as DRAFT.');
    if (r) onCreated(r.versionId);
  };
  return (
    <Modal open onClose={onClose} title="Create question (DRAFT)" label="AUTHORING" wide>
      <Notice>Domains: core_compute, cryptography, data_decypher, maker, recon, web · workspaces BASIC/DATA (python), SHELL, SQL, JSON, EVIDENCE, WEB · validation modes EXACT_TEXT, NUMERIC (answer, tolerance) or CODE_TESTS (language, entry, tests[]). New questions are DRAFTs — review and publish them explicitly.</Notice>
      <textarea className="input mt-3 min-h-[420px] font-mono text-[11px]" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} aria-label="Question JSON" />
      <div className="mt-3 flex justify-end gap-2">
        <Button secondary className={SMALL} onClick={onClose}>Cancel</Button>
        <Button className={SMALL} disabled={!!busy} onClick={() => void submit()}>Create draft</Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// GitHub sync (IDEALab.dev) — preview → commit
// ---------------------------------------------------------------------------

const IDEALAB_REPO = 'https://github.com/Idealab-Sgsits/IDEALab.dev';

function SyncPanel({ onDone }: { onDone: () => void }) {
  const { can, confirm } = useConsole();
  const { run, busy } = useRun();
  const [repo, setRepo] = useState(IDEALAB_REPO);
  const [ref, setRef] = useState('main');
  const [source, setSource] = useState<'GITHUB' | 'SNAPSHOT'>('GITHUB');
  const [pv, setPv] = useState<SyncPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [publish, setPublish] = useState(false);
  const [filter, setFilter] = useState<'CHANGES' | 'ALL' | 'NEW' | 'CHANGED' | 'UNCHANGED'>('CHANGES');
  const [result, setResult] = useState<SyncResult | null>(null);
  const preview = async () => {
    setLoading(true);
    setErr(null);
    setPv(null);
    setResult(null);
    try {
      setPv(await api.post<SyncPreview>(`${V1}/admin/questions/sync/preview`, source === 'GITHUB' ? { source, repo: repo.trim() || undefined, ref: ref.trim() || undefined } : { source }));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setLoading(false);
    }
  };
  const apply = pv ? pv.summary.new + pv.summary.changed : 0;
  const commit = async () => {
    if (!pv) return;
    const ok = await confirm({
      title: `Apply sync · ${apply} question(s)`,
      tone: publish ? 'warning' : 'primary',
      effects: [
        `${pv.summary.new} new question(s) are created; ${pv.summary.changed} changed question(s) get a new version.`,
        publish ? 'They are PUBLISHED immediately — eligible for initial sets, top-ups and releases. Older published versions of changed questions are archived.' : 'They are created as DRAFT — review and publish them here (bulk publish by domain / difficulty).',
        'Questions already released to slots keep the version crews saw.',
      ],
      confirmLabel: publish ? 'Apply & publish' : 'Apply as drafts',
    });
    if (!ok) return;
    const r = await run('sync', () => api.post<SyncResult>(`${V1}/admin/questions/sync/commit`, { previewId: pv.previewId, publish }), (x) => (x.alreadyCommitted ? 'This preview was already applied.' : `Sync applied: ${x.created} created, ${x.versioned} new version(s) as ${x.status}.`));
    if (r) {
      setResult(r);
      onDone();
    }
  };
  const rows = (pv?.rows ?? []).filter((r) => filter === 'ALL' || (filter === 'CHANGES' ? r.action !== 'UNCHANGED' : r.action === filter));
  const doms = pv ? Object.keys(pv.summary.byDomain) : [];
  return (
    <div className={CARD}>
      <SectionHead label="GITHUB SYNC" title="Fetch questions from the IDEALab.dev repository" />
      <p className="mb-3 text-[11px] leading-5 text-muted">
        Reads the domain question files of the repository (or the snapshot bundled with this server), categorizes them by domain and difficulty and shows what is new or changed. Nothing changes until you apply; new questions are DRAFT unless you choose to publish immediately.
      </p>
      <div className="grid gap-3 lg:grid-cols-[2fr_1fr_auto_auto] lg:items-end">
        <label className="block">
          <span className="mb-1 block font-mono text-[9px] text-muted">REPOSITORY URL</span>
          <input className="input !py-2" value={repo} disabled={source !== 'GITHUB'} onChange={(e) => setRepo(e.target.value)} aria-label="Repository URL" />
        </label>
        <label className="block">
          <span className="mb-1 block font-mono text-[9px] text-muted">BRANCH / REF</span>
          <input className="input !py-2" value={ref} disabled={source !== 'GITHUB'} onChange={(e) => setRef(e.target.value)} aria-label="Branch" />
        </label>
        <Segmented label="Source" value={source} onChange={setSource} options={[{ value: 'GITHUB', label: 'GITHUB' }, { value: 'SNAPSHOT', label: 'BUNDLED SNAPSHOT' }]} />
        <Button className={SMALL} disabled={loading} onClick={() => void preview()}><CloudDownload size={12} /> Preview</Button>
      </div>
      {loading && <div className="mt-3"><StatePanel kind="loading" title={source === 'GITHUB' ? 'Fetching from GitHub (up to 30 s)…' : 'Reading the bundled snapshot…'} /></div>}
      {err && <div className="mt-3"><Notice tone="danger">{err}</Notice></div>}
      {pv && (
        <div className="mt-4 space-y-3 text-xs">
          <div className="font-mono text-[10px] text-muted">
            {pv.summary.source.repo}{pv.summary.source.ref ? ` @ ${pv.summary.source.ref}` : ''}{pv.summary.source.commit ? ` · commit ${pv.summary.source.commit.slice(0, 12)}` : ''}
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>{`${pv.summary.total} QUESTIONS`}</Badge>
            <Badge>{`${pv.summary.new} NEW`}</Badge>
            <Badge>{`${pv.summary.changed} CHANGED`}</Badge>
            <Badge>{`${pv.summary.unchanged} UNCHANGED`}</Badge>
            <Badge>{`${pv.summary.errors} ERRORS`}</Badge>
          </div>
          <DataTable head={['DOMAIN', 'EASY', 'MEDIUM', 'HARD', 'TOTAL']}>
            {doms.map((d) => {
              const c = pv.summary.byDomain[d];
              return (
                <tr key={d} className={TR}>
                  <td className={TD}>{d}</td>
                  {DIFFS.map((x) => <td key={x} className={`${TD} font-mono`}>{c[x] ?? 0}</td>)}
                  <td className={`${TD} font-mono text-[#e8cf8e]`}>{DIFFS.reduce((a, x) => a + (c[x] ?? 0), 0)}</td>
                </tr>
              );
            })}
          </DataTable>
          <Segmented
            label="Rows"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'CHANGES', label: `NEW + CHANGED (${apply})` },
              { value: 'NEW', label: `NEW (${pv.summary.new})` },
              { value: 'CHANGED', label: `CHANGED (${pv.summary.changed})` },
              { value: 'UNCHANGED', label: `UNCHANGED (${pv.summary.unchanged})` },
              { value: 'ALL', label: `ALL (${pv.summary.total})` },
            ]}
          />
          <div className="max-h-[360px] overflow-y-auto">
            <DataTable head={['ACTION', 'KEY', 'TITLE', 'DOMAIN', 'DIFF', 'WORKSPACE', 'CURRENT STATUS']} empty={rows.length === 0}>
              {rows.map((r) => (
                <tr key={r.key} className={TR}>
                  <td className={TD}><span className={`font-mono text-[10px] ${r.action === 'NEW' ? 'text-[#9fe0c9]' : r.action === 'CHANGED' ? 'text-[#ebd68c]' : 'text-muted'}`}>{r.action}</span></td>
                  <td className={`${TD} font-mono text-[10px]`}>{r.key}</td>
                  <td className={TD}>{r.title}</td>
                  <td className={TD}>{r.domain}</td>
                  <td className={TD}>{r.difficulty}</td>
                  <td className={TD}>{r.workspace}</td>
                  <td className={TD}>{r.status ?? '—'}</td>
                </tr>
              ))}
            </DataTable>
          </div>
          {pv.errors.length > 0 && (
            <Notice tone="warn">
              <b>{pv.errors.length} source question(s) could not be converted and are skipped:</b>
              <ul className="mt-1 list-disc pl-5">{pv.errors.slice(0, 50).map((e, i) => <li key={i}><span className="font-mono">{e.domain}/{e.id}</span> — {e.error}</li>)}</ul>
              {pv.errors.length > 50 && <div>…and {pv.errors.length - 50} more.</div>}
            </Notice>
          )}
          {result ? (
            <Notice>
              {result.alreadyCommitted ? 'This preview was already applied. ' : ''}Created {result.created}, new versions {result.versioned}, status {result.status}. {result.status === 'DRAFT' ? 'Publish them above (select a domain or difficulty column → Publish).' : 'They are available to slots now.'}
            </Notice>
          ) : can('content.publish') ? (
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Check checked={publish} onChange={setPublish} label="Publish immediately (otherwise DRAFT)" />
              <Button className={SMALL} disabled={!!busy || apply === 0} onClick={() => void commit()} title={apply === 0 ? 'Nothing new or changed' : undefined}>
                Apply {apply} question(s)
              </Button>
            </div>
          ) : (
            <Notice>Applying a sync requires the content.publish permission.</Notice>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bank import
// ---------------------------------------------------------------------------

interface QPreview { batchId: string; summary: { rows: number; valid: number; errors: number; distribution: Record<string, number> }; rows: { row: number; key: string | null; title: string | null; domain: string | null; difficulty: string | null; pool: string | null; errors: string[] }[] }

function BankImport({ onDone }: { onDone: () => void }) {
  const { confirm } = useConsole();
  const { run, busy } = useRun();
  const [file, setFile] = useState<File | null>(null);
  const [assets, setAssets] = useState<File[]>([]);
  const [pv, setPv] = useState<QPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const preview = async () => {
    if (!file) return;
    setLoading(true);
    setErr(null);
    setDone(null);
    try {
      const map: Record<string, string> = {};
      for (const a of assets) map[a.name] = await readFileText(a);
      setPv(await api.post<QPreview>(`${V1}/admin/questions/imports`, { fileName: file.name, contentBase64: await readFileBase64(file), assets: assets.length ? map : undefined }));
    } catch (e) {
      setErr(errText(e));
      setPv(null);
    } finally {
      setLoading(false);
    }
  };
  const commit = async () => {
    if (!pv) return;
    if (!(await confirm({ title: `Import ${pv.summary.valid} question(s)`, tone: 'primary', effects: ['Every question is created as a DRAFT.', 'Nothing is published or added to slot plans automatically.'], confirmLabel: 'Commit import' }))) return;
    const r = await run('qcommit', () => api.post<{ createdDrafts: number; alreadyCommitted?: boolean }>(`${V1}/admin/questions/imports/${pv.batchId}/commit`, {}), (x) => (x.alreadyCommitted ? 'Already committed.' : `${x.createdDrafts} draft(s) created.`));
    if (r) {
      setDone(r.createdDrafts);
      onDone();
    }
  };
  return (
    <div className={CARD}>
      <SectionHead label="BANK IMPORT" title="Import JSON / CSV / XLSX (creates DRAFTs only)">
        <ExportLink href={`${V1}/admin/questions/import-template?format=csv`}><Download size={10} /> CSV template</ExportLink>
        <ExportLink href={`${V1}/admin/questions/import-template?format=xlsx`}><Download size={10} /> XLSX template</ExportLink>
      </SectionHead>
      <p className="mb-3 text-[11px] leading-5 text-muted">JSON carries full questions (including CODE_TESTS). CSV/XLSX rows reference linked asset files by name in the <code>files</code> column — attach those files below (read as text).</p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border-2 border-[#52717e] bg-[#2d4654] px-3 py-2 font-display text-[9px] font-bold text-[#d6e1e1]">
          <Upload size={12} /> {file ? file.name : 'Choose bank file'}
          <input type="file" accept=".json,.csv,.xlsx" className="sr-only" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPv(null); e.target.value = ''; }} />
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border-2 border-[#52717e] bg-[#2d4654] px-3 py-2 font-display text-[9px] font-bold text-[#d6e1e1]">
          <Upload size={12} /> {assets.length ? `${assets.length} asset(s)` : 'Attach assets (optional)'}
          <input type="file" multiple className="sr-only" onChange={(e) => { setAssets(Array.from(e.target.files ?? [])); setPv(null); e.target.value = ''; }} />
        </label>
        <Button secondary className={SMALL} disabled={!file || loading} onClick={() => void preview()}>Preview</Button>
      </div>
      {assets.length > 0 && <div className="mt-2 font-mono text-[10px] text-muted">{assets.map((a) => a.name).join(', ')}</div>}
      {loading && <div className="mt-3"><StatePanel kind="loading" title="Validating bank…" /></div>}
      {err && <div className="mt-3"><Notice tone="danger">{err}</Notice></div>}
      {pv && (
        <div className="mt-4 space-y-3 text-xs">
          <div className="flex flex-wrap gap-2"><Badge>{`${pv.summary.rows} ROWS`}</Badge><Badge>{`${pv.summary.valid} VALID`}</Badge><Badge>{`${pv.summary.errors} ERRORS`}</Badge></div>
          {Object.keys(pv.summary.distribution).length > 0 && (
            <div className="text-[11px] text-muted">Distribution: {Object.entries(pv.summary.distribution).map(([k, n]) => `${k} ×${n}`).join(' · ')}</div>
          )}
          <DataTable head={['ROW', 'KEY', 'TITLE', 'DOMAIN', 'DIFF', 'POOL', 'ERRORS']}>
            {pv.rows.map((r) => (
              <tr key={r.row} className={TR}>
                <td className={`${TD} font-mono`}>{r.row}</td>
                <td className={`${TD} font-mono`}>{r.key ?? '—'}</td>
                <td className={TD}>{r.title ?? '—'}</td>
                <td className={TD}>{r.domain ?? '—'}</td>
                <td className={TD}>{r.difficulty ?? '—'}</td>
                <td className={TD}>{r.pool ?? '—'}</td>
                <td className={`${TD} max-w-[380px] whitespace-normal text-[#f3b399]`}>{r.errors.map((e, i) => <div key={i}>{e}</div>)}</td>
              </tr>
            ))}
          </DataTable>
          {pv.summary.errors > 0 && <Notice tone="warn">Fix the rows with errors and preview again — a bank import commits only when every row is valid.</Notice>}
          {done !== null ? <Notice>{done} DRAFT(s) created. Review and publish them in the list above.</Notice> : (
            <div className="flex justify-end"><Button className={SMALL} disabled={pv.summary.errors > 0 || pv.summary.valid === 0 || !!busy} onClick={() => void commit()}>Commit as drafts</Button></div>
          )}
        </div>
      )}
    </div>
  );
}
