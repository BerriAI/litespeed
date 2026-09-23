import { test, expect, type Page } from './fixtures';

let session: { id: string }, base: string, originalTab: string;
test.beforeEach(async ({ request }) => {
  const settings = await (await request.get('/api/settings')).json(); base = settings.providers.find((provider: { id: string }) => provider.id === 'fixture').baseUrl;
  session = await (await request.post('/api/sessions', { data: { workspace: settings.workspace, title: 'A quieter workspace', providerId: 'fixture', model: 'test-model', architecture: null, permissionMode: 'auto' } })).json();
  const opened = await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'open', url: base + '/browser-find' } }); expect(opened.ok()).toBe(true); originalTab = (await opened.json()).activeId;
});
test.afterEach(async ({ request }) => { await request.post(`/api/sessions/${session.id}/cancel`); await request.delete(`/api/sessions/${session.id}`); });
async function settled(page: Page) {
  await expect(page.getByRole('button', { name: 'Reload page', exact: true })).toBeEnabled();
  await expect.poll(() => page.locator('.browser-viewport').evaluate(element => { const image = element.querySelector('img'); return image?.complete && image.naturalWidth === Math.max(320, Math.min(1280, Math.round(element.clientWidth))) && image.naturalHeight === Math.max(240, Math.min(1200, Math.round(element.clientHeight))); })).toBe(true);
  await expect(page.getByRole('button', { name: 'Reload page', exact: true })).toBeEnabled();
}
async function open(page: Page) {
  await page.goto(`/#session/${session.id}`); await page.getByRole('button', { name: 'Show workspace panel' }).click(); await page.getByRole('tab', { name: 'Browser', exact: true }).click(); await settled(page);
}
async function find(page: Page, term: string) {
  await page.getByRole('button', { name: 'Find on page', exact: true }).click(); await page.getByRole('textbox', { name: 'Find on page', exact: true }).fill(term);
}
const count = (page: Page) => page.getByRole('search', { name: 'Find on page' }).getByRole('status');

test('finds visible website text with keyboard navigation, highlights, case matching and an intact draft', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await open(page);
  const composer = page.getByRole('textbox', { name: 'Message Litespeed' }); await composer.fill('Keep these notes for later.');
  await page.getByLabel('Interactive browser page').focus(); await page.keyboard.press('ControlOrMeta+f');
  const input = page.getByRole('textbox', { name: 'Find on page', exact: true }); await expect(input).toBeFocused(); await input.fill('quiet'); await expect(count(page)).toHaveText('1 of 4'); await settled(page);
  await expect.poll(() => page.locator('.browser-image-frame img').evaluate((img: HTMLImageElement) => { const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight; const context = canvas.getContext('2d')!; context.drawImage(img, 0, 0); const data = context.getImageData(0, 0, canvas.width, canvas.height).data; let pixels = 0; for (let i = 0; i < data.length; i += 4) if (data[i] > 220 && data[i + 1] > 140 && data[i + 1] < 240 && data[i + 2] < 170) pixels++; return pixels; })).toBeGreaterThan(100);
  await page.screenshot({ path: '.ui-audit/browser-find-desktop.png', animations: 'disabled' });
  await input.press('Enter'); await expect(count(page)).toHaveText('2 of 4'); await settled(page);
  await input.press('Shift+Enter'); await expect(count(page)).toHaveText('1 of 4'); await settled(page);
  await page.getByRole('button', { name: 'Match case on page' }).click(); await expect(count(page)).toHaveText('1 of 3'); await settled(page);
  await input.press('Escape'); await expect(input).toHaveCount(0); await expect(page.getByLabel('Interactive browser page')).toBeFocused(); await settled(page);
  await expect(composer).toHaveText('Keep these notes for later.'); expect((await (await request.get(`/api/sessions/${session.id}/browser`)).json()).find).toBeUndefined();
});
test('coalesces rapid searches and lets Escape clear an outstanding result without reopening', async ({ page, request }) => {
  await open(page); let release!: () => void, arrived = false; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/sessions/${session.id}/browser`, async route => { if (route.request().method() !== 'POST' || route.request().postDataJSON().action !== 'find' || arrived) return route.continue(); const response = await route.fetch(); arrived = true; await gate; await route.fulfill({ response }).catch(() => {}); });
  try {
    await find(page, 'quiet'); await expect.poll(() => arrived).toBe(true);
    const input = page.getByRole('textbox', { name: 'Find on page', exact: true }); await input.fill('morning'); await input.fill('workspace');
    release(); await expect(count(page)).toHaveText('1 of 1'); await settled(page);
    await input.fill('unmatched phrase'); await input.press('Escape'); await expect(input).toHaveCount(0); await settled(page);
    await expect.poll(async () => (await (await request.get(`/api/sessions/${session.id}/browser`)).json()).find).toBeUndefined();
  } finally { release(); }
});
test('keeps each tab’s search independent and resets cleanly after navigating', async ({ page }) => {
  await open(page); await find(page, 'quiet'); await expect(count(page)).toHaveText('1 of 4'); await settled(page);
  await page.getByRole('textbox', { name: 'Find on page', exact: true }).press('Enter'); await expect(count(page)).toHaveText('2 of 4'); await settled(page);
  await page.getByRole('button', { name: 'New browser tab', exact: true }).click(); await expect(page.getByRole('button', { name: 'Reload page', exact: true })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: 'Find on page', exact: true })).toHaveValue('');
  await page.getByRole('tab', { name: 'Field notes', exact: true }).click(); await expect(count(page)).toHaveText('2 of 4'); await settled(page);
  const address = page.getByRole('combobox', { name: 'Browser address' }); await address.fill(base + '/browser-next'); await address.press('Enter');
  await expect(page.getByRole('tab', { name: 'Next page', exact: true })).toBeVisible(); await expect(page.getByRole('textbox', { name: 'Find on page', exact: true })).toHaveValue('');
});
test('fits a narrow light panel and provides a clear no-match result', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'light' }); await open(page); await find(page, 'quiet'); await expect(count(page)).toHaveText('1 of 4'); await settled(page);
  for (const name of ['Close page search', 'Find on page', 'Open page in external browser']) { const element = page.getByRole(name === 'Open page in external browser' ? 'link' : 'button', { name, exact: true }); const box = (await element.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390); }
  await page.screenshot({ path: '.ui-audit/browser-find-mobile.png', animations: 'disabled' });
  await page.getByRole('textbox', { name: 'Find on page', exact: true }).fill('no such phrase'); await expect(count(page)).toHaveText('No matches'); await expect(page.getByRole('button', { name: 'Next page match' })).toBeDisabled();
});
test('allows closing search while the agent holds browser ownership and rejects manual searches', async ({ page, request }) => {
  await open(page); await find(page, 'quiet'); await expect(count(page)).toHaveText('1 of 4'); await settled(page);
  expect((await request.post(`/api/sessions/${session.id}/messages`, { data: { content: 'TUI_QUEUE_HOLD' } })).ok()).toBe(true);
  await expect(page.getByRole('button', { name: 'Stop generation', exact: true })).toBeVisible(); await expect(page.getByRole('textbox', { name: 'Find on page', exact: true })).toBeDisabled();
  const response = await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'find', tabId: originalTab, url: base + '/browser-find', text: 'quiet' } }); expect(response.status()).toBe(409);
  await page.getByRole('button', { name: 'Close page search' }).click(); await expect(page.getByRole('search', { name: 'Find on page' })).toHaveCount(0);
});
