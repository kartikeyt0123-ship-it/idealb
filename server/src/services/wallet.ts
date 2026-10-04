import { randomUUID } from 'node:crypto';
import { one, type Tx } from '../db.js';
import { AppError } from '../errors.js';
import type { EnrollmentRow } from './context.js';
import { emit, Rooms } from './outbox.js';

export type LedgerKind = 'SOLVE_REWARD' | 'IMPOSTER_REWARD' | 'HINT_PURCHASE' | 'GRANT' | 'ADJUSTMENT';

export interface LedgerEntry {
  kind: LedgerKind;
  wallet: number;
  earned?: number;
  spent?: number;
  grant?: number;
  score?: number;
  sourceType: string;
  sourceId: string;
  reason?: string;
  actorAdminId?: string | null;
}

/**
 * Appends one immutable ledger row and updates the cached balances on the
 * (already row-locked) enrollment in the same transaction. The unique
 * (source_type, source_id) constraint guarantees one credit/debit per source.
 * The wallet CHECK (>= 0) makes overspending impossible even under races.
 */
export async function applyLedger(tx: Tx, enrollment: EnrollmentRow, e: LedgerEntry): Promise<EnrollmentRow> {
  const updated = await one<EnrollmentRow>(
    tx,
    `UPDATE game_enrollment
        SET wallet_balance = wallet_balance + $2,
            earned_total = earned_total + $3,
            spent_total = spent_total + $4,
            grant_total = grant_total + $5,
            score_adjust = score_adjust + $6,
            tasks_solved = tasks_solved + $7,
            version = version + 1
      WHERE id = $1
      RETURNING *`,
    [enrollment.id, e.wallet, e.earned ?? 0, e.spent ?? 0, e.grant ?? 0, e.score ?? 0, e.kind === 'SOLVE_REWARD' || e.kind === 'IMPOSTER_REWARD' ? 1 : 0],
  ).catch((err: { code?: string; constraint?: string }) => {
    if (err.code === '23514') throw new AppError('INSUFFICIENT_FUNDS', 'Not enough IdeaCoins.');
    throw err;
  });
  await tx.query(
    `INSERT INTO coin_ledger(game_id, enrollment_id, kind, wallet_delta, earned_delta, spent_delta, grant_delta, score_delta,
                             wallet_after, source_type, source_id, reason, actor_admin_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      enrollment.game_id, enrollment.id, e.kind, e.wallet, e.earned ?? 0, e.spent ?? 0, e.grant ?? 0, e.score ?? 0,
      updated!.wallet_balance, e.sourceType, e.sourceId, e.reason ?? null, e.actorAdminId ?? null,
    ],
  );
  await emit(tx, 'wallet.updated', [Rooms.team(enrollment.team_id), Rooms.admin], {
    gameId: enrollment.game_id,
    enrollmentId: enrollment.id,
    wallet: updated!.wallet_balance,
    earned: updated!.earned_total,
    spent: updated!.spent_total,
    version: updated!.version,
  });
  return updated!;
}

export async function lockEnrollment(tx: Tx, enrollmentId: string): Promise<EnrollmentRow> {
  const e = await one<EnrollmentRow>(tx, 'SELECT * FROM game_enrollment WHERE id=$1 FOR UPDATE', [enrollmentId]);
  if (!e) throw new AppError('NOT_FOUND', 'Enrollment not found.');
  return e;
}

/** Audited organizer adjustment. `target` decides whether it moves wallet, score or both. */
export async function adminAdjust(
  tx: Tx,
  enrollmentId: string,
  amount: number,
  target: 'WALLET' | 'SCORE' | 'BOTH' | 'GRANT',
  reason: string,
  adminId: string,
): Promise<EnrollmentRow> {
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 100_000) throw new AppError('VALIDATION_FAILED', 'Amount must be a non-zero integer.');
  if (!reason || reason.trim().length < 4) throw new AppError('VALIDATION_FAILED', 'A reason (min 4 characters) is required for every adjustment.');
  const enr = await lockEnrollment(tx, enrollmentId);
  if (target === 'GRANT' && amount < 0) throw new AppError('VALIDATION_FAILED', 'Grants must be positive. Use a wallet adjustment to deduct.');
  return applyLedger(tx, enr, {
    kind: target === 'GRANT' ? 'GRANT' : 'ADJUSTMENT',
    wallet: target === 'SCORE' ? 0 : amount,
    grant: target === 'GRANT' ? amount : 0,
    score: target === 'SCORE' || target === 'BOTH' ? amount : 0,
    sourceType: target === 'GRANT' ? 'grant' : 'adjustment',
    sourceId: randomUUID(),
    reason: reason.trim(),
    actorAdminId: adminId,
  });
}
