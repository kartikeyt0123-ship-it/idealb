/**
 * FINAL SYSTEM OUTPUT — server-side verification. The client never decides
 * correctness: success is only reported when the server says CORRECT.
 */
import { AnimatePresence, motion } from 'motion/react';
import { Bug, CheckCircle2, Loader2, RotateCcw, Send } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, newKey, type QuestionDetail, type SubmitResult } from '../lib/api';
import { Button, Label } from '../components/ui';
import { errCode, errMessage } from './util';

const REASONS: Record<string, string> = {
  WRONG_OUTPUT: 'Wrong output',
  RUNTIME_ERROR: 'Runtime error (non-zero exit)',
  TIMEOUT: 'Timed out',
  OUTPUT_LIMIT: 'Output limit exceeded',
};

export function VerifyPanel({
  detail, url, getFiles, answer, onAnswer, disabled, disabledReason, solvedByYou, onCorrect, onError, onBusyChange, imposter,
}: {
  detail: QuestionDetail;
  url: string;
  getFiles: () => Record<string, string>;
  answer: string;
  onAnswer: (v: string) => void;
  disabled: boolean;
  disabledReason: string | null;
  solvedByYou: boolean;
  onCorrect: (r: SubmitResult) => void;
  /** Return a user-facing message (or null when the parent shows its own UI). */
  onError: (code: string, message: string) => string | null;
  onBusyChange?: (busy: boolean) => void;
  imposter: boolean;
}) {
  const v = detail.validation;
  const code = v.mode === 'CODE_TESTS';
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<SubmitResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<{ key: string; sig: string } | null>(null);
  const overlay = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (failed) overlay.current?.focus();
  }, [failed]);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (disabled || busy) return;
    if (!code && !answer.trim()) {
      setMessage('Enter the final system output first.');
      return;
    }
    const body = code ? { generation: detail.generation, files: getFiles() } : { generation: detail.generation, answer };
    const sig = JSON.stringify(body);
    // Reuse the key only when retrying the exact same payload after a network failure.
    const key = pending && pending.sig === sig ? pending.key : newKey('submit');
    setPending({ key, sig });
    setBusy(true);
    onBusyChange?.(true);
    setMessage(null);
    try {
      const r = await api.post<SubmitResult>(url, body, key);
      setPending(null);
      if (r.correct === true && r.result === 'CORRECT') onCorrect(r);
      else setFailed(r);
    } catch (err) {
      const c = errCode(err);
      if (c !== 'NETWORK') setPending(null);
      setMessage(onError(c, errMessage(err)));
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  const rule =
    v.mode === 'EXACT_TEXT'
      ? `${v.caseSensitive ? 'Case-sensitive' : 'Not case-sensitive'} · ${v.collapseWhitespace ? 'extra spaces are collapsed' : 'whitespace must match exactly'}`
      : v.mode === 'NUMERIC'
        ? `Numeric answer${typeof v.tolerance === 'number' && v.tolerance > 0 ? ` · accepted within ±${v.tolerance}` : ' · must match exactly'}`
        : null;

  return (
    <section aria-label="Final system output" className={`flex h-full flex-col rounded-xl border-2 p-4 ${imposter ? 'border-[#c67c6b] bg-[#392e3c]' : 'border-[#4e6b79] bg-[#15303c]'}`}>
      <Label className={imposter ? '!text-[#f0b8a2]' : '!text-primary'}>FINAL SYSTEM OUTPUT</Label>
      {solvedByYou ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm text-primary" role="status">
          <CheckCircle2 size={16} /> System restored by your crew. Reward banked.
        </div>
      ) : code ? (
        <>
          <p className="mt-2 text-[12px] leading-5 text-muted">
            Submit the repaired code. Runs against {v.testCount ?? 'the'} hidden test{v.testCount === 1 ? '' : 's'} on the server; every test must pass.
            {detail.answerFormat ? <span className="mt-1 block text-[#b9cdc8]">{detail.answerFormat}</span> : null}
          </p>
          <Button className="mt-3 w-full !px-2" disabled={disabled || busy} onClick={() => void submit()}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {busy ? 'Verifying on server…' : 'Submit repaired code'}
          </Button>
        </>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="mt-2">
          <p className="text-[12px] leading-5 text-muted">{detail.answerFormat || 'Submit the output of your repaired program.'}</p>
          {rule && <p className="mt-1 font-mono text-[10px] text-[#9fb8bf]">{rule}</p>}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={answer}
              onChange={(e) => onAnswer(e.target.value)}
              aria-label="Final system output"
              placeholder="Enter answer"
              maxLength={500}
              inputMode={v.mode === 'NUMERIC' ? 'decimal' : 'text'}
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
              className="input font-mono"
            />
            <Button type="submit" className="shrink-0 !px-4" disabled={disabled || busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Verify repair
            </Button>
          </div>
        </form>
      )}
      {disabled && disabledReason && !solvedByYou && <p className="mt-2 text-[11px] leading-5 text-[#f3ad92]">{disabledReason}</p>}
      {message && (
        <p role="alert" className="mt-2 text-[11px] leading-5 text-[#f3ad92]">
          {message}
        </p>
      )}

      <AnimatePresence>
        {failed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[85] flex items-center justify-center bg-[#06151d]/90 p-6"
            ref={overlay}
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setFailed(null);
              }
            }}
            role="alertdialog"
            aria-modal="true"
            aria-label="Repair failed"
          >
            <motion.div animate={{ x: [0, -6, 6, -3, 3, 0] }} className="w-full max-w-md rounded-xl border-2 border-[#b67663] bg-[#462f39] p-8 text-center">
              <Bug size={40} className="mx-auto mb-5 text-[#edab8d]" />
              <Label className="!text-[#edab8d]">REPAIR FAILED</Label>
              <h3 className="my-3 font-display text-2xl font-bold">BUG STILL DETECTED</h3>
              <p className="text-xs text-muted">{failed.message || (imposter ? 'The imposter is still among us.' : 'The bug is still among us.')}</p>
              <p className="mt-1 text-[11px] text-[#c9a99f]">The system stays open to every crew — keep debugging.</p>
              {failed.judge && (
                <div className="mt-4 rounded-lg border border-white/10 bg-[#2a1f29] p-3 text-left font-mono text-[11px] leading-5 text-[#ffd8c7]">
                  <div>
                    Tests passed: {failed.judge.passedCount}/{failed.judge.total}
                  </div>
                  {failed.judge.firstFailure && (
                    <>
                      <div>Failing test: #{failed.judge.firstFailure.index}</div>
                      <div>Reason: {REASONS[failed.judge.firstFailure.reason] ?? failed.judge.firstFailure.reason}</div>
                      {failed.judge.firstFailure.stderrTail && (
                        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-black/30 p-2 text-[10px] text-[#f49386]">{failed.judge.firstFailure.stderrTail}</pre>
                      )}
                    </>
                  )}
                </div>
              )}
              <Button danger className="mt-6" onClick={() => setFailed(null)}>
                Try again
                <RotateCcw size={14} />
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
