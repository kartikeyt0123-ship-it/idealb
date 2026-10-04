import { motion } from 'motion/react';
import { ArrowRight, CreditCard, LoaderCircle, Shield, UserPlus, Users } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type CommanderStatus, type TeamStatus } from '../lib/api';
import { Button, Crewmate, Field, IdeaLabMark, Label, ShipSilhouette } from '../components/ui';
import { sfx } from '../lib/sound';

export type LandingMode = 'CREW' | 'COMMANDER';

interface Meta {
  demoMode: boolean;
  demoCrew: { identifier: string; password: string } | null;
  event: { name: string; isDemo: boolean } | null;
}

export function Landing({
  initialMode = 'CREW', notice, onSignedIn, onRegister,
}: {
  initialMode?: LandingMode;
  notice?: string | null;
  onSignedIn: (me: TeamStatus | CommanderStatus) => void;
  onRegister: () => void;
}) {
  const [mode, setMode] = useState<LandingMode>(initialMode);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(notice ?? null);
  const [meta, setMeta] = useState<Meta | null>(null);

  useEffect(() => {
    api.get<Meta>('/api/meta').then(setMeta).catch(() => setMeta(null));
  }, []);
  useEffect(() => setError(notice ?? null), [notice]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await api.post<TeamStatus | CommanderStatus>('/api/auth/login', { mode, identifier: identifier.trim(), password });
      sfx.great();
      setPassword('');
      onSignedIn(me);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed.');
      sfx.bad();
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="starfield absolute inset-0 z-40 overflow-y-auto bg-[#061522]/45">
      <div className="relative mx-auto flex min-h-full max-w-[1450px] flex-col px-6 py-6 sm:px-12 sm:py-9">
        <header className="flex items-center justify-between">
          <IdeaLabMark />
          <span className="font-mono text-[8px] tracking-widest text-[#92b0b8]">DEBUG + RUN / CREW BOARDING</span>
        </header>
        <div className="grid flex-1 items-center gap-8 py-10 lg:grid-cols-[1.3fr_1fr]">
          <div className="relative">
            <div className="absolute -right-8 -top-24 hidden h-40 w-72 -rotate-12 opacity-80 lg:block">
              <ShipSilhouette />
            </div>
            <Label className="mb-6 flex items-center gap-2 !text-[#d7c08a]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#d7c08a]" />A DEBUGGING MISSION BY IDEA LAB · AAROHAN 2026
            </Label>
            <h1 className="font-display text-[14px] font-semibold tracking-[.38em] text-[#bdd8cb]">DEBUG + RUN</h1>
            <h2 className="mt-3 font-sans text-[65px] font-black leading-[.88] tracking-[-.02em] text-[#f0ecdb] sm:text-[100px]">
              AMONG
              <br />
              <span className="text-[#9ce4d0]">
                BUGS<span className="text-[#e8b989]">.</span>
              </span>
            </h2>
            <p className="mt-7 font-display text-sm font-medium leading-7 tracking-[.06em] text-[#dce3d2]">
              FIND THE BUG. FIX THE CODE.
              <br />
              <span className="text-[#e2b984]">DON’T GET EJECTED.</span>
            </p>
            <div className="mt-7 flex items-center gap-4">
              <div className="flex -space-x-2">
                {['#f28a86', '#edd07e', '#83cbaa', '#af9ddd'].map((c) => (
                  <Crewmate key={c} color={c} size={35} state="still" />
                ))}
              </div>
              <div className="text-[10px] leading-5 text-[#9fb9bc]">
                One ship. Many crews.
                <br />
                <span className="text-[#d2e5d8]">Only the sharpest survive.</span>
              </div>
            </div>
            {/* The three entry actions */}
            <div className="mt-9 flex flex-wrap gap-3" role="group" aria-label="Choose how to board">
              <Button onClick={onRegister} className="!px-5">
                <UserPlus size={15} /> Register Team
              </Button>
              <Button secondary={mode !== 'CREW'} onClick={() => { setMode('CREW'); setError(null); }}>
                <Users size={15} /> Crew Login
              </Button>
              <Button secondary={mode !== 'COMMANDER'} onClick={() => { setMode('COMMANDER'); setError(null); }} className={mode === 'COMMANDER' ? '!border-[#dfbd77] !bg-[#e5cf8f] !text-[#2e2a1c]' : ''}>
                <Shield size={15} /> Commander Login
              </Button>
            </div>
          </div>

          <div
            className={`relative mx-auto w-full max-w-[440px] rounded-[22px] border-[3px] bg-[#233b49]/95 p-6 shadow-[0_12px_0_#061722,0_20px_80px_#00000040] sm:p-8 ${mode === 'COMMANDER' ? 'border-[#a88f5c]' : 'border-[#64808a]'}`}
          >
            <span className="absolute left-4 top-4 h-2 w-2 rounded-full border border-[#758b92] bg-[#0f2431]" />
            <span className="absolute right-4 top-4 h-2 w-2 rounded-full border border-[#758b92] bg-[#0f2431]" />
            <div className="mb-6 flex items-center gap-3 border-b border-[#617c81]/40 pb-5">
              <div className={`flex h-11 w-11 items-center justify-center rounded-lg border-2 bg-[#14323c] ${mode === 'COMMANDER' ? 'border-[#a88f5c] text-[#e5cf8f]' : 'border-[#61827e] text-primary'}`}>
                {mode === 'COMMANDER' ? <Shield size={22} /> : <CreditCard size={22} />}
              </div>
              <div>
                <Label className={mode === 'COMMANDER' ? '!text-[#e5cf8f]' : '!text-primary'}>SHIP SECURITY / {mode === 'COMMANDER' ? '00' : '01'}</Label>
                <h3 className="mt-1 font-display text-xl font-bold">{mode === 'COMMANDER' ? 'Commander login' : 'Crew boarding'}</h3>
              </div>
              <span className="ml-auto h-2 w-2 rounded-full bg-primary shadow-[0_0_10px_#8ae4cf]" />
            </div>
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg border border-[#3c5c69] bg-[#12293a] p-1" role="tablist" aria-label="Sign-in type">
              {(['CREW', 'COMMANDER'] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => { setMode(m); setError(null); }}
                  className={`rounded-md py-2 font-display text-[10px] font-bold tracking-wider ${mode === m ? (m === 'COMMANDER' ? 'bg-[#e5cf8f] text-[#2e2a1c]' : 'bg-primary text-[#14342f]') : 'text-[#a9c0c2] hover:bg-white/5'}`}
                >
                  {m === 'CREW' ? 'CREW' : 'COMMANDER'}
                </button>
              ))}
            </div>
            <form onSubmit={submit} noValidate>
              <Field label={mode === 'COMMANDER' ? 'COMMANDER EMAIL' : 'CAPTAIN EMAIL OR CREW ID'}>
                <input
                  required
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="input"
                  placeholder={mode === 'COMMANDER' ? 'commander@…' : 'captain@college.edu or CRW-042'}
                />
              </Field>
              <Field label="PASSWORD">
                <input required autoComplete="current-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input" placeholder="Enter your password" />
              </Field>
              {error && (
                <p role="alert" className="mb-4 text-xs leading-5 text-[#f3b399]">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={busy || !identifier || !password} className={`mt-2 w-full !py-3.5 ${mode === 'COMMANDER' ? '!border-[#f3dfa6] !bg-[#e5cf8f] !text-[#2e2a1c]' : ''}`}>
                {busy ? <LoaderCircle size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                {mode === 'COMMANDER' ? 'Authenticate commander' : 'Authenticate crew'}
              </Button>
            </form>
            <div className="mt-6 flex items-center gap-2 border-t border-[#5b767b]/40 pt-4">
              <Shield size={14} className="shrink-0 text-[#c9b486]" />
              <p className="text-[9px] leading-4 text-[#acbec0]">
                {mode === 'COMMANDER' ? 'Commander clearance is verified by the ship server. Crew accounts cannot sign in here.' : 'One access card for your entire team. New crew? Use Register Team — organizers activate your days.'}
              </p>
            </div>
            {meta?.demoCrew && mode === 'CREW' && (
              <div className="mt-5 rounded-lg border border-[#819a89]/20 bg-[#112b37]/70 p-3">
                <div className="mb-2 font-mono text-[8px] tracking-wider text-[#e3c68b]">LOCAL DEMO · SAMPLE CREW</div>
                <div className="flex items-center justify-between gap-3 text-[10px]">
                  <span className="text-[#a8c1c2]">
                    {meta.demoCrew.identifier}
                    <br />
                    Demo-only sample access
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setIdentifier(meta.demoCrew!.identifier);
                      setPassword(meta.demoCrew!.password);
                    }}
                    className="text-primary underline underline-offset-4"
                  >
                    Fill demo access
                  </button>
                </div>
              </div>
            )}
            {meta?.demoMode && mode === 'COMMANDER' && (
              <p className="mt-5 rounded-lg border border-[#c9a16e]/30 bg-[#c9a16e]/10 p-3 text-[10px] leading-5 text-[#dfc192]">
                Demo build: the demo commander account is listed in the developer-only demo access document.
              </p>
            )}
          </div>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#557080]/30 pt-5">
          <span className="font-mono text-[8px] tracking-widest text-[#8aabb5]">POWERED BY IDEA LAB · SGSITS INDORE · AAROHAN 2026</span>
          <div className="flex items-center gap-4 text-[9px] text-[#a2c4bc]">
            <a href="/reset" className="underline underline-offset-4 hover:text-primary">Have a reset code?</a>
            <span className="flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-primary" />
              SHIP SYSTEMS READY FOR BOARDING
            </span>
          </div>
        </footer>
      </div>
    </motion.div>
  );
}
