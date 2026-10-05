/**
 * UI release gates through a real browser against the live stack.
 * Requires `npm run dev` (DEMO_MODE=true) on a FRESH demo database:
 *   npm run reset:demo -- --yes && npm run dev     # then: npm run test:e2e
 * The suite opens Slot 1 and starts its Sprint 1 through the console, so it runs once per reset.
 * Isolated run (no dev server): E2E_BASE=http://127.0.0.1:4300 against an API serving web/dist.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

const ORG = { email: 'admin@crm.local', password: 'idealab' };

async function signIn(page: Page, mode: 'CREW' | 'ORGANIZER', id: string, pw: string, path = '/') {
  await page.goto(path);
  await page.getByRole('tab', { name: mode }).click();
  await page.getByLabel(mode === 'ORGANIZER' ? 'ORGANIZER EMAIL' : 'CAPTAIN EMAIL OR CREW ID (CRW-001)').fill(id);
  await page.getByLabel('PASSWORD', { exact: true }).fill(pw);
  await page.getByRole('button', { name: mode === 'ORGANIZER' ? /Sign in as organizer/ : /Board the ship/ }).click();
}

async function boardShip(page: Page) {
  await page.getByRole('button', { name: /Enter ship/ }).click();
  await page.getByRole('button', { name: 'Skip intro' }).click({ timeout: 5_000 }).catch(() => undefined);
  await expect(page.getByLabel('Ship orientation map')).toBeVisible({ timeout: 20_000 });
}

/** Organizer API call from a signed-in console page (same-origin, CSRF header). */
async function orgApi(page: Page, method: 'GET' | 'POST', path: string, data?: unknown) {
  const origin = new URL(page.url()).origin;
  const r = method === 'GET'
    ? await page.request.get(path)
    : await page.request.post(path, { data: data ?? {}, headers: { 'x-requested-with': 'amongbugs', origin } });
  return r.json();
}
async function teamIdOf(page: Page, crewId: string): Promise<string> {
  const teams = (await orgApi(page, 'GET', '/api/v1/admin/teams')) as { id: string; crew_id: string }[];
  return teams.find((t) => t.crew_id === crewId)!.id;
}

async function organizerPage(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, 'ORGANIZER', ORG.email, ORG.password, '/command');
  await expect(page.getByRole('tab', { name: 'SLOTS & SPRINTS' }).or(page.getByRole('button', { name: 'SLOTS & SPRINTS' })).first()).toBeVisible({ timeout: 20_000 });
  return page;
}

test('landing offers only Crew Login and Organizer Login — no registration, no demo credentials', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'CREW' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'ORGANIZER' })).toBeVisible();
  await expect(page.getByText(/AMONG BUG/).first()).toBeVisible();
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/register/i);
  expect(text).not.toMatch(/CrewDemo123|Crew-\d{3}-Demo|admin@crm\.local/);
  expect(text).not.toMatch(/DEBUG \+ RUN/);
});

test('an absent crew cannot sign in; ticking Present in the slot roster enables its login; the crew waits until the slot opens', async ({ browser }) => {
  const crewPage = await (await browser.newContext()).newPage();
  await signIn(crewPage, 'CREW', 'CRW-002', 'Crew-002-Demo!');
  await expect(crewPage.getByRole('alert')).toContainText(/attendance has not been marked/i);

  const org = await organizerPage(browser);
  await org.getByText('CREWS', { exact: true }).first().click();
  const box = org.getByLabel('CRW-002 present').first();
  await expect(box).toBeVisible();
  await expect(box).not.toBeChecked();
  await box.check();
  await expect(box).toBeChecked({ timeout: 10_000 });

  await signIn(crewPage, 'CREW', 'CRW-002', 'Crew-002-Demo!');
  await expect(crewPage.getByText(/Your slot has not opened yet/)).toBeVisible();
});

test('organizer console: all ten sections; opens Slot 1 (kick-in), then starts Sprint 1 after the preflight', async ({ browser }) => {
  const page = await organizerPage(browser);
  for (const t of ['SLOTS & SPRINTS', 'RELEASES', 'CREWS', 'IMPORT', 'CREDENTIALS', 'RULES REVIEW', 'LEADERBOARDS & EXPORTS', 'DISPLAYS', 'QUESTION BANK', 'LEDGER · AUDIT · HEALTH']) {
    await expect(page.getByText(t, { exact: true }).first(), t).toBeVisible();
  }
  await expect(page.getByText(/UNCONFIRMED/i).first()).toBeVisible();
  await expect(page.getByText(/08 Oct 2026|2026-10-08|8 Oct 2026/).first()).toBeVisible();
  const slot1 = page.getByRole('article', { name: 'Slot 1' });
  await expect(slot1.getByRole('button', { name: /Start sprint 1/ })).toBeDisabled();
  await slot1.getByRole('button', { name: /Open slot \(kick-in\)/ }).click();
  await page.getByRole('button', { name: 'Open slot', exact: true }).click();
  await expect(slot1.getByText('BOARDING OPEN')).toBeVisible({ timeout: 15_000 });
  await slot1.getByRole('button', { name: /Start sprint 1/ }).click();
  await expect(page.getByText(/I reviewed the preflight/)).toBeVisible();
  await page.getByText(/I reviewed the preflight/).click();
  await page.getByRole('button', { name: 'Start sprint 1 now' }).click();
  await expect(page.getByText(/RUNNING/).first()).toBeVisible({ timeout: 15_000 });
});

test('Nexora boards, sees the HUD, 60 questions in Slot 1 and the Sprint / Slot / Overall rankings', async ({ page }) => {
  await signIn(page, 'CREW', 'nexora@example.test', 'CrewDemo123!');
  await expect(page.getByText(/Slot 1/).first()).toBeVisible({ timeout: 15_000 });
  await boardShip(page);
  await expect(page.getByText(/S1\s*\/\s*4/).first()).toBeVisible(); // first snapshot loaded
  const hud = await page.locator('body').innerText();
  expect(hud).toMatch(/S1\s*\/\s*4|SPRINT\s*1/i);
  expect(hud).toMatch(/WALLET|IdeaCoins/i);
  await page.getByRole('button', { name: 'Open rankings' }).first().click();
  for (const tab of [/^Sprint$/i, /^Slot$/i, /^Overall$/i]) await expect(page.getByRole('tab', { name: tab }).or(page.getByRole('button', { name: tab })).first()).toBeVisible();
  await page.getByRole('tab', { name: /^Overall$/i }).or(page.getByRole('button', { name: /^Overall$/i })).first().click();
  await expect(page.getByText(/PROVISIONAL/).first()).toBeVisible({ timeout: 10_000 });
  // Server data, not the UI, is the gate: 60 initial questions are visible to this crew.
  const st = await page.request.get('/api/v1/slots/mine/state');
  expect((await st.json()).questions.length).toBe(60);
});

test('a crew of another slot is waiting and cannot see Slot 1', async ({ page, browser }) => {
  const org = await organizerPage(browser);
  await orgApi(org, 'POST', '/api/v1/admin/teams/attendance', { teamIds: [await teamIdOf(org, 'CRW-011')], present: true });
  const slot2 = ((await orgApi(org, 'GET', '/api/v1/admin/overview')) as { slots: { id: string; number: number }[] }).slots.find((s) => s.number === 2)!;
  await orgApi(org, 'POST', `/api/v1/admin/slots/${slot2.id}/open`);
  await signIn(page, 'CREW', 'CRW-011', 'Crew-011-Demo!');
  await boardShip(page);
  await expect(page.getByText(/Waiting for the organizer/i).first()).toBeVisible({ timeout: 15_000 });
  const st = await (await page.request.get('/api/v1/slots/mine/state')).json();
  expect(st.slot.number).toBe(2);
  expect(st.questions).toEqual([]);
});

test('a crew session at /command is denied', async ({ page }) => {
  await signIn(page, 'CREW', 'CRW-002', 'Crew-002-Demo!'); // marked present earlier; Slot 1 is open now
  await expect(page.getByRole('button', { name: /Enter ship/ })).toBeVisible({ timeout: 15_000 });
  await page.goto('/command');
  await expect(page.getByText(/ACCESS DENIED/)).toBeVisible();
  expect((await page.request.get('/api/v1/admin/overview')).status()).toBe(403);
});

test('projector link shows the live board with approved fields only; revoking it cuts it off', async ({ browser }) => {
  const org = await organizerPage(browser);
  const link = await (await org.request.post('/api/v1/admin/display-links', { data: { label: 'E2E projector', hours: 2 }, headers: { 'x-requested-with': 'amongbugs', origin: new URL(org.url()).origin } })).json();
  const proj = await (await browser.newContext()).newPage();
  await proj.goto(new URL(link.url).pathname + new URL(link.url).hash);
  await expect(proj.getByText('Overall standings')).toBeVisible({ timeout: 15_000 });
  await expect(proj.getByText('PROVISIONAL').first()).toBeVisible();
  await expect(proj.getByText('Nexora').first()).toBeVisible();
  expect(proj.url()).not.toContain('key=');
  expect(await proj.locator('body').innerText()).not.toMatch(/@example\.test/);
  await org.request.delete(`/api/v1/admin/display-links/${link.id}`, { headers: { 'x-requested-with': 'amongbugs', origin: new URL(org.url()).origin } });
  expect((await proj.request.get('/api/v1/display/overall')).status()).toBe(401);
});

test('Nexora repairs a question in the workspace: server-verified, wallet and sprint score rise', async ({ page }) => {
  // Test-only answer key straight from the private solution (never exposed by the API).
  const pg = (await import('pg')).default;
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:amongbugs@127.0.0.1:54329/among_bugs' });
  await db.connect();
  const q = (await db.query(
    `SELECT qi.id, qi.label, qi.reward, qv.solution->>'answer' AS answer FROM question_instance qi JOIN question_version qv ON qv.id=qi.question_version_id
       JOIN release r ON r.id=qi.release_id JOIN slot s ON s.id=qi.slot_id JOIN domain d ON d.id=qi.domain_id
      WHERE s.number=1 AND r.status='RELEASED' AND qi.status='AVAILABLE' AND d.slug='misc' AND qv.validation->>'mode'='EXACT_TEXT' ORDER BY qi.label LIMIT 1`,
  )).rows[0];
  await db.end();
  expect(q, 'a released misc text question in Slot 1').toBeTruthy();

  await signIn(page, 'CREW', 'nexora@example.test', 'CrewDemo123!');
  await boardShip(page);
  const before = (await (await page.request.get('/api/v1/slots/mine/state')).json()).me;
  await page.getByRole('button', { name: 'Open station menu' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Miscellaneous/ }).first().click();
  const card = page.locator('div.rounded-lg', { hasText: q.label }).filter({ has: page.getByRole('button', { name: /Begin repair/ }) }).last();
  await card.getByRole('button', { name: /Begin repair/ }).click();
  await page.getByPlaceholder('Enter answer').fill(q.answer);
  await page.getByRole('button', { name: /Verify repair/ }).click();
  await expect.poll(async () => (await (await page.request.get('/api/v1/slots/mine/state')).json()).me.sprintScore, { timeout: 15_000 }).toBe(before.sprintScore + q.reward);
  const after = (await (await page.request.get('/api/v1/slots/mine/state')).json()).me;
  expect(after.wallet).toBe(before.wallet + q.reward);
  expect(after.cumulative).toBe(before.cumulative + q.reward);
});

test('Releases tab: Refill tops up the depleted domain from the reserve pool; Release bonus sends an IMPOSTER bonus', async ({ browser }) => {
  const org = await organizerPage(browser);
  const slot1 = ((await orgApi(org, 'GET', '/api/v1/admin/overview')) as { slots: { id: string; number: number }[] }).slots.find((s) => s.number === 1)!;
  const pools = async () => (await orgApi(org, 'GET', `/api/v1/admin/slots/${slot1.id}/pools`)) as { reservesLeft: number; bonusesLeft: number; domains: { slug: string; deficit: number }[] };
  const before = await pools();
  const depleted = [...before.domains].sort((a, b) => b.deficit - a.deficit)[0];
  expect(depleted.deficit).toBeGreaterThan(0); // the repair test solved a misc question

  await org.getByText('RELEASES', { exact: true }).first().click();
  await org.getByRole('button', { name: /^SLOT 1 ·/ }).first().click().catch(() => undefined);
  await expect(org.getByText(`reserves left ${before.reservesLeft} · bonuses left ${before.bonusesLeft}`).first()).toBeVisible();
  await org.getByRole('button', { name: /^Refill/ }).first().click();
  await org.getByRole('button', { name: 'Release refill' }).click();
  await expect(org.getByText(`reserves left ${before.reservesLeft - depleted.deficit}`, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  await org.getByRole('button', { name: `Release bonus (${before.bonusesLeft} left)` }).first().click();
  await org.getByRole('button', { name: 'Release bonus', exact: true }).click();
  await expect(org.getByText(`bonuses left ${before.bonusesLeft - 1}`, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  const after = await pools();
  expect(after.reservesLeft).toBe(before.reservesLeft - depleted.deficit);
  expect(after.domains.find((d) => d.slug === depleted.slug)!.deficit).toBe(0);

  const crewPage = await (await browser.newContext()).newPage();
  await signIn(crewPage, 'CREW', 'nexora@example.test', 'CrewDemo123!');
  await boardShip(crewPage);
  const st = await (await crewPage.request.get('/api/v1/slots/mine/state')).json();
  expect(st.bonuses.filter((b: { state: string }) => b.state === 'AVAILABLE').length).toBeGreaterThan(0);
  expect(st.questions.some((q: { kind: string; domain: string }) => q.kind === 'RESERVE' && q.domain === depleted.slug)).toBe(true);
  await expect(crewPage.getByText(/IMPOSTER DETECTED/).first()).toBeVisible({ timeout: 15_000 });
});
