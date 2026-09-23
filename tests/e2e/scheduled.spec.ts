import { test, expect } from './fixtures';
import { mkdir } from 'node:fs/promises';
import type { ScheduleList, ScheduledTask } from '../../shared/schedules';

test.afterEach(async ({ request }) => {
  const data: ScheduleList = await (await request.get('/api/schedules')).json();
  for (const task of data.schedules) {
    if (!task.name.startsWith('Schedule test')) continue;
    for (const run of data.runs.filter(run => run.scheduleId === task.id && run.sessionId)) {
      await request.post(`/api/sessions/${run.sessionId}/cancel`); await request.delete(`/api/sessions/${run.sessionId}`);
    }
    const current: ScheduleList = await (await request.get('/api/schedules')).json();
    await request.delete(`/api/schedules/${task.id}?revision=${current.schedules.find(row => row.id === task.id)!.revision}`);
  }
});
const openScheduled = async (page: import('@playwright/test').Page) => { await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Scheduled', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Scheduled', exact: true })).toBeVisible(); };

test('creates, edits, pauses and runs a task using the existing model and project', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await openScheduled(page); await page.getByRole('button', { name: 'New scheduled task' }).click();
  const dialog = page.getByRole('dialog', { name: 'New scheduled task' });
  await dialog.getByLabel('Name', { exact: true }).fill('Schedule test daily review');
  await dialog.getByLabel('Instructions').fill('Review recent changes and summarize anything that needs attention.');
  await dialog.getByLabel('Repeat').selectOption('weekly'); await expect(dialog.getByRole('button', { name: 'Mon', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Create task', exact: true }).click(); await expect(dialog).toHaveCount(0);
  const row = page.locator('.schedule-row').filter({ hasText: 'Schedule test daily review' }); await expect(row).toContainText('Weekdays');
  await row.getByLabel('Actions for Schedule test daily review').click(); await row.getByRole('button', { name: 'Pause schedule' }).click(); await expect(row.locator('.schedule-badge')).toHaveText('Paused');
  await page.reload(); await expect(page.getByRole('heading', { name: 'Scheduled', exact: true })).toBeVisible(); await expect(row.locator('.schedule-badge')).toHaveText('Paused');
  await row.getByLabel('Actions for Schedule test daily review').click(); await row.getByRole('button', { name: 'Resume schedule' }).click(); await expect(row.locator('.schedule-badge')).toHaveCount(0);
  await row.locator('.schedule-description').click(); const editor = page.getByRole('dialog', { name: 'Edit scheduled task' }); await editor.getByLabel('Name', { exact: true }).fill('Schedule test edited review'); await editor.getByRole('button', { name: 'Save changes' }).click(); await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: 'Run Schedule test edited review now' }).click(); await expect(page).toHaveURL(/#session\//); await expect(page.getByRole('textbox', { name: 'Message Litespeed' })).toBeVisible();
  await expect.poll(async () => { const data: ScheduleList = await (await request.get('/api/schedules')).json(); return data.runs.find(run => run.name === 'Schedule test edited review')?.status; }).toBe('completed');
  await openScheduled(page); await page.getByRole('tab', { name: 'Activity', exact: true }).click(); await expect(page.locator('.schedule-activity-row').filter({ hasText: 'Schedule test edited review' })).toContainText('Completed');
  expect(errors).toEqual([]);
});

test('dispatches a due one-time task and exposes its completed result', async ({ request, page }) => {
  const settings = await (await request.get('/api/settings')).json();
  const response = await request.post('/api/schedules', { data: { name: 'Schedule test once', prompt: 'Say hello from the scheduled task.', workspace: settings.workspace, selection: { providerId: 'fixture', model: 'test-model', architecture: null, permissionMode: 'ask' }, timing: { kind: 'once', at: Date.now() + 1200 } } }); expect(response.ok(), await response.text()).toBe(true);
  const task: ScheduledTask = await response.json();
  await expect.poll(async () => { const data: ScheduleList = await (await request.get('/api/schedules')).json(); return data.runs.find(run => run.scheduleId === task.id)?.status; }).toBe('completed');
  await page.goto('/#scheduled'); await expect(page.locator('.schedule-row').filter({ hasText: task.name })).toContainText('Finished');
  await page.getByRole('tab', { name: 'Activity', exact: true }).click(); await page.getByRole('tabpanel', { name: 'Scheduled activity' }).getByRole('button', { name: task.name, exact: true }).click(); await expect(page).toHaveURL(/#session\//);
});

test('scheduled tasks and the editor fit mobile and keyboard navigation', async ({ page, request }) => {
  const before = await (await request.get('/api/settings')).json(); await request.patch('/api/settings', { data: { theme: 'dark' } });
  try {
    await page.goto('/#scheduled'); await page.getByRole('button', { name: 'New scheduled task' }).click(); const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name', { exact: true }).fill('Schedule test mobile'); await dialog.getByLabel('Instructions').fill('Check the project and report any issues.');
    await expect(dialog.getByRole('button', { name: 'Create task', exact: true })).toBeEnabled(); await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ animations: 'disabled', path: '.ui-audit/scheduled-editor-dark.png' });
    await page.setViewportSize({ width: 390, height: 844 }); await expect(dialog.getByRole('button', { name: 'Create task', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ animations: 'disabled', path: '.ui-audit/scheduled-editor-mobile.png' });
    await dialog.getByRole('button', { name: 'Create task', exact: true }).click(); await expect(dialog).toHaveCount(0);
    await page.screenshot({ animations: 'disabled', path: '.ui-audit/scheduled-mobile.png' });
    await page.setViewportSize({ width: 1728, height: 1117 }); await page.screenshot({ animations: 'disabled', path: '.ui-audit/scheduled-dark.png' });
    await page.getByRole('tab', { name: 'Tasks', exact: true }).focus(); await page.keyboard.press('ArrowRight'); await expect(page.getByRole('tab', { name: 'Activity', exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await request.patch('/api/settings', { data: { theme: before.theme } }); }
});
