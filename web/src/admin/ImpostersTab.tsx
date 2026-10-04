import { Siren, RotateCcw, XOctagon } from 'lucide-react';
import { useState } from 'react';
import { api, serverNow } from '../lib/api';
import { Badge, Button, Crewmate, Label, useToast } from '../components/ui';
import { COIN_TEXT, Countdown, Empty, GamePicker, Notice, NumInput, RED_CARD, SMALL, errText, fmtDuration, fmtTime, useConsole, useSelectedGame } from './kit';
import type { AdminGame, AdminImposter } from './types';

export function ImpostersTab() {
  const [game, setGame] = useSelectedGame();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Label className="!text-[#f3b399]">IMPOSTER PROTOCOL · EMERGENCY CONSOLE</Label>
        <GamePicker value={game?.id ?? null} onChange={setGame} />
      </div>
      {game ? <ImposterBoard key={game.id} game={game} /> : <Empty>No games configured.</Empty>}
    </div>
  );
}

function ImposterBoard({ game }: { game: AdminGame }) {
  const live = game.imposters.filter((i) => i.status === 'OFFERED' || i.status === 'RESERVED');
  const drafts = game.imposters.filter((i) => i.status === 'DRAFT');
  const done = game.imposters.filter((i) => ['SOLVED', 'EXPIRED', 'CANCELLED'].includes(i.status));
  const cur = game.sprints.find((s) => s.number === Math.max(1, game.currentSprint));
  return (
    <div className="space-y-5">
      <div className={`${RED_CARD} flex flex-wrap items-center justify-between gap-4`}>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border-[6px] border-[#6f4d50] bg-[#ab5656] shadow-[0_6px_0_#252329]">
            <Siren size={26} className="text-[#ffd8c7]" aria-hidden="true" />
          </div>
          <div>
            <Label className="!text-[#f3b399]">GAME {game.number} · MODE {game.imposterMode === 'RESERVE' ? 'RESERVE (FIRST TO CLAIM)' : 'OPEN (FIRST CORRECT)'}</Label>
            <div className="mt-1 font-display text-lg font-bold text-[#ffd8c7]">{live.length ? `${live.length} imposter LIVE on the ship` : 'No imposter live'}</div>
            <p className="text-[11px] text-[#ceafb0]">
              {game.phase === 'RUNNING' ? `Sprint ${cur?.number} running — ` : `Game is ${game.phase.replace(/_/g, ' ')} — `}
              imposters can be released only while a sprint is RUNNING, one at a time.{game.imposterBlocksRegular ? ' Holding crews cannot solve regular tasks.' : ''}
            </p>
          </div>
        </div>
        {cur?.status === 'RUNNING' && (
          <div className="text-right">
            <Label className="!text-[#f3b399]">SPRINT TIME LEFT</Label>
            <div className="text-2xl"><Countdown deadline={cur.deadlineAt} /></div>
          </div>
        )}
      </div>

      {game.imposters.length === 0 && <Empty>No imposter problems assigned to this game. Assign one from the PROBLEM LIBRARY (“Assign as imposter”).</Empty>}
      {live.length > 0 && <Group title="LIVE" items={live} game={game} />}
      {drafts.length > 0 && <Group title="ARMED DRAFTS" items={drafts} game={game} />}
      {done.length > 0 && <Group title="RESOLVED" items={done} game={game} />}
    </div>
  );
}

function Group({ title, items, game }: { title: string; items: AdminImposter[]; game: AdminGame }) {
  return (
    <section aria-label={`${title} imposters`}>
      <Label className="mb-2 !text-[#f3b399]">{title} · {items.length}</Label>
      <div className="grid gap-4 lg:grid-cols-2">
        {items.map((i) => <ImposterCard key={`${i.id}-${i.status}-${i.reward}-${i.hint_cost}-${i.claim_seconds}-${i.solve_seconds}`} imp={i} game={game} />)}
      </div>
    </section>
  );
}

function ImposterCard({ imp, game }: { imp: AdminImposter; game: AdminGame }) {
  const { can, confirm, reloadOverview } = useConsole();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reward, setReward] = useState(String(imp.reward));
  const [hint, setHint] = useState(String(imp.hint_cost));
  const [claim, setClaim] = useState(String(imp.claim_seconds));
  const [solve, setSolve] = useState(String(imp.solve_seconds));
  const ctl = can('game.control');
  const cur = game.sprints.find((s) => s.number === Math.max(1, game.currentSprint));
  const anotherLive = game.imposters.some((x) => x.id !== imp.id && (x.status === 'OFFERED' || x.status === 'RESERVED'));
  const releasable = imp.status === 'DRAFT' && game.phase === 'RUNNING' && game.currentSprint === imp.sprint && !anotherLive;

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      toast(ok, 'good');
      await reloadOverview();
    } catch (e) {
      const m = errText(e);
      setErr(m);
      toast(m, 'alert');
    } finally {
      setBusy(null);
    }
  };

  const saveDraft = () => {
    const body = { reward: Number(reward), hintCost: Number(hint), claimSeconds: Number(claim), solveSeconds: Number(solve) };
    if (Object.values(body).some((v) => !Number.isInteger(v))) {
      setErr('All imposter values must be whole numbers.');
      return;
    }
    void act('save', () => api.patch(`/api/admin/imposters/${imp.id}`, body), `${imp.label} draft updated.`);
  };

  const release = async () => {
    const remaining = cur?.deadlineAt ? Math.floor((Date.parse(cur.deadlineAt) - serverNow()) / 1000) : null;
    const ok = await confirm({
      title: 'Call the imposter protocol',
      effects: [
        `${imp.label} "${imp.title}" (${imp.difficulty}) is broadcast to EVERY active crew in Game ${game.number} right now.`,
        game.imposterMode === 'RESERVE'
          ? `RESERVE mode: the first crew to claim within ${imp.claim_seconds}s gets ${imp.solve_seconds}s to solve it for ${imp.reward} IdeaCoins.`
          : `OPEN mode: the first correct answer within ${imp.claim_seconds + imp.solve_seconds}s wins ${imp.reward} IdeaCoins.`,
        ...(remaining !== null ? [`About ${remaining}s remain in the sprint; windows are capped at the sprint deadline.`] : []),
        'A released imposter is frozen — it can only be cancelled, not edited.',
      ],
      confirmLabel: 'RELEASE IMPOSTER',
    });
    if (ok) await act('release', () => api.post(`/api/admin/imposters/${imp.id}/release`, {}), `IMPOSTER DETECTED. ${imp.label} transmitted to all crews.`);
  };

  const cancel = async () => {
    const r = await confirm({
      title: `Cancel ${imp.label}`,
      effects: [
        imp.status === 'DRAFT' ? 'The draft is withdrawn and will not be released.' : 'The imposter is withdrawn immediately with NO award.',
        ...(imp.reservation ? [`The reservation held by ${imp.reservation.crew} is cancelled; the crew returns to regular tasks.`] : []),
      ],
      reason: { label: 'CANCELLATION REASON', min: 4 },
      confirmLabel: 'Cancel imposter',
    });
    if (r) await act('cancel', () => api.post(`/api/admin/imposters/${imp.id}/cancel`, { reason: r.reason }), `${imp.label} cancelled.`);
  };

  const rearm = async () => {
    const ok = await confirm({ title: `Re-arm ${imp.label}`, tone: 'warning', effects: [`A NEW generation (G${imp.generation + 1}) of this imposter is created as a DRAFT with the same settings.`, 'Nothing is released until you call the protocol again.'], confirmLabel: 'Re-arm' });
    if (ok) await act('rearm', () => api.post(`/api/admin/imposters/${imp.id}/rearm`, {}), `${imp.label} re-armed as a new draft.`);
  };

  const isLive = imp.status === 'OFFERED' || imp.status === 'RESERVED';
  return (
    <article className={`rounded-xl border-2 p-4 ${isLive ? 'animate-[alarm_2s_ease-in-out_infinite] border-[#ef6473] bg-[#4e2f3b]' : 'border-[#9d635a] bg-[#442b34]'}`} aria-label={`Imposter ${imp.label}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Crewmate color="#f37983" size={34} state={isLive ? 'warning' : 'still'} />
          <div>
            <div className="font-mono text-[10px] text-[#f3b399]">{imp.label} · SPRINT {imp.sprint} · G{imp.generation}</div>
            <div className="font-display text-base font-bold">{imp.title}</div>
            <div className="mt-1 flex flex-wrap gap-1.5"><Badge>{imp.difficulty}</Badge><Badge>{imp.status}</Badge>{imp.mode && <Badge>{imp.mode}</Badge>}</div>
          </div>
        </div>
        <div className={`${COIN_TEXT} text-right text-sm`}>{imp.reward}<span className="block text-[9px] text-muted">REWARD</span></div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[10px] text-[#ceafb0] sm:grid-cols-4">
        <span>HINT {imp.hint_cost}</span>
        <span>CLAIM {fmtDuration(imp.claim_seconds)}</span>
        <span>SOLVE {fmtDuration(imp.solve_seconds)}</span>
        <span>RELEASED {imp.released_at ? fmtTime(imp.released_at) : '—'}</span>
      </div>

      {isLive && (
        <div className="mt-3 grid gap-2 rounded-lg border border-[#ef6473]/50 bg-[#2c1f27] p-3 sm:grid-cols-2">
          {imp.status === 'OFFERED' && imp.claim_deadline_at && (
            <div><Label className="!text-[#f3b399]">{imp.mode === 'OPEN' ? 'OPEN WINDOW' : 'CLAIM WINDOW'}</Label><div className="text-xl"><Countdown deadline={imp.mode === 'OPEN' ? imp.open_deadline_at : imp.claim_deadline_at} /></div></div>
          )}
          {imp.reservation && (
            <div>
              <Label className="!text-[#f3b399]">RESERVED BY</Label>
              <div className="text-sm font-semibold">{imp.reservation.crew}</div>
              <div className="font-mono text-[10px]">{imp.reservation.status} · solve left <Countdown deadline={imp.reservation.solveDeadlineAt} /></div>
            </div>
          )}
        </div>
      )}
      {!isLive && imp.reservation && <p className="mt-2 text-[11px] text-[#ceafb0]">Reservation: {imp.reservation.crew} ({imp.reservation.status})</p>}
      {imp.resolution_note && <p className="mt-2 font-mono text-[10px] text-[#ceafb0]">RESOLUTION: {imp.resolution_note}</p>}

      {ctl && imp.status === 'DRAFT' && (
        <fieldset className="mt-4 rounded-lg border border-[#9d635a] p-3">
          <legend className="px-1 font-mono text-[9px] tracking-widest text-[#f3b399]">EDIT DRAFT</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([['REWARD', reward, setReward, 0], ['HINT COST', hint, setHint, 0], ['CLAIM S', claim, setClaim, 5], ['SOLVE S', solve, setSolve, 15]] as const).map(([l, v, set, min]) => (
              <label key={l} className="text-xs">
                <span className="mb-1 block font-mono text-[9px] tracking-widest text-[#b3c4c8]">{l}</span>
                <NumInput value={v} onChange={set} min={min} ariaLabel={`${imp.label} ${l.toLowerCase()}`} />
              </label>
            ))}
          </div>
          <div className="mt-3 flex justify-end">
            <Button secondary className={SMALL} disabled={busy === 'save'} onClick={saveDraft}>Save draft</Button>
          </div>
        </fieldset>
      )}

      {err && <div className="mt-3"><Notice tone="danger">{err}</Notice></div>}

      {ctl && (
        <div className="mt-4 flex flex-wrap gap-2">
          {imp.status === 'DRAFT' && (
            <Button danger className="!w-full !py-4 !text-sm sm:!w-auto" disabled={!releasable || busy === 'release'} onClick={() => void release()}
              title={!releasable ? (anotherLive ? 'Another imposter is live' : game.phase !== 'RUNNING' ? 'Sprint is not running' : `Assigned to sprint ${imp.sprint}`) : undefined}>
              <Siren size={16} /> Call the imposter protocol
            </Button>
          )}
          {(imp.status === 'DRAFT' || isLive) && <Button secondary className={SMALL} disabled={busy === 'cancel'} onClick={() => void cancel()}><XOctagon size={12} /> Cancel…</Button>}
          {(imp.status === 'EXPIRED' || imp.status === 'CANCELLED') && <Button secondary className={SMALL} disabled={busy === 'rearm'} onClick={() => void rearm()}><RotateCcw size={12} /> Re-arm (new generation)</Button>}
        </div>
      )}
      {ctl && imp.status === 'DRAFT' && !releasable && (
        <p className="mt-2 font-mono text-[9px] text-[#ceafb0]">
          {anotherLive ? 'LOCKED: another imposter is live.' : game.phase !== 'RUNNING' ? `LOCKED: game is ${game.phase.replace(/_/g, ' ')} — release needs a RUNNING sprint.` : `LOCKED: assigned to Sprint ${imp.sprint}, current sprint is ${game.currentSprint}.`}
        </p>
      )}
    </article>
  );
}
