/**
 * ORGANIZER CONSOLE — the ship's command terminal for the four-slot AMONG BUG event.
 * Every action is server-authorised; the UI only hides what the organizer's
 * permissions (me.organizer.permissions) do not allow.
 */
import { LogOut, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import { ApiError, V1, api, syncClock, type OrganizerIdentity } from '../lib/api';
import { Badge, Button, Crewmate, Label, StatePanel } from '../components/ui';
import { ConsoleCtx, SMALL, toApiError, useConfirmHost, type ConsoleCtxValue } from './kit';
import type { Overview, Permission } from './types';
import { SlotsTab } from './SlotsTab';
import { ReleasesTab } from './ReleasesTab';
import { CrewsTab } from './CrewsTab';
import { ImportTab } from './ImportTab';
import { CredentialsTab } from './CredentialsTab';
import { RulesTab } from './RulesTab';
import { BoardsTab } from './BoardsTab';
import { DisplaysTab } from './DisplaysTab';
import { BankTab } from './BankTab';
import { OpsTab } from './OpsTab';

type TabId = 'slots' | 'releases' | 'crews' | 'import' | 'credentials' | 'rules' | 'boards' | 'displays' | 'bank' | 'ops';

const TABS: { id: TabId; label: string; needs?: Permission }[] = [
  { id: 'slots', label: 'SLOTS & SPRINTS' },
  { id: 'releases', label: 'RELEASES' },
  { id: 'crews', label: 'CREWS', needs: 'teams.read' },
  { id: 'import', label: 'IMPORT', needs: 'teams.write' },
  { id: 'credentials', label: 'CREDENTIALS', needs: 'teams.read' },
  { id: 'rules', label: 'RULES REVIEW' },
  { id: 'boards', label: 'LEADERBOARDS & EXPORTS' },
  { id: 'displays', label: 'DISPLAYS' },
  { id: 'bank', label: 'QUESTION BANK', needs: 'content.read' },
  { id: 'ops', label: 'LEDGER · AUDIT · HEALTH', needs: 'audit.read' },
];

const ROLE_LABEL: Record<string, string> = { SUPER_ADMIN: 'SUPER ADMIN', OPERATOR: 'OPERATOR', CONTENT_EDITOR: 'CONTENT EDITOR' };

export function CommandConsole({ refreshKey, me, onSignOut }: { refreshKey: number; me: OrganizerIdentity; onSignOut: () => void }): JSX.Element {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>(() => {
    try {
      return (sessionStorage.getItem('cmd-tab') as TabId) || 'slots';
    } catch {
      return 'slots';
    }
  });
  const [confirm, confirmNode] = useConfirmHost();
  const [focusSlot, setFocusSlot] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const reloadOverview = useCallback(async () => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    try {
      const o = await api.get<Overview>(`${V1}/admin/overview`, c.signal);
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

  // Realtime: the parent bumps refreshKey on every event / reconnect — debounce and refetch.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = window.setTimeout(() => void reloadOverview(), 250);
    return () => window.clearTimeout(t);
  }, [refreshKey, reloadOverview]);

  const perms = me.organizer.permissions;
  const can = useCallback((p: Permission) => perms.includes(p), [perms]);
  const visibleTabs = useMemo(() => TABS.filter((t) => !t.needs || can(t.needs)), [can]);
  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : visibleTabs[0]?.id ?? 'slots';
  const pick = useCallback((id: TabId) => {
    setTab(id);
    try {
      sessionStorage.setItem('cmd-tab', id);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const goTo = useCallback((id: string, slotId?: string) => {
    if (!TABS.some((t) => t.id === id)) return;
    setFocusSlot(slotId ?? null);
    pick(id as TabId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [pick]);

  const ctx = useMemo<ConsoleCtxValue | null>(
    () => (overview ? { overview, me, refreshKey, can, reloadOverview, confirm, goTo, focusSlot } : null),
    [overview, me, refreshKey, can, reloadOverview, confirm, goTo, focusSlot],
  );

  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = visibleTabs.findIndex((t) => t.id === activeTab);
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % visibleTabs.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + visibleTabs.length) % visibleTabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = visibleTabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = visibleTabs[next].id;
    pick(id);
    tabRefs.current[id]?.focus();
  };

  const ev = overview?.event;
  const header = (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <Crewmate color="#e5cf8f" accessory size={40} state="still" />
        <div>
          <Label className="!text-[#e7c784]">ORGANIZER CONSOLE</Label>
          <h1 className="mt-1 font-display text-2xl font-bold">{ev?.name ?? 'AMONG BUG'} · command terminal</h1>
          {ev && (
            <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted">
              <span>{ev.organizer}</span>
              <span>·</span>
              <span>{ev.edition}</span>
              <span>·</span>
              <span>{ev.venue}</span>
              <span>·</span>
              <span>{ev.timezone}</span>
              {ev.isDemo && <Badge>DEMO</Badge>}
              {overview!.unconfirmed.length > 0 && <Badge>{`RULES UNCONFIRMED: ${overview!.unconfirmed.length}`}</Badge>}
              <Badge>{ev.rulesFrozenAt ? 'RULES FROZEN' : 'RULES EDITABLE'}</Badge>
              <Badge>{ev.phase === 'FINALIZED' ? 'RESULTS FINAL' : 'OVERALL PROVISIONAL'}</Badge>
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="rounded-lg border-2 border-[#dfbd77]/60 bg-[#37414b] px-3 py-2 text-right">
          <Label className="!text-[#e5cf8f]">SIGNED IN</Label>
          <div className="font-display text-sm font-bold">{me.organizer.name}</div>
          <div className="font-mono text-[9px] text-[#e5cf8f]">{ROLE_LABEL[me.organizer.role] ?? me.organizer.role}</div>
        </div>
        <Button secondary className={SMALL} onClick={() => void reloadOverview()} ariaLabel="Refresh console data">
          <RefreshCw size={12} /> Sync
        </Button>
        <Button secondary className={SMALL} onClick={onSignOut}>
          <LogOut size={12} /> Sign out
        </Button>
      </div>
    </div>
  );

  let body: JSX.Element;
  if (loading && !overview) body = <StatePanel kind="loading" title="Establishing command uplink…" />;
  else if (error && !overview) {
    const denied = ['UNAUTHENTICATED', 'ORGANIZER_CLEARANCE_REQUIRED', 'FORBIDDEN'].includes(error.code);
    body = (
      <StatePanel
        kind="error"
        title={denied ? 'ACCESS DENIED — organizer clearance required' : 'Command uplink failed'}
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
        <div role="tablist" aria-label="Console sections" className="mb-6 flex flex-wrap gap-2" onKeyDown={onTabKey}>
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
                onClick={() => pick(t.id)}
                className={`rounded-lg border-2 px-3 py-2 font-display text-[9px] font-bold tracking-wide shadow-[0_3px_0_#07141d] transition hover:-translate-y-0.5 ${
                  sel ? 'border-[#b3f3d9] bg-[#8ae4cf] text-[#14342f]' : 'border-[#52717e] bg-[#2d4654] text-[#d6e1e1]'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <div role="tabpanel" id={`cmd-panel-${activeTab}`} aria-labelledby={`cmd-tab-${activeTab}`} tabIndex={0} className="focus-visible:outline-none">
          {activeTab === 'slots' && <SlotsTab />}
          {activeTab === 'releases' && <ReleasesTab />}
          {activeTab === 'crews' && <CrewsTab />}
          {activeTab === 'import' && <ImportTab />}
          {activeTab === 'credentials' && <CredentialsTab />}
          {activeTab === 'rules' && <RulesTab />}
          {activeTab === 'boards' && <BoardsTab />}
          {activeTab === 'displays' && <DisplaysTab />}
          {activeTab === 'bank' && <BankTab />}
          {activeTab === 'ops' && <OpsTab />}
        </div>
        {confirmNode}
      </ConsoleCtx.Provider>
    );
  } else body = <StatePanel kind="loading" title="Establishing command uplink…" />;

  return (
    <div className="mx-auto max-w-[1400px] rounded-[18px] border-[3px] border-[#668991] bg-[#203b49] p-4 text-[#f2f0e7] shadow-[0_10px_0_#051521] sm:p-6">
      {header}
      {body}
    </div>
  );
}

export default CommandConsole;
