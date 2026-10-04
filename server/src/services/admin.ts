import type { AppConfig } from '../config.js';
import { many, one, type Db, type Queryable, type Tx } from '../db.js';
import { AppError } from '../errors.js';
import { runnerHealth } from '../grading/runnerClient.js';
import { audit, type Actor } from './audit.js';
import { currentDay, getEvent, listDays, type GameRow } from './context.js';
import { getSprints, preflight } from './lifecycle.js';
import { emit, Rooms } from './outbox.js';
import { assignZones, computeStandings } from './ranking.js';
import { revokeAllTeamSessions, revokeSession } from './sessions.js';
import { gameDto, publicStanding, sprintDto } from './snapshot.js';
import { normalizeTeamName, setDayEligibility } from './teams.js';

export async function overview(q: Queryable) {
  const ev = await getEvent(q);
  const days = await listDays(q, ev.id);
  const day = await currentDay(q, ev);
  const games = await many<GameRow>(q, 'SELECT * FROM game WHERE event_id=$1 ORDER BY number', [ev.id]);
  const now = Date.now();
  const out = [];
  for (const g of games) {
    const sprints = await getSprints(q, g.id);
    const next = g.phase === 'WAITING_NEXT_SPRINT' ? 2 : ['DRAFT', 'READY', 'WAITING'].includes(g.phase) ? 1 : null;
    const { active, inactive } = await computeStandings(q, g);
    const cur = sprints.find((s) => s.number === Math.max(1, g.current_sprint));
    const prizes = await many(q, 'SELECT place, label FROM prize_rule WHERE game_id=$1 ORDER BY place', [g.id]);
    const imposters = await many(
      q,
      `SELECT ir.id, ir.label, ir.status, ir.mode, ir.reward, ir.hint_cost, ir.claim_seconds, ir.solve_seconds, ir.released_at, ir.claim_deadline_at, ir.open_deadline_at,
              ir.generation, ir.resolution_note, s.number AS sprint, pv.title, pv.difficulty,
              (SELECT json_build_object('crew', t.name || ' (' || t.crew_id || ')', 'status', r.status, 'solveDeadlineAt', r.solve_deadline_at)
                 FROM imposter_reservation r JOIN game_enrollment ge ON ge.id=r.enrollment_id JOIN team t ON t.id=ge.team_id WHERE r.release_id=ir.id) AS reservation
         FROM imposter_release ir JOIN sprint s ON s.id=ir.sprint_id JOIN problem_version pv ON pv.id=ir.problem_version_id
        WHERE ir.game_id=$1 ORDER BY s.number, ir.created_at`,
      [g.id],
    );
    out.push({
      ...gameDto(g),
      dayId: g.day_id,
      rankingMetricConfirmed: g.ranking_metric_confirmed,
      startingCoins: g.starting_coins,
      recycleEliminatedSolves: g.recycle_eliminated_solves,
      rulesFrozenAt: g.rules_frozen_at,
      sprints: sprints.map((s) => sprintDto(s, now)),
      standings: { active: assignZones(active, ['RUNNING', 'PAUSED'].includes(g.phase) ? cur?.eliminate_count ?? null : null).map((r) => ({ ...publicStanding(r), enrollmentId: r.enrollmentId, teamId: r.teamId, wallet: r.wallet, scoreAdjust: r.scoreAdjust })), inactive: inactive.map((r) => ({ ...publicStanding(r), enrollmentId: r.enrollmentId, teamId: r.teamId, wallet: r.wallet, scoreAdjust: r.scoreAdjust })) },
      preflight: next ? await preflight(q, g.id, next) : null,
      nextSprint: next,
      prizes,
      imposters,
      result: g.phase === 'COMPLETED' ? await one(q, 'SELECT rows, note, confirmed_at FROM game_result WHERE game_id=$1', [g.id]) : null,
    });
  }
  return {
    serverTime: new Date(now).toISOString(),
    event: { id: ev.id, name: ev.name, isDemo: ev.is_demo, timezone: ev.timezone, daySelectionMode: ev.day_selection_mode, manualDayId: ev.manual_day_id, sessionLimit: ev.session_limit, sessionLimitPolicy: ev.session_limit_policy },
    days,
    currentDay: day,
    games: out,
  };
}

export async function updateEventConfig(tx: Tx, actor: Actor, patch: { daySelectionMode?: 'AUTO' | 'MANUAL'; manualDayNumber?: number | null; sessionLimit?: number; sessionLimitPolicy?: 'EVICT_OLDEST' | 'REJECT' }) {
  const ev = await one<{ id: string }>(tx, 'SELECT id FROM event LIMIT 1 FOR UPDATE');
  if (!ev) throw new AppError('NOT_FOUND', 'No event.');
  if (patch.daySelectionMode) await tx.query('UPDATE event SET day_selection_mode=$2 WHERE id=$1', [ev.id, patch.daySelectionMode]);
  if (patch.manualDayNumber !== undefined) {
    const d = patch.manualDayNumber === null ? null : await one<{ id: string }>(tx, 'SELECT id FROM event_day WHERE event_id=$1 AND day_number=$2', [ev.id, patch.manualDayNumber]);
    if (patch.manualDayNumber !== null && !d) throw new AppError('VALIDATION_FAILED', 'Unknown day.');
    await tx.query('UPDATE event SET manual_day_id=$2 WHERE id=$1', [ev.id, d?.id ?? null]);
  }
  if (patch.sessionLimit !== undefined) {
    if (!Number.isInteger(patch.sessionLimit) || patch.sessionLimit < 1 || patch.sessionLimit > 20) throw new AppError('VALIDATION_FAILED', 'Session limit must be 1-20.');
    await tx.query('UPDATE event SET session_limit=$2 WHERE id=$1', [ev.id, patch.sessionLimit]);
  }
  if (patch.sessionLimitPolicy) await tx.query('UPDATE event SET session_limit_policy=$2 WHERE id=$1', [ev.id, patch.sessionLimitPolicy]);
  await tx.query('UPDATE event SET version=version+1 WHERE id=$1', [ev.id]);
  await audit(tx, actor, 'event.config_updated', { type: 'event', id: ev.id }, patch);
  // Day switches change every crew's authorization — tell everyone to resync.
  await emit(tx, 'event.changed', [Rooms.all], { reason: 'EVENT_CONFIG' });
}

export async function crewList(q: Queryable) {
  const ev = await getEvent(q);
  const days = await listDays(q, ev.id);
  const teams = await many<Record<string, unknown>>(
    q,
    `SELECT t.id, t.crew_id, t.name, t.email, t.captain_name, t.color, t.requested_days, t.status, t.created_via, t.created_at, t.must_change_password,
            (SELECT count(*)::int FROM session s WHERE s.team_id=t.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS live_sessions,
            (SELECT json_agg(json_build_object('position', m.position, 'name', m.name, 'institution', m.institution, 'year', m.year, 'branch', m.branch, 'studentId', m.student_id, 'isCaptain', m.is_captain) ORDER BY m.position)
               FROM team_member m WHERE m.team_id=t.id) AS members,
            (SELECT json_object_agg(d.day_number, json_build_object('active', COALESCE(e.active,false), 'checkedInAt', e.checked_in_at))
               FROM event_day d LEFT JOIN team_day_eligibility e ON e.day_id=d.id AND e.team_id=t.id WHERE d.event_id=t.event_id) AS days,
            (SELECT json_agg(json_build_object('id', d.id, 'scope', d.scope, 'gameId', d.game_id, 'reason', d.reason, 'createdAt', d.created_at))
               FROM disqualification d WHERE d.team_id=t.id AND d.revoked_at IS NULL) AS disqualifications
       FROM team t WHERE t.event_id=$1 ORDER BY t.created_at`,
    [ev.id],
  );
  const games = await many<GameRow>(q, 'SELECT * FROM game WHERE event_id=$1 ORDER BY number', [ev.id]);
  const byGame: Record<string, Map<string, ReturnType<typeof publicStanding> & { enrollmentId: string; wallet: number }>> = {};
  for (const g of games) {
    const { active, inactive } = await computeStandings(q, g);
    byGame[g.id] = new Map([...active, ...inactive].map((r) => [r.teamId, { ...publicStanding(r), enrollmentId: r.enrollmentId, wallet: r.wallet }]));
  }
  return {
    days,
    games: games.map((g) => ({ id: g.id, number: g.number, name: g.name, dayId: g.day_id })),
    crews: teams.map((t) => ({
      ...t,
      enrollments: Object.fromEntries(games.map((g) => [g.number, byGame[g.id].get(t.id as string) ?? null])),
    })),
  };
}

export async function bulkEligibility(db: Db, tx: Tx, actor: Actor, args: { teamIds: string[]; dayNumber: number; active: boolean; apply: boolean }) {
  if (!Array.isArray(args.teamIds) || !args.teamIds.length || args.teamIds.length > 500) throw new AppError('VALIDATION_FAILED', 'Select 1-500 crews.');
  const ev = await getEvent(tx);
  const day = await one<{ id: string; day_number: number }>(tx, 'SELECT id, day_number FROM event_day WHERE event_id=$1 AND day_number=$2', [ev.id, args.dayNumber]);
  if (!day) throw new AppError('VALIDATION_FAILED', 'Unknown day.');
  const game = await one<GameRow>(tx, 'SELECT * FROM game WHERE day_id=$1', [day.id]);
  const rows = await many<{ id: string; crew_id: string; name: string; active: boolean }>(
    tx,
    `SELECT t.id, t.crew_id, t.name, COALESCE(e.active,false) AS active FROM team t LEFT JOIN team_day_eligibility e ON e.team_id=t.id AND e.day_id=$2 WHERE t.id = ANY($1)`,
    [args.teamIds, day.id],
  );
  const changing = rows.filter((r) => r.active !== args.active);
  const warnings: string[] = [];
  if (game && !['DRAFT', 'READY', 'WAITING'].includes(game.phase)) {
    warnings.push(args.active
      ? `Game ${game.number} has already started (${game.phase}). Newly enabled crews join mid-game with an empty wallet.`
      : `Game ${game.number} is in progress (${game.phase}). Disabled crews immediately lose access and drop out of standings.`);
  }
  const preview = { day: day.day_number, active: args.active, changes: changing.map((r) => ({ crewId: r.crew_id, name: r.name })), unchanged: rows.length - changing.length, warnings };
  if (!args.apply) return { applied: false, preview };
  for (const r of changing) await setDayEligibility(tx, actor, r.id, day.id, args.active);
  void db;
  return { applied: true, preview };
}

export async function setCheckIn(tx: Tx, actor: Actor, teamId: string, dayNumber: number, checkedIn: boolean) {
  const r = await one(
    tx,
    `UPDATE team_day_eligibility e SET checked_in_at = CASE WHEN $3 THEN now() ELSE NULL END
       FROM event_day d WHERE d.id=e.day_id AND e.team_id=$1 AND d.day_number=$2 RETURNING e.team_id`,
    [teamId, dayNumber, checkedIn],
  );
  if (!r) throw new AppError('NOT_FOUND', 'Crew/day not found.');
  await audit(tx, actor, checkedIn ? 'team.checked_in' : 'team.check_in_cleared', { type: 'team', id: teamId }, { day: dayNumber });
  await emit(tx, 'crews.changed', [Rooms.admin], { teamId });
}

export async function updateTeam(tx: Tx, actor: Actor, teamId: string, patch: { name?: string; color?: string; status?: 'ACTIVE' | 'ARCHIVED' }) {
  const t = await one<{ id: string }>(tx, 'SELECT id FROM team WHERE id=$1 FOR UPDATE', [teamId]);
  if (!t) throw new AppError('NOT_FOUND', 'Crew not found.');
  if (patch.name !== undefined) {
    const name = patch.name.trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 32) throw new AppError('VALIDATION_FAILED', 'Team name must be 2-32 characters.');
    await tx.query('UPDATE team SET name=$2, name_normalized=$3, updated_at=now() WHERE id=$1', [teamId, name, normalizeTeamName(name)]).catch((err: { code?: string }) => {
      if (err.code === '23505') throw new AppError('DUPLICATE_TEAM_NAME', 'That team name is taken.');
      throw err;
    });
  }
  if (patch.color !== undefined) await tx.query('UPDATE team SET color=$2, updated_at=now() WHERE id=$1', [teamId, patch.color]);
  if (patch.status !== undefined) {
    // Archive keeps every scoring record; it only blocks access.
    await tx.query('UPDATE team SET status=$2, updated_at=now() WHERE id=$1', [teamId, patch.status]);
    if (patch.status === 'ARCHIVED') await revokeAllTeamSessions(tx, teamId, 'ARCHIVED');
  }
  await audit(tx, actor, 'team.updated', { type: 'team', id: teamId }, patch);
  await emit(tx, 'crews.changed', [Rooms.admin], { teamId });
  await emit(tx, 'eligibility.changed', [Rooms.team(teamId)], { teamId });
}

export async function listSessions(q: Queryable, teamId: string) {
  return many(q, `SELECT id, created_at, last_seen_at, expires_at, user_agent, ip FROM session WHERE team_id=$1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC`, [teamId]);
}

export async function adminRevokeSession(tx: Tx, actor: Actor, sessionId: string) {
  await revokeSession(tx, sessionId, 'ADMIN_REVOKED');
  await audit(tx, actor, 'session.revoked', { type: 'session', id: sessionId });
}

export async function disqualify(tx: Tx, actor: Actor, args: { teamId: string; scope: 'GAME' | 'EVENT'; gameId?: string; reason: string }) {
  if (!args.reason || args.reason.trim().length < 8) throw new AppError('VALIDATION_FAILED', 'A disqualification reason (min 8 characters) is required.');
  const t = await one<{ id: string; crew_id: string }>(tx, 'SELECT id, crew_id FROM team WHERE id=$1 FOR UPDATE', [args.teamId]);
  if (!t) throw new AppError('NOT_FOUND', 'Crew not found.');
  if (args.scope === 'GAME' && !args.gameId) throw new AppError('VALIDATION_FAILED', 'Choose the game for a game-scoped disqualification.');
  const d = await one<{ id: string }>(
    tx,
    `INSERT INTO disqualification(team_id, game_id, scope, reason, actor_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [args.teamId, args.scope === 'GAME' ? args.gameId : null, args.scope, args.reason.trim(), actor.id],
  );
  const gameIds = args.scope === 'GAME' ? [args.gameId!] : (await many<{ game_id: string }>(tx, 'SELECT game_id FROM game_enrollment WHERE team_id=$1', [args.teamId])).map((r) => r.game_id);
  for (const gid of gameIds) {
    await tx.query(`UPDATE game_enrollment SET status='DISQUALIFIED', active_reservation_id=NULL, version=version+1 WHERE game_id=$1 AND team_id=$2 AND status<>'DISQUALIFIED'`, [gid, args.teamId]);
    await tx.query(`UPDATE run_job SET status='CANCELLED', finished_at=now(), error='Disqualified' WHERE game_id=$1 AND enrollment_id IN (SELECT id FROM game_enrollment WHERE team_id=$2) AND status IN ('QUEUED','RUNNING')`, [gid, args.teamId]);
    // Release any held imposter without award.
    await tx.query(
      `WITH r AS (UPDATE imposter_reservation SET status='CANCELLED', resolved_at=now()
                   WHERE status='ACTIVE' AND enrollment_id IN (SELECT id FROM game_enrollment WHERE game_id=$1 AND team_id=$2) RETURNING release_id)
       UPDATE imposter_release SET status='EXPIRED', resolved_at=now(), resolution_note='HOLDER_DISQUALIFIED' WHERE id IN (SELECT release_id FROM r)`,
      [gid, args.teamId],
    );
    await emit(tx, 'team.disqualified', [Rooms.game(gid), Rooms.admin], { gameId: gid, crewId: t.crew_id });
    await emit(tx, 'standings.updated', [Rooms.game(gid), Rooms.admin], { gameId: gid });
  }
  await emit(tx, 'team.disqualified', [Rooms.team(args.teamId)], { scope: args.scope, you: true });
  await audit(tx, actor, 'team.disqualified', { type: 'team', id: args.teamId }, { scope: args.scope, gameId: args.gameId ?? null, crewId: t.crew_id }, args.reason);
  return { id: d!.id };
}

/** Audited correction: lifts a disqualification. Elimination history is not altered. */
export async function revokeDisqualification(tx: Tx, actor: Actor, dqId: string, reason: string) {
  if (!reason || reason.trim().length < 8) throw new AppError('VALIDATION_FAILED', 'A correction reason (min 8 characters) is required.');
  const d = await one<{ id: string; team_id: string; game_id: string | null; scope: string }>(tx, `UPDATE disqualification SET revoked_at=now(), revoked_by=$2, revoke_reason=$3 WHERE id=$1 AND revoked_at IS NULL RETURNING id, team_id, game_id, scope`, [dqId, actor.id, reason.trim()]);
  if (!d) throw new AppError('NOT_FOUND', 'Active disqualification not found.');
  const remaining = await many<{ scope: string; game_id: string | null }>(tx, 'SELECT scope, game_id FROM disqualification WHERE team_id=$1 AND revoked_at IS NULL', [d.team_id]);
  const enrollments = await many<{ id: string; game_id: string; eliminated_sprint: number | null }>(tx, `SELECT id, game_id, eliminated_sprint FROM game_enrollment WHERE team_id=$1 AND status='DISQUALIFIED'`, [d.team_id]);
  for (const e of enrollments) {
    const still = remaining.some((r) => r.scope === 'EVENT' || r.game_id === e.game_id);
    if (!still) await tx.query(`UPDATE game_enrollment SET status=CASE WHEN eliminated_sprint IS NULL THEN 'ACTIVE' ELSE 'ELIMINATED' END, version=version+1 WHERE id=$1`, [e.id]);
  }
  await audit(tx, actor, 'team.disqualification_revoked', { type: 'team', id: d.team_id }, { dqId }, reason);
  await emit(tx, 'eligibility.changed', [Rooms.team(d.team_id), Rooms.admin], { teamId: d.team_id });
}

export async function announce(tx: Tx, actor: Actor, gameId: string | null, message: string, kind: 'INFO' | 'ALERT' = 'INFO') {
  const m = message?.trim();
  if (!m || m.length > 500) throw new AppError('VALIDATION_FAILED', 'Announcement must be 1-500 characters.');
  const a = await one<{ id: string; created_at: Date }>(tx, 'INSERT INTO announcement(game_id, message, kind, actor_id) VALUES ($1,$2,$3,$4) RETURNING id, created_at', [gameId, m, kind, actor.id]);
  await audit(tx, actor, 'announcement.created', { type: 'announcement', id: a!.id }, { gameId, kind });
  await emit(tx, 'announcement.created', gameId ? [Rooms.game(gameId), Rooms.admin] : [Rooms.all], { id: a!.id, gameId, message: m, kind, createdAt: a!.created_at });
  return a;
}

export async function ledger(q: Queryable, gameId: string, enrollmentId?: string) {
  return many(
    q,
    `SELECT l.id, l.kind, l.wallet_delta, l.earned_delta, l.spent_delta, l.grant_delta, l.score_delta, l.wallet_after, l.source_type, l.reason, l.created_at,
            t.crew_id, t.name AS team_name, a.display_name AS actor
       FROM coin_ledger l JOIN game_enrollment ge ON ge.id=l.enrollment_id JOIN team t ON t.id=ge.team_id
       LEFT JOIN admin_user a ON a.id=l.actor_admin_id
      WHERE l.game_id=$1 AND ($2::uuid IS NULL OR l.enrollment_id=$2)
      ORDER BY l.id DESC LIMIT 500`,
    [gameId, enrollmentId ?? null],
  );
}

export async function auditLog(q: Queryable, limit = 150) {
  return many(
    q,
    `SELECT l.id, l.actor_type, l.action, l.target_type, l.target_id, l.reason, l.details, l.created_at,
            COALESCE(a.display_name, t.name) AS actor_name
       FROM audit_log l LEFT JOIN admin_user a ON a.id=l.actor_id AND l.actor_type='ADMIN' LEFT JOIN team t ON t.id=l.actor_id AND l.actor_type='TEAM'
      ORDER BY l.id DESC LIMIT $1`,
    [Math.min(500, limit)],
  );
}

export async function health(db: Db, cfg: AppConfig, extra: { sockets: number; outboxCursor: number }) {
  const t0 = Date.now();
  let dbOk = true;
  try { await db.query('SELECT 1'); } catch { dbOk = false; }
  const dbMs = Date.now() - t0;
  const hb = await many<{ name: string; age_s: number; info: unknown }>(db, `SELECT name, EXTRACT(EPOCH FROM (now() - beat_at)) AS age_s, info FROM worker_heartbeat`).catch(() => []);
  const outboxMax = (await one<{ m: number }>(db, 'SELECT COALESCE(max(id),0) AS m FROM outbox_event').catch(() => undefined))?.m ?? 0;
  const runner = await runnerHealth(cfg.runner);
  const deadlines = await many(db, `SELECT g.number AS game, s.number AS sprint, s.status, s.deadline_at FROM sprint s JOIN game g ON g.id=s.game_id WHERE s.status IN ('RUNNING','PAUSED')`).catch(() => []);
  return {
    db: { ok: dbOk, latencyMs: dbMs },
    workers: hb.map((h) => ({ name: h.name, ageSeconds: Math.round(Number(h.age_s)), healthy: Number(h.age_s) < 10, info: h.info })),
    outbox: { latestId: outboxMax, deliveredThrough: extra.outboxCursor, lag: Math.max(0, outboxMax - extra.outboxCursor) },
    runner,
    sockets: extra.sockets,
    deadlines,
  };
}

// ---------------------------------------------------------------------------
// CSV exports (formula-injection safe)
// ---------------------------------------------------------------------------

export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(header: string[], rows: unknown[][]): string {
  return [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';
}

export async function exportCsv(q: Queryable, kind: 'standings' | 'ledger' | 'results' | 'crews', gameId?: string): Promise<{ filename: string; csv: string }> {
  if (kind === 'crews') {
    const { crews } = await crewList(q);
    return {
      filename: 'crews.csv',
      csv: toCsv(
        ['crew_id', 'team', 'captain_email', 'requested_days', 'day1_active', 'day2_active', 'members', 'status', 'created_via'],
        crews.map((c0) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const c = c0 as Record<string, any>;
          const days = (c.days ?? {}) as Record<string, { active: boolean }>;
          return [c.crew_id, c.name, c.email, c.requested_days, days['1']?.active ?? false, days['2']?.active ?? false,
            ((c.members ?? []) as { name: string }[]).map((m) => m.name).join('; '), c.status, c.created_via];
        }),
      ),
    };
  }
  const g = await one<GameRow>(q, 'SELECT * FROM game WHERE id=$1', [gameId]);
  if (!g) throw new AppError('NOT_FOUND', 'Game not found.');
  if (kind === 'standings') {
    const { active, inactive } = await computeStandings(q, g);
    return {
      filename: `game${g.number}-standings.csv`,
      csv: toCsv(
        ['rank', 'crew_id', 'team', 'status', `score_${g.ranking_metric.toLowerCase()}`, 'earned', 'spent', 'wallet', 'tasks_solved', 'eliminated_sprint'],
        [...active, ...inactive].map((r) => [r.rank ?? '', r.crewId, r.name, r.status, r.score, r.earned, r.spent, r.wallet, r.tasksSolved, r.eliminatedSprint ?? '']),
      ),
    };
  }
  if (kind === 'ledger') {
    const rows = await ledger(q, g.id);
    return {
      filename: `game${g.number}-ledger.csv`,
      csv: toCsv(['id', 'time', 'crew_id', 'team', 'kind', 'wallet_delta', 'earned_delta', 'spent_delta', 'score_delta', 'wallet_after', 'reason', 'actor'],
        rows.map((r: Record<string, unknown>) => [r.id, r.created_at, r.crew_id, r.team_name, r.kind, r.wallet_delta, r.earned_delta, r.spent_delta, r.score_delta, r.wallet_after, r.reason, r.actor])),
    };
  }
  const res = await one<{ rows: { place: number; crewId: string; name: string; score: number; prize: string | null }[] }>(q, 'SELECT rows FROM game_result WHERE game_id=$1', [g.id]);
  if (!res) throw new AppError('NOT_FOUND', 'Results are not confirmed yet.');
  return { filename: `game${g.number}-results.csv`, csv: toCsv(['place', 'crew_id', 'team', 'score', 'prize'], res.rows.map((r) => [r.place, r.crewId, r.name, r.score, r.prize ?? ''])) };
}
