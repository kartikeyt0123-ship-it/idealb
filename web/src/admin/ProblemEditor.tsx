/** Problem authoring form — mirrors server problemInputSchema (services/content.ts). */
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, api } from '../lib/api';
import { Button, Field, Label, useToast } from '../components/ui';
import { CARD, Check, Notice, NumInput, SMALL, SUBCARD, SectionHead, errText } from './kit';
import type { ProblemFile, ProblemVersionDetail } from './types';

export const DOMAINS = ['web', 'data', 'ds', 'basic', 'design', 'misc'] as const;
const WORKSPACES = ['WEB', 'DATA', 'DS', 'BASIC', 'DESIGN', 'MISC'] as const;
const FILE_LANGS = ['javascript', 'python', 'html', 'css', 'text', 'csv', 'json', 'markdown'] as const;
const DIFF_DEFAULTS = { EASY: { reward: 150, hintCost: 30 }, MEDIUM: { reward: 400, hintCost: 80 }, HARD: { reward: 700, hintCost: 140 } } as const;
const DOMAIN_WORKSPACE: Record<string, string> = { web: 'WEB', data: 'DATA', ds: 'DS', basic: 'BASIC', design: 'DESIGN', misc: 'MISC' };

type Mode = 'EXACT_TEXT' | 'NUMERIC' | 'CODE_TESTS';
interface TestCase { name: string; stdin: string; expected: string }
interface NamedContent { name: string; content: string }

interface Form {
  domain: string;
  kind: 'REGULAR' | 'IMPOSTER';
  title: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  statement: string;
  workspace: string;
  runLanguage: '' | 'javascript' | 'python';
  runEntry: string;
  files: ProblemFile[];
  sampleStdin: string;
  answerFormat: string;
  mode: Mode;
  exactAnswer: string;
  caseSensitive: boolean;
  collapseWhitespace: boolean;
  numAnswer: string;
  tolerance: string;
  codeLanguage: 'javascript' | 'python';
  codeEntry: string;
  tests: TestCase[];
  harness: NamedContent[];
  hint: string;
  solutionExplanation: string;
  solutionFiles: NamedContent[];
  reward: string;
  hintCost: string;
}

const blank = (): Form => ({
  domain: 'basic', kind: 'REGULAR', title: '', difficulty: 'MEDIUM', statement: '', workspace: 'BASIC', runLanguage: 'python', runEntry: 'main.py',
  files: [{ name: 'main.py', language: 'python', content: '', readOnly: false }], sampleStdin: '', answerFormat: '', mode: 'CODE_TESTS',
  exactAnswer: '', caseSensitive: false, collapseWhitespace: true, numAnswer: '', tolerance: '0', codeLanguage: 'python', codeEntry: 'main.py',
  tests: [{ name: 'test-1', stdin: '', expected: '' }], harness: [], hint: '', solutionExplanation: '', solutionFiles: [], reward: '400', hintCost: '80',
});

function fromDetail(v: ProblemVersionDetail): Form {
  const f = blank();
  const val = v.validation ?? {};
  const mode = (val.mode as Mode) ?? 'EXACT_TEXT';
  return {
    ...f,
    domain: v.domain, kind: v.kind, title: v.title, difficulty: v.difficulty, statement: v.statement, workspace: v.workspace,
    runLanguage: v.run_language ?? '', runEntry: v.run_entry ?? '', files: (v.files ?? []).map((x) => ({ ...x, readOnly: !!x.readOnly })),
    sampleStdin: v.sample_stdin ?? '', answerFormat: v.answer_format, mode,
    exactAnswer: '', caseSensitive: !!val.caseSensitive, collapseWhitespace: val.collapseWhitespace !== false,
    numAnswer: typeof val.answer === 'number' ? String(val.answer) : '', tolerance: typeof val.tolerance === 'number' ? String(val.tolerance) : '0',
    codeLanguage: (val.language as 'javascript' | 'python') ?? 'python', codeEntry: typeof val.entry === 'string' ? val.entry : '',
    tests: Array.isArray(val.tests) ? (val.tests as TestCase[]).map((t) => ({ name: t.name ?? '', stdin: t.stdin ?? '', expected: t.expected ?? '' })) : [],
    harness: Array.isArray(val.harness) ? (val.harness as NamedContent[]) : [],
    hint: v.hint ?? '', solutionExplanation: v.solution?.explanation ?? '',
    solutionFiles: Object.entries(v.solution?.files ?? {}).map(([name, content]) => ({ name, content })),
    reward: String(v.reward), hintCost: String(v.hint_cost),
  };
}

function toPayload(f: Form): Record<string, unknown> {
  const validation =
    f.mode === 'EXACT_TEXT' ? { mode: 'EXACT_TEXT', ...(f.exactAnswer.trim() ? { answer: f.exactAnswer } : {}), caseSensitive: f.caseSensitive, collapseWhitespace: f.collapseWhitespace }
    : f.mode === 'NUMERIC' ? { mode: 'NUMERIC', answer: Number(f.numAnswer), tolerance: Number(f.tolerance || 0) }
    : { mode: 'CODE_TESTS', language: f.codeLanguage, entry: f.codeEntry, tests: f.tests, ...(f.harness.length ? { harness: f.harness } : {}) };
  return {
    domain: f.domain, kind: f.kind, title: f.title, difficulty: f.difficulty, statement: f.statement, workspace: f.workspace,
    runLanguage: f.runLanguage || null, runEntry: f.runLanguage ? f.runEntry || null : null,
    files: f.files.map((x) => ({ name: x.name, language: x.language, content: x.content, readOnly: !!x.readOnly })),
    sampleStdin: f.sampleStdin || null, answerFormat: f.answerFormat, validation, hint: f.hint, solutionExplanation: f.solutionExplanation,
    ...(f.solutionFiles.length ? { solutionFiles: Object.fromEntries(f.solutionFiles.map((s) => [s.name, s.content])) } : {}),
    reward: Number(f.reward), hintCost: Number(f.hintCost),
  };
}

function clientCheck(f: Form, isNew: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  if (f.title.trim().length < 3) e.title = 'Title needs at least 3 characters.';
  if (f.statement.trim().length < 20) e.statement = 'Statement needs at least 20 characters.';
  if (f.answerFormat.trim().length < 5) e.answerFormat = 'Answer format needs at least 5 characters.';
  if (f.hint.trim().length < 3) e.hint = 'Hint needs at least 3 characters.';
  if (!Number.isInteger(Number(f.reward)) || Number(f.reward) < 0) e.reward = 'Whole number ≥ 0.';
  if (!Number.isInteger(Number(f.hintCost)) || Number(f.hintCost) < 0) e.hintCost = 'Whole number ≥ 0.';
  f.files.forEach((x, i) => { if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(x.name)) e[`files.${i}.name`] = `File ${i + 1}: invalid name (letters, digits, _ . -).`; });
  if (f.mode === 'EXACT_TEXT' && isNew && !f.exactAnswer.trim()) e['validation.answer'] = 'Exact-text problems need an answer.';
  if (f.mode === 'NUMERIC' && (f.numAnswer.trim() === '' || !Number.isFinite(Number(f.numAnswer)))) e['validation.answer'] = 'Numeric answer required.';
  if (f.mode === 'CODE_TESTS') {
    if (!f.codeEntry.trim()) e['validation.entry'] = 'Entry file required.';
    if (f.tests.length < 1 || f.tests.length > 30) e['validation.tests'] = 'Provide 1–30 hidden tests.';
  }
  return e;
}

export function ProblemEditor({ version, onCancel, onSaved }: { version: ProblemVersionDetail | null; onCancel: () => void; onSaved: (versionId: string) => void }) {
  const toast = useToast();
  const isNew = !version;
  const [f, setF] = useState<Form>(() => (version ? fromDetail(version) : blank()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ce = clientCheck(f, isNew);
    setErrors(ce);
    if (Object.keys(ce).length) return toast('Fix the highlighted fields.', 'alert');
    setBusy(true);
    try {
      const body = toPayload(f);
      if (isNew) {
        const r = await api.post<{ problemId: string; versionId: string }>('/api/admin/problems', body);
        toast('Draft problem created.', 'good');
        onSaved(r.versionId);
      } else {
        const r = await api.put<{ versionId: string }>(`/api/admin/problem-versions/${version.id}`, body);
        toast('Draft saved.', 'good');
        onSaved(r.versionId);
      }
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      toast(errText(err), 'alert');
    } finally {
      setBusy(false);
    }
  };

  const err = (k: string) => errors[k];
  const errorList = Object.entries(errors);
  const fileRow = (x: ProblemFile, i: number) => (
    <div key={i} className="rounded-lg border border-[#344d5b] p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_160px_auto_auto] sm:items-end">
        <Field label={`FILE ${i + 1} NAME`} error={err(`files.${i}.name`)}>
          <input className="input !py-2 font-mono" value={x.name} onChange={(e) => set('files', f.files.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
        </Field>
        <Field label="LANGUAGE">
          <select className="input !py-2" value={x.language} onChange={(e) => set('files', f.files.map((y, j) => (j === i ? { ...y, language: e.target.value } : y)))}>
            {FILE_LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
        <div className="mb-4"><Check checked={!!x.readOnly} onChange={(v) => set('files', f.files.map((y, j) => (j === i ? { ...y, readOnly: v } : y)))} label="Read-only" /></div>
        <button type="button" aria-label={`Remove file ${i + 1}`} className="mb-4 p-2 text-[#eca291]" onClick={() => set('files', f.files.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
      </div>
      <label className="block">
        <span className="sr-only">File {i + 1} content</span>
        <textarea className="input min-h-[140px] font-mono text-[11px]" spellCheck={false} value={x.content} onChange={(e) => set('files', f.files.map((y, j) => (j === i ? { ...y, content: e.target.value } : y)))} />
      </label>
    </div>
  );

  return (
    <form className={CARD} onSubmit={submit} noValidate>
      <SectionHead label={isNew ? 'PROBLEM LIBRARY · NEW DRAFT' : `PROBLEM LIBRARY · EDIT DRAFT v${version.version_no}`} title={isNew ? 'Author a new problem' : version.title}>
        <Button secondary className={SMALL} onClick={onCancel}><ArrowLeft size={12} /> Back</Button>
      </SectionHead>
      {errorList.length > 0 && (
        <div className="mb-4"><Notice tone="danger"><b>Fix these fields:</b><ul className="mt-1 list-disc pl-5">{errorList.map(([k, m]) => <li key={k}><span className="font-mono">{k}</span>: {m}</li>)}</ul></Notice></div>
      )}

      <Section title="IDENTITY">
        <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="DOMAIN (ROOM)" hint={isNew ? undefined : 'Fixed after creation.'}>
            <select className="input" value={f.domain} disabled={!isNew} onChange={(e) => setF({ ...f, domain: e.target.value, workspace: DOMAIN_WORKSPACE[e.target.value] ?? f.workspace })}>
              {DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="KIND" hint={isNew ? undefined : 'Fixed after creation.'}>
            <select className="input" value={f.kind} disabled={!isNew} onChange={(e) => set('kind', e.target.value as Form['kind'])}>
              <option value="REGULAR">REGULAR task</option>
              <option value="IMPOSTER">IMPOSTER problem</option>
            </select>
          </Field>
          <Field label="DIFFICULTY">
            <select className="input" value={f.difficulty} onChange={(e) => {
              const d = e.target.value as Form['difficulty'];
              setF({ ...f, difficulty: d, ...(isNew ? { reward: String(DIFF_DEFAULTS[d].reward), hintCost: String(DIFF_DEFAULTS[d].hintCost) } : {}) });
            }}>
              {(['EASY', 'MEDIUM', 'HARD'] as const).map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="WORKSPACE">
            <select className="input" value={f.workspace} onChange={(e) => set('workspace', e.target.value)}>
              {WORKSPACES.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </Field>
        </div>
        <Field label="TITLE" error={err('title')}>
          <input className="input" value={f.title} maxLength={120} aria-invalid={!!err('title')} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label="STATEMENT (MARKDOWN-ISH TEXT, MIN 20 CHARACTERS)" error={err('statement')}>
          <textarea className="input min-h-[160px]" value={f.statement} aria-invalid={!!err('statement')} onChange={(e) => set('statement', e.target.value)} />
        </Field>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="REWARD" error={err('reward')}><NumInput value={f.reward} onChange={(v) => set('reward', v)} min={0} ariaLabel="Reward" /></Field>
          <Field label="HINT COST" error={err('hintCost')}><NumInput value={f.hintCost} onChange={(v) => set('hintCost', v)} min={0} ariaLabel="Hint cost" /></Field>
        </div>
      </Section>

      <Section title="WORKSPACE FILES & RUN">
        <div className="grid gap-x-4 sm:grid-cols-3">
          <Field label="RUN LANGUAGE">
            <select className="input" value={f.runLanguage} onChange={(e) => set('runLanguage', e.target.value as Form['runLanguage'])}>
              <option value="">None (no Run button)</option>
              <option value="javascript">javascript</option>
              <option value="python">python</option>
            </select>
          </Field>
          <Field label="RUN ENTRY FILE">
            <input className="input font-mono" value={f.runEntry} disabled={!f.runLanguage} onChange={(e) => set('runEntry', e.target.value)} />
          </Field>
          <Field label="SAMPLE STDIN">
            <textarea className="input min-h-[46px] font-mono text-[11px]" value={f.sampleStdin} onChange={(e) => set('sampleStdin', e.target.value)} />
          </Field>
        </div>
        <div className="space-y-3">{f.files.map(fileRow)}</div>
        <Button secondary className={`${SMALL} mt-3`} disabled={f.files.length >= 12} onClick={() => set('files', [...f.files, { name: `file${f.files.length + 1}.txt`, language: 'text', content: '', readOnly: false }])}><Plus size={12} /> Add file</Button>
      </Section>

      <Section title="ANSWER & VALIDATION (PRIVATE)">
        <Field label="ANSWER FORMAT SHOWN TO CREWS" error={err('answerFormat')}>
          <input className="input" value={f.answerFormat} aria-invalid={!!err('answerFormat')} onChange={(e) => set('answerFormat', e.target.value)} placeholder="e.g. Submit the fixed program; it must print the total on one line." />
        </Field>
        <Field label="VALIDATION MODE">
          <select className="input" value={f.mode} onChange={(e) => set('mode', e.target.value as Mode)}>
            <option value="EXACT_TEXT">EXACT_TEXT — typed answer, compared after normalization</option>
            <option value="NUMERIC">NUMERIC — number within tolerance</option>
            <option value="CODE_TESTS">CODE_TESTS — submitted code runs hidden tests</option>
          </select>
        </Field>
        {f.mode === 'EXACT_TEXT' && (
          <div className={SUBCARD}>
            <Field label="CORRECT ANSWER" error={err('validation.answer')} hint={isNew ? 'Stored only as a keyed hash.' : 'Stored only as a keyed hash — leave blank to keep the existing answer.'}>
              <input className="input font-mono" value={f.exactAnswer} onChange={(e) => set('exactAnswer', e.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-4">
              <Check checked={f.caseSensitive} onChange={(v) => set('caseSensitive', v)} label="Case sensitive" />
              <Check checked={f.collapseWhitespace} onChange={(v) => set('collapseWhitespace', v)} label="Collapse whitespace" />
            </div>
          </div>
        )}
        {f.mode === 'NUMERIC' && (
          <div className={`${SUBCARD} grid gap-x-4 sm:grid-cols-2`}>
            <Field label="ANSWER" error={err('validation.answer')}><NumInput value={f.numAnswer} onChange={(v) => set('numAnswer', v)} step={0.000001} ariaLabel="Numeric answer" /></Field>
            <Field label="TOLERANCE (±)"><NumInput value={f.tolerance} onChange={(v) => set('tolerance', v)} min={0} step={0.000001} ariaLabel="Tolerance" /></Field>
          </div>
        )}
        {f.mode === 'CODE_TESTS' && (
          <div className={SUBCARD}>
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Field label="TEST LANGUAGE">
                <select className="input" value={f.codeLanguage} onChange={(e) => set('codeLanguage', e.target.value as Form['codeLanguage'])}>
                  <option value="python">python</option>
                  <option value="javascript">javascript</option>
                </select>
              </Field>
              <Field label="ENTRY FILE" error={err('validation.entry')}><input className="input font-mono" value={f.codeEntry} onChange={(e) => set('codeEntry', e.target.value)} /></Field>
            </div>
            <Label className="mb-2">HIDDEN TESTS ({f.tests.length}/30)</Label>
            {err('validation.tests') && <p role="alert" className="mb-2 text-[11px] text-[#f3b399]">{err('validation.tests')}</p>}
            <div className="space-y-2">
              {f.tests.map((t, i) => (
                <div key={i} className="grid gap-2 rounded-lg border border-[#344d5b] p-2 sm:grid-cols-[140px_1fr_1fr_auto]">
                  <label className="text-xs"><span className="mb-1 block font-mono text-[9px] text-[#b3c4c8]">NAME</span><input className="input !py-1.5 font-mono" value={t.name} maxLength={60} onChange={(e) => set('tests', f.tests.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} /></label>
                  <label className="text-xs"><span className="mb-1 block font-mono text-[9px] text-[#b3c4c8]">STDIN</span><textarea className="input min-h-[60px] font-mono text-[11px]" value={t.stdin} onChange={(e) => set('tests', f.tests.map((y, j) => (j === i ? { ...y, stdin: e.target.value } : y)))} /></label>
                  <label className="text-xs"><span className="mb-1 block font-mono text-[9px] text-[#b3c4c8]">EXPECTED STDOUT</span><textarea className="input min-h-[60px] font-mono text-[11px]" value={t.expected} onChange={(e) => set('tests', f.tests.map((y, j) => (j === i ? { ...y, expected: e.target.value } : y)))} /></label>
                  <button type="button" aria-label={`Remove test ${i + 1}`} className="self-center p-2 text-[#eca291]" onClick={() => set('tests', f.tests.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
            <Button secondary className={`${SMALL} mt-2`} disabled={f.tests.length >= 30} onClick={() => set('tests', [...f.tests, { name: `test-${f.tests.length + 1}`, stdin: '', expected: '' }])}><Plus size={12} /> Add test</Button>
            <Label className="mb-2 mt-4">HARNESS FILES (OPTIONAL, HIDDEN)</Label>
            <NamedList items={f.harness} onChange={(v) => set('harness', v)} addLabel="Add harness file" />
          </div>
        )}
      </Section>

      <Section title="HINT & PRIVATE SOLUTION">
        <Field label="HINT (BOUGHT BY CREWS)" error={err('hint')}>
          <textarea className="input min-h-[70px]" value={f.hint} onChange={(e) => set('hint', e.target.value)} />
        </Field>
        <Field label="SOLUTION EXPLANATION (PRIVATE)">
          <textarea className="input min-h-[90px]" value={f.solutionExplanation} onChange={(e) => set('solutionExplanation', e.target.value)} />
        </Field>
        <Label className="mb-2">SOLUTION FILES (PRIVATE · OVERRIDE STARTER FILES BY NAME · USED BY “VERIFY”)</Label>
        <NamedList items={f.solutionFiles} onChange={(v) => set('solutionFiles', v)} addLabel="Add solution file" />
      </Section>

      <div className="flex justify-end gap-2">
        <Button secondary onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Create draft' : 'Save draft'}</Button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="mb-5 rounded-lg border-2 border-[#395362] bg-[#142c38] p-4">
      <legend className="px-2 font-mono text-[9px] tracking-[.16em] text-[#9fb8bf]">{title}</legend>
      {children}
    </fieldset>
  );
}

function NamedList({ items, onChange, addLabel }: { items: NamedContent[]; onChange: (v: NamedContent[]) => void; addLabel: string }) {
  return (
    <div className="space-y-2">
      {items.map((x, i) => (
        <div key={i} className="rounded-lg border border-[#344d5b] p-2">
          <div className="mb-2 flex items-center gap-2">
            <label className="flex-1 text-xs"><span className="sr-only">File name</span><input className="input !py-1.5 font-mono" value={x.name} placeholder="file name" onChange={(e) => onChange(items.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} /></label>
            <button type="button" aria-label={`Remove ${x.name || 'file'}`} className="p-2 text-[#eca291]" onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
          </div>
          <label className="block"><span className="sr-only">{x.name} content</span><textarea className="input min-h-[110px] font-mono text-[11px]" spellCheck={false} value={x.content} onChange={(e) => onChange(items.map((y, j) => (j === i ? { ...y, content: e.target.value } : y)))} /></label>
        </div>
      ))}
      <Button secondary className={SMALL} onClick={() => onChange([...items, { name: '', content: '' }])}><Plus size={12} /> {addLabel}</Button>
    </div>
  );
}
