/**
 * Reproducible DEMO fixture. Demo content only — every problem, crew and
 * schedule here requires organizer review before the real event.
 *
 * Idempotent: re-running never duplicates accounts, never overwrites a changed
 * password and never touches existing game state. Use `npm run reset:demo`
 * to wipe the isolated demo database explicitly.
 */
import type { AppConfig } from '../config.js';
import { imposterTemplates, regularTemplates } from '../content/index.js';
import { DOMAIN_ORDER } from '../content/types.js';
import { one, withTx, type Db, type Tx } from '../db.js';
import { hashPassword } from '../security/crypto.js';
import { createProblem, DIFFICULTY_DEFAULTS, upsertDomains } from '../services/content.js';
import { PRESETS } from '../services/lifecycle.js';
import { insertTeam, setDayEligibility } from '../services/teams.js';

export const DEMO_ADMIN = { email: 'admin@crm.local', password: 'idealab', displayName: 'IDEALab Commander', role: 'SUPER_ADMIN' as const };

type Days = 'D1' | 'D2' | 'BOTH' | 'PENDING';
interface DemoTeam { name: string; slug: string; days: Days; requested: 'DAY1' | 'DAY2' | 'BOTH'; members: number; crewId?: string; password?: string; color?: string }

/** 5 Day-1-only, 5 Day-2-only, 5 both days (incl. Nexora), 5 pending. => 10 eligible crews per game. */
export const DEMO_TEAMS: DemoTeam[] = [
  { name: 'BYTEFORCE', slug: 'byteforce', days: 'D1', requested: 'DAY1', members: 4 },
  { name: 'CODEX', slug: 'codex', days: 'D1', requested: 'DAY1', members: 3 },
  { name: 'DEBUGGERS', slug: 'debuggers', days: 'D1', requested: 'BOTH', members: 4 },
  { name: 'NULLPTR', slug: 'nullptr', days: 'D1', requested: 'DAY1', members: 3 },
  { name: 'STACKSMASH', slug: 'stacksmash', days: 'D1', requested: 'DAY1', members: 4 },
  { name: 'SEGFAULT', slug: 'segfault', days: 'D2', requested: 'DAY2', members: 4 },
  { name: 'BITSHIFT', slug: 'bitshift', days: 'D2', requested: 'DAY2', members: 3 },
  { name: 'KERNEL PANIC', slug: 'kernelpanic', days: 'D2', requested: 'BOTH', members: 4 },
  { name: 'LAMBDA LEGION', slug: 'lambdalegion', days: 'D2', requested: 'DAY2', members: 3 },
  { name: 'HEAPSTERS', slug: 'heapsters', days: 'D2', requested: 'DAY2', members: 4 },
  { name: 'NEXORA', slug: 'nexora', days: 'BOTH', requested: 'BOTH', members: 4, crewId: 'CRW-042', password: 'CrewDemo123!', color: '#51cfdf' },
  { name: 'SYNTAX SQUAD', slug: 'syntaxsquad', days: 'BOTH', requested: 'BOTH', members: 4 },
  { name: 'QUANTUM QUILLS', slug: 'quantumquills', days: 'BOTH', requested: 'BOTH', members: 3 },
  { name: 'LOOP TROOP', slug: 'looptroop', days: 'BOTH', requested: 'BOTH', members: 4 },
  { name: 'RECURSIA', slug: 'recursia', days: 'BOTH', requested: 'BOTH', members: 3 },
  { name: 'VOID WALKERS', slug: 'voidwalkers', days: 'PENDING', requested: 'DAY1', members: 4 },
  { name: 'PIXEL PIRATES', slug: 'pixelpirates', days: 'PENDING', requested: 'DAY2', members: 3 },
  { name: 'CACHE CREW', slug: 'cachecrew', days: 'PENDING', requested: 'BOTH', members: 4 },
  { name: 'ASYNC ARMADA', slug: 'asyncarmada', days: 'PENDING', requested: 'BOTH', members: 3 },
  { name: 'GLITCH GUILD', slug: 'glitchguild', days: 'PENDING', requested: 'DAY1', members: 4 },
];

const COLORS = ['#86cd97', '#f37983', '#edd478', '#b298e7', '#efae77', '#7dace9', '#d693b9', '#b3d77c', '#dfe7ea', '#51cfdf'];
const FIRST = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Ishita', 'Vihaan', 'Ananya', 'Arjun', 'Saanvi', 'Reyansh', 'Myra', 'Aditya', 'Kiara', 'Vivaan', 'Tara'];
const LAST = ['Sharma', 'Verma', 'Patel', 'Joshi', 'Rao', 'Iyer', 'Mehta', 'Nair', 'Kulkarni', 'Gupta', 'Desai', 'Bose'];
const BRANCHES = ['CSE', 'IT', 'ECE', 'EE', 'ME', 'CSE (AI/ML)'];
const YEARS = ['1st year', '2nd year', '3rd year', '4th year'];

export function demoPassword(t: DemoTeam) {
  return t.password ?? `Demo-${t.slug.charAt(0).toUpperCase()}${t.slug.slice(1)}-2026`;
}

function demoMembers(i: number, count: number) {
  return Array.from({ length: count }, (_, j) => ({
    name: `${FIRST[(i * 3 + j * 5) % FIRST.length]} ${LAST[(i * 7 + j * 3) % LAST.length]}`,
    institution: 'Demo Institute of Technology (fictional)',
    year: YEARS[(i + j) % YEARS.length],
    branch: BRANCHES[(i * 2 + j) % BRANCHES.length],
    studentId: j === 0 ? `DEMO-${String(i + 1).padStart(2, '0')}${j}` : '',
  }));
}

async function ensureStructure(tx: Tx, cfg: AppConfig, log: (m: string) => void) {
  const existing = await one<{ id: string }>(tx, 'SELECT id FROM event LIMIT 1');
  if (existing) {
    log('[seed] event already exists — leaving games, sprints and history untouched');
    return false;
  }
  await upsertDomains(tx);
  const ev = (await one<{ id: string }>(tx, `INSERT INTO event(name, timezone, day_selection_mode, is_demo) VALUES ('AAROHAN 2026 · DEBUG + RUN (DEMO)', 'Asia/Kolkata', 'MANUAL', true) RETURNING id`))!;
  const d1 = (await one<{ id: string }>(tx, `INSERT INTO event_day(event_id, day_number, label, date) VALUES ($1, 1, 'Day 1', '2026-10-03') RETURNING id`, [ev.id]))!;
  const d2 = (await one<{ id: string }>(tx, `INSERT INTO event_day(event_id, day_number, label, date) VALUES ($1, 2, 'Day 2', '2026-10-04') RETURNING id`, [ev.id]))!;
  await tx.query('UPDATE event SET manual_day_id=$2 WHERE id=$1', [ev.id, d1.id]);

  // Problem library: every variant becomes its own published problem.
  for (const t of regularTemplates) {
    for (const v of [0, 1, 2, 3] as const) {
      const variant = t.variant(v);
      const d = DIFFICULTY_DEFAULTS[t.difficulty];
      await createProblem(tx, cfg, {
        key: `${t.key}-v${v}`, domainSlug: t.domain, kind: 'REGULAR', isDemo: true, status: 'PUBLISHED',
        version: { variant, difficulty: t.difficulty, reward: d.reward, hintCost: d.hintCost, sourceTemplate: t.key, sourceVariant: v }, actorId: null,
      });
    }
  }
  for (const t of imposterTemplates.slice(0, 4)) {
    for (const v of [0, 1, 2, 3] as const) {
      await createProblem(tx, cfg, {
        key: `${t.key}-v${v}`, domainSlug: t.domain, kind: 'IMPOSTER', isDemo: true, status: 'PUBLISHED',
        version: { variant: t.variant(v), difficulty: 'HARD', reward: 900, hintCost: 100, sourceTemplate: t.key, sourceVariant: v }, actorId: null,
      });
    }
  }

  const diffRank = { EASY: 0, MEDIUM: 1, HARD: 2 };
  for (const [gi, dayId] of [[1, d1.id], [2, d2.id]] as const) {
    const game = (await one<{ id: string }>(
      tx,
      `INSERT INTO game(event_id, number, name, day_id, phase, ranking_metric, ranking_metric_confirmed, prize_places, duration_preset)
       VALUES ($1,$2,$3,$4,'WAITING','NET_COINS',false,3,'STANDARD') RETURNING id`,
      [ev.id, gi, `Game ${gi} · Day ${gi}`, dayId],
    ))!;
    for (const [place, label] of [[1, 'First place — winning crew (organizer to confirm prize)'], [2, 'Second place (organizer to confirm prize)'], [3, 'Third place (organizer to confirm prize)']] as const) {
      await tx.query('INSERT INTO prize_rule(game_id, place, label) VALUES ($1,$2,$3)', [game.id, place, label]);
    }
    for (const sn of [1, 2]) {
      const sprint = (await one<{ id: string }>(
        tx,
        `INSERT INTO sprint(game_id, number, duration_seconds, eliminate_count) VALUES ($1,$2,$3,$4) RETURNING id`,
        [game.id, sn, PRESETS.STANDARD.sprintSeconds, sn === 1 ? 2 : 3],
      ))!;
      const v = (gi - 1) * 2 + (sn - 1); // v0 G1S1, v1 G1S2, v2 G2S1, v3 G2S2 — Day 2 never reuses Day 1 answers
      for (const slug of DOMAIN_ORDER) {
        const dom = (await one<{ id: string; prefix: string }>(tx, 'SELECT id, prefix FROM domain WHERE slug=$1', [slug]))!;
        const ts = regularTemplates.filter((t) => t.domain === slug).sort((a, b) => diffRank[a.difficulty] - diffRank[b.difficulty] || a.key.localeCompare(b.key));
        for (let i = 0; i < ts.length; i++) {
          const pv = (await one<{ id: string }>(tx, `SELECT v.id FROM problem_version v JOIN problem p ON p.id=v.problem_id WHERE p.key=$1 AND v.version_no=1`, [`${ts[i].key}-v${v}`]))!;
          await tx.query(
            `INSERT INTO task_instance(game_id, sprint_id, problem_version_id, domain_id, label) VALUES ($1,$2,$3,$4,$5)`,
            [game.id, sprint.id, pv.id, dom.id, `${dom.prefix}-${String(i + 1).padStart(2, '0')}`],
          );
        }
      }
      // One draft imposter per sprint, initially unreleased.
      const it = imposterTemplates[v % imposterTemplates.length];
      const ipv = (await one<{ id: string }>(tx, `SELECT v.id FROM problem_version v JOIN problem p ON p.id=v.problem_id WHERE p.key=$1 AND v.version_no=1`, [`${it.key}-v${v}`]))!;
      await tx.query(
        `INSERT INTO imposter_release(game_id, sprint_id, problem_version_id, label, status, reward, hint_cost, claim_seconds, solve_seconds)
         VALUES ($1,$2,$3,$4,'DRAFT',900,100,$5,$6)`,
        [game.id, sprint.id, ipv.id, `IMPOSTER-${sn === 1 ? 'A' : 'B'}${gi}`, PRESETS.STANDARD.imposterClaim, PRESETS.STANDARD.imposterSolve],
      );
    }
  }
  log('[seed] created event, 2 days, 2 games × 2 sprints, 120 task instances, 4 imposter drafts, prizes');
  return true;
}

export async function seedDemo(db: Db, cfg: AppConfig, log: (m: string) => void = console.log) {
  // Hash outside the transaction (scrypt is deliberately slow).
  const adminHash = await hashPassword(DEMO_ADMIN.password);
  const teamHashes = await Promise.all(DEMO_TEAMS.map((t) => hashPassword(demoPassword(t))));
  await withTx(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(727002)');
    await ensureStructure(tx, cfg, log);
    const admin = await one(tx, 'SELECT id FROM admin_user WHERE email_normalized=$1', [DEMO_ADMIN.email]);
    if (!admin) {
      await tx.query(
        `INSERT INTO admin_user(email, email_normalized, display_name, role, password_hash, created_via) VALUES ($1,$1,$2,$3,$4,'DEMO_SEED')`,
        [DEMO_ADMIN.email, DEMO_ADMIN.displayName, DEMO_ADMIN.role, adminHash],
      );
      log(`[seed] demo commander ${DEMO_ADMIN.email} created`);
    } else log(`[seed] demo commander exists — password left unchanged`);

    const days = (await tx.query('SELECT id, day_number FROM event_day ORDER BY day_number')).rows as { id: string; day_number: number }[];
    let created = 0;
    for (let i = 0; i < DEMO_TEAMS.length; i++) {
      const t = DEMO_TEAMS[i];
      const email = `${t.slug}@example.test`;
      if (await one(tx, 'SELECT id FROM team WHERE email_normalized=$1', [email])) continue;
      const crewId = t.crewId ?? `CRW-${String(i + 1).padStart(3, '0')}`;
      const team = await insertTeam(tx, {
        teamName: t.name, email, passwordHash: teamHashes[i], members: demoMembers(i, t.members), requestedDays: t.requested,
        color: t.color ?? COLORS[i % COLORS.length], createdVia: 'SEED', mustChangePassword: false, crewId,
      });
      const actor = { type: 'SYSTEM' as const, id: null };
      if (t.days === 'D1' || t.days === 'BOTH') await setDayEligibility(tx, actor, team.id, days[0].id, true);
      if (t.days === 'D2' || t.days === 'BOTH') await setDayEligibility(tx, actor, team.id, days[1].id, true);
      created++;
    }
    // Keep generated crew IDs clear of the seeded ones (CRW-042 etc.).
    await tx.query(`SELECT setval('crew_number_seq', GREATEST((SELECT max(substring(crew_id from 5)::int) FROM team), 100))`);
    log(`[seed] ${created} demo crew(s) created, ${DEMO_TEAMS.length - created} already present`);
    // Events produced by this seed transaction are not useful to deliver (now() = transaction start).
    await tx.query('DELETE FROM outbox_event WHERE created_at = now()');
  });
}
