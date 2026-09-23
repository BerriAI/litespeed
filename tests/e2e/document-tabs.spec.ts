import { test, expect, type Page } from './fixtures';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let workspace: string, session: { id: string };
const names = ['alpha.ts', 'beta.ts', 'gamma.ts', 'a-longer-document-name.ts', 'another-long-document-name.ts'];
test.beforeEach(async ({ request }) => {
  workspace = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-document-tabs-')));
  await Promise.all(names.map(name => writeFile(join(workspace, name), Array.from({ length: 120 }, (_, index) => `export const line${index} = '${name}';`).join('\n'))));
  session = await (await request.post('/api/sessions', { data: { workspace, title: 'Read several files', providerId: 'fixture', model: 'test-model', architecture: null } })).json();
});
test.afterEach(async ({ request }) => { await request.delete(`/api/sessions/${session.id}`); await rm(workspace, { recursive: true, force: true }); });
async function open(page: Page, files = names.slice(0, 3)) {
  await page.goto(`/#session/${session.id}`); await page.getByRole('button', { name: 'Show workspace panel', exact: true }).click();
  for (const name of files) {
    const browse = page.getByRole('button', { name: 'Browse files', exact: true }); if (await browse.isVisible()) await browse.click();
    await page.locator('.file-list').getByRole('button', { name, exact: true }).click(); await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
  }
}
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const native = (page: Page, command: string) => page.evaluate(detail => window.dispatchEvent(new CustomEvent('litespeed:workspace-command', { detail, cancelable: true })), command);

test('file tab shortcuts cycle in both directions and retain reading positions and the draft', async ({ page }) => {
  await open(page); const draft = page.getByRole('textbox', { name: 'Message Litespeed' }); await draft.fill('Keep this thought.');
  await tab(page, 'alpha.ts').click(); await page.locator('.code-view').evaluate(element => { element.scrollTop = 800; });
  await page.locator('.code-view').focus(); await page.keyboard.press('Control+Tab'); await expect(tab(page, 'beta.ts')).toHaveAttribute('aria-selected', 'true'); await expect(tab(page, 'beta.ts')).toBeFocused();
  await page.keyboard.press('Control+Shift+Tab'); await expect(tab(page, 'alpha.ts')).toHaveAttribute('aria-selected', 'true'); await expect.poll(() => page.locator('.code-view').evaluate(element => element.scrollTop)).toBe(800);
  await page.keyboard.press('ControlOrMeta+Shift+BracketRight'); await expect(tab(page, 'beta.ts')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ControlOrMeta+Shift+BracketLeft'); await expect(tab(page, 'alpha.ts')).toHaveAttribute('aria-selected', 'true');
  await expect(draft).toHaveValue('Keep this thought.');
});

test('native file commands reload the focused file, close adjacent tabs and recover focus after the last tab', async ({ page }) => {
  await open(page); await tab(page, 'beta.ts').click(); await page.locator('.code-view').focus();
  await writeFile(join(workspace, 'beta.ts'), 'export const updated = "A refreshed file";'); expect(await native(page, 'reload')).toBe(false); await expect(page.locator('.code-view')).toContainText('A refreshed file');
  expect(await native(page, 'close-tab')).toBe(false); await expect(tab(page, 'beta.ts')).toHaveCount(0); await expect(tab(page, 'gamma.ts')).toHaveAttribute('aria-selected', 'true'); await expect(tab(page, 'gamma.ts')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+w'); await expect(tab(page, 'gamma.ts')).toHaveCount(0); await expect(tab(page, 'alpha.ts')).toBeFocused();
  expect(await native(page, 'close-tab')).toBe(false); await expect(page.getByRole('tablist', { name: 'Open files', exact: true })).toHaveCount(0); await expect(page.getByRole('textbox', { name: 'Filter files', exact: true })).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`#session/${session.id}$`));
});

test('commands from the composer and a modal leave file tabs unchanged', async ({ page }) => {
  await open(page); const draft = page.getByRole('textbox', { name: 'Message Litespeed' }); await draft.fill('Do not close a file here.');
  expect(await native(page, 'close-tab')).toBe(true); expect(await native(page, 'next-tab')).toBe(true); await expect(tab(page, 'gamma.ts')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ControlOrMeta+k'); await expect(page.getByRole('dialog', { name: 'Find your next step', exact: true })).toBeVisible();
  expect(await native(page, 'close-tab')).toBe(true); await page.keyboard.press('Escape'); await expect(page.locator('.document-tabs [role=tab]')).toHaveCount(3); await expect(draft).toHaveValue('Do not close a file here.');
});

test('choosing an existing tab cancels a delayed file open instead of letting it steal focus', async ({ page }) => {
  await open(page, ['alpha.ts']); let release!: () => void, arrived!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; }), requested = new Promise<void>(resolve => { arrived = resolve; });
  await page.route('**/api/file-preview?**', async route => {
    if (new URL(route.request().url()).searchParams.get('path') !== 'beta.ts') return route.continue();
    const response = await route.fetch(); arrived(); await hold; await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Browse files', exact: true }).click(); await page.locator('.file-list').getByRole('button', { name: 'beta.ts', exact: true }).click(); await requested;
  await tab(page, 'alpha.ts').click(); const response = page.waitForResponse(response => new URL(response.url()).searchParams.get('path') === 'beta.ts'); release(); await (await response).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(tab(page, 'alpha.ts')).toHaveAttribute('aria-selected', 'true'); await expect(page.locator('.code-view')).toContainText('alpha.ts'); await expect(tab(page, 'beta.ts')).toHaveCount(0);
});

test('overflowing tabs remain keyboard reachable and closing a background file preserves the active document', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 }); await open(page, names);
  await tab(page, 'alpha.ts').click(); await expect(tab(page, 'alpha.ts')).toBeInViewport();
  expect(await native(page, 'previous-tab')).toBe(false); await expect(tab(page, names.at(-1)!)).toHaveAttribute('aria-selected', 'true'); await expect(tab(page, names.at(-1)!)).toBeFocused(); await expect(tab(page, names.at(-1)!)).toBeInViewport();
  await page.getByRole('button', { name: 'Close beta.ts', exact: true }).click(); await expect(tab(page, names.at(-1)!)).toHaveAttribute('aria-selected', 'true'); await expect(tab(page, names.at(-1)!)).toBeFocused(); await expect(tab(page, names.at(-1)!)).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: `Close ${names.at(-1)!}`, exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: '.ui-audit/file-tabs-keyboard-mobile.png', animations: 'disabled' }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
