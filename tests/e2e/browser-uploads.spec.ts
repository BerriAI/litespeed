import { test, expect, type Page, type APIRequestContext } from './fixtures';
import { mkdir } from 'node:fs/promises';
let session: { id: string }, base: string;
test.beforeEach(async ({ request }) => {
  const settings = await (await request.get('/api/settings')).json(); base = settings.providers.find((provider: { id: string }) => provider.id === 'fixture').baseUrl;
  session = await (await request.post('/api/sessions', { data: { workspace: settings.workspace, title: 'Share useful references', providerId: 'fixture', model: 'test-model', architecture: null, permissionMode: 'auto' } })).json();
  expect((await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'open', url: base + '/browser-uploads' } })).ok()).toBe(true);
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
async function choose(page: Page, request: APIRequestContext, multiple = false) {
  await settled(page); expect((await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'click', ref: multiple ? 'e2' : 'e1' } })).ok()).toBe(true);
  await expect(page.getByRole('region', { name: 'Files for website', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: multiple ? 'Choose files' : 'Choose file', exact: true })).toBeEnabled();
}
const file = (name = 'project-notes.md', text = '# Design notes\nKeep it simple.\n') => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });

test('opens a website file chooser from the page keyboard, reviews files and shares their bytes only after Send', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await open(page);
  const composer = page.getByRole('textbox', { name: 'Message Litespeed' }); await composer.fill('Keep this question in my draft.');
  await page.getByLabel('Interactive browser page').focus(); await page.keyboard.press('Tab'); await settled(page); await page.keyboard.press('Enter');
  const region = page.getByRole('region', { name: 'Files for website', exact: true }); await expect(region).toBeVisible(); await expect(region.getByRole('button', { name: 'Choose file', exact: true })).toBeEnabled();
  await expect(region).toContainText('127.0.0.1'); const before = (await (await request.get('/fixture/browser-uploads')).json()).receipts.length, calls = (await (await request.get('/fixture/requests')).json()).count;
  await region.getByLabel('Choose files for website').setInputFiles(file()); await expect(region).toContainText('project-notes.md'); await expect(region.getByRole('button', { name: 'Send file', exact: true })).toBeFocused();
  expect((await (await request.get('/fixture/browser-uploads')).json()).receipts).toHaveLength(before);
  await settled(page); await expect(region.getByRole('button', { name: 'Send file', exact: true })).toBeFocused(); await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/browser-upload-review-desktop.png', animations: 'disabled' });
  await region.getByRole('button', { name: 'Send file', exact: true }).click(); await expect(region).toHaveCount(0);
  await expect.poll(async () => (await (await request.get('/fixture/browser-uploads')).json()).receipts.at(-1)).toEqual([{ name: 'project-notes.md', size: file().buffer.length, text: file().buffer.toString() }]);
  await expect(page.getByRole('tab', { name: 'Files received', exact: true })).toBeVisible(); await expect(composer).toHaveValue('Keep this question in my draft.'); expect((await (await request.get('/fixture/requests')).json()).count).toBe(calls);
  await expect(page.getByLabel('Interactive browser page')).toBeFocused(); await settled(page); await page.screenshot({ path: '.ui-audit/browser-upload-sent-desktop.png', animations: 'disabled' });
});

test('keeps selected files private when canceled and rejects oversized selections without losing a valid choice', async ({ page, request }) => {
  await open(page); await choose(page, request); const region = page.getByRole('region', { name: 'Files for website', exact: true }), input = region.getByLabel('Choose files for website');
  const before = (await (await request.get('/fixture/browser-uploads')).json()).receipts.length;
  await input.setInputFiles(file()); await input.setInputFiles(file('too-large.txt', 'x'.repeat(8 * 1024 * 1024 + 1)));
  await expect(region.getByRole('alert')).toContainText('8 MB'); await expect(region).toContainText('project-notes.md'); await expect(region).not.toContainText('too-large.txt');
  await region.getByRole('button', { name: 'Cancel file upload', exact: true }).focus(); await page.keyboard.press('Escape'); await expect(region).toHaveCount(0); await expect(page.getByLabel('Interactive browser page')).toBeFocused();
  expect((await (await request.get('/fixture/browser-uploads')).json()).receipts).toHaveLength(before);
  await choose(page, request); await expect(region.locator('.browser-upload-files')).toHaveCount(0); await expect(region.getByRole('button', { name: 'Choose file', exact: true })).toBeEnabled();
});

test('keeps review and send controls usable with several long filenames in a short narrow window', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 500 }); await page.emulateMedia({ colorScheme: 'light' }); await open(page); await choose(page, request, true);
  const region = page.getByRole('region', { name: 'Files for website', exact: true });
  await region.getByLabel('Choose files for website').setInputFiles([file('Design decisions and typography notes — September.md'), file('Spacing and alignment review.txt', 'A second reference.'), file('empty.txt', '')]);
  const send = region.getByRole('button', { name: 'Send 3 files', exact: true }); await expect(send).toBeFocused(); await expect(send).toBeInViewport({ ratio: 1 });
  expect(await region.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await settled(page); await expect(send).toBeFocused(); await page.screenshot({ path: '.ui-audit/browser-upload-review-mobile.png', animations: 'disabled' });
  await region.getByRole('button', { name: 'Remove selected file empty.txt', exact: true }).click(); await region.getByRole('button', { name: 'Send 2 files', exact: true }).click(); await expect(region).toHaveCount(0);
  await expect.poll(async () => (await (await request.get('/fixture/browser-uploads')).json()).receipts.at(-1)?.map((file: { name: string }) => file.name)).toEqual(['Design decisions and typography notes — September.md', 'Spacing and alignment review.txt']);
});

test('drops a pending selection when the website navigates and rejects the old request', async ({ page, request }) => {
  await open(page); await choose(page, request); const region = page.getByRole('region', { name: 'Files for website', exact: true }); await region.getByLabel('Choose files for website').setInputFiles(file());
  const pending = (await (await request.get(`/api/sessions/${session.id}/browser`)).json()).upload, before = (await (await request.get('/fixture/browser-uploads')).json()).receipts.length;
  expect((await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'navigate', url: base + '/browser-inspector' } })).ok()).toBe(true); await expect(region).toHaveCount(0);
  const stale = await request.post(`/api/sessions/${session.id}/browser/upload`, { data: { action: 'upload', requestId: pending.id, tabId: pending.tabId, files: [{ name: file().name, mimeType: file().mimeType, data: file().buffer.toString('base64') }] } });
  expect(stale.status()).toBe(409); expect((await (await request.get('/fixture/browser-uploads')).json()).receipts).toHaveLength(before);
});
