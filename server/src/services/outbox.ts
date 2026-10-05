import type { Queryable } from '../db.js';

/** Real-time rooms. Membership is decided by the server; a client can never name a room. */
export const Rooms = {
  /** Crews of one slot (private slot data: question state, bonuses, announcements). */
  slot: (slotId: string) => `slot:${slotId}`,
  team: (teamId: string) => `team:${teamId}`,
  organizers: 'organizers',
  /** Read-only projectors: approved standings fields only. */
  display: 'display',
  /** Every authenticated socket. */
  all: 'all',
};

export type Topic =
  | 'eligibility.changed'
  | 'session.revoked'
  | 'event.changed'
  | 'slot.updated'
  | 'slot.finalized'
  | 'event.finalized'
  | 'sprint.started'
  | 'sprint.paused'
  | 'sprint.resumed'
  | 'sprint.closed'
  | 'sprint.finalized'
  | 'question.released'
  | 'question.solved'
  | 'question.expired'
  | 'bonus.released'
  | 'wallet.updated'
  | 'hint.unlocked'
  | 'leaderboard.updated'
  | 'team.eliminated'
  | 'team.disqualified'
  | 'announcement.created'
  | 'teams.changed'
  | 'content.changed';

/**
 * Inserts an event inside the caller's transaction; delivered only after commit.
 * Payloads must never include answers, hints, statements or private crew data
 * when sent to broad rooms (slot / display / all).
 */
export async function emit(q: Queryable, topic: Topic, rooms: string[], payload: Record<string, unknown>) {
  await q.query('INSERT INTO outbox_event(topic, rooms, payload) VALUES ($1, $2, $3)', [topic, rooms, JSON.stringify(payload)]);
}
