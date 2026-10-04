import { ArrowDown, ArrowUp, Trophy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { Badge, Button, Crewmate, Field, Label } from '../components/ui';
import { CARD, COIN_TEXT, Empty, LINK, Loadable, Notice, RED_CARD, SectionHead, TD, TH, THEAD, TR, fmtTime, useAdminData, useConsole, useRun } from './kit';
import type { AdminGame, CrewList, EliminationReview, ResultsReview, ReviewRow } from './types';

type TieMode = 'RETAIN_TIED' | 'ELIMINATE_TIED' | 'MANUAL_TIEBREAK';

export function EliminationTab() {
  const { overview } = useConsole();
  return (
    <div className="space-y-6">
      {overview.games.map((g) => (
        <section key={g.id} aria-label={`Game ${g.number} review`}>
          {g.phase === 'ELIMINATION_REVIEW' ? <EliminationPanel key={`${g.id}-${g.version}`} game={g} />
            : g.phase === 'GAME_RESULT_REVIEW' ? <ResultsPanel key={`${g.id}-${g.version}`} game={g} />
            : (
              <div className={CARD}>
                <Label>GAME {g.number} · {g.phase.replace(/_/g, ' ')}</Label>
                <p className="mt-2 text-xs text-muted">
                  {g.phase === 'COMPLETED' ? `Results confirmed ${fmtTime(g.result?.confirmed_at)}. See RANKINGS & REWARDS.` : 'No elimination or results review is pending. Reviews open automatically when a sprint closes.'}
                </p>
              </div>
            )}
        </section>
      ))}
      <DisqualificationHistory />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Elimination review
// ---------------------------------------------------------------------------

function EliminationPanel({ game }: { game: AdminGame }) {
  const state = useAdminData<EliminationReview>(`/api/admin/games/${game.id}/elimination`);
  return <Loadable state={state} title={`Game ${game.number} elimination review`}>{(r) => <EliminationBody game={game} r={r} />}</Loadable>;
}

function EliminationBody({ game, r }: { game: AdminGame; r: EliminationReview }) {
  const { confirm, can } = useConsole();
  const { busy, run } = useRun();
  const tie = r.preview.tie;
  const [mode, setMode] = useState<TieMode>('RETAIN_TIED');
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState('');

  const byId = useMemo(() => new Map(r.rows.map((x) => [x.enrollmentId, x])), [r.rows]);
  const eliminated: string[] = !tie ? r.preview.proposed
    : mode === 'RETAIN_TIED' ? tie.strictlyBelow
    : mode === 'ELIMINATE_TIED' ? [...tie.strictlyBelow, ...tie.tiedEnrollmentIds]
    : [...tie.strictlyBelow, ...picked];
  const survivors = r.rows.length - eliminated.length;
  const manualOk = mode !== 'MANUAL_TIEBREAK' || picked.length === (tie?.needFromTie ?? 0);
  const noteOk = !tie || note.trim().length >= 8;
  const finalOk = !r.finalSprint || survivors >= Math.min(r.rows.length, Math.max(1, r.prizePlaces));
  const ready = manualOk && noteOk && survivors >= (r.rows.length ? 1 : 0) && finalOk;

  const submit = async () => {
    const names = eliminated.map((id) => { const x = byId.get(id); return x ? `${x.name} (${x.crewId}, ${x.score})` : id; });
    const ok = await confirm({
      title: `Confirm Sprint ${r.sprint} eliminations`,
      effects: [
        `${r.rows.length} active → eliminate ${eliminated.length} → ${survivors} survive.`,
        eliminated.length ? `EJECTED: ${names.join('; ')}.` : 'Nobody is ejected.',
        ...(tie ? [`Tie at score ${tie.score} resolved by ${mode.replace(/_/g, ' ')} — published note: "${note.trim()}"`] : []),
        r.finalSprint ? 'Final standings move to RESULTS REVIEW.' : 'The game enters the waiting room. Sprint 2 never starts automatically.',
        'This cannot be undone.',
      ],
      confirmLabel: 'Eject crews',
    });
    if (!ok) return;
    await run('elim', () => api.post(`/api/admin/games/${game.id}/elimination/confirm`, {
      expectedVersion: r.gameVersion,
      ...(tie ? { resolution: { mode, note: note.trim(), ...(mode === 'MANUAL_TIEBREAK' ? { eliminateEnrollmentIds: picked } : {}) } } : {}),
    }), `Sprint ${r.sprint} eliminations confirmed.`);
  };

  return (
    <div className={RED_CARD}>
      <SectionHead label={`GAME ${game.number} · SPRINT ${r.sprint} CLOSED · ELIMINATION REVIEW`} title="Emergency meeting: who gets ejected?">
        <Badge>{r.finalSprint ? 'FINAL SPRINT' : 'SPRINT 1'}</Badge>
      </SectionHead>
      <div className="mb-4 rounded-lg border border-[#9d635a] bg-[#2c1f27] p-3 font-mono text-sm">
        {r.preview.activeCount} active → eliminate {r.preview.eliminateCount} (configured K) → {r.preview.survivors} survive
        {tie && <span className="ml-2 text-[#ebd68c]">· TIE AT THE CUTOFF</span>}
      </div>
      <p className="mb-3 text-[11px] text-[#ceafb0]">Standings below are FROZEN at sprint close (crews disqualified afterwards are removed). Highlighted rows are the proposed ejections.</p>

      {r.rows.length === 0 ? <Empty>No active crews in the frozen standings.</Empty> : (
        <div className="overflow-x-auto rounded-lg border border-[#9d635a]">
          <table className="w-full min-w-[560px] text-left text-xs">
            <caption className="sr-only">Frozen standings</caption>
            <thead className={THEAD}>
              <tr>{['RANK', 'CREW', 'SCORE', 'EARNED', 'SPENT', 'TASKS', 'OUTCOME'].map((h) => <th key={h} className={TH} scope="col">{h}</th>)}</tr>
            </thead>
            <tbody>
              {r.rows.map((x) => {
                const out = eliminated.includes(x.enrollmentId);
                const tied = tie?.tiedEnrollmentIds.includes(x.enrollmentId);
                return (
                  <tr key={x.enrollmentId} className={`${TR} ${out ? 'bg-[#71343d]/60' : tied ? 'bg-[#4a4228]/60' : ''}`}>
                    <td className={`${TD} font-mono`}>{x.rank}</td>
                    <td className={TD}><span className="flex items-center gap-2"><Crewmate color={x.color} size={22} state={out ? 'ejected' : 'still'} />{x.name}<span className="font-mono text-[9px] text-muted">{x.crewId}</span></span></td>
                    <td className={`${TD} font-mono font-bold`}>{x.score}</td>
                    <td className={`${TD} font-mono`}>{x.earned}</td>
                    <td className={`${TD} font-mono`}>{x.spent}</td>
                    <td className={`${TD} font-mono`}>{x.tasksSolved}</td>
                    <td className={TD}>{out ? <Badge>EJECTED</Badge> : tied ? <Badge>TIED AT CUTOFF</Badge> : <Badge>SAFE</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tie && (
        <div className="mt-5 rounded-lg border-2 border-[#a8935a] bg-[#3a3626]/70 p-4">
          <Label className="mb-2 !text-[#ebd68c]">TIE RESOLUTION REQUIRED</Label>
          <p className="mb-3 text-xs">
            {tie.tiedEnrollmentIds.length} crews are tied at score <b>{tie.score}</b> across the cutoff: {tie.tiedEnrollmentIds.map((id) => byId.get(id)?.name ?? id).join(', ')}.
            {' '}{tie.strictlyBelow.length} crew(s) below the tie are ejected regardless; exactly {tie.needFromTie} more must go to eliminate K.
          </p>
          <fieldset className="space-y-2">
            <legend className="sr-only">Tie resolution mode</legend>
            {([
              ['RETAIN_TIED', `Retain all tied crews — eject only the ${tie.strictlyBelow.length} below the tie (${r.rows.length - tie.strictlyBelow.length} survive).`],
              ['ELIMINATE_TIED', `Eliminate all tied crews — eject ${tie.strictlyBelow.length + tie.tiedEnrollmentIds.length} (${r.rows.length - tie.strictlyBelow.length - tie.tiedEnrollmentIds.length} survive).`],
              ['MANUAL_TIEBREAK', `Manual published tiebreak — select exactly ${tie.needFromTie} tied crew(s) to eject.`],
            ] as const).map(([m, label]) => (
              <label key={m} className={`flex cursor-pointer gap-2 rounded-lg border p-2 text-xs ${mode === m ? 'border-[#ebd68c] bg-[#4a4228]' : 'border-[#5a5236]'}`}>
                <input type="radio" name={`tie-${game.id}`} className="mt-0.5 accent-[#ebd68c]" checked={mode === m} onChange={() => setMode(m)} />
                <span><b className="font-mono">{m}</b><span className="block text-[11px] text-[#d8d0b0]">{label}</span></span>
              </label>
            ))}
          </fieldset>
          {mode === 'MANUAL_TIEBREAK' && (
            <fieldset className="mt-3 rounded-lg border border-[#5a5236] p-3">
              <legend className="px-1 font-mono text-[9px] tracking-widest text-[#ebd68c]">EJECT {picked.length}/{tie.needFromTie} FROM THE TIED GROUP</legend>
              <div className="flex flex-wrap gap-3">
                {tie.tiedEnrollmentIds.map((id) => {
                  const x = byId.get(id);
                  const on = picked.includes(id);
                  return (
                    <label key={id} className="inline-flex items-center gap-2 text-xs">
                      <input type="checkbox" className="h-4 w-4 accent-[#ef6473]" checked={on} disabled={!on && picked.length >= tie.needFromTie}
                        onChange={(e) => setPicked(e.target.checked ? [...picked, id] : picked.filter((p) => p !== id))} />
                      {x?.name ?? id} <span className="font-mono text-[9px] text-muted">{x?.crewId}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
          <div className="mt-3">
            <Field label="PUBLISHED DECISION NOTE (MIN 8 CHARACTERS · SHOWN IN THE AUDIT LOG)" error={note.length > 0 && note.trim().length < 8 ? 'At least 8 characters.' : undefined}>
              <textarea className="input min-h-[70px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Tie broken by earliest final solve time, as announced at briefing." />
            </Field>
          </div>
        </div>
      )}

      {r.finalSprint && !finalOk && <div className="mt-3"><Notice tone="danger">The final sprint must leave at least {r.prizePlaces} crew(s) for the configured prize places.</Notice></div>}
      {can('game.control') && (
        <div className="mt-5 flex justify-end">
          <Button danger disabled={!ready || busy === 'elim'} onClick={() => void submit()}>Confirm eliminations ({eliminated.length})…</Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results review
// ---------------------------------------------------------------------------

function ResultsPanel({ game }: { game: AdminGame }) {
  const state = useAdminData<ResultsReview>(`/api/admin/games/${game.id}/results`);
  return <Loadable state={state} title={`Game ${game.number} results review`}>{(r) => <ResultsBody game={game} r={r} />}</Loadable>;
}

function ResultsBody({ game, r }: { game: AdminGame; r: ResultsReview }) {
  const { confirm, can } = useConsole();
  const { busy, run } = useRun();
  const [mode, setMode] = useState<'SHARE' | 'MANUAL_ORDER'>('SHARE');
  const [orders, setOrders] = useState<string[][]>(r.conflicts.map((c) => [...c.enrollmentIds]));
  const [note, setNote] = useState('');
  const byId = useMemo(() => new Map(r.rows.map((x) => [x.enrollmentId, x])), [r.rows]);
  const hasConflicts = r.conflicts.length > 0;
  const flatOrder = useMemo(() => orders.flat(), [orders]);

  // Mirrors server confirmResults() placement.
  const preview = useMemo(() => {
    const shared = !hasConflicts || mode === 'SHARE';
    const ordered: ReviewRow[] = shared ? r.rows : [...r.rows].sort((a, b) => b.score - a.score || flatOrder.indexOf(a.enrollmentId) - flatOrder.indexOf(b.enrollmentId));
    return ordered.map((x, i) => {
      const place = shared ? ordered.findIndex((y) => y.score === x.score) + 1 : i + 1;
      return { ...x, place, prize: r.prizes.find((p) => p.place === place)?.label ?? null };
    });
  }, [r.rows, r.prizes, mode, hasConflicts, flatOrder]);

  const move = (gi: number, i: number, d: -1 | 1) => setOrders((os) => os.map((o, k) => {
    if (k !== gi) return o;
    const n = [...o];
    const j = i + d;
    if (j < 0 || j >= n.length) return o;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  }));

  const ready = !hasConflicts || note.trim().length >= 8;
  const submit = async () => {
    const ok = await confirm({
      title: `Confirm Game ${game.number} results`,
      effects: [
        ...preview.filter((p) => p.prize).map((p) => `#${p.place} ${p.name} (${p.crewId}) — ${p.score} — ${p.prize}`),
        ...(hasConflicts ? [`Tie handling: ${mode === 'SHARE' ? 'tied crews SHARE the place' : 'manual published order'} — note: "${note.trim()}"`] : []),
        'Results are published to every crew and prizes freeze. This cannot be undone.',
      ],
      confirmLabel: 'Publish results',
    });
    if (!ok) return;
    await run('results', () => api.post(`/api/admin/games/${game.id}/results/confirm`, {
      expectedVersion: r.gameVersion,
      ...(hasConflicts ? { resolution: { mode, note: note.trim(), ...(mode === 'MANUAL_ORDER' ? { order: flatOrder } : {}) } } : {}),
    }), `Game ${game.number} results confirmed.`);
  };

  const podium = preview.slice(0, 3);
  return (
    <div className={CARD}>
      <SectionHead label={`GAME ${game.number} · FINAL STANDINGS FROZEN · RESULTS REVIEW`} title="Victory ceremony">
        <Trophy size={22} className="text-[#e8cf8e]" aria-hidden="true" />
      </SectionHead>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {podium.map((p) => (
          <div key={p.enrollmentId} className="rounded-lg border-2 border-[#dfbd77]/60 bg-[#37414b] p-4 text-center">
            <div className={`${COIN_TEXT} text-2xl font-bold`}>#{p.place}</div>
            <Crewmate color={p.color} size={44} state="celebrating" className="mx-auto my-2" />
            <div className="font-display font-bold">{p.name}</div>
            <div className="font-mono text-[10px] text-muted">{p.crewId} · {p.score}</div>
            <div className="mt-1 text-[11px] text-[#e8cf8e]">{p.prize ?? 'No prize'}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#344d5b]">
        <table className="w-full min-w-[520px] text-left text-xs">
          <caption className="sr-only">Final placement preview</caption>
          <thead className={THEAD}><tr>{['PLACE', 'CREW', 'SCORE', 'PRIZE'].map((h) => <th key={h} className={TH} scope="col">{h}</th>)}</tr></thead>
          <tbody>
            {preview.map((p) => (
              <tr key={p.enrollmentId} className={TR}>
                <td className={`${TD} ${COIN_TEXT}`}>#{p.place}</td>
                <td className={TD}><span className="flex items-center gap-2"><Crewmate color={p.color} size={20} state="still" />{p.name}<span className="font-mono text-[9px] text-muted">{p.crewId}</span></span></td>
                <td className={`${TD} font-mono`}>{p.score}</td>
                <td className={TD}>{p.prize ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasConflicts && (
        <div className="mt-5 rounded-lg border-2 border-[#a8935a] bg-[#3a3626]/70 p-4">
          <Label className="mb-2 !text-[#ebd68c]">TIES INVOLVING PRIZE PLACES</Label>
          <fieldset className="mb-3 flex flex-wrap gap-3">
            <legend className="sr-only">Tie handling</legend>
            {(['SHARE', 'MANUAL_ORDER'] as const).map((m) => (
              <label key={m} className="inline-flex items-center gap-2 text-xs">
                <input type="radio" name={`res-${game.id}`} className="accent-[#ebd68c]" checked={mode === m} onChange={() => setMode(m)} />
                <b className="font-mono">{m}</b> <span className="text-[#d8d0b0]">{m === 'SHARE' ? '— tied crews share the place (and its prize label)' : '— set a published order within each tied group'}</span>
              </label>
            ))}
          </fieldset>
          {r.conflicts.map((c, gi) => (
            <div key={gi} className="mb-3 rounded-lg border border-[#5a5236] p-3">
              <Label className="mb-2">SCORE {c.score} · POSITIONS {c.positions.join(', ')}</Label>
              <ol className="space-y-1.5">
                {(orders[gi] ?? []).map((id, i) => {
                  const x = byId.get(id);
                  return (
                    <li key={id} className="flex items-center gap-2 text-xs">
                      <span className="w-6 font-mono text-[#ebd68c]">{i + 1}.</span>
                      <span className="flex-1">{x?.name ?? id} <span className="font-mono text-[9px] text-muted">{x?.crewId}</span></span>
                      {mode === 'MANUAL_ORDER' && (
                        <>
                          <button type="button" aria-label={`Move ${x?.name} up`} className="rounded border border-[#5a5236] p-1 disabled:opacity-30" disabled={i === 0} onClick={() => move(gi, i, -1)}><ArrowUp size={12} /></button>
                          <button type="button" aria-label={`Move ${x?.name} down`} className="rounded border border-[#5a5236] p-1 disabled:opacity-30" disabled={i === (orders[gi]?.length ?? 0) - 1} onClick={() => move(gi, i, 1)}><ArrowDown size={12} /></button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
          <Field label="PUBLISHED DECISION NOTE (MIN 8 CHARACTERS)" error={note.length > 0 && note.trim().length < 8 ? 'At least 8 characters.' : undefined}>
            <textarea className="input min-h-[70px]" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
        {!can('results.confirm') && <span className="font-mono text-[10px] text-muted">Only a SUPER_ADMIN can publish results.</span>}
        {can('results.confirm') && <Button disabled={!ready || busy === 'results'} onClick={() => void submit()}><Trophy size={14} /> Confirm & publish results…</Button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Disqualifications
// ---------------------------------------------------------------------------

function DisqualificationHistory() {
  const state = useAdminData<CrewList>('/api/admin/crews');
  const { can, confirm } = useConsole();
  const { busy, run } = useRun();
  const revoke = async (crewName: string, id: string) => {
    const r = await confirm({ title: `Revoke disqualification of ${crewName}`, tone: 'warning', effects: ['The crew returns to its previous status (active, or eliminated if already ejected).', 'Elimination history is not altered.'], reason: { label: 'CORRECTION REASON', min: 8 }, confirmLabel: 'Revoke' });
    if (!r) return;
    await run(`rdq-${id}`, () => api.post(`/api/admin/disqualifications/${id}/revoke`, { reason: r.reason }), 'Disqualification revoked.');
    await state.reload();
  };
  return (
    <section className={CARD} aria-label="Disqualifications">
      <SectionHead label="DISQUALIFICATIONS · ACTIVE" />
      <Loadable state={state} title="Disqualifications">
        {(d) => {
          const rows = d.crews.flatMap((c) => (c.disqualifications ?? []).map((q) => ({ c, q })));
          if (!rows.length) return <Empty>No active disqualifications.</Empty>;
          return (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-xs">
                <thead className={THEAD}><tr>{['CREW', 'SCOPE', 'WHEN', 'REASON', ''].map((h) => <th key={h} className={TH} scope="col">{h}</th>)}</tr></thead>
                <tbody>
                  {rows.map(({ c, q }) => (
                    <tr key={q.id} className={TR}>
                      <td className={TD}>{c.name}<span className="block font-mono text-[9px] text-muted">{c.crew_id}</span></td>
                      <td className={`${TD} font-mono`}>{q.scope}{q.gameId ? ` · GAME ${d.games.find((g) => g.id === q.gameId)?.number ?? '?'}` : ''}</td>
                      <td className={`${TD} font-mono text-[10px]`}>{fmtTime(q.createdAt)}</td>
                      <td className={TD}>{q.reason}</td>
                      <td className={TD}>{can('disqualify') && <button type="button" className={LINK} disabled={busy === `rdq-${q.id}`} onClick={() => void revoke(c.name, q.id)}>Revoke…</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </Loadable>
      <p className="mt-2 font-mono text-[9px] text-muted">Disqualify crews from the CREW tab (expand a crew). Revoked disqualifications remain in the audit log.</p>
    </section>
  );
}
