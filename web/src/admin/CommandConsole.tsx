/**
 * COMMANDER CONSOLE — the ship's command terminal (admin portal).
 * Rendered inside the ship dialog, or standalone at /command (low-power route).
 */
import { LogOut, RefreshCw, Satellite } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import { ApiError, api, syncClock } from '../lib/api';
import { Badge, Button, Crewmate, Label, StatePanel } from '../components/ui';
import { ConsoleCtx, SMALL, canRole, toApiError, useConfirmHost, type ConsoleCtxValue } from './kit';
import type { Overview, Permission } from './types';
import { CrewTab } from './CrewTab';
import { GameTab } from './GameTab';
import { TasksTab } from './TasksTab';
import { ImpostersTab } from './ImpostersTab';
import { CoinsTab } from './CoinsTab';
import { EliminationTab } from './EliminationTab';
import { LibraryTab } from './LibraryTab';
import { RankingsTab } from './RankingsTab';
import { StatusTab } from './StatusTab';

type TabId = 'crew' | 'game' | 'tasks' | 'imposters' | 'coins' | 'elimination' | 'library' | 'rankings' | 'status';

const TABS: { id: TabId; label: string; needs?: Permission }[] = [
  { id: 'crew', label: 'CREW', needs: 'crews.read' },
  { id: 'game', label: 'GAME & SPRINT' },
  { id: 'tasks', label: 'TASKS', needs: 'crews.read' },
  { id: 'imposters', label: 'IMPOSTERS' },
  { id: 'coins', label: 'IDEACOINS', needs: 'crews.read' },
  { id: 'elimination', label: 'ELIMINATION', needs: 'game.control' },
  { id: 'library', label: 'PROBLEM LIBRARY', needs: 'content.read' },
  { id: 'rankings', label: 'RANKINGS & REWARDS' },
  { id: 'status', label: 'SHIP STATUS' },
];

const ROLE_LABEL: Record<string, string> = { SUPER_ADMIN: 'SUPER ADMIN', OPERATOR: 'OPERATOR', CONTENT_EDITOR: 'CONTENT EDITOR' };

export function CommandConsole({ refreshKey, onClose, standalone = false }: { refreshKey: number; onClose?: () => void; standalone?: boolean }): JSX.Element {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>('crew');
  const [confirm, confirmNode] = useConfirmHost();
  const ctrl = useRef<AbortController | null>(null);

  const reloadOverview = useCallback(async () => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    try {
      const o = await api.get<Overview>('/api/admin/overview', c.signal);
      if (c.signal.aborted) return;
      syncClock(o.serverTime);
      setOverview(o);
      setError(null);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError' || c.signal.aborted) return;
      setError(toApiError(e));
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadOverview();
    return () => ctrl.current?.abort();
  }, [reloadOverview]);

  // Realtime: the parent bumps refreshKey on every event — debounce and refetch.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = window.setTimeout(() => void reloadOverview(), 250);
    return () => window.clearTimeout(t);
  }, [refreshKey, reloadOverview]);

  const role = overview?.me.role ?? 'CONTENT_EDITOR';
  const visibleTabs = useMemo(() => TABS.filter((t) => !t.needs || canRole(role, t.needs)), [role]);
  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : visibleTabs[0]?.id ?? 'status';

  const ctx = useMemo<ConsoleCtxValue | null>(
    () => (overview ? { overview, role, refreshKey, can: (p: Permission) => canRole(role, p), reloadOverview, confirm, standalone } : null),
    [overview, role, refreshKey, reloadOverview, confirm, standalone],
  );

  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = visibleTabs.findIndex((t) => t.id === activeTab);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % visibleTabs.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + visibleTabs.length) % visibleTabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = visibleTabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = visibleTabs[next].id;
    setTab(id);
    tabRefs.current[id]?.focus();
  };

  const header = (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <Crewmate color="#e5cf8f" accessory size={40} state="still" />
        <div>
          <Label className="!text-[#e7c784]">COMMANDER ACCESS GRANTED</Label>
          <h2 className="mt-1 font-display text-2xl font-bold">Ship command terminal</h2>
          {overview && (
            <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted">
              <span>{overview.event.name}</span>
              {overview.event.isDemo && <Badge>DEMO EVENT</Badge>}
              <span>·</span>
              <span>
                {overview.currentDay ? `TODAY: DAY ${overview.currentDay.day_number} (${overview.currentDay.label})` : 'NO ACTIVE DAY'} · {overview.event.daySelectionMode} DAY SELECTION
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {overview && (
          <div className="rounded-lg border-2 border-[#dfbd77]/60 bg-[#37414b] px-3 py-2 text-right">
            <Label className="!text-[#e5cf8f]">SIGNED IN</Label>
            <div className="font-display text-sm font-bold">{overview.me.name}</div>
            <div className="font-mono text-[9px] text-[#e5cf8f]">{ROLE_LABEL[overview.me.role] ?? overview.me.role}</div>
          </div>
        )}
        <Button secondary className={SMALL} onClick={() => void reloadOverview()} ariaLabel="Refresh console data">
          <RefreshCw size={12} /> Sync
        </Button>
        {standalone && onClose && (
          <Button secondary className={SMALL} onClick={onClose}>
            <LogOut size={12} /> Exit
          </Button>
        )}
        {!standalone && <Satellite size={24} className="text-primary" aria-hidden="true" />}
      </div>
    </div>
  );

  let body: JSX.Element;
  if (loading && !overview) body = <StatePanel kind="loading" title="Establishing command uplink…" />;
  else if (error && !overview) {
    const denied = ['UNAUTHENTICATED', 'COMMANDER_CLEARANCE_REQUIRED', 'FORBIDDEN', 'SESSION_EXPIRED'].includes(error.code);
    body = (
      <StatePanel
        kind="error"
        title={denied ? 'ACCESS DENIED — commander clearance required' : 'Command uplink failed'}
        message={`${error.message} [${error.code}]`}
        action={<Button secondary onClick={() => { setLoading(true); void reloadOverview(); }}>Retry</Button>}
      />
    );
  } else if (ctx) {
    body = (
      <ConsoleCtx.Provider value={ctx}>
        {error && (
          <div role="alert" className="mb-3 rounded-lg border border-[#9d635a] bg-[#442b34]/70 px-3 py-2 text-[11px] text-[#f3b399]">
            Overview refresh failed — showing last known state. {error.message}
          </div>
        )}
        <div role="tablist" aria-label="Command console sections" className="mb-6 flex flex-wrap gap-2" onKeyDown={onTabKey}>
          {visibleTabs.map((t) => {
            const sel = t.id === activeTab;
            return (
              <button
                key={t.id}
                ref={(el) => { tabRefs.current[t.id] = el; }}
                id={`cmd-tab-${t.id}`}
                role="tab"
                type="button"
                aria-selected={sel}
                aria-controls={`cmd-panel-${t.id}`}
                tabIndex={sel ? 0 : -1}
                onClick={() => setTab(t.id)}
                className={`rounded-lg border-2 px-3 py-2 font-display text-[9px] font-bold tracking-wide shadow-[0_3px_0_#07141d] transition hover:-translate-y-0.5 ${
                  sel ? 'border-[#b3f3d9] bg-[#8ae4cf] text-[#14342f]' : t.id === 'imposters' ? 'border-[#9d635a] bg-[#442b34] text-[#ffd8c7]' : 'border-[#52717e] bg-[#2d4654] text-[#d6e1e1]'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <div role="tabpanel" id={`cmd-panel-${activeTab}`} aria-labelledby={`cmd-tab-${activeTab}`} tabIndex={0} className="focus-visible:outline-none">
          {activeTab === 'crew' && <CrewTab />}
          {activeTab === 'game' && <GameTab />}
          {activeTab === 'tasks' && <TasksTab />}
          {activeTab === 'imposters' && <ImpostersTab />}
          {activeTab === 'coins' && <CoinsTab />}
          {activeTab === 'elimination' && <EliminationTab />}
          {activeTab === 'library' && <LibraryTab />}
          {activeTab === 'rankings' && <RankingsTab />}
          {activeTab === 'status' && <StatusTab />}
        </div>
        {confirmNode}
      </ConsoleCtx.Provider>
    );
  } else body = <StatePanel kind="loading" title="Establishing command uplink…" />;

  if (standalone) {
    return (
      <main className="min-h-screen bg-[#0a121b] px-3 py-5 text-[#f2f0e7] sm:px-6">
        <div className="mx-auto max-w-[1400px] rounded-[18px] border-[3px] border-[#668991] bg-[#203b49] p-4 shadow-[0_10px_0_#051521] sm:p-6">
          {header}
          {body}
        </div>
      </main>
    );
  }
  return (
    <div className="text-[#f2f0e7]">
      {header}
      {body}
    </div>
  );
}

export default CommandConsole;
