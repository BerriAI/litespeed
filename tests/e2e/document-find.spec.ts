import { test, expect, type Page } from './fixtures';
import { appendFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let workspace: string, session: { id: string };
test.beforeEach(async ({ request }) => {
  workspace = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-file-find-')));
  await writeFile(join(workspace, 'long.ts'), Array.from({ length: 180 }, (_, index) => `export const row${index} = '${[3, 128, 174].includes(index) ? index === 128 ? 'Measured rhythm and measured rhythm' : 'measured rhythm' : 'Quiet spacing and thoughtful alignment. '.repeat(7)}';`).join('\n'));
  await writeFile(join(workspace, 'notes.md'), `# Design notes\n\n[Jump to the source](long.ts:150)\n\n${'A little room to read.\n\n'.repeat(140)}`);
  session = await (await request.post('/api/sessions', { data: { workspace, title: 'Read and refine', providerId: 'fixture', model: 'test-model', architecture: null } })).json();
});
test.afterEach(async ({ request }) => { await request.delete(`/api/sessions/${session.id}`); await rm(workspace, { recursive: true, force: true }); });
async function open(page: Page) { await page.goto(`/#session/${session.id}`); await page.getByRole('button', { name: 'Show workspace panel', exact: true }).click(); await file(page, 'long.ts'); await expect(page.locator('.code-view')).toBeVisible(); }
async function file(page: Page, name: string) { const browse = page.getByRole('button', { name: 'Browse files', exact: true }); if (await browse.isVisible()) await browse.click(); await page.locator('.file-list').getByRole('button', { name, exact: true }).click(); }

test('finds literal source matches, moves in both directions and preserves syntax and the draft', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await open(page); await page.getByRole('textbox', { name: 'Message Litespeed' }).fill('Keep my question.');
  const requests = (await (await request.get('/fixture/requests')).json()).count;
  await page.locator('.code-view').focus(); await page.keyboard.press('ControlOrMeta+f'); const input = page.getByRole('textbox', { name: 'Find in file', exact: true }); await expect(input).toBeFocused(); await input.fill('measured rhythm');
  const search = page.getByRole('search', { name: 'Find in file', exact: true }); await expect(search.getByRole('status')).toHaveText('1 of 4');
  const active = page.locator('.code-view mark.active-match'); await expect(active).toHaveText('measured rhythm'); await expect(active).toBeInViewport();
  await input.press('Enter'); await expect(search.getByRole('status')).toHaveText('2 of 4'); await expect(active).toHaveText('Measured rhythm'); await expect(active).toBeInViewport();
  await input.press('Shift+Enter'); await expect(search.getByRole('status')).toHaveText('1 of 4'); await input.press('Shift+Enter'); await expect(search.getByRole('status')).toHaveText('4 of 4'); await expect(active).toBeInViewport();
  await search.getByRole('button', { name: 'Match case', exact: true }).click(); await expect(search.getByRole('status')).toHaveText('1 of 3');
  await input.fill('const row128'); await expect(search.getByRole('status')).toHaveText('1 of 1'); expect(await active.allTextContents()).toEqual(['const', ' row128']); await expect(page.locator('.code-view .hljs-keyword').first()).toBeVisible();
  await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/file-find-desktop.png', animations: 'disabled' });
  await input.fill('[not a regex]'); await expect(search.getByRole('status')).toHaveText('No matches'); await expect(search.getByRole('button', { name: 'Next match', exact: true })).toBeDisabled();
  await input.press('Escape'); await expect(search).toHaveCount(0); await expect(page.locator('.code-view')).toBeFocused(); await expect(page.locator('.code-view mark')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message Litespeed' })).toHaveValue('Keep my question.'); expect((await (await request.get('/fixture/requests')).json()).count).toBe(requests);
});

test('keeps each file view and reading position through tab changes and reloads', async ({ page }) => {
  await open(page); const code = page.locator('.code-view');
  await code.evaluate(element => { element.scrollTop = 1_350; element.scrollLeft = 140; }); await expect.poll(() => code.evaluate(element => element.scrollTop)).toBe(1_350);
  await file(page, 'notes.md'); const notes = page.locator('.document-markdown'); await expect(notes).toBeVisible(); await notes.evaluate(element => { element.scrollTop = 810; });
  await page.getByRole('tab', { name: 'long.ts', exact: true }).click(); await expect.poll(() => code.evaluate(element => element.scrollTop)).toBe(1_350); await expect.poll(() => code.evaluate(element => element.scrollLeft)).toBe(140);
  await page.getByRole('button', { name: 'Wrap lines', exact: true }).click(); await expect(code).toHaveClass(/wrap-lines/); await code.evaluate(element => { element.scrollTop = 2_300; });
  await page.getByRole('tab', { name: 'notes.md', exact: true }).click(); await expect(notes).toBeVisible(); await expect.poll(() => notes.evaluate(element => element.scrollTop)).toBe(810);
  await page.getByRole('button', { name: 'Source', exact: true }).click(); await expect(code).toContainText('# Design notes'); await code.evaluate(element => { element.scrollTop = 590; });
  await page.getByRole('tab', { name: 'long.ts', exact: true }).click(); await expect(code).toHaveClass(/wrap-lines/); await expect.poll(() => code.evaluate(element => element.scrollTop)).toBe(2_300);
  await page.reload(); await expect(code).toHaveClass(/wrap-lines/); await expect.poll(() => code.evaluate(element => element.scrollTop)).toBe(2_300);
  await page.getByRole('tab', { name: 'notes.md', exact: true }).click(); await expect(code).toContainText('# Design notes'); await expect.poll(() => code.evaluate(element => element.scrollTop)).toBe(590);
  await page.getByRole('button', { name: 'Preview', exact: true }).click(); await expect.poll(() => notes.evaluate(element => element.scrollTop)).toBe(810);
});

test('line links take priority over a saved position and source search fits a short narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 }); await page.emulateMedia({ colorScheme: 'light' }); await open(page);
  await page.getByRole('button', { name: 'Find in file', exact: true }).click(); const input = page.getByRole('textbox', { name: 'Find in file', exact: true }); await input.fill('measured rhythm');
  await input.press('Enter'); const search = page.getByRole('search', { name: 'Find in file', exact: true }); await expect(search.getByRole('status')).toHaveText('2 of 4'); await expect(search.getByRole('button', { name: 'Close file search', exact: true })).toBeInViewport();
  await page.screenshot({ path: '.ui-audit/file-find-mobile.png', animations: 'disabled' }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await file(page, 'notes.md'); await page.getByRole('link', { name: 'Jump to the source', exact: true }).click(); await expect(page.locator('.code-line.highlighted-line')).toHaveAttribute('data-line', '150'); await expect(page.locator('.code-line.highlighted-line')).toBeInViewport();
  await page.locator('.code-view').evaluate(element => { element.scrollTop = 0; });
  await appendFile(join(workspace, 'long.ts'), '\n// Updated after following a line link'); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.code-view')).toContainText('Updated after following a line link'); expect(await page.locator('.code-view').evaluate(element => element.scrollTop)).toBe(0);
  await page.getByRole('tab', { name: 'notes.md', exact: true }).click(); await page.getByRole('link', { name: 'Jump to the source', exact: true }).click(); await expect(page.locator('.code-line.highlighted-line')).toBeInViewport();
});

test('refreshing changed text recalculates matches without retaining stale highlights', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Find in file', exact: true }).click(); const input = page.getByRole('textbox', { name: 'Find in file', exact: true }); await input.fill('measured rhythm');
  const search = page.getByRole('search', { name: 'Find in file', exact: true }); await expect(search.getByRole('status')).toHaveText('1 of 4');
  await writeFile(join(workspace, 'long.ts'), 'export const revised = "A new direction";'); await page.getByRole('button', { name: 'Refresh workspace', exact: true }).click(); await expect(search.getByRole('status')).toHaveText('No matches'); await expect(page.locator('.code-view mark')).toHaveCount(0);
  await input.fill('new direction'); await expect(search.getByRole('status')).toHaveText('1 of 1'); await expect(page.locator('.code-view mark.active-match')).toHaveText('new direction');
});
