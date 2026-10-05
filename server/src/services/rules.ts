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
  questionScope: 'FRESH_PER_SPRINT',
  initialPerDomain: { EASY: 5, MEDIUM: 3, HARD: 2 },
  extraScope: 'PER_SLOT',
  reservesPerSlot: 20,
  bonusesPerSlot: 10,
  rewards: { EASY: 150, MEDIUM: 400, HARD: 700, BONUS: 900 },
  hintCosts: { EASY: 30, MEDIUM: 80, HARD: 140, BONUS: 100 },
  startingWallet: 0,
  rankingMetric: 'GROSS_EARNED',
  bonusPolicy: 'OPEN_FIRST_CORRECT',
  bonusMode: 'MANUAL',
  attendanceGatesLogin: true,
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
  { key: 'questionScope', title: 'Initial question scope', fairness: true, describe: (r) => r.questionScope === 'FRESH_PER_SPRINT' ? `Fresh release each sprint: ${sum(r.initialPerDomain) * 6} questions (${sum(r.initialPerDomain)} per domain), expiring at sprint end` : `One slot pool of ${sum(r.initialPerDomain) * 6} questions carried across all four sprints; solves count for the sprint in which they are accepted` },
  { key: 'initialPerDomain', title: 'Difficulty distribution', fairness: true, describe: (r) => `Per domain: ${r.initialPerDomain.EASY} easy, ${r.initialPerDomain.MEDIUM} medium, ${r.initialPerDomain.HARD} hard (six domains = ${r.initialPerDomain.EASY * 6}/${r.initialPerDomain.MEDIUM * 6}/${r.initialPerDomain.HARD * 6})` },
  { key: 'extraPools', title: 'Reserve and bonus pools', fairness: true, describe: (r) => `${r.reservesPerSlot} reserve questions per slot (mixed domains) refill the domains depleted by solves when the organizer presses Refill; ${r.bonusesPerSlot} bonus questions per slot (mixed domains) ${r.bonusMode === 'MANUAL' ? 'released by the organizer from time to time' : 'released automatically at the blueprint offsets'}. Released extras expire with their sprint.` },
  { key: 'rewards', title: 'Rewards', fairness: true, describe: (r) => `Easy ${r.rewards.EASY}, medium ${r.rewards.MEDIUM}, hard ${r.rewards.HARD}, bonus ${r.rewards.BONUS} IdeaCoins` },
  { key: 'hintCosts', title: 'Hint costs', fairness: true, describe: (r) => `${r.hintCosts.EASY}/${r.hintCosts.MEDIUM}/${r.hintCosts.HARD} (easy/medium/hard), bonus ${r.hintCosts.BONUS}; starting wallet ${r.startingWallet}` },
  { key: 'rankingMetric', title: 'Ranking basis', fairness: true, describe: (r) => r.rankingMetric === 'GROSS_EARNED' ? 'GROSS_EARNED: score = coins earned; hints reduce the spendable wallet only' : 'NET_COINS: score = earned − spent; hints reduce score' },
  { key: 'bonusPolicy', title: 'Bonus solve policy', fairness: true, describe: () => 'Open to every active crew in the slot; first correct verified solution wins. No click-to-reserve.' },
  { key: 'elimination', title: 'Elimination', fairness: true, describe: (r) => r.elimination.enabled ? `Enabled: bottom ${r.elimination.counts.join(' / ')} crews after sprints 1-4 (frozen standings, ties need a decision)` : 'Disabled (latest format does not restate elimination)' },
  { key: 'tiePolicy', title: 'Ties', fairness: true, describe: () => 'Shared rank. Final top-score ties require a published tiebreak or a joint-winner decision. Never by team ID.' },
  { key: 'attendance', title: 'Attendance gates login', fairness: false, describe: (r) => r.attendanceGatesLogin ? 'A crew can sign in only after an organizer marks it present (attendance). Unmarking signs its devices out.' : 'Attendance is informational; enabled crews can always sign in.' },
  { key: 'sessions', title: 'Devices per crew', fairness: false, describe: (r) => `Up to ${r.sessionLimit} concurrent sessions per crew, one shared wallet (${r.sessionLimitPolicy === 'EVICT_OLDEST' ? 'oldest device is signed out' : 'extra sign-ins are rejected'})` },
  { key: 'recycling', title: 'Question recycling', fairness: true, describe: () => 'Disabled: solved or expired questions never reopen automatically' },
  { key: 'schedule', title: 'Sprint schedule & release blueprint', fairness: true, describe: (r) => `4 sprints × ${r.sprintMinutes} active minutes (${r.preset}), each started by an organizer after the slot is opened. Initial set released at sprint start; ${r.reservesPerSlot} reserves held in a slot pool for refills; ${r.bonusMode === 'SCHEDULED' ? `bonuses ${r.blueprint.bonusesPerSprint.join('/')} at active minutes ${r.blueprint.bonusOffsetsMinutes.map((o) => `[${o.join(',')}]`).join(' ')}` : `${r.bonusesPerSlot} bonuses released manually from the slot pool`}` },
  { key: 'singleRunningSlot', title: 'Concurrent slots', fairness: false, describe: (r) => r.singleRunningSlot ? 'Only one slot may run at a time' : 'Several slots may run at once' },
];

function sum(p: { EASY: number; MEDIUM: number; HARD: number }) {
  return p.EASY + p.MEDIUM + p.HARD;
}

export function parseRules(raw: unknown): Rules {
  const r = rulesSchema.safeParse(raw);
  if (!r.success) throw new AppError('VALIDATION_FAILED', `Invalid rules: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`);
  for (let i = 0; i < 4; i++) {
    if (r.data.blueprint.bonusOffsetsMinutes[i].length !== r.data.blueprint.bonusesPerSprint[i]) {
      throw new AppError('VALIDATION_FAILED', `Sprint ${i + 1}: ${r.data.blueprint.bonusesPerSprint[i]} bonuses need exactly that many release offsets.`);
    }
    for (const m of r.data.blueprint.bonusOffsetsMinutes[i]) {
      if (m >= r.data.sprintMinutes && r.data.preset !== 'REHEARSAL') throw new AppError('VALIDATION_FAILED', `Bonus offset ${m} min is outside the ${r.data.sprintMinutes}-minute sprint.`);
    }
  }
  if (r.data.blueprint.reservesPerSprint.reduce((a, b) => a + b, 0) !== r.data.reservesPerSlot && r.data.extraScope === 'PER_SLOT') {
    throw new AppError('VALIDATION_FAILED', 'Reserve blueprint must add up to reserves per slot.');
  }
  if (r.data.blueprint.bonusesPerSprint.reduce((a, b) => a + b, 0) !== r.data.bonusesPerSlot && r.data.extraScope === 'PER_SLOT') {
    throw new AppError('VALIDATION_FAILED', 'Bonus blueprint must add up to bonuses per slot.');
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
