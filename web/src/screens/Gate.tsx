import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, KeyRound, LoaderCircle, LogOut, RefreshCw } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, ApiError, type CommanderStatus, type TeamStatus } from '../lib/api';
import { AccessCard, Button, Crewmate, Field, IdeaLabMark, Label } from '../components/ui';

export function cardIdentity(me: TeamStatus | CommanderStatus) {
  return me.role === 'COMMANDER'
    ? { name: me.admin.name.toUpperCase(), crewId: 'CMD-01', color: '#e5cf8f', commander: true, roleLabel: me.admin.role.replace('_', ' ') }
    : { name: me.team.name, crewId: me.team.crewId, color: me.team.color, commander: false, roleLabel: 'COMPETITOR' };
}

/** Authenticated card → "Enter ship". Card visuals are presentation only. */
export function CardScreen({ me, onEnter, onLogout }: { me: TeamStatus | CommanderStatus; onEnter: () => void; onLogout: () => void }) {
  const id = cardIdentity(me);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="starfield absolute inset-0 z-40 flex flex-col items-center justify-center overflow-y-auto bg-[#071722]/80 p-5 text-center">
      <Label className="mb-3 !text-primary">SHIP SECURITY / IDENTITY CONFIRMED</Label>
      <h1 className="mb-7 font-display text-3xl font-bold">{id.commander ? 'Commander card generated.' : 'Crew card generated.'}</h1>
      <motion.div initial={{ y: 80, opacity: 0, rotate: 6 }} animate={{ y: 0, opacity: 1, rotate: 0 }} transition={{ duration: 0.8, type: 'spring' }} className="w-full max-w-[380px]">
        <AccessCard name={id.name} crewId={id.crewId} color={id.color} commander={id.commander} roleLabel={id.roleLabel} />
      </motion.div>
      <p className="mb-7 mt-8 text-sm text-muted">{id.commander ? 'Swipe this card at the command control panel to open the console.' : 'This card belongs to your entire team.'}</p>
      <div className="flex gap-3">
        <Button secondary onClick={onLogout}>
          <LogOut size={15} /> Sign out
        </Button>
        <Button onClick={onEnter} className="px-9">
          Enter ship <ArrowRight size={16} />
        </Button>
      </div>
    </motion.div>
  );
}

/** The welcome transition. Skippable with any key/click; skipped instantly with reduced motion. */
export function Cinematic({ onDone }: { onDone: () => void }) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 z-50 flex cursor-pointer flex-col items-center justify-center bg-black text-center"
        onClick={onDone}
        role="button"
        tabIndex={0}
        aria-label="Skip intro"
        onKeyDown={onDone}
      >
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: [0, 1, 1, 0], y: 0 }} transition={{ duration: 2.5, times: [0, 0.25, 0.8, 1] }} onAnimationComplete={onDone}>
          <Label className="mb-5 !text-[#aec7bb]">WELCOME TO</Label>
          <h1 className="font-sans text-5xl font-extrabold tracking-wide text-[#f0f0dc] sm:text-7xl">
            AMONG <span className="text-primary">BUGS.</span>
          </h1>
          <p className="mt-6 font-display text-sm tracking-widest text-[#91b2a8]">
            DEBUG + RUN
            <br />
            <span className="mt-2 block text-xs">by Idea Lab</span>
          </p>
        </motion.div>
        <span className="absolute bottom-8 font-mono text-[9px] tracking-widest text-[#5f7d86]">PRESS ANY KEY TO SKIP</span>
      </motion.div>
    </AnimatePresence>
  );
}

/** Restricted screen for pending / not-activated / disqualified crews. No game data. */
export function StatusScreen({ me, onRefresh, onLogout, busy }: { me: TeamStatus; onRefresh: () => void; onLogout: () => void; busy: boolean }) {
  const st = me.access.state;
  const pending = st === 'REGISTRATION_PENDING';
  const title = pending
    ? 'Registration received — awaiting organizer activation.'
    : st === 'NOT_ACTIVATED_FOR_DAY'
      ? 'Your crew is not activated for this day.'
      : st === 'TEAM_DISQUALIFIED'
        ? 'Crew disqualified.'
        : st === 'NO_ACTIVE_DAY'
          ? 'No competition day is active right now.'
          : 'Boarding unavailable.';
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="starfield absolute inset-0 z-40 overflow-y-auto bg-[#071722]/85 p-5">
      <div className="mx-auto flex min-h-full max-w-[760px] flex-col justify-center py-8">
        <div className="mb-6 flex items-center justify-between">
          <IdeaLabMark />
          <Label>{me.event.name}</Label>
        </div>
        <div className={`rounded-[22px] border-[3px] p-6 shadow-[0_12px_0_#061722] sm:p-8 ${pending ? 'border-[#64808a] bg-[#233b49]/95' : 'border-[#9d635a] bg-[#3a2f3a]/95'}`}>
          <div className="flex flex-wrap items-center gap-5">
            <Crewmate color={me.team.color} size={84} state={pending ? 'idle' : 'warning'} />
            <div className="min-w-0 flex-1">
              <Label className={pending ? '!text-primary' : '!text-[#edb191]'}>{pending ? 'CREW STATUS / PENDING' : 'CREW STATUS / ACCESS DENIED'}</Label>
              <h1 className="mt-2 font-display text-2xl font-bold">{title}</h1>
              <p className="mt-2 text-sm text-muted">{pending ? 'Organizers review registrations and approve competition days. This page updates when you refresh.' : me.access.message}</p>
            </div>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border-2 border-[#3b6270] bg-[#112e3a] p-4">
              <Label>CREW</Label>
              <div className="mt-2 font-display text-lg font-bold">{me.team.name}</div>
              <div className="font-mono text-sm text-primary">{me.team.crewId}</div>
              <ul className="mt-3 space-y-1 text-xs text-[#cfe0da]">
                {me.members.map((m) => (
                  <li key={m.position}>
                    {m.name} {m.is_captain && <span className="text-[9px] text-primary">CAPTAIN</span>}
                    <span className="text-muted"> · {m.branch}, {m.year}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border-2 border-[#3b6270] bg-[#112e3a] p-4">
              <Label>DAYS</Label>
              <p className="mt-2 text-xs text-muted">Requested: {me.team.requestedDays === 'BOTH' ? 'Day 1 and Day 2' : me.team.requestedDays === 'DAY1' ? 'Day 1' : 'Day 2'}</p>
              <div className="mt-3 space-y-2">
                {me.days.map((d) => (
                  <div key={d.day_number} className="flex items-center justify-between rounded border border-[#3c5c69] bg-[#16313d] px-3 py-2 text-xs">
                    <span>
                      {d.label}
                      {me.currentDay?.number === d.day_number && <span className="ml-2 text-[9px] text-[#e5cf8f]">TODAY</span>}
                    </span>
                    <span className={d.active ? 'font-mono text-primary' : 'font-mono text-[#e5a18d]'}>{d.active ? 'APPROVED' : 'NOT APPROVED'}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <Button secondary onClick={onLogout}>
              <LogOut size={14} /> Sign out
            </Button>
            <Button onClick={onRefresh} disabled={busy}>
              {busy ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />} Check status
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function ChangePassword({ onDone, onLogout }: { onDone: () => void; onLogout: () => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) return setErr({ confirm: 'Passwords do not match.' });
    setBusy(true);
    setErr({});
    setMsg(null);
    try {
      await api.post('/api/auth/change-password', { currentPassword: cur, newPassword: next });
      onDone();
    } catch (ex) {
      if (ex instanceof ApiError) {
        setErr(ex.fields);
        setMsg(ex.message);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="starfield absolute inset-0 z-40 flex items-center justify-center overflow-y-auto bg-[#071722]/85 p-5">
      <form onSubmit={submit} className="w-full max-w-[440px] rounded-[22px] border-[3px] border-[#64808a] bg-[#233b49]/95 p-6 shadow-[0_12px_0_#061722]">
        <Label className="!text-primary">SHIP SECURITY / FIRST BOARDING</Label>
        <h1 className="mb-2 mt-1 font-display text-xl font-bold">Set your crew password</h1>
        <p className="mb-5 text-xs text-muted">Your crew was created by the organizers with a temporary password. Choose a new one; other devices will be signed out.</p>
        <Field label="TEMPORARY PASSWORD" error={err.currentPassword}>
          <input className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
        </Field>
        <Field label="NEW PASSWORD" error={err.newPassword} hint="At least 10 characters, with a letter and a number.">
          <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="CONFIRM NEW PASSWORD" error={err.confirm}>
          <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {msg && <p role="alert" className="mb-3 text-xs text-[#f3b399]">{msg}</p>}
        <div className="flex justify-between gap-3">
          <Button secondary onClick={onLogout}>
            Sign out
          </Button>
          <Button type="submit" disabled={busy || !cur || !next}>
            <KeyRound size={14} /> Save password
          </Button>
        </div>
      </form>
    </div>
  );
}

/** /reset — completes an organizer-issued, expiring reset code. No email provider needed. */
export function ResetScreen({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState(() => new URLSearchParams(location.search).get('code') ?? '');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw !== confirm) return setMsg('Passwords do not match.');
    setBusy(true);
    setMsg(null);
    try {
      await api.post('/api/auth/reset', { token: token.trim(), password: pw });
      setOk(true);
    } catch (ex) {
      setMsg(ex instanceof ApiError ? ex.message : 'Reset failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="starfield absolute inset-0 z-40 flex items-center justify-center overflow-y-auto bg-[#071722]/85 p-5">
      <form onSubmit={submit} className="w-full max-w-[440px] rounded-[22px] border-[3px] border-[#64808a] bg-[#233b49]/95 p-6 shadow-[0_12px_0_#061722]">
        <Label className="!text-primary">SHIP SECURITY / PASSWORD RESET</Label>
        <h1 className="mb-2 mt-1 font-display text-xl font-bold">Reset your crew password</h1>
        {ok ? (
          <>
            <p className="my-5 text-sm text-primary">Password updated. All devices were signed out — sign in again with the new password.</p>
            <Button onClick={onDone}>Go to boarding</Button>
          </>
        ) : (
          <>
            <p className="mb-5 text-xs text-muted">Enter the one-time reset code an organizer gave your captain. Codes expire after 30 minutes.</p>
            <Field label="RESET CODE">
              <input className="input font-mono" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="one-time-code" />
            </Field>
            <Field label="NEW PASSWORD" hint="At least 10 characters, with a letter and a number.">
              <input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            </Field>
            <Field label="CONFIRM NEW PASSWORD">
              <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            {msg && <p role="alert" className="mb-3 text-xs text-[#f3b399]">{msg}</p>}
            <div className="flex justify-between gap-3">
              <Button secondary onClick={onDone}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !token || !pw}>
                <KeyRound size={14} /> Reset password
              </Button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
