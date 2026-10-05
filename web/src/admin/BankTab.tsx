/**
 * Question bank: coverage, list with DRAFT → REVIEWED → PUBLISHED workflow
 * (never automatic), verification, draft editing (JSON), creation and the
 * JSON / CSV / XLSX bank import (creates DRAFTs only).
 */
import { Download, Eye, FilePlus2, ShieldCheck, Upload } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { V1, api } from '../lib/api';
import { Badge, Button, Label, StatePanel, useToast } from '../components/ui';
import {
  CARD, DataTable, ExportLink, Loadable, Modal, Notice, SMALL, SUBCARD, SectionHead, Select, TD, TR, errText, readFileBase64, readFileText, useAdminData, useConsole, useRun,
} from './kit';
import type { BankQuestion, BankResponse } from './types';

export function BankTab() {
  const { can } = useConsole();
  const st = useAdminData<BankResponse>(`${V1}/admin/questions`);
  const [domain, setDomain] = useState('ALL');
  const [pool, setPool] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [q, setQ] = useState('');
  const [view, setView] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  const domains = useMemo(() => [...new Set((st.data?.questions ?? []).map((x) => x.domain))], [st.data]);
  const rows = (st.data?.questions ?? []).filter((x) => (domain === 'ALL' || x.domain === domain) && (pool === 'ALL' || x.pool === pool) && (status === 'ALL' || x.status === status) && (!q || `${x.key} ${x.title}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="space-y-6">
      <Loadable state={st} title="Question bank">
        {(d) => (
          <>
            <Coverage data={d} />
            <div className={CARD}>
              <SectionHead label="BANK" title={`Questions (${d.questions.length})`}>
                {can('content.write') && <Button className={SMALL} onClick={() => setCreate(true)}><FilePlus2 size={12} /> New question</Button>}
              </SectionHead>
              <div className="mb-3 grid gap-2 sm:grid-cols-4">
                <input className="input !py-2" placeholder="Search key or title" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search questions" />
                <Select ariaLabel="Domain" value={domain} onChange={setDomain} options={[{ value: 'ALL', label: 'All domains' }, ...domains.map((x) => ({ value: x, label: x }))]} />
                <Select ariaLabel="Pool" value={pool} onChange={setPool} options={['ALL', 'REGULAR', 'BONUS'].map((x) => ({ value: x, label: x === 'ALL' ? 'All pools' : x }))} />
                <Select ariaLabel="Status" value={status} onChange={setStatus} options={['ALL', 'DRAFT', 'REVIEWED', 'PUBLISHED', 'ARCHIVED'].map((x) => ({ value: x, label: x === 'ALL' ? 'All statuses' : x }))} />
              </div>
              <DataTable head={['KEY', 'TITLE', 'DOMAIN', 'POOL', 'DIFF', 'MODE', 'VERSION', 'STATUS', 'USES', '']} empty={rows.length === 0}>
                {rows.map((x) => <QuestionRow key={x.id} x={x} onView={() => setView(x.version_id)} reload={st.reload} />)}
              </DataTable>
            </div>
          </>
        )}
      </Loadable>
      {can('content.write') && <BankImport onDone={() => void st.reload()} />}
      {view && <VersionDialog versionId={view} onClose={() => { setView(null); void st.reload(); }} onSwitch={setView} />}
      {create && <CreateDialog onClose={() => setCreate(false)} onCreated={(vid) => { setCreate(false); void st.reload(); setView(vid); }} />}
    </div>
  );
}

function Coverage({ data }: { data: BankResponse }) {
  const c = data.coverage;
  const domains = [...new Set(c.initial.map((r) => r.domain))];
  const cell = (d: string, diff: string) => c.initial.find((r) => r.domain === d && r.difficulty === diff);
  return (
    <div className={CARD}>
      <SectionHead label="COVERAGE" title="Unused PUBLISHED questions vs. what unstarted slot plans need" />
      <DataTable head={['DOMAIN', 'EASY', 'MEDIUM', 'HARD']}>
        {domains.map((d) => (
          <tr key={d} className={TR}>
            <td className={TD}>{d}</td>
            {(['EASY', 'MEDIUM', 'HARD'] as const).map((diff) => {
              const r = cell(d, diff);
              return <td key={diff} className={`${TD} font-mono ${r && r.have < r.need ? 'text-[#ee9582]' : 'text-[#9fe0c9]'}`}>{r ? `${r.have}/${r.need}` : '—'}</td>;
            })}
          </tr>
        ))}
      </DataTable>
      <div className="mt-2 flex flex-wrap gap-4 text-xs">
        <span className={c.reserves.have < c.reserves.need ? 'text-[#ee9582]' : ''}>Reserves (regular): {c.reserves.have}/{c.reserves.need}</span>
        <span className={c.bonuses.have < c.bonuses.need ? 'text-[#ee9582]' : ''}>Bonus pool: {c.bonuses.have}/{c.bonuses.need}</span>
      </div>
    </div>
  );
}

function QuestionRow({ x, onView, reload }: { x: BankQuestion; onView: () => void; reload: () => Promise<void> }) {
  const { can, confirm } = useConsole();
  const { run, busy } = useRun();
  const advance = async (to: 'REVIEWED' | 'PUBLISHED' | 'ARCHIVED') => {
    if (to !== 'REVIEWED' && !(await confirm({ title: `${to === 'PUBLISHED' ? 'Publish' : 'Archive'} ${x.key} v${x.version_no}`, tone: to === 'PUBLISHED' ? 'primary' : 'danger', effects: to === 'PUBLISHED' ? ['Becomes eligible for slot plans and manual releases.', 'Published versions are immutable (edit via a new draft).'] : ['The version is withdrawn from future plans.'], confirmLabel: to === 'PUBLISHED' ? 'Publish' : 'Archive' }))) return;
    if (await run(`${x.id}-${to}`, () => api.post(`${V1}/admin/question-versions/${x.version_id}/status`, { to }), `${x.key} → ${to}.`)) void reload();
  };
  return (
    <tr className={TR}>
      <td className={`${TD} font-mono`}>{x.key}{x.is_demo && <span className="ml-1 text-[9px] text-muted">demo</span>}</td>
      <td className={TD}>{x.title}</td>
      <td className={TD}>{x.domain}</td>
      <td className={TD}>{x.pool}</td>
      <td className={TD}>{x.difficulty}</td>
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
              <Block label="HINT">{v.hint}</Block>
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
  domain: 'misc',
  pool: 'REGULAR',
  title: 'New question title',
  difficulty: 'EASY',
  statement: 'Describe the bug and what the crew must find or fix (at least 20 characters).',
  workspace: 'MISC',
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
      <Notice>Domains: web, data, ds, basic, design, misc · workspaces WEB/DATA/DS/BASIC/DESIGN/MISC · validation modes EXACT_TEXT, NUMERIC (answer, tolerance) or CODE_TESTS (language, entry, tests[]). New questions are DRAFTs — review and publish them explicitly.</Notice>
      <textarea className="input mt-3 min-h-[420px] font-mono text-[11px]" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} aria-label="Question JSON" />
      <div className="mt-3 flex justify-end gap-2">
        <Button secondary className={SMALL} onClick={onClose}>Cancel</Button>
        <Button className={SMALL} disabled={!!busy} onClick={() => void submit()}>Create draft</Button>
      </div>
    </Modal>
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
