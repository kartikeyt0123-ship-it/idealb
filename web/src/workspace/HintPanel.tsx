/**
 * Paid hint LADDER. Levels are bought in order (POST hint-purchases {level}).
 * Before purchase only a client-generated decoy is rendered (blurred); a
 * level's real text exists in the DOM only after the server returns it.
 */
import { KeyRound, Loader2, Lock, ShieldAlert, Unlock } from 'lucide-react';
import { useState } from 'react';
import { api, newKey, type HintLevelDto, type HintResult, type Metric } from '../lib/api';
import { Button, Coin, Label, useToast } from '../components/ui';
import { Modal } from './parts';
import { decoyText, errCode, errMessage, friendlyError, SOLVED_CODES } from './util';

export type HintResponse = HintResult;

export function HintPanel({
  url, seed, hints, wallet, onUnlocked, onSolvedElsewhere, locked, lockedReason, imposter, metric,
}: {
  url: string;
  seed: string;
  /** Ladder, ordered by level. */
  hints: HintLevelDto[];
  wallet: number;
  onUnlocked: (r: HintResponse, level: number) => void;
  onSolvedElsewhere: () => void;
  locked: boolean;
  lockedReason: string | null;
  imposter: boolean;
  metric: Metric;
}) {
  const notify = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idem, setIdem] = useState<{ level: number; key: string } | null>(null);

  const ladder = [...hints].sort((a, b) => a.level - b.level);
  const next = ladder.find((h) => !h.unlocked) ?? null;
  const cost = next?.cost ?? 0;
  const short = !!next && wallet < cost;
  const unlockedCount = ladder.filter((h) => h.unlocked).length;

  async function buy() {
    if (!next) return;
    setConfirm(false);
    setBusy(true);
    setError(null);
    // Same key only when retrying the same level after a network failure.
    const key = idem && idem.level === next.level ? idem.key : newKey('hint');
    setIdem({ level: next.level, key });
    try {
      const r = await api.post<HintResponse>(url, { level: next.level }, key);
      onUnlocked(r, r.level ?? next.level);
      setIdem(null);
      if (r.charged && r.cost > 0) notify(`−${r.cost} IdeaCoins / hint ${r.level ?? next.level} decrypted`, 'good');
      else notify(`Hint ${r.level ?? next.level} decrypted.`, 'good');
    } catch (e) {
      const code = errCode(e);
      if (SOLVED_CODES.has(code)) onSolvedElsewhere();
      if (code === 'INSUFFICIENT_FUNDS') setError(`Not enough IdeaCoins — hint ${next.level} costs ${next.cost}. Repair other systems to earn more.`);
      else if (code === 'HINT_UNAVAILABLE') setError(errMessage(e) || 'Hints are unavailable for this system right now.');
      else setError(friendlyError(code, errMessage(e)));
      // A definitive server rejection ends this attempt; a network failure keeps the key so a retry is idempotent.
      if (code !== 'NETWORK') setIdem(null);
    } finally {
      setBusy(false);
    }
  }

  const accent = imposter ? 'text-[#f0b8a2]' : 'text-[#e1c18b]';
  return (
    <section aria-label="System hints" className={`flex h-full flex-col rounded-xl border-2 p-4 ${imposter ? 'border-[#c67c6b] bg-[#392e3c]' : 'border-[#4e6b79] bg-[#15303c]'}`}>
      <Label className={`flex items-center gap-2 ${accent}`}>
        <KeyRound size={12} />
        SYSTEM HINTS / {unlockedCount}/{ladder.length} DECRYPTED
      </Label>

      {ladder.length === 0 && <p className="mt-3 text-xs text-muted">No hints for this system.</p>}

      <ol className="mt-3 flex flex-col gap-2">
        {ladder.map((h) => (
          <li key={h.level} className="rounded-lg border border-white/10 bg-[#0d202c]/60 p-3">
            <div className="flex items-center justify-between gap-2 font-mono text-[10px] tracking-wider text-[#9fb8bf]">
              <span className="flex items-center gap-1.5">
                {h.unlocked ? <Unlock size={11} className="text-primary" /> : <Lock size={11} className={accent} />}
                HINT {h.level}
              </span>
              <span className="flex items-center gap-1">
                <Coin size={12} /> {h.cost > 0 ? h.cost : 'free'}
              </span>
            </div>
            {h.unlocked && h.text != null ? (
              <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-6 text-[#d8e5d8]">{h.text}</p>
            ) : (
              <div className="relative mt-2 overflow-hidden">
                <p aria-hidden="true" className="pointer-events-none select-none text-xs leading-5 text-[#9fb8bf] blur-[5px]">
                  {decoyText(`${seed}:${h.level}`, h === next ? 30 : 14)}
                </p>
                <span className="absolute inset-0 flex items-center justify-center font-mono text-[9px] tracking-[.18em] text-[#cadbd7]">{h === next ? 'CLASSIFIED' : 'LOCKED · BUY EARLIER HINTS FIRST'}</span>
              </div>
            )}
          </li>
        ))}
      </ol>

      {next && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-[#cadbd7]">
            <span className="flex items-center gap-1.5">
              NEXT <Coin size={14} /> <b className="text-[#e8cf91]">{cost}</b>
            </span>
            <span className="flex items-center gap-1.5">
              WALLET <Coin size={14} /> <b className={short ? 'text-[#f49386]' : 'text-[#e8cf91]'}>{wallet.toLocaleString()}</b>
            </span>
          </div>
          <Button secondary className="mt-3 w-full !px-2 !py-2.5" disabled={busy || short || locked} onClick={() => setConfirm(true)}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />}
            {cost > 0 ? `Decrypt hint ${next.level} — ${cost} IdeaCoins` : `Decrypt hint ${next.level} — free`}
          </Button>
          {short && !locked && <p className="mt-2 text-[11px] leading-5 text-[#f3ad92]">Your wallet holds {wallet} IdeaCoins — not enough for this {cost}-coin hint.</p>}
          {locked && lockedReason && <p className="mt-2 text-[11px] leading-5 text-muted">{lockedReason}</p>}
        </>
      )}
      <p className="mt-2 text-[10px] leading-4 text-[#9fb8bf]">
        {metric === 'GROSS_EARNED' ? 'Hints reduce your wallet only — your ranking score is unaffected.' : 'Hints reduce your wallet and your score (score = earned − spent).'}
      </p>
      {error && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-[11px] leading-5 text-[#f3ad92]">
          <ShieldAlert size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <Modal open={confirm && !!next} onClose={() => setConfirm(false)} label="Confirm hint purchase" imposter={imposter}>
        <Label className={accent}>DECRYPT HINT {next?.level}</Label>
        <h3 className="mt-2 font-display text-xl font-bold">Spend {cost} IdeaCoins?</h3>
        <p className="mt-3 text-sm leading-6 text-muted">
          The hint is charged once and stays decrypted for every device of your crew. Wallet after purchase: <b className="text-[#e8cf91]">{Math.max(0, wallet - cost)}</b> IdeaCoins.
          {metric === 'GROSS_EARNED' ? ' Your ranking score is not affected.' : ' Your score drops by the same amount.'}
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button secondary onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button onClick={() => void buy()}>
            <Unlock size={14} />
            Decrypt for {cost}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
