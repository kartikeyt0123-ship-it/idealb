/** Crew provisioning: single "Add crew" form and CSV / JSON import with client-side preview. */
import { ArrowLeft, Plus, Trash2, Upload } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { ApiError, CREW_COLORS, api } from '../lib/api';
import { Button, Crewmate, Field, Label, useToast } from '../components/ui';
import { CARD, Check, CopyButton, Notice, SMALL, SectionHead, TD, TH, THEAD, TR, errText, useConsole } from './kit';
import type { CreatedCrew } from './types';

interface MemberDraft {
  name: string;
  institution: string;
  year: string;
  branch: string;
  studentId?: string;
}

export interface CrewPayload {
  teamName: string;
  captainEmail: string;
  members: MemberDraft[];
  requestedDays: 'DAY1' | 'DAY2' | 'BOTH';
  color: string;
  activeDays: number[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEAM_NAME = /^[\p{L}\p{N} ._&-]+$/u;
const COLOR_HEX = new Set(CREW_COLORS.map(([, c]) => c.toLowerCase()));
const blankMember = (): MemberDraft => ({ name: '', institution: '', year: '', branch: '', studentId: '' });

/** Mirrors the server's adminCreateSchema so problems are visible before sending. */
export function validateCrew(p: CrewPayload): Record<string, string> {
  const e: Record<string, string> = {};
  const name = p.teamName.trim();
  if (name.length < 2 || name.length > 32) e.teamName = 'Team name must be 2-32 characters.';
  else if (!TEAM_NAME.test(name)) e.teamName = 'Team name may use letters, numbers, spaces and . _ & -';
  if (!EMAIL.test(p.captainEmail.trim())) e.captainEmail = 'Enter a valid email address.';
  if (p.members.length < 3 || p.members.length > 4) e.members = 'A crew needs 3 or 4 members (including the captain).';
  p.members.forEach((m, i) => {
    if (!m.name.trim()) e[`members.${i}.name`] = `Member ${i + 1}: name is required.`;
    if (!m.institution.trim()) e[`members.${i}.institution`] = `Member ${i + 1}: institution is required.`;
    if (!m.year.trim()) e[`members.${i}.year`] = `Member ${i + 1}: year is required.`;
    if (!m.branch.trim()) e[`members.${i}.branch`] = `Member ${i + 1}: branch is required.`;
  });
  if (!['DAY1', 'DAY2', 'BOTH'].includes(p.requestedDays)) e.requestedDays = 'Requested days must be DAY1, DAY2 or BOTH.';
  if (!COLOR_HEX.has(p.color.toLowerCase())) e.color = 'Choose a crewmate color from the palette.';
  if (p.activeDays.some((d) => d !== 1 && d !== 2)) e.activeDays = 'Active days may only contain 1 and 2.';
  return e;
}

function CreatedPasswords({ created, notice, onDone }: { created: CreatedCrew[]; notice: string; onDone: () => void }) {
  const all = ['crewId,teamName,email,temporaryPassword', ...created.map((c) => `${c.crewId},"${c.teamName}",${c.email},${c.temporaryPassword}`)].join('\n');
  return (
    <div className={`${CARD} !border-[#dfbd77]/70`} role="status">
      <SectionHead label="CREW IDENTITIES ISSUED" title={`${created.length} crew(s) created`}>
        <CopyButton text={all} label="Copy all (CSV)" />
        <Button className={SMALL} onClick={onDone}>Done — I saved them</Button>
      </SectionHead>
      <Notice tone="warn">{notice} These temporary passwords are shown ONCE and cannot be retrieved later.</Notice>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead className={THEAD}>
            <tr>{['CREW ID', 'TEAM', 'CAPTAIN EMAIL', 'TEMPORARY PASSWORD', ''].map((h) => <th key={h} className={TH} scope="col">{h}</th>)}</tr>
          </thead>
          <tbody>
            {created.map((c) => (
              <tr key={c.crewId} className={TR}>
                <td className={`${TD} font-mono`}>{c.crewId}</td>
                <td className={TD}>{c.teamName}</td>
                <td className={TD}>{c.email}</td>
                <td className={`${TD} select-all font-mono text-[#abe9df]`}>{c.temporaryPassword}</td>
                <td className={TD}><CopyButton text={c.temporaryPassword} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AddCrewForm({ onDone }: { onDone: () => void }) {
  const { overview } = useConsole();
  const toast = useToast();
  const [f, setF] = useState<CrewPayload>({ teamName: '', captainEmail: '', members: [blankMember(), blankMember(), blankMember()], requestedDays: 'BOTH', color: CREW_COLORS[0][1], activeDays: [] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ created: CreatedCrew[]; notice: string } | null>(null);

  if (done) return <CreatedPasswords created={done.created} notice={done.notice} onDone={onDone} />;

  const setMember = (i: number, k: keyof MemberDraft, v: string) => setF((x) => ({ ...x, members: x.members.map((m, j) => (j === i ? { ...m, [k]: v } : m)) }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validateCrew(f);
    setErrors(v);
    if (Object.keys(v).length) {
      toast('Fix the highlighted fields.', 'alert');
      return;
    }
    setBusy(true);
    try {
      const payload = { ...f, members: f.members.map((m) => ({ ...m, studentId: m.studentId?.trim() || undefined })) };
      const r = await api.post<{ created: CreatedCrew[]; notice: string }>('/api/admin/crews', { crews: [payload], via: 'ADMIN' });
      toast(`${r.created[0]?.crewId ?? 'Crew'} created.`, 'good');
      setDone(r);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      toast(errText(err), 'alert');
    } finally {
      setBusy(false);
    }
  };

  const err = (k: string) => errors[k];
  return (
    <form className={CARD} onSubmit={submit} noValidate>
      <SectionHead label="CREW MANIFEST · NEW IDENTITY" title="Add crew">
        <Button secondary className={SMALL} onClick={onDone}><ArrowLeft size={12} /> Back</Button>
      </SectionHead>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="TEAM NAME" error={err('teamName')}>
          <input className="input" value={f.teamName} aria-invalid={!!err('teamName')} onChange={(e) => setF({ ...f, teamName: e.target.value })} maxLength={32} />
        </Field>
        <Field label="CAPTAIN EMAIL" error={err('captainEmail')}>
          <input className="input" type="email" value={f.captainEmail} aria-invalid={!!err('captainEmail')} onChange={(e) => setF({ ...f, captainEmail: e.target.value })} />
        </Field>
      </div>

      <fieldset className="mb-4">
        <legend className="mb-2 font-mono text-[9px] tracking-widest text-[#b3c4c8]">CREW MEMBERS (3–4 · MEMBER 1 IS CAPTAIN)</legend>
        {err('members') && <p role="alert" className="mb-2 text-[11px] text-[#f3b399]">{err('members')}</p>}
        <div className="space-y-3">
          {f.members.map((m, i) => (
            <div key={i} className="rounded-lg border border-[#344d5b] p-3">
              <div className="mb-2 flex items-center justify-between">
                <Label>{i === 0 ? 'MEMBER 1 · CAPTAIN' : `MEMBER ${i + 1}`}</Label>
                {i === 3 && <button type="button" className="font-mono text-[10px] text-[#eca291] hover:underline" onClick={() => setF({ ...f, members: f.members.slice(0, 3) })}><Trash2 size={11} className="inline" /> Remove</button>}
              </div>
              <div className="grid gap-x-3 sm:grid-cols-2 lg:grid-cols-5">
                {(['name', 'institution', 'year', 'branch', 'studentId'] as const).map((k) => (
                  <Field key={k} label={k === 'studentId' ? 'STUDENT ID (OPTIONAL)' : k.toUpperCase()} error={err(`members.${i}.${k}`)}>
                    <input className="input !py-2" value={m[k] ?? ''} aria-invalid={!!err(`members.${i}.${k}`)} onChange={(e) => setMember(i, k, e.target.value)} />
                  </Field>
                ))}
              </div>
            </div>
          ))}
        </div>
        {f.members.length < 4 && (
          <Button secondary className={`${SMALL} mt-3`} onClick={() => setF({ ...f, members: [...f.members, blankMember()] })}><Plus size={12} /> Add 4th member</Button>
        )}
      </fieldset>

      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="REQUESTED DAYS" error={err('requestedDays')}>
          <select className="input" value={f.requestedDays} onChange={(e) => setF({ ...f, requestedDays: e.target.value as CrewPayload['requestedDays'] })}>
            <option value="DAY1">Day 1</option>
            <option value="DAY2">Day 2</option>
            <option value="BOTH">Both days</option>
          </select>
        </Field>
        <fieldset className="mb-4">
          <legend className="mb-2 font-mono text-[9px] tracking-widest text-[#b3c4c8]">ACTIVATE NOW FOR</legend>
          <div className="flex flex-wrap gap-4">
            {overview.days.map((d) => (
              <Check key={d.id} checked={f.activeDays.includes(d.day_number)} label={`Day ${d.day_number} — ${d.label}`}
                onChange={(v) => setF({ ...f, activeDays: v ? [...f.activeDays, d.day_number].sort() : f.activeDays.filter((x) => x !== d.day_number) })} />
            ))}
          </div>
          <span className="mt-1 block text-[10px] text-[#8eabb4]">Leave unticked to keep the crew pending until you activate it.</span>
        </fieldset>
      </div>

      <fieldset className="mb-5">
        <legend className="mb-2 font-mono text-[9px] tracking-widest text-[#b3c4c8]">CREWMATE COLOR</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Crewmate color">
          {CREW_COLORS.map(([name, hex]) => (
            <button key={hex} type="button" role="radio" aria-checked={f.color === hex} aria-label={name} title={name} onClick={() => setF({ ...f, color: hex })}
              className={`rounded-lg border-2 p-1 ${f.color === hex ? 'border-primary bg-[#1d4450]' : 'border-transparent hover:border-[#52717e]'}`}>
              <Crewmate color={hex} size={30} state="still" />
            </button>
          ))}
        </div>
        {err('color') && <p role="alert" className="mt-1 text-[11px] text-[#f3b399]">{err('color')}</p>}
      </fieldset>

      <div className="flex justify-end gap-2">
        <Button secondary onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Issuing identity…' : 'Create crew'}</Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const CSV_HEADER = 'teamName,captainEmail,requestedDays,color,activeDays,member1Name,member1Institution,member1Year,member1Branch,member2Name,member2Institution,member2Year,member2Branch,member3Name,member3Institution,member3Year,member3Branch,member4Name,member4Institution,member4Year,member4Branch';

/** RFC-4180-ish CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

function normColor(v: unknown): string {
  const s = String(v ?? '').trim();
  const byName = CREW_COLORS.find(([n]) => n.toLowerCase() === s.toLowerCase());
  if (byName) return byName[1];
  const byHex = CREW_COLORS.find(([, h]) => h.toLowerCase() === s.toLowerCase());
  return byHex ? byHex[1] : s;
}
function normDays(v: unknown): number[] {
  if (Array.isArray(v)) return v.map(Number).filter((n) => Number.isFinite(n));
  return String(v ?? '').split(/[;|\s/+]+|,/).map((x) => x.trim().replace(/^day/i, '')).filter(Boolean).map(Number);
}
function normRequested(v: unknown): CrewPayload['requestedDays'] {
  const s = String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (s === '1' || s === 'DAY1') return 'DAY1';
  if (s === '2' || s === 'DAY2') return 'DAY2';
  if (s === 'BOTH' || s === '1;2' || s === '1+2' || s === '12') return 'BOTH';
  return s as CrewPayload['requestedDays'];
}

function fromFlat(r: Record<string, unknown>): CrewPayload {
  const members: MemberDraft[] = [];
  for (let i = 1; i <= 4; i++) {
    const m = { name: String(r[`member${i}Name`] ?? '').trim(), institution: String(r[`member${i}Institution`] ?? '').trim(), year: String(r[`member${i}Year`] ?? '').trim(), branch: String(r[`member${i}Branch`] ?? '').trim() };
    if (m.name || m.institution || m.year || m.branch) members.push(m);
  }
  return { teamName: String(r.teamName ?? '').trim(), captainEmail: String(r.captainEmail ?? '').trim(), members, requestedDays: normRequested(r.requestedDays), color: normColor(r.color), activeDays: normDays(r.activeDays) };
}

function fromObject(o: Record<string, unknown>): CrewPayload {
  if (!Array.isArray(o.members)) return fromFlat(o);
  return {
    teamName: String(o.teamName ?? '').trim(),
    captainEmail: String(o.captainEmail ?? '').trim(),
    members: (o.members as Record<string, unknown>[]).map((m) => ({ name: String(m.name ?? '').trim(), institution: String(m.institution ?? '').trim(), year: String(m.year ?? '').trim(), branch: String(m.branch ?? '').trim(), ...(m.studentId ? { studentId: String(m.studentId) } : {}) })),
    requestedDays: normRequested(o.requestedDays),
    color: normColor(o.color),
    activeDays: normDays(o.activeDays ?? []),
  };
}

interface ParsedImport {
  rows: { payload: CrewPayload; errors: string[] }[];
  fatal: string | null;
}

function parseImport(text: string): ParsedImport {
  const r = parseImportRaw(text);
  const names = new Map<string, number>();
  const emails = new Map<string, number>();
  r.rows.forEach((row, i) => {
    const n = row.payload.teamName.toLowerCase();
    const e = row.payload.captainEmail.toLowerCase();
    if (n && names.has(n)) row.errors.push(`Duplicate team name (also row ${(names.get(n) ?? 0) + 1}).`);
    else names.set(n, i);
    if (e && emails.has(e)) row.errors.push(`Duplicate captain email (also row ${(emails.get(e) ?? 0) + 1}).`);
    else emails.set(e, i);
  });
  if (r.rows.length > 300) r.fatal = 'At most 300 crews per import.';
  return r;
}

function parseImportRaw(text: string): ParsedImport {
  const t = text.trim();
  if (!t) return { rows: [], fatal: null };
  if (t.startsWith('[') || t.startsWith('{')) {
    try {
      const j = JSON.parse(t) as unknown;
      const arr = Array.isArray(j) ? j : (j as { crews?: unknown }).crews;
      if (!Array.isArray(arr)) return { rows: [], fatal: 'JSON must be an array of crews (or { "crews": [...] }).' };
      return { rows: arr.map((o) => check(fromObject((o ?? {}) as Record<string, unknown>))), fatal: null };
    } catch (e) {
      return { rows: [], fatal: `Invalid JSON: ${(e as Error).message}` };
    }
  }
  const grid = parseCsv(t);
  if (grid.length < 2) return { rows: [], fatal: 'CSV needs a header row and at least one crew row.' };
  const header = grid[0].map((h) => h.trim());
  for (const req of ['teamName', 'captainEmail', 'requestedDays', 'color', 'member1Name']) {
    if (!header.includes(req)) return { rows: [], fatal: `CSV header is missing "${req}". Expected: ${CSV_HEADER}` };
  }
  return {
    rows: grid.slice(1).map((cells) => check(fromFlat(Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']))))),
    fatal: null,
  };
}

function check(p: CrewPayload) {
  return { payload: p, errors: Object.values(validateCrew(p)) };
}

export function ImportCrews({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: CreatedCrew[]; notice: string } | null>(null);
  const parsed = useMemo(() => parseImport(text), [text]);
  const bad = parsed.rows.filter((r) => r.errors.length).length;

  if (done) return <CreatedPasswords created={done.created} notice={done.notice} onDone={onDone} />;

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) return toast('File too large (max 2 MB).', 'alert');
    setText(await file.text());
    setServerError(null);
  };

  const submit = async () => {
    setBusy(true);
    setServerError(null);
    try {
      const r = await api.post<{ created: CreatedCrew[]; notice: string }>('/api/admin/crews', { crews: parsed.rows.map((x) => x.payload), via: 'IMPORT' });
      toast(`${r.created.length} crew(s) imported.`, 'good');
      setDone(r);
    } catch (e) {
      const msg = errText(e);
      setServerError(msg);
      toast(msg, 'alert');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={CARD}>
      <SectionHead label="CREW MANIFEST · BULK IMPORT" title="Import crews (CSV or JSON)">
        <Button secondary className={SMALL} onClick={onDone}><ArrowLeft size={12} /> Back</Button>
      </SectionHead>
      <Notice>
        Paste CSV with header <code className="break-all font-mono text-[10px] text-primary">{CSV_HEADER}</code> — or a JSON array of crews
        (<code className="font-mono text-[10px]">{'{ teamName, captainEmail, members:[{name,institution,year,branch}], requestedDays, color, activeDays:[1,2] }'}</code>).
        requestedDays = DAY1 | DAY2 | BOTH; color = palette name (Cyan, Red…) or hex; activeDays like <code className="font-mono">1;2</code>. The import is all-or-nothing.
      </Notice>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border-2 border-[#52717e] bg-[#2d4654] px-3 py-2 font-display text-[9px] font-bold text-[#d6e1e1]">
          <Upload size={12} /> Load file
          <input type="file" accept=".csv,.json,text/csv,application/json,text/plain" className="sr-only" onChange={(e) => void loadFile(e.target.files?.[0])} />
        </label>
        <button type="button" className="font-mono text-[10px] text-[#e6c887] hover:underline" onClick={() => setText(`${CSV_HEADER}\nNull Pointers,captain@example.edu,BOTH,Cyan,1,Asha Rao,SGSITS,3,CSE,Vikram Jain,SGSITS,3,IT,Meera Shah,SGSITS,2,ECE,,,,`)}>Insert example row</button>
      </div>
      <label className="mt-3 block">
        <span className="mb-2 block font-mono text-[9px] tracking-widest text-[#b3c4c8]">IMPORT DATA</span>
        <textarea className="input min-h-[160px] font-mono text-[11px]" value={text} spellCheck={false} onChange={(e) => { setText(e.target.value); setServerError(null); }} placeholder={CSV_HEADER} />
      </label>

      {parsed.fatal && <div className="mt-3"><Notice tone="danger">{parsed.fatal}</Notice></div>}
      {serverError && <div className="mt-3"><Notice tone="danger">Server rejected the import (nothing was created): {serverError}</Notice></div>}

      {parsed.rows.length > 0 && (
        <div className="mt-4">
          <Label className="mb-2">PREVIEW · {parsed.rows.length} ROW(S) · {bad ? `${bad} WITH ERRORS` : 'ALL VALID'}</Label>
          <div className="max-h-[360px] overflow-auto rounded-lg border border-[#344d5b]">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className={THEAD}>
                <tr>{['ROW', 'TEAM', 'CAPTAIN EMAIL', 'MEMBERS', 'REQUESTED', 'ACTIVE DAYS', 'COLOR', 'CHECK'].map((h) => <th key={h} className={TH} scope="col">{h}</th>)}</tr>
              </thead>
              <tbody>
                {parsed.rows.map((r, i) => (
                  <tr key={i} className={`${TR} ${r.errors.length ? 'bg-[#442b34]/50' : ''}`}>
                    <td className={`${TD} font-mono`}>{i + 1}</td>
                    <td className={TD}>{r.payload.teamName || '—'}</td>
                    <td className={TD}>{r.payload.captainEmail || '—'}</td>
                    <td className={TD}>{r.payload.members.map((m) => m.name).filter(Boolean).join(', ') || '—'}</td>
                    <td className={`${TD} font-mono`}>{r.payload.requestedDays || '—'}</td>
                    <td className={`${TD} font-mono`}>{r.payload.activeDays.join(', ') || 'pending'}</td>
                    <td className={TD}>{COLOR_HEX.has(r.payload.color.toLowerCase()) ? <Crewmate color={r.payload.color} size={20} state="still" /> : <span className="font-mono text-[10px]">{r.payload.color || '—'}</span>}</td>
                    <td className={TD}>
                      {r.errors.length ? <ul className="space-y-0.5 text-[10px] text-[#f3b399]">{r.errors.map((e) => <li key={e}>{e}</li>)}</ul> : <span className="font-mono text-[10px] text-primary">OK</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button secondary onClick={onDone}>Cancel</Button>
        <Button disabled={busy || !parsed.rows.length || bad > 0 || parsed.rows.length > 300} onClick={() => void submit()}>
          {busy ? 'Importing…' : `Import ${parsed.rows.length} crew(s)`}
        </Button>
      </div>
    </div>
  );
}
