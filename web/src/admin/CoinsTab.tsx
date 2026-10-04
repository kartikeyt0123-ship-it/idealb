import { useState } from 'react';
import { api } from '../lib/api';
import { Badge, Button, Coin, Crewmate, Field, Label, useToast } from '../components/ui';
import { CARD, COIN_TEXT, Empty, ExportLink, GamePicker, Loadable, NumInput, TD, TH, THEAD, TR, fmtTime, signed, useAdminData, useConsole, useRun, useSelectedGame } from './kit';
import type { AdminGame, AdminStanding, LedgerRow } from './types';

const TARGETS = {
  WALLET: 'Wallet only — changes spendable coins. Does NOT change score.',
  SCORE: 'Score only — changes the ranking score. Wallet is untouched.',
  BOTH: 'Wallet and score together — e.g. correcting a missed or wrongly awarded task reward.',
  GRANT: 'Grant — positive wallet funding (like starting coins). Never counts as score.',
} as const;
type Target = keyof typeof TARGETS;

export function CoinsTab() {
  const [game, setGame] = useSelectedGame();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Label>IDEACOIN TREASURY</Label>
        <GamePicker value={game?.id ?? null} onChange={setGame} />
      </div>
      {game ? <Treasury key={game.id} game={game} /> : <Empty>No games configured.</Empty>}
    </div>
  );
}

function Treasury({ game }: { game: AdminGame }) {
  const { can } = useConsole();
  const [crew, setCrew] = useState<string>('');
  const all: AdminStanding[] = [...game.standings.active, ...game.standings.inactive];
  const ledger = useAdminData<LedgerRow[]>(`/api/admin/games/${game.id}/ledger${crew ? `?enrollmentId=${crew}` : ''}`);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>STANDINGS · METRIC {game.rankingMetric}</Label>
        {can('exports') && (
          <div className="flex flex-wrap gap-2">
            <ExportLink href={`/api/admin/export/ledger?gameId=${game.id}`}>LEDGER CSV</ExportLink>
            <ExportLink href={`/api/admin/export/standings?gameId=${game.id}`}>STANDINGS CSV</ExportLink>
          </div>
        )}
      </div>
      {all.length === 0 ? <Empty>No crews are enrolled in this game yet. Activate crews for its day in the CREW tab.</Empty> : (
        <div className="overflow-x-auto rounded-xl border-2 border-[#426270] bg-[#142e3a]">
          <table className="w-full min-w-[760px] text-left text-xs">
            <caption className="sr-only">Wallets and scores</caption>
            <thead className={THEAD}>
              <tr>{['RANK', 'CREW', 'STATUS', 'WALLET', 'EARNED', 'SPENT', 'ADJUST', 'SCORE', 'TASKS', ''].map((h) => <th key={h} className={TH} scope="col">{h}</th>)}</tr>
            </thead>
            <tbody>
              {all.map((s) => (
                <tr key={s.enrollmentId} className={`${TR} ${crew === s.enrollmentId ? 'bg-[#1d4450]' : ''}`}>
                  <td className={`${TD} font-mono`}>{s.rank ?? '—'}</td>
                  <td className={TD}><span className="flex items-center gap-2"><Crewmate color={s.color} size={22} state="still" />{s.name}<span className="font-mono text-[9px] text-muted">{s.crewId}</span></span></td>
                  <td className={TD}><Badge>{s.status}</Badge></td>
                  <td className={`${TD} ${COIN_TEXT}`}>{s.wallet}</td>
                  <td className={`${TD} font-mono`}>{s.earned}</td>
                  <td className={`${TD} font-mono`}>{s.spent}</td>
                  <td className={`${TD} font-mono`}>{signed(s.scoreAdjust)}</td>
                  <td className={`${TD} font-mono font-bold text-primary`}>{s.score}</td>
                  <td className={`${TD} font-mono`}>{s.tasksSolved}</td>
                  <td className={TD}><button type="button" className="font-mono text-[10px] text-[#e6c887] hover:underline" onClick={() => setCrew(crew === s.enrollmentId ? '' : s.enrollmentId)}>{crew === s.enrollmentId ? 'All ledger' : 'Ledger'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <section aria-label="Coin ledger">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <Label>LEDGER {crew ? `· ${all.find((x) => x.enrollmentId === crew)?.name ?? ''}` : '· ALL CREWS (LATEST 500)'}</Label>
            <label className="text-xs">
              <span className="sr-only">Filter ledger by crew</span>
              <select className="input !w-auto !py-1.5" value={crew} onChange={(e) => setCrew(e.target.value)}>
                <option value="">All crews</option>
                {all.map((s) => <option key={s.enrollmentId} value={s.enrollmentId}>{s.crewId} · {s.name}</option>)}
              </select>
            </label>
          </div>
          <Loadable state={ledger} title="Ledger" empty={(d) => d.length === 0}>
            {(rows) => (
              <div className="max-h-[520px] overflow-auto rounded-xl border-2 border-[#426270] bg-[#142e3a]">
                <table className="w-full min-w-[860px] text-left text-xs">
                  <thead className={`${THEAD} sticky top-0 bg-[#142e3a]`}>
                    <tr>{['TIME', 'CREW', 'KIND', 'WALLET Δ', 'EARNED Δ', 'SPENT Δ', 'SCORE Δ', 'WALLET AFTER', 'REASON', 'BY'].map((h) => <th key={h} className={TH} scope="col">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={String(r.id)} className={TR}>
                        <td className={`${TD} whitespace-nowrap font-mono text-[10px]`}>{fmtTime(r.created_at)}</td>
                        <td className={TD}>{r.team_name}<span className="block font-mono text-[9px] text-muted">{r.crew_id}</span></td>
                        <td className={TD}><span className="font-mono text-[10px]">{r.kind}</span><span className="block font-mono text-[9px] text-muted">{r.source_type}</span></td>
                        <td className={`${TD} ${COIN_TEXT}`}>{signed(r.wallet_delta)}</td>
                        <td className={`${TD} font-mono`}>{r.earned_delta ? signed(r.earned_delta) : '·'}</td>
                        <td className={`${TD} font-mono`}>{r.spent_delta ? signed(r.spent_delta) : '·'}</td>
                        <td className={`${TD} font-mono`}>{r.score_delta ? signed(r.score_delta) : '·'}</td>
                        <td className={`${TD} ${COIN_TEXT}`}>{r.wallet_after}</td>
                        <td className={`${TD} max-w-[220px]`}>{r.reason ?? '—'}</td>
                        <td className={`${TD} text-[10px]`}>{r.actor ?? 'system'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Loadable>
        </section>
        {can('coins.adjust') && all.length > 0 && <AdjustForm key={crew || "all"} game={game} crews={all} preset={crew} onDone={() => void ledger.reload()} />}
      </div>
    </div>
  );
}

function AdjustForm({ game, crews, preset, onDone }: { game: AdminGame; crews: AdminStanding[]; preset: string; onDone: () => void }) {
  const { confirm } = useConsole();
  const { busy, run } = useRun();
  const toast = useToast();
  const [enr, setEnr] = useState(preset || crews[0]?.enrollmentId || '');
  const [amount, setAmount] = useState('');
  const [target, setTarget] = useState<Target>('BOTH');
  const [reason, setReason] = useState('');
  const crew = crews.find((c) => c.enrollmentId === enr);
  const n = Number(amount);
  const valid = !!crew && Number.isInteger(n) && n !== 0 && Math.abs(n) <= 100000 && reason.trim().length >= 4 && !(target === 'GRANT' && n < 0);

  const submit = async () => {
    if (!crew) return;
    if (!valid) return toast('Choose a crew, a non-zero whole amount (grants must be positive) and a reason of at least 4 characters.', 'alert');
    const ok = await confirm({
      title: `Adjust ${crew.name}`,
      tone: 'warning',
      effects: [
        `${signed(n)} IdeaCoins · target ${target} on ${crew.crewId} in Game ${game.number}.`,
        target === 'SCORE' ? `Score ${crew.score} → ${crew.score + n}; wallet stays ${crew.wallet}.` : target === 'GRANT' ? `Wallet ${crew.wallet} → ${crew.wallet + n}; score stays ${crew.score}.` : target === 'WALLET' ? `Wallet ${crew.wallet} → ${crew.wallet + n}; score stays ${crew.score}.` : `Wallet ${crew.wallet} → ${crew.wallet + n}; score ${crew.score} → ${crew.score + n}.`,
        `Reason recorded in the ledger and audit log: "${reason.trim()}"`,
      ],
      confirmLabel: 'Apply adjustment',
    });
    if (!ok) return;
    const r = await run('adjust', () => api.post<{ wallet: number; earned: number; spent: number; scoreAdjust: number }>(`/api/admin/enrollments/${enr}/adjust`, { amount: n, target, reason: reason.trim() }), (x) => `Adjusted. ${crew.crewId} wallet now ${x.wallet}.`);
    if (r) {
      setAmount('');
      setReason('');
      onDone();
    }
  };

  return (
    <section className={CARD} aria-label="Coin adjustment">
      <Label className="mb-3"><Coin size={12} /> MANUAL ADJUSTMENT</Label>
      <Field label="CREW">
        <select className="input" value={enr} onChange={(e) => setEnr(e.target.value)}>
          {crews.map((c) => <option key={c.enrollmentId} value={c.enrollmentId}>{c.crewId} · {c.name} (wallet {c.wallet}, score {c.score})</option>)}
        </select>
      </Field>
      <Field label="AMOUNT (± WHOLE COINS)" hint="Negative values deduct.">
        <NumInput value={amount} onChange={setAmount} ariaLabel="Adjustment amount" />
      </Field>
      <fieldset className="mb-4">
        <legend className="mb-2 font-mono text-[9px] tracking-widest text-[#b3c4c8]">TARGET</legend>
        <div className="space-y-2">
          {(Object.keys(TARGETS) as Target[]).map((t) => (
            <label key={t} className={`flex cursor-pointer gap-2 rounded-lg border p-2 text-xs ${target === t ? 'border-primary bg-[#1d4450]' : 'border-[#344d5b]'}`}>
              <input type="radio" name="adjust-target" className="mt-0.5 accent-[#8ae4cf]" checked={target === t} onChange={() => setTarget(t)} />
              <span><b className="font-mono">{t}</b><span className="block text-[11px] text-muted">{TARGETS[t]}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="REASON (REQUIRED · MIN 4 CHARACTERS)">
        <textarea className="input min-h-[70px]" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Judge correction: TC-03 accepted on appeal" />
      </Field>
      {target === 'GRANT' && n < 0 && <p role="alert" className="mb-3 text-[11px] text-[#f3b399]">Grants must be positive. Use WALLET to deduct.</p>}
      <Button className="w-full" disabled={!valid || busy === 'adjust'} onClick={() => void submit()}>Review adjustment…</Button>
    </section>
  );
}
