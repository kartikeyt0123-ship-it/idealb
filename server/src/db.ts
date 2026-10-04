import pg from 'pg';

// Return int8/bigint as JS numbers (ids and ms counters stay well below 2^53).
pg.types.setTypeParser(20, (v) => Number(v));
// NUMERIC -> number
pg.types.setTypeParser(1700, (v) => Number(v));

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export type Queryable = pg.Pool | pg.PoolClient;

export function createPool(connectionString: string, max = 20): Db {
  const pool = new pg.Pool({ connectionString, max, idleTimeoutMillis: 30_000, application_name: 'among-bugs' });
  pool.on('error', (err) => console.error('[db] idle client error', err.message));
  return pool;
}

const RETRYABLE = new Set(['40001', '40P01']); // serialization_failure, deadlock_detected

/**
 * Runs `fn` in a READ COMMITTED transaction (row locks provide the
 * serialisation we need). Retries on deadlock / serialization failures.
 */
export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '8s'; SET LOCAL statement_timeout = '15s'");
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      const code = (err as { code?: string }).code;
      if (code && RETRYABLE.has(code) && attempt < attempts) {
        await new Promise((r) => setTimeout(r, 15 * attempt + Math.random() * 25));
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

export async function one<T = Record<string, unknown>>(q: Queryable, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const r = await q.query(sql, params);
  return r.rows[0] as T | undefined;
}

export async function many<T = Record<string, unknown>>(q: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await q.query(sql, params);
  return r.rows as T[];
}
