/**
 * Paid hint. Before purchase only a client-generated decoy is rendered (blurred);
 * the real hint text exists in the DOM only after the server returns it.
 */
import { KeyRound, Loader2, Lock, ShieldAlert, Unlock } from 'lucide-react';
import { useState } from 'react';
import { api, newKey } from '../lib/api';
import { Button, Coin, Label, useToast } from '../components/ui';
import { Modal } from './parts';
import { decoyText, errCode, errMessage, SOLVED_CODES } from './util';

export interface HintResponse {
  hint: string;
  cost: number;
  charged: boolean;
  wallet: number;
}

export function HintPanel({
  url, seed, cost, wallet, text, onUnlocked, onSolvedElsewhere, locked, lockedReason, imposter,
}: {
  url: string;
  seed: string;
  cost: number;
  wallet: number;
  text: string | null;
  onUnlocked: (r: HintResponse) => void;
  onSolvedElsewhere: () => void;
  locked: boolean;
  lockedReason: string | null;
  imposter: boolean;
}) {
  const notify = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState(() => newKey('hint'));
  const short = wallet < cost;

  async function buy() {
    setConfirm(false);
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<HintResponse>(url, {}, idemKey);
      onUnlocked(r);
      if (r.charged && r.cost > 0) notify(`−${r.cost} IdeaCoins / hint decrypted`, 'good');
      else notify('Hint decrypted.', 'good');
    } catch (e) {
      const code = errCode(e);
      if (SOLVED_CODES.has(code)) onSolvedElsewhere();
      if (code === 'INSUFFICIENT_FUNDS') setError(`Not enough IdeaCoins — this hint costs ${cost}. Repair other systems to earn more.`);
      else if (code === 'HINT_UNAVAILABLE') setError(errMessage(e) || 'Hints are unavailable for this system right now.');
      else if (code === 'IMPOSTER_MODE_ACTIVE') setError('Your crew is on an imposter protocol. Regular hints are locked until it ends.');
      else setError(errMessage(e));
      // A definitive server rejection ends this attempt; a network failure keeps the key so a retry is idempotent.
      if (code !== 'NETWORK') setIdemKey(newKey('hint'));
    } finally {
      setBusy(false);
    }
  }

  const accent = imposter ? 'text-[#f0b8a2]' : 'text-[#e1c18b]';
  return (
    <section aria-label="System hint" className={`flex h-full flex-col rounded-xl border-2 p-4 ${imposter ? 'border-[#c67c6b] bg-[#392e3c]' : 'border-[#4e6b79] bg-[#15303c]'}`}>
      <Label className={`flex items-center gap-2 ${accent}`}>
        <KeyRound size={12} />
        SYSTEM HINT / {text != null ? 'DECRYPTED' : 'ENCRYPTED'}
      </Label>

      {text != null ? (
        <p className="mt-3 whitespace-pre-wrap break-words text-[13px] leading-6 text-[#d8e5d8]">{text}</p>
      ) : (
        <>
          <div className="relative mt-3 overflow-hidden rounded-lg border border-white/10 bg-[#0d202c]/60 p-3">
            <p aria-hidden="true" className="pointer-events-none select-none text-xs leading-5 text-[#9fb8bf] blur-[5px]">
              {decoyText(seed)}
            </p>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-[#0d202c]/30">
              <Lock size={22} className={accent} />
              <span className="font-mono text-[9px] tracking-[.18em] text-[#cadbd7]">CLASSIFIED</span>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-[#cadbd7]">
            <span className="flex items-center gap-1.5">
              COST <Coin size={14} /> <b className="text-[#e8cf91]">{cost}</b>
            </span>
            <span className="flex items-center gap-1.5">
              WALLET <Coin size={14} /> <b className={short ? 'text-[#f49386]' : 'text-[#e8cf91]'}>{wallet.toLocaleString()}</b>
            </span>
          </div>
          <Button secondary className="mt-3 w-full !px-2 !py-2.5" disabled={busy || short || locked} onClick={() => setConfirm(true)}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />}
            {cost > 0 ? `Decrypt hint — ${cost} IdeaCoins` : 'Decrypt hint — free'}
          </Button>
          {short && !locked && <p className="mt-2 text-[11px] leading-5 text-[#f3ad92]">Your wallet holds {wallet} IdeaCoins — not enough for this {cost}-coin hint.</p>}
          {locked && lockedReason && <p className="mt-2 text-[11px] leading-5 text-muted">{lockedReason}</p>}
        </>
      )}
      {error && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-[11px] leading-5 text-[#f3ad92]">
          <ShieldAlert size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <Modal open={confirm} onClose={() => setConfirm(false)} label="Confirm hint purchase" imposter={imposter}>
        <Label className={accent}>DECRYPT SYSTEM HINT</Label>
        <h3 className="mt-2 font-display text-xl font-bold">Spend {cost} IdeaCoins?</h3>
        <p className="mt-3 text-sm leading-6 text-muted">
          The hint is charged once and stays decrypted for your crew. Wallet after purchase: <b className="text-[#e8cf91]">{Math.max(0, wallet - cost)}</b> IdeaCoins.
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
