import { many, one, type Queryable, type Tx } from '../db.js';
import { AppError } from '../errors.js';
import { audit, type Actor } from './audit.js';
import type { GameRow, SprintRow } from './context.js';
import { emit, Rooms } from './outbox.js';
import { assignRanks, computeStandings, eliminationPreview, type StandingRow } from './ranking.js';

export const PRESETS = {
  STANDARD: { sprintSeconds: 1800, imposterClaim: 60, imposterSolve: 480 },
  REHEARSAL: { sprintSeconds: 120, imposterClaim: 20, imposterSolve: 70 },
} as const;

export async function lockGame(tx: Tx, gameId: string): Promise<GameRow> {
  const g = await one<GameRow>(tx, 'SELECT * FROM game WHERE id=$1 FOR UPDATE', [gameId]);
  if (!g) throw new AppError('NOT_FOUND', 'Game not found.');
  return g;
}

function checkVersion(g: GameRow, expected: number | undefined) {
  if (expected !== undefined && expected !== g.version) {
    throw new AppError('STALE_VERSION', 'The game changed since you loaded it. Review the latest state and try again.', { currentVersion: g.version });
  }
}

async function bumpGame(tx: Tx, gameId: string, fields: Record<string, unknown>): Promise<GameRow> {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k}=$${i + 2}`).join(', ');
  return (await one<GameRow>(tx, `UPDATE game SET ${sets}${keys.length ? ',' : ''} version=version+1, updated_at=now() WHERE id=$1 RETURNING *`, [gameId, ...keys.map((k) => fields[k])]))!;
}

export async function getSprints(q: Queryable, gameId: string): Promise<SprintRow[]> {
  return many<SprintRow>(q, 'SELECT * FROM sprint WHERE game_id=$1 ORDER BY number', [gameId]);
}

// ---------------------------------------------------------------------------
// Configuration (editable until the relevant sprint starts)
// ---------------------------------------------------------------------------

export interface GameConfigPatch {
  rankingMetric?: 'NET_COINS' | 'GROSS_EARNED';
  rankingMetricConfirmed?: boolean;
  durationPreset?: 'STANDARD' | 'REHEARSAL';
  sprintDurations?: { sprint: number; seconds: number }[];
  eliminateCounts?: { sprint: number; count: number | null }[];
  imposterMode?: 'RESERVE' | 'OPEN';
  imposterBlocksRegular?: boolean;
  recycleEliminatedSolves?: boolean;
  startingCoins?: number;
  prizes?: { place: number; label: string }[];
  dayNumber?: number;
}

export async function updateGameConfig(tx: Tx, actor: Actor, gameId: string, patch: GameConfigPatch, expectedVersion?: number) {
  const g = await lockGame(tx, gameId);
  checkVersion(g, expectedVersion);
  const sprints = await getSprints(tx, gameId);
  const started = g.rules_frozen_at !== null;
  const changes: Record<string, unknown> = {};
  const notes: string[] = [];
  const preStartOnly = (what: string) => {
    if (started) throw new AppError('INVALID_TRANSITION', `${what} is frozen once Sprint 1 has started.`);
  };
  if (patch.rankingMetric !== undefined || patch.rankingMetricConfirmed !== undefined) {
    preStartOnly('The ranking rule');
    if (patch.rankingMetric) changes.ranking_metric = patch.rankingMetric;
    changes.ranking_metric_confirmed = patch.rankingMetricConfirmed ?? (patch.rankingMetric ? false : g.ranking_metric_confirmed);
  }
  if (patch.imposterMode !== undefined) { preStartOnly('Imposter mode'); changes.imposter_mode = patch.imposterMode; }
  if (patch.imposterBlocksRegular !== undefined) { preStartOnly('Imposter exclusivity'); changes.imposter_blocks_regular = patch.imposterBlocksRegular; }
  if (patch.recycleEliminatedSolves !== undefined) {
    if (sprints.find((s) => s.number === 2)?.status !== 'PENDING') throw new AppError('INVALID_TRANSITION', 'Recycling policy is frozen once Sprint 2 has started.');
    changes.recycle_eliminated_solves = patch.recycleEliminatedSolves;
  }
  if (patch.startingCoins !== undefined) {
    preStartOnly('Starting coins');
    if (!Number.isInteger(patch.startingCoins) || patch.startingCoins < 0 || patch.startingCoins > 100000) throw new AppError('VALIDATION_FAILED', 'Starting coins must be a non-negative integer.');
    changes.starting_coins = patch.startingCoins;
    notes.push('Starting coins apply to crews enrolled after this change.');
  }
  if (patch.dayNumber !== undefined) {
    preStartOnly('The day mapping');
    const day = await one<{ id: string }>(tx, 'SELECT d.id FROM event_day d JOIN game g ON g.event_id=d.event_id WHERE g.id=$1 AND d.day_number=$2', [gameId, patch.dayNumber]);
    if (!day) throw new AppError('VALIDATION_FAILED', 'Unknown day.');
    const clash = await one(tx, 'SELECT id FROM game WHERE day_id=$1 AND id<>$2', [day.id, gameId]);
    if (clash) throw new AppError('CONFLICT', 'Another game is already mapped to that day.');
    changes.day_id = day.id;
  }
  if (patch.durationPreset) {
    const p = PRESETS[patch.durationPreset];
    changes.duration_preset = patch.durationPreset;
    const pending = sprints.filter((s) => s.status === 'PENDING');
    for (const s of pending) {
      await tx.query('UPDATE sprint SET duration_seconds=$2, version=version+1 WHERE id=$1', [s.id, p.sprintSeconds]);
      await tx.query(`UPDATE imposter_release SET claim_seconds=$2, solve_seconds=$3, version=version+1 WHERE sprint_id=$1 AND status='DRAFT'`, [s.id, p.imposterClaim, p.imposterSolve]);
    }
    const untouched = sprints.filter((s) => s.status !== 'PENDING').map((s) => s.number);
    notes.push(`Preset ${patch.durationPreset} applied to pending sprint(s) ${pending.map((s) => s.number).join(', ') || 'none'}.`);
    if (untouched.length) notes.push(`Sprint(s) ${untouched.join(', ')} already started — not changed.`);
  }
  for (const d of patch.sprintDurations ?? []) {
    const s = sprints.find((x) => x.number === d.sprint);
    if (!s) throw new AppError('VALIDATION_FAILED', `Unknown sprint ${d.sprint}.`);
    if (s.status !== 'PENDING') throw new AppError('INVALID_TRANSITION', `Sprint ${d.sprint} already started; its duration cannot be edited.`);
    if (!Number.isInteger(d.seconds) || d.seconds < 30 || d.seconds > 6 * 3600) throw new AppError('VALIDATION_FAILED', 'Duration must be 30 seconds to 6 hours.');
    await tx.query('UPDATE sprint SET duration_seconds=$2, version=version+1 WHERE id=$1', [s.id, d.seconds]);
    changes.duration_preset = 'CUSTOM';
  }
  for (const c of patch.eliminateCounts ?? []) {
    const s = sprints.find((x) => x.number === c.sprint);
    if (!s) throw new AppError('VALIDATION_FAILED', `Unknown sprint ${c.sprint}.`);
    if (s.status !== 'PENDING') throw new AppError('INVALID_TRANSITION', `Sprint ${c.sprint} already started; its elimination count is frozen.`);
    if (c.count !== null && (!Number.isInteger(c.count) || c.count < 0)) throw new AppError('VALIDATION_FAILED', 'Elimination count must be a non-negative integer.');
    await tx.query('UPDATE sprint SET eliminate_count=$2, version=version+1 WHERE id=$1', [s.id, c.count]);
  }
  if (patch.prizes) {
    if (g.phase === 'COMPLETED') throw new AppError('INVALID_TRANSITION', 'Results are confirmed; prizes are frozen.');
    if (patch.prizes.length > 10) throw new AppError('VALIDATION_FAILED', 'At most 10 prize places.');
    const places = patch.prizes.map((p) => p.place).sort((a, b) => a - b);
    if (places.some((p, i) => p !== i + 1)) throw new AppError('VALIDATION_FAILED', 'Prize places must be 1..N without gaps.');
    for (const p of patch.prizes) if (!p.label?.trim() || p.label.length > 120) throw new AppError('VALIDATION_FAILED', 'Each prize needs a label (max 120 chars).');
    await tx.query('DELETE FROM prize_rule WHERE game_id=$1', [gameId]);
    for (const p of patch.prizes) await tx.query('INSERT INTO prize_rule(game_id, place, label) VALUES ($1,$2,$3)', [gameId, p.place, p.label.trim()]);
    changes.prize_places = patch.prizes.length;
  }
  const updated = await bumpGame(tx, gameId, changes);
  await audit(tx, actor, 'game.config_updated', { type: 'game', id: gameId }, { patch, notes });
  await emit(tx, 'game.updated', [Rooms.game(gameId), Rooms.admin], { gameId, version: updated.version });
  return { game: updated, notes };
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

export interface Preflight {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  summary: string[];
  activeCount: number;
  plan: { sprint: number; active: number; eliminate: number | null; survive: number | null }[];
}

export async function preflight(q: Queryable, gameId: string, sprintNumber: number): Promise<Preflight> {
  const g = await one<GameRow>(q, 'SELECT * FROM game WHERE id=$1', [gameId]);
  if (!g) throw new AppError('NOT_FOUND', 'Game not found.');
  const sprints = await getSprints(q, gameId);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const summary: string[] = [];
  if (!g.day_id) blockers.push('Map this game to an event day.');
  if (!g.ranking_metric_confirmed) blockers.push(`Confirm the ranking rule (${g.ranking_metric === 'NET_COINS' ? 'net IdeaCoins' : 'gross earned'}) before starting.`);
  const { active } = await computeStandings(q, g);
  const n = active.length;
  if (n === 0) blockers.push('No active, day-eligible crews are enrolled in this game.');
  const plan: Preflight['plan'] = [];
  let remaining = n;
  for (const s of sprints) {
    if (s.number < sprintNumber) continue;
    const k = s.eliminate_count;
    if (k === null) {
      blockers.push(`Configure the elimination count for Sprint ${s.number}.`);
      plan.push({ sprint: s.number, active: remaining, eliminate: null, survive: null });
      continue;
    }
    const survive = remaining - k;
    plan.push({ sprint: s.number, active: remaining, eliminate: k, survive });
    summary.push(`Sprint ${s.number}: ${remaining} active → eliminate ${k} → ${survive} survive`);
    if (k === 0) warnings.push(`Sprint ${s.number} eliminates nobody (K=0). This departs from the planned format and requires explicit acknowledgement.`);
    if (survive < 1) blockers.push(`Sprint ${s.number}: eliminating ${k} of ${remaining} leaves no survivor. Reduce the count.`);
    if (s.number === 2 && survive >= 1 && survive < Math.max(1, g.prize_places)) {
      blockers.push(`After the final sprint only ${survive} crew(s) survive, but ${g.prize_places} prize place(s) are configured. Reduce eliminations or prize places.`);
    }
    remaining = Math.max(0, survive);
  }
  const target = sprints.find((s) => s.number === sprintNumber);
  if (target) {
    const tasks = await one<{ n: number }>(q, `SELECT count(*)::int AS n FROM task_instance WHERE sprint_id=$1 AND status<>'DISABLED'`, [target.id]);
    if (!tasks?.n) blockers.push(`No regular tasks are assigned to Sprint ${sprintNumber}.`);
    else {
      summary.push(`Sprint ${sprintNumber}: ${tasks.n} regular task(s) for ${n} crew(s); each task has exactly one winner.`);
      if (tasks.n < n) warnings.push(`Task pool (${tasks.n}) is smaller than the number of crews (${n}); many crews may finish with zero. Consider adding tasks.`);
    }
    if (n > 1) warnings.push('Zero-score ties are plausible with a small globally claimable pool; elimination will stop for an explicit tie decision if one crosses the cutoff.');
    const badImposters = await many<{ label: string; claim_seconds: number; solve_seconds: number }>(
      q, `SELECT label, claim_seconds, solve_seconds FROM imposter_release WHERE sprint_id=$1 AND status='DRAFT'`, [target.id],
    );
    for (const b of badImposters) {
      if (b.claim_seconds + b.solve_seconds > target.duration_seconds) {
        blockers.push(`Imposter ${b.label}: claim ${b.claim_seconds}s + solve ${b.solve_seconds}s exceeds the ${target.duration_seconds}s sprint. Adjust it or apply a preset.`);
      }
    }
    summary.push(`Sprint ${sprintNumber} duration: ${Math.round(target.duration_seconds / 60 * 10) / 10} min (${g.duration_preset === 'REHEARSAL' ? 'REHEARSAL preset' : g.duration_preset === 'STANDARD' ? 'standard preset' : 'custom'}).`);
  }
  if (sprintNumber === 2) summary.push(`Eliminated-solve recycling: ${g.recycle_eliminated_solves ? 'ENABLED — solves by ejected crews reopen in Sprint 2' : 'disabled — Sprint 2 uses its own fresh tasks'}.`);
  return { ok: blockers.length === 0, blockers, warnings, summary, activeCount: n, plan };
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export async function startSprint(
  tx: Tx,
  actor: Actor,
  gameId: string,
  sprintNumber: number,
  opts: { expectedVersion?: number; acknowledgeZeroElimination?: boolean },
) {
  const g = await lockGame(tx, gameId);
  checkVersion(g, opts.expectedVersion);
  if (sprintNumber === 1 && !['DRAFT', 'READY', 'WAITING'].includes(g.phase)) throw new AppError('INVALID_TRANSITION', `Sprint 1 cannot start while the game is ${g.phase}.`);
  if (sprintNumber === 2 && g.phase !== 'WAITING_NEXT_SPRINT') throw new AppError('INVALID_TRANSITION', `Sprint 2 can only be activated after Sprint 1 eliminations are confirmed (game is ${g.phase}).`);
  const s = await one<SprintRow>(tx, 'SELECT * FROM sprint WHERE game_id=$1 AND number=$2 FOR UPDATE', [gameId, sprintNumber]);
  if (!s || s.status !== 'PENDING') throw new AppError('INVALID_TRANSITION', `Sprint ${sprintNumber} is not pending.`);
  const pf = await preflight(tx, gameId, sprintNumber);
  if (!pf.ok) throw new AppError('PREFLIGHT_FAILED', 'Preflight checks failed.', { preflight: pf });
  if (s.eliminate_count === 0 && !opts.acknowledgeZeroElimination) {
    throw new AppError('PREFLIGHT_FAILED', 'This sprint eliminates nobody. Confirm that this is an explicit organizer decision.', { preflight: pf, needsZeroAck: true });
  }
  let recycled = 0;
  if (sprintNumber === 2 && g.recycle_eliminated_solves) {
    const r = await tx.query(
      `UPDATE task_instance ti
          SET sprint_id=$2, generation=generation+1, status='AVAILABLE', solved_by_enrollment_id=NULL, solved_at=NULL,
              label = regexp_replace(label, 'R[0-9]+$', '') || 'R' || (generation+1), version=version+1
         FROM sprint s1, game_enrollment ge
        WHERE s1.game_id=$1 AND s1.number=1 AND ti.sprint_id=s1.id AND ti.status='SOLVED'
          AND ge.id=ti.solved_by_enrollment_id AND ge.status='ELIMINATED'
        RETURNING ti.id`,
      [gameId, s.id],
    );
    recycled = r.rowCount ?? 0;
  }
  const started = await one<SprintRow>(
    tx,
    `UPDATE sprint SET status='RUNNING', started_at=clock_timestamp(), deadline_at=clock_timestamp() + make_interval(secs => duration_seconds),
            version=version+1 WHERE id=$1 RETURNING *`,
    [s.id],
  );
  await tx.query(`UPDATE task_instance SET version=version WHERE sprint_id=$1`, [s.id]);
  const updated = await bumpGame(tx, gameId, {
    phase: 'RUNNING',
    current_sprint: sprintNumber,
    ...(sprintNumber === 1 ? { rules_frozen_at: new Date() } : {}),
  });
  await audit(tx, actor, 'sprint.started', { type: 'game', id: gameId }, { sprint: sprintNumber, deadlineAt: started!.deadline_at, recycled, preflight: pf.summary });
  await emit(tx, 'sprint.started', [Rooms.game(gameId), Rooms.admin], { gameId, sprint: sprintNumber, startedAt: started!.started_at, deadlineAt: started!.deadline_at, version: updated.version });
  if (recycled) await emit(tx, 'task.reopened', [Rooms.game(gameId), Rooms.admin], { gameId, count: recycled });
  return { game: updated, sprint: started!, recycled };
}

export async function pauseSprint(tx: Tx, actor: Actor, gameId: string, expectedVersion?: number) {
  const g = await lockGame(tx, gameId);
  checkVersion(g, expectedVersion);
  if (g.phase !== 'RUNNING') throw new AppError('INVALID_TRANSITION', 'Only a running sprint can be paused.');
  const s = await one<SprintRow>(tx, `UPDATE sprint SET status='PAUSED', paused_at=clock_timestamp(), version=version+1 WHERE game_id=$1 AND number=$2 AND status='RUNNING' RETURNING *`, [gameId, g.current_sprint]);
  if (!s) throw new AppError('INVALID_TRANSITION', 'Sprint is not running.');
  if (new Date(s.paused_at!).getTime() >= new Date(s.deadline_at!).getTime()) throw new AppError('SPRINT_CLOSED', 'The deadline has already passed; the sprint is closing.');
  const updated = await bumpGame(tx, gameId, { phase: 'PAUSED' });
  await audit(tx, actor, 'sprint.paused', { type: 'game', id: gameId }, { sprint: s.number });
  await emit(tx, 'sprint.paused', [Rooms.game(gameId), Rooms.admin], { gameId, sprint: s.number, pausedAt: s.paused_at, version: updated.version });
  return { game: updated, sprint: s };
}

/** Resumes and shifts every sprint / imposter deadline by the paused duration. */
export async function resumeSprint(tx: Tx, actor: Actor, gameId: string, expectedVersion?: number) {
  const g = await lockGame(tx, gameId);
  checkVersion(g, expectedVersion);
  if (g.phase !== 'PAUSED') throw new AppError('INVALID_TRANSITION', 'The sprint is not paused.');
  const s = await one<SprintRow & { delta_ms: number }>(
    tx,
    `SELECT *, EXTRACT(EPOCH FROM (clock_timestamp() - paused_at)) * 1000 AS delta_ms FROM sprint WHERE game_id=$1 AND number=$2 AND status='PAUSED' FOR UPDATE`,
    [gameId, g.current_sprint],
  );
  if (!s) throw new AppError('INVALID_TRANSITION', 'Sprint is not paused.');
  const delta = Math.max(0, Math.round(s.delta_ms));
  const resumed = await one<SprintRow>(
    tx,
    `UPDATE sprint SET status='RUNNING', deadline_at = deadline_at + make_interval(secs => $2::double precision / 1000),
            paused_total_ms = paused_total_ms + $2, paused_at=NULL, version=version+1 WHERE id=$1 RETURNING *`,
    [s.id, delta],
  );
  await tx.query(
    `UPDATE imposter_release SET claim_deadline_at = claim_deadline_at + make_interval(secs => $2::double precision / 1000),
            open_deadline_at = open_deadline_at + make_interval(secs => $2::double precision / 1000), version=version+1
      WHERE game_id=$1 AND status IN ('OFFERED','RESERVED')`,
    [gameId, delta],
  );
  await tx.query(
    `UPDATE imposter_reservation r SET solve_deadline_at = solve_deadline_at + make_interval(secs => $2::double precision / 1000)
       FROM imposter_release ir WHERE ir.id=r.release_id AND ir.game_id=$1 AND r.status='ACTIVE'`,
    [gameId, delta],
  );
  const updated = await bumpGame(tx, gameId, { phase: 'RUNNING' });
  await audit(tx, actor, 'sprint.resumed', { type: 'game', id: gameId }, { sprint: s.number, pausedMs: delta, deadlineAt: resumed!.deadline_at });
  await emit(tx, 'sprint.resumed', [Rooms.game(gameId), Rooms.admin], { gameId, sprint: s.number, deadlineAt: resumed!.deadline_at, version: updated.version });
  return { game: updated, sprint: resumed! };
}

/**
 * Closes the current sprint: rejects further scoring (phase changes under the
 * game lock), expires live imposters, freezes the ranking snapshot and moves
 * the game to ELIMINATION_REVIEW. `reason=DEADLINE` uses the authoritative
 * deadline as the close time (also after an outage — never silently extended).
 */
export async function closeSprint(tx: Tx, actor: Actor, gameId: string, reason: 'DEADLINE' | 'ADMIN_EARLY', expectedVersion?: number) {
  const g = await lockGame(tx, gameId);
  checkVersion(g, expectedVersion);
  if (!['RUNNING', 'PAUSED'].includes(g.phase)) throw new AppError('INVALID_TRANSITION', `No running sprint to close (game is ${g.phase}).`);
  const s = await one<SprintRow & { overdue: boolean }>(
    tx,
    `SELECT *, (deadline_at <= clock_timestamp()) AS overdue FROM sprint WHERE game_id=$1 AND number=$2 FOR UPDATE`,
    [gameId, g.current_sprint],
  );
  if (!s || !['RUNNING', 'PAUSED'].includes(s.status)) throw new AppError('INVALID_TRANSITION', 'Sprint is not running.');
  if (reason === 'DEADLINE' && (s.status !== 'RUNNING' || !s.overdue)) return null; // not due (e.g. paused/resumed meanwhile)
  const closedAtSql = reason === 'DEADLINE' ? 'deadline_at' : 'clock_timestamp()';
  // Expire any live imposter at the cutoff.
  const live = await many<{ id: string }>(tx, `UPDATE imposter_release SET status='EXPIRED', resolved_at=clock_timestamp(), resolution_note='SPRINT_CLOSED', version=version+1
                                               WHERE game_id=$1 AND status IN ('OFFERED','RESERVED') RETURNING id`, [gameId]);
  if (live.length) {
    await tx.query(`UPDATE imposter_reservation SET status='EXPIRED', resolved_at=clock_timestamp() WHERE release_id = ANY($1) AND status='ACTIVE'`, [live.map((l) => l.id)]);
    await tx.query(`UPDATE game_enrollment SET active_reservation_id=NULL, version=version+1 WHERE game_id=$1 AND active_reservation_id IS NOT NULL`, [gameId]);
    for (const l of live) await emit(tx, 'imposter.expired', [Rooms.game(gameId), Rooms.admin], { gameId, releaseId: l.id, reason: 'SPRINT_CLOSED' });
  }
  await tx.query(`UPDATE run_job SET status='CANCELLED', finished_at=now(), error='Sprint closed' WHERE game_id=$1 AND status IN ('QUEUED','RUNNING')`, [gameId]);
  const standings = await computeStandings(tx, g);
  const snap = await one<{ id: string }>(
    tx,
    `INSERT INTO ranking_snapshot(game_id, sprint_id, metric, rows) VALUES ($1,$2,$3,$4) RETURNING id`,
    [gameId, s.id, g.ranking_metric, JSON.stringify({ active: standings.active, inactive: standings.inactive })],
  );
  const closed = await one<SprintRow>(
    tx,
    `UPDATE sprint SET status='CLOSED', closed_at=${closedAtSql}, paused_at=NULL, close_reason=$2, frozen_snapshot_id=$3, version=version+1 WHERE id=$1 RETURNING *`,
    [s.id, reason, snap!.id],
  );
  const updated = await bumpGame(tx, gameId, { phase: 'ELIMINATION_REVIEW' });
  await audit(tx, actor, 'sprint.closed', { type: 'game', id: gameId }, { sprint: s.number, reason, closedAt: closed!.closed_at, snapshotId: snap!.id });
  await emit(tx, 'sprint.closed', [Rooms.game(gameId), Rooms.admin], { gameId, sprint: s.number, closedAt: closed!.closed_at, reason, version: updated.version });
  await emit(tx, 'standings.updated', [Rooms.game(gameId), Rooms.admin], { gameId });
  return { game: updated, sprint: closed!, snapshotId: snap!.id };
}

// ---------------------------------------------------------------------------
// Elimination review (from FROZEN standings)
// ---------------------------------------------------------------------------

async function frozenActive(q: Queryable, sprint: SprintRow): Promise<StandingRow[]> {
  const snap = await one<{ rows: { active: StandingRow[] } }>(q, 'SELECT rows FROM ranking_snapshot WHERE id=$1', [sprint.frozen_snapshot_id]);
  if (!snap) throw new AppError('INVALID_TRANSITION', 'No frozen standings for this sprint.');
  // Crews disqualified after the freeze are removed; ranks are recomputed on frozen scores.
  const still = new Set(
    (await many<{ id: string }>(
      q,
      `SELECT ge.id FROM game_enrollment ge JOIN team t ON t.id=ge.team_id
        WHERE ge.game_id=$1 AND ge.status='ACTIVE' AND t.status='ACTIVE'
          AND NOT EXISTS (SELECT 1 FROM disqualification d WHERE d.team_id=t.id AND d.revoked_at IS NULL AND (d.scope='EVENT' OR d.game_id=ge.game_id))`,
      [sprint.game_id],
    )).map((r) => r.id),
  );
  return assignRanks(snap.rows.active.filter((r) => still.has(r.enrollmentId)).map((r) => ({ ...r })));
}

export async function eliminationReview(q: Queryable, gameId: string) {
  const g = await one<GameRow>(q, 'SELECT * FROM game WHERE id=$1', [gameId]);
  if (!g) throw new AppError('NOT_FOUND', 'Game not found.');
  if (g.phase !== 'ELIMINATION_REVIEW') throw new AppError('INVALID_TRANSITION', `No elimination is pending (game is ${g.phase}).`);
  const s = (await one<SprintRow>(q, 'SELECT * FROM sprint WHERE game_id=$1 AND number=$2', [gameId, g.current_sprint]))!;
  const rows = await frozenActive(q, s);
  const k = s.eliminate_count ?? 0;
  const preview = eliminationPreview(rows, k);
  return { game: g, sprint: s, rows, preview, finalSprint: s.number === 2, prizePlaces: g.prize_places };
}

export interface EliminationResolution {
  mode: 'RETAIN_TIED' | 'ELIMINATE_TIED' | 'MANUAL_TIEBREAK';
  eliminateEnrollmentIds?: string[];
  note: string;
}

export async function confirmElimination(tx: Tx, actor: Actor, gameId: string, opts: { expectedVersion?: number; resolution?: EliminationResolution }) {
  const g = await lockGame(tx, gameId);
  checkVersion(g, opts.expectedVersion);
  if (g.phase !== 'ELIMINATION_REVIEW') throw new AppError('INVALID_TRANSITION', `Elimination already confirmed or not pending (game is ${g.phase}).`);
  const s = (await one<SprintRow>(tx, 'SELECT * FROM sprint WHERE game_id=$1 AND number=$2 FOR UPDATE', [gameId, g.current_sprint]))!;
  if (s.status !== 'CLOSED') throw new AppError('INVALID_TRANSITION', 'Sprint is not closed.');
  const rows = await frozenActive(tx, s);
  const preview = eliminationPreview(rows, s.eliminate_count ?? 0);
  let eliminated: string[];
  let resolution: Record<string, unknown> = { mode: 'STANDARD' };
  if (preview.tie) {
    const r = opts.resolution;
    if (!r) throw new AppError('TIE_RESOLUTION_REQUIRED', 'A tie crosses the elimination cutoff. Choose and record a published tiebreak decision.', { tie: preview.tie });
    if (!r.note || r.note.trim().length < 8) throw new AppError('VALIDATION_FAILED', 'Record the published tiebreak decision (at least 8 characters).');
    const tie = preview.tie;
    if (r.mode === 'RETAIN_TIED') eliminated = [...tie.strictlyBelow];
    else if (r.mode === 'ELIMINATE_TIED') eliminated = [...tie.strictlyBelow, ...tie.tiedEnrollmentIds];
    else {
      const pick = r.eliminateEnrollmentIds ?? [];
      if (new Set(pick).size !== pick.length || pick.some((id) => !tie.tiedEnrollmentIds.includes(id))) throw new AppError('VALIDATION_FAILED', 'Manual tiebreak may only select crews from the tied group.');
      if (pick.length !== tie.needFromTie) throw new AppError('VALIDATION_FAILED', `Select exactly ${tie.needFromTie} crew(s) from the tied group.`);
      eliminated = [...tie.strictlyBelow, ...pick];
    }
    resolution = { mode: r.mode, tie, selected: r.eliminateEnrollmentIds ?? null };
  } else {
    eliminated = preview.proposed;
  }
  const survivors = rows.length - eliminated.length;
  if (rows.length > 0 && survivors < 1) throw new AppError('VALIDATION_FAILED', 'At least one crew must survive.');
  if (s.number === 2 && survivors < Math.min(rows.length, Math.max(1, g.prize_places))) {
    throw new AppError('VALIDATION_FAILED', `The final sprint must leave at least ${g.prize_places} crew(s) for the configured prize places.`);
  }
  const batch = await one<{ id: string }>(
    tx,
    `INSERT INTO elimination_batch(game_id, sprint_id, snapshot_id, configured_count, eliminated_enrollment_ids, resolution, note, confirmed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [gameId, s.id, s.frozen_snapshot_id, s.eliminate_count ?? 0, eliminated, JSON.stringify(resolution), opts.resolution?.note ?? null, actor.id],
  ).catch((err: { code?: string }) => {
    if (err.code === '23505') throw new AppError('INVALID_TRANSITION', 'Elimination for this sprint was already confirmed.');
    throw err;
  });
  if (eliminated.length) {
    await tx.query(
      `UPDATE game_enrollment SET status='ELIMINATED', eliminated_sprint=$2, elimination_batch_id=$3, active_reservation_id=NULL, version=version+1
        WHERE id = ANY($1) AND status='ACTIVE'`,
      [eliminated, s.number, batch!.id],
    );
    await tx.query(`UPDATE run_job SET status='CANCELLED', finished_at=now(), error='Crew ejected' WHERE enrollment_id = ANY($1) AND status IN ('QUEUED','RUNNING')`, [eliminated]);
  }
  await tx.query(`UPDATE sprint SET status='FINALIZED', version=version+1 WHERE id=$1`, [s.id]);
  const updated = await bumpGame(tx, gameId, { phase: s.number === 1 ? 'WAITING_NEXT_SPRINT' : 'GAME_RESULT_REVIEW' });
  const ejected = rows.filter((r) => eliminated.includes(r.enrollmentId)).map((r) => ({ crewId: r.crewId, name: r.name, teamId: r.teamId }));
  await audit(tx, actor, 'elimination.confirmed', { type: 'game', id: gameId }, { sprint: s.number, eliminated: ejected.map((e) => e.crewId), resolution }, opts.resolution?.note);
  await emit(tx, 'team.eliminated', [Rooms.game(gameId), Rooms.admin], {
    gameId, sprint: s.number, eliminated: ejected.map(({ crewId, name }) => ({ crewId, name })), survivors, version: updated.version,
  });
  for (const e of ejected) await emit(tx, 'team.eliminated', [Rooms.team(e.teamId)], { gameId, sprint: s.number, you: true });
  await emit(tx, 'standings.updated', [Rooms.game(gameId), Rooms.admin], { gameId });
  return { game: updated, eliminated: ejected, survivors, batchId: batch!.id };
}

// ---------------------------------------------------------------------------
// Final results
// ---------------------------------------------------------------------------

export async function resultsReview(q: Queryable, gameId: string) {
  const g = await one<GameRow>(q, 'SELECT * FROM game WHERE id=$1', [gameId]);
  if (!g) throw new AppError('NOT_FOUND', 'Game not found.');
  if (g.phase !== 'GAME_RESULT_REVIEW') throw new AppError('INVALID_TRANSITION', `Results are not pending (game is ${g.phase}).`);
  const s2 = (await one<SprintRow>(q, 'SELECT * FROM sprint WHERE game_id=$1 AND number=2', [gameId]))!;
  const rows = await frozenActive(q, s2);
  const prizes = await many<{ place: number; label: string }>(q, 'SELECT place, label FROM prize_rule WHERE game_id=$1 ORDER BY place', [gameId]);
  const P = prizes.length;
  // A tie "crosses a prize boundary" when a tied group contains crews both inside and outside the prize places,
  // or straddles two different prize places.
  const conflicts: { score: number; enrollmentIds: string[]; positions: number[] }[] = [];
  const groups = new Map<number, StandingRow[]>();
  rows.forEach((r) => groups.set(r.score, [...(groups.get(r.score) ?? []), r]));
  for (const [score, grp] of groups) {
    if (grp.length < 2) continue;
    const positions = grp.map((r) => rows.indexOf(r) + 1);
    if (Math.min(...positions) <= P) conflicts.push({ score, enrollmentIds: grp.map((r) => r.enrollmentId), positions });
  }
  return { game: g, rows, prizes, conflicts };
}

export interface ResultsResolution {
  mode: 'SHARE' | 'MANUAL_ORDER';
  /** For MANUAL_ORDER: full ordering of every crew involved in conflicts, best first, per conflict group. */
  order?: string[];
  note: string;
}

export async function confirmResults(tx: Tx, actor: Actor, gameId: string, opts: { expectedVersion?: number; resolution?: ResultsResolution }) {
  const g = await lockGame(tx, gameId);
  checkVersion(g, opts.expectedVersion);
  const review = await resultsReview(tx, gameId);
  let ordered = review.rows;
  let shared = true;
  if (review.conflicts.length) {
    const r = opts.resolution;
    if (!r) throw new AppError('TIE_RESOLUTION_REQUIRED', 'A tie involves prize places. Record a published tiebreak or choose to share the place.', { conflicts: review.conflicts });
    if (!r.note || r.note.trim().length < 8) throw new AppError('VALIDATION_FAILED', 'Record the published tiebreak decision (at least 8 characters).');
    if (r.mode === 'MANUAL_ORDER') {
      const involved = review.conflicts.flatMap((c) => c.enrollmentIds);
      const order = r.order ?? [];
      if (order.length !== involved.length || involved.some((id) => !order.includes(id))) throw new AppError('VALIDATION_FAILED', 'Provide an order for every tied crew involved in prize places.');
      // Within each tied score group, apply the provided order.
      ordered = [...review.rows].sort((a, b) => b.score - a.score || order.indexOf(a.enrollmentId) - order.indexOf(b.enrollmentId));
      shared = false;
    }
  }
  const results = ordered.map((r, i) => {
    const place = shared ? (ordered.findIndex((x) => x.score === r.score) + 1) : i + 1;
    const prize = review.prizes.find((p) => p.place === place)?.label ?? null;
    return { place, enrollmentId: r.enrollmentId, teamId: r.teamId, crewId: r.crewId, name: r.name, color: r.color, score: r.score, earned: r.earned, spent: r.spent, prize };
  });
  const snap = await one<{ id: string }>(tx, 'SELECT frozen_snapshot_id AS id FROM sprint WHERE game_id=$1 AND number=2', [gameId]);
  await tx.query(
    `INSERT INTO game_result(game_id, snapshot_id, rows, resolution, note, confirmed_by) VALUES ($1,$2,$3,$4,$5,$6)`,
    [gameId, snap!.id, JSON.stringify(results), JSON.stringify(opts.resolution ?? { mode: 'NO_TIES' }), opts.resolution?.note ?? null, actor.id],
  ).catch((err: { code?: string }) => {
    if (err.code === '23505') throw new AppError('INVALID_TRANSITION', 'Results were already confirmed.');
    throw err;
  });
  const updated = await bumpGame(tx, gameId, { phase: 'COMPLETED' });
  await audit(tx, actor, 'results.confirmed', { type: 'game', id: gameId }, { podium: results.slice(0, Math.max(3, review.prizes.length)).map((r) => [r.place, r.crewId, r.score]) }, opts.resolution?.note);
  await emit(tx, 'game.completed', [Rooms.game(gameId), Rooms.admin], { gameId, version: updated.version });
  return { game: updated, results };
}
