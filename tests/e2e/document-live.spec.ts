import { test, expect, type Page } from './fixtures';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let workspace: string, session: { id: string };
const original = (name: string) => Array.from({ length: 160 }, (_, index) => `export const line${index} = '${name}';`).join('\n');
test.beforeEach(async ({ request }) => {
  workspace = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-live-files-')));
  await Promise.all(['alpha.ts', 'beta.ts'].map(name => writeFile(join(workspace, name), original(name))));
  session = await (await request.post('/api/sessions', { data: { workspace, title: 'Keep the file in view', providerId: 'fixture', model: 'test-model', permissionMode: 'auto', architecture: null } })).json();
});
test.afterEach(async ({ request }) => { await request.post('/fixture/delegations/release', { data: {} }); await request.post(`/api/sessions/${session.id}/cancel`, { data: {} }); await request.delete(`/api/sessions/${session.id}`); await rm(workspace, { recursive: true, force: true }); });
async function open(page: Page, names = ['beta.ts', 'alpha.ts']) {
  await page.goto(`/#session/${session.id}`); await page.getByRole('button', { name: 'Show workspace panel', exact: true }).click();
  for (const name of names) {
    const browse = page.getByRole('button', { name: 'Browse files', exact: true }); if (await browse.isVisible()) await browse.click();
    await page.locator('.file-list').getByRole('button', { name, exact: true }).click(); await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
  }
}
const returned = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));
const settled = (page: Page) => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

test('returning to the file list keeps the clicked file present during a background directory refresh', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Browse files', exact: true }).click();
  const entry = page.locator('.file-list').getByRole('button', { name: 'beta.ts', exact: true }); await expect(entry).toBeVisible();
  await page.getByRole('textbox', { name: 'Message Litespeed' }).focus();
  let release!: () => void, arrived!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; }), requested = new Promise<void>(resolve => { arrived = resolve; });
  await page.route('**/api/files?**', async route => { const response = await route.fetch(); arrived(); await hold; await route.fulfill({ response }); });
  try {
    const original = await entry.elementHandle(), box = await entry.boundingBox(); expect(box).toBeTruthy();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2); await page.mouse.down();
    // Mac WebKit does not focus buttons on click; emulate the app-return event in both engines.
    await returned(page); await requested; await settled(page);
    expect(await original!.evaluate(element => element.isConnected)).toBe(true); await page.mouse.up();
    await expect(page.getByRole('tab', { name: 'beta.ts', exact: true })).toHaveAttribute('aria-selected', 'true');
  } finally { await page.mouse.up(); release(); }
});

test('a running command updates the open file with follow disabled and keeps the reading position and draft', async ({ page, request }) => {
  await open(page); const follow = page.getByRole('button', { name: 'Follow agent activity', exact: true }); if (await follow.getAttribute('aria-pressed') === 'true') await follow.click();
  const code = page.locator('.code-view'); await code.evaluate(element => { element.scrollTop = 800; });
  const draft = page.getByRole('textbox', { name: 'Message Litespeed' }); await draft.fill('DESKTOP_FILE_REFRESH'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Assistant message' }).last()).toContainText('I am still checking'); await draft.fill('Keep this next thought.');
  await expect(code).toContainText('Updated by the running task');
  expect((await (await request.get(`/api/sessions/${session.id}`)).json()).session.status).toBe('running');
  await expect(page.getByRole('tab', { name: 'alpha.ts', exact: true })).toHaveAttribute('aria-selected', 'true'); expect(await code.evaluate(element => element.scrollTop)).toBe(800);
  await expect(draft).toHaveValue('Keep this next thought.'); await expect(draft).toBeFocused();
  await page.screenshot({ path: '.ui-audit/file-live-running.png', animations: 'disabled' });
  await request.post('/fixture/delegations/release', { data: {} }); await expect.poll(async () => (await (await request.get(`/api/sessions/${session.id}`)).json()).session.status).toBe('idle');
});

test('returning to the app refreshes text without moving an active search and refreshes other files when selected', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Find in file', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Find in file', exact: true }); await input.fill('export const');
  const search = page.getByRole('search', { name: 'Find in file', exact: true }); await expect(search.getByRole('status')).toHaveText('1 of 160');
  const code = page.locator('.code-view'); await code.evaluate(element => { element.scrollTop = 800; });
  await writeFile(join(workspace, 'alpha.ts'), original('alpha.ts') + '\nexport const revised = "Updated outside Litespeed";');
  await writeFile(join(workspace, 'beta.ts'), original('beta.ts') + '\n// Refreshed companion file');
  await returned(page); await expect(code).toContainText('Updated outside Litespeed'); await expect(search.getByRole('status')).toHaveText('1 of 161');
  await expect(input).toBeFocused(); expect(await code.evaluate(element => element.scrollTop)).toBe(800);
  expect(await code.locator('mark.active-match').allTextContents()).toEqual(['export', ' ', 'const']);
  await page.getByRole('tab', { name: 'beta.ts', exact: true }).click(); await expect(code).toContainText('Refreshed companion file');
  await page.getByRole('tab', { name: 'alpha.ts', exact: true }).click(); await expect.poll(() => code.evaluate(element => element.scrollTop)).toBe(800);
});

test('a later refresh wins over a delayed response and a closed file stays closed', async ({ page }) => {
  await open(page); let release!: () => void, arrived!: () => void, delivered!: () => void, held = false;
  const hold = new Promise<void>(resolve => { release = resolve; }), requested = new Promise<void>(resolve => { arrived = resolve; }), complete = new Promise<void>(resolve => { delivered = resolve; });
  await page.route('**/api/file-preview?**', async route => {
    if (new URL(route.request().url()).searchParams.get('path') !== 'alpha.ts' || held) return route.continue();
    held = true; const response = await route.fetch(); arrived(); await hold;
    try { await route.fulfill({ response }); } catch { /* The older request was aborted. */ } finally { delivered(); }
  });
  try {
    await writeFile(join(workspace, 'alpha.ts'), original('alpha.ts') + '\n// Older version'); await returned(page); await requested;
    await writeFile(join(workspace, 'alpha.ts'), original('alpha.ts') + '\n// Newer version'); await returned(page);
    await expect(page.locator('.code-view')).toContainText('Newer version'); release(); await complete; await settled(page);
    await expect(page.locator('.code-view')).toContainText('Newer version'); await expect(page.locator('.code-view')).not.toContainText('Older version');
    // A second pending read must not reopen a file after it is closed.
    held = false; const secondHold = new Promise<void>(resolve => { release = resolve; }), secondRequest = new Promise<void>(resolve => { arrived = resolve; }), secondComplete = new Promise<void>(resolve => { delivered = resolve; });
    await page.unroute('**/api/file-preview?**');
    await page.route('**/api/file-preview?**', async route => {
      if (new URL(route.request().url()).searchParams.get('path') !== 'alpha.ts') return route.continue();
      const response = await route.fetch(); arrived(); await secondHold; try { await route.fulfill({ response }); } catch { /* Closed request. */ } finally { delivered(); }
    });
    await returned(page); await secondRequest; await page.getByRole('button', { name: 'Close alpha.ts', exact: true }).click(); release(); await secondComplete; await settled(page);
    await expect(page.getByRole('tab', { name: 'alpha.ts', exact: true })).toHaveCount(0); await expect(page.getByRole('tab', { name: 'beta.ts', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.code-view')).toContainText('beta.ts');
  } finally { release?.(); }
});

test('deleted files show an honest unavailable state and recover when they return', async ({ page }) => {
  await open(page); await rm(join(workspace, 'alpha.ts')); await returned(page);
  await expect(page.getByText('This file is unavailable', { exact: true })).toBeVisible(); await expect(page.locator('.code-view')).toHaveCount(0);
  await writeFile(join(workspace, 'alpha.ts'), original('alpha.ts') + '\n// Restored file'); await returned(page); await expect(page.locator('.code-view')).toContainText('Restored file');
  await expect(page.getByText('This file is unavailable', { exact: true })).toHaveCount(0);
});

test('unchanged images keep their loaded preview and changed image bytes refresh without dropping the reading position', async ({ page }) => {
  await page.goto(`/#session/${session.id}`);
  const pictures = await page.evaluate(() => ['#365e51', '#c77742'].map(color => { const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 2200; const context = canvas.getContext('2d')!; context.fillStyle = color; context.fillRect(0, 0, canvas.width, canvas.height); return canvas.toDataURL('image/png').split(',')[1]; }));
  await writeFile(join(workspace, 'poster.png'), Buffer.from(pictures[0], 'base64')); await open(page, ['poster.png']);
  const picture = page.locator('.image-preview img'), preview = page.locator('.image-preview'); await expect(picture).toBeVisible(); await expect.poll(() => picture.evaluate(image => (image as HTMLImageElement).naturalHeight)).toBe(2200);
  await preview.evaluate(element => { element.scrollTop = 400; }); const first = await picture.getAttribute('src');
  const checked = page.waitForResponse(response => response.url().includes('/api/file-preview?') && new URL(response.url()).searchParams.get('path') === 'poster.png');
  await returned(page); await checked; await settled(page); await expect(picture).toHaveAttribute('src', first!); expect(await preview.evaluate(element => element.scrollTop)).toBe(400);
  await writeFile(join(workspace, 'poster.png'), Buffer.from(pictures[1], 'base64')); await returned(page); await expect(picture).not.toHaveAttribute('src', first!); await expect.poll(() => picture.evaluate(image => (image as HTMLImageElement).naturalHeight)).toBe(2200);
  expect(await preview.evaluate(element => element.scrollTop)).toBe(400);
});
