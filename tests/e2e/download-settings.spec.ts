import { test, expect, type Page } from './fixtures';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let directory: string, session: { id: string }, url: string, originalBrowser: unknown;
test.beforeEach(async ({ request }) => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-save-downloads-')));
  const settings = await (await request.get('/api/settings')).json(); originalBrowser = settings.browser || { searchEngine: 'google', rememberHistory: true };
  session = await (await request.post('/api/sessions', { data: { workspace: settings.workspace, title: 'Downloads, right where you need them', providerId: 'fixture', model: 'test-model', architecture: null, permissionMode: 'auto' } })).json();
  url = settings.providers.find((provider: { id: string }) => provider.id === 'fixture').baseUrl + '/browser-downloads';
});
test.afterEach(async ({ request }) => { await request.patch('/api/settings', { data: { browser: originalBrowser } }); await request.delete(`/api/sessions/${session.id}`); await rm(directory, { recursive: true, force: true }); });
async function settings(page: Page) { await page.goto(`/#session/${session.id}`); if ((page.viewportSize()?.width ?? 1440) < 750) await page.getByRole('button', { name: 'Open navigation' }).click(); await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Browser', exact: true }).click(); }
async function downloads(page: Page) { await page.getByRole('button', { name: 'Show workspace panel' }).click(); await page.getByRole('tab', { name: 'Browser', exact: true }).click(); await page.getByRole('button', { name: 'Browser downloads', exact: true }).click(); }

test('saves to the selected folder without overwriting and leaves saved copies after removal', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await settings(page);
  await page.getByRole('textbox', { name: 'Browser download folder' }).fill(directory);
  await page.getByRole('switch', { name: 'Save downloads automatically' }).check();
  await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/download-settings-desktop.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Save settings' }).click();
  await writeFile(join(directory, 'weekly-report.csv'), 'keep my existing file');
  await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'open', url } });
  await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'click', ref: 'e1' } });
  await expect.poll(async () => (await (await request.get(`/api/sessions/${session.id}/browser`)).json()).downloads[0]?.savedPath).toBe(join(directory, 'weekly-report (1).csv'));
  expect(await readFile(join(directory, 'weekly-report.csv'), 'utf8')).toBe('keep my existing file'); expect(await readFile(join(directory, 'weekly-report (1).csv'), 'utf8')).toBe('project,tasks\nLitespeed,42\n');
  await downloads(page); await expect(page.getByText('Saved as weekly-report (1).csv')).toBeVisible();
  const viewportWidth = await page.getByLabel('Interactive browser page').evaluate(element => Math.max(320, Math.round(element.clientWidth)));
  await expect.poll(() => page.locator('.browser-viewport img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(viewportWidth);
  await page.screenshot({ path: '.ui-audit/download-saved-desktop.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Remove download weekly-report.csv' }).click(); await expect(page.getByText('No downloads yet', { exact: true })).toBeVisible();
  expect(await readFile(join(directory, 'weekly-report (1).csv'), 'utf8')).toContain('Litespeed,42');
});
test('failed automatic saves retain the file and recover with Retry', async ({ page, request }) => {
  await request.patch('/api/settings', { data: { browser: { searchEngine: 'google', rememberHistory: true, autoSaveDownloads: true, downloadDirectory: directory } } });
  await rm(directory, { recursive: true });
  await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'open', url } }); await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'click', ref: 'e1' } });
  await page.goto(`/#session/${session.id}`); await downloads(page);
  await expect(page.getByText('The download folder is unavailable. Choose an existing folder.')).toBeVisible(); await expect(page.getByRole('link', { name: 'Save weekly-report.csv' })).toBeVisible();
  await mkdir(directory); await page.getByRole('button', { name: 'Retry saving weekly-report.csv' }).click(); await expect(page.getByText(/Saved to litespeed-save-downloads/)).toBeVisible();
  expect(await readFile(join(directory, 'weekly-report.csv'), 'utf8')).toContain('Litespeed,42'); await expect(page.getByRole('button', { name: 'Retry saving weekly-report.csv' })).toHaveCount(0);
});
test('download preferences fit mobile and choosing a native folder keeps the dialog draft', async ({ page }) => {
  await page.addInitScript(path => { window.litespeedDesktop = { platform: 'darwin', chooseFolder: async () => path }; }, directory);
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'light' }); await settings(page);
  await page.getByRole('button', { name: 'Choose download folder' }).click(); await expect(page.getByRole('textbox', { name: 'Browser download folder' })).toHaveValue(directory);
  await page.getByRole('switch', { name: 'Save downloads automatically' }).check();
  await page.getByRole('textbox', { name: 'Browser download folder' }).scrollIntoViewIfNeeded(); await page.screenshot({ path: '.ui-audit/download-settings-mobile.png', animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Use default', exact: true }).click(); await expect(page.getByRole('textbox', { name: 'Browser download folder' })).toHaveValue('');
});
