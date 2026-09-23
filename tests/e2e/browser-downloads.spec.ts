import { test, expect, type Page } from './fixtures';
import { mkdir, readFile } from 'node:fs/promises';

let session: { id: string }, url: string;
test.beforeEach(async ({ request }) => {
  const settings = await (await request.get('/api/settings')).json();
  session = await (await request.post('/api/sessions', { data: { workspace: settings.workspace, title: 'Weekly project report', providerId: 'fixture', model: 'test-model', permissionMode: 'auto', architecture: null } })).json();
  url = settings.providers.find((provider: { id: string }) => provider.id === 'fixture').baseUrl + '/browser-downloads';
});
test.afterEach(async ({ request }) => { await request.delete(`/api/sessions/${session.id}`); });
async function open(page: Page) { await page.goto(`/#session/${session.id}`); await page.getByRole('button', { name: 'Show workspace panel' }).click(); await page.getByRole('tab', { name: 'Browser', exact: true }).click(); }
test('downloads stay with a task, save with their filename, and can be removed', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'open', url } });
  await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'click', ref: 'e1' } });
  await open(page); await page.getByRole('button', { name: 'Browser downloads', exact: true }).click();
  const save = page.getByRole('link', { name: 'Save weekly-report.csv' }); await expect(save).toBeVisible();
  const downloadEvent = page.waitForEvent('download'); await save.click(); const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('weekly-report.csv');
  expect(await readFile((await download.path())!, 'utf8')).toBe('project,tasks\nLitespeed,42\n');
  await expect(page.getByRole('img', { name: 'Browser preview of Project exports' })).toBeVisible();
  await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/browser-downloads-desktop.png' });
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Browser downloads', exact: true })).toBeFocused();
  await page.reload(); await page.getByRole('button', { name: 'Browser downloads', exact: true }).click(); await expect(save).toBeVisible();
  const second = await (await request.post('/api/sessions', { data: { title: 'Other task' } })).json();
  try { const item = (await (await request.get(`/api/sessions/${session.id}/browser`)).json()).downloads[0]; expect((await request.get(`/api/sessions/${second.id}/browser/downloads/${item.id}`)).ok()).toBe(false); }
  finally { await request.delete(`/api/sessions/${second.id}`); }
  await page.getByRole('button', { name: 'Remove download weekly-report.csv' }).click(); await expect(page.getByText('No downloads yet', { exact: true })).toBeVisible();
});
test('download controls and the save list fit a narrow browser panel', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await open(page);
  await page.getByRole('button', { name: 'Browser downloads', exact: true }).click(); await expect(page.getByText('No downloads yet', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close downloads' }).click();
  await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'open', url } });
  await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'click', ref: 'e1' } });
  await page.getByRole('button', { name: 'Browser downloads', exact: true }).click(); await expect(page.getByRole('link', { name: 'Save weekly-report.csv' })).toBeVisible();
  const width = await page.getByLabel('Interactive browser page').evaluate(element => element.clientWidth);
  await expect.poll(async () => (await (await request.get(`/api/sessions/${session.id}/browser`)).json()).width).toBe(width);
  await expect.poll(async () => page.getByRole('img', { name: 'Browser preview of Project exports' }).evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(width);
  await expect(page.getByRole('button', { name: 'Reload page', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const panel = await page.getByRole('region', { name: 'Browser downloads', exact: true }).boundingBox(); expect(panel!.x).toBeGreaterThanOrEqual(0); expect(panel!.x + panel!.width).toBeLessThanOrEqual(390);
  await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/browser-downloads-mobile.png' });
});
