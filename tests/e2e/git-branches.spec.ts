import { test, expect, type Page } from './fixtures';
import { mkdtemp, mkdir, realpath, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
let root: string, workspace: string, session: { id: string };
const git = (...args: string[]) => exec('git', args, { cwd: workspace, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
test.beforeEach(async ({ request }) => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-branch-ui-'))); workspace = join(root, 'canvas'); await mkdir(workspace);
  await git('init', '-b', 'main'); await git('config', 'user.name', 'Test'); await git('config', 'user.email', 'test@example.com');
  await writeFile(join(workspace, 'layout.ts'), 'export const spacing = 16;\n'); await writeFile(join(workspace, 'removed.ts'), 'export const previous = true;\n'); await git('add', '.'); await git('commit', '-m', 'Initial');
  await git('checkout', '-b', 'design/refined-spacing'); await writeFile(join(workspace, 'layout.ts'), 'export const spacing = 24;\n'); await git('rm', 'removed.ts'); await git('commit', '-am', 'Refine'); await git('checkout', 'main');
  await git('remote', 'add', 'origin', join(root, 'unavailable.git')); await git('update-ref', 'refs/remotes/origin/design/toolbar', 'HEAD');
  session = await (await request.post('/api/sessions', { data: { workspace, title: 'Refine the project', providerId: 'fixture', model: 'test-model', permissionMode: 'auto', architecture: null } })).json();
});
test.afterEach(async ({ request }) => { await request.delete(`/api/sessions/${session.id}`); await rm(root, { recursive: true, force: true }); });
async function open(page: Page) { await page.goto(`/#session/${session.id}`); await page.getByRole('button', { name: 'Show workspace panel' }).click(); }
const topBranch = (page: Page) => page.locator('.topbar-actions').getByRole('button', { name: /^Choose branch/ });

test('reviews branch switching and refreshes persistent file tabs while preserving the draft', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await open(page);
  await page.getByRole('textbox', { name: 'Message Litespeed', exact: true }).fill('Keep this draft while I change branches.');
  await page.getByRole('button', { name: 'removed.ts', exact: true }).click(); await expect(page.getByLabel('removed.ts', { exact: true })).toContainText('previous');
  await page.getByRole('button', { name: 'Browse files', exact: true }).click(); await page.getByRole('button', { name: 'layout.ts', exact: true }).click(); await expect(page.getByLabel('layout.ts', { exact: true })).toContainText('16');
  await topBranch(page).click(); const list = page.getByRole('dialog', { name: 'Branches', exact: true }); await expect(list.getByRole('button', { name: /^main/ })).toBeDisabled();
  await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/branches-desktop.png', animations: 'disabled' });
  await list.getByRole('button', { name: /^design\/refined-spacing/ }).click(); const review = page.getByRole('dialog', { name: 'Switch branch?' }); await expect(review).toContainText('All tasks using this folder');
  expect((await git('branch', '--show-current')).stdout.trim()).toBe('main'); await page.screenshot({ path: '.ui-audit/branch-review-desktop.png', animations: 'disabled' });
  await review.getByRole('button', { name: 'Switch branch', exact: true }).click(); await expect(review).toHaveCount(0); await expect(topBranch(page)).toBeFocused();
  await expect(page.getByLabel('layout.ts', { exact: true })).toContainText('24'); await page.getByRole('tab', { name: 'removed.ts', exact: true }).click(); await expect(page.getByText('This file is unavailable')).toBeVisible(); await expect(page.getByLabel('removed.ts', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message Litespeed', exact: true })).toHaveValue('Keep this draft while I change branches.');
  await page.getByRole('tab', { name: 'layout.ts', exact: true }).click(); await page.reload(); await expect(topBranch(page)).toContainText('design/refined-spacing'); await expect(page.getByLabel('layout.ts', { exact: true })).toContainText('24'); await expect(page.getByRole('textbox', { name: 'Message Litespeed', exact: true })).toHaveValue('Keep this draft while I change branches.');
  await page.getByRole('tab', { name: 'removed.ts', exact: true }).click(); await expect(page.getByText('This file is unavailable')).toBeVisible();
  await topBranch(page).click(); await page.getByRole('dialog', { name: 'Branches', exact: true }).getByRole('button', { name: /^main/ }).click(); await page.getByRole('dialog', { name: 'Switch branch?' }).getByRole('button', { name: 'Switch branch', exact: true }).click();
  await expect(page.getByLabel('removed.ts', { exact: true })).toContainText('previous');
});
test('creates a branch with local work and makes blocked switching understandable', async ({ page }) => {
  await writeFile(join(workspace, 'layout.ts'), 'export const spacing = 20;\n'); await git('add', '.'); await writeFile(join(workspace, 'layout.ts'), 'export const spacing = 22;\n');
  await open(page); await topBranch(page).click(); const list = page.getByRole('dialog', { name: 'Branches', exact: true }); await expect(list).toContainText('1 file has changes'); await expect(list.getByRole('button', { name: /^design\/refined-spacing/ })).toBeDisabled();
  await list.getByRole('button', { name: 'New branch', exact: true }).click(); const name = page.getByRole('dialog', { name: 'New branch', exact: true }); await expect(name.getByLabel('Branch name')).toBeFocused();
  await name.getByLabel('Branch name').fill('main'); await name.getByRole('button', { name: 'Continue' }).click(); await expect(name.getByRole('alert')).toContainText('already exists'); await name.getByLabel('Branch name').fill('design/keep-current-work'); await name.getByRole('button', { name: 'Continue' }).click();
  const review = page.getByRole('dialog', { name: 'Create branch?' }); await expect(review).toContainText('staged and unstaged'); await review.getByRole('button', { name: 'Create branch', exact: true }).click(); await expect(review).toHaveCount(0);
  expect((await git('branch', '--show-current')).stdout.trim()).toBe('design/keep-current-work'); expect((await git('show', ':layout.ts')).stdout).toContain('20'); expect(await readFile(join(workspace, 'layout.ts'), 'utf8')).toContain('22');
});
test('refreshes a stale review and tracks a fetched remote branch without contacting the remote', async ({ page }) => {
  await open(page); await topBranch(page).click(); await page.getByRole('dialog', { name: 'Branches', exact: true }).getByRole('button', { name: /^design\/refined-spacing/ }).click(); const review = page.getByRole('dialog', { name: 'Switch branch?' });
  await expect(review.getByRole('button', { name: 'Switch branch', exact: true })).toBeVisible(); await git('branch', 'external-change'); await review.getByRole('button', { name: 'Switch branch', exact: true }).click(); await expect(review.getByRole('alert')).toContainText('changed after review');
  await review.getByRole('button', { name: 'Refresh review' }).click(); await review.getByRole('button', { name: 'Switch branch', exact: true }).click(); await expect(review).toHaveCount(0);
  await topBranch(page).click(); await page.getByRole('dialog', { name: 'Branches', exact: true }).getByRole('button', { name: /^origin\/design\/toolbar/ }).click(); const track = page.getByRole('dialog', { name: 'Track a remote branch' }); await expect(track.getByLabel('Branch name')).toHaveValue('design/toolbar'); await track.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('dialog', { name: 'Create branch?' }).getByRole('button', { name: 'Create branch', exact: true }).click(); await expect(topBranch(page)).toContainText('design/toolbar'); expect((await git('rev-parse', '--abbrev-ref', '@{upstream}')).stdout.trim()).toBe('origin/design/toolbar');
});
test('mobile branch search, long names and confirmation remain aligned and keyboard reachable', async ({ page }) => {
  const long = 'design/a-much-longer-branch-name-for-the-composer-and-toolbar'; await git('branch', long); await git('worktree', 'add', '-b', 'working-copy', join(root, 'another project'));
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'light' }); await open(page); await page.getByRole('tab', { name: 'Changes', exact: true }).click(); await page.locator('.review-scope-bar').getByRole('button', { name: /^Choose branch/ }).click();
  const list = page.getByRole('dialog', { name: 'Branches', exact: true }); await expect(list.getByRole('button', { name: /^working-copy/ })).toBeDisabled(); await list.getByLabel('Search branches').fill('longer'); await expect(list.getByRole('button', { name: new RegExp('^' + long) })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/branches-mobile.png', animations: 'disabled' });
  await list.getByRole('button', { name: new RegExp('^' + long) }).click(); const review = page.getByRole('dialog', { name: 'Switch branch?' }); await expect(review).toBeVisible(); await page.screenshot({ path: '.ui-audit/branch-review-mobile.png', animations: 'disabled' }); const confirm = (await review.getByRole('button', { name: 'Switch branch', exact: true }).boundingBox())!; expect(confirm.y + confirm.height).toBeLessThan(844); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.locator('.review-scope-bar').getByRole('button', { name: /^Choose branch/ })).toBeFocused(); expect((await git('branch', '--show-current')).stdout.trim()).toBe('main');
});
test('the home project strip keeps long project and branch names compact on a narrow screen', async ({ page }) => {
  await git('checkout', '-b', 'design/a-long-name-for-the-next-iteration');
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`/#session/${session.id}`); await page.getByRole('button', { name: 'Open navigation' }).click(); await page.getByRole('button', { name: 'New chat', exact: true }).click();
  const strip = page.locator('.composer-project-strip'), branch = strip.getByRole('button', { name: /^Choose branch/ }); await expect(branch).toContainText('design/a-long-name'); await expect(strip.getByRole('button', { name: 'Plugins', exact: true })).toBeVisible();
  expect(await strip.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/branch-home-mobile.png', animations: 'disabled' }); await branch.click(); await expect(page.getByRole('dialog', { name: 'Branches', exact: true })).toContainText('design/a-long-name-for-the-next-iteration');
});
