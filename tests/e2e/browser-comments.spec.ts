import { test, expect, type Page } from './fixtures';
import { mkdir } from 'node:fs/promises';

let session: { id: string }, url: string;
test.beforeEach(async ({ request }) => {
  const settings = await (await request.get('/api/settings')).json();
  session = await (await request.post('/api/sessions', { data: { workspace: settings.workspace, title: 'Polish the project page', providerId: 'fixture', model: 'test-model', architecture: null, permissionMode: 'auto' } })).json();
  url = settings.providers.find((provider: { id: string }) => provider.id === 'fixture').baseUrl + '/browser-downloads';
  await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'open', url } });
});
test.afterEach(async ({ request }) => { await request.delete(`/api/sessions/${session.id}`); });
async function open(page: Page) {
  await page.goto(`/#session/${session.id}`); await page.getByRole('button', { name: 'Show workspace panel' }).click(); await page.getByRole('tab', { name: 'Browser', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Browser preview of Project exports' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Comment on browser page' })).toBeEnabled();
}
test('area feedback keeps its exact snapshot through reload and appends to the existing draft', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await open(page);
  await page.getByRole('textbox', { name: 'Message Litespeed' }).fill('Keep the existing colors.');
  await page.getByRole('button', { name: 'Comment on browser page' }).click();
  const surface = page.getByLabel('Select an area of the page'), bounds = (await surface.boundingBox())!;
  await page.mouse.move(bounds.x + 25, bounds.y + 55); await page.mouse.down(); await page.mouse.move(bounds.x + 290, bounds.y + 170, { steps: 8 }); await page.mouse.up();
  await page.getByRole('textbox', { name: 'Browser comment' }).fill('Align the heading and supporting text with the button.');
  const source = await page.getByRole('img', { name: 'Frozen browser page for visual feedback' }).getAttribute('src');
  await page.getByRole('tab', { name: 'Files', exact: true }).click(); await page.getByRole('tab', { name: 'Browser', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Browser comment' })).toHaveValue('Align the heading and supporting text with the button.');
  await page.reload(); await expect(page.getByRole('textbox', { name: 'Browser comment' })).toHaveValue('Align the heading and supporting text with the button.');
  await expect(page.getByRole('img', { name: 'Frozen browser page for visual feedback' })).toHaveAttribute('src', source!);
  await expect(page.locator('.browser-selected-region')).toBeVisible();
  await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/browser-comment-desktop.png' });
  const before = (await (await request.get(`/api/sessions/${session.id}`)).json()).messages.length;
  await page.getByRole('button', { name: 'Add to chat', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Browser page comment' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message Litespeed' })).toContainText('Keep the existing colors.');
  await expect(page.getByRole('textbox', { name: 'Message Litespeed' })).toContainText('Align the heading');
  await expect(page.locator('.attachment-chip')).toHaveCount(1);
  expect((await (await request.get(`/api/sessions/${session.id}`)).json()).messages.length).toBe(before);
  const draft = await page.evaluate(id => JSON.parse(localStorage.getItem(`litespeed:draft:v1:${id}`)!), session.id);
  expect(draft.attachments[0].dataUrl).toMatch(/^data:image\/jpeg;base64,/); expect(draft.attachments[0].dataUrl).not.toBe(source);
  expect(draft.attachments[0].content).toContain('Selected area marked 1');
  await page.reload(); await expect(page.locator('.attachment-chip')).toHaveCount(1); await expect(page.getByRole('region', { name: 'Browser page comment' })).toHaveCount(0);
});
test('whole-page comments work by keyboard and return to the mobile composer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await open(page);
  await page.getByRole('button', { name: 'Comment on browser page' }).click();
  await page.getByRole('button', { name: 'Use whole page', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Browser comment' })).toBeFocused();
  await page.keyboard.type('Give the page a little more breathing room.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/browser-comment-mobile.png' });
  await page.keyboard.press('Meta+Enter');
  await expect(page.getByRole('textbox', { name: 'Message Litespeed' })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Message Litespeed' })).toContainText('breathing room');
  await expect(page.getByRole('button', { name: 'Show workspace panel' })).toBeVisible();
});
test('an unfinished comment is isolated from another task and Escape cancels it cleanly', async ({ page, request }) => {
  await open(page); await page.getByRole('button', { name: 'Comment on browser page' }).click();
  await page.getByRole('textbox', { name: 'Browser comment' }).fill('A comment for this task only.');
  const second = await (await request.post('/api/sessions', { data: { title: 'Separate work' } })).json();
  try {
    await page.evaluate(id => { location.hash = `session/${id}`; }, second.id);
    await page.getByRole('tab', { name: 'Browser', exact: true }).click(); await expect(page.getByRole('region', { name: 'Browser page comment' })).toHaveCount(0);
    await page.evaluate(id => { location.hash = `session/${id}`; }, session.id);
    await expect(page.getByRole('textbox', { name: 'Browser comment' })).toHaveValue('A comment for this task only.');
    await page.getByRole('textbox', { name: 'Browser comment' }).focus(); await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Comment on browser page' })).toBeFocused();
    expect(await page.evaluate(id => localStorage.getItem(`litespeed:draft:v1:browser-feedback:${id}`), session.id)).toBeNull();
  } finally { await request.delete(`/api/sessions/${second.id}`); }
});
