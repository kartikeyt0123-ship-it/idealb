import type { Queryable, Tx } from '../db.js';
import { AppError } from '../errors.js';
import { sha256 } from '../security/crypto.js';

/**
 * Transactional idempotency. Call `claim` first inside the business
 * transaction. If a committed record exists for (actor, scope, key) the stored
 * response is returned (or IDEMPOTENCY_MISMATCH if the payload differs). A
 * concurrent duplicate blocks on the primary key until the first transaction
 * commits, then observes its stored response. `save` stores the response in
 * the same transaction, so a rolled-back attempt leaves no record.
 */
export interface IdemHandle {
  existing?: unknown;
  save: (response: unknown) => Promise<void>;
}

export function fingerprint(payload: unknown): string {
  return sha256(JSON.stringify(payload ?? null));
}

export async function claimIdempotency(tx: Tx, actorKey: string, scope: string, key: string, payload: unknown): Promise<IdemHandle> {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new AppError('VALIDATION_FAILED', 'Invalid idempotency key.');
  const fp = fingerprint(payload);
  const inserted = await tx.query(
    `INSERT INTO idempotency_record(actor_key, scope, key, fingerprint, response) VALUES ($1, $2, $3, $4, 'null'::jsonb)
     ON CONFLICT DO NOTHING RETURNING key`,
    [actorKey, scope, key, fp],
  );
  if (inserted.rowCount === 0) {
    const row = (await tx.query('SELECT fingerprint, response FROM idempotency_record WHERE actor_key=$1 AND scope=$2 AND key=$3', [actorKey, scope, key])).rows[0];
    if (row.fingerprint !== fp) throw new AppError('IDEMPOTENCY_MISMATCH', 'This request key was already used with different data.');
    return { existing: row.response, save: async () => undefined };
  }
  return {
    save: async (response) => {
      await tx.query('UPDATE idempotency_record SET response=$4 WHERE actor_key=$1 AND scope=$2 AND key=$3', [actorKey, scope, key, JSON.stringify(response)]);
    },
  };
}

/** Read-only lookup used before cheap pre-checks, so a retried request still gets its original response. */
export async function peekIdempotency(q: Queryable, actorKey: string, scope: string, key: string, payload?: unknown): Promise<unknown | undefined> {
  const r = await q.query(`SELECT fingerprint, response FROM idempotency_record WHERE actor_key=$1 AND scope=$2 AND key=$3 AND response <> 'null'::jsonb`, [actorKey, scope, key]);
  const row = r.rows[0];
  if (!row) return undefined;
  if (payload !== undefined && row.fingerprint !== fingerprint(payload)) throw new AppError('IDEMPOTENCY_MISMATCH', 'This request key was already used with different data.');
  return row.response;
}
