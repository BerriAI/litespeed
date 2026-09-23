import { test, expect, type Page } from './fixtures';
import { mkdtemp, mkdir, realpath, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
let workspace: string, session: { id: string };
const git = (...args: string[]) => exec('git', args, { cwd: workspace, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
test.beforeEach(async ({ request }) => {
  workspace = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-discard-ui-'))); await mkdir(join(workspace, 'src'));
  await git('init', '-b', 'main'); await git('config', 'user.name', 'Test'); await git('config', 'user.email', 'test@example.com');
  await writeFile(join(workspace, 'src/layout.ts'), 'export const spacing = 12;\n'); await git('add', '.'); await git('commit', '-m', 'Initial');
  await writeFile(join(workspace, 'src/layout.ts'), 'export const spacing = 16;\n'); await git('add', '.'); await writeFile(join(workspace, 'src/layout.ts'), 'export const spacing = 24;\n');
  await writeFile(join(workspace, 'notes.md'), '# Design notes\nKeep the layout spacious.\n');
  session = await (await request.post('/api/sessions', { data: { workspace, title: 'Refine the layout', providerId: 'fixture', model: 'test-model', permissionMode: 'auto', architecture: null } })).json();
});
test.afterEach(async ({ request }) => {
  const { backups } = await (await request.get(`/api/git/discards?${new URLSearchParams({ workspace })}`)).json();
  for (const backup of backups) await request.delete(`/api/git/discards/${backup.id}`, { data: { workspace, confirm: true } });
  await request.delete(`/api/sessions/${session.id}`); await rm(workspace, { recursive: true, force: true });
});
async function open(page: Page) { await page.goto(`/#session/${session.id}`); await page.getByRole('button', { name: 'Show workspace panel' }).click(); await page.getByRole('tab', { name: 'Changes', exact: true }).click(); await page.getByLabel('Review scope').selectOption('unstaged'); }

test('reviews a selected discard, keeps staged work and restores from durable history after reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await open(page);
  await page.getByRole('button', { name: 'layout.ts src', exact: false }).click(); await page.getByRole('button', { name: 'Discard…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Discard changes?' }); await expect(dialog.getByLabel('Files to discard')).toContainText('src/layout.ts'); await expect(dialog.getByLabel('Files to discard')).not.toContainText('notes.md');
  await expect(dialog).toContainText('Original copies will be saved'); expect(await readFile(join(workspace, 'src/layout.ts'), 'utf8')).toContain('24');
  await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/git-discard-review-desktop.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(await readFile(join(workspace, 'src/layout.ts'), 'utf8')).toContain('16'); expect((await git('show', ':src/layout.ts')).stdout).toContain('16'); expect(await readFile(join(workspace, 'notes.md'), 'utf8')).toContain('spacious');
  await page.reload(); await page.getByRole('button', { name: 'Discarded changes', exact: true }).click(); const history = page.getByRole('dialog', { name: 'Discarded changes', exact: true }); await expect(history).toContainText('src/layout.ts');
  await page.screenshot({ path: '.ui-audit/git-discard-history-desktop.png', animations: 'disabled' });
  await history.getByRole('button', { name: 'Restore all', exact: true }).click(); const restore = page.getByRole('dialog', { name: 'Restore discarded changes?' }); await expect(restore.getByLabel('Files to restore')).toContainText('src/layout.ts');
  await restore.getByRole('button', { name: 'Restore files', exact: true }).click(); await expect(history).toBeVisible(); await expect(history).toContainText('Restored');
  expect(await readFile(join(workspace, 'src/layout.ts'), 'utf8')).toContain('24'); expect((await git('show', ':src/layout.ts')).stdout).toContain('16');
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Discarded changes', exact: true })).toBeFocused();
});
test('newer edits block restore while the original remains downloadable, and deleting a backup keeps project files', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Discard…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Discard changes?' }); await expect(dialog.getByLabel('Files to discard')).toContainText('New file'); await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await writeFile(join(workspace, 'src/layout.ts'), 'export const spacing = 32;\n');
  await page.getByRole('button', { name: 'Discarded changes', exact: true }).click(); const history = page.getByRole('dialog', { name: 'Discarded changes', exact: true });
  await history.getByRole('button', { name: 'Restore all', exact: true }).click(); await expect(history.getByRole('alert')).toContainText('changed after the discard');
  const download = page.waitForEvent('download'); await history.getByRole('link', { name: 'Save original src/layout.ts' }).click(); const saved = await download; expect(await readFile((await saved.path())!, 'utf8')).toContain('24');
  await history.getByRole('button', { name: 'Restore notes.md', exact: true }).click(); await page.getByRole('button', { name: 'Restore files', exact: true }).click(); await expect(history).toBeVisible(); expect(await readFile(join(workspace, 'notes.md'), 'utf8')).toContain('spacious');
  await history.getByRole('button', { name: /^Delete backup from/ }).click(); const remove = page.getByRole('dialog', { name: 'Delete saved backup?' }); await expect(remove).toContainText('cannot be recovered'); await remove.getByRole('button', { name: 'Delete backup', exact: true }).click(); await expect(history).toContainText('No discarded changes'); expect(await readFile(join(workspace, 'src/layout.ts'), 'utf8')).toContain('32');
});
test('stale discard review preserves the newer file and refreshes before a confirmed operation', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Discard…', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Discard changes?' });
  await expect(dialog.getByLabel('Files to discard')).toContainText('notes.md');
  await writeFile(join(workspace, 'notes.md'), '# A newer note\n'); await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('changed after review'); expect(await readFile(join(workspace, 'notes.md'), 'utf8')).toContain('newer');
  await dialog.getByRole('button', { name: 'Refresh review', exact: true }).click(); await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(readFile(join(workspace, 'notes.md'))).rejects.toThrow();
});
test('mobile discard review and history fit cleanly and keep every action reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'light' }); await open(page);
  await page.getByRole('button', { name: 'Discard…', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Discard changes?' }); await expect(dialog.getByLabel('Files to discard')).toContainText('notes.md');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/git-discard-review-mobile.png', animations: 'disabled' });
  const confirm = (await dialog.getByRole('button', { name: 'Discard changes', exact: true }).boundingBox())!; expect(confirm.y + confirm.height).toBeLessThan(844);
  await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click(); await expect(dialog).toHaveCount(0); await page.getByRole('button', { name: 'Discarded changes', exact: true }).click(); const history = page.getByRole('dialog', { name: 'Discarded changes', exact: true }); await expect(history).toContainText('src/layout.ts');
  await page.screenshot({ path: '.ui-audit/git-discard-history-mobile.png', animations: 'disabled' }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('all-project history can save and remove originals from a project that was deleted', async ({ page, request }) => {
  const removed = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-removed-project-')));
  try {
    await exec('git', ['init', '-b', 'main'], { cwd: removed }); await writeFile(join(removed, 'original.txt'), 'Keep this original.');
    const plan = await (await request.post('/api/git/discards/prepare', { data: { workspace: removed, paths: ['original.txt'] } })).json();
    const response = await request.post('/api/git/discards/apply', { data: { workspace: removed, id: plan.id } }); expect(response.ok()).toBe(true); const { backup } = await response.json();
    await rm(removed, { recursive: true }); await open(page); await page.getByRole('button', { name: 'Discarded changes', exact: true }).click();
    const history = page.getByRole('dialog', { name: 'Discarded changes', exact: true }); await expect(history).toContainText('No discarded changes');
    await history.getByRole('combobox', { name: 'Backup project filter' }).selectOption('all'); const section = history.locator('section').filter({ hasText: 'original.txt' }); await expect(section).toContainText(removed.split('/').at(-1)!);
    const download = page.waitForEvent('download'); await section.getByRole('link', { name: 'Save original original.txt' }).click(); expect(await readFile((await (await download).path())!, 'utf8')).toBe('Keep this original.');
    await section.getByRole('button', { name: 'Restore all', exact: true }).click(); await expect(history.getByRole('alert')).toContainText('folder is unavailable');
    await section.getByRole('button', { name: /^Delete backup from/ }).click(); await page.getByRole('dialog', { name: 'Delete saved backup?' }).getByRole('button', { name: 'Delete backup', exact: true }).click(); await expect(history).toContainText('No discarded changes');
    expect((await request.get(`/api/git/discards/${backup.id}/original?${new URLSearchParams({ workspace: removed, path: 'original.txt' })}`)).status()).toBe(404);
  } finally { await rm(removed, { recursive: true, force: true }); }
});
