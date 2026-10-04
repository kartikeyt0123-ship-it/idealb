import { z } from 'zod';
import { many, one, withTx, type Db, type Queryable, type Tx } from '../db.js';
import { AppError } from '../errors.js';
import { checkTeamPasswordPolicy, hashPassword, randomToken, sha256 } from '../security/crypto.js';
import { audit, type Actor } from './audit.js';
import { getEvent, listDays } from './context.js';
import { claimIdempotency } from './idempotency.js';
import { emit, Rooms } from './outbox.js';
import { revokeAllTeamSessions } from './sessions.js';
import { applyLedger } from './wallet.js';

export const CREW_COLORS: [string, string][] = [
  ['Cyan', '#51cfdf'], ['Red', '#f37983'], ['Green', '#86cd97'], ['Yellow', '#edd478'], ['Purple', '#b298e7'],
  ['Orange', '#efae77'], ['Pink', '#d693b9'], ['Blue', '#7dace9'], ['Lime', '#b3d77c'], ['White', '#dfe7ea'],
];
const COLOR_SET = new Set(CREW_COLORS.map(([, c]) => c));

const text = (min: number, max: number, label: string) =>
  z.string({ required_error: `${label} is required.` }).trim().min(min, `${label} is required.`).max(max, `${label} must be at most ${max} characters.`);

export const memberSchema = z.object({
  name: text(1, 80, 'Name'),
  institution: text(1, 120, 'Institution'),
  year: text(1, 20, 'Year'),
  branch: text(1, 80, 'Branch'),
  studentId: z.string().trim().max(40, 'Student ID must be at most 40 characters.').optional().or(z.literal('')),
});

export const registrationSchema = z
  .object({
    teamName: text(2, 32, 'Team name').regex(/^[\p{L}\p{N} ._&-]+$/u, 'Team name may use letters, numbers, spaces and . _ & -'),
    captainEmail: z.string().trim().max(254).email('Enter a valid email address.'),
    password: z.string().max(128),
    confirmPassword: z.string().max(128),
    members: z.array(memberSchema).min(3, 'A crew needs 3 or 4 members (including the captain).').max(4, 'A crew needs 3 or 4 members (including the captain).'),
    requestedDays: z.enum(['DAY1', 'DAY2', 'BOTH'], { errorMap: () => ({ message: 'Choose Day 1, Day 2 or Both.' }) }),
    color: z.string().refine((c) => COLOR_SET.has(c), 'Choose a crewmate color from the palette.'),
    rulesAccepted: z.literal(true, { errorMap: () => ({ message: 'You must confirm the competition rules.' }) }),
  })
  .strict();

export type RegistrationInput = z.infer<typeof registrationSchema>;

export function normalizeEmail(e: string) {
  return e.trim().toLowerCase();
}
export function normalizeTeamName(n: string) {
  return n.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function zodFieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = i.path.join('.') || '_';
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

function mapUniqueViolation(err: unknown): never {
  const e = err as { code?: string; constraint?: string };
  if (e.code === '23505') {
    if (e.constraint?.includes('email')) throw new AppError('DUPLICATE_EMAIL', 'A crew with this captain email is already registered.', { fields: { captainEmail: 'This email is already registered.' } });
    if (e.constraint?.includes('name')) throw new AppError('DUPLICATE_TEAM_NAME', 'That team name is taken.', { fields: { teamName: 'This team name is already taken.' } });
  }
  throw err;
}

async function nextCrewId(tx: Tx): Promise<string> {
  const r = await one<{ n: number }>(tx, `SELECT nextval('crew_number_seq')::int AS n`);
  return `CRW-${String(r!.n).padStart(3, '0')}`;
}

interface CreateTeamArgs {
  teamName: string;
  email: string;
  passwordHash: string;
  members: z.infer<typeof memberSchema>[];
  requestedDays: 'DAY1' | 'DAY2' | 'BOTH';
  color: string;
  createdVia: 'SELF' | 'ADMIN' | 'IMPORT' | 'SEED';
  mustChangePassword: boolean;
  crewId?: string;
}

/** Inserts team + roster + (inactive) day eligibility rows. Caller owns the transaction. */
export async function insertTeam(tx: Tx, a: CreateTeamArgs): Promise<{ id: string; crewId: string }> {
  const ev = await getEvent(tx);
  const crewId = a.crewId ?? (await nextCrewId(tx));
  const captain = a.members[0];
  const team = await one<{ id: string }>(
    tx,
    `INSERT INTO team(event_id, crew_id, name, name_normalized, email, email_normalized, captain_name, password_hash, color,
                      requested_days, rules_accepted_at, created_via, must_change_password)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$11,$12) RETURNING id`,
    [ev.id, crewId, a.teamName.trim().replace(/\s+/g, ' '), normalizeTeamName(a.teamName), a.email.trim(), normalizeEmail(a.email), captain.name,
      a.passwordHash, a.color, a.requestedDays, a.createdVia, a.mustChangePassword],
  ).catch(mapUniqueViolation);
  for (let i = 0; i < a.members.length; i++) {
    const m = a.members[i];
    await tx.query(
      `INSERT INTO team_member(team_id, position, name, institution, year, branch, student_id, is_captain) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [team!.id, i + 1, m.name, m.institution, m.year, m.branch, m.studentId || null, i === 0],
    );
  }
  for (const d of await listDays(tx, ev.id)) {
    await tx.query('INSERT INTO team_day_eligibility(team_id, day_id, active) VALUES ($1,$2,false)', [team!.id, d.id]);
  }
  return { id: team!.id, crewId };
}

/**
 * Public self-registration. Atomic: team, hash, crew ID, roster and requested
 * days are created together or not at all. The request can never set roles,
 * coins, active flags or approved days. Idempotent by key.
 */
export async function registerTeam(db: Db, input: unknown, idempotencyKey: string | undefined) {
  const parsed = registrationSchema.safeParse(input);
  if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'Please fix the highlighted fields.', { fields: zodFieldErrors(parsed.error) });
  const d = parsed.data;
  const fields: Record<string, string> = {};
  const pwErr = checkTeamPasswordPolicy(d.password);
  if (pwErr) fields.password = pwErr;
  if (d.password !== d.confirmPassword) fields.confirmPassword = 'Passwords do not match.';
  if (Object.keys(fields).length) throw new AppError('VALIDATION_FAILED', 'Please fix the highlighted fields.', { fields });
  if (!idempotencyKey) throw new AppError('VALIDATION_FAILED', 'Missing Idempotency-Key header.');
  const passwordHash = await hashPassword(d.password);
  // Fingerprint excludes the password so a retry from the same form is recognised.
  const { password: _p, confirmPassword: _c, ...fp } = d;
  return withTx(db, async (tx) => {
    const idem = await claimIdempotency(tx, `register:${normalizeEmail(d.captainEmail)}`, 'register-team', idempotencyKey, fp);
    if (idem.existing) return idem.existing as { crewId: string; teamName: string; status: string };
    const t = await insertTeam(tx, {
      teamName: d.teamName, email: d.captainEmail, passwordHash, members: d.members, requestedDays: d.requestedDays,
      color: d.color, createdVia: 'SELF', mustChangePassword: false,
    });
    await audit(tx, { type: 'TEAM', id: t.id }, 'team.registered', { type: 'team', id: t.id }, { crewId: t.crewId, requestedDays: d.requestedDays, members: d.members.length });
    await emit(tx, 'crews.changed', [Rooms.admin], { teamId: t.id, crewId: t.crewId, change: 'REGISTERED' });
    const response = { crewId: t.crewId, teamName: d.teamName, status: 'PENDING_ACTIVATION' };
    await idem.save(response);
    return response;
  });
}

// ---------------------------------------------------------------------------
// Eligibility & enrollment
// ---------------------------------------------------------------------------

/** Ensures an enrollment exists in the game mapped to `dayId`. Starting coins are a GRANT (wallet funding, not score). */
export async function ensureEnrollment(tx: Tx, teamId: string, dayId: string, actor: Actor) {
  const game = await one<{ id: string; starting_coins: number }>(tx, 'SELECT id, starting_coins FROM game WHERE day_id=$1', [dayId]);
  if (!game) return null;
  const existing = await one<{ id: string }>(tx, 'SELECT id FROM game_enrollment WHERE game_id=$1 AND team_id=$2', [game.id, teamId]);
  if (existing) return existing.id;
  const enr = await one<import('./context.js').EnrollmentRow>(tx, `INSERT INTO game_enrollment(game_id, team_id) VALUES ($1,$2) RETURNING *`, [game.id, teamId]);
  if (game.starting_coins > 0) {
    await applyLedger(tx, enr!, { kind: 'GRANT', wallet: game.starting_coins, grant: game.starting_coins, sourceType: 'starting-grant', sourceId: enr!.id, reason: 'Starting wallet', actorAdminId: actor.type === 'ADMIN' ? actor.id : null });
  }
  return enr!.id;
}

export async function setDayEligibility(tx: Tx, actor: Actor, teamId: string, dayId: string, active: boolean) {
  const team = await one<{ id: string; crew_id: string }>(tx, 'SELECT id, crew_id FROM team WHERE id=$1 FOR UPDATE', [teamId]);
  if (!team) throw new AppError('NOT_FOUND', 'Crew not found.');
  const prev = await one<{ active: boolean }>(tx, 'SELECT active FROM team_day_eligibility WHERE team_id=$1 AND day_id=$2', [teamId, dayId]);
  await tx.query(
    `INSERT INTO team_day_eligibility(team_id, day_id, active, updated_by, updated_at) VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (team_id, day_id) DO UPDATE SET active=EXCLUDED.active, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [teamId, dayId, active, actor.id],
  );
  if (active) await ensureEnrollment(tx, teamId, dayId, actor);
  if ((prev?.active ?? false) !== active) {
    const day = await one<{ day_number: number }>(tx, 'SELECT day_number FROM event_day WHERE id=$1', [dayId]);
    await audit(tx, actor, active ? 'eligibility.enabled' : 'eligibility.disabled', { type: 'team', id: teamId }, { crewId: team.crew_id, day: day?.day_number });
    await emit(tx, 'eligibility.changed', [Rooms.team(teamId), Rooms.admin], { teamId, dayId, day: day?.day_number, active });
    const game = await one<{ id: string }>(tx, 'SELECT id FROM game WHERE day_id=$1', [dayId]);
    if (game) await emit(tx, 'standings.updated', [Rooms.game(game.id), Rooms.admin], { gameId: game.id });
  }
}

// ---------------------------------------------------------------------------
// Admin provisioning: create, import, reset
// ---------------------------------------------------------------------------

export const adminCreateSchema = z.object({
  teamName: registrationSchema.shape.teamName,
  captainEmail: z.string().trim().max(254).email('Enter a valid email address.'),
  members: registrationSchema.shape.members,
  requestedDays: z.enum(['DAY1', 'DAY2', 'BOTH']),
  color: z.string().refine((c) => COLOR_SET.has(c), 'Invalid color.'),
  activeDays: z.array(z.number().int().min(1).max(2)).default([]),
});

function tempPassword(): string {
  // 4 groups of base32-ish chars + digit guarantee: satisfies the team policy.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const raw = randomToken(12).replace(/[^A-Za-z]/g, '');
  const letters = Array.from(raw.slice(0, 10)).map((c, i) => (alphabet.includes(c) ? c : alphabet[i % alphabet.length])).join('');
  return `${letters.slice(0, 5)}-${letters.slice(5, 10)}-${Math.floor(10 + Math.random() * 89)}`;
}

export async function adminCreateTeams(db: Db, actor: Actor, rows: unknown[], via: 'ADMIN' | 'IMPORT') {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 300) throw new AppError('VALIDATION_FAILED', 'Provide 1-300 crews.');
  const parsed = rows.map((r, i) => {
    const p = adminCreateSchema.safeParse(r);
    if (!p.success) throw new AppError('VALIDATION_FAILED', `Row ${i + 1}: ${Object.values(zodFieldErrors(p.error))[0]}`, { row: i + 1, fields: zodFieldErrors(p.error) });
    return p.data;
  });
  const prepared = await Promise.all(
    parsed.map(async (p) => {
      const pw = tempPassword();
      return { p, pw, hash: await hashPassword(pw) };
    }),
  );
  return withTx(db, async (tx) => {
    const ev = await getEvent(tx);
    const days = await listDays(tx, ev.id);
    const out: { crewId: string; teamName: string; email: string; temporaryPassword: string }[] = [];
    for (const { p, pw, hash } of prepared) {
      const t = await insertTeam(tx, {
        teamName: p.teamName, email: p.captainEmail, passwordHash: hash, members: p.members, requestedDays: p.requestedDays,
        color: p.color, createdVia: via, mustChangePassword: true,
      });
      for (const dn of p.activeDays) {
        const day = days.find((d) => d.day_number === dn);
        if (day) await setDayEligibility(tx, actor, t.id, day.id, true);
      }
      await audit(tx, actor, via === 'IMPORT' ? 'team.imported' : 'team.created', { type: 'team', id: t.id }, { crewId: t.crewId });
      out.push({ crewId: t.crewId, teamName: p.teamName, email: p.captainEmail, temporaryPassword: pw });
    }
    await emit(tx, 'crews.changed', [Rooms.admin], { change: 'CREATED', count: out.length });
    return out;
  });
}

/** Issues a one-time, expiring reset token (no email provider needed) and revokes the crew's sessions. */
export async function issuePasswordReset(db: Db, actor: Actor, teamId: string) {
  const token = randomToken(24);
  await withTx(db, async (tx) => {
    const t = await one<{ id: string; crew_id: string }>(tx, 'SELECT id, crew_id FROM team WHERE id=$1 FOR UPDATE', [teamId]);
    if (!t) throw new AppError('NOT_FOUND', 'Crew not found.');
    await tx.query(`UPDATE password_reset SET used_at=now() WHERE team_id=$1 AND used_at IS NULL`, [teamId]);
    await tx.query(`INSERT INTO password_reset(team_id, token_hash, expires_at, created_by_admin) VALUES ($1,$2, now() + interval '30 minutes', $3)`, [teamId, sha256(token), actor.id]);
    await revokeAllTeamSessions(tx, teamId, 'PASSWORD_RESET_ISSUED');
    await audit(tx, actor, 'team.password_reset_issued', { type: 'team', id: teamId }, { crewId: t.crew_id });
  });
  return { resetToken: token, expiresInMinutes: 30 };
}

export async function completePasswordReset(db: Db, token: string, newPassword: string) {
  const pwErr = checkTeamPasswordPolicy(newPassword);
  if (pwErr) throw new AppError('VALIDATION_FAILED', pwErr, { fields: { password: pwErr } });
  const hash = await hashPassword(newPassword);
  return withTx(db, async (tx) => {
    const r = await one<{ id: string; team_id: string }>(tx, `SELECT id, team_id FROM password_reset WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`, [sha256(token)]);
    if (!r) throw new AppError('VALIDATION_FAILED', 'This reset link is invalid or has expired. Ask an organizer for a new one.');
    await tx.query('UPDATE password_reset SET used_at=now() WHERE id=$1', [r.id]);
    await tx.query('UPDATE team SET password_hash=$2, must_change_password=false, updated_at=now() WHERE id=$1', [r.team_id, hash]);
    await revokeAllTeamSessions(tx, r.team_id, 'PASSWORD_CHANGED');
    await audit(tx, { type: 'TEAM', id: r.team_id }, 'team.password_reset_completed', { type: 'team', id: r.team_id });
    return { ok: true };
  });
}

export async function getTeamProfile(q: Queryable, teamId: string) {
  const team = await one<Record<string, unknown>>(q, `SELECT id, crew_id, name, email, captain_name, color, requested_days, status, must_change_password, created_at FROM team WHERE id=$1`, [teamId]);
  const members = await many(q, 'SELECT position, name, institution, year, branch, student_id, is_captain FROM team_member WHERE team_id=$1 ORDER BY position', [teamId]);
  const days = await many<{ day_number: number; label: string; active: boolean }>(
    q,
    `SELECT d.day_number, d.label, COALESCE(e.active,false) AS active FROM event_day d
       LEFT JOIN team_day_eligibility e ON e.day_id=d.id AND e.team_id=$1 ORDER BY d.day_number`,
    [teamId],
  );
  return { team, members, days };
}
