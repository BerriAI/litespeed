import { test, expect, type Page } from './fixtures';

let session: { id: string }, base: string;
test.beforeEach(async ({ request }) => {
  const settings = await (await request.get('/api/settings')).json(); base = settings.providers.find((provider: { id: string }) => provider.id === 'fixture').baseUrl;
  session = await (await request.post('/api/sessions', { data: { workspace: settings.workspace, title: 'A little more hands-on', providerId: 'fixture', model: 'test-model', architecture: null, permissionMode: 'auto' } })).json();
  const opened = await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'open', url: base + '/browser-gestures' } }); expect(opened.ok()).toBe(true);
});
test.afterEach(async ({ request }) => { await request.delete(`/api/sessions/${session.id}`); });
async function settled(page: Page) {
  await expect(page.getByRole('button', { name: 'Reload page', exact: true })).toBeEnabled();
  await expect.poll(() => page.locator('.browser-viewport').evaluate(element => {
    const image = element.querySelector('img'); return image?.complete && image.naturalWidth === Math.max(320, Math.min(1280, Math.round(element.clientWidth))) && image.naturalHeight === Math.max(240, Math.min(1200, Math.round(element.clientHeight)));
  })).toBe(true);
  await expect(page.getByRole('button', { name: 'Reload page', exact: true })).toBeEnabled();
}
async function open(page: Page) {
  await page.goto(`/#session/${session.id}`); await page.getByRole('button', { name: 'Show workspace panel' }).click(); await page.getByRole('tab', { name: 'Browser', exact: true }).click(); await settled(page);
}
async function point(page: Page, x: number, y: number) {
  return page.locator('.browser-image-frame img').evaluate((image: HTMLImageElement, position) => { const bounds = image.getBoundingClientRect(); return { x: bounds.left + position.x * bounds.width / image.naturalWidth, y: bounds.top + position.y * bounds.height / image.naturalHeight }; }, { x, y });
}
async function begin(page: Page, x = 107, y = 237, toX = 320, toY = 237) {
  const from = await point(page, x, y), to = await point(page, toX, toY);
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 5 });
  await expect(page.locator('.browser-drag-guide')).toBeVisible();
}
test('drags a slider and a page card with a quiet guide and retained keyboard focus', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await open(page); await begin(page);
  await expect(page.getByText('Release to drag · Esc to cancel', { exact: true })).toBeVisible();
  await page.screenshot({ path: '.ui-audit/browser-drag-desktop.png', animations: 'disabled' });
  await page.mouse.up(); await expect(page.getByRole('tab', { name: /Preview volume (8\d|9\d)%/ })).toBeVisible(); await expect(page.locator('.browser-drag-guide')).toHaveCount(0);
  await expect(page.getByLabel('Interactive browser page')).toBeFocused(); await settled(page);
  await begin(page, 72, 325, 210, 325); await page.mouse.up(); await expect(page.getByRole('tab', { name: 'Card moved', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('Escape and releasing outside the page cancel without a click or drag', async ({ page }) => {
  await open(page); const inputs: unknown[] = [];
  page.on('request', request => { if (request.url().endsWith(`/sessions/${session.id}/browser`) && request.method() === 'POST' && ['click', 'drag'].includes(request.postDataJSON().action)) inputs.push(request.postDataJSON()); });
  await begin(page); await page.keyboard.press('Escape'); await expect(page.locator('.browser-drag-guide')).toHaveCount(0); await page.mouse.up();
  await expect(page.getByLabel('Interactive browser page')).toBeFocused();
  await begin(page); await page.mouse.move(10, 10); await page.mouse.up();
  await expect(page.locator('.browser-drag-guide')).toHaveCount(0); expect(inputs).toEqual([]); await expect(page.getByRole('tab', { name: 'A little more hands-on', exact: true })).toBeVisible();
  await begin(page); await page.mouse.up(); await expect(page.getByRole('tab', { name: /Preview volume/ })).toBeVisible();
});
test('a changed tab or viewport cancels a gesture without moving the new page', async ({ page, request }) => {
  await open(page); const inputs: unknown[] = [];
  page.on('request', request => { if (request.url().endsWith(`/sessions/${session.id}/browser`) && request.method() === 'POST' && request.postDataJSON().action === 'drag') inputs.push(request.postDataJSON()); });
  await begin(page);
  await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'open', url: base + '/browser-next' } });
  await expect(page.getByRole('tab', { name: 'Next page', exact: true })).toHaveAttribute('aria-selected', 'true'); await expect(page.locator('.browser-drag-guide')).toHaveCount(0); await page.mouse.up();
  await page.getByRole('tab', { name: 'A little more hands-on', exact: true }).click(); await settled(page); await begin(page);
  await page.setViewportSize({ width: 1080, height: 800 }); await expect(page.locator('.browser-drag-guide')).toHaveCount(0); await page.mouse.up(); expect(inputs).toEqual([]);
});
test('rejects a drag that becomes stale between release and server delivery', async ({ page, request }) => {
  await open(page); let release!: () => void, began!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), received = new Promise<void>(resolve => { began = resolve; });
  await page.route(`**/api/sessions/${session.id}/browser`, async route => { if (route.request().method() === 'POST' && route.request().postDataJSON().action === 'drag') { began(); await gate; } await route.continue(); });
  try {
    await begin(page); await page.mouse.up(); await received;
    const opened = await (await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'open', url: base + '/browser-next' } })).json(); release();
    await expect(page.getByRole('alert')).toContainText('browser view changed');
    const state = await (await request.get(`/api/sessions/${session.id}/browser`)).json(); expect(state.activeId).toBe(opened.activeId);
  } finally { release(); }
});
test('scales a gesture in a narrow panel without overflowing its controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'light' }); await open(page);
  await begin(page, 88, 237, 265, 237);
  await page.screenshot({ path: '.ui-audit/browser-drag-mobile.png', animations: 'disabled' });
  await page.mouse.up();
  await expect(page.getByRole('tab', { name: /Preview volume (7\d|8\d|9\d)%/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
