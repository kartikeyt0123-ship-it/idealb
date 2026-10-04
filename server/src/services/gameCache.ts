import { many, one, type Queryable } from '../db.js';
import type { GameRow, SprintRow } from './context.js';
import { imposterRaw, type ImposterRaw } from './imposter.js';
import { getSprints } from './lifecycle.js';
import { assignZones, computeStandings, type StandingRow } from './ranking.js';
import { displaySprint, taskRowsForSprint, type TaskRowFull } from './tasks.js';

/**
 * Crew-independent part of the participant snapshot, shared by every crew in a
 * game. Keyed by a cheap "state version" computed from row versions / ledger
 * ids, so a cached entry is reused only while NOTHING relevant has changed —
 * it is never stale. This turns the per-solve refetch burst (every connected
 * device re-reads its snapshot) into one recomputation.
 */
export interface SharedGameState {
  key: string;
  sprints: SprintRow[];
  current: SprintRow | undefined;
  display: SprintRow | undefined;
  standings: { active: StandingRow[]; inactive: StandingRow[] };
  taskRows: TaskRowFull[];
  domains: { slug: string; name: string; room: string; color: string; symbol: string; prefix: string; workspace: string }[];
  announcements: { id: string; message: string; kind: string; created_at: Date }[];
  lastBatch: { sprint: number; ids: string[]; confirmed_at: Date } | undefined;
  result: { rows: unknown[]; confirmed_at: Date } | undefined;
  prizes: { place: number; label: string }[];
  imposter: ImposterRaw | null;
}

const cache = new Map<string, { at: number; data: SharedGameState }>();
const MAX_AGE_MS = 30_000;

async function stateKey(q: Queryable, game: GameRow): Promise<string> {
  const r = await one<Record<string, unknown>>(
    q,
    `SELECT g.version,
            (SELECT COALESCE(max(id), 0) FROM coin_ledger WHERE game_id = g.id) AS lv,
            (SELECT COALESCE(sum(version), 0) FROM game_enrollment WHERE game_id = g.id) AS env,
            (SELECT count(*) FROM game_enrollment WHERE game_id = g.id) AS enc,
            (SELECT COALESCE(sum(version), 0) FROM task_instance WHERE game_id = g.id) AS tv,
            (SELECT COALESCE(sum(version), 0) FROM sprint WHERE game_id = g.id) AS sv,
            (SELECT COALESCE(sum(version), 0) + count(*) FROM imposter_release WHERE game_id = g.id) AS iv,
            (SELECT count(*) FROM imposter_reservation r JOIN imposter_release ir ON ir.id = r.release_id WHERE ir.game_id = g.id) AS rv,
            (SELECT max(updated_at) FROM team_day_eligibility WHERE day_id = g.day_id) AS ev,
            (SELECT max(updated_at) FROM team) AS tmv,
            (SELECT count(*) FROM announcement) AS av,
            (SELECT count(*) + count(revoked_at) FROM disqualification) AS dv,
            (SELECT count(*) FROM prize_rule WHERE game_id = g.id) AS pv
       FROM game g WHERE g.id = $1`,
    [game.id],
  );
  return JSON.stringify(r);
}

export async function sharedGameState(q: Queryable, game: GameRow): Promise<SharedGameState> {
  const key = await stateKey(q, game);
  const hit = cache.get(game.id);
  if (hit && hit.data.key === key && Date.now() - hit.at < MAX_AGE_MS) return hit.data;
  const sprints = await getSprints(q, game.id);
  const current = sprints.find((s) => s.number === Math.max(1, game.current_sprint));
  const display = await displaySprint(q, game);
  const [standings, taskRows, domains, announcements, lastBatch, result, prizes, imposter] = await Promise.all([
    computeStandings(q, game),
    display ? taskRowsForSprint(q, display.id) : Promise.resolve([]),
    many<SharedGameState['domains'][number]>(q, 'SELECT slug, name, room, color, symbol, prefix, workspace FROM domain ORDER BY sort'),
    many<SharedGameState['announcements'][number]>(q, `SELECT id, message, kind, created_at FROM announcement WHERE game_id=$1 OR game_id IS NULL ORDER BY created_at DESC LIMIT 12`, [game.id]),
    one<NonNullable<SharedGameState['lastBatch']>>(
      q,
      `SELECT s.number AS sprint, eb.eliminated_enrollment_ids AS ids, eb.confirmed_at FROM elimination_batch eb JOIN sprint s ON s.id=eb.sprint_id
        WHERE eb.game_id=$1 ORDER BY eb.confirmed_at DESC LIMIT 1`,
      [game.id],
    ),
    game.phase === 'COMPLETED' ? one<NonNullable<SharedGameState['result']>>(q, 'SELECT rows, confirmed_at FROM game_result WHERE game_id=$1', [game.id]) : Promise.resolve(undefined),
    many<{ place: number; label: string }>(q, 'SELECT place, label FROM prize_rule WHERE game_id=$1 ORDER BY place', [game.id]),
    imposterRaw(q, game),
  ]);
  const zoned = { active: assignZones(standings.active, ['RUNNING', 'PAUSED'].includes(game.phase) ? current?.eliminate_count ?? null : null), inactive: standings.inactive };
  const data: SharedGameState = { key, sprints, current, display, standings: zoned, taskRows, domains, announcements, lastBatch, result, prizes, imposter };
  cache.set(game.id, { at: Date.now(), data });
  return data;
}
