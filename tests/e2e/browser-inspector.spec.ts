import { test, expect, type Page } from './fixtures';
import { mkdir } from 'node:fs/promises';

let session: { id: string }, url: string;
test.beforeEach(async ({ request }) => {
  const settings = await (await request.get('/api/settings')).json();
  session = await (await request.post('/api/sessions', { data: { workspace: settings.workspace, title: 'Refine the workspace', providerId: 'fixture', model: 'test-model', architecture: null, permissionMode: 'auto' } })).json();
  url = settings.providers.find((provider: { id: string }) => provider.id === 'fixture').baseUrl + '/browser-inspector';
  expect((await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'open', url } })).ok()).toBe(true);
});
test.afterEach(async ({ request }) => { await request.delete(`/api/sessions/${session.id}`); });
async function open(page: Page) {
  await page.goto(`/#session/${session.id}`); await page.getByRole('button', { name: 'Show workspace panel' }).click(); await page.getByRole('tab', { name: 'Browser', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Comment on browser page' })).toBeEnabled(); await page.getByRole('button', { name: 'Comment on browser page' }).click();
}
async function select(page: Page) {
  const surface = page.getByLabel('Select an area of the page'), box = (await surface.boundingBox())!;
  const dimensions = await page.getByRole('img', { name: 'Frozen browser page for visual feedback' }).evaluate((image: HTMLImageElement) => ({ width: image.naturalWidth, height: image.naturalHeight }));
  await surface.click({ position: { x: 90 / dimensions.width * box.width, y: 100 / dimensions.height * box.height } });
  await expect(page.getByRole('button', { name: 'Adjust element', exact: true })).toBeVisible();
  await expect(page.locator('.browser-comment-context code')).toHaveText('h1');
}
async function draft(page: Page) { return page.evaluate(id => JSON.parse(localStorage.getItem(`litespeed:draft:v1:browser-feedback:${id}`)!), session.id); }

test('element adjustments preserve typing and the exact preview through reload without sending a message', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await open(page);
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/sessions/${session.id}/browser/inspect`, async route => { if (route.request().postDataJSON().action === 'select') await held; await route.continue(); });
  const selection = select(page); await expect(page.getByRole('status').filter({ hasText: 'Working on the page' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Browser comment' }).fill('Keep this note while selecting.'); release(); await selection;
  await expect(page.getByRole('textbox', { name: 'Browser comment' })).toHaveValue('Keep this note while selecting.');
  const original = JSON.parse((await draft(page)).attachments[0].content);
  await page.setViewportSize({ width: 1360, height: 1000 });
  expect(original.element.selector).toContain('h1');
  await page.getByRole('button', { name: 'Adjust element', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Font size', exact: true }).fill('40');
  await page.getByRole('combobox', { name: 'Element font' }).selectOption('Georgia');
  await page.getByRole('spinbutton', { name: 'Padding', exact: true }).fill('12');
  await page.getByRole('textbox', { name: 'Element text' }).fill('Room for a good idea.');
  expect(JSON.parse((await draft(page)).attachments[0].content).pendingChanges.fontSize).toBe(40);
  await page.getByRole('button', { name: 'Preview changes' }).click(); await expect(page.getByRole('button', { name: 'Add to chat', exact: true })).toBeEnabled();
  const saved = await draft(page), metadata = JSON.parse(saved.attachments[0].content);
  expect(metadata.changes).toEqual({ text: 'Room for a good idea.', fontFamily: 'Georgia', fontSize: 40, padding: 12 });
  expect(metadata.width).toBe(original.width);
  expect(metadata.selection).toEqual(metadata.element.region); expect(metadata.element.region.height).toBeGreaterThan(original.element.region.height);
  await page.getByRole('textbox', { name: 'Browser comment' }).fill('Use this type treatment, with the extra breathing room.');
  await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/browser-element-preview-desktop.png', animations: 'disabled' });
  await page.reload(); await expect(page.getByRole('textbox', { name: 'Browser comment' })).toHaveValue('Use this type treatment, with the extra breathing room.');
  await expect(page.getByRole('img', { name: 'Frozen browser page for visual feedback' })).toHaveAttribute('src', saved.attachments[0].dataUrl);
  const before = (await (await request.get(`/api/sessions/${session.id}`)).json()).messages.length;
  await page.getByRole('button', { name: 'Add to chat', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message Litespeed' })).toContainText('extra breathing room');
  const message = await page.evaluate(id => JSON.parse(localStorage.getItem(`litespeed:draft:v1:${id}`)!), session.id);
  expect(message.attachments[0].content).toContain('Requested visual adjustments'); expect(message.attachments[0].content).toContain('"fontSize":40');
  expect((await (await request.get(`/api/sessions/${session.id}`)).json()).messages.length).toBe(before);
  await expect(page.getByRole('button', { name: 'Comment on browser page' })).toBeEnabled();
});
test('mobile adjustments align, retain unfinished fields, and reset before selecting another area', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'light' }); await open(page); await select(page);
  await page.getByRole('button', { name: 'Adjust element', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Font size', exact: true }).fill('2');
  await expect(page.getByRole('region', { name: 'Browser page comment' })).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: 'Show workspace panel' }).click(); await page.getByRole('button', { name: 'Adjust element', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Font size', exact: true })).toHaveValue('2');
  await page.getByRole('spinbutton', { name: 'Font size', exact: true }).fill('36');
  await page.getByRole('button', { name: 'Adjust element', exact: true }).click();
  await page.getByRole('textbox', { name: 'Browser comment' }).fill('Make this a little larger.');
  await page.getByRole('button', { name: 'Adjust element', exact: true }).click();
  await page.getByRole('button', { name: 'Preview changes' }).click(); await expect(page.getByRole('button', { name: 'Add to chat', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Adjust element', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Font size', exact: true }).scrollIntoViewIfNeeded();
  const size = (await page.getByRole('spinbutton', { name: 'Font size', exact: true }).boundingBox())!, font = (await page.getByRole('combobox', { name: 'Element font' }).boundingBox())!;
  expect(Math.abs(size.y - font.y)).toBeLessThan(1); expect(size.height).toBe(font.height); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/browser-element-adjustments-mobile.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Reset', exact: true }).click(); await expect(page.getByRole('button', { name: 'Use whole page' })).toBeEnabled();
  await page.getByRole('button', { name: 'Use whole page' }).click(); await expect(page.getByRole('button', { name: 'Adjust element', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Browser comment' })).toHaveValue('Make this a little larger.');
});
test('a page change reports an expired selection and preserves the comment and pending adjustments', async ({ page, request }) => {
  await open(page); await select(page); await page.getByRole('button', { name: 'Adjust element', exact: true }).click();
  await page.getByRole('button', { name: 'Adjust element', exact: true }).click();
  await page.getByRole('textbox', { name: 'Browser comment' }).fill('Keep this feedback after the reload.');
  await page.getByRole('button', { name: 'Adjust element', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Font size', exact: true }).fill('48');
  expect((await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'reload' } })).ok()).toBe(true);
  await page.getByRole('button', { name: 'Preview changes' }).click(); await expect(page.getByRole('alert')).toContainText('expired');
  await expect(page.getByRole('spinbutton', { name: 'Font size', exact: true })).toHaveValue('48');
  await page.getByRole('button', { name: 'Refresh snapshot' }).click();
  await expect(page.getByRole('button', { name: 'Adjust element', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Browser comment' })).toHaveValue('Keep this feedback after the reload.');
  await select(page); await expect(page.getByRole('button', { name: 'Add to chat', exact: true })).toBeEnabled();
});
