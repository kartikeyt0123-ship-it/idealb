/**
 * UI release gates exercised through a real browser against the live stack.
 * Requires `npm run dev` (DEMO_MODE=true) with the demo seed; Game 1 / Day 1 is the current day.
 */
import { expect, test, type Page } from '@playwright/test';

async function boardAs(page: Page, mode: 'CREW' | 'COMMANDER', id: string, pw: string) {
  await page.goto('/');
  await page.getByRole('tab', { name: mode }).click();
  await page.getByLabel(mode === 'COMMANDER' ? 'COMMANDER EMAIL' : 'CAPTAIN EMAIL OR CREW ID').fill(id);
  await page.getByLabel('PASSWORD', { exact: true }).fill(pw);
  await page.getByRole('button', { name: /Authenticate/ }).click();
}

async function enterShip(page: Page) {
  await page.getByRole('button', { name: /Enter ship/ }).click();
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter').catch(() => undefined); // skip intro
  await expect(page.getByLabel('Ship orientation map')).toBeVisible({ timeout: 20_000 });
}

async function openStation(page: Page, name: string | RegExp) {
  await page.getByRole('button', { name: 'Open station menu' }).click();
  await page.getByRole('dialog').getByRole('button', { name }).click();
}

test('register a crew → pending → commander activates Day 1 in the console → crew boards', async ({ browser }) => {
  const stamp = Date.now().toString(36).slice(-6);
  const crew = await browser.newPage();
  await crew.goto('/');
  await crew.getByRole('button', { name: 'Register Team' }).click();
  await crew.getByLabel('TEAM NAME').fill(`E2E ${stamp}`);
  await crew.getByLabel('CAPTAIN EMAIL (TEAM LOGIN)').fill(`e2e-${stamp}@example.test`);
  await crew.locator('input[autocomplete="new-password"]').nth(0).fill('E2e-Password-123');
  await crew.locator('input[autocomplete="new-password"]').nth(1).fill('E2e-Password-123');
  for (let i = 1; i <= 4; i++) {
    if (i === 4) await crew.getByRole('button', { name: 'Add fourth member' }).click();
    await crew.getByLabel(`Member ${i} name`).fill(`E2E Member ${i}`);
    await crew.getByLabel(`Member ${i} institution`).fill('SGSITS');
    await crew.getByLabel(`Member ${i} year`).selectOption('3rd year');
    await crew.getByLabel(`Member ${i} branch`).fill('IT');
  }
  await crew.getByText('Day 1', { exact: true }).click();
  await crew.getByLabel('Our crew understands').check();
  await crew.getByRole('button', { name: 'Register crew' }).click();
  await expect(crew.getByRole('heading', { name: 'Registration received — awaiting organizer activation.' })).toBeVisible();
  const crewId = (await crew.locator('text=/CRW-\\d{3,}/').first().textContent())!.match(/CRW-\d+/)![0];
  await crew.getByRole('button', { name: 'Crew login' }).click();
  await crew.getByLabel('CAPTAIN EMAIL OR CREW ID').fill(crewId);
  await crew.getByLabel('PASSWORD', { exact: true }).fill('E2e-Password-123');
  await crew.getByRole('button', { name: /Authenticate/ }).click();
  await expect(crew.getByText('CREW STATUS / PENDING')).toBeVisible();

  const admin = await browser.newPage();
  await admin.goto('/command');
  await admin.getByLabel('COMMANDER EMAIL').fill('admin@crm.local');
  await admin.getByLabel('PASSWORD', { exact: true }).fill('idealab');
  await admin.getByRole('button', { name: /Authenticate commander/ }).click();
  await expect(admin.getByText('Ship command terminal')).toBeVisible();
  await admin.getByPlaceholder(/Search team/).fill(crewId);
  const row = admin.locator('tr', { hasText: crewId });
  await row.getByText('Active Day 1').click();
  const confirm = admin.getByRole('alertdialog');
  if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button', { name: 'Activate crew' }).click();
  await expect(row.getByRole('checkbox', { name: 'Active Day 1' })).toBeChecked({ timeout: 10_000 });

  await crew.getByRole('button', { name: /Check status/ }).click();
  await expect(crew.getByText(/card generated/)).toBeVisible();
  await enterShip(crew);
  await expect(crew.getByText(crewId).first()).toBeVisible();
});

test('crew swipe at the command panel is denied, the reader closes and the crew returns to the lobby', async ({ page }) => {
  await boardAs(page, 'CREW', 'byteforce@example.test', 'Demo-Byteforce-2026');
  await enterShip(page);
  let adminDataRequested = false;
  page.on('request', (r) => {
    if (r.url().includes('/api/admin/')) adminDataRequested = true;
  });
  await openStation(page, 'Command control panel');
  await page.getByRole('button', { name: 'Swipe ID card' }).click();
  await expect(page.getByRole('heading', { name: 'ACCESS DENIED' })).toBeVisible();
  await expect(page.getByText('COMMANDER CLEARANCE REQUIRED')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 6000 });
  await expect(page.getByText('01 / MAIN LOBBY')).toBeVisible();
  expect(adminDataRequested).toBe(false);
  // Deep link: /command with a crew session shows a denial, never the console.
  await page.goto('/command');
  await expect(page.getByText(/ACCESS DENIED/)).toBeVisible();
  await expect(page.getByText('Ship command terminal')).toHaveCount(0);
});

test('commander swipe is granted by the server and opens the command console', async ({ page }) => {
  await boardAs(page, 'COMMANDER', 'admin@crm.local', 'idealab');
  await expect(page.getByText('Commander card generated.')).toBeVisible();
  await enterShip(page);
  await openStation(page, 'Command control panel');
  await page.getByRole('button', { name: 'Swipe ID card' }).click();
  // The brief "ACCESS GRANTED / Welcome, commander." frame is transitional; assert the durable outcome.
  await expect(page.getByRole('dialog', { name: 'Commander terminal' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Ship command terminal')).toBeVisible();
  for (const tab of ['CREW', 'GAME & SPRINT', 'TASKS', 'IMPOSTERS', 'IDEACOINS', 'ELIMINATION', 'PROBLEM LIBRARY', 'RANKINGS & REWARDS', 'SHIP STATUS']) {
    await expect(page.getByRole('tab', { name: tab })).toBeVisible();
  }
});

test('typing in a workspace never moves the crewmate; editor and preview are side by side', async ({ page, request }) => {
  // Make sure a sprint is running (the commander starts Sprint 1 of the current day's game if it is still waiting).
  const h = { 'content-type': 'application/json', 'x-requested-with': 'amongbugs' };
  await request.post('/api/auth/login', { headers: h, data: { mode: 'COMMANDER', identifier: 'admin@crm.local', password: 'idealab' } });
  const ov = await (await request.get('/api/admin/overview')).json();
  const g = ov.games.find((x: { dayId: string }) => x.dayId === ov.currentDay?.id);
  if (g && ['WAITING', 'DRAFT', 'READY'].includes(g.phase)) {
    await request.patch(`/api/admin/games/${g.id}/config`, { headers: h, data: { rankingMetricConfirmed: true } });
    await request.post(`/api/admin/games/${g.id}/start-sprint`, { headers: h, data: { sprint: 1 } });
  }
  await boardAs(page, 'CREW', 'debuggers@example.test', 'Demo-Debuggers-2026');
  await enterShip(page);
  const player = page.getByTestId('player');
  const before = await player.getAttribute('transform');
  await openStation(page, /Miscellaneous/);
  const open = page.getByRole('dialog').getByRole('button', { name: /Begin repair|Open task/ }).first();
  test.skip(!(await open.isEnabled()), 'No sprint running — start Sprint 1 to run this check.');
  await open.click();
  await expect(page.getByText('FINAL SYSTEM OUTPUT')).toBeVisible({ timeout: 60_000 });
  const answer = page.getByRole('textbox', { name: 'Final system output' });
  await answer.click();
  await page.keyboard.type('wasdwasdeeee');
  await page.keyboard.press('ArrowRight');
  expect(await player.getAttribute('transform')).toBe(before);
  // Left statement/editor and right preview/console panels render in parallel at laptop width.
  const left = await page.getByText(/problem statement/i).first().boundingBox();
  const right = await page.getByText(/^(evidence|live preview|console|output)$/i).first().boundingBox();
  expect(left && right && right.x > left.x + 300 && Math.abs(right.y - left.y) < 40).toBeTruthy();
});
