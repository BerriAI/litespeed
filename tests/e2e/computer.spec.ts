import { test, expect, type Page } from './fixtures';
import { mkdir } from 'node:fs/promises';

let session: { id: string };
test.beforeEach(async ({ request }) => {
  const settings = await (await request.get('/api/settings')).json();
  session = await (await request.post('/api/sessions', { data: { workspace: settings.workspace, title: 'Computer workspace', providerId: 'fixture', model: 'test-model', architecture: null, permissionMode: 'auto' } })).json();
  await request.post('/fixture/computer', { data: { capture: true } });
});
test.afterEach(async ({ request }) => { await request.delete(`/api/sessions/${session.id}`); await request.post('/fixture/computer', { data: { capture: true } }); });
async function open(page: Page) {
  await page.goto(`/#session/${session.id}`); await page.getByRole('button', { name: 'Show workspace panel' }).click();
  await page.getByRole('tab', { name: 'Computer', exact: true }).click();
}
async function select(page: Page) {
  await page.getByRole('button', { name: 'Choose a window', exact: true }).click();
  await page.getByRole('button', { name: 'Fixture Notes Project notes' }).click();
  await expect(page.getByRole('img', { name: 'Computer preview of Fixture Notes' })).toBeVisible();
}

test('window picker, preview and queued keyboard input work together', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const before = (await (await request.get('/fixture/computer')).json()).calls.length;
  await open(page);
  await expect(page.getByText('Your apps, beside your work', { exact: true })).toBeVisible();
  expect((await (await request.get('/fixture/computer')).json()).calls.length).toBe(before);
  await select(page);
  const preview = page.getByRole('img', { name: 'Computer preview of Fixture Notes' }), bounds = (await preview.boundingBox())!;
  await preview.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
  await expect(page.getByRole('button', { name: 'Refresh computer window' })).toBeEnabled();
  await page.getByLabel('Interactive desktop window').focus();
  await page.keyboard.press('Meta+A'); await page.keyboard.type('Keep the workspace quiet and focused.');
  await expect.poll(async () => (await (await request.get(`/api/sessions/${session.id}/computer`)).json()).elements[0]?.value).toBe('Keep the workspace quiet and focused.');
  await expect(page.getByRole('button', { name: 'Refresh computer window' })).toBeEnabled();
  await preview.hover(); await page.mouse.wheel(0, 180);
  await expect.poll(async () => (await (await request.get('/fixture/computer')).json()).calls.filter((call: string) => call === 'scroll').length).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Refresh computer window' })).toBeEnabled();
  await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/computer-desktop-fixture.png' });
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Choose computer window' })).toBeFocused();
  await page.getByRole('button', { name: 'Release computer window' }).click();
  await expect(page.getByText('Your apps, beside your work', { exact: true })).toBeVisible();
  await expect(preview).toHaveCount(0);
});

test('agent computer activity opens the matching workspace view', async ({ page }) => {
  await page.goto(`/#session/${session.id}`);
  await page.getByRole('textbox', { name: 'Message Litespeed' }).fill('DESKTOP_COMPUTER'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Assistant message' }).last()).toContainText('The selected window is beside');
  await expect(page.getByRole('tab', { name: 'Computer', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('img', { name: 'Computer preview of Fixture Notes' })).toBeVisible();
});

test('missing capture clears the old preview and disables ungrounded controls', async ({ page, request }) => {
  await open(page); await select(page);
  await request.post('/fixture/computer', { data: { capture: false } }); await page.getByRole('button', { name: 'Refresh computer window' }).click();
  await expect(page.getByText('Preview unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Computer preview of Fixture Notes' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Type into computer', exact: true })).toBeDisabled();
  await request.post('/fixture/computer', { data: { capture: true } }); await page.getByRole('button', { name: 'Refresh computer window' }).click();
  await expect(page.getByRole('img', { name: 'Computer preview of Fixture Notes' })).toBeVisible();
});

test('computer picker and workspace navigation fit a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await open(page);
  await page.getByRole('button', { name: 'Choose a window', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fixture Notes Project notes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close workspace', exact: true })).toBeInViewport();
  const header = await page.locator('.panel-header').boundingBox(), close = await page.getByRole('button', { name: 'Close workspace', exact: true }).boundingBox();
  expect(close!.x + close!.width).toBeLessThanOrEqual(header!.x + header!.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/computer-mobile-picker.png' });
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Choose computer window' })).toBeFocused();
});

test('installed app search opens the verified window and restores keyboard focus', async ({ page, request }) => {
  await open(page);
  await page.getByRole('button', { name: 'Choose a window', exact: true }).click();
  await page.getByRole('button', { name: 'Open an app…', exact: true }).click();
  const search = page.getByRole('textbox', { name: 'Search installed apps' });
  await expect(search).toBeFocused(); await search.fill('terminal');
  await expect(page.getByText('No matching apps', { exact: true })).toBeVisible();
  await search.fill('notes');
  const option = page.getByRole('button', { name: 'Fixture Notes Running', exact: true });
  await expect(option).toBeVisible();
  await page.keyboard.press('ArrowDown'); await expect(option).toBeFocused();
  await page.screenshot({ path: '.ui-audit/computer-app-picker-desktop.png', animations: 'disabled' });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('img', { name: 'Computer preview of Fixture Notes' })).toBeVisible();
  await expect(page.getByLabel('Interactive desktop window')).toBeFocused();
  expect((await (await request.get('/fixture/computer')).json()).calls).toContain('launch_app');
});

test('scaled preview drag moves the real rendered slider', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await open(page); await select(page);
  const fixture = await (await request.get('/fixture/computer')).json(), slider = fixture.slider;
  const image = page.getByRole('img', { name: 'Computer preview of Fixture Notes' }), bounds = (await image.boundingBox())!;
  const start = { x: slider.bounds.x + 8 + (slider.bounds.width - 16) * Number(slider.value) / 100, y: slider.bounds.y + slider.bounds.height / 2 };
  const end = { x: slider.bounds.x + 8 + (slider.bounds.width - 16) * 0.8, y: start.y };
  const at = (point: { x: number; y: number }) => ({ x: bounds.x + point.x * bounds.width / 960, y: bounds.y + point.y * bounds.height / 640 });
  await page.mouse.move(at(start).x, at(start).y); await page.mouse.down(); await page.mouse.move(at(end).x, at(end).y, { steps: 8 });
  await expect(page.locator('.computer-drag-guide')).toBeVisible();
  await page.screenshot({ path: '.ui-audit/computer-drag-desktop.png', animations: 'disabled' });
  await page.mouse.up();
  await expect.poll(async () => Number((await (await request.get('/fixture/computer')).json()).slider.value)).toBeGreaterThanOrEqual(78);
  await expect(page.locator('.computer-drag-guide')).toHaveCount(0);
  const drag = (await (await request.get('/fixture/computer')).json()).lastDrag;
  // WebKit delivers whole CSS pixel pointer positions; allow that one display
  // pixel after scaling, plus the integer screenshot-coordinate rounding.
  const tolerance = Math.ceil(960 / bounds.width) + 1;
  expect(Math.abs(drag.from_x - start.x)).toBeLessThanOrEqual(tolerance); expect(Math.abs(drag.to_x - end.x)).toBeLessThanOrEqual(tolerance);
  expect(drag.pid).toBe(7331); expect(drag.window_id).toBe(9001);
  await expect(page.getByRole('button', { name: 'Refresh computer window' })).toBeEnabled();
});

test('escape and releases outside the preview cancel computer drag', async ({ page, request }) => {
  await open(page); await select(page);
  const fixture = await (await request.get('/fixture/computer')).json(), before = fixture.calls.filter((call: string) => call === 'drag' || call === 'click').length;
  const bounds = (await page.getByRole('img', { name: 'Computer preview of Fixture Notes' }).boundingBox())!;
  const start = { x: bounds.x + bounds.width / 3, y: bounds.y + bounds.height / 2 };
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 35, start.y + 35);
  await expect(page.locator('.computer-drag-guide')).toBeVisible();
  await page.keyboard.press('Escape'); await page.mouse.up(); await expect(page.locator('.computer-drag-guide')).toHaveCount(0);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(bounds.x - 10, start.y); await page.mouse.up();
  await expect(page.locator('.computer-drag-guide')).toHaveCount(0);
  expect((await (await request.get('/fixture/computer')).json()).calls.filter((call: string) => call === 'drag' || call === 'click')).toHaveLength(before);
});

test('installed app picker fits mobile and preserves an unmatched query', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await open(page);
  await page.getByRole('button', { name: 'Choose a window', exact: true }).click();
  await page.getByRole('button', { name: 'Open an app…', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search installed apps' }).fill('notes');
  await expect(page.getByRole('button', { name: 'Fixture Notes Running' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open windows', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.ui-audit/computer-app-picker-mobile.png', animations: 'disabled' });
  await page.getByRole('textbox', { name: 'Search installed apps' }).fill('missing');
  await expect(page.getByText('No matching apps', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Choose computer window' })).toBeFocused();
});
