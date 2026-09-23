import { test, expect, type Page } from './fixtures';

let session: { id: string }, base: string, tabId: string;
test.beforeEach(async ({ request }) => {
  const settings = await (await request.get('/api/settings')).json(); base = settings.providers.find((provider: { id: string }) => provider.id === 'fixture').baseUrl;
  session = await (await request.post('/api/sessions', { data: { workspace: settings.workspace, title: 'Look a little closer at the preview', providerId: 'fixture', model: 'test-model', architecture: null, permissionMode: 'ask' } })).json();
  const browser = await (await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'open', url: base + '/browser-diagnostics' } })).json(); tabId = browser.activeId;
});
test.afterEach(async ({ request }) => { await request.delete(`/api/sessions/${session.id}`); });
async function open(page: Page) {
  await page.goto(`/#session/${session.id}`); await page.getByRole('button', { name: 'Show workspace panel' }).click(); await page.getByRole('tab', { name: 'Browser', exact: true }).click();
  await page.getByRole('button', { name: 'Browser developer tools', exact: true }).click(); await expect(page.getByRole('tab', { name: 'Console', exact: true })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Browser console messages' })).toContainText('Preview connected');
  await fittedPreview(page);
}
async function fittedPreview(page: Page) {
  await expect.poll(() => page.locator('.browser-viewport').evaluate(element => element.querySelector('img')?.naturalWidth === Math.max(320, Math.min(1280, Math.round(element.clientWidth))) && element.querySelector('img')?.naturalHeight === Math.max(240, Math.min(1200, Math.round(element.clientHeight))))).toBe(true);
}
test('shows real console and request details with aligned controls and keyboard navigation', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await page.emulateMedia({ colorScheme: 'dark' }); await open(page);
  const panel = page.getByRole('region', { name: 'Browser developer tools' });
  await expect(panel).toContainText('Avatar preview failed to load'); await page.screenshot({ path: '.ui-audit/browser-console-desktop.png', animations: 'disabled' });
  await panel.getByRole('textbox', { name: 'Filter browser console' }).fill('Avatar'); await expect(panel.locator('.browser-console-entry')).toHaveCount(1);
  await panel.locator('.browser-console-entry summary').click(); await expect(panel.locator('.browser-diagnostic-details')).toContainText('/browser-diagnostics');
  await panel.getByRole('tab', { name: 'Console', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Network', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(panel.getByRole('textbox', { name: 'Filter browser network' })).toHaveValue('');
  await page.keyboard.press('ArrowLeft'); await expect(panel.getByRole('textbox', { name: 'Filter browser console' })).toHaveValue('Avatar');
  await panel.getByRole('tab', { name: 'Network', exact: true }).click();
  const request = panel.locator('.browser-network-entry').filter({ hasText: '/browser-missing' }); await expect(request).toContainText('404'); await request.locator('summary').click(); await expect(request.locator('.browser-diagnostic-details')).toContainText(base + '/browser-missing');
  await page.screenshot({ path: '.ui-audit/browser-network-desktop.png', animations: 'disabled' });
  const clear = (await panel.getByRole('button', { name: 'Clear browser network' }).boundingBox())!, close = (await panel.getByRole('button', { name: 'Close browser developer tools' }).boundingBox())!; expect(Math.abs(clear.y - close.y)).toBeLessThan(1);
  await page.keyboard.press('Escape'); await expect(panel).toHaveCount(0); await expect(page.getByRole('button', { name: 'Browser developer tools', exact: true })).toBeFocused(); expect(errors).toEqual([]);
});
test('adds only the displayed diagnostic snapshot to the existing draft without sending it', async ({ page, request }) => {
  await open(page); const composer = page.getByRole('textbox', { name: 'Message Litespeed' }); await composer.fill('Keep my original question.');
  const before = await (await request.get('/fixture/requests')).json();
  await page.getByRole('textbox', { name: 'Filter browser console' }).fill('sample data'); await page.getByRole('button', { name: 'Add browser details to draft' }).click();
  await expect(composer).toContainText('Keep my original question.'); await expect(composer).toContainText('attached browser console output');
  await page.getByRole('button', { name: 'Preview browser-console.txt' }).click(); const dialog = page.getByRole('dialog'); await expect(dialog).toContainText('Using sample data'); await expect(dialog).not.toContainText('Avatar preview failed');
  await dialog.getByRole('button', { name: 'Close dialog' }).click(); expect((await (await request.get('/fixture/requests')).json()).count).toBe(before.count);
  await request.delete(`/api/sessions/${session.id}/browser/diagnostics`, { data: { tabId, view: 'all' } });
  await page.reload(); await expect(page.getByRole('button', { name: 'Preview browser-console.txt' })).toBeVisible(); await page.getByRole('button', { name: 'Preview browser-console.txt' }).click(); await expect(page.getByRole('dialog')).toContainText('Using sample data');
});
test('keeps tabs isolated and clearing console leaves network requests available', async ({ page, request }) => {
  await open(page); const panel = page.getByRole('region', { name: 'Browser developer tools' });
  await panel.getByRole('button', { name: 'Clear browser console' }).click(); await expect(panel).toContainText('No console messages yet.'); await panel.getByRole('tab', { name: 'Network', exact: true }).click(); await expect(panel.locator('.browser-network-entry')).not.toHaveCount(0);
  await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'open', url: base + '/browser-next' } });
  await expect(page.getByRole('tab', { name: 'Next page', exact: true })).toHaveAttribute('aria-selected', 'true'); await expect(panel).not.toContainText('/browser-missing');
  await panel.getByRole('tab', { name: 'Console', exact: true }).click(); await expect(panel).not.toContainText('Preview connected');
  await page.getByRole('button', { name: 'Reload page', exact: true }).click(); await expect(page.getByRole('button', { name: 'Reload page', exact: true })).toBeEnabled();
  const firstTab = page.getByRole('tab', { name: 'Project overview', exact: true }); await firstTab.click(); await expect(panel).toContainText('No console messages yet.');
  await expect(page.getByRole('tab', { name: 'Console', exact: true })).not.toBeFocused();
});
test('fits developer tools on a narrow screen without crowding the browser controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'light' }); await open(page);
  await page.screenshot({ path: '.ui-audit/browser-console-mobile.png', animations: 'disabled' });
  const panel = page.getByRole('region', { name: 'Browser developer tools' }); expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.getByRole('tab', { name: 'Network', exact: true }).click(); await page.screenshot({ path: '.ui-audit/browser-network-mobile.png', animations: 'disabled' });
  const close = (await panel.getByRole('button', { name: 'Close browser developer tools' }).boundingBox())!; expect(close.x + close.width).toBeLessThanOrEqual(390);
  await panel.getByRole('button', { name: 'Close browser developer tools' }).click(); await expect(page.getByRole('button', { name: 'Browser developer tools', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Type into page', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Text to type into page' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Scroll page down', exact: true })).toBeVisible();
  await fittedPreview(page);
  await page.screenshot({ path: '.ui-audit/browser-input-mobile.png', animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Type into page', exact: true })).toBeFocused();
});
test('keeps the page and diagnostic controls reachable in a short window', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 }); await open(page);
  const panel = page.getByRole('region', { name: 'Browser developer tools' });
  await expect(panel.getByRole('button', { name: 'Close browser developer tools' })).toBeInViewport();
  const pageBounds = (await page.locator('.browser-viewport').boundingBox())!; expect(pageBounds.height).toBeGreaterThan(100);
  await page.screenshot({ path: '.ui-audit/browser-console-short.png', animations: 'disabled' });
});
