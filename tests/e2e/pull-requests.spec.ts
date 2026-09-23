import { test, expect, type Page } from './fixtures';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
let workspace: string, session: { id: string }, created: string[];
test.beforeEach(async ({ request }) => {
  workspace = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-pr-ui-'))); created = [];
  await exec('git', ['init', '-b', 'main'], { cwd: workspace }); await exec('git', ['remote', 'add', 'origin', 'https://github.com/fixture/desktop.git'], { cwd: workspace });
  session = await (await request.post('/api/sessions', { data: { workspace, title: 'Make the everyday details feel right', providerId: 'fixture', model: 'test-model', architecture: null } })).json();
});
test.afterEach(async ({ request }) => {
  for (const id of created) { const detail = await (await request.get(`/api/sessions/${id}`)).json(); if (detail.session?.worktree) { const plan = await (await request.post(`/api/worktrees/${detail.session.worktree.id}/remove/prepare`, { data: {} })).json(); if (plan.id) await request.post(`/api/worktrees/${detail.session.worktree.id}/remove`, { data: { planId: plan.id } }); } }
  for (const id of [session.id, ...created]) await request.delete(`/api/sessions/${id}`); await rm(workspace, { recursive: true, force: true });
});
async function open(page: Page) { await page.goto(`/#session/${session.id}`); if ((page.viewportSize()?.width ?? 1440) < 750) await page.getByRole('button', { name: 'Open navigation' }).click(); await page.getByRole('button', { name: 'Pull requests', exact: true }).click(); await expect(page.locator('.pr-row')).toHaveCount(3); }
async function details(page: Page) { await open(page); await page.getByRole('button', { name: /Keep the browser close/ }).click(); await expect(page.getByRole('heading', { name: 'Keep the browser close to your work' })).toBeFocused(); }

test('lists, filters and displays the captured changes without altering the project', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await page.emulateMedia({ colorScheme: 'dark' }); await open(page);
  await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/pull-requests-desktop.png', animations: 'disabled' });
  await page.getByRole('textbox', { name: 'Filter loaded pull requests' }).fill('jordan'); await expect(page.locator('.pr-row')).toHaveCount(1); await page.getByRole('button', { name: 'Clear pull request filter' }).click();
  await page.getByRole('tab', { name: 'Open', exact: true }).focus(); await page.keyboard.press('ArrowRight'); await expect(page.locator('.pr-row')).toHaveCount(1); await expect(page.locator('.pr-row')).toContainText('Bring settings');
  await page.getByRole('tab', { name: 'Open', exact: true }).click(); await page.getByRole('button', { name: /Keep the browser close/ }).click();
  await expect(page.getByRole('heading', { name: 'Keep the browser close to your work' })).toBeFocused();
  await page.reload(); await expect(page.getByRole('heading', { name: 'Keep the browser close to your work' })).toBeVisible();
  await page.screenshot({ path: '.ui-audit/pull-request-overview.png', animations: 'disabled' });
  await page.getByRole('tab', { name: /Files changed/ }).click(); await expect(page.locator('.pr-patch')).toContainText('BrowserPanel');
  await expect(page.getByLabel('Changed pull request files').getByRole('button')).toHaveCount(3);
  await page.screenshot({ path: '.ui-audit/pull-request-files.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Wrap pull request diff' }).click(); await expect(page.getByRole('button', { name: 'Wrap pull request diff' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Changed pull request files').getByRole('button', { name: /tests\/browser/ }).click(); await expect(page.getByText('Renamed from tests/tabs.test.ts')).toBeVisible();
  await page.getByRole('button', { name: 'Pull requests', exact: true }).last().click(); await expect(page.getByRole('button', { name: /Keep the browser close/ })).toBeVisible();
  await page.getByRole('button', { name: /Keep the browser close/ }).click(); await expect(page.getByRole('heading', { name: 'Keep the browser close to your work' })).toBeVisible(); await page.goBack(); await expect(page.getByRole('button', { name: /Keep the browser close/ })).toBeFocused();
  expect((await exec('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: workspace })).stdout.trim()).toBe('main'); expect(errors).toEqual([]);
});
test('prepares a review draft with exact commits, preserving the previous draft and saved model preferences', async ({ page, request }) => {
  await page.goto(`/#session/${session.id}`); await page.getByRole('textbox', { name: 'Message Litespeed' }).fill('Keep my original draft');
  const preferences = await (await request.get(`/api/workspace-preferences?workspace=${encodeURIComponent(workspace)}`)).json();
  const before = await (await request.get('/fixture/requests')).json();
  const pull = await (await request.get(`/api/pull-requests/142?workspace=${encodeURIComponent(workspace)}`)).json();
  await page.getByRole('button', { name: 'Pull requests', exact: true }).click(); await page.getByRole('button', { name: /Keep the browser close/ }).click();
  await page.getByRole('button', { name: 'Discuss changes' }).click();
  await expect(page).toHaveURL(/#session\//); const id = page.url().match(/session\/([^/]+)$/)![1]; created.push(id); expect(id).not.toBe(session.id);
  await expect(page.getByRole('textbox', { name: 'Message Litespeed' })).toContainText('head ' + pull.head);
  await expect(page.getByRole('button', { name: 'Preview pull-request-142.txt' })).toBeVisible();
  const current = await (await request.get(`/api/sessions/${id}`)).json(); expect(current.session.mode).toBe('plan'); expect(current.messages).toEqual([]);
  expect((await (await request.get('/fixture/requests')).json()).count).toBe(before.count);
  expect(await (await request.get(`/api/workspace-preferences?workspace=${encodeURIComponent(workspace)}`)).json()).toEqual(preferences);
  await page.reload(); await expect(page.getByRole('textbox', { name: 'Message Litespeed' })).toContainText('local project has not been checked out');
  await page.goto(`/#session/${session.id}`); await expect(page.getByRole('textbox', { name: 'Message Litespeed' })).toHaveValue('Keep my original draft');
});
test('fits overview and changed files on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'light' }); await details(page);
  await page.screenshot({ path: '.ui-audit/pull-request-mobile-overview.png', animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('tab', { name: /Files changed/ }).click(); await page.getByRole('button', { name: 'Wrap pull request diff' }).click();
  await page.screenshot({ path: '.ui-audit/pull-request-mobile-files.png', animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const wrap = (await page.getByRole('button', { name: 'Wrap pull request diff' }).boundingBox())!; expect(wrap.x + wrap.width).toBeLessThan(390);
});
test('shows a connection error with a retry and preserves navigation', async ({ page }) => {
  await page.route('**/api/pull-requests?*', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Sign in to GitHub with gh auth login, then refresh pull requests.' }) }));
  await page.goto(`/#pull-requests/session/${session.id}`); await expect(page.getByRole('alert')).toContainText('Sign in to GitHub'); await expect(page.getByText('Loading pull requests…')).toHaveCount(0);
  await page.unroute('**/api/pull-requests?*'); await page.getByRole('button', { name: 'Try again' }).click(); await expect(page.locator('.pr-row')).toHaveCount(3);
});
test('reviews an exact PR checkout in a separate Plan task while preserving the previous draft and project files', async ({ page, request }) => {
  await writeFile(join(workspace, 'notes.md'), 'Keep my local notes'); await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`/#session/${session.id}`); await page.getByRole('textbox', { name: 'Message Litespeed' }).fill('Finish my original thought');
  const before = await (await request.get('/fixture/requests')).json(); await details(page);
  await page.getByRole('button', { name: 'Review in worktree', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review in a worktree?' }); await expect(dialog).toBeVisible(); await expect(dialog.getByRole('button', { name: 'Open review task' })).toBeFocused();
  await expect(dialog).toContainText('fixture/desktop'); await expect(dialog).toContainText('feature/persistent-browser');
  await page.screenshot({ path: '.ui-audit/pr-checkout-desktop.png', animations: 'disabled' });
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(page.getByRole('button', { name: 'Review in worktree', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Review in worktree', exact: true }).click(); await dialog.getByRole('button', { name: 'Open review task' }).click();
  await expect(page).toHaveURL(/#session\//); const id = page.url().match(/session\/([^/]+)$/)![1]; created.push(id);
  await expect(page.getByRole('textbox', { name: 'Message Litespeed' })).toContainText('separate working copy checked out at head'); await expect(page.getByRole('textbox', { name: 'Message Litespeed' })).toBeFocused();
  const current = await (await request.get(`/api/sessions/${id}`)).json(); expect(current.session.mode).toBe('plan'); expect(current.messages).toEqual([]); expect(current.session.worktree.project).toBe(workspace);
  expect(await readFile(join(current.session.workspace, 'client', 'src', 'Browser.tsx'), 'utf8')).toContain('Persistent browser'); expect(await readFile(join(workspace, 'notes.md'), 'utf8')).toBe('Keep my local notes');
  expect((await (await request.get('/fixture/requests')).json()).count).toBe(before.count);
  await page.screenshot({ path: '.ui-audit/pr-checkout-task.png', animations: 'disabled' });
  await page.reload(); await expect(page.getByRole('textbox', { name: 'Message Litespeed' })).toContainText(current.session.worktree.head);
  await page.goto(`/#session/${session.id}`); await expect(page.getByRole('textbox', { name: 'Message Litespeed' })).toHaveValue('Finish my original thought');
});
test('keeps the checkout confirmation readable on a narrow screen and recovers from a stale review', async ({ page }) => {
  let detailLoads = 0; page.on('request', request => { if (/\/api\/pull-requests\/142\?/.test(request.url())) detailLoads++; });
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'light' }); await details(page);
  await page.getByRole('button', { name: 'Review in worktree', exact: true }).click(); const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  await dialog.locator('.worktree-location summary').click(); await page.screenshot({ path: '.ui-audit/pr-checkout-mobile.png', animations: 'disabled' });
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 500 }); await dialog.getByRole('button', { name: 'Open review task' }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('heading', { name: 'Review in a worktree?' })).toBeInViewport(); await expect(dialog.getByRole('button', { name: 'Open review task' })).toBeInViewport();
  expect(await dialog.locator('.worktrees-dialog').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await page.route('**/api/pull-requests/142/worktree', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'The pull request changed after review. Refresh before opening its working copy.' }) }));
  await dialog.getByRole('button', { name: 'Open review task' }).click(); await expect(dialog.getByRole('alert')).toContainText('changed after review');
  await expect(dialog.getByRole('button', { name: 'Open review task' })).toHaveCount(0); const beforeRefresh = detailLoads; await dialog.getByRole('button', { name: 'Refresh review' }).click();
  await expect(dialog.getByRole('button', { name: 'Open review task' })).toBeEnabled(); expect(detailLoads).toBeGreaterThan(beforeRefresh); await expect(dialog.getByRole('button', { name: 'Open review task' })).toBeFocused(); await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Review in worktree', exact: true })).toBeFocused();
});
