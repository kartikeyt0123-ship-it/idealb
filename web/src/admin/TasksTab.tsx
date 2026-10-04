import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { Badge, Button, Label } from '../components/ui';
import { COIN_TEXT, Empty, GamePicker, Loadable, Notice, NumInput, SMALL, TD, TH, THEAD, TR, fmtTime, useAdminData, useConsole, useRun, useSelectedGame } from './kit';
import type { AdminGame, AdminTask } from './types';

export function TasksTab() {
  const [game, setGame] = useSelectedGame();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Label>TASK DATABASE · ASSIGNED TASK INSTANCES</Label>
        <GamePicker value={game?.id ?? null} onChange={setGame} />
      </div>
      {game ? <TaskList key={game.id} game={game} /> : <Empty>No games configured.</Empty>}
    </div>
  );
}

function TaskList({ game }: { game: AdminGame }) {
  const state = useAdminData<AdminTask[]>(`/api/admin/games/${game.id}/tasks`);
  return (
    <Loadable state={state} title="Tasks" empty={(d) => d.length === 0}>
      {(rows) => <Grouped rows={rows} game={game} reload={state.reload} />}
    </Loadable>
  );
}

function Grouped({ rows, game, reload }: { rows: AdminTask[]; game: AdminGame; reload: () => Promise<void> }) {
  const groups = useMemo(() => {
    const m = new Map<number, Map<string, AdminTask[]>>();
    for (const r of rows) {
      const s = m.get(r.sprint) ?? new Map<string, AdminTask[]>();
      s.set(r.domain, [...(s.get(r.domain) ?? []), r]);
      m.set(r.sprint, s);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [rows]);
  return (
    <div className="space-y-6">
      <Notice>Release / close offsets are seconds after the sprint starts. They can be changed only while the sprint is PENDING or PAUSED. Assign new tasks from the PROBLEM LIBRARY.</Notice>
      {groups.map(([sprint, domains]) => {
        const sp = game.sprints.find((s) => s.number === sprint);
        return (
          <section key={sprint} aria-label={`Sprint ${sprint}`}>
            <div className="mb-2 flex items-center gap-3">
              <h3 className="font-display text-lg font-bold">Sprint {sprint}</h3>
              {sp && <Badge>{sp.status}</Badge>}
              <span className="font-mono text-[10px] text-muted">{[...domains.values()].reduce((a, b) => a + b.length, 0)} task(s)</span>
            </div>
            <div className="space-y-4">
              {[...domains.entries()].map(([domain, tasks]) => (
                <div key={domain} className="overflow-x-auto rounded-xl border-2 border-[#426270] bg-[#142e3a]">
                  <div className="border-b border-[#496370] px-3 py-2"><Label className="!text-primary">ROOM · {domain.toUpperCase()}</Label></div>
                  <table className="w-full min-w-[1000px] text-left text-xs">
                    <caption className="sr-only">Sprint {sprint} {domain} tasks</caption>
                    <thead className={THEAD}>
                      <tr>{['LABEL', 'TITLE', 'DIFFICULTY', 'REWARD', 'STATUS', 'SOLVED BY', 'ATTEMPTS', 'HINTS', 'RELEASE +S', 'CLOSE +S', 'CONTROLS'].map((h) => <th key={h} className={TH} scope="col">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {tasks.map((t) => <TaskRow key={`${t.id}-${t.release_offset_seconds}-${t.close_offset_seconds}`} t={t} editableWindow={sp?.status === 'PENDING' || sp?.status === 'PAUSED'} reload={reload} />)}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TaskRow({ t, editableWindow, reload }: { t: AdminTask; editableWindow: boolean; reload: () => Promise<void> }) {
  const { can, confirm } = useConsole();
  const { busy, run } = useRun();
  const [rel, setRel] = useState(String(t.release_offset_seconds));
  const [cls, setCls] = useState(t.close_offset_seconds === null ? '' : String(t.close_offset_seconds));
  const ctl = can('game.control');
  const dirty = rel !== String(t.release_offset_seconds) || cls !== (t.close_offset_seconds === null ? '' : String(t.close_offset_seconds));

  const saveWindow = async () => {
    const r = Number(rel);
    const c = cls.trim() === '' ? null : Number(cls);
    const body: Record<string, unknown> = {};
    if (rel !== String(t.release_offset_seconds)) body.releaseOffsetSeconds = r;
    if (c !== t.close_offset_seconds) body.closeOffsetSeconds = c;
    await run(`win-${t.id}`, () => api.patch(`/api/admin/tasks/${t.id}`, body), `${t.label} window updated.`);
    await reload();
  };
  const toggleDisabled = async () => {
    const disable = t.status !== 'DISABLED';
    const ok = await confirm({
      title: `${disable ? 'Disable' : 'Enable'} ${t.label}`,
      tone: disable ? 'danger' : 'primary',
      effects: disable ? [`${t.label} "${t.title}" is withdrawn from every crew immediately.`, 'Crews currently working on it can no longer submit.'] : [`${t.label} becomes AVAILABLE again for every crew.`],
      confirmLabel: disable ? 'Disable task' : 'Enable task',
    });
    if (!ok) return;
    await run(`dis-${t.id}`, () => api.patch(`/api/admin/tasks/${t.id}`, { disabled: disable }), `${t.label} ${disable ? 'disabled' : 'enabled'}.`);
    await reload();
  };

  return (
    <tr className={TR}>
      <td className={`${TD} font-mono`}>{t.label}{t.generation > 1 && <span className="ml-1 text-[9px] text-[#ebd68c]">G{t.generation}</span>}</td>
      <td className={TD}>
        {t.title}
        <span className="mt-0.5 block font-mono text-[9px] text-muted">{t.problem_key}</span>
      </td>
      <td className={TD}><Badge>{t.difficulty}</Badge></td>
      <td className={`${TD} ${COIN_TEXT}`}>{t.reward}<span className="block text-[9px] text-muted">hint {t.hint_cost}</span></td>
      <td className={TD}><Badge>{t.status}</Badge></td>
      <td className={TD}>{t.solved_by_name ? <>{t.solved_by_name}<span className="block font-mono text-[9px] text-muted">{t.solved_by_crew} · {fmtTime(t.solved_at)}</span></> : <span className="text-muted">—</span>}</td>
      <td className={`${TD} font-mono`}>{t.attempts}</td>
      <td className={`${TD} font-mono`}>{t.hints_bought}</td>
      <td className={TD}><NumInput value={rel} onChange={setRel} min={0} disabled={!ctl || !editableWindow} className="!w-24" ariaLabel={`${t.label} release offset seconds`} /></td>
      <td className={TD}><NumInput value={cls} onChange={setCls} min={1} disabled={!ctl || !editableWindow} className="!w-24" ariaLabel={`${t.label} close offset seconds (blank = sprint end)`} /></td>
      <td className={TD}>
        {ctl ? (
          <div className="flex flex-col items-start gap-1.5">
            {editableWindow && <Button className={SMALL} disabled={!dirty || busy === `win-${t.id}`} onClick={() => void saveWindow()}>Save window</Button>}
            {t.status !== 'SOLVED' && (
              <Button danger={t.status !== 'DISABLED'} secondary={t.status === 'DISABLED'} className={SMALL} disabled={busy === `dis-${t.id}`} onClick={() => void toggleDisabled()}>
                {t.status === 'DISABLED' ? 'Enable' : 'Disable'}
              </Button>
            )}
          </div>
        ) : <span className="font-mono text-[9px] text-muted">READ ONLY</span>}
      </td>
    </tr>
  );
}
