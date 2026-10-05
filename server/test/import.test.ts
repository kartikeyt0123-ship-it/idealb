import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { one } from '../src/db.js';
import { answerInstances, Client, crew, crewLogin, freshEnv, organizer, solve, startSprint, V, type Env } from './helpers.js';

const sample = (f: string) => readFileSync(new URL(`../../samples/${f}`, import.meta.url));
const b64 = (f: string) => sample(f).toString('base64');

let env: Env;
let org: Client;
beforeAll(async () => {
  env = await freshEnv();
  org = await organizer(env);
});
afterAll(async () => env?.close());

describe('team import (CSV / XLSX)', () => {
  it('serves CSV and XLSX templates', async () => {
    const csv = await org.get(`${V}/admin/teams/import-template?format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.raw.split('\r\n')[0]).toMatch(/^team_name,crew_id,captain_email,member1_name/);
    const xlsx = await org.get(`${V}/admin/teams/import-template?format=xlsx`);
    expect(xlsx.status).toBe(200);
    expect(String(xlsx.headers['content-type'])).toMatch(/spreadsheetml/);
  });

  it('preview writes no teams; commit creates stable CRW ids, unassigned, without credentials or mail', async () => {
    const before = (await one<{ n: number }>(env.db, 'SELECT count(*)::int AS n FROM team'))!.n;
    const p = await org.post(`${V}/admin/teams/imports`, { fileName: 'teams-sample.csv', contentBase64: b64('teams-sample.csv') });
    expect(p.status).toBe(200);
    expect(p.body.summary).toMatchObject({ rows: 3, create: 3, errors: 0, unassigned: 3 });
    expect(p.body.rows.find((r: { teamName: string }) => r.teamName === 'Semicolon & Co').members).toBe(3);
    expect((await one<{ n: number }>(env.db, 'SELECT count(*)::int AS n FROM team'))!.n).toBe(before);

    const c = await org.post(`${V}/admin/teams/imports/${p.body.batchId}/commit`, {});
    expect(c.status).toBe(200);
    expect(c.body.createdCrewIds).toEqual(['CRW-041', 'CRW-042', 'CRW-043']);
    const again = await org.post(`${V}/admin/teams/imports/${p.body.batchId}/commit`, {});
    expect(again.body.alreadyCommitted).toBe(true);
    const t = (await one<{ password_hash: string | null; credential_status: string }>(env.db, `SELECT password_hash, credential_status FROM team WHERE crew_id='CRW-041'`))!;
    expect(t.password_hash).toBeNull();
    expect(t.credential_status).toBe('NONE');
    expect((await one<{ n: number }>(env.db, 'SELECT count(*)::int AS n FROM credential_delivery'))!.n).toBe(0);
    expect((await one<{ n: number }>(env.db, 'SELECT count(*)::int AS n FROM mail_capture'))!.n).toBe(0);
  });

  it('re-importing the same crews (as XLSX with aliased headers) changes nothing and keeps ids', async () => {
    const p = await org.post(`${V}/admin/teams/imports`, { fileName: 'teams-sample.xlsx', contentBase64: b64('teams-sample.xlsx') });
    expect(p.status).toBe(200);
    expect(p.body.mapping.team_name).toBe('Team Name');
    expect(p.body.summary).toMatchObject({ rows: 3, create: 0, update: 0, unchanged: 3, errors: 0 });
    expect(p.body.rows.map((r: { crewId: string }) => r.crewId)).toEqual(['CRW-041', 'CRW-042', 'CRW-043']);
  });

  it('reports every row error in the invalid fixture and refuses to commit', async () => {
    const p = await org.post(`${V}/admin/teams/imports`, { fileName: 'teams-invalid.csv', contentBase64: b64('teams-invalid.csv') });
    expect(p.status).toBe(200);
    const errs = Object.fromEntries(p.body.rows.map((r: { row: number; errors: string[] }) => [r.row, r.errors.join(' | ')]));
    expect(errs[2]).toBe('');
    expect(errs[3]).toMatch(/3 or 4 members/);
    expect(errs[4]).toMatch(/email/i);
    expect(errs[5]).toMatch(/Duplicate team name/);
    expect(errs[6]).toMatch(/Duplicate captain email/);
    expect(errs[7]).toMatch(/Slot 9 does not exist/);
    expect(errs[8]).toMatch(/account_enabled/);
    expect(errs[9]).toMatch(/Crew ID/);
    expect(errs[10]).toMatch(/Team name/);
    const c = await org.post(`${V}/admin/teams/imports/${p.body.batchId}/commit`, {});
    expect(c.status).toBe(400);
    expect(c.body.error).toBe('IMPORT_INVALID');
  });

  it('rejects non-spreadsheet uploads and enforces slot capacity at commit', async () => {
    const bad = await org.post(`${V}/admin/teams/imports`, { fileName: 'evil.exe', contentBase64: Buffer.from('MZ....').toString('base64') });
    expect(bad.status).toBe(400);
    const csv = 'team_name,captain_email,member1_name,member2_name,member3_name,slot\nOverflow Crew,overflow@example.test,A,B,C,1\n';
    const p = await org.post(`${V}/admin/teams/imports`, { fileName: 'o.csv', contentBase64: Buffer.from(csv).toString('base64') });
    expect(p.body.summary.overCapacity).toEqual(['Slot 1']);
    const c = await org.post(`${V}/admin/teams/imports/${p.body.batchId}/commit`, {});
    expect(c.status).toBe(400);
    expect(c.body.message).toMatch(/Over capacity/);
  });
});

describe('credentials (explicit, demo capture)', () => {
  it('previews recipients and channel, then captures mail locally without reporting external delivery', async () => {
    const ids = (await env.db.query(`SELECT id FROM team WHERE crew_id IN ('CRW-041','CRW-042') ORDER BY crew_id`)).rows.map((r) => r.id);
    const pv = await org.post(`${V}/admin/credential-deliveries/preview`, { teamIds: ids, reason: 'INITIAL' });
    expect(pv.status).toBe(200);
    expect(pv.body.channel).toBe('CAPTURE');
    expect(pv.body.channelNote).toMatch(/not delivered externally/);
    expect(pv.body.recipients[0].warnings).toContain('no slot assigned');
    expect(JSON.stringify(pv.body)).not.toMatch(/password_hash/);

    expect((await org.post(`${V}/admin/credential-deliveries`, { teamIds: ids })).status).toBe(400); // confirm: true required
    const sent = await org.post(`${V}/admin/credential-deliveries`, { teamIds: ids, reason: 'INITIAL', confirm: true });
    expect(sent.status).toBe(200);
    expect(sent.body.demoCapture).toBe(true);
    expect(sent.body.results.every((r: { status: string }) => r.status === 'CAPTURED')).toBe(true);
    expect(JSON.stringify(sent.body)).not.toMatch(/password/i);

    const inbox = await org.get(`${V}/admin/mail-capture`);
    expect(inbox.body.note).toMatch(/not delivered externally/);
    const msg = inbox.body.messages.find((m: { crew_id: string }) => m.crew_id === 'CRW-041');
    const pw = /Password:\s+(\S+)/.exec(msg.body)?.[1];
    expect(pw).toBeTruthy();
    // The captured temporary password works and forces a password change.
    // Imported crews are not present yet: attendance is what enables the login.
    expect((await new Client(env).post(`${V}/auth/crew-login`, { identifier: 'orbit.breakers@example.test', password: pw })).body.error).toBe('ATTENDANCE_REQUIRED');
    await org.post(`${V}/admin/teams/attendance`, { teamIds: [ids[0]], present: true });
    const c = await crewLogin(env, 'orbit.breakers@example.test', pw!);
    const me = await c.get(`${V}/me`);
    expect(me.body.team.mustChangePassword).toBe(true);
    expect(me.body.access.state).toBe('SLOT_UNASSIGNED');
    // Delivery log never stores passwords.
    const log = await org.get(`${V}/admin/credential-deliveries`);
    expect(JSON.stringify(log.body)).not.toContain(pw);
  });

  it('refuses to send when no mail transport is configured', async () => {
    const prev = env.cfg.mail.mode;
    env.cfg.mail.mode = 'none' as never;
    const id = (await one<{ id: string }>(env.db, `SELECT id FROM team WHERE crew_id='CRW-043'`))!.id;
    const r = await org.post(`${V}/admin/credential-deliveries`, { teamIds: [id], reason: 'INITIAL', confirm: true });
    env.cfg.mail.mode = prev;
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('MAIL_NOT_CONFIGURED');
    expect((await one<{ credential_status: string }>(env.db, `SELECT credential_status FROM team WHERE id=$1`, [id]))!.credential_status).toBe('NONE');
  });
});

describe('slot assignment', () => {
  it('bulk-assigns with a capacity preview, and blocks slot changes after scoring', async () => {
    const t = (await one<{ id: string }>(env.db, `SELECT id FROM team WHERE crew_id='CRW-043'`))!;
    const sid = (await one<{ id: string }>(env.db, 'SELECT id FROM slot WHERE number=4'))!.id;
    await org.patch(`${V}/admin/slots/${sid}`, { capacity: 12 });
    const pv = await org.post(`${V}/admin/teams/bulk-assign`, { teamIds: [t.id], slot: 4, apply: false });
    expect(pv.body.preview).toMatchObject({ moving: ['CRW-043'], after: 11, capacity: 12 });
    expect((await org.post(`${V}/admin/teams/bulk-assign`, { teamIds: [t.id], slot: 4, apply: true })).status).toBe(200);

    // Nexora scores in slot 1, then a move must be refused.
    await startSprint(env, org, 1, 1);
    const nexora = await crew(env, 1);
    const q = (await answerInstances(env, 1))[0];
    expect((await solve(env, nexora, q.id)).body.correct).toBe(true);
    const nexoraId = (await one<{ id: string }>(env.db, `SELECT id FROM team WHERE crew_id='CRW-001'`))!.id;
    const move = await org.patch(`${V}/admin/teams/${nexoraId}`, { slot: 2 });
    expect(move.status).toBe(409);
    expect(move.body.error).toBe('SLOT_CHANGE_BLOCKED');
    const csv = 'team_name,crew_id,captain_email,member1_name,member2_name,member3_name,member4_name,slot\n';
    const roster = (await env.db.query(`SELECT name FROM team_member WHERE team_id=$1 ORDER BY position`, [nexoraId])).rows.map((r) => r.name);
    const row = ['Nexora', 'CRW-001', 'nexora@example.test', ...roster, ...Array(4 - roster.length).fill(''), '2'].join(',');
    const p = await org.post(`${V}/admin/teams/imports`, { fileName: 'r.csv', contentBase64: Buffer.from(csv + row + '\n').toString('base64') });
    expect(p.body.rows[0].errors.join(' ')).toMatch(/Slot change blocked/);
  });

  it('exports are formula-safe and never contain passwords', async () => {
    const r = await org.get(`${V}/admin/exports/teams?format=csv`);
    expect(r.status).toBe(200);
    expect(r.raw).toMatch(/^crew_id,team,captain_email/);
    expect(r.raw).not.toMatch(/scrypt|password/i);
    await env.db.query(`UPDATE team SET name='=cmd' WHERE crew_id='CRW-042'`);
    const r2 = await org.get(`${V}/admin/exports/teams?format=csv`);
    expect(r2.raw).toContain("'=cmd");
    const x = await org.get(`${V}/admin/exports/overall?format=xlsx`);
    expect(String(x.headers['content-type'])).toMatch(/spreadsheetml/);
  });
});

describe('question bank import', () => {
  it('imports JSON and CSV (with linked asset) as DRAFTs only; publishing is explicit', async () => {
    const pj = await org.post(`${V}/admin/questions/imports`, { fileName: 'questions-sample.json', contentBase64: b64('questions-sample.json') });
    expect(pj.status).toBe(200);
    expect(pj.body.summary).toMatchObject({ rows: 2, valid: 2, errors: 0 });
    const cj = await org.post(`${V}/admin/questions/imports/${pj.body.batchId}/commit`, {});
    expect(cj.body.createdDrafts).toBe(2);

    const missing = await org.post(`${V}/admin/questions/imports`, { fileName: 'questions-sample.csv', contentBase64: b64('questions-sample.csv') });
    expect(missing.body.rows[0].errors.join(' ')).toMatch(/Asset "o2-readings.csv"/);
    const pc = await org.post(`${V}/admin/questions/imports`, { fileName: 'questions-sample.csv', contentBase64: b64('questions-sample.csv'), assets: { 'o2-readings.csv': sample('o2-readings.csv').toString('utf8') } });
    expect(pc.body.summary).toMatchObject({ valid: 2, errors: 0 });
    await org.post(`${V}/admin/questions/imports/${pc.body.batchId}/commit`, {});

    const v = (await one<{ id: string; status: string }>(env.db, `SELECT qv.id, qv.status FROM question_version qv JOIN question q ON q.id=qv.question_id WHERE q.key='sample-misc-hex-beacon'`))!;
    expect(v.status).toBe('DRAFT');
    expect((await org.post(`${V}/admin/question-versions/${v.id}/status`, { to: 'PUBLISHED' })).status).toBe(409);
    expect((await org.post(`${V}/admin/question-versions/${v.id}/status`, { to: 'REVIEWED' })).status).toBe(200);
    const verify = await org.post(`${V}/admin/question-versions/${v.id}/verify`, {});
    expect(verify.body.ok).toBe(true);
    expect((await org.post(`${V}/admin/question-versions/${v.id}/status`, { to: 'PUBLISHED' })).body.status).toBe('PUBLISHED');

    const dup = await org.post(`${V}/admin/questions/imports`, { fileName: 'questions-sample.json', contentBase64: b64('questions-sample.json') });
    expect(dup.body.summary.errors).toBe(2);
  });

  it('the code question in the JSON sample passes its own verification through the real runner', async () => {
    const v = (await one<{ id: string }>(env.db, `SELECT qv.id FROM question_version qv JOIN question q ON q.id=qv.question_id WHERE q.key='sample-basic-fuel-sum'`))!;
    const r = await org.post(`${V}/admin/question-versions/${v.id}/verify`, {});
    expect(r.body.checks.map((c: { ok: boolean }) => c.ok)).toEqual([true, true, true]);
  });

});
