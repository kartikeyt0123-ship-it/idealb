/**
 * Reproducible DEMO fixture — demo content only. Everything here (crews,
 * questions, rules) is labelled demo and must be reviewed before a real event;
 * every rule starts UNCONFIRMED.
 *
 *  - organizer admin@crm.local / idealab (hashed; demo bootstrap only, never a
 *    hardcoded comparison, never returned to a browser)
 *  - 40 crews CRW-001…CRW-040, 10 per slot. Nexora = CRW-001, Slot 1.
 *  - 4 slots on 8 and 9 October 2026 (Asia/Kolkata), 4 sprints each
 *  - question bank generated from deterministic seedable templates, PUBLISHED
 *    as demo content, then each slot plan is built from the blueprint:
 *    960 initial instances (60 × 4 sprints × 4 slots) + 120 extras
 *    (20 reserves + 10 bonuses per slot).
 *
 * Idempotent: re-running never duplicates accounts, never overwrites a changed
 * password and never touches existing competition state.
 */
import type { AppConfig } from '../config.js';
import { imposterTemplates, regularTemplates } from '../content/index.js';
import type { TaskTemplate } from '../content/types.js';
import { one, withTx, type Db, type Tx } from '../db.js';
import { hashPassword } from '../security/crypto.js';
import { SYSTEM } from '../services/audit.js';
import { createQuestion } from '../services/content.js';
import type { EnrollmentRow } from '../services/context.js';
import { buildSlotPlan } from '../services/releases.js';
import { DEFAULT_RULES } from '../services/rules.js';
import { CREW_COLORS } from '../services/teams.js';
import { applyLedger } from '../services/wallet.js';
import { ensureEventStructure } from './structure.js';

export const DEMO_ORGANIZER = { email: 'admin@crm.local', password: 'idealab', displayName: 'IDEALab Organizer', role: 'SUPER_ADMIN' as const };
export const DEMO_DAYS: [string, string] = ['2026-10-08', '2026-10-09'];
export const NEXORA = { crewId: 'CRW-001', name: 'Nexora', email: 'nexora@example.test', password: 'CrewDemo123!', slot: 1 };

const NAMES = [
  'Nexora', 'Byteforce', 'Codex', 'Debuggers', 'Null Pointers', 'Stack Smash', 'Segfault', 'Bitshift', 'Kernel Panic', 'Lambda Legion',
  'Heapsters', 'Syntax Squad', 'Quantum Quills', 'Loop Troop', 'Recursia', 'Void Walkers', 'Pixel Pirates', 'Cache Crew', 'Async Armada', 'Glitch Guild',
  'Binary Bandits', 'Hex Hunters', 'Patch Pilots', 'Merge Masters', 'Root Access', 'Packet Pals', 'Thread Tribe', 'Index Rangers', 'Sudo Sailors', 'Cipher Circle',
  'Tensor Troupe', 'Kotlin Kites', 'Rust Raiders', 'Query Queens', 'Logic Lords', 'Daemon Drift', 'Fork Force', 'Token Titans', 'Vector Vikings', 'Orbit Ops',
];
const FIRST = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Ishita', 'Vihaan', 'Ananya', 'Arjun', 'Saanvi', 'Reyansh', 'Myra', 'Aditya', 'Kiara', 'Vivaan', 'Tara'];
const LAST = ['Sharma', 'Verma', 'Patel', 'Joshi', 'Rao', 'Iyer', 'Mehta', 'Nair', 'Kulkarni', 'Gupta', 'Desai', 'Bose'];
const BRANCHES = ['CSE', 'IT', 'ECE', 'EE', 'ME', 'CSE (AI/ML)'];
const YEARS = ['1st year', '2nd year', '3rd year', '4th year'];

/** Demo-only passwords for the other 39 crews (documented in docs/DEMO_ACCESS.md, never sent to a browser). */
export function demoCrewPassword(n: number) {
  return n === 1 ? NEXORA.password : `Crew-${String(n).padStart(3, '0')}-Demo!`;
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * How many seeds of each template become published demo questions. Totals per
 * domain: 100 easy, 64 medium, 44 hard (initial need 80/48/32 + reserves);
 * 48 bonus questions (need 40).
 */
const SEEDS_PER = { EASY: 50, MEDIUM: 32, HARD: 44, BONUS: 12 };

async function seedBank(tx: Tx, cfg: AppConfig, log: (m: string) => void) {
  const have = await one<{ n: number }>(tx, 'SELECT count(*)::int AS n FROM question');
  if (have!.n > 0) return;
  let n = 0;
  const add = async (t: TaskTemplate, pool: 'REGULAR' | 'BONUS', seeds: number) => {
    for (let s = 0; s < seeds; s++) {
      await createQuestion(tx, cfg, {
        key: `${t.key}-s${String(s).padStart(3, '0')}`, domainSlug: t.domain, pool, isDemo: true, status: 'PUBLISHED',
        version: { variant: t.variant(s), difficulty: pool === 'BONUS' ? 'HARD' : t.difficulty, sourceTemplate: t.key, sourceSeed: s }, actorId: null,
      });
      n++;
    }
  };
  for (const t of regularTemplates) await add(t, 'REGULAR', SEEDS_PER[t.difficulty]);
  for (const t of imposterTemplates) await add(t, 'BONUS', SEEDS_PER.BONUS);
  log(`[seed] question bank: ${n} demo questions generated from ${regularTemplates.length + imposterTemplates.length} seedable templates (PUBLISHED, demo-labelled)`);
}

function members(i: number) {
  const count = i % 3 === 0 ? 3 : 4;
  return Array.from({ length: count }, (_, j) => ({
    name: `${FIRST[(i * 3 + j * 5) % FIRST.length]} ${LAST[(i * 7 + j * 3) % LAST.length]}`,
    institution: 'SGSITS Indore (demo)',
    year: YEARS[(i + j) % YEARS.length],
    branch: BRANCHES[(i * 2 + j) % BRANCHES.length],
    studentId: j === 0 ? `DEMO-${String(i + 1).padStart(3, '0')}` : null,
  }));
}

export async function seedDemo(db: Db, cfg: AppConfig, log: (m: string) => void = console.log) {
  // scrypt is deliberately slow: hash outside the transaction.
  const orgHash = await hashPassword(DEMO_ORGANIZER.password);
  const crewHashes = await Promise.all(NAMES.map((_, i) => hashPassword(demoCrewPassword(i + 1))));
  await withTx(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(727002)');
    const { created, eventId } = await ensureEventStructure(tx, { name: 'AMONG BUG', isDemo: true, days: DEMO_DAYS, rules: DEFAULT_RULES });
    log(created ? '[seed] event AMONG BUG (demo): 2 days, 4 slots × 4 sprints, prizes — every rule UNCONFIRMED' : '[seed] event exists — structure and history untouched');

    if (!(await one(tx, 'SELECT id FROM organizer_user WHERE email_normalized=$1', [DEMO_ORGANIZER.email]))) {
      await tx.query(`INSERT INTO organizer_user(email, email_normalized, display_name, role, password_hash, created_via) VALUES ($1,$1,$2,$3,$4,'DEMO_SEED')`, [DEMO_ORGANIZER.email, DEMO_ORGANIZER.displayName, DEMO_ORGANIZER.role, orgHash]);
      log(`[seed] demo organizer ${DEMO_ORGANIZER.email} created`);
    } else log('[seed] demo organizer exists — password left unchanged');

    const slots = (await tx.query('SELECT id, number FROM slot WHERE event_id=$1 ORDER BY number', [eventId])).rows as { id: string; number: number }[];
    let made = 0;
    for (let i = 0; i < NAMES.length; i++) {
      const crewId = `CRW-${String(i + 1).padStart(3, '0')}`;
      if (await one(tx, 'SELECT id FROM team WHERE crew_id=$1', [crewId])) continue;
      const name = NAMES[i];
      const email = i === 0 ? NEXORA.email : `${slug(name)}@example.test`;
      const ms = members(i);
      const t = (await one<{ id: string }>(
        tx,
        `INSERT INTO team(event_id, crew_id, name, name_normalized, email, email_normalized, captain_name, password_hash, credential_status, must_change_password, color, account_enabled, created_via)
         VALUES ($1,$2,$3,lower($3),$4,lower($4),$5,$6,'ISSUED',false,$7,true,'SEED') RETURNING id`,
        [eventId, crewId, name, email, ms[0].name, crewHashes[i], CREW_COLORS[i % CREW_COLORS.length][1]],
      ))!;
      for (const [j, m] of ms.entries()) {
        await tx.query('INSERT INTO team_member(team_id, position, name, institution, year, branch, student_id, is_captain) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [t.id, j + 1, m.name, m.institution, m.year, m.branch, m.studentId, j === 0]);
      }
      const slot = slots[Math.floor(i / 10)];
      const enr = (await one<EnrollmentRow>(tx, 'INSERT INTO slot_enrollment(slot_id, team_id) VALUES ($1,$2) RETURNING *', [slot.id, t.id]))!;
      if (DEFAULT_RULES.startingWallet > 0) {
        await applyLedger(tx, enr, { kind: 'GRANT', sprintId: null, wallet: DEFAULT_RULES.startingWallet, grant: DEFAULT_RULES.startingWallet, sourceType: 'starting-grant', sourceId: enr.id, reason: 'Starting wallet', actorId: null });
      }
      made++;
    }
    await tx.query(`SELECT setval('crew_number_seq', GREATEST((SELECT COALESCE(max(substring(crew_id from 5)::int), 0) FROM team), 40))`);
    log(`[seed] ${made} demo crew(s) created (CRW-001…CRW-040, 10 per slot), ${NAMES.length - made} already present`);

    await seedBank(tx, cfg, log);
    for (const s of slots) {
      const planned = await one<{ n: number }>(tx, 'SELECT count(*)::int AS n FROM question_instance WHERE slot_id=$1', [s.id]);
      if (planned!.n > 0) continue;
      const r = await buildSlotPlan(tx, SYSTEM, s.id);
      await tx.query(`UPDATE slot SET phase='READY' WHERE id=$1 AND phase='CONFIGURING'`, [s.id]);
      log(`[seed] Slot ${s.number}: release plan built (${r.instances} instances)`);
    }
    // Events produced by this seed transaction are not worth delivering.
    await tx.query('DELETE FROM outbox_event WHERE created_at = now()');
  });
}
