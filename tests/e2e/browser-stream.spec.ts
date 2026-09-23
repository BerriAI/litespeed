import { test, expect, type Page } from './fixtures';
import { mkdir } from 'node:fs/promises';

let session: { id: string }, url: string;
test.beforeEach(async ({ request }) => {
  const settings = await (await request.get('/api/settings')).json();
  session = await (await request.post('/api/sessions', { data: { workspace: settings.workspace, title: 'A smoother browser', providerId: 'fixture', model: 'test-model', architecture: null, permissionMode: 'auto' } })).json();
  url = settings.providers.find((provider: { id: string }) => provider.id === 'fixture').baseUrl + '/browser-motion';
  await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'open', url } });
});
test.afterEach(async ({ request }) => { await request.delete(`/api/sessions/${session.id}`); });
async function open(page: Page) {
  await page.goto(`/#session/${session.id}`); await page.getByRole('button', { name: 'Show workspace panel' }).click(); await page.getByRole('tab', { name: 'Browser', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Browser preview of Live preview' })).toBeVisible();
}
test('animation streams smoothly, stops for comments, and pointer alignment survives resizing', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await open(page);
  const preview = page.locator('.browser-viewport img');
  await expect(preview).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  const frames = await preview.evaluate(image => new Promise<number>(resolve => {
    const values = new Set<string>(), observer = new MutationObserver(() => values.add((image as HTMLImageElement).src));
    observer.observe(image, { attributes: true, attributeFilter: ['src'] });
    setTimeout(() => { observer.disconnect(); resolve(values.size); }, 1200);
  }));
  expect(frames).toBeGreaterThanOrEqual(5);
  const viewport = page.getByLabel('Interactive browser page');
  for (const size of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(size);
    await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(await viewport.evaluate(element => Math.max(320, Math.round(element.clientWidth))));
    const state = await (await request.get(`/api/sessions/${session.id}/browser`)).json();
    const imageSize = await preview.evaluate((image: HTMLImageElement) => ({ width: image.naturalWidth, height: image.naturalHeight }));
    expect(imageSize).toEqual({ width: state.width, height: state.height });
  }
  // The controlled fixture places its button at 50% / 75% of the viewport.
  const bounds = (await preview.boundingBox())!;
  await preview.click({ position: { x: bounds.width / 2, y: bounds.height * 0.75 } });
  await expect(page.getByRole('tab', { name: 'Click aligned', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Comment on browser page' }).click();
  const stopped = await preview.getAttribute('src');
  await expect(page.getByRole('region', { name: 'Browser page comment' })).toBeVisible();
  await page.waitForTimeout(350); expect(await preview.getAttribute('src')).toBe(stopped);
  await page.getByRole('button', { name: 'Cancel browser comment' }).click();
  await expect.poll(() => preview.getAttribute('src')).not.toBe(stopped);
  await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/browser-stream-desktop.png' });
});
test('falls back to ordinary screenshots if the live connection is unavailable', async ({ page }) => {
  await page.route('**/browser/stream?*', route => route.abort()); await open(page);
  await expect(page.locator('.browser-viewport img')).toHaveAttribute('src', /^blob:/);
  await page.getByRole('combobox', { name: 'Browser address' }).fill(url.replace('browser-motion', 'browser-next')); await page.getByRole('button', { name: 'Go to address' }).click();
  await expect(page.getByRole('img', { name: 'Browser preview of Next page' })).toBeVisible();
  await expect(page.locator('.browser-viewport img')).toHaveAttribute('src', /^blob:/);
});
