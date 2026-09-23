import { test, expect, type Page } from './fixtures';
import { mkdir } from 'node:fs/promises';

let session: { id: string }, url: string, originalBrowser: unknown;
test.beforeEach(async ({ request }) => {
  const settings = await (await request.get('/api/settings')).json(); originalBrowser = settings.browser || { searchEngine: 'google', rememberHistory: true };
  await request.patch('/api/settings', { data: { browser: { searchEngine: 'google', rememberHistory: true } } });
  await request.delete('/api/browser/history', { data: { confirm: true } });
  session = await (await request.post('/api/sessions', { data: { workspace: settings.workspace, title: 'A browser for your work', providerId: 'fixture', model: 'test-model', architecture: null, permissionMode: 'auto' } })).json();
  url = settings.providers.find((provider: { id: string }) => provider.id === 'fixture').baseUrl;
  await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'open', url: url + '/browser-fixture' } });
  await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'navigate', url: url + '/browser-downloads' } });
});
test.afterEach(async ({ request }) => { await request.delete(`/api/sessions/${session.id}`); await request.patch('/api/settings', { data: { browser: originalBrowser } }); });
async function open(page: Page) {
  await page.goto(`/#session/${session.id}`); await page.getByRole('button', { name: 'Show workspace panel' }).click(); await page.getByRole('tab', { name: 'Browser', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Browser preview of Project exports' })).toBeVisible();
  const viewport = page.getByLabel('Interactive browser page');
  await expect.poll(() => page.locator('.browser-viewport img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(await viewport.evaluate(element => Math.max(320, Math.round(element.clientWidth))));
}
async function settings(page: Page) { await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Browser', exact: true }).click(); }
test('history and address suggestions navigate by keyboard without losing task tabs', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await open(page);
  const address = page.getByRole('combobox', { name: 'Browser address' }); await address.fill('workspace');
  await expect(page.getByRole('option', { name: /Workspace preview/ })).toBeVisible();
  await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/browser-address-suggestions.png', animations: 'disabled' });
  await address.press('ArrowDown'); await address.press('Enter');
  await expect(page.getByRole('tab', { name: 'Workspace preview', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect((await (await request.get(`/api/sessions/${session.id}/browser`)).json()).tabs).toHaveLength(1);
  await page.getByRole('button', { name: 'Browser history', exact: true }).click(); await expect(page.getByRole('textbox', { name: 'Search browsing history' })).toBeFocused();
  await page.getByRole('textbox', { name: 'Search browsing history' }).fill('exports');
  await expect(page.locator('.browser-history-open')).toHaveCount(1); await expect(page.locator('.browser-history-open')).toContainText('Project exports');
  await page.screenshot({ path: '.ui-audit/browser-history-desktop.png', animations: 'disabled' });
  await page.locator('.browser-history-open').click(); await expect(page.getByRole('tab', { name: 'Project exports', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Browser history', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Workspace preview from history' }).click();
  await expect(page.locator('.browser-history-open')).toHaveCount(1); await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Browser history', exact: true })).toBeFocused();
});
test('Browser settings save preferences and clearing history leaves tabs available', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await open(page); await settings(page);
  await page.getByRole('combobox', { name: 'Browser search engine' }).selectOption('duckduckgo');
  await page.getByRole('switch', { name: 'Remember browsing history' }).uncheck();
  await page.getByRole('button', { name: 'Save settings' }).click();
  expect((await (await request.get('/api/settings')).json()).browser).toEqual({ searchEngine: 'duckduckgo', rememberHistory: false });
  await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'navigate', url: url + '/browser-next' } });
  expect((await (await request.get('/api/browser/history')).json()).entries.some((entry: { url: string }) => entry.url.endsWith('browser-next'))).toBe(false);
  await settings(page); await page.screenshot({ path: '.ui-audit/browser-settings-desktop.png', animations: 'disabled' });
  const control = (await page.getByRole('combobox', { name: 'Browser search engine' }).boundingBox())!, label = (await page.getByText('Search engine', { exact: true }).boundingBox())!;
  expect(control.height).toBeLessThan(45); expect(control.width).toBeLessThan(180); expect(control.x).toBeGreaterThan(label.x + label.width);
  expect(Math.abs(control.y + control.height / 2 - label.y - label.height / 2)).toBeLessThan(20);
  await page.getByRole('button', { name: 'Clear history', exact: true }).click(); await page.getByRole('button', { name: 'Clear browsing history', exact: true }).click();
  await expect(page.getByText('Browsing history cleared.', { exact: true })).toBeVisible();
  expect((await (await request.get('/api/browser/history')).json()).total).toBe(0);
  expect((await (await request.get(`/api/sessions/${session.id}/browser`)).json()).tabs[0].suspended).toBeUndefined();
});
test('resetting website data keeps saved tab addresses and fits mobile settings', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await open(page);
  await page.getByRole('button', { name: 'Hide workspace panel' }).click();
  await page.getByRole('button', { name: 'Open navigation' }).click(); await settings(page);
  await page.getByRole('button', { name: 'Reset browser', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reset website data', exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: '.ui-audit/browser-settings-mobile.png', animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Reset website data', exact: true }).click();
  await expect(page.getByText('Website data cleared. Reopen a saved tab to browse again.')).toBeVisible();
  expect((await (await request.get(`/api/sessions/${session.id}/browser`)).json()).tabs[0]).toMatchObject({ url: url + '/browser-downloads', suspended: true });
});
