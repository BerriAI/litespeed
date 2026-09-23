import { test, expect, type Page } from './fixtures';

let session: { id: string }, base: string;
test.beforeEach(async ({ request, page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async (text: string) => { (window as any).copiedPageText = text; },
    write: async (items: ClipboardItem[]) => { (window as any).copiedPageText = await (await items[0].getType('text/plain')).text(); },
  } }); });
  const settings = await (await request.get('/api/settings')).json(); base = settings.providers.find((provider: { id: string }) => provider.id === 'fixture').baseUrl;
  session = await (await request.post('/api/sessions', { data: { workspace: settings.workspace, title: 'Useful page references', providerId: 'fixture', model: 'test-model', architecture: null, permissionMode: 'auto' } })).json();
  expect((await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'open', url: base + '/browser-gestures' } })).ok()).toBe(true);
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
async function select(page: Page) {
  const image = page.locator('.browser-image-frame img'), bounds = (await image.boundingBox())!, size = await image.evaluate((image: HTMLImageElement) => ({ width: image.naturalWidth, height: image.naturalHeight }));
  await page.mouse.move(bounds.x + 34 / size.width * bounds.width, bounds.y + 406 / size.height * bounds.height); await page.mouse.down();
  await page.mouse.move(bounds.x + 174 / size.width * bounds.width, bounds.y + 406 / size.height * bounds.height, { steps: 4 });
  const done = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/sessions/${session.id}/browser`) && response.request().postDataJSON().action === 'drag');
  await page.mouse.up(); expect((await done).ok()).toBe(true); await settled(page);
}
test('copies the actual browser selection with the usual shortcut and restores page focus', async ({ page }) => {
  await open(page); await select(page); await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => page.evaluate(() => (window as any).copiedPageText)).toBe('A quiet place to focus');
  await expect(page.getByRole('status')).toContainText('Copied selected text'); await expect(page.getByLabel('Interactive browser page')).toBeFocused();
});
test('offers a compact selection menu and adds a durable snapshot to the existing draft without sending', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await open(page);
  const composer = page.getByRole('textbox', { name: 'Message Litespeed' }); await composer.fill('Keep my original question.'); await select(page);
  const before = await (await request.get('/fixture/requests')).json();
  await page.locator('.browser-image-frame img').click({ button: 'right', position: { x: 170, y: 410 } });
  const menu = page.getByRole('menu', { name: 'Selected page text' }); await expect(menu).toContainText('A quiet place to focus');
  await expect(menu.getByRole('menuitem', { name: /Copy selected text/ })).toBeFocused();
  await page.screenshot({ path: '.ui-audit/browser-selection-desktop.png', animations: 'disabled' });
  await page.keyboard.press('ArrowDown'); await expect(menu.getByRole('menuitem', { name: 'Add selection to draft' })).toBeFocused(); await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0); await expect(composer).toContainText('Keep my original question.'); await expect(composer).toContainText('attached selection'); await expect(composer).toBeFocused();
  await page.getByRole('button', { name: 'Preview browser-selection.txt' }).click(); await expect(page.getByRole('dialog')).toContainText('A quiet place to focus'); await expect(page.getByRole('dialog')).toContainText(base + '/browser-gestures');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'navigate', url: base + '/browser-next' } }); await page.reload();
  await page.getByRole('button', { name: 'Preview browser-selection.txt' }).click(); await expect(page.getByRole('dialog')).toContainText('A quiet place to focus'); expect((await (await request.get('/fixture/requests')).json()).count).toBe(before.count);
});
test('keeps the keyboard menu within a narrow panel and returns focus on Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'light' }); await open(page); await select(page);
  await page.keyboard.press('Shift+F10'); const menu = page.getByRole('menu', { name: 'Selected page text' }); await expect(menu).toContainText('A quiet place to focus');
  await page.screenshot({ path: '.ui-audit/browser-selection-mobile.png', animations: 'disabled' });
  const box = (await menu.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(8); expect(box.x + box.width).toBeLessThanOrEqual(382); expect(box.y + box.height).toBeLessThanOrEqual(836);
  await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0); await expect(page.getByLabel('Interactive browser page')).toBeFocused();
  await page.keyboard.press('Shift+F10'); await menu.getByRole('menuitem', { name: /Copy selected text/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).copiedPageText)).toBe('A quiet place to focus'); await expect(menu).toHaveCount(0);
});
test('an empty selection leaves the clipboard intact and closing a pending menu prevents late reopening', async ({ page }) => {
  await open(page); await page.evaluate(() => { (window as any).copiedPageText = 'Keep the clipboard'; });
  const viewport = page.getByLabel('Interactive browser page'); await viewport.focus(); await page.keyboard.press('ControlOrMeta+c');
  await expect(page.getByRole('status')).toContainText('Select text in the page first.'); expect(await page.evaluate(() => (window as any).copiedPageText)).toBe('Keep the clipboard');
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/sessions/${session.id}/browser/selection`, async route => { const response = await route.fetch(); await gate; await route.fulfill({ response }).catch(() => {}); });
  try {
    await page.keyboard.press('Shift+F10'); const menu = page.getByRole('menu', { name: 'Selected page text' }); await expect(menu).toContainText('Reading selection');
    await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0); release();
    await viewport.press('Tab'); await settled(page); await expect(menu).toHaveCount(0); await expect(viewport).toBeFocused();
  } finally { release(); }
});
