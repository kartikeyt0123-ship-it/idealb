import { many, type Queryable } from '../db.js';
import type { CompetitorContext, GameRow, SprintRow } from './context.js';
import { sharedGameState } from './gameCache.js';
import { imposterView } from './imposter.js';
import type { StandingRow } from './ranking.js';
import { hintTaskIds, taskCards } from './tasks.js';

export function sprintDto(s: SprintRow | undefined, nowMs: number) {
  if (!s) return null;
  const deadline = s.deadline_at ? new Date(s.deadline_at).getTime() : null;
  let remaining: number | null = null;
  if (deadline !== null) {
    if (s.status === 'PAUSED' && s.paused_at) remaining = Math.max(0, Math.ceil((deadline - new Date(s.paused_at).getTime()) / 1000));
    else if (s.status === 'RUNNING') remaining = Math.max(0, Math.ceil((deadline - nowMs) / 1000));
    else remaining = 0;
  }
  return {
    number: s.number,
    status: s.status,
    durationSeconds: s.duration_seconds,
    eliminateCount: s.eliminate_count,
    startedAt: s.started_at,
    deadlineAt: s.deadline_at,
    pausedAt: s.paused_at,
    closedAt: s.closed_at,
    remainingSeconds: remaining,
    version: s.version,
  };
}

export function publicStanding(r: StandingRow) {
  return {
    crewId: r.crewId,
    name: r.name,
    color: r.color,
    status: r.status,
    eliminatedSprint: r.eliminatedSprint,
    score: r.score,
    earned: r.earned,
    spent: r.spent,
    tasksSolved: r.tasksSolved,
    rank: r.rank,
    zone: r.zone ?? null,
  };
}

export function gameDto(g: GameRow) {
  return {
    id: g.id,
    number: g.number,
    name: g.name,
    phase: g.phase,
    currentSprint: g.current_sprint,
    rankingMetric: g.ranking_metric,
    prizePlaces: g.prize_places,
    imposterMode: g.imposter_mode,
    imposterBlocksRegular: g.imposter_blocks_regular,
    durationPreset: g.duration_preset,
    version: g.version,
  };
}

/** Complete authorised state for a competitor. Clients re-fetch this after any event or reconnect. */
export async function participantSnapshot(q: Queryable, ctx: CompetitorContext) {
  const now = Date.now();
  const shared = await sharedGameState(q, ctx.game);
  const [hints, members] = await Promise.all([
    hintTaskIds(q, ctx.enrollment.id),
    many<{ name: string; is_captain: boolean }>(q, 'SELECT name, is_captain FROM team_member WHERE team_id=$1 ORDER BY position', [ctx.team.id]),
  ]);
  const { active, inactive } = shared.standings;
  const mine = active.find((r) => r.enrollmentId === ctx.enrollment.id) ?? inactive.find((r) => r.enrollmentId === ctx.enrollment.id);
  const cards = shared.display ? taskCards(shared.taskRows, shared.display, ctx.enrollment.id, hints, now) : [];
  const domainCounts = shared.domains.map((d) => {
    const ts = cards.filter((t) => t.domain === d.slug);
    return {
      ...d,
      counts: {
        total: ts.length,
        available: ts.filter((t) => t.state === 'AVAILABLE').length,
        locked: ts.filter((t) => t.state === 'LOCKED').length,
        solvedByYou: ts.filter((t) => t.state === 'SOLVED_BY_YOU').length,
        solvedByOthers: ts.filter((t) => t.state === 'SOLVED').length,
        closed: ts.filter((t) => t.state === 'CLOSED').length,
      },
    };
  });
  const lb = shared.lastBatch;
  return {
    serverTime: new Date(now).toISOString(),
    identity: { role: 'COMPETITOR' as const, teamId: ctx.team.id, crewId: ctx.team.crew_id, name: ctx.team.name, color: ctx.team.color, members, mustChangePassword: ctx.team.must_change_password },
    event: { name: ctx.event.name, isDemo: ctx.event.is_demo },
    day: { number: ctx.day.day_number, label: ctx.day.label },
    game: gameDto(ctx.game),
    sprint: sprintDto(shared.current, now),
    sprints: shared.sprints.map((s) => sprintDto(s, now)),
    me: {
      status: ctx.enrollment.status,
      eliminatedSprint: ctx.enrollment.eliminated_sprint,
      wallet: ctx.enrollment.wallet_balance,
      earned: ctx.enrollment.earned_total,
      spent: ctx.enrollment.spent_total,
      score: mine?.score ?? 0,
      rank: mine?.rank ?? null,
      zone: mine?.zone ?? null,
      tasksSolved: ctx.enrollment.tasks_solved,
      activeReservationId: ctx.enrollment.active_reservation_id,
      activeCount: active.length,
    },
    standings: { active: active.map(publicStanding), inactive: inactive.map(publicStanding) },
    domains: domainCounts,
    tasks: { sprint: shared.display?.number ?? null, tasks: cards },
    imposter: imposterView(shared.imposter, ctx.enrollment.id, now),
    announcements: shared.announcements,
    lastElimination: lb ? { sprint: lb.sprint, confirmedAt: lb.confirmed_at, youEliminated: lb.ids.includes(ctx.enrollment.id), count: lb.ids.length } : null,
    prizes: shared.prizes,
    result: shared.result ? { rows: shared.result.rows, confirmedAt: shared.result.confirmed_at } : null,
  };
}
