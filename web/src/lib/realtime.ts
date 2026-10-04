import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { syncClock } from './api';

export const TOPICS = [
  'eligibility.changed', 'session.revoked', 'event.changed', 'game.updated', 'sprint.started', 'sprint.paused', 'sprint.resumed',
  'sprint.closed', 'task.available', 'task.solved', 'task.reopened', 'wallet.updated', 'hint.unlocked', 'standings.updated',
  'imposter.offered', 'imposter.reserved', 'imposter.expired', 'imposter.solved', 'imposter.cancelled', 'team.eliminated',
  'team.disqualified', 'game.completed', 'announcement.created', 'crews.changed', 'content.changed',
] as const;
export type Topic = (typeof TOPICS)[number];
export type ConnState = 'connecting' | 'online' | 'reconnecting' | 'offline';

/**
 * One authenticated socket per signed-in browser tab. Rooms are assigned by the
 * server. Messages may be missed or duplicated, so every handler should treat
 * them as "something changed" hints and re-fetch the authorised snapshot;
 * `onReconnect` fires after every (re)connect for a full resync.
 */
export function useRealtime(enabled: boolean, onEvent: (topic: Topic, msg: Record<string, unknown>) => void, onReconnect: () => void) {
  const [state, setState] = useState<ConnState>('connecting');
  const handler = useRef(onEvent);
  const reconnect = useRef(onReconnect);
  handler.current = onEvent;
  reconnect.current = onReconnect;

  useEffect(() => {
    if (!enabled) return;
    const seen = new Set<number>();
    const socket: Socket = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'], reconnectionDelayMax: 8000 });
    socket.on('connect', () => setState('online'));
    socket.on('hello', (m: { serverTime: string }) => {
      syncClock(m.serverTime);
      reconnect.current();
    });
    socket.on('disconnect', () => setState('reconnecting'));
    socket.io.on('reconnect_attempt', () => setState('reconnecting'));
    socket.on('connect_error', () => setState(socket.active ? 'reconnecting' : 'offline'));
    for (const t of TOPICS) {
      socket.on(t, (msg: Record<string, unknown>) => {
        const id = msg?.eventId as number | undefined;
        if (id !== undefined) {
          if (seen.has(id)) return; // duplicate delivery
          seen.add(id);
          if (seen.size > 2000) seen.clear();
        }
        if (typeof msg?.serverTime === 'string') syncClock(msg.serverTime);
        handler.current(t, msg ?? {});
      });
    }
    return () => {
      socket.close();
    };
  }, [enabled]);
  return state;
}
