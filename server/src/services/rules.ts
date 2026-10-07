import { z } from 'zod';
import { AppError } from '../errors.js';

/**
 * Event rules. Every fairness-changing decision is a named rule with a
 * documented demo default. Rules are UNCONFIRMED until an organizer confirms
 * them in the rule-review screen. Production activation requires every rule to
 * be confirmed; demo activation may run on the labelled defaults.
 * Rules freeze when the first sprint of any slot starts.
 */

const perDifficulty = z.object({ EASY: z.number().int().min(0), MEDIUM: z.number().int().min(0), HARD: z.number().int().min(0) });

export const rulesSchema = z.object({
  /** FRESH_PER_SPRINT: a new initial release each sprint (expires at sprint end). SLOT_POOL: one pool per slot carried across sprints. */
  questionScope: z.enum(['FRESH_PER_SPRINT', 'SLOT_POOL']),
  /** Initial instances per domain (per sprint in FRESH_PER_SPRINT, per slot in SLOT_POOL). */
  initialPerDomain: perDifficulty,
  /** PER_SLOT: reserves/bonuses budgeted per slot (split across sprints by the blueprint). */
  extraScope: z.enum(['PER_SLOT', 'PER_SPRINT']),
  reservesPerSlot: z.number().int().min(0).max(200),
  bonusesPerSlot: z.number().int().min(0).max(100),
  rewards: perDifficulty.extend({ BONUS: z.number().int().min(0) }),
  hintCosts: perDifficulty.extend({ BONUS: z.number().int().min(0) }),
  startingWallet: z.number().int().min(0),
  /** GROSS_EARNED: hints reduce the spendable wallet only. NET_COINS: hints also reduce score. */
  rankingMetric: z.enum(['GROSS_EARNED', 'NET_COINS']),
  bonusPolicy: z.enum(['OPEN_FIRST_CORRECT']),
  /** MANUAL: a per-slot pool of bonus questions the organizer releases one at a time. SCHEDULED: blueprint offsets. */
  bonusMode: z.enum(['MANUAL', 'SCHEDULED']).default('MANUAL'),
  /** Marking a crew present (attendance) is what enables its login. */
  attendanceGatesLogin: z.boolean().default(true),
  /** Crew screens block copy / cut / right-click / print / screenshot keys and hide content when the window loses focus. */
  protectContent: z.boolean().default(true),
  elimination: z.object({ enabled: z.boolean(), counts: z.array(z.number().int().min(0)).length(4) }),
  tiePolicy: z.enum(['SHARED_RANK_PUBLISHED_TIEBREAK']),
  sessionLimit: z.number().int().min(1).max(20),
  sessionLimitPolicy: z.enum(['EVICT_OLDEST', 'REJECT']),
  recycling: z.literal(false),
  singleRunningSlot: z.boolean(),
  sprintsPerSlot: z.literal(4),
  sprintMinutes: z.number().min(0.5).max(240),
  preset: z.enum(['STANDARD', 'REHEARSAL', 'CUSTOM']),
  blueprint: z.object({
    reservesPerSprint: z.array(z.number().int().min(0)).length(4),
    bonusesPerSprint: z.array(z.number().int().min(0)).length(4),
    /** Active-minute offsets for bonus releases, per sprint (scaled by the preset). */
    bonusOffsetsMinutes: z.array(z.array(z.number().min(0))).length(4),
  }),
});
export type Rules = z.infer<typeof rulesSchema>;

export const DEFAULT_RULES: Rules = {
  // Released questions stay active for the whole slot; the organizer tops domains up from the bank.
  questionScope: 'SLOT_POOL',
  // Released when Sprint 1 of a slot starts: 15 per domain (7 easy, 5 medium, 3 hard).
  initialPerDomain: { EASY: 7, MEDIUM: 5, HARD: 3 },
  extraScope: 'PER_SLOT',
  // Top-ups and bonuses are picked from the bank by the organizer (no fixed pools).
  reservesPerSlot: 0,
  bonusesPerSlot: 0,
  // Matches the IDEALab.dev economy (base_coins 150 / 400 / 750; hints 25 / 50 / 100).
  rewards: { EASY: 150, MEDIUM: 400, HARD: 750, BONUS: 900 },
  hintCosts: { EASY: 25, MEDIUM: 50, HARD: 100, BONUS: 100 },
  startingWallet: 0,
  rankingMetric: 'GROSS_EARNED',
  bonusPolicy: 'OPEN_FIRST_CORRECT',
  bonusMode: 'MANUAL',
  attendanceGatesLogin: true,
  protectContent: true,
  elimination: { enabled: false, counts: [0, 0, 0, 0] },
  tiePolicy: 'SHARED_RANK_PUBLISHED_TIEBREAK',
  sessionLimit: 4,
  sessionLimitPolicy: 'EVICT_OLDEST',
  recycling: false,
  singleRunningSlot: true,
  sprintsPerSlot: 4,
  sprintMinutes: 30,
  preset: 'STANDARD',
  blueprint: {
    reservesPerSprint: [5, 5, 5, 5],
    bonusesPerSprint: [3, 3, 2, 2],
    bonusOffsetsMinutes: [[8, 16, 24], [8, 16, 24], [10, 20], [10, 20]],
  },
};

export const REHEARSAL_SECONDS = 120;

/** Human-readable catalogue shown on the rule-review screen. */
export const RULE_CATALOGUE: { key: string; title: string; describe: (r: Rules) => string; fairness: boolean }[] = [
  { key: 'questionScope', title: 'Question lifetime', fairness: true, describe: (r) => r.questionScope === 'SLOT_POOL' ? 'Released questions stay active for the whole slot (all four sprints) until solved; solves count for the sprint in which they are accepted. Unsolved questions expire when the slot ends.' : 'A fresh initial set every sprint; questions expire at sprint end' },
  { key: 'initialPerDomain', title: 'Initial release per domain', fairness: true, describe: (r) => `${r.initialPerDomain.EASY} easy + ${r.initialPerDomain.MEDIUM} medium + ${r.initialPerDomain.HARD} hard per domain (${r.initialPerDomain.EASY + r.initialPerDomain.MEDIUM + r.initialPerDomain.HARD} per domain, ${(r.initialPerDomain.EASY + r.initialPerDomain.MEDIUM + r.initialPerDomain.HARD) * 6} total) released when Sprint 1 of a slot starts; auto-picked from the bank and editable before the start. Also the top-up target.` },
  { key: 'extraPools', title: 'Top-ups and bonuses', fairness: true, describe: () => 'The organizer watches the live stock per domain and difficulty and releases more from the bank at any time (Top up to target, or pick specific questions), as regular or bonus questions. Previously used questions may be reused.' },
  { key: 'rewards', title: 'Rewards', fairness: true, describe: (r) => `Easy ${r.rewards.EASY}, medium ${r.rewards.MEDIUM}, hard ${r.rewards.HARD}, bonus ${r.rewards.BONUS} IdeaCoins` },
  { key: 'hintCosts', title: 'Hint costs', fairness: true, describe: (r) => `Each question's own hint ladder (IDEALab.dev: usually 25 / 50 / 100 by difficulty); fallback ${r.hintCosts.EASY}/${r.hintCosts.MEDIUM}/${r.hintCosts.HARD}, bonus ${r.hintCosts.BONUS}; starting wallet ${r.startingWallet}` },
  { key: 'rankingMetric', title: 'Ranking basis', fairness: true, describe: (r) => r.rankingMetric === 'GROSS_EARNED' ? 'GROSS_EARNED: score = coins earned; hints reduce the spendable wallet only' : 'NET_COINS: score = earned − spent; hints reduce score' },
  { key: 'bonusPolicy', title: 'Bonus solve policy', fairness: true, describe: () => 'Open to every active crew in the slot; first correct verified solution wins. No click-to-reserve.' },
  { key: 'elimination', title: 'Elimination', fairness: true, describe: (r) => r.elimination.enabled ? `Enabled: bottom ${r.elimination.counts.join(' / ')} crews after sprints 1-4 (frozen standings, ties need a decision)` : 'Disabled (latest format does not restate elimination)' },
  { key: 'tiePolicy', title: 'Ties', fairness: true, describe: () => 'Shared rank. Final top-score ties require a published tiebreak or a joint-winner decision. Never by team ID.' },
  { key: 'attendance', title: 'Attendance gates login', fairness: false, describe: (r) => r.attendanceGatesLogin ? 'A crew can sign in only after an organizer marks it present (attendance). Unmarking signs its devices out.' : 'Attendance is informational; enabled crews can always sign in.' },
  { key: 'sessions', title: 'Devices per crew', fairness: false, describe: (r) => `Up to ${r.sessionLimit} concurrent sessions per crew, one shared wallet (${r.sessionLimitPolicy === 'EVICT_OLDEST' ? 'oldest device is signed out' : 'extra sign-ins are rejected'})` },
  { key: 'recycling', title: 'Question reuse', fairness: true, describe: () => 'Solved or expired questions never reopen automatically. The organizer may release any bank question again — including ones used in earlier slots or sprints.' },
  { key: 'protection', title: 'Copy & screenshot protection', fairness: false, describe: (r) => r.protectContent ? 'Crew screens block copy, cut, right-click, printing and screenshot shortcuts, and blank the screen when it loses focus; a crew watermark is shown. (Browsers cannot fully prevent screenshots or phone cameras.)' : 'Off' },
  { key: 'schedule', title: 'Sprint schedule', fairness: true, describe: (r) => `4 sprints × ${r.sprintMinutes} active minutes (${r.preset}), each started by an organizer after the slot is opened. ${r.bonusMode === 'SCHEDULED' ? `Bonuses ${r.blueprint.bonusesPerSprint.join('/')} at active minutes ${r.blueprint.bonusOffsetsMinutes.map((o) => `[${o.join(',')}]`).join(' ')}.` : 'Bonuses are released by the organizer from the bank.'}` },
  { key: 'singleRunningSlot', title: 'Concurrent slots', fairness: false, describe: (r) => r.singleRunningSlot ? 'Only one slot may run at a time' : 'Several slots may run at once' },
];

function sum(p: { EASY: number; MEDIUM: number; HARD: number }) {
  return p.EASY + p.MEDIUM + p.HARD;
}

export function parseRules(raw: unknown): Rules {
  const r = rulesSchema.safeParse(raw);
  if (!r.success) throw new AppError('VALIDATION_FAILED', `Invalid rules: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`);
  for (let i = 0; i < 4; i++) {
    if (r.data.bonusMode === 'SCHEDULED' && r.data.blueprint.bonusOffsetsMinutes[i].length !== r.data.blueprint.bonusesPerSprint[i]) {
      throw new AppError('VALIDATION_FAILED', `Sprint ${i + 1}: ${r.data.blueprint.bonusesPerSprint[i]} bonuses need exactly that many release offsets.`);
    }
    for (const m of r.data.blueprint.bonusOffsetsMinutes[i]) {
      if (m >= r.data.sprintMinutes && r.data.preset !== 'REHEARSAL') throw new AppError('VALIDATION_FAILED', `Bonus offset ${m} min is outside the ${r.data.sprintMinutes}-minute sprint.`);
    }
  }
  return r.data;
}

/** Sprint duration in seconds under the current preset. */
export function sprintSeconds(r: Rules) {
  return r.preset === 'REHEARSAL' ? REHEARSAL_SECONDS : Math.round(r.sprintMinutes * 60);
}

/** Scale an active-minute offset from the standard 30-minute schedule into the active preset. */
export function scaledOffsetSeconds(r: Rules, minutes: number) {
  const standard = r.sprintMinutes * 60;
  return Math.round((minutes * 60 * sprintSeconds(r)) / standard);
}

export function unconfirmedRules(confirmations: Record<string, unknown>): string[] {
  return RULE_CATALOGUE.map((c) => c.key).filter((k) => !confirmations[k]);
}
