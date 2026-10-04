import { AnimatePresence } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { CommandConsole } from './admin/CommandConsole';
import { StatePanel, ToastProvider } from './components/ui';
import { Ship } from './game/Ship';
import { api, type CommanderStatus, type Me, type TeamStatus } from './lib/api';
import { useRealtime } from './lib/realtime';
import { CardScreen, ChangePassword, Cinematic, ResetScreen, StatusScreen } from './screens/Gate';
import { Landing, type LandingMode } from './screens/Landing';
import { Register } from './screens/Register';

type Stage = 'loading' | 'landing' | 'register' | 'card' | 'cinematic' | 'ship' | 'status' | 'password' | 'offline';

function readStage(): string | null {
  try {
    return sessionStorage.getItem('ab-stage');
  } catch {
    return null;
  }
}
function writeStage(s: string | null) {
  try {
    if (s) sessionStorage.setItem('ab-stage', s);
    else sessionStorage.removeItem('ab-stage');
  } catch {
    /* storage unavailable */
  }
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function MainFlow() {
  const [stage, setStage] = useState<Stage>('loading');
  const [me, setMe] = useState<TeamStatus | CommanderStatus | null>(null);
  const [mode, setMode] = useState<LandingMode>('CREW');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Routes a (re)authenticated identity to the right screen. Server data only — never a client role flag. */
  const route = useCallback((m: Me, fresh: boolean) => {
    if (!m.role) {
      setMe(null);
      writeStage(null);
      setStage('landing');
      return;
    }
    setMe(m);
    if (m.role === 'COMPETITOR') {
      if (m.team.mustChangePassword) return setStage('password');
      if (m.access.state !== 'ELIGIBLE') return setStage('status');
    }
    // A refresh with a valid session resumes on the ship; a fresh login shows the card first.
    setStage(!fresh && readStage() === 'ship' ? 'ship' : 'card');
  }, []);

  const load = useCallback(async (fresh = false) => {
    setBusy(true);
    try {
      route(await api.get<Me>('/api/auth/me'), fresh);
    } catch {
      setStage('offline');
    } finally {
      setBusy(false);
    }
  }, [route]);

  useEffect(() => {
    void load();
  }, [load]);

  const logout = useCallback(async (msg?: string) => {
    try {
      await api.post('/api/auth/logout', {});
    } catch {
      /* already gone */
    }
    writeStage(null);
    setMe(null);
    setNotice(msg ?? null);
    setStage('landing');
  }, []);

  const enterShip = () => {
    writeStage('ship');
    setStage(reducedMotion() ? 'ship' : 'cinematic');
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0b1923] text-[#edf0e5]">
      <AnimatePresence mode="wait">
        {stage === 'loading' && (
          <div key="l" className="starfield absolute inset-0 flex items-center justify-center">
            <StatePanel kind="loading" title="Docking with the ship server…" />
          </div>
        )}
        {stage === 'offline' && (
          <div key="o" className="starfield absolute inset-0 flex items-center justify-center p-5">
            <StatePanel kind="error" title="Ship server unreachable" message="The API did not respond. Check your connection or ask an organizer." action={<button className="underline" onClick={() => void load()}>Retry</button>} />
          </div>
        )}
        {stage === 'landing' && (
          <Landing
            key="landing"
            initialMode={mode}
            notice={notice}
            onRegister={() => setStage('register')}
            onSignedIn={(m) => {
              setNotice(null);
              route(m, true);
            }}
          />
        )}
        {stage === 'register' && (
          <Register
            key="register"
            onBack={() => setStage('landing')}
            onLogin={() => {
              setMode('CREW');
              setStage('landing');
            }}
          />
        )}
        {stage === 'card' && me && <CardScreen key="card" me={me} onEnter={enterShip} onLogout={() => void logout()} />}
        {stage === 'status' && me?.role === 'COMPETITOR' && <StatusScreen key="status" me={me} busy={busy} onRefresh={() => void load(true)} onLogout={() => void logout()} />}
        {stage === 'password' && <ChangePassword key="pw" onDone={() => void load(true)} onLogout={() => void logout()} />}
      </AnimatePresence>
      {stage === 'cinematic' && <Cinematic onDone={() => setStage((s) => (s === 'cinematic' ? 'ship' : s))} />}
      {stage === 'ship' && me && <Ship me={me} onLogout={(m) => void logout(m)} onAccessLost={() => void load(true)} />}
    </div>
  );
}

/** /command — direct, low-power accessible command console (still server-authorised). */
function CommandRoute() {
  const [me, setMe] = useState<Me | null>(null);
  const [key, setKey] = useState(0);
  const load = useCallback(() => api.get<Me>('/api/auth/me').then(setMe).catch(() => setMe({ role: null })), []);
  useEffect(() => void load(), [load]);
  useRealtime(me?.role === 'COMMANDER', () => setKey((k) => k + 1), () => setKey((k) => k + 1));
  if (!me) return <div className="starfield fixed inset-0 flex items-center justify-center"><StatePanel kind="loading" title="Checking clearance…" /></div>;
  if (me.role !== 'COMMANDER') {
    return (
      <div className="fixed inset-0 bg-[#0b1923]">
        <Landing initialMode="COMMANDER" notice={me.role === 'COMPETITOR' ? 'ACCESS DENIED — commander clearance required. Crew sessions cannot open the console.' : null} onRegister={() => (location.href = '/')} onSignedIn={() => void load()} />
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-[#0b1923] p-3 text-[#edf0e5] sm:p-6">
      <CommandConsole refreshKey={key} standalone onClose={() => (location.href = '/')} />
    </div>
  );
}

export default function App() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  return (
    <ToastProvider>
      {path === '/command' ? <CommandRoute /> : path === '/reset' ? <div className="fixed inset-0 bg-[#0b1923]"><ResetScreen onDone={() => (location.href = '/')} /></div> : <MainFlow />}
    </ToastProvider>
  );
}
