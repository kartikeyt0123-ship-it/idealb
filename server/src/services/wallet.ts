import { randomUUID } from 'node:crypto';
import { one, type Tx } from '../db.js';
import { AppError } from '../errors.js';
import type { EnrollmentRow } from './context.js';
import { emit, Rooms } from './outbox.js';

export type LedgerKind = 'SOLVE_REWARD' | 'BONUS_REWARD' | 'HINT_PURCHASE' | 'GRANT' | 'ADJUSTMENT';

export interface LedgerEntry {
  kind: LedgerKind;
  /** Sprint the entry is attributed to (the sprint in which it was accepted). NULL = slot-level. */
  sprintId: string | null;
  wallet: number;
  earned?: number;
  spent?: number;
  grant?: number;
  /** Explicit score contribution used by adjustments (counts under both ranking metrics). */
  score?: number;
  sourceType: string;
  sourceId: string;
  reason?: string;
  actorId?: string | null;
}

/**
 * Appends one immutable ledger row and updates the cached totals on the
 * (already row-locked) enrollment in the same transaction. UNIQUE
 * (source_type, source_id) guarantees one credit / debit per source; the
 * wallet CHECK (>= 0) makes overspending impossible even under races.
 *
 *   wallet         = Σ wallet_delta
 *   gross score    = Σ earned_delta + Σ score_delta
 *   net score      = Σ earned_delta − Σ spent_delta + Σ score_delta
 */
export async function applyLedger(tx: Tx, enrollment: EnrollmentRow, e: LedgerEntry): Promise<EnrollmentRow> {
  const updated = await one<EnrollmentRow>(
    tx,
    `UPDATE slot_enrollment
        SET wallet_balance = wallet_balance + $2, earned_total = earned_total + $3, spent_total = spent_total + $4,
            grant_total = grant_total + $5, score_adjust = score_adjust + $6, tasks_solved = tasks_solved + $7, version = version + 1
      WHERE id = $1 RETURNING *`,
    [enrollment.id, e.wallet, e.earned ?? 0, e.spent ?? 0, e.grant ?? 0, e.score ?? 0, e.kind === 'SOLVE_REWARD' || e.kind === 'BONUS_REWARD' ? 1 : 0],
  ).catch((err: { code?: string }) => {
    if (err.code === '23514') throw new AppError('INSUFFICIENT_FUNDS', 'Not enough IdeaCoins.');
    throw err;
  });
  await tx.query(
    `INSERT INTO coin_ledger(slot_id, sprint_id, enrollment_id, kind, wallet_delta, earned_delta, spent_delta, grant_delta, score_delta,
                             wallet_after, source_type, source_id, reason, actor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [enrollment.slot_id, e.sprintId, enrollment.id, e.kind, e.wallet, e.earned ?? 0, e.spent ?? 0, e.grant ?? 0, e.score ?? 0,
      updated!.wallet_balance, e.sourceType, e.sourceId, e.reason ?? null, e.actorId ?? null],
  );
  await emit(tx, 'wallet.updated', [Rooms.team(enrollment.team_id), Rooms.organizers], {
    slotId: enrollment.slot_id, enrollmentId: enrollment.id, wallet: updated!.wallet_balance, earned: updated!.earned_total, spent: updated!.spent_total, version: updated!.version,
  });
  return updated!;
}

export async function lockEnrollment(tx: Tx, enrollmentId: string): Promise<EnrollmentRow> {
  const e = await one<EnrollmentRow>(tx, 'SELECT * FROM slot_enrollment WHERE id=$1 FOR UPDATE', [enrollmentId]);
  if (!e) throw new AppError('NOT_FOUND', 'Enrollment not found.');
  return e;
}

/**
 * Audited organizer correction as a compensating entry — never an edit.
 * WALLET moves spendable coins only; SCORE moves the competition score only;
 * BOTH moves both; GRANT funds the wallet (not score).
 */
export async function adminAdjust(tx: Tx, enrollmentId: string, args: { amount: number; target: 'WALLET' | 'SCORE' | 'BOTH' | 'GRANT'; reason: string; sprintId: string | null; actorId: string }) {
  if (!Number.isInteger(args.amount) || args.amount === 0 || Math.abs(args.amount) > 100_000) throw new AppError('VALIDATION_FAILED', 'Amount must be a non-zero integer.');
  if (!args.reason || args.reason.trim().length < 4) throw new AppError('VALIDATION_FAILED', 'A reason (min 4 characters) is required for every adjustment.');
  if (args.target === 'GRANT' && args.amount < 0) throw new AppError('VALIDATION_FAILED', 'Grants must be positive; use a wallet adjustment to deduct.');
  const enr = await lockEnrollment(tx, enrollmentId);
  return applyLedger(tx, enr, {
    kind: args.target === 'GRANT' ? 'GRANT' : 'ADJUSTMENT',
    sprintId: args.sprintId,
    wallet: args.target === 'SCORE' ? 0 : args.amount,
    grant: args.target === 'GRANT' ? args.amount : 0,
    score: args.target === 'SCORE' || args.target === 'BOTH' ? args.amount : 0,
    sourceType: args.target === 'GRANT' ? 'grant' : 'adjustment',
    sourceId: randomUUID(),
    reason: args.reason.trim(),
    actorId: args.actorId,
  });
}
