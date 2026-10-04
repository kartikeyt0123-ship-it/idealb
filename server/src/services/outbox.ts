import type { Queryable } from '../db.js';

/** Real-time rooms. Membership is decided by the server at connect / on eligibility change. */
export const Rooms = {
  game: (gameId: string) => `game:${gameId}`,
  team: (teamId: string) => `team:${teamId}`,
  admin: 'admin',
  /** Every authenticated socket (used for event-wide notices). */
  all: 'all',
};

export type Topic =
  | 'eligibility.changed'
  | 'session.revoked'
  | 'event.changed'
  | 'game.updated'
  | 'sprint.started'
  | 'sprint.paused'
  | 'sprint.resumed'
  | 'sprint.closed'
  | 'task.available'
  | 'task.solved'
  | 'task.reopened'
  | 'wallet.updated'
  | 'hint.unlocked'
  | 'standings.updated'
  | 'imposter.offered'
  | 'imposter.reserved'
  | 'imposter.expired'
  | 'imposter.solved'
  | 'imposter.cancelled'
  | 'team.eliminated'
  | 'team.disqualified'
  | 'game.completed'
  | 'announcement.created'
  | 'crews.changed'
  | 'content.changed';

/**
 * Inserts an event inside the caller's transaction. It is delivered only after
 * commit (dispatcher reads committed rows). Payloads must never include answer
 * keys, hints or another team's private data when sent to broad rooms.
 */
export async function emit(q: Queryable, topic: Topic, rooms: string[], payload: Record<string, unknown>) {
  await q.query('INSERT INTO outbox_event(topic, rooms, payload) VALUES ($1, $2, $3)', [topic, rooms, JSON.stringify(payload)]);
}
