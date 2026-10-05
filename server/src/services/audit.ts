import type { Queryable } from '../db.js';

export interface Actor {
  type: 'ORGANIZER' | 'TEAM' | 'SYSTEM';
  id: string | null;
}

export const SYSTEM: Actor = { type: 'SYSTEM', id: null };

export async function audit(
  q: Queryable,
  actor: Actor,
  action: string,
  target: { type?: string; id?: string | null } = {},
  details: Record<string, unknown> = {},
  reason?: string | null,
) {
  await q.query(
    `INSERT INTO audit_log(actor_type, actor_id, action, target_type, target_id, reason, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [actor.type, actor.id, action, target.type ?? null, target.id ?? null, reason ?? null, JSON.stringify(details)],
  );
}
