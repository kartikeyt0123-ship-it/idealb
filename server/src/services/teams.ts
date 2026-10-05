import { randomInt } from 'node:crypto';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { many, one, withTx, type Db, type Queryable, type Tx } from '../db.js';
import { AppError } from '../errors.js';
import { hashPassword } from '../security/crypto.js';
import { audit, type Actor } from './audit.js';
import { getEvent, listSlots } from './context.js';
import { credentialMail, mailChannel, sendSmtp } from './mail.js';
import { emit, Rooms } from './outbox.js';
import { revokeAllTeamSessions } from './sessions.js';
import { normHeader, readUpload } from './spreadsheet.js';
import { applyLedger } from './wallet.js';

export const CREW_COLORS: [string, string][] = [
  ['Cyan', '#51cfdf'], ['Red', '#f37983'], ['Green', '#86cd97'], ['Yellow', '#edd478'], ['Purple', '#b298e7'],
  ['Orange', '#efae77'], ['Pink', '#d693b9'], ['Blue', '#7dace9'], ['Lime', '#b3d77c'], ['White', '#dfe7ea'],
];

export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export const normalizeTeamName = (n: string) => n.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

export function zodFieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = i.path.join('.') || '_';
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Import format
// ---------------------------------------------------------------------------

/** Canonical import columns. Headers are matched case/space-insensitively, with aliases, or via an explicit mapping. */
export const TEAM_IMPORT_COLUMNS = [
  'team_name', 'crew_id', 'captain_email',
  'member1_name', 'member1_institution', 'member1_year', 'member1_branch', 'member1_student_id',
  'member2_name', 'member2_institution', 'member2_year', 'member2_branch', 'member2_student_id',
  'member3_name', 'member3_institution', 'member3_year', 'member3_branch', 'member3_student_id',
  'member4_name', 'member4_institution', 'member4_year', 'member4_branch', 'member4_student_id',
  'slot', 'account_enabled', 'checked_in',
] as const;
export type TeamColumn = (typeof TEAM_IMPORT_COLUMNS)[number];

const ALIASES: Record<string, TeamColumn> = {
  team: 'team_name', teamname: 'team_name', crew: 'team_name', crewname: 'team_name',
  crewid: 'crew_id', teamid: 'crew_id', id: 'crew_id',
  email: 'captain_email', captainemail: 'captain_email', leaderemail: 'captain_email',
  captain: 'member1_name', captainname: 'member1_name', leader: 'member1_name',
  slot: 'slot', slotnumber: 'slot', assignedslot: 'slot',
  enabled: 'account_enabled', accountenabled: 'account_enabled', active: 'account_enabled',
  checkedin: 'checked_in', checkin: 'checked_in',
};
for (const c of TEAM_IMPORT_COLUMNS) ALIASES[normHeader(c)] = c;

export const TEAM_TEMPLATE_HEADER = [...TEAM_IMPORT_COLUMNS];

function autoMapping(header: string[]): Record<TeamColumn, number> {
  const m = {} as Record<TeamColumn, number>;
  header.forEach((h, i) => {
    const c = ALIASES[normHeader(h)];
    if (c && m[c] === undefined) m[c] = i;
  });
  return m;
}

const boolish = (v: string, dflt: boolean) => {
  const t = v.trim().toLowerCase();
  if (!t) return dflt;
  if (['1', 'true', 'yes', 'y', 'enabled', 'checked', 'checked-in', 'x'].includes(t)) return true;
  if (['0', 'false', 'no', 'n', 'disabled', 'unchecked'].includes(t)) return false;
  return null;
};

const memberSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(80),
  institution: z.string().trim().max(120).default(''),
  year: z.string().trim().max(20).default(''),
  branch: z.string().trim().max(80).default(''),
  studentId: z.string().trim().max(40).optional(),
});
export const teamInputSchema = z.object({
  teamName: z.string().trim().min(2, 'Team name is required.').max(40).regex(/^[\p{L}\p{N} ._&'-]+$/u, 'Team name may use letters, numbers, spaces and . _ & \' -'),
  crewId: z.string().trim().regex(/^CRW-\d{3,}$/i, 'Crew ID looks like CRW-001.').optional(),
  captainEmail: z.string().trim().max(254).email('Invalid captain email.'),
  members: z.array(memberSchema).min(3, 'A crew needs 3 or 4 members (captain included).').max(4, 'A crew needs 3 or 4 members (captain included).'),
  slot: z.number().int().min(1).max(99).nullable(),
  accountEnabled: z.boolean(),
  /** Attendance. Undefined (blank cell) keeps the current value of an existing crew. */
  checkedIn: z.boolean().optional(),
  color: z.string().optional(),
});
export type TeamInput = z.infer<typeof teamInputSchema>;

interface PlannedRow {
  row: number;
  action: 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'ERROR';
  input?: TeamInput;
  teamId?: string;
  crewId?: string;
  changes?: string[];
  errors: string[];
}

function rowToInput(cells: string[], m: Record<TeamColumn, number>): { input?: TeamInput; errors: string[] } {
  const get = (c: TeamColumn) => (m[c] === undefined ? '' : (cells[m[c]] ?? '').trim());
  const members = [1, 2, 3, 4]
    .map((k) => ({
      name: get(`member${k}_name` as TeamColumn), institution: get(`member${k}_institution` as TeamColumn), year: get(`member${k}_year` as TeamColumn),
      branch: get(`member${k}_branch` as TeamColumn), studentId: get(`member${k}_student_id` as TeamColumn) || undefined,
    }))
    .filter((x) => x.name);
  const slotRaw = get('slot');
  const slotNum = slotRaw ? Number(slotRaw.replace(/[^0-9]/g, '')) : null;
  const enabled = boolish(get('account_enabled'), true);
  const checkedRaw = get('checked_in');
  const checked = checkedRaw ? boolish(checkedRaw, false) : undefined;
  const errors: string[] = [];
  if (enabled === null) errors.push('account_enabled must be true/false.');
  if (checked === null) errors.push('checked_in must be true/false.');
  if (slotRaw && (!slotNum || Number.isNaN(slotNum))) errors.push(`Unknown slot "${slotRaw}".`);
  const parsed = teamInputSchema.safeParse({
    teamName: get('team_name'), crewId: get('crew_id') || undefined, captainEmail: get('captain_email'), members,
    slot: slotNum, accountEnabled: enabled ?? true, checkedIn: checked ?? undefined,
  });
  if (!parsed.success) errors.push(...Object.entries(zodFieldErrors(parsed.error)).map(([k, v]) => `${k}: ${v}`));
  return errors.length ? { errors } : { input: parsed.data!, errors };
}

async function planRows(q: Queryable, rows: { row: number; cells: string[] }[], m: Record<TeamColumn, number>, eventId: string) {
  const slots = await listSlots(q, eventId);
  const existing = await many<{ id: string; crew_id: string; name: string; email: string; name_normalized: string; email_normalized: string; account_enabled: boolean; checked_in_at: Date | null; slot_number: number | null; scored: boolean; members: { name: string; institution: string; year: string; branch: string; student_id: string | null }[] }>(
    q,
    `SELECT t.id, t.crew_id, t.name, t.email, t.name_normalized, t.email_normalized, t.account_enabled, t.checked_in_at, s.number AS slot_number,
            EXISTS (SELECT 1 FROM coin_ledger l WHERE l.enrollment_id=se.id) AS scored,
            COALESCE((SELECT json_agg(json_build_object('name', m.name, 'institution', m.institution, 'year', m.year, 'branch', m.branch, 'student_id', m.student_id) ORDER BY m.position) FROM team_member m WHERE m.team_id=t.id), '[]') AS members
       FROM team t LEFT JOIN slot_enrollment se ON se.team_id=t.id LEFT JOIN slot s ON s.id=se.slot_id WHERE t.event_id=$1`,
    [eventId],
  );
  const byCrew = new Map(existing.map((e) => [e.crew_id, e]));
  const byEmail = new Map(existing.map((e) => [e.email_normalized, e]));
  const byName = new Map(existing.map((e) => [e.name_normalized, e]));
  const seenEmail = new Map<string, number>();
  const seenName = new Map<string, number>();
  const seenCrew = new Map<string, number>();
  const planned: PlannedRow[] = [];
  for (const r of rows) {
    const { input, errors } = rowToInput(r.cells, m);
    const p: PlannedRow = { row: r.row, action: 'ERROR', errors: [...errors], input };
    if (input) {
      const em = normalizeEmail(input.captainEmail);
      const nm = normalizeTeamName(input.teamName);
      const cid = input.crewId?.toUpperCase();
      if (seenEmail.has(em)) p.errors.push(`Duplicate captain email (also row ${seenEmail.get(em)}).`);
      if (seenName.has(nm)) p.errors.push(`Duplicate team name (also row ${seenName.get(nm)}).`);
      if (cid && seenCrew.has(cid)) p.errors.push(`Duplicate crew ID (also row ${seenCrew.get(cid)}).`);
      seenEmail.set(em, r.row);
      seenName.set(nm, r.row);
      if (cid) seenCrew.set(cid, r.row);
      if (input.slot && !slots.find((s) => s.number === input.slot)) p.errors.push(`Slot ${input.slot} does not exist.`);
      // Identity: crew ID first, then captain email.
      const match = (cid && byCrew.get(cid)) || byEmail.get(em);
      if (cid && !byCrew.get(cid) && byEmail.get(em)) p.errors.push(`Email belongs to ${byEmail.get(em)!.crew_id}, not ${cid}.`);
      if (match) {
        p.teamId = match.id;
        p.crewId = match.crew_id;
        const other = byName.get(nm);
        if (other && other.id !== match.id) p.errors.push(`Team name already used by ${other.crew_id}.`);
        const otherEmail = byEmail.get(em);
        if (otherEmail && otherEmail.id !== match.id) p.errors.push(`Captain email already used by ${otherEmail.crew_id}.`);
        const changes: string[] = [];
        if (match.name !== input.teamName.trim().replace(/\s+/g, ' ')) changes.push('team name');
        if (match.email_normalized !== em) changes.push('captain email');
        const roster = input.members.map((x) => [x.name, x.institution, x.year, x.branch, x.studentId ?? ''].join('|')).join(';');
        const oldRoster = match.members.map((x) => [x.name, x.institution, x.year, x.branch, x.student_id ?? ''].join('|')).join(';');
        if (roster !== oldRoster) changes.push('roster');
        if (match.account_enabled !== input.accountEnabled) changes.push(input.accountEnabled ? 'enable account' : 'DISABLE account');
        if (input.checkedIn !== undefined && !!match.checked_in_at !== input.checkedIn) changes.push(input.checkedIn ? 'mark present' : 'CLEAR attendance (signs the crew out)');
        if (input.slot !== null && input.slot !== match.slot_number) {
          if (match.scored) p.errors.push(`Slot change blocked: ${match.crew_id} has already scored in slot ${match.slot_number}. Handle as an audited correction, not a re-import.`);
          else changes.push(`slot ${match.slot_number ?? 'unassigned'} → ${input.slot}`);
        }
        p.changes = changes;
        p.action = p.errors.length ? 'ERROR' : changes.length ? 'UPDATE' : 'UNCHANGED';
      } else {
        if (byName.get(nm)) p.errors.push(`Team name already used by ${byName.get(nm)!.crew_id}.`);
        if (cid && byCrew.get(cid)) p.errors.push(`Crew ID ${cid} already exists.`);
        p.crewId = cid;
        p.action = p.errors.length ? 'ERROR' : 'CREATE';
      }
    }
    planned.push(p);
  }
  // Capacity per slot after this import
  const load = new Map<number, number>();
  for (const e of existing) if (e.slot_number) load.set(e.slot_number, (load.get(e.slot_number) ?? 0) + 1);
  for (const p of planned) {
    if (p.action === 'ERROR' || !p.input?.slot) continue;
    const prev = p.teamId ? existing.find((e) => e.id === p.teamId)?.slot_number : null;
    if (prev !== p.input.slot) {
      load.set(p.input.slot, (load.get(p.input.slot) ?? 0) + 1);
      if (prev) load.set(prev, (load.get(prev) ?? 1) - 1);
    }
  }
  const capacity = slots.map((s) => ({ slot: s.number, name: s.name, capacity: s.capacity, after: load.get(s.number) ?? 0 }));
  return { planned, capacity };
}

/** Parses and validates an upload. Writes only an import_batch row (no team data is touched). */
export async function previewTeamImport(db: Db, actor: Actor, args: { fileName: string; contentBase64: string; mapping?: Partial<Record<TeamColumn, string>> }) {
  const ev = await getEvent(db);
  const table = await readUpload(args.fileName, args.contentBase64);
  if (table.length < 2) throw new AppError('IMPORT_INVALID', 'The file needs a header row and at least one team.');
  const header = table[0];
  const m = autoMapping(header);
  for (const [col, h] of Object.entries(args.mapping ?? {})) {
    const idx = header.findIndex((x) => x.trim() === h);
    if (idx < 0) throw new AppError('IMPORT_INVALID', `Mapped column "${h}" is not in the file.`);
    m[col as TeamColumn] = idx;
  }
  const missing = (['team_name', 'captain_email', 'member1_name'] as TeamColumn[]).filter((c) => m[c] === undefined);
  const rows = table.slice(1).map((cells, i) => ({ row: i + 2, cells }));
  const { planned, capacity } = missing.length ? { planned: [] as PlannedRow[], capacity: [] } : await planRows(db, rows, m, ev.id);
  const summary = {
    rows: rows.length,
    create: planned.filter((p) => p.action === 'CREATE').length,
    update: planned.filter((p) => p.action === 'UPDATE').length,
    unchanged: planned.filter((p) => p.action === 'UNCHANGED').length,
    errors: planned.filter((p) => p.action === 'ERROR').length,
    unassigned: planned.filter((p) => p.action !== 'ERROR' && !p.input?.slot).length,
    missingColumns: missing,
    columnIndex: m,
    capacity,
    overCapacity: capacity.filter((c) => c.after > c.capacity).map((c) => c.name),
  };
  const mappingOut = Object.fromEntries(Object.entries(m).map(([k, i]) => [k, header[i]]));
  const batch = (await one<{ id: string }>(
    db,
    `INSERT INTO import_batch(event_id, kind, file_name, mapping, rows, errors, summary, created_by) VALUES ($1,'TEAMS',$2,$3,$4,$5,$6,$7) RETURNING id`,
    [ev.id, args.fileName.slice(0, 200), JSON.stringify(mappingOut), JSON.stringify(rows), JSON.stringify(planned.filter((p) => p.errors.length).map((p) => ({ row: p.row, errors: p.errors }))), JSON.stringify(summary), actor.id],
  ))!;
  return {
    batchId: batch.id,
    header,
    mapping: mappingOut,
    summary,
    rows: planned.map((p) => ({ row: p.row, action: p.action, crewId: p.crewId ?? null, teamName: p.input?.teamName ?? null, captainEmail: p.input?.captainEmail ?? null, members: p.input?.members.length ?? 0, slot: p.input?.slot ?? null, accountEnabled: p.input?.accountEnabled ?? null, changes: p.changes ?? [], errors: p.errors })),
  };
}

async function nextCrewId(tx: Tx) {
  const r = await one<{ n: number }>(tx, `SELECT nextval('crew_number_seq')::int AS n`);
  return `CRW-${String(r!.n).padStart(3, '0')}`;
}

async function assignSlot(tx: Tx, actor: Actor, teamId: string, slotNumber: number | null, startingWallet: number) {
  const ev = await getEvent(tx);
  const cur = await one<{ id: string; slot_id: string; scored: boolean }>(tx, `SELECT se.id, se.slot_id, EXISTS (SELECT 1 FROM coin_ledger l WHERE l.enrollment_id=se.id) AS scored FROM slot_enrollment se WHERE se.team_id=$1 FOR UPDATE`, [teamId]);
  if (slotNumber === null) {
    if (cur) {
      if (cur.scored) throw new AppError('SLOT_CHANGE_BLOCKED', 'This crew has already scored; it cannot be unassigned.');
      await tx.query('DELETE FROM slot_enrollment WHERE id=$1', [cur.id]);
    }
    return;
  }
  const slot = await one<{ id: string; phase: string }>(tx, 'SELECT id, phase FROM slot WHERE event_id=$1 AND number=$2', [ev.id, slotNumber]);
  if (!slot) throw new AppError('VALIDATION_FAILED', `Slot ${slotNumber} does not exist.`);
  if (cur?.slot_id === slot.id) return;
  if (cur) {
    if (cur.scored) throw new AppError('SLOT_CHANGE_BLOCKED', 'This crew has already scored in its slot. Slot changes after scoring must be an audited, paused-event correction (scores are never transferred between opponents).');
    await tx.query('UPDATE slot_enrollment SET slot_id=$2, version=version+1 WHERE id=$1', [cur.id, slot.id]);
  } else {
    const enr = await one<import('./context.js').EnrollmentRow>(tx, 'INSERT INTO slot_enrollment(slot_id, team_id) VALUES ($1,$2) RETURNING *', [slot.id, teamId]);
    if (startingWallet > 0) await applyLedger(tx, enr!, { kind: 'GRANT', sprintId: null, wallet: startingWallet, grant: startingWallet, sourceType: 'starting-grant', sourceId: enr!.id, reason: 'Starting wallet', actorId: actor.id });
  }
  await emit(tx, 'eligibility.changed', [Rooms.team(teamId), Rooms.organizers], { teamId, slot: slotNumber });
}

/** Unmarking attendance signs the crew out when attendance gates login. */
async function attendanceRemoved(tx: Tx, teamId: string) {
  const ev = await getEvent(tx);
  if (ev.rules.attendanceGatesLogin) await revokeAllTeamSessions(tx, teamId, 'ATTENDANCE_UNMARKED');
}

/** Bulk attendance (the roll call). Marking a crew present enables its login; unmarking signs it out. */
export async function setAttendance(db: Db, actor: Actor, teamIds: string[], present: boolean) {
  if (!teamIds.length || teamIds.length > 500) throw new AppError('VALIDATION_FAILED', 'Select 1-500 crews.');
  return withTx(db, async (tx) => {
    const rows = await many<{ id: string; crew_id: string; checked_in_at: Date | null }>(tx, 'SELECT id, crew_id, checked_in_at FROM team WHERE id = ANY($1) ORDER BY crew_id FOR UPDATE', [teamIds]);
    const changed = rows.filter((r) => !!r.checked_in_at !== present);
    for (const r of changed) {
      await tx.query(`UPDATE team SET checked_in_at=${present ? 'now()' : 'NULL'}, version=version+1, updated_at=now() WHERE id=$1`, [r.id]);
      if (!present) await attendanceRemoved(tx, r.id);
      await emit(tx, 'eligibility.changed', [Rooms.team(r.id)], { teamId: r.id, present });
    }
    if (changed.length) {
      await audit(tx, actor, present ? 'teams.marked_present' : 'teams.marked_absent', { type: 'team', id: null }, { crewIds: changed.map((r) => r.crew_id) });
      await emit(tx, 'teams.changed', [Rooms.organizers], { change: 'ATTENDANCE' });
    }
    return { present, changed: changed.map((r) => r.crew_id), unchanged: rows.length - changed.length };
  });
}

async function writeTeam(tx: Tx, actor: Actor, input: TeamInput, teamId: string | undefined, via: 'IMPORT' | 'ADMIN' | 'SEED') {
  const ev = await getEvent(tx);
  const name = input.teamName.trim().replace(/\s+/g, ' ');
  let id = teamId;
  let crewId: string;
  const onUnique = (err: { code?: string; constraint?: string }) => {
    if (err.code === '23505') {
      if (err.constraint?.includes('email')) throw new AppError('DUPLICATE_EMAIL', 'Captain email already used by another crew.');
      if (err.constraint?.includes('name')) throw new AppError('DUPLICATE_TEAM_NAME', 'Team name already used.');
      if (err.constraint?.includes('crew_id')) throw new AppError('CONFLICT', 'Crew ID already exists.');
    }
    throw err;
  };
  if (!id) {
    crewId = input.crewId?.toUpperCase() ?? (await nextCrewId(tx));
    const color = input.color ?? CREW_COLORS[randomInt(CREW_COLORS.length)][1];
    id = (await one<{ id: string }>(
      tx,
      `INSERT INTO team(event_id, crew_id, name, name_normalized, email, email_normalized, captain_name, color, account_enabled, checked_in_at, created_via)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [ev.id, crewId, name, normalizeTeamName(name), input.captainEmail.trim(), normalizeEmail(input.captainEmail), input.members[0].name, color, input.accountEnabled, input.checkedIn ? new Date() : null, via],
    ).catch(onUnique))!.id;
  } else {
    const before = (await one<{ crew_id: string; account_enabled: boolean; checked_in_at: Date | null }>(tx, 'SELECT crew_id, account_enabled, checked_in_at FROM team WHERE id=$1 FOR UPDATE', [id]))!;
    crewId = before.crew_id;
    await tx.query(
      `UPDATE team SET name=$2, name_normalized=$3, email=$4, email_normalized=$5, captain_name=$6, account_enabled=$7,
              checked_in_at=CASE WHEN $8::boolean IS NULL THEN checked_in_at WHEN $8 THEN COALESCE(checked_in_at, now()) ELSE NULL END, version=version+1, updated_at=now() WHERE id=$1`,
      [id, name, normalizeTeamName(name), input.captainEmail.trim(), normalizeEmail(input.captainEmail), input.members[0].name, input.accountEnabled, input.checkedIn ?? null],
    ).catch(onUnique);
    if (before.account_enabled && !input.accountEnabled) await revokeAllTeamSessions(tx, id, 'ACCOUNT_DISABLED');
    if (before.checked_in_at && input.checkedIn === false) await attendanceRemoved(tx, id);
    if (!!before.checked_in_at !== !!input.checkedIn && input.checkedIn !== undefined) await emit(tx, 'eligibility.changed', [Rooms.team(id), Rooms.organizers], { teamId: id, present: input.checkedIn });
  }
  await tx.query('DELETE FROM team_member WHERE team_id=$1', [id]);
  for (let i = 0; i < input.members.length; i++) {
    const m = input.members[i];
    await tx.query(`INSERT INTO team_member(team_id, position, name, institution, year, branch, student_id, is_captain) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, i + 1, m.name, m.institution, m.year, m.branch, m.studentId || null, i === 0]);
  }
  if (input.slot !== null) await assignSlot(tx, actor, id, input.slot, ev.rules.startingWallet);
  return { id, crewId };
}

/** Commits a previewed batch. Idempotent: committing twice returns the first result. Re-validates against current data. */
export async function commitTeamImport(db: Db, actor: Actor, batchId: string) {
  return withTx(db, async (tx) => {
    const b = await one<{ id: string; status: string; rows: { row: number; cells: string[] }[]; mapping: Record<string, string>; result: unknown; event_id: string }>(tx, 'SELECT * FROM import_batch WHERE id=$1 AND kind=$2 FOR UPDATE', [batchId, 'TEAMS']);
    if (!b) throw new AppError('NOT_FOUND', 'Import preview not found.');
    if (b.status === 'COMMITTED') return { ...(b.result as object), alreadyCommitted: true };
    if (b.status !== 'PREVIEWED') throw new AppError('INVALID_TRANSITION', 'This preview was discarded.');
    await tx.query('SELECT pg_advisory_xact_lock(727020)');
    // Column indexes resolved at preview time (auto-mapping + explicit mapping).
    const m = ((await one<{ summary: { columnIndex?: Record<TeamColumn, number> } }>(tx, 'SELECT summary FROM import_batch WHERE id=$1', [batchId]))!.summary.columnIndex ?? {}) as Record<TeamColumn, number>;
    const { planned, capacity } = await planRows(tx, b.rows, m, b.event_id);
    const bad = planned.filter((p) => p.action === 'ERROR');
    if (bad.length) throw new AppError('IMPORT_INVALID', `${bad.length} row(s) have errors. Fix the file and preview again.`, { errors: bad.map((p) => ({ row: p.row, errors: p.errors })) });
    const over = capacity.filter((c) => c.after > c.capacity);
    if (over.length) throw new AppError('IMPORT_INVALID', `Over capacity: ${over.map((c) => `${c.name} ${c.after}/${c.capacity}`).join(', ')}. Raise the slot capacity or change assignments.`, { overCapacity: over });
    const created: string[] = [];
    const updated: string[] = [];
    for (const p of planned) {
      if (p.action === 'CREATE') created.push((await writeTeam(tx, actor, p.input!, undefined, 'IMPORT')).crewId);
      else if (p.action === 'UPDATE') updated.push((await writeTeam(tx, actor, p.input!, p.teamId, 'IMPORT')).crewId);
    }
    const result = { created: created.length, updated: updated.length, unchanged: planned.filter((p) => p.action === 'UNCHANGED').length, createdCrewIds: created, updatedCrewIds: updated };
    await tx.query(`UPDATE import_batch SET status='COMMITTED', committed_at=now(), result=$2 WHERE id=$1`, [batchId, JSON.stringify(result)]);
    await audit(tx, actor, 'teams.import_committed', { type: 'import_batch', id: batchId }, result);
    await emit(tx, 'teams.changed', [Rooms.organizers], { change: 'IMPORT', ...result });
    return result;
  });
}

export async function createTeam(db: Db, actor: Actor, raw: unknown) {
  const input = teamInputSchema.parse(raw);
  return withTx(db, async (tx) => {
    const t = await writeTeam(tx, actor, input, undefined, 'ADMIN');
    await audit(tx, actor, 'team.created', { type: 'team', id: t.id }, { crewId: t.crewId });
    await emit(tx, 'teams.changed', [Rooms.organizers], { teamId: t.id });
    return t;
  });
}

export const teamPatchSchema = z.object({
  teamName: z.string().optional(),
  captainEmail: z.string().optional(),
  members: z.array(memberSchema).min(3).max(4).optional(),
  accountEnabled: z.boolean().optional(),
  checkedIn: z.boolean().optional(),
  slot: z.number().int().min(1).max(8).nullable().optional(),
  color: z.string().optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});

export async function updateTeam(db: Db, actor: Actor, teamId: string, raw: unknown) {
  const patch = teamPatchSchema.parse(raw);
  return withTx(db, async (tx) => {
    const t = await one<{ id: string; crew_id: string; name: string; email: string; account_enabled: boolean; checked_in_at: Date | null; color: string; status: string }>(tx, 'SELECT * FROM team WHERE id=$1 FOR UPDATE', [teamId]);
    if (!t) throw new AppError('NOT_FOUND', 'Crew not found.');
    const ev = await getEvent(tx);
    if (patch.teamName !== undefined || patch.captainEmail !== undefined || patch.members !== undefined || patch.accountEnabled !== undefined || patch.checkedIn !== undefined) {
      const members = patch.members ?? (await many<{ name: string; institution: string; year: string; branch: string; student_id: string | null }>(tx, 'SELECT name, institution, year, branch, student_id FROM team_member WHERE team_id=$1 ORDER BY position', [teamId])).map((m) => ({ ...m, studentId: m.student_id ?? undefined }));
      const input = teamInputSchema.parse({
        teamName: patch.teamName ?? t.name, captainEmail: patch.captainEmail ?? t.email, members,
        slot: null, accountEnabled: patch.accountEnabled ?? t.account_enabled, checkedIn: patch.checkedIn ?? !!t.checked_in_at,
      });
      await writeTeam(tx, actor, input, teamId, 'ADMIN');
      if (patch.accountEnabled !== undefined && patch.accountEnabled !== t.account_enabled) {
        await emit(tx, 'eligibility.changed', [Rooms.team(teamId), Rooms.organizers], { teamId, accountEnabled: patch.accountEnabled });
        const enr = await one<{ slot_id: string }>(tx, 'SELECT slot_id FROM slot_enrollment WHERE team_id=$1', [teamId]);
        if (enr) await emit(tx, 'leaderboard.updated', [Rooms.slot(enr.slot_id), Rooms.organizers, Rooms.display], { slotId: enr.slot_id });
      }
    }
    if (patch.slot !== undefined) await assignSlot(tx, actor, teamId, patch.slot, ev.rules.startingWallet);
    if (patch.color) await tx.query('UPDATE team SET color=$2, updated_at=now() WHERE id=$1', [teamId, patch.color]);
    if (patch.status) {
      await tx.query('UPDATE team SET status=$2, updated_at=now() WHERE id=$1', [teamId, patch.status]);
      if (patch.status === 'ARCHIVED') await revokeAllTeamSessions(tx, teamId, 'ARCHIVED');
    }
    await audit(tx, actor, 'team.updated', { type: 'team', id: teamId }, { crewId: t.crew_id, ...patch, members: patch.members ? `${patch.members.length} members` : undefined });
    await emit(tx, 'teams.changed', [Rooms.organizers], { teamId });
    return { ok: true };
  });
}

/** Bulk slot assignment with a capacity preview. */
export async function bulkAssign(db: Db, actor: Actor, args: { teamIds: string[]; slot: number | null; apply: boolean }) {
  if (!args.teamIds.length || args.teamIds.length > 500) throw new AppError('VALIDATION_FAILED', 'Select 1-500 crews.');
  return withTx(db, async (tx) => {
    const ev = await getEvent(tx);
    const slots = await listSlots(tx, ev.id);
    const target = args.slot === null ? null : slots.find((s) => s.number === args.slot);
    if (args.slot !== null && !target) throw new AppError('VALIDATION_FAILED', 'Unknown slot.');
    const teams = await many<{ id: string; crew_id: string; slot_number: number | null; scored: boolean }>(
      tx,
      `SELECT t.id, t.crew_id, s.number AS slot_number, EXISTS (SELECT 1 FROM coin_ledger l WHERE l.enrollment_id=se.id) AS scored
         FROM team t LEFT JOIN slot_enrollment se ON se.team_id=t.id LEFT JOIN slot s ON s.id=se.slot_id WHERE t.id = ANY($1)`,
      [args.teamIds],
    );
    const blocked = teams.filter((t) => t.scored && t.slot_number !== args.slot).map((t) => t.crew_id);
    const moving = teams.filter((t) => !t.scored && t.slot_number !== args.slot);
    const current = target ? (await one<{ n: number }>(tx, 'SELECT count(*)::int AS n FROM slot_enrollment WHERE slot_id=$1', [target.id]))!.n : 0;
    const preview = { slot: args.slot, moving: moving.map((t) => t.crew_id), blocked, capacity: target?.capacity ?? null, after: target ? current + moving.length : null };
    if (!args.apply) return { applied: false, preview };
    if (target && current + moving.length > target.capacity) throw new AppError('CONFLICT', `${target.name} would exceed its capacity (${current + moving.length}/${target.capacity}).`);
    for (const t of moving) await assignSlot(tx, actor, t.id, args.slot, ev.rules.startingWallet);
    await audit(tx, actor, 'teams.bulk_assigned', { type: 'slot', id: target?.id ?? null }, preview);
    await emit(tx, 'teams.changed', [Rooms.organizers], { change: 'ASSIGN' });
    return { applied: true, preview };
  });
}

// ---------------------------------------------------------------------------
// Credentials: preview → explicit send. Never automatic on import.
// ---------------------------------------------------------------------------

function tempPassword() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const pick = (n: number) => Array.from({ length: n }, () => A[randomInt(A.length)]).join('');
  return `${pick(5)}-${pick(5)}-${randomInt(10, 100)}`;
}

async function credentialTargets(q: Queryable, teamIds: string[]) {
  return many<{ id: string; crew_id: string; name: string; email: string; account_enabled: boolean; credential_status: string; slot_label: string | null }>(
    q,
    `SELECT t.id, t.crew_id, t.name, t.email, t.account_enabled, t.credential_status,
            CASE WHEN s.id IS NULL THEN NULL ELSE s.name || ' · ' || to_char(d.date, 'DD Mon YYYY') END AS slot_label
       FROM team t LEFT JOIN slot_enrollment se ON se.team_id=t.id LEFT JOIN slot s ON s.id=se.slot_id LEFT JOIN event_day d ON d.id=s.day_id
      WHERE t.id = ANY($1) ORDER BY t.crew_id`,
    [teamIds],
  );
}

export async function previewCredentials(db: Db, cfg: AppConfig, teamIds: string[], reason: 'INITIAL' | 'RESET') {
  if (!teamIds.length || teamIds.length > 500) throw new AppError('VALIDATION_FAILED', 'Select 1-500 crews.');
  const ev = await getEvent(db);
  let channel: string;
  let channelNote: string;
  try {
    channel = mailChannel(cfg);
    channelNote = channel === 'CAPTURE' ? 'Demo mail, not delivered externally: messages are captured locally for organizers.' : cfg.mail.sink ? 'Demo SMTP sink (e.g. Mailpit): messages are caught locally and NOT delivered externally.' : `Delivered through SMTP from ${cfg.mail.from}.`;
  } catch (e) {
    channel = 'NONE';
    channelNote = (e as Error).message;
  }
  const targets = await credentialTargets(db, teamIds);
  const sample = targets[0] ? credentialMail({ eventName: ev.name, teamName: targets[0].name, crewId: targets[0].crew_id, email: targets[0].email, password: '•••••••• (generated on send)', slotLabel: targets[0].slot_label ?? 'Not yet assigned', loginUrl: cfg.publicUrl, reset: reason === 'RESET' }) : null;
  return {
    channel,
    channelNote,
    recipients: targets.map((t) => ({
      teamId: t.id, crewId: t.crew_id, name: t.name, email: t.email, slot: t.slot_label,
      warnings: [
        ...(!t.account_enabled ? ['account disabled'] : []),
        ...(!t.slot_label ? ['no slot assigned'] : []),
        ...(reason === 'INITIAL' && t.credential_status !== 'NONE' ? ['already has credentials — sending replaces them'] : []),
      ],
    })),
    sample,
  };
}

/** Explicit, organizer-triggered delivery. Creates new temporary passwords server-side and revokes old sessions. */
export async function sendCredentials(db: Db, cfg: AppConfig, actor: Actor, teamIds: string[], reason: 'INITIAL' | 'RESET') {
  const channel = mailChannel(cfg);
  const ev = await getEvent(db);
  const targets = await credentialTargets(db, teamIds);
  const results: { crewId: string; email: string; status: string; error?: string }[] = [];
  for (const t of targets) {
    const pw = tempPassword();
    const hash = await hashPassword(pw);
    const mail = credentialMail({ eventName: ev.name, teamName: t.name, crewId: t.crew_id, email: t.email, password: pw, slotLabel: t.slot_label ?? 'Not yet assigned', loginUrl: cfg.publicUrl, reset: reason === 'RESET' });
    let status: 'CAPTURED' | 'SENT' | 'FAILED' = 'CAPTURED';
    let error: string | undefined;
    if (channel === 'SMTP') {
      try {
        await sendSmtp(cfg, t.email, mail.subject, mail.body);
        status = 'SENT';
      } catch (e) {
        status = 'FAILED';
        error = (e as Error).message.slice(0, 300);
      }
    }
    await withTx(db, async (tx) => {
      // Only store the new credential if it reached the crew (or the local capture).
      if (status !== 'FAILED') {
        await tx.query(`UPDATE team SET password_hash=$2, credential_status=$3, must_change_password=true, version=version+1, updated_at=now() WHERE id=$1`, [t.id, hash, status === 'SENT' && !cfg.mail.sink ? 'DELIVERED' : 'ISSUED']);
        await revokeAllTeamSessions(tx, t.id, reason === 'RESET' ? 'CREDENTIAL_RESET' : 'CREDENTIAL_ISSUED');
      }
      const d = (await one<{ id: string }>(
        tx,
        `INSERT INTO credential_delivery(team_id, channel, recipient, subject, status, error, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [t.id, channel, t.email, mail.subject, status, error ?? null, reason, actor.id],
      ))!;
      if (status === 'CAPTURED') await tx.query('INSERT INTO mail_capture(delivery_id, recipient, subject, body) VALUES ($1,$2,$3,$4)', [d.id, t.email, mail.subject, mail.body]);
      await audit(tx, actor, 'credentials.delivered', { type: 'team', id: t.id }, { crewId: t.crew_id, channel, status, reason });
    });
    results.push({ crewId: t.crew_id, email: t.email, status, error });
  }
  // A sink accepts mail without delivering it: never report that as external delivery.
  return { channel, demoCapture: channel === 'CAPTURE' || cfg.mail.sink, deliveredExternally: channel === 'SMTP' && !cfg.mail.sink, results };
}
