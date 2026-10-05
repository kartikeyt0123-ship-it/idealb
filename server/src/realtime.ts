import type { Server as HttpServer } from 'node:http';
import pg from 'pg';
import { Server, type Socket } from 'socket.io';
import { originAllowed, type AppConfig } from './config.js';
import type { Db } from './db.js';
import { resolveCrew } from './services/context.js';
import { Rooms } from './services/outbox.js';
import { DISPLAY_COOKIE, resolveSession, SESSION_COOKIE } from './services/sessions.js';

interface SocketData {
  sessionId: string;
  actorType: 'TEAM' | 'ORGANIZER' | 'DISPLAY';
  teamId?: string;
  organizerId?: string;
  slotRoom?: string;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/**
 * Socket.IO is a delivery mechanism only. Room membership is decided here,
 * from the server-side session and current eligibility — a client asking for
 * a room name gets nothing. Every event carries serverTime and the outbox id
 * so clients can drop duplicates; clients always re-fetch an authorised
 * snapshot after reconnecting.
 */
export class Realtime {
  readonly io: Server;
  private cursor = 0;
  private listener?: pg.Client;
  private pollTimer?: NodeJS.Timeout;
  private revalidateTimer?: NodeJS.Timeout;
  private draining = false;
  private pending = false;
  private stopped = false;

  constructor(httpServer: HttpServer, private readonly db: Db, private readonly cfg: AppConfig) {
    this.io = new Server(httpServer, {
      path: '/socket.io',
      serveClient: false,
      cors: { origin: cfg.allowedOrigins, credentials: true },
      pingInterval: 20_000,
      pingTimeout: 20_000,
      maxHttpBufferSize: 16 * 1024,
    });
    this.io.use(async (socket, next) => {
      try {
        if (!originAllowed(this.cfg, socket.handshake.headers.origin, socket.handshake.headers.host)) return next(new Error('ORIGIN_NOT_ALLOWED'));
        // A projector connects with ?display=1 and its display cookie; everyone else with the main session cookie.
        const wantsDisplay = socket.handshake.query?.display === '1';
        const token = readCookie(socket.handshake.headers.cookie, wantsDisplay ? DISPLAY_COOKIE : SESSION_COOKIE);
        const s = await resolveSession(this.db, this.cfg, token);
        if (!s || (s.session.actor_type === 'DISPLAY') !== wantsDisplay) return next(new Error('UNAUTHENTICATED'));
        const data: SocketData = { sessionId: s.session.id, actorType: s.session.actor_type, teamId: s.team?.id, organizerId: s.organizer?.id };
        socket.data = data;
        next();
      } catch {
        next(new Error('UNAVAILABLE'));
      }
    });
    this.io.on('connection', (socket) => this.onConnection(socket));
  }

  get socketCount() {
    return this.io.engine.clientsCount;
  }
  get deliveredThrough() {
    return this.cursor;
  }

  private async onConnection(socket: Socket) {
    const d = socket.data as SocketData;
    await socket.join(Rooms.all);
    if (d.actorType === 'ORGANIZER') await socket.join(Rooms.organizers);
    if (d.actorType === 'DISPLAY') await socket.join(Rooms.display);
    if (d.teamId) {
      await socket.join(Rooms.team(d.teamId));
      await this.syncSlotRoom(socket);
    }
    socket.emit('hello', { serverTime: new Date().toISOString(), deliveredThrough: this.cursor });
    // Clients may ask the server to re-evaluate membership (e.g. after a status change). They cannot name rooms.
    socket.on('resync', async (ack?: (r: unknown) => void) => {
      const ok = await this.revalidate(socket);
      if (ok) await this.syncSlotRoom(socket);
      if (typeof ack === 'function') ack({ ok, slotRoom: Boolean((socket.data as SocketData).slotRoom) });
    });
  }

  /** Join the crew's own slot room only while it is authorised for it (enabled, assigned, not disqualified). */
  private async syncSlotRoom(socket: Socket) {
    const d = socket.data as SocketData;
    if (!d.teamId) return;
    let room: string | undefined;
    try {
      const ctx = await resolveCrew(this.db, d.teamId);
      room = Rooms.slot(ctx.slot.id);
    } catch {
      room = undefined;
    }
    for (const r of socket.rooms) if (r.startsWith('slot:') && r !== room) await socket.leave(r);
    if (room) await socket.join(room);
    d.slotRoom = room;
  }

  private async revalidate(socket: Socket): Promise<boolean> {
    const d = socket.data as SocketData;
    const r = await this.db.query(
      `SELECT s.revoked_at, s.expires_at, o.active AS organizer_active, dl.revoked_at AS link_revoked
         FROM session s LEFT JOIN organizer_user o ON o.id=s.organizer_id LEFT JOIN display_link dl ON dl.id=s.display_link_id WHERE s.id=$1`,
      [d.sessionId],
    );
    const row = r.rows[0];
    const ok = row && !row.revoked_at && new Date(row.expires_at).getTime() > Date.now() && (d.actorType !== 'ORGANIZER' || row.organizer_active) && !row.link_revoked;
    if (!ok) {
      socket.emit('session.revoked', { reason: 'SESSION_ENDED' });
      socket.disconnect(true);
    }
    return !!ok;
  }

  async start() {
    const max = await this.db.query('SELECT COALESCE(max(id), 0) AS m FROM outbox_event');
    this.cursor = Number(max.rows[0].m);
    try {
      this.listener = new pg.Client({ connectionString: this.cfg.databaseUrl });
      await this.listener.connect();
      this.listener.on('notification', () => void this.drain());
      this.listener.on('error', () => undefined);
      await this.listener.query('LISTEN outbox');
    } catch (err) {
      console.warn('[realtime] LISTEN unavailable, polling only:', (err as Error).message);
    }
    this.pollTimer = setInterval(() => void this.drain(), 1000);
    this.revalidateTimer = setInterval(() => void this.revalidateAll(), 15_000);
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.pollTimer);
    clearInterval(this.revalidateTimer);
    await this.listener?.end().catch(() => undefined);
    await new Promise<void>((r) => this.io.close(() => r()));
  }

  private async revalidateAll() {
    for (const [, socket] of this.io.sockets.sockets) {
      await this.revalidate(socket).catch(() => undefined);
    }
  }

  /** Delivers committed outbox rows in id order. Duplicate delivery is tolerated by clients. */
  async drain() {
    if (this.stopped) return;
    if (this.draining) {
      this.pending = true;
      return;
    }
    this.draining = true;
    try {
      do {
        this.pending = false;
        const r = await this.db.query('SELECT id, topic, rooms, payload, created_at FROM outbox_event WHERE id > $1 ORDER BY id LIMIT 500', [this.cursor]);
        for (const ev of r.rows as { id: number; topic: string; rooms: string[]; payload: Record<string, unknown>; created_at: Date }[]) {
          await this.deliver(ev);
          this.cursor = Number(ev.id);
        }
        if (r.rows.length === 500) this.pending = true;
      } while (this.pending && !this.stopped);
    } catch (err) {
      console.error('[realtime] outbox drain failed:', (err as Error).message);
    } finally {
      this.draining = false;
    }
  }

  private async deliver(ev: { id: number; topic: string; rooms: string[]; payload: Record<string, unknown>; created_at: Date }) {
    const msg = { ...ev.payload, eventId: ev.id, serverTime: new Date().toISOString() };
    if (ev.topic === 'session.revoked') {
      const ids = new Set((ev.payload.sessionIds as string[]) ?? []);
      for (const [, s] of this.io.sockets.sockets) {
        if (ids.has((s.data as SocketData).sessionId)) {
          s.emit('session.revoked', msg);
          s.disconnect(true);
        }
      }
      return;
    }
    // Membership changes first, so a crew that just lost eligibility misses the private game events.
    if (ev.topic === 'eligibility.changed' || ev.topic === 'teams.changed' || ev.topic === 'event.changed') {
      const broad = ev.topic === 'eligibility.changed' && ev.rooms.some((r) => !r.startsWith('team:') && r !== Rooms.organizers);
      const teamRooms = broad ? [...this.io.sockets.adapter.rooms.keys()].filter((r) => r.startsWith('team:')) : ev.topic === 'teams.changed' ? (typeof ev.payload.teamId === 'string' ? [Rooms.team(ev.payload.teamId)] : [...this.io.sockets.adapter.rooms.keys()].filter((r) => r.startsWith('team:'))) : ev.rooms.filter((r) => r.startsWith('team:'));
      const targets = ev.topic === 'event.changed' ? [...this.io.sockets.sockets.values()] : teamRooms.length ? await this.io.in(teamRooms).fetchSockets() : [];
      for (const s of targets) {
        const sock = this.io.sockets.sockets.get(s.id);
        if (sock) await this.syncSlotRoom(sock);
      }
    }
    this.io.to(ev.rooms).emit(ev.topic, msg);
  }
}
