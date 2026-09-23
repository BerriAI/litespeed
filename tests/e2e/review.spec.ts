import { test, expect, type Page } from './fixtures';
import { mkdtemp, mkdir, realpath, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
let workspace: string, session: { id: string };
test.beforeEach(async ({ request }) => {
  workspace = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-review-ui-'))); await mkdir(join(workspace, 'src'));
  const git = (...args: string[]) => exec('git', args, { cwd: workspace, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
  await git('init', '-b', 'main'); await git('config', 'user.name', 'Test'); await git('config', 'user.email', 'test@example.com');
  const content = (title: string) => `export interface ScheduledTask {\n  id: string;\n  title: string;\n  nextRunAt: number;\n}\n\nexport function displayName(task: ScheduledTask) {\n  return ${JSON.stringify(title)} + task.title;\n}\n\n` + Array.from({ length: 24 }, (_, i) => `// Task lifecycle note ${i + 1}.`).join('\n') + '\n';
  await writeFile(join(workspace, 'src/schedule.ts'), content('Initial: ')); await git('add', 'src/schedule.ts'); await git('commit', '-m', 'Initial'); await git('checkout', '-b', 'feature/scheduled-tasks');
  await writeFile(join(workspace, 'src/schedule.ts'), content('Committed: ')); await git('add', 'src/schedule.ts'); await git('commit', '-m', 'Describe task');
  await writeFile(join(workspace, 'src/schedule.ts'), content('Staged: ')); await git('add', 'src/schedule.ts'); await writeFile(join(workspace, 'src/schedule.ts'), content('Working: '));
  await writeFile(join(workspace, 'notes.md'), '# Review notes\n\nKeep the interface simple.\n');
  session = await (await request.post('/api/sessions', { data: { workspace, title: 'Review scheduled tasks', providerId: 'fixture', model: 'test-model', permissionMode: 'auto', architecture: null } })).json();
});
test.afterEach(async ({ request }) => { await request.delete(`/api/sessions/${session.id}`); await rm(workspace, { recursive: true, force: true }); });
async function review(page: Page) { await page.goto(`/#session/${session.id}`); await page.getByRole('button', { name: 'Show workspace panel' }).click(); await page.getByRole('tab', { name: 'Changes', exact: true }).click(); }

test('reviews working, staged and branch changes, restores the view and adds line feedback to an existing draft', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await review(page); await page.getByLabel('Review scope').selectOption('unstaged'); await page.getByRole('button', { name: 'schedule.ts src', exact: false }).click();
  const diff = page.getByLabel('Changes to src/schedule.ts'); await expect(diff).toContainText('Working:'); await expect(diff).toContainText('Staged:'); await expect(diff.getByRole('button', { name: /Show \d+ unchanged lines/ }).first()).toBeVisible();
  await page.getByRole('textbox', { name: 'Message Litespeed' }).fill('Keep my existing draft.');
  await diff.getByRole('button', { name: 'Comment on new line 8', exact: true }).click(); await page.getByRole('textbox', { name: 'Line feedback', exact: true }).fill('Make this label shorter.');
  await page.getByRole('button', { name: 'Back to changes' }).click(); await page.getByRole('button', { name: 'schedule.ts src', exact: false }).click(); await expect(page.getByRole('textbox', { name: 'Line feedback', exact: true })).toHaveValue('Make this label shorter.'); await page.reload(); await expect(page.getByRole('textbox', { name: 'Line feedback', exact: true })).toHaveValue('Make this label shorter.'); await page.getByRole('button', { name: 'Add to chat', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message Litespeed' })).toHaveValue('Keep my existing draft.\n\nReview feedback for src/schedule.ts:8 (new line):\nMake this label shorter.');
  await expect(page).toHaveURL(new RegExp(`#session/${session.id}$`));
  await page.getByLabel('Review scope').selectOption('staged'); await page.getByRole('button', { name: 'schedule.ts src', exact: false }).click(); await expect(diff).toContainText('Committed:'); await expect(diff).toContainText('Staged:'); await expect(diff).not.toContainText('Working:');
  await page.getByLabel('Review scope').selectOption('branch'); await page.getByLabel('Base branch').selectOption('main'); await page.getByRole('button', { name: 'schedule.ts src', exact: false }).click(); await expect(diff).toContainText('Initial:'); await expect(diff).toContainText('Committed:');
  await page.getByRole('button', { name: 'Refresh workspace' }).click(); await expect(page.getByLabel('Review scope')).toHaveValue('branch'); await expect(diff).toContainText('Committed:');
  await page.reload(); await expect(page.getByLabel('Review scope')).toHaveValue('branch'); await expect(diff).toContainText('Committed:'); expect(errors).toEqual([]);
});

test('shows live task file summaries with Review and Undo', async ({ page }) => {
  await page.goto(`/#session/${session.id}`); await page.getByRole('textbox', { name: 'Message Litespeed' }).fill('create fixture summary'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const summary = page.getByRole('region', { name: 'Task file changes' }); await expect(summary).toContainText('1 file changed'); await expect(summary).toContainText('result.txt');
  await summary.getByRole('button', { name: 'Review', exact: true }).click(); await expect(page.getByLabel('Review scope')).toHaveValue('task'); await page.getByRole('button', { name: 'result.txt', exact: false }).filter({ has: page.locator('strong') }).click(); await expect(page.getByLabel('Changes to result.txt')).toContainText('Created by the browser test.');
  await summary.getByRole('button', { name: 'Undo last turn', exact: true }).click(); const dialog = page.getByRole('dialog'); await expect(dialog).toContainText('Undo'); await dialog.getByRole('button', { name: 'Undo last turn', exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(summary).toHaveCount(0);
});

test('review is clean in dark, light and mobile layouts', async ({ page, request }) => {
  const before = await (await request.get('/api/settings')).json(); await request.patch('/api/settings', { data: { theme: 'dark' } });
  try {
    await page.setViewportSize({ width: 1728, height: 1117 }); await review(page); await page.getByLabel('Review scope').selectOption('unstaged'); await page.getByRole('button', { name: 'schedule.ts src', exact: false }).click(); await expect(page.getByLabel('Changes to src/schedule.ts')).toContainText('Working:');
    await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ animations: 'disabled', path: '.ui-audit/review-dark.png' });
    await page.getByLabel('Changes to src/schedule.ts').getByRole('button', { name: 'Comment on new line 8', exact: true }).click(); await page.getByRole('textbox', { name: 'Line feedback', exact: true }).fill('Use a shorter label.'); await page.screenshot({ animations: 'disabled', path: '.ui-audit/review-feedback-dark.png' });
    await page.setViewportSize({ width: 390, height: 844 }); await expect(page.getByLabel('Changes to src/schedule.ts')).toBeVisible(); await expect(page.getByRole('textbox', { name: 'Line feedback', exact: true })).toHaveValue('Use a shorter label.');
    await page.getByRole('button', { name: 'Wrap diff lines' }).click(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ animations: 'disabled', path: '.ui-audit/review-mobile.png' });
    await request.patch('/api/settings', { data: { theme: 'light' } }); await page.setViewportSize({ width: 1440, height: 1000 }); await page.reload(); await expect(page.getByLabel('Changes to src/schedule.ts')).toBeVisible(); await page.screenshot({ animations: 'disabled', path: '.ui-audit/review-light.png' });
  } finally { await request.patch('/api/settings', { data: { theme: before.theme } }); }
});

test('stages, unstages and commits reviewed files without including unstaged edits', async ({ page }) => {
  await review(page); await page.getByLabel('Review scope').selectOption('unstaged'); await page.getByRole('button', { name: 'notes.md', exact: false }).filter({ has: page.locator('strong') }).click();
  await page.getByRole('button', { name: 'Stage file', exact: true }).click(); await expect(page.getByLabel('Changes to notes.md')).toHaveCount(0);
  await page.getByLabel('Review scope').selectOption('staged'); await page.getByRole('button', { name: 'notes.md', exact: false }).filter({ has: page.locator('strong') }).click();
  await page.getByRole('button', { name: 'Unstage file', exact: true }).click(); await expect(page.getByLabel('Changes to notes.md')).toHaveCount(0);
  expect(await readFile(join(workspace, 'notes.md'), 'utf8')).toContain('Keep the interface simple.');
  await page.getByRole('button', { name: 'Commit…', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Commit changes' });
  await expect(dialog.getByLabel('Files to commit')).toContainText('src/schedule.ts'); await expect(dialog.getByLabel('Files to commit')).not.toContainText('notes.md');
  await dialog.getByLabel('Commit message').fill('Polish scheduled task labels'); await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ animations: 'disabled', path: '.ui-audit/review-commit.png' });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await page.getByRole('button', { name: 'Commit…', exact: true }).click(); await expect(dialog.getByLabel('Commit message')).toHaveValue('Polish scheduled task labels');
  await dialog.getByRole('button', { name: 'Commit', exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(page.getByText('No staged changes', { exact: true })).toBeVisible();
  expect((await exec('git', ['show', 'HEAD:src/schedule.ts'], { cwd: workspace })).stdout).toContain('Staged:'); expect(await readFile(join(workspace, 'src/schedule.ts'), 'utf8')).toContain('Working:');
  expect((await exec('git', ['log', '-1', '--format=%s'], { cwd: workspace })).stdout.trim()).toBe('Polish scheduled task labels');
});

test('rejects stale commit reviews and pushes only after showing the destination', async ({ page }) => {
  const remote = join(workspace, 'remote.git'); await exec('git', ['init', '--bare', remote]); await exec('git', ['remote', 'add', 'origin', remote], { cwd: workspace });
  await review(page); await page.getByLabel('Review scope').selectOption('staged'); await page.getByRole('button', { name: 'Commit…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Commit changes' }); await dialog.getByLabel('Commit message').fill('Review every staged file');
  await exec('git', ['add', 'notes.md'], { cwd: workspace }); await dialog.getByRole('button', { name: 'Commit', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('changed after this review'); expect((await exec('git', ['log', '-1', '--format=%s'], { cwd: workspace })).stdout.trim()).toBe('Describe task');
  await dialog.getByRole('button', { name: 'Refresh review', exact: true }).click(); await expect(dialog.getByLabel('Files to commit')).toContainText('notes.md'); await expect(dialog.getByLabel('Commit message')).toHaveValue('Review every staged file');
  await dialog.getByRole('button', { name: 'Commit', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.getByLabel('Review scope').selectOption('branch'); await page.getByRole('button', { name: 'Push…', exact: true }).click();
  const push = page.getByRole('dialog', { name: 'Push branch' }); await expect(push).toContainText('origin/feature/scheduled-tasks'); await expect(push).toContainText(remote);
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ animations: 'disabled', path: '.ui-audit/review-push-mobile.png' });
  await push.getByRole('button', { name: 'Push branch', exact: true }).click(); await expect(push).toHaveCount(0);
  expect((await exec('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/feature/scheduled-tasks'])).stdout).toBe((await exec('git', ['rev-parse', 'HEAD'], { cwd: workspace })).stdout);
});
