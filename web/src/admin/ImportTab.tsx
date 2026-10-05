/**
 * Team import wizard: template download → upload CSV/XLSX → column mapping →
 * preview (summary, capacity, per-row actions and errors) → explicit commit.
 * Importing never sends credentials.
 */
import { Download, Upload } from 'lucide-react';
import { useState } from 'react';
import { V1, api } from '../lib/api';
import { Badge, Button, Label, StatePanel } from '../components/ui';
import { CARD, DataTable, ExportLink, Notice, SMALL, SUBCARD, SectionHead, Segmented, TD, TR, errText, readFileBase64, useConsole, useRun } from './kit';
import { REQUIRED_IMPORT_COLUMNS, TEAM_IMPORT_COLUMNS } from './types';

interface ImportRow { row: number; action: 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'ERROR'; crewId: string | null; teamName: string | null; captainEmail: string | null; members: number; slot: number | null; accountEnabled: boolean | null; changes: string[]; errors: string[] }
interface ImportPreview {
  batchId: string;
  header: string[];
  mapping: Record<string, string>;
  summary: {
    rows: number; create: number; update: number; unchanged: number; errors: number; unassigned: number; missingColumns: string[];
    capacity: { slot: number; name: string; capacity: number; after: number }[]; overCapacity: string[];
  };
  rows: ImportRow[];
}
interface CommitResult { created: number; updated: number; unchanged: number; createdCrewIds: string[]; updatedCrewIds: string[]; alreadyCommitted?: boolean }

export function ImportTab() {
  const { confirm } = useConsole();
  const { run, busy } = useRun();
  const [file, setFile] = useState<{ name: string; b64: string } | null>(null);
  const [pv, setPv] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'ERROR' | 'CREATE' | 'UPDATE' | 'UNCHANGED'>('ALL');

  const preview = async (f: { name: string; b64: string }, map?: Record<string, string>) => {
    setLoading(true);
    setErr(null);
    setResult(null);
    try {
      const clean = map ? Object.fromEntries(Object.entries(map).filter(([, v]) => v)) : undefined;
      const r = await api.post<ImportPreview>(`${V1}/admin/teams/imports`, { fileName: f.name, contentBase64: f.b64, mapping: clean });
      setPv(r);
      setMapping(r.mapping);
    } catch (e) {
      setErr(errText(e));
      setPv(null);
    } finally {
      setLoading(false);
    }
  };
  const onFile = async (fl: File | undefined) => {
    if (!fl) return;
    if (!/\.(csv|xlsx|txt)$/i.test(fl.name)) {
      setErr('Upload a .csv or .xlsx file.');
      return;
    }
    try {
      const f = { name: fl.name, b64: await readFileBase64(fl) };
      setFile(f);
      setPv(null);
      await preview(f);
    } catch (e) {
      setErr(errText(e));
    }
  };
  const commit = async () => {
    if (!pv) return;
    const ok = await confirm({
      title: `Commit import of ${file?.name}`,
      tone: 'warning',
      effects: [`${pv.summary.create} crew(s) created, ${pv.summary.update} updated, ${pv.summary.unchanged} unchanged.`, 'Rows are re-validated against current data at commit time.', 'No credentials are sent — use CREDENTIALS afterwards.'],
      confirmLabel: 'Commit import',
    });
    if (!ok) return;
    const r = await run('commit', () => api.post<CommitResult>(`${V1}/admin/teams/imports/${pv.batchId}/commit`, {}), (x) => (x.alreadyCommitted ? 'This preview was already committed.' : `Import committed: ${x.created} created, ${x.updated} updated.`));
    if (r) setResult(r);
  };

  const s = pv?.summary;
  const canCommit = !!pv && !!s && s.errors === 0 && s.missingColumns.length === 0 && s.overCapacity.length === 0 && s.create + s.update > 0 && !result;
  const mappingChanged = pv && JSON.stringify(Object.fromEntries(Object.entries(mapping).filter(([, v]) => v))) !== JSON.stringify(pv.mapping);

  return (
    <div className="space-y-6">
      <div className={CARD}>
        <SectionHead label="STEP 1" title="Download a template">
          <ExportLink href={`${V1}/admin/teams/import-template?format=csv`}><Download size={11} /> CSV template</ExportLink>
          <ExportLink href={`${V1}/admin/teams/import-template?format=xlsx`}><Download size={11} /> XLSX template</ExportLink>
        </SectionHead>
        <p className="text-[11px] leading-5 text-muted">One row per crew: team_name, optional crew_id (CRW-###), captain_email, 3–4 members (member1 is the captain), optional slot (1–4), account_enabled, checked_in. Existing crews are matched by crew ID, then captain email.</p>
      </div>

      <div className={CARD}>
        <SectionHead label="STEP 2" title="Upload CSV / XLSX">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border-2 border-[#b3f3d9] bg-[#8ae4cf] px-3 py-2 font-display text-[9px] font-bold text-[#14342f]">
            <Upload size={12} /> Choose file
            <input type="file" accept=".csv,.xlsx,.txt" className="sr-only" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </SectionHead>
        {file && <div className="text-xs">File: <span className="font-mono">{file.name}</span></div>}
        {loading && <StatePanel kind="loading" title="Parsing and validating…" />}
        {err && <div className="mt-3"><Notice tone="danger">{err}</Notice></div>}
        {!file && !err && <p className="text-[11px] text-muted">Nothing is written until you commit. Previewing only stores an import draft.</p>}
      </div>

      {pv && s && (
        <>
          <div className={CARD}>
            <SectionHead label="STEP 3" title="Column mapping">
              <Button secondary className={SMALL} disabled={!mappingChanged || loading} onClick={() => file && void preview(file, mapping)}>Re-preview with mapping</Button>
            </SectionHead>
            {s.missingColumns.length > 0 && <div className="mb-3"><Notice tone="danger">Required columns not found: {s.missingColumns.join(', ')}. Map them to a file column and re-preview.</Notice></div>}
            <p className="mb-3 text-[10px] text-muted">Auto-detected columns can be re-pointed to another file column; leaving one empty keeps the auto-detection.</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {TEAM_IMPORT_COLUMNS.map((c) => (
                <label key={c} className="flex items-center gap-2 text-[11px]">
                  <span className={`w-40 shrink-0 font-mono ${REQUIRED_IMPORT_COLUMNS.includes(c) ? 'text-[#e8cf8e]' : 'text-muted'}`}>{c}{REQUIRED_IMPORT_COLUMNS.includes(c) ? ' *' : ''}</span>
                  <select className="input !py-1 text-[11px]" aria-label={`Map ${c}`} value={mapping[c] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [c]: e.target.value }))}>
                    <option value="">— not mapped —</option>
                    {pv.header.map((h, i) => <option key={`${h}-${i}`} value={h.trim()}>{h || `(column ${i + 1})`}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className={CARD}>
            <SectionHead label="STEP 4" title="Preview">
              <Badge>{`${s.rows} ROWS`}</Badge>
            </SectionHead>
            <div className="mb-4 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
              {([['CREATE', s.create], ['UPDATE', s.update], ['UNCHANGED', s.unchanged], ['ERRORS', s.errors], ['UNASSIGNED', s.unassigned], ['OVER CAPACITY', s.overCapacity.length]] as const).map(([k, v]) => (
                <div key={k} className={`rounded-lg border px-2 py-2 ${k === 'ERRORS' && v ? 'border-[#9d635a] bg-[#442b34]' : 'border-[#344d5b] bg-[#112a35]'}`}>
                  <div className="font-mono text-sm text-[#e8cf8e]">{v}</div>
                  <div className="font-mono text-[8px] text-muted">{k}</div>
                </div>
              ))}
            </div>
            {s.capacity.length > 0 && (
              <div className={`${SUBCARD} mb-4`}>
                <Label className="mb-2">CAPACITY PER SLOT AFTER IMPORT</Label>
                <div className="flex flex-wrap gap-3 text-xs">
                  {s.capacity.map((c) => <span key={c.slot} className={c.after > c.capacity ? 'text-[#ee9582]' : ''}>{c.name}: {c.after}/{c.capacity}</span>)}
                </div>
                {s.overCapacity.length > 0 && <div className="mt-2"><Notice tone="danger">Over capacity: {s.overCapacity.join(', ')}. Raise the slot capacity or change assignments.</Notice></div>}
              </div>
            )}
            <div className="mb-3">
              <Segmented label="Row filter" value={filter} onChange={setFilter} options={(['ALL', 'ERROR', 'CREATE', 'UPDATE', 'UNCHANGED'] as const).map((x) => ({ value: x, label: x }))} />
            </div>
            <DataTable head={['ROW', 'ACTION', 'CREW', 'TEAM', 'CAPTAIN EMAIL', 'MEMBERS', 'SLOT', 'ENABLED', 'CHANGES', 'ERRORS']}>
              {pv.rows.filter((r) => filter === 'ALL' || r.action === filter).map((r) => (
                <tr key={r.row} className={TR}>
                  <td className={`${TD} font-mono`}>{r.row}</td>
                  <td className={TD}><Badge>{r.action}</Badge></td>
                  <td className={`${TD} font-mono`}>{r.crewId ?? 'new'}</td>
                  <td className={TD}>{r.teamName ?? '—'}</td>
                  <td className={TD}>{r.captainEmail ?? '—'}</td>
                  <td className={`${TD} font-mono`}>{r.members || '—'}</td>
                  <td className={TD}>{r.slot ?? '—'}</td>
                  <td className={TD}>{r.accountEnabled === null ? '—' : r.accountEnabled ? 'yes' : 'no'}</td>
                  <td className={`${TD} max-w-[220px] whitespace-normal`}>{r.changes.join(', ')}</td>
                  <td className={`${TD} max-w-[320px] whitespace-normal text-[#f3b399]`}>{r.errors.map((e, i) => <div key={i}>{e}</div>)}</td>
                </tr>
              ))}
            </DataTable>
          </div>

          <div className={CARD}>
            <SectionHead label="STEP 5" title="Commit">
              <Button className={SMALL} disabled={!canCommit || !!busy} onClick={() => void commit()}>Commit import</Button>
            </SectionHead>
            {!canCommit && !result && <Notice tone="warn">Commit is available only when there are no row errors, no missing columns, no over-capacity slots and at least one create or update.</Notice>}
            {result && (
              <div className="space-y-2 text-xs">
                <Notice>{result.alreadyCommitted ? 'Already committed earlier — result:' : 'Committed.'} {result.created} created, {result.updated} updated, {result.unchanged} unchanged. No credentials were sent.</Notice>
                {result.createdCrewIds.length > 0 && <div>Created: <span className="font-mono">{result.createdCrewIds.join(', ')}</span></div>}
                {result.updatedCrewIds.length > 0 && <div>Updated: <span className="font-mono">{result.updatedCrewIds.join(', ')}</span></div>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
