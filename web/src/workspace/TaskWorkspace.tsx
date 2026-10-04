/**
 * AMONG BUGS — task workspace ("engineering terminal").
 *
 * Toolbar · two resizable panels (Problem/Code | Preview/Console/Output/...) ·
 * verification form + paid hint below. All scoring is server-side; this
 * component never decides correctness, never fakes run output and never puts
 * an unpurchased hint in the DOM.
 */
import { AlertTriangle, ArrowLeft, Bug, Clock, Eraser, FileText, Flag, Lock, PauseCircle, RefreshCw, RotateCcw, ScrollText, Save, ShieldX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { ApiError, api, serverNow, type SubmitResult, type TaskDetail } from '../lib/api';
import { Badge, Button, Coin, Crewmate, Label, StatePanel, Timer, useToast } from '../components/ui';
import './monacoSetup';
import { CodeEditor } from './CodeEditor';
import { HintPanel, type HintResponse } from './HintPanel';
import { CsvTable, Modal, SplitPanels, Statement, Tabs, useMediaQuery } from './parts';
import { PreviewFrame, type PreviewConsoleLevel } from './PreviewFrame';
import { RunButtons, RunConsole, useServerRun } from './serverRun';
import {
  buildPreviewDoc, CLOSED_CODES, ELIMINATED_CODES, errCode, errMessage, isCsv, readDraft, rightKind, SOLVED_CODES, writeDraft, type DraftScope,
} from './util';
import { VerifyPanel } from './VerifyPanel';

export interface WorkspaceProps {
  target: { type: 'TASK' | 'IMPOSTER'; id: string };
  crew: { crewId: string; name: string; color: string };
  /** Current wallet from the parent snapshot (refreshes live). */
  wallet: number;
  rank: number | null;
  /** e.g. "GAME 1 · SPRINT 2" */
  contextLabel: string;
  /** Authoritative sprint deadline (ISO, server time). Imposters prefer the detail's solveDeadlineAt. */
  deadlineAt: string | null;
  paused: boolean;
  /** Parent sets true when a realtime event says another crew won this task. */
  externallySolved: boolean;
  /** Back to the Task Deck (drafts are preserved). */
  onExit: () => void;
  onSolved: (r: { reward: number; wallet: number }) => void;
  /** Ask the parent to refetch its snapshot (after hint purchase etc.). */
  onChanged: () => void;
}

const CLOSED_TEXT = 'Time is up — this system is closed.';
const SOLVED_ELSEWHERE_TEXT = 'This problem has already been solved by another crew. Move on to the next task.';

const basePath = (t: WorkspaceProps['target']) => (t.type === 'TASK' ? `/api/game/tasks/${encodeURIComponent(t.id)}` : `/api/game/imposter/${encodeURIComponent(t.id)}`);

// ---------------------------------------------------------------------------
// Loader shell
// ---------------------------------------------------------------------------

export function TaskWorkspace(props: WorkspaceProps) {
  const { target, onExit } = props;
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const ctl = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    ctl.current?.abort();
    const ac = new AbortController();
    ctl.current = ac;
    setLoading(true);
    setError(null);
    try {
      const d = await api.get<TaskDetail>(basePath(target), ac.signal);
      if (!ac.signal.aborted) setDetail(d);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      if (!ac.signal.aborted) setError(e);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [target.type, target.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDetail(null);
    void load();
    return () => ctl.current?.abort();
  }, [load]);

  const back = (
    <Button secondary onClick={onExit}>
      <ArrowLeft size={14} /> Back to Task Deck
    </Button>
  );

  if (!detail) {
    if (loading || !error) {
      return (
        <Shell>
          <StatePanel kind="loading" title="Connecting to ship terminal…" message="Downloading the bugged program." />
        </Shell>
      );
    }
    const code = errCode(error);
    if (code === 'TASK_NOT_RELEASED') {
      return (
        <Shell>
          <StatePanel kind="empty" title="This system is still locked" message="It will be released later in the sprint. Check the Task Deck." action={back} />
        </Shell>
      );
    }
    if (ELIMINATED_CODES.has(code)) {
      return (
        <Shell>
          <StatePanel kind="error" title="Your crew was ejected" message={errMessage(error)} action={back} />
        </Shell>
      );
    }
    const retryable = !(error instanceof ApiError) || error.status === 0 || error.status >= 500 || code === 'RATE_LIMITED';
    return (
      <Shell>
        <StatePanel
          kind="error"
          title={code === 'NETWORK' ? 'Ship comms are down' : code === 'NOT_FOUND' ? 'System not found' : 'Terminal unavailable'}
          message={errMessage(error)}
          action={
            <div className="flex flex-wrap justify-center gap-3">
              {retryable && (
                <Button onClick={() => void load()}>
                  <RefreshCw size={14} /> Retry
                </Button>
              )}
              {back}
            </div>
          }
        />
      </Shell>
    );
  }

  return <LoadedWorkspace key={`${detail.id}:${detail.generation}`} {...props} detail={detail} reload={load} reloading={loading} />;
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-xl p-6">{children}</div>;
}

// ---------------------------------------------------------------------------
// Loaded workspace
// ---------------------------------------------------------------------------

interface ConsoleLine {
  id: number;
  level: PreviewConsoleLevel;
  text: string;
}
type SaveState = { state: 'idle' | 'pending' | 'saved' | 'failed'; at: number | null };

function LoadedWorkspace(props: WorkspaceProps & { detail: TaskDetail; reload: () => Promise<void>; reloading: boolean }) {
  const { detail, target, crew, onExit, onSolved, onChanged, paused, externallySolved, reload, reloading } = props;
  const notify = useToast();
  const imposter = target.type === 'IMPOSTER';
  const stacked = useMediaQuery('(max-width: 899px)');
  const kind = rightKind(detail);
  const files = detail.files;
  const editable = useMemo(() => files.filter((f) => !f.readOnly), [files]);
  const scope = useMemo<DraftScope>(() => ({ crewId: crew.crewId, targetType: target.type, targetId: detail.id, generation: detail.generation }), [crew.crewId, target.type, detail.id, detail.generation]);
  const modelPrefix = `ab/${encodeURIComponent(crew.crewId)}/${target.type}/${detail.id}/g${detail.generation}`;

  // ---- editor contents & drafts -------------------------------------------------
  const [contents, setContents] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of files) out[f.name] = f.readOnly ? f.content : (readDraft(scope, f.name) ?? f.content);
    return out;
  });
  const [notes, setNotes] = useState(() => readDraft(scope, '__notes') ?? '');
  const [answer, setAnswer] = useState(() => readDraft(scope, '__answer') ?? '');
  const [stdin, setStdin] = useState(detail.sampleStdin ?? '');
  const [save, setSave] = useState<SaveState>({ state: 'idle', at: null });
  const restored = useMemo(() => editable.some((f) => readDraft(scope, f.name) !== null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const saved = useRef<Record<string, string>>({});
  const flush = useCallback(() => {
    let ok = true;
    let wrote = false;
    const put = (name: string, value: string, starter: string) => {
      const v = value === starter ? null : value;
      const prev = saved.current[name];
      if (prev === (v ?? '\u0000')) return;
      ok = writeDraft(scope, name, v) && ok;
      saved.current[name] = v ?? '\u0000';
      wrote = true;
    };
    for (const f of editable) put(f.name, contents[f.name] ?? f.content, f.content);
    put('__notes', notes, '');
    put('__answer', answer, '');
    return { ok, wrote };
  }, [scope, editable, contents, notes, answer]);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const firstSave = useRef(true);
  useEffect(() => {
    if (firstSave.current) {
      firstSave.current = false;
      flushRef.current(); // prime the "saved" cache without flashing the indicator
      return;
    }
    setSave((s) => ({ ...s, state: 'pending' }));
    const t = window.setTimeout(() => {
      const r = flushRef.current();
      setSave({ state: r.ok ? 'saved' : 'failed', at: Date.now() });
    }, 700);
    return () => window.clearTimeout(t);
  }, [contents, notes, answer]);
  useEffect(() => () => void flushRef.current(), []);

  const [activeFile, setActiveFile] = useState(() => {
    const entry = detail.runEntry && editable.find((f) => f.name === detail.runEntry);
    return (entry || editable[0] || files[0])?.name ?? '';
  });

  // ---- status ---------------------------------------------------------------------
  const initiallySolvedByYou = detail.status === 'SOLVED_BY_YOU' || (imposter && detail.reservationStatus === 'SOLVED');
  const [solvedByYou, setSolvedByYou] = useState(initiallySolvedByYou);
  const [solvedElsewhere, setSolvedElsewhere] = useState(!imposter && detail.status === 'SOLVED');
  const [closed, setClosed] = useState<string | null>(() => {
    if (initiallySolvedByYou) return null;
    if (!imposter && detail.status === 'CLOSED') return "This system's repair window has closed.";
    if (imposter && ['EXPIRED', 'CANCELLED'].includes(detail.status)) return 'This imposter protocol has ended.';
    if (imposter && detail.status === 'SOLVED') return 'This imposter has already been eliminated.';
    if (imposter && detail.reservationStatus && detail.reservationStatus !== 'ACTIVE') return 'Your imposter protocol is no longer active.';
    return null;
  });
  const [stale, setStale] = useState(false);
  const [eliminated, setEliminated] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [walletOverride, setWalletOverride] = useState<number | null>(null);
  useEffect(() => setWalletOverride(null), [props.wallet]);
  const wallet = walletOverride ?? props.wallet;

  useEffect(() => {
    if (externallySolved && !solvedByYou && !submitting) setSolvedElsewhere(true);
  }, [externallySolved, solvedByYou, submitting]);

  // ---- countdown -------------------------------------------------------------------
  const deadline = imposter ? (detail.solveDeadlineAt ?? props.deadlineAt) : (props.deadlineAt ?? detail.sprintDeadlineAt ?? null);
  const calc = useCallback(() => {
    const t = deadline ? Date.parse(deadline) : NaN;
    return Number.isFinite(t) ? Math.max(0, (t - serverNow()) / 1000) : null;
  }, [deadline]);
  const [remaining, setRemaining] = useState(calc);
  useEffect(() => {
    setRemaining(calc());
    const id = window.setInterval(() => setRemaining(calc()), 500);
    return () => window.clearInterval(id);
  }, [calc]);
  const timeUp = remaining !== null && remaining <= 0 && !paused;

  const locked = !!closed || timeUp || !!eliminated || solvedElsewhere;
  const lockReason = eliminated ?? (solvedElsewhere ? SOLVED_ELSEWHERE_TEXT : closed || timeUp ? CLOSED_TEXT : null);
  const submitDisabled = locked || solvedByYou || paused || stale;
  const submitReason = lockReason ?? (paused ? 'The commander paused the sprint. Hold position.' : stale ? 'This system was reset. Reload it before submitting.' : null);

  // ---- shared error handling -------------------------------------------------------
  const handleError = useCallback(
    (code: string, message: string): string | null => {
      if (SOLVED_CODES.has(code)) {
        setSolvedElsewhere(true);
        return null;
      }
      if (CLOSED_CODES.has(code) || code === 'IMPOSTER_NOT_OWNER' || code === 'IMPOSTER_CLAIMED') {
        setClosed(message || CLOSED_TEXT);
        return `${CLOSED_TEXT} (${message})`;
      }
      if (code === 'STALE_TASK') {
        setStale(true);
        return 'This system was reset by the commander. Reload it to get the new version.';
      }
      if (ELIMINATED_CODES.has(code)) {
        setEliminated(message);
        return message;
      }
      if (code === 'SPRINT_PAUSED') return 'The commander paused the sprint. Hold position — try again when it resumes.';
      if (code === 'IMPOSTER_MODE_ACTIVE') return 'Your crew is on an imposter protocol. Finish or abandon it before repairing regular systems.';
      if (code === 'RATE_LIMITED') return message || 'Too many attempts. Wait a few seconds.';
      if (code === 'RUNNER_UNAVAILABLE' || code === 'RUNNER_BUSY' || code === 'RUNTIME_UNAVAILABLE')
        return `The verification runner could not judge your code: ${message} Nothing was scored — try again shortly.`;
      if (code === 'NETWORK') return `${message} Your submission may not have arrived; resubmitting is safe.`;
      return message;
    },
    [],
  );

  // ---- server run ------------------------------------------------------------------
  const runner = useServerRun(target);
  const editableFiles = useCallback(() => Object.fromEntries(editable.map((f) => [f.name, contents[f.name] ?? f.content])), [editable, contents]);
  const canServerRun = !!detail.runLanguage && kind !== 'WEB';
  const doRun = () => void runner.run(editableFiles(), stdin);
  useEffect(() => {
    if (runner.state.phase === 'error' && (CLOSED_CODES.has(runner.state.code) || ELIMINATED_CODES.has(runner.state.code))) handleError(runner.state.code, runner.state.message);
  }, [runner.state, handleError]);

  // ---- preview ---------------------------------------------------------------------
  const [preview, setPreview] = useState<{ doc: string | null; nonce: number }>(() => ({ doc: kind === 'WEB' ? buildPreviewDoc(files, contents) : null, nonce: 1 }));
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const lineId = useRef(0);
  const pushLine = useCallback((level: PreviewConsoleLevel, text: string) => {
    setLines((ls) => {
      const next = [...ls, { id: ++lineId.current, level, text }];
      return next.length > 300 ? next.slice(next.length - 300) : next;
    });
  }, []);
  const refreshPreview = () => {
    pushLine('system', `— preview refreshed ${new Date().toLocaleTimeString()} —`);
    setPreview((p) => ({ doc: buildPreviewDoc(files, contents), nonce: p.nonce + 1 }));
  };

  // ---- tabs ------------------------------------------------------------------------
  const [leftTab, setLeftTab] = useState<'statement' | 'code'>('statement');
  type RT = 'preview' | 'console' | 'output' | 'dataset' | 'input' | 'evidence' | 'notes';
  const rightTabs: { id: RT; label: string; icon?: ReactNode }[] =
    kind === 'WEB'
      ? [{ id: 'preview', label: 'Live Preview' }, { id: 'console', label: `Console${lines.length ? ` (${lines.length})` : ''}` }]
      : kind === 'DATA'
        ? [{ id: 'output', label: 'Output' }, { id: 'dataset', label: 'Dataset' }]
        : kind === 'RUN'
          ? [{ id: 'console', label: 'Console' }, { id: 'input', label: 'Input' }]
          : [{ id: 'evidence', label: 'Evidence' }, { id: 'notes', label: 'Notes' }];
  const [rightTab, setRightTab] = useState<RT>(rightTabs[0].id);

  const csvFiles = files.filter(isCsv);
  const [csvActive, setCsvActive] = useState(csvFiles[0]?.name ?? '');
  const evidence = files.filter((f) => f.readOnly);
  const [evidenceActive, setEvidenceActive] = useState((evidence[0] ?? files[0])?.name ?? '');

  // ---- dialogs ---------------------------------------------------------------------
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [abandoning, setAbandoning] = useState(false);

  const resetToStarter = () => {
    setConfirmReset(false);
    setContents((c) => {
      const next = { ...c };
      for (const f of editable) next[f.name] = f.content;
      return next;
    });
    for (const f of editable) writeDraft(scope, f.name, null);
    notify('Code reset to the original bugged program.', 'info');
  };

  const abandon = async () => {
    setAbandoning(true);
    try {
      await api.post(`${basePath(target)}/abandon`, {});
      setConfirmAbandon(false);
      notify('Imposter protocol abandoned.', 'alert');
      onChanged();
      onExit();
    } catch (e) {
      notify(errMessage(e), 'alert');
    } finally {
      setAbandoning(false);
    }
  };

  const [hintText, setHintText] = useState<string | null>(detail.hint.unlocked ? detail.hint.text : null);
  const onCorrect = (r: SubmitResult) => {
    setSolvedByYou(true);
    setWalletOverride(r.wallet);
    onSolved({ reward: r.reward ?? detail.reward, wallet: r.wallet });
  };
  const onHint = (r: HintResponse) => {
    setHintText(r.hint);
    setWalletOverride(r.wallet);
    onChanged();
  };

  // ---- keyboard isolation ----------------------------------------------------------
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest?.('[role="dialog"],[role="alertdialog"]') && (e.key === 'Escape' || e.key === 'Tab')) return;
    if (e.key === 'Escape') {
      const typing = !!t.closest?.('.monaco-editor') || !!t.matches?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
      if (!typing) return; // let Escape bubble to the game shell
    }
    e.stopPropagation();
  };

  // ---- theme -----------------------------------------------------------------------
  const border = imposter ? 'border-[#c67c6b]' : 'border-[#4e6b79]';
  const panelBg = imposter ? 'bg-[#2a2230]' : 'bg-[#0d202c]';
  const accentText = imposter ? 'text-[#f0b8a2]' : 'text-primary';

  // ---- render pieces ---------------------------------------------------------------
  const saveLabel =
    save.state === 'pending' ? 'Saving draft…' : save.state === 'saved' ? `Draft saved ${save.at ? new Date(save.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}` : save.state === 'failed' ? 'Drafts unavailable (storage blocked)' : restored ? 'Draft restored' : 'Autosave on';

  const left = (
    <div className={`flex h-full min-h-0 flex-col overflow-hidden rounded-xl border-2 ${border} ${panelBg}`}>
      <Tabs
        label="Problem and code"
        imposter={imposter}
        value={leftTab}
        onChange={setLeftTab}
        tabs={[
          { id: 'statement', label: 'Problem Statement', icon: <ScrollText size={12} /> },
          { id: 'code', label: 'Code Editor', icon: <FileText size={12} /> },
        ]}
        right={
          leftTab === 'code' && editable.length > 0 ? (
            <>
              <span className={`hidden items-center gap-1 font-mono text-[9px] sm:flex ${save.state === 'failed' ? 'text-[#f3ad92]' : 'text-[#6c929d]'}`} aria-live="polite">
                <Save size={11} /> {saveLabel}
              </span>
              <button
                type="button"
                title="Reset to starter code"
                aria-label="Reset to starter code"
                disabled={locked}
                onClick={() => setConfirmReset(true)}
                className="rounded p-1.5 text-[#8eafb8] hover:bg-[#3e5966] disabled:opacity-40"
              >
                <RotateCcw size={13} />
              </button>
            </>
          ) : null
        }
      />
      <div className="flex shrink-0 items-center gap-2 border-b border-[#904e46]/30 bg-[#904e46]/10 px-3 py-1.5 font-mono text-[8px] tracking-wider text-[#e4a18d]">
        <Bug size={11} />
        {solvedByYou ? 'SYSTEM RESTORED / BUG EJECTED' : imposter ? 'IMPOSTER DETECTED / ELIMINATE IT' : 'BUG DETECTED / REPAIR REQUIRED'}
      </div>
      <div className="relative min-h-0 flex-1">
        <div role="tabpanel" className={leftTab === 'statement' ? 'h-full overflow-y-auto p-4' : 'hidden'}>
          <Label className={imposter ? '!text-[#f0b8a2]' : ''}>REPAIR OBJECTIVE</Label>
          <h3 className="mb-3 mt-1 font-display text-lg font-bold text-[#e9f2ee]">{detail.title}</h3>
          <Statement text={detail.statement} />
          <div className="mt-5 border-t border-white/10 pt-3">
            <Label>SHIP FILES</Label>
            <ul className="mt-2 flex flex-wrap gap-2">
              {files.map((f) => (
                <li key={f.name}>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveFile(f.name);
                      setLeftTab('code');
                    }}
                    className="flex items-center gap-1.5 rounded border border-[#36515f] px-2 py-1 font-mono text-[10px] text-[#b5d1cc] hover:border-primary/60"
                  >
                    {f.readOnly ? <Lock size={10} className="text-[#e5cf8f]" /> : <FileText size={10} />}
                    {f.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div role="tabpanel" className={leftTab === 'code' ? 'h-full' : 'hidden'}>
          <CodeEditor
            files={files}
            contents={contents}
            active={activeFile}
            onActive={setActiveFile}
            onChange={(name, v) => setContents((c) => (c[name] === v ? c : { ...c, [name]: v }))}
            disabled={locked}
            modelPrefix={modelPrefix}
            imposter={imposter}
          />
        </div>
      </div>
      <div className="flex shrink-0 justify-between gap-2 border-t border-[#36515f] px-3 py-1.5 font-mono text-[8px] tracking-wider text-[#6c929d]">
        <span>{(detail.runLanguage ?? detail.workspace).toUpperCase()} / UTF-8</span>
        <span>{detail.validation.mode === 'CODE_TESTS' ? 'SERVER VERIFICATION · HIDDEN TESTS' : 'SERVER VERIFICATION'}</span>
      </div>
    </div>
  );

  const runControls = canServerRun ? <RunButtons state={runner.state} onRun={doRun} onCancel={() => void runner.cancel()} disabled={locked || paused} /> : null;

  const rightRight =
    kind === 'WEB' ? (
      rightTab === 'console' ? (
        <>
          <button type="button" onClick={() => setLines([])} className="flex items-center gap-1 rounded px-2 py-1 font-mono text-[9px] text-[#8eafb8] hover:bg-white/5">
            <Eraser size={11} /> Clear
          </button>
          <Button className="!px-3 !py-1.5 !text-[10px]" onClick={refreshPreview}>
            <RefreshCw size={12} /> Run / Refresh Preview
          </Button>
        </>
      ) : (
        <Button className="!px-3 !py-1.5 !text-[10px]" onClick={refreshPreview}>
          <RefreshCw size={12} /> Run / Refresh Preview
        </Button>
      )
    ) : (
      runControls
    );

  const right = (
    <div className={`flex h-full min-h-0 flex-col overflow-hidden rounded-xl border-2 ${border} ${panelBg}`}>
      <Tabs label="Ship terminal" imposter={imposter} value={rightTab} onChange={setRightTab} tabs={rightTabs} right={rightRight} />
      <div className="relative min-h-0 flex-1">
        {kind === 'WEB' && (
          <>
            <div role="tabpanel" className={rightTab === 'preview' ? 'flex h-full flex-col' : 'hidden'}>
              <div className="min-h-0 flex-1 p-2">
                <PreviewFrame doc={preview.doc} nonce={preview.nonce} onConsole={pushLine} onRendered={() => undefined} />
              </div>
              <p className="shrink-0 border-t border-[#36515f] px-3 py-1.5 font-mono text-[9px] text-[#6c929d]">Preview is a sandbox; final verification runs on the server.</p>
            </div>
            <div role="tabpanel" className={rightTab === 'console' ? 'h-full overflow-y-auto p-3 font-mono text-[11px] leading-5' : 'hidden'} aria-live="polite">
              {lines.length === 0 ? (
                <p className="text-[#537681]">{'> console is quiet — console.log output from the preview appears here'}</p>
              ) : (
                lines.map((l) => (
                  <div
                    key={l.id}
                    className={`whitespace-pre-wrap break-words border-b border-white/5 py-0.5 ${
                      l.level === 'error' ? 'text-[#f49386]' : l.level === 'warn' ? 'text-[#ebd68c]' : l.level === 'system' ? 'text-[#537681]' : 'text-[#d8ede3]'
                    }`}
                  >
                    {l.level !== 'system' && <span className="mr-2 text-[#537681]">{l.level}</span>}
                    {l.text}
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {kind === 'DATA' && (
          <>
            <div role="tabpanel" className={rightTab === 'output' ? 'h-full' : 'hidden'}>
              {canServerRun ? <RunConsole state={runner.state} language={detail.runLanguage} /> : <p className="p-4 font-mono text-xs text-muted">This system has no server runtime — analyse the dataset and submit your answer below.</p>}
            </div>
            <div role="tabpanel" className={rightTab === 'dataset' ? 'flex h-full flex-col' : 'hidden'}>
              {csvFiles.length > 1 && (
                <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-[#36515f] px-2 py-1">
                  {csvFiles.map((f) => (
                    <button key={f.name} type="button" onClick={() => setCsvActive(f.name)} className={`rounded px-2 py-1 font-mono text-[10px] ${csvActive === f.name ? 'bg-[#1d3a48] text-primary' : 'text-[#8eafb8]'}`}>
                      {f.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="min-h-0 flex-1">
                {csvFiles.length === 0 ? (
                  <p className="p-4 font-mono text-xs text-muted">No CSV dataset attached to this system.</p>
                ) : (
                  <CsvTable name={csvActive} text={contents[csvActive] ?? csvFiles.find((f) => f.name === csvActive)?.content ?? ''} />
                )}
              </div>
            </div>
          </>
        )}

        {kind === 'RUN' && (
          <>
            <div role="tabpanel" className={rightTab === 'console' ? 'h-full' : 'hidden'}>
              <RunConsole state={runner.state} language={detail.runLanguage} />
            </div>
            <div role="tabpanel" className={rightTab === 'input' ? 'flex h-full flex-col p-3' : 'hidden'}>
              <div className="mb-2 flex items-center justify-between">
                <Label>STDIN (sent with Run)</Label>
                {detail.sampleStdin != null && (
                  <button type="button" onClick={() => setStdin(detail.sampleStdin ?? '')} className="font-mono text-[9px] text-[#8eafb8] hover:text-primary">
                    Reset to sample
                  </button>
                )}
              </div>
              <textarea
                value={stdin}
                onChange={(e) => setStdin(e.target.value.slice(0, 20_000))}
                spellCheck={false}
                aria-label="Standard input for Run"
                className="input min-h-0 flex-1 resize-none font-mono !text-xs"
              />
            </div>
          </>
        )}

        {kind === 'EVIDENCE' && (
          <>
            <div role="tabpanel" className={rightTab === 'evidence' ? 'flex h-full flex-col' : 'hidden'}>
              {evidence.length > 1 && (
                <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-[#36515f] px-2 py-1">
                  {evidence.map((f) => (
                    <button key={f.name} type="button" onClick={() => setEvidenceActive(f.name)} className={`flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] ${evidenceActive === f.name ? 'bg-[#1d3a48] text-primary' : 'text-[#8eafb8]'}`}>
                      <Lock size={10} /> {f.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-auto">
                {(() => {
                  const f = files.find((x) => x.name === evidenceActive);
                  if (!f) return <p className="p-4 font-mono text-xs text-muted">No evidence files for this system.</p>;
                  return isCsv(f) ? <CsvTable name={f.name} text={f.content} /> : <pre className="whitespace-pre-wrap break-words p-4 font-mono text-[11.5px] leading-5 text-[#cadbd7]">{f.content}</pre>;
                })()}
              </div>
            </div>
            <div role="tabpanel" className={rightTab === 'notes' ? 'flex h-full flex-col p-3' : 'hidden'}>
              <Label className="mb-2">CREW SCRATCHPAD (saved as a draft on this device)</Label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 50_000))} aria-label="Notes" className="input min-h-0 flex-1 resize-none font-mono !text-xs" placeholder="Work out the answer here…" />
            </div>
          </>
        )}
      </div>
    </div>
  );

  // ---- layout ----------------------------------------------------------------------
  return (
    <div onKeyDown={onKeyDown} className={`relative flex w-full flex-col gap-3 p-3 sm:p-4 ${imposter ? 'bg-[#1d1520]/40' : ''}`} data-workspace={target.type}>
      {/* Toolbar */}
      <header className={`flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border-2 px-4 py-3 ${imposter ? 'border-[#c67c6b] bg-[#392e3c]' : 'border-[#4e6b79] bg-[#15303c]'}`}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Crewmate color={crew.color} size={34} state={solvedByYou ? 'celebrating' : locked ? 'warning' : 'working'} />
          <div className="min-w-0">
            <Label className={imposter ? '!text-[#e8ae94]' : '!text-primary'}>
              {imposter ? 'IMPOSTER PROTOCOL' : 'ENGINEERING TERMINAL'} · {props.contextLabel}
            </Label>
            <div className="mt-0.5 flex min-w-0 items-center gap-2">
              {detail.domain && (
                <span className="flex shrink-0 items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[10px]" style={{ borderColor: `${detail.domain.color}66`, color: detail.domain.color }} title={`${detail.domain.name} · ${detail.domain.room}`}>
                  <span aria-hidden="true">{detail.domain.symbol}</span>
                  {detail.domain.name}
                </span>
              )}
              <h2 className="truncate font-display text-lg font-bold sm:text-xl">
                <span className={accentText}>{detail.label}</span> / {detail.title}
              </h2>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Badge>{detail.difficulty}</Badge>
          <span className="flex items-center gap-1.5 font-mono text-xs text-[#e8cf91]" title="Reward">
            <Coin size={16} /> +{detail.reward}
          </span>
          {props.rank != null && (
            <span className="font-mono text-sm text-primary" title="Your rank">
              #{props.rank}
            </span>
          )}
          <span className="flex items-center gap-1.5 font-mono text-xs text-[#e8cf91]" title="Wallet">
            <Label className="!text-[7px]">WALLET</Label>
            {wallet.toLocaleString()}
          </span>
          <div className="min-w-[72px]">
            <Label className="!text-[7px]">{imposter ? 'PROTOCOL TIME' : 'ROUND TIME'}</Label>
            {paused ? (
              <span className="flex items-center gap-1 font-mono text-lg font-semibold text-[#ebd68c]">
                <PauseCircle size={15} /> PAUSED
              </span>
            ) : remaining === null ? (
              <span className="font-mono text-lg text-muted">--:--</span>
            ) : (
              <Timer seconds={remaining} className="text-lg" />
            )}
          </div>
          {imposter && detail.reservationStatus === 'ACTIVE' && !solvedByYou && (
            <Button danger className="!px-3 !py-2 !text-[10px]" onClick={() => setConfirmAbandon(true)}>
              <Flag size={13} /> Abandon protocol
            </Button>
          )}
          <Button secondary className="!px-3 !py-2 !text-[10px]" onClick={onExit}>
            <ArrowLeft size={13} /> Back to Task Deck
          </Button>
        </div>
      </header>

      {/* Status strip */}
      {(stale || paused || eliminated || (locked && !solvedElsewhere)) && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-[#9d635a] bg-[#442b34]/80 px-4 py-2 text-xs text-[#ffd8c7]">
          {stale ? (
            <>
              <AlertTriangle size={15} /> This system was reset by the commander. Your edits are kept as a draft for the old version.
              <Button className="!px-3 !py-1.5 !text-[10px]" disabled={reloading} onClick={() => void reload()}>
                <RefreshCw size={12} className={reloading ? 'animate-spin' : ''} /> Reload system
              </Button>
            </>
          ) : eliminated ? (
            <>
              <ShieldX size={15} /> {eliminated}
            </>
          ) : locked ? (
            <>
              <Clock size={15} /> {CLOSED_TEXT}
              {closed && closed !== CLOSED_TEXT ? <span className="text-[#c9a99f]">{closed}</span> : null}
            </>
          ) : (
            <>
              <PauseCircle size={15} /> Sprint paused by the commander. You can keep editing; Run and Submit resume when the sprint does.
            </>
          )}
        </div>
      )}

      {/* Parallel panels */}
      <div className={stacked ? '' : 'h-[55vh] min-h-[340px]'}>
        <SplitPanels left={left} right={right} stacked={stacked} prefKey="workspace-split" imposter={imposter} />
      </div>

      {/* Verification + hint */}
      <div className="grid gap-3 min-[900px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <VerifyPanel
          detail={detail}
          url={`${basePath(target)}/submit`}
          getFiles={editableFiles}
          answer={answer}
          onAnswer={setAnswer}
          disabled={submitDisabled}
          disabledReason={submitReason}
          solvedByYou={solvedByYou}
          onCorrect={onCorrect}
          onError={handleError}
          onBusyChange={setSubmitting}
          imposter={imposter}
        />
        <HintPanel
          url={`${basePath(target)}/hint`}
          seed={`${detail.id}:${detail.generation}`}
          cost={detail.hint.cost}
          wallet={wallet}
          text={hintText}
          onUnlocked={onHint}
          onSolvedElsewhere={() => setSolvedElsewhere(true)}
          locked={locked || solvedByYou || paused}
          lockedReason={solvedByYou ? 'System already restored — no hint needed.' : paused ? 'Hints are paused with the sprint.' : lockReason}
          imposter={imposter}
        />
      </div>

      {/* Dialogs */}
      <Modal open={solvedElsewhere} onClose={onExit} label="Task already solved" imposter={imposter} closeOnBackdrop={false}>
        <div className="text-center">
          <Bug size={36} className="mx-auto mb-4 text-[#edab8d]" />
          <Label className="!text-[#edab8d]">SYSTEM ALREADY RESTORED</Label>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#e4eee8]">{SOLVED_ELSEWHERE_TEXT}</p>
          <p className="mt-2 text-xs text-muted">Your draft is kept on this device.</p>
          <div className="mt-6 flex justify-center">
            <Button onClick={onExit}>Acknowledge</Button>
          </div>
        </div>
      </Modal>

      <Modal open={confirmReset} onClose={() => setConfirmReset(false)} label="Reset code" imposter={imposter}>
        <Label className="!text-[#edab8d]">RESET TO STARTER</Label>
        <h3 className="mt-2 font-display text-xl font-bold">Discard your repairs?</h3>
        <p className="mt-3 text-sm leading-6 text-muted">Every editable file goes back to the original bugged program and the saved draft is cleared. This cannot be undone.</p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button secondary onClick={() => setConfirmReset(false)}>
            Keep my code
          </Button>
          <Button danger onClick={resetToStarter}>
            <RotateCcw size={14} /> Reset code
          </Button>
        </div>
      </Modal>

      <Modal open={confirmAbandon} onClose={() => !abandoning && setConfirmAbandon(false)} label="Abandon imposter protocol" imposter>
        <Label className="!text-[#f0b8a2]">ABANDON PROTOCOL</Label>
        <h3 className="mt-2 font-display text-xl font-bold">Let the imposter go?</h3>
        <p className="mt-3 text-sm leading-6 text-muted">Your crew releases this imposter problem and returns to regular systems. You cannot reclaim it.</p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button secondary disabled={abandoning} onClick={() => setConfirmAbandon(false)}>
            Stay on protocol
          </Button>
          <Button danger disabled={abandoning} onClick={() => void abandon()}>
            <Flag size={14} /> {abandoning ? 'Abandoning…' : 'Abandon protocol'}
          </Button>
        </div>
      </Modal>

    </div>
  );
}
