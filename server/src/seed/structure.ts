import { one, type Tx } from '../db.js';
import { upsertDomains } from '../services/content.js';
import { DEFAULT_RULES, sprintSeconds, type Rules } from '../services/rules.js';

export interface StructureOptions {
  name: string;
  isDemo: boolean;
  /** ISO dates (Asia/Kolkata) of day 1 and day 2. */
  days: [string, string];
  /** Informational local start times per slot within its day ("HH:MM"); never auto-start anything. */
  slotTimes?: [string, string];
  capacity?: number;
  rules?: Rules;
}

/**
 * The fixed AMONG BUG shape: 2 days × 2 slots × 4 sprints, six domains, three
 * prize labels. Idempotent: returns false if an event already exists.
 */
export async function ensureEventStructure(tx: Tx, o: StructureOptions): Promise<{ created: boolean; eventId: string }> {
  await upsertDomains(tx);
  const existing = await one<{ id: string }>(tx, 'SELECT id FROM event LIMIT 1');
  if (existing) return { created: false, eventId: existing.id };
  const rules = o.rules ?? DEFAULT_RULES;
  const ev = (await one<{ id: string }>(tx, `INSERT INTO event(name, is_demo, rules) VALUES ($1,$2,$3) RETURNING id`, [o.name, o.isDemo, JSON.stringify(rules)]))!;
  const times = o.slotTimes ?? ['10:00', '14:30'];
  let slotNo = 0;
  for (const [i, date] of o.days.entries()) {
    const day = (await one<{ id: string }>(tx, `INSERT INTO event_day(event_id, day_number, label, date) VALUES ($1,$2,$3,$4) RETURNING id`, [ev.id, i + 1, `Day ${i + 1}`, date]))!;
    for (const t of times) {
      slotNo++;
      const slot = (await one<{ id: string }>(
        tx,
        `INSERT INTO slot(event_id, day_id, number, name, scheduled_start_at, capacity, phase) VALUES ($1,$2,$3,$4, ($5::date + $6::time) AT TIME ZONE 'Asia/Kolkata', $7, 'CONFIGURING') RETURNING id`,
        [ev.id, day.id, slotNo, `Slot ${slotNo}`, date, t, o.capacity ?? 10],
      ))!;
      for (let n = 1; n <= 4; n++) {
        await tx.query('INSERT INTO sprint(slot_id, number, duration_seconds, eliminate_count) VALUES ($1,$2,$3,$4)', [slot.id, n, sprintSeconds(rules), rules.elimination.enabled ? rules.elimination.counts[n - 1] : 0]);
      }
    }
  }
  for (const [place, label] of [[1, 'Winner (organizer to confirm prize)'], [2, 'Runner-up (organizer to confirm prize)'], [3, 'Third place (organizer to confirm prize)']] as const) {
    await tx.query('INSERT INTO prize_rule(event_id, place, label) VALUES ($1,$2,$3)', [ev.id, place, label]);
  }
  return { created: true, eventId: ev.id };
}
