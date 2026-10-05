import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, CalendarDays, KeyRound, LoaderCircle, LogOut, RefreshCw } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, ApiError, FALLBACK_EVENT_NAME, V1, type CrewIdentity } from '../lib/api';
import { AccessCard, Button, Crewmate, Field, IdeaLabMark, Label } from '../components/ui';
import { formatSlotDate, formatTime, useEventMeta } from '../game/format';

/** Authenticated crew card → "Enter ship". Card visuals are presentation only. */
export function CardScreen({ me, onEnter, onLogout }: { me: CrewIdentity; onEnter: () => void; onLogout: () => void }) {
  const slot = me.access.slot;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="starfield absolute inset-0 z-40 flex flex-col items-center justify-center overflow-y-auto bg-[#071722]/80 p-5 text-center">
      <Label className="mb-3 !text-primary">SHIP SECURITY / IDENTITY CONFIRMED</Label>
      <h1 className="mb-7 font-display text-3xl font-bold">Crew card generated.</h1>
      <motion.div initial={{ y: 80, opacity: 0, rotate: 6 }} animate={{ y: 0, opacity: 1, rotate: 0 }} transition={{ duration: 0.8, type: 'spring' }} className="w-full max-w-[380px]">
        <AccessCard name={me.team.name} crewId={me.team.crewId} color={me.team.color} roleLabel={slot ? `COMPETITOR · SLOT ${slot.number}` : 'COMPETITOR'} />
      </motion.div>
      {slot && (
        <div className="mt-6 flex max-w-[380px] items-center gap-3 rounded-xl border-2 border-[#3b6270] bg-[#112e3a]/90 px-4 py-3 text-left">
          <CalendarDays size={20} className="shrink-0 text-primary" />
          <div className="min-w-0">
            <Label>ASSIGNED SLOT</Label>
            <div className="mt-1 font-display text-sm font-bold">
              {slot.name}
              {slot.dayLabel ? ` · ${slot.dayLabel}` : ''}
            </div>
            <div className="font-mono text-[10px] text-[#a9c7c4]">
              {formatSlotDate(slot.date)}
              {slot.scheduledStartAt ? ` · boarding ${formatTime(slot.scheduledStartAt)}` : ''}
            </div>
          </div>
        </div>
      )}
      <p className="mb-7 mt-6 text-sm text-muted">This card belongs to your entire crew.</p>
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
  const meta = useEventMeta();
  const name = (meta?.event?.name || FALLBACK_EVENT_NAME).toUpperCase();
  const parts = name.split(/\s+/);
  const head = parts.slice(0, -1).join(' ');
  const tail = parts[parts.length - 1];
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
            {head ? `${head} ` : ''}
            <span className="text-primary">{tail}.</span>
          </h1>
          <p className="mt-6 font-display text-sm tracking-widest text-[#91b2a8]">
            AMONG BUG
            <br />
            <span className="mt-2 block text-xs">by {meta?.event?.organizer || 'IDEALab'}</span>
          </p>
        </motion.div>
        <span className="absolute bottom-8 font-mono text-[9px] tracking-widest text-[#5f7d86]">PRESS ANY KEY TO SKIP</span>
      </motion.div>
    </AnimatePresence>
  );
}

const STATUS_COPY: Record<string, { label: string; title: string; hint: string; tone: 'wait' | 'bad' }> = {
  SLOT_UNASSIGNED: {
    label: 'CREW STATUS / AWAITING SLOT',
    title: 'Not yet assigned to a slot.',
    hint: 'The organizer desk will assign your crew to one of the four slots. Check back here — this page updates when you refresh.',
    tone: 'wait',
  },
  ACCOUNT_DISABLED: { label: 'CREW STATUS / ACCOUNT DISABLED', title: 'This crew account is disabled.', hint: 'Ask the organizer desk to re-enable your crew.', tone: 'bad' },
  TEAM_DISQUALIFIED: { label: 'CREW STATUS / DISQUALIFIED', title: 'Crew disqualified.', hint: 'Contact the organizer desk if you believe this is a mistake.', tone: 'bad' },
  TEAM_ARCHIVED: { label: 'CREW STATUS / ARCHIVED', title: 'This crew has been archived.', hint: 'Contact the organizer desk.', tone: 'bad' },
};

/** Restricted screen for crews that cannot play (no slot / disabled / disqualified / archived). No game data. */
export function StatusScreen({ me, onRefresh, onLogout, busy }: { me: CrewIdentity; onRefresh: () => void; onLogout: () => void; busy: boolean }) {
  const meta = useEventMeta();
  const st = me.access.state;
  const copy = STATUS_COPY[st] ?? { label: 'CREW STATUS / BOARDING UNAVAILABLE', title: 'Boarding unavailable.', hint: 'Contact the organizer desk.', tone: 'bad' as const };
  const wait = copy.tone === 'wait';
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="starfield absolute inset-0 z-40 overflow-y-auto bg-[#071722]/85 p-4 sm:p-5">
      <div className="mx-auto flex min-h-full max-w-[760px] flex-col justify-center py-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <IdeaLabMark />
          <Label>{(meta?.event?.name || FALLBACK_EVENT_NAME).toUpperCase()}</Label>
        </div>
        <div className={`rounded-[22px] border-[3px] p-5 shadow-[0_12px_0_#061722] sm:p-8 ${wait ? 'border-[#64808a] bg-[#233b49]/95' : 'border-[#9d635a] bg-[#3a2f3a]/95'}`}>
          <div className="flex flex-wrap items-center gap-5">
            <Crewmate color={me.team.color} size={84} state={wait ? 'idle' : 'warning'} />
            <div className="min-w-0 flex-1">
              <Label className={wait ? '!text-primary' : '!text-[#edb191]'}>{copy.label}</Label>
              <h1 className="mt-2 font-display text-2xl font-bold">{copy.title}</h1>
              {me.access.message && <p className="mt-2 text-sm text-[#d6e3de]">{me.access.message}</p>}
              <p className="mt-2 text-xs text-muted">{copy.hint}</p>
            </div>
          </div>
          <div className="mt-6 rounded-xl border-2 border-[#3b6270] bg-[#112e3a] p-4">
            <Label>CREW</Label>
            <div className="mt-2 font-display text-lg font-bold">{me.team.name}</div>
            <div className="font-mono text-sm text-primary">{me.team.crewId}</div>
            <ul className="mt-3 space-y-1 text-xs text-[#cfe0da]">
              {me.members.map((m, i) => (
                <li key={`${m.name}-${i}`}>
                  {m.name} {m.is_captain && <span className="text-[9px] text-primary">CAPTAIN</span>}
                  {m.institution && <span className="text-muted"> · {m.institution}</span>}
                </li>
              ))}
            </ul>
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

/** Required after the organizers mailed credentials (team.mustChangePassword). */
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
      await api.post(`${V1}/auth/change-password`, { currentPassword: cur, newPassword: next });
      onDone();
    } catch (ex) {
      if (ex instanceof ApiError) {
        setErr(ex.fields);
        setMsg(ex.message);
      } else setMsg('Could not change the password.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="starfield absolute inset-0 z-40 flex items-center justify-center overflow-y-auto bg-[#071722]/85 p-4 sm:p-5">
      <form onSubmit={submit} className="w-full max-w-[440px] rounded-[22px] border-[3px] border-[#64808a] bg-[#233b49]/95 p-5 shadow-[0_12px_0_#061722] sm:p-6">
        <Label className="!text-primary">SHIP SECURITY / FIRST BOARDING</Label>
        <h1 className="mb-2 mt-1 font-display text-xl font-bold">Set your crew password</h1>
        <p className="mb-5 text-xs text-muted">Your credentials were mailed by the organizers. Choose a new password before boarding — other devices of your crew will be signed out.</p>
        <Field label="PASSWORD FROM THE CREDENTIAL MAIL" error={err.currentPassword}>
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
            {busy ? <LoaderCircle size={14} className="animate-spin" /> : <KeyRound size={14} />} Save password
          </Button>
        </div>
      </form>
    </div>
  );
}
