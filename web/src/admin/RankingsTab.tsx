import { Trophy } from 'lucide-react';
import { useState } from 'react';
import { Badge, Crewmate, Label } from '../components/ui';
import { CARD, COIN_TEXT, Empty, ExportLink, GamePicker, SUBCARD, Segmented, TD, TH, THEAD, TR, fmtTime, useConsole, useSelectedGame } from './kit';
import type { AdminGame, AdminStanding } from './types';

export function RankingsTab() {
  const [game, setGame] = useSelectedGame();
  const { can } = useConsole();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Label>RANKINGS & REWARDS</Label>
        <div className="flex flex-wrap items-center gap-2">
          {can('exports') && <ExportLink href="/api/admin/export/crews">CREWS CSV</ExportLink>}
          <GamePicker value={game?.id ?? null} onChange={setGame} />
        </div>
      </div>
      {game ? <Board key={game.id} game={game} /> : <Empty>No games configured.</Empty>}
    </div>
  );
}

function Board({ game }: { game: AdminGame }) {
  const { can } = useConsole();
  const [view, setView] = useState<'active' | 'out'>('active');
  const cur = game.sprints.find((s) => s.number === Math.max(1, game.currentSprint));
  const k = cur?.eliminateCount ?? null;
  const rows: AdminStanding[] = view === 'active' ? game.standings.active : game.standings.inactive;
  const metric = game.rankingMetric === 'NET_COINS' ? 'NET IDEACOINS (earned − spent + adj.)' : 'GROSS EARNED (+ adj.)';

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <section className={CARD} aria-label="Live standings">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Label>LIVE STANDINGS · GAME {game.number} · SCORE = {metric}</Label>
            {(game.phase === 'RUNNING' || game.phase === 'PAUSED') && k !== null && <p className="mt-1 text-[11px] text-muted">Zones from configured K = {k}: bottom {k} DANGER, the tie/next band UNCERTAIN.</p>}
          </div>
          <Segmented<'active' | 'out'>
            label="Standings view"
            value={view}
            onChange={setView}
            options={[{ value: 'active', label: `ACTIVE · ${game.standings.active.length}` }, { value: 'out', label: `ELIMINATED / OUT · ${game.standings.inactive.length}` }]}
          />
        </div>
        {rows.length === 0 ? <Empty>{view === 'active' ? 'No active crews.' : 'Nobody has been ejected yet.'}</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <caption className="sr-only">{view === 'active' ? 'Active crews' : 'Eliminated or inactive crews'}</caption>
              <thead className={THEAD}>
                <tr>{['RANK', 'CREW', view === 'active' ? 'ZONE' : 'STATUS', 'SCORE', 'EARNED', 'SPENT', 'WALLET', 'TASKS'].map((h) => <th key={h} className={TH} scope="col">{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.enrollmentId} className={`${TR} ${r.zone === 'DANGER' ? 'bg-[#71343d]/30' : ''}`}>
                    <td className={`${TD} font-mono`}>{r.rank ?? '—'}</td>
                    <td className={TD}><span className="flex items-center gap-2"><Crewmate color={r.color} size={22} state={r.status === 'ACTIVE' ? 'still' : 'ejected'} />{r.name}<span className="font-mono text-[9px] text-muted">{r.crewId}</span></span></td>
                    <td className={TD}>{view === 'active' ? (r.zone ? <Badge>{r.zone}</Badge> : <span className="text-muted">—</span>) : <Badge>{r.eliminatedSprint ? `${r.status} · S${r.eliminatedSprint}` : r.status}</Badge>}</td>
                    <td className={`${TD} font-mono font-bold text-primary`}>{r.score}</td>
                    <td className={`${TD} font-mono`}>{r.earned}</td>
                    <td className={`${TD} font-mono`}>{r.spent}</td>
                    <td className={`${TD} ${COIN_TEXT}`}>{r.wallet}</td>
                    <td className={`${TD} font-mono`}>{r.tasksSolved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <aside className="space-y-4">
        <div className={SUBCARD}>
          <Label className="mb-3"><Trophy size={11} className="mr-1 inline" />PRIZES</Label>
          {game.prizes.length === 0 ? <p className="text-[11px] text-muted">No prizes configured (GAME & SPRINT tab).</p> : (
            <ol className="space-y-2">
              {game.prizes.map((p) => <li key={p.place} className="flex gap-3 text-xs"><span className={`${COIN_TEXT} w-8`}>#{p.place}</span>{p.label}</li>)}
            </ol>
          )}
        </div>
        <div className={SUBCARD}>
          <Label className="mb-3">CONFIRMED RESULTS</Label>
          {game.result ? (
            <>
              <p className="mb-2 font-mono text-[10px] text-muted">CONFIRMED {fmtTime(game.result.confirmed_at)}</p>
              <ol className="space-y-2">
                {game.result.rows.slice(0, Math.max(5, game.prizes.length)).map((r) => (
                  <li key={r.crewId} className="flex items-center gap-2 text-xs">
                    <span className={`${COIN_TEXT} w-8`}>#{r.place}</span>
                    <Crewmate color={r.color} size={18} state="still" />
                    <span className="flex-1">{r.name}<span className="block font-mono text-[9px] text-muted">{r.crewId} · {r.score}</span></span>
                    {r.prize && <span className="text-[10px] text-[#e8cf8e]">{r.prize}</span>}
                  </li>
                ))}
              </ol>
              {game.result.note && <p className="mt-2 text-[11px] text-muted">Note: {game.result.note}</p>}
            </>
          ) : <p className="text-[11px] text-muted">Not confirmed yet{game.phase === 'GAME_RESULT_REVIEW' ? ' — awaiting confirmation in the ELIMINATION tab.' : '.'}</p>}
        </div>
        {can('exports') && (
          <div className={SUBCARD}>
            <Label className="mb-3">EXPORTS · GAME {game.number}</Label>
            <div className="flex flex-wrap gap-2">
              <ExportLink href={`/api/admin/export/standings?gameId=${game.id}`}>STANDINGS CSV</ExportLink>
              <ExportLink href={`/api/admin/export/results?gameId=${game.id}`} disabled={!game.result}>RESULTS CSV</ExportLink>
              <ExportLink href={`/api/admin/export/ledger?gameId=${game.id}`}>LEDGER CSV</ExportLink>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
