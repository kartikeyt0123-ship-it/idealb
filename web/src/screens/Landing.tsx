import { motion } from 'motion/react';
import { ArrowRight, CreditCard, LoaderCircle, Shield, Users } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, FALLBACK_EVENT_NAME, V1, type Me, type Meta } from '../lib/api';
import { Button, Crewmate, Field, IdeaLabMark, Label, ShipSilhouette } from '../components/ui';
import { sfx } from '../lib/sound';

export type LandingMode = 'CREW' | 'ORGANIZER';

/** Splits the display name ("AMONG BUG") into the two-line hero treatment. */
function heroWords(name: string): [string, string] {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return ['', parts[0] ?? name];
  return [parts.slice(0, -1).join(' '), parts[parts.length - 1]];
}

/**
 * Boarding screen. Exactly two ways in: Crew Login and Organizer Login.
 * There is no public registration — crews are imported and mailed credentials by the organizers.
 */
export function Landing({ initialMode = 'CREW', notice, onSignedIn }: { initialMode?: LandingMode; notice?: string | null; onSignedIn: (me: Me) => void }) {
  const [mode, setMode] = useState<LandingMode>(initialMode);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(notice ?? null);
  const [meta, setMeta] = useState<Meta | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    api.get<Meta>(`${V1}/meta`, ac.signal).then(setMeta).catch(() => undefined);
    return () => ac.abort();
  }, []);
  useEffect(() => setError(notice ?? null), [notice]);

  const ev = meta?.event ?? null;
  const name = ev?.name || FALLBACK_EVENT_NAME;
  const [w1, w2] = heroWords(name);
  const organizerName = ev?.organizer || 'IDEALab';
  const edition = ev?.edition ?? '';
  const venue = ev?.venue ?? '';
  const org = mode === 'ORGANIZER';

  function switchMode(m: LandingMode) {
    setMode(m);
    setError(null);
    setIdentifier('');
    setPassword('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = org
        ? await api.post<Me>(`${V1}/auth/organizer-login`, { email: identifier.trim(), password })
        : await api.post<Me>(`${V1}/auth/crew-login`, { identifier: identifier.trim(), password });
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
      <div className="relative mx-auto flex min-h-full max-w-[1450px] flex-col px-4 py-6 sm:px-12 sm:py-9">
        <header className="flex items-center justify-between gap-3">
          <IdeaLabMark />
          <div className="flex items-center gap-2">
            {ev?.isDemo && (
              <span className="rounded border border-[#e5cf8f]/40 bg-[#e5cf8f]/10 px-2 py-1 font-mono text-[9px] tracking-widest text-[#e5cf8f]" title="This is a demo event">
                DEMO
              </span>
            )}
            <span className="hidden font-mono text-[8px] tracking-widest text-[#92b0b8] sm:inline">AAROHAN 2026 / CREW BOARDING</span>
          </div>
        </header>
        <div className="grid flex-1 items-center gap-8 py-10 lg:grid-cols-[1.3fr_1fr]">
          <div className="relative">
            <div className="absolute -right-8 -top-24 hidden h-40 w-72 -rotate-12 opacity-80 lg:block">
              <ShipSilhouette />
            </div>
            <Label className="mb-6 flex items-center gap-2 !text-[#d7c08a]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#d7c08a]" />
              {`A DEBUGGING MISSION BY ${organizerName.toUpperCase()}${edition ? ` · ${edition.toUpperCase()}` : ''}`}
            </Label>
            <h1 className="font-display text-[14px] font-semibold tracking-[.38em] text-[#bdd8cb]">AAROHAN 2026</h1>
            <h2 className="mt-3 break-words font-sans text-[56px] font-black leading-[.88] tracking-[-.02em] text-[#f0ecdb] sm:text-[100px]">
              {w1 && (
                <>
                  {w1.toUpperCase()}
                  <br />
                </>
              )}
              <span className="text-[#9ce4d0]">
                {w2.toUpperCase()}
                <span className="text-[#e8b989]">.</span>
              </span>
            </h2>
            <p className="mt-7 font-display text-sm font-medium leading-7 tracking-[.06em] text-[#dce3d2]">
              FIND THE BUG. FIX THE CODE.
              <br />
              <span className="text-[#e2b984]">FOUR SPRINTS. ONE SHIP.</span>
            </p>
            <div className="mt-7 flex items-center gap-4">
              <div className="flex -space-x-2">
                {['#f28a86', '#edd07e', '#83cbaa', '#af9ddd'].map((c) => (
                  <Crewmate key={c} color={c} size={35} state="still" />
                ))}
              </div>
              <div className="text-[10px] leading-5 text-[#9fb9bc]">
                Ten crews per slot. First correct fix wins.
                <br />
                <span className="text-[#d2e5d8]">Watch for the imposter.</span>
              </div>
            </div>
            {/* The two entry actions */}
            <div className="mt-9 flex flex-wrap gap-3" role="group" aria-label="Choose how to sign in">
              <Button secondary={org} onClick={() => switchMode('CREW')}>
                <Users size={15} /> Crew Login
              </Button>
              <Button secondary={!org} onClick={() => switchMode('ORGANIZER')} className={org ? '!border-[#dfbd77] !bg-[#e5cf8f] !text-[#2e2a1c]' : ''}>
                <Shield size={15} /> Organizer Login
              </Button>
            </div>
          </div>

          <div className={`relative mx-auto w-full max-w-[440px] rounded-[22px] border-[3px] bg-[#233b49]/95 p-5 shadow-[0_12px_0_#061722,0_20px_80px_#00000040] sm:p-8 ${org ? 'border-[#a88f5c]' : 'border-[#64808a]'}`}>
            <span className="absolute left-4 top-4 h-2 w-2 rounded-full border border-[#758b92] bg-[#0f2431]" />
            <span className="absolute right-4 top-4 h-2 w-2 rounded-full border border-[#758b92] bg-[#0f2431]" />
            <div className="mb-6 flex items-center gap-3 border-b border-[#617c81]/40 pb-5">
              <div className={`flex h-11 w-11 items-center justify-center rounded-lg border-2 bg-[#14323c] ${org ? 'border-[#a88f5c] text-[#e5cf8f]' : 'border-[#61827e] text-primary'}`}>
                {org ? <Shield size={22} /> : <CreditCard size={22} />}
              </div>
              <div>
                <Label className={org ? '!text-[#e5cf8f]' : '!text-primary'}>SHIP SECURITY / {org ? '00' : '01'}</Label>
                <h3 className="mt-1 font-display text-xl font-bold">{org ? 'Organizer login' : 'Crew login'}</h3>
              </div>
              <span className="ml-auto h-2 w-2 rounded-full bg-primary shadow-[0_0_10px_#8ae4cf]" />
            </div>
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg border border-[#3c5c69] bg-[#12293a] p-1" role="tablist" aria-label="Sign-in type">
              {(['CREW', 'ORGANIZER'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => switchMode(m)}
                  className={`rounded-md py-2 font-display text-[10px] font-bold tracking-wider ${mode === m ? (m === 'ORGANIZER' ? 'bg-[#e5cf8f] text-[#2e2a1c]' : 'bg-primary text-[#14342f]') : 'text-[#a9c0c2] hover:bg-white/5'}`}
                >
                  {m === 'CREW' ? 'CREW' : 'ORGANIZER'}
                </button>
              ))}
            </div>
            <form onSubmit={submit} noValidate>
              <Field label={org ? 'ORGANIZER EMAIL' : 'CAPTAIN EMAIL OR CREW ID (CRW-001)'}>
                <input
                  required
                  autoComplete="username"
                  type={org ? 'email' : 'text'}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="input"
                  placeholder={org ? 'organizer@…' : 'captain@college.edu or CRW-001'}
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
              <Button type="submit" disabled={busy || !identifier.trim() || !password} className={`mt-2 w-full !py-3.5 ${org ? '!border-[#f3dfa6] !bg-[#e5cf8f] !text-[#2e2a1c]' : ''}`}>
                {busy ? <LoaderCircle size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                {org ? 'Sign in as organizer' : 'Board the ship'}
              </Button>
            </form>
            <div className="mt-6 flex items-center gap-2 border-t border-[#5b767b]/40 pt-4">
              <Shield size={14} className="shrink-0 text-[#c9b486]" />
              <p className="text-[9px] leading-4 text-[#acbec0]">
                {org
                  ? 'Organizer clearance is verified by the ship server. Crew accounts cannot sign in here.'
                  : 'One account per crew. Use the captain email or crew ID and the password from your credential mail. Lost it? Visit the organizer desk.'}
              </p>
            </div>
          </div>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#557080]/30 pt-5">
          <span className="font-mono text-[8px] tracking-widest text-[#8aabb5]">
            {[name, organizerName, venue, edition].filter(Boolean).join(' · ').toUpperCase()}
          </span>
          <span className="flex items-center gap-2 text-[9px] text-[#a2c4bc]">
            <span className="h-1 w-1 rounded-full bg-primary" />
            SHIP SYSTEMS READY FOR BOARDING
          </span>
        </footer>
      </div>
    </motion.div>
  );
}
