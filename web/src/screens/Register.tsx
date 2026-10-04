import { motion } from 'motion/react';
import { ArrowLeft, Check, LoaderCircle, Minus, Plus, UserPlus } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { api, ApiError, CREW_COLORS, newKey } from '../lib/api';
import { AccessCard, Button, Crewmate, Field, IdeaLabMark, Label } from '../components/ui';
import { sfx } from '../lib/sound';

interface Member {
  name: string;
  institution: string;
  year: string;
  branch: string;
  studentId: string;
}
const blank = (): Member => ({ name: '', institution: '', year: '', branch: '', studentId: '' });
const YEARS = ['1st year', '2nd year', '3rd year', '4th year', '5th year', 'Postgraduate'];

export function Register({ onBack, onLogin }: { onBack: () => void; onLogin: () => void }) {
  const [teamName, setTeamName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [members, setMembers] = useState<Member[]>([blank(), blank(), blank()]);
  const [days, setDays] = useState<'DAY1' | 'DAY2' | 'BOTH'>('BOTH');
  const [color, setColor] = useState(CREW_COLORS[0][1]);
  const [rules, setRules] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<{ crewId: string; teamName: string } | null>(null);
  // One key per logical submission: a retry after a network failure is recognised by the server.
  const key = useRef(newKey('reg'));

  const setMember = (i: number, k: keyof Member, v: string) => setMembers((m) => m.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const err = (k: string) => errors[k];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const r = await api.post<{ crewId: string; teamName: string }>(
        '/api/auth/register',
        { teamName, captainEmail: email, password, confirmPassword: confirm, members, requestedDays: days, color, rulesAccepted: rules },
        key.current,
      );
      sfx.great();
      setDone(r);
      setPassword('');
      setConfirm('');
      key.current = newKey('reg');
    } catch (ex) {
      if (ex instanceof ApiError) {
        setErrors(ex.fields);
        setFormError(ex.message);
        // A validation/duplicate failure is a new logical attempt next time.
        if (ex.status !== 0) key.current = newKey('reg');
      } else setFormError('Registration failed. Try again.');
      sfx.bad();
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="starfield absolute inset-0 z-40 flex flex-col items-center justify-center overflow-y-auto bg-[#071722]/85 p-5 text-center">
        <Label className="mb-3 !text-primary">SHIP SECURITY / REGISTRATION LOGGED</Label>
        <h1 className="mb-6 font-display text-3xl font-bold">Registration received — awaiting organizer activation.</h1>
        <motion.div initial={{ y: 60, opacity: 0, rotate: 5 }} animate={{ y: 0, opacity: 1, rotate: 0 }} transition={{ type: 'spring', duration: 0.8 }} className="w-full max-w-[380px]">
          <AccessCard name={done.teamName.toUpperCase()} crewId={done.crewId} color={color} roleLabel="PENDING ACTIVATION" />
        </motion.div>
        <p className="mx-auto mt-7 max-w-md text-sm leading-6 text-muted">
          Your stable crew ID is <span className="font-mono text-primary">{done.crewId}</span>. Organizers will approve your competition day(s). Sign in with your captain email
          to check your status; the ship opens once your day is activated.
        </p>
        <div className="mt-7 flex gap-3">
          <Button secondary onClick={onBack}>
            Back to boarding
          </Button>
          <Button onClick={onLogin}>Crew login</Button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="starfield absolute inset-0 z-40 overflow-y-auto bg-[#061522]/80">
      <div className="mx-auto max-w-[980px] px-5 py-6 sm:px-10">
        <header className="mb-6 flex items-center justify-between">
          <IdeaLabMark />
          <button onClick={onBack} className="flex items-center gap-2 text-xs text-[#a9c4c2] hover:text-primary">
            <ArrowLeft size={14} /> Back to boarding
          </button>
        </header>
        <form onSubmit={submit} noValidate className="rounded-[22px] border-[3px] border-[#64808a] bg-[#233b49]/95 p-5 shadow-[0_12px_0_#061722] sm:p-8">
          <div className="mb-6 flex items-center gap-3 border-b border-[#617c81]/40 pb-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-[#61827e] bg-[#14323c] text-primary">
              <UserPlus size={22} />
            </div>
            <div>
              <Label className="!text-primary">SHIP SECURITY / NEW CREW</Label>
              <h1 className="mt-1 font-display text-2xl font-bold">Register your team</h1>
            </div>
          </div>

          <div className="grid gap-x-6 md:grid-cols-2">
            <Field label="TEAM NAME" error={err('teamName')}>
              <input className="input" value={teamName} onChange={(e) => setTeamName(e.target.value)} maxLength={32} aria-invalid={!!err('teamName')} placeholder="e.g. Orbit Menders" required />
            </Field>
            <Field label="CAPTAIN EMAIL (TEAM LOGIN)" error={err('captainEmail')}>
              <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!err('captainEmail')} placeholder="captain@college.edu" required />
            </Field>
            <Field label="PASSWORD" error={err('password')} hint="At least 10 characters, with a letter and a number.">
              <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!err('password')} required />
            </Field>
            <Field label="CONFIRM PASSWORD" error={err('confirmPassword')}>
              <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={!!err('confirmPassword')} required />
            </Field>
          </div>

          <fieldset className="mt-2">
            <legend className="mb-3 flex w-full items-center justify-between">
              <span className="font-mono text-[9px] tracking-widest text-[#b3c4c8]">CREW ROSTER · 3–4 MEMBERS · MEMBER 1 IS THE CAPTAIN</span>
              <span className="flex gap-2">
                <button type="button" disabled={members.length <= 3} onClick={() => setMembers((m) => m.slice(0, 3))} className="flex items-center gap-1 rounded border border-[#52717e] px-2 py-1 text-[10px] disabled:opacity-30" aria-label="Remove fourth member">
                  <Minus size={11} /> Member
                </button>
                <button type="button" disabled={members.length >= 4} onClick={() => setMembers((m) => [...m, blank()])} className="flex items-center gap-1 rounded border border-[#52717e] px-2 py-1 text-[10px] disabled:opacity-30" aria-label="Add fourth member">
                  <Plus size={11} /> Member
                </button>
              </span>
            </legend>
            {err('members') && <p role="alert" className="mb-2 text-[11px] text-[#f3b399]">{err('members')}</p>}
            <div className="space-y-3">
              {members.map((m, i) => (
                <div key={i} className="grid gap-2 rounded-xl border-2 border-[#365463] bg-[#142d39] p-3 sm:grid-cols-[auto_1.3fr_1.5fr_1fr_1fr_1fr]">
                  <div className="flex items-center gap-2 font-mono text-[10px] text-[#8db4b7] sm:w-16">
                    {String(i + 1).padStart(2, '0')}
                    {i === 0 && <span className="rounded bg-primary/15 px-1 text-[8px] text-primary">CAPT</span>}
                  </div>
                  <input aria-label={`Member ${i + 1} name`} className="input" placeholder="Full name" value={m.name} onChange={(e) => setMember(i, 'name', e.target.value)} aria-invalid={!!err(`members.${i}.name`)} />
                  <input aria-label={`Member ${i + 1} institution`} className="input" placeholder="Institution" value={m.institution} onChange={(e) => setMember(i, 'institution', e.target.value)} aria-invalid={!!err(`members.${i}.institution`)} />
                  <select aria-label={`Member ${i + 1} year`} className="input" value={m.year} onChange={(e) => setMember(i, 'year', e.target.value)} aria-invalid={!!err(`members.${i}.year`)}>
                    <option value="">Year</option>
                    {YEARS.map((y) => (
                      <option key={y}>{y}</option>
                    ))}
                  </select>
                  <input aria-label={`Member ${i + 1} branch`} className="input" placeholder="Branch" value={m.branch} onChange={(e) => setMember(i, 'branch', e.target.value)} aria-invalid={!!err(`members.${i}.branch`)} />
                  <input aria-label={`Member ${i + 1} student ID (optional)`} className="input" placeholder="Student ID (opt.)" value={m.studentId} onChange={(e) => setMember(i, 'studentId', e.target.value)} />
                  {Object.entries(errors).filter(([k]) => k.startsWith(`members.${i}.`)).slice(0, 1).map(([k, v]) => (
                    <p key={k} role="alert" className="text-[11px] text-[#f3b399] sm:col-span-6">
                      Member {i + 1}: {v}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </fieldset>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <fieldset>
              <legend className="mb-2 font-mono text-[9px] tracking-widest text-[#b3c4c8]">PREFERRED PARTICIPATION DAY (A REQUEST — ORGANIZERS APPROVE)</legend>
              <div className="grid grid-cols-3 gap-2">
                {([['DAY1', 'Day 1'], ['DAY2', 'Day 2'], ['BOTH', 'Both']] as const).map(([v, l]) => (
                  <label key={v} className={`cursor-pointer rounded-lg border-2 px-3 py-3 text-center text-xs ${days === v ? 'border-primary bg-primary/10 text-primary' : 'border-[#344c5b] bg-[#101e2a]'}`}>
                    <input type="radio" name="days" value={v} checked={days === v} onChange={() => setDays(v)} className="sr-only" />
                    {l}
                  </label>
                ))}
              </div>
              {err('requestedDays') && <p role="alert" className="mt-1 text-[11px] text-[#f3b399]">{err('requestedDays')}</p>}
            </fieldset>
            <fieldset>
              <legend className="mb-2 font-mono text-[9px] tracking-widest text-[#b3c4c8]">CREWMATE COLOR</legend>
              <div className="flex flex-wrap items-center gap-2">
                {CREW_COLORS.map(([name, c]) => (
                  <label key={c} title={name} className={`cursor-pointer rounded-lg border-2 p-1 ${color === c ? 'border-primary bg-primary/10' : 'border-transparent'}`}>
                    <input type="radio" name="color" value={c} checked={color === c} onChange={() => setColor(c)} className="sr-only" aria-label={name} />
                    <Crewmate color={c} size={26} state="still" />
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="mt-6 rounded-xl border-2 border-[#3b6270] bg-[#112e3a] p-4 text-xs leading-6 text-[#cfe0da]">
            <Label className="mb-2 !text-primary">COMPETITION RULES (SUMMARY)</Label>
            <ul className="list-disc space-y-1 pl-5">
              <li>One shared crew identity and wallet for your whole team. Up to four devices may be signed in.</li>
              <li>Regular tasks are open to every crew; the first correct verified solution wins the reward.</li>
              <li>Hints cost IdeaCoins and can lower your score. Running code never awards coins.</li>
              <li>At the end of each sprint the bottom crews (count set by organizers) are ejected. Ties are decided by a published organizer tiebreak.</li>
              <li>Day participation is approved by organizers; registration alone does not grant access.</li>
            </ul>
            <label className="mt-3 flex items-center gap-3">
              <input type="checkbox" checked={rules} onChange={(e) => setRules(e.target.checked)} className="h-4 w-4 accent-[#8ae4cf]" aria-invalid={!!err('rulesAccepted')} />
              <span>Our crew understands and accepts the competition rules.</span>
            </label>
            {err('rulesAccepted') && <p role="alert" className="mt-1 text-[11px] text-[#f3b399]">{err('rulesAccepted')}</p>}
          </div>

          {formError && (
            <p role="alert" className="mt-5 rounded-lg border border-[#c67c6b]/40 bg-[#4e2f3b]/60 p-3 text-xs text-[#f3c3ae]">
              {formError}
            </p>
          )}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[10px] text-[#9fb9bc]">No payment or documents are collected. Passwords are never stored in your browser.</p>
            <Button type="submit" disabled={busy}>
              {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}
              Register crew
            </Button>
          </div>
        </form>
      </div>
    </motion.div>
  );
}
