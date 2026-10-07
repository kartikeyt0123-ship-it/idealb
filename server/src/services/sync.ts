/**
 * Question-bank sync with the IDEALab.dev repository.
 *
 * Preview fetches data/<domain>.json for the six domains from GitHub (or uses
 * the bundled snapshot), converts every problem and compares it with the bank
 * by repository id: NEW / CHANGED (content hash differs) / UNCHANGED / ERROR.
 * Commit creates the new questions and adds a new version for changed ones —
 * as DRAFT, or PUBLISHED when the organizer explicitly chooses so. Questions
 * already used in slots keep their old version on those instances.
 */
import { createHash } from 'node:crypto';
import type { AppConfig } from '../config.js';
import { convertDomainFile, fetchFromGitHub, IDEALAB_DOMAIN_FILES, IDEALAB_REPO, loadSnapshot, type ConvertedQuestion } from '../content/idealab.js';
import { many, one, withTx, type Db, type Tx } from '../db.js';
import { AppError } from '../errors.js';
import { audit, type Actor } from './audit.js';
import { createQuestion, insertVersion, upsertDomains } from './content.js';
import { getEvent } from './context.js';
import { emit, Rooms } from './outbox.js';

export function contentHash(q: ConvertedQuestion): string {
  const { source, ...rest } = q.variant;
  void source;
  return createHash('sha256').update(JSON.stringify({ d: q.domainSlug, f: q.difficulty, v: rest })).digest('hex').slice(0, 32);
}

type Action = 'NEW' | 'CHANGED' | 'UNCHANGED';

export async function previewSync(db: Db, actor: Actor, args: { repo?: string; ref?: string; source?: 'GITHUB' | 'SNAPSHOT' }) {
  const ev = await getEvent(db);
  let fetched: Awaited<ReturnType<typeof fetchFromGitHub>>;
  if (args.source === 'SNAPSHOT') fetched = loadSnapshot();
  else {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 30_000);
    try {
      fetched = await fetchFromGitHub(args.repo ?? IDEALAB_REPO, args.ref ?? 'main', ac.signal);
    } catch (e) {
      throw new AppError('IMPORT_INVALID', `GitHub fetch failed: ${(e as Error).message} You can sync from the bundled snapshot instead.`);
    } finally {
      clearTimeout(t);
    }
  }
  const existing = new Map(
    (await many<{ key: string; hash: string | null; status: string }>(
      db,
      `SELECT q.key, v.source->>'hash' AS hash, v.status FROM question q JOIN LATERAL (SELECT * FROM question_version WHERE question_id=q.id ORDER BY version_no DESC LIMIT 1) v ON true`,
    )).map((r) => [r.key, r]),
  );
  const rows: { key: string; domain: string; difficulty: string; title: string; workspace: string; action: Action; status?: string }[] = [];
  const errors: { domain: string; id: string; error: string }[] = [];
  const items: (ConvertedQuestion & { hash: string; action: Action })[] = [];
  for (const d of IDEALAB_DOMAIN_FILES) {
    const r = convertDomainFile(d, fetched.domains[d], { repo: fetched.source.repo, commit: fetched.source.commit });
    for (const e of r.errors) errors.push({ domain: d, ...e });
    for (const q of r.ok) {
      const hash = contentHash(q);
      const ex = existing.get(q.key);
      const action: Action = !ex ? 'NEW' : ex.hash === hash ? 'UNCHANGED' : 'CHANGED';
      items.push({ ...q, hash, action });
      rows.push({ key: q.key, domain: d, difficulty: q.difficulty, title: q.variant.title, workspace: q.variant.workspace, action, ...(ex ? { status: ex.status } : {}) });
    }
  }
  const summary = {
    source: fetched.source,
    total: items.length,
    new: items.filter((i) => i.action === 'NEW').length,
    changed: items.filter((i) => i.action === 'CHANGED').length,
    unchanged: items.filter((i) => i.action === 'UNCHANGED').length,
    errors: errors.length,
    byDomain: Object.fromEntries(IDEALAB_DOMAIN_FILES.map((d) => [d, { EASY: 0, MEDIUM: 0, HARD: 0, ...Object.fromEntries(['EASY', 'MEDIUM', 'HARD'].map((x) => [x, items.filter((i) => i.domainSlug === d && i.difficulty === x).length])) }])),
  };
  const b = (await one<{ id: string }>(
    db,
    `INSERT INTO import_batch(event_id, kind, file_name, rows, errors, summary, created_by) VALUES ($1,'QUESTIONS',$2,$3,$4,$5,$6) RETURNING id`,
    [ev.id, `${fetched.source.repo}@${fetched.source.commit || args.ref || 'main'}`.slice(0, 200), JSON.stringify(items.filter((i) => i.action !== 'UNCHANGED')), JSON.stringify(errors), JSON.stringify({ ...summary, kind: 'GITHUB_SYNC' }), actor.id],
  ))!;
  return { previewId: b.id, summary, rows, errors };
}

async function applyItem(tx: Tx, cfg: AppConfig, actor: Actor | null, it: ConvertedQuestion & { hash: string; action: Action }, status: 'DRAFT' | 'PUBLISHED', isDemo: boolean) {
  const variant = { ...it.variant, source: { ...(it.variant.source ?? { id: it.key }), hash: it.hash } as never };
  const q = await one<{ id: string; max: number }>(tx, 'SELECT q.id, (SELECT max(version_no) FROM question_version WHERE question_id=q.id) AS max FROM question q WHERE q.key=$1', [it.key]);
  if (!q) {
    await createQuestion(tx, cfg, { key: it.key, domainSlug: it.domainSlug, pool: 'REGULAR', isDemo, status, version: { variant, difficulty: it.difficulty, sourceTemplate: 'idealab' }, actorId: actor?.id ?? null });
    return 'created';
  }
  await insertVersion(tx, cfg, q.id, Number(q.max) + 1, status, { variant, difficulty: it.difficulty, sourceTemplate: 'idealab' }, actor?.id ?? null);
  await tx.query('UPDATE question SET title=$2 WHERE id=$1', [q.id, it.variant.title]);
  if (status === 'PUBLISHED') {
    // Only the newest published version is used for new releases; archive older published ones.
    await tx.query(`UPDATE question_version SET status='ARCHIVED' WHERE question_id=$1 AND status='PUBLISHED' AND version_no < $2`, [q.id, Number(q.max) + 1]);
  }
  return 'versioned';
}

export async function commitSync(db: Db, cfg: AppConfig, actor: Actor, previewId: string, publish: boolean) {
  return withTx(db, async (tx) => {
    const b = await one<{ status: string; rows: (ConvertedQuestion & { hash: string; action: Action })[]; summary: { kind?: string }; result: unknown }>(
      tx, `SELECT status, rows, summary, result FROM import_batch WHERE id=$1 AND kind='QUESTIONS' FOR UPDATE`, [previewId],
    );
    if (!b || b.summary?.kind !== 'GITHUB_SYNC') throw new AppError('NOT_FOUND', 'Sync preview not found.');
    if (b.status === 'COMMITTED') return { ...(b.result as object), alreadyCommitted: true };
    await upsertDomains(tx);
    let created = 0;
    let versioned = 0;
    for (const it of b.rows) {
      const r = await applyItem(tx, cfg, actor, it, publish ? 'PUBLISHED' : 'DRAFT', false);
      if (r === 'created') created++;
      else versioned++;
    }
    const result = { created, versioned, status: publish ? 'PUBLISHED' : 'DRAFT' };
    await tx.query(`UPDATE import_batch SET status='COMMITTED', committed_at=now(), result=$2 WHERE id=$1`, [previewId, JSON.stringify(result)]);
    await audit(tx, actor, 'questions.github_sync', { type: 'import_batch', id: previewId }, result);
    await emit(tx, 'content.changed', [Rooms.organizers], result);
    return result;
  });
}

/** Demo seed / bootstrap: load the bundled snapshot straight into the bank (PUBLISHED, labelled demo when isDemo). */
export async function seedSnapshot(tx: Tx, cfg: AppConfig, opts: { isDemo: boolean }) {
  const snap = loadSnapshot();
  let n = 0;
  for (const d of IDEALAB_DOMAIN_FILES) {
    const r = convertDomainFile(d, snap.domains[d], { repo: snap.source.repo, commit: snap.source.commit });
    if (r.errors.length) throw new Error(`IDEALab snapshot: ${r.errors.map((e) => `${e.id}: ${e.error}`).join('; ')}`);
    for (const q of r.ok) {
      if (await one(tx, 'SELECT id FROM question WHERE key=$1', [q.key])) continue;
      await applyItem(tx, cfg, null, { ...q, hash: contentHash(q), action: 'NEW' }, 'PUBLISHED', opts.isDemo);
      n++;
    }
  }
  return { created: n, source: snap.source };
}
