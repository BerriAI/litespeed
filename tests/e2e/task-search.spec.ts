import { test, expect, type APIRequestContext, type Page } from './fixtures';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let ids: string[], root: string;
test.beforeEach(async () => { ids = []; root = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-task-search-'))); });
test.afterEach(async ({ request }) => { for (const id of ids) await request.delete(`/api/sessions/${id}`); await rm(root, { recursive: true, force: true }); });
async function task(request: APIRequestContext, title: string, contents: string[], options: { archived?: boolean; project?: string } = {}) {
  const response = options.project ? await request.post('/api/sessions', { data: { title, workspace: options.project, providerId: 'fixture', model: 'test-model', architecture: null } }) : await request.post('/api/sessions/import', { data: { session: { title, providerId: 'fixture', model: 'test-model' }, messages: contents.map((content, index) => ({ id: String(index), role: index % 2 ? 'assistant' : 'user', content, createdAt: Date.now() + index })) } }); expect(response.ok()).toBe(true);
  const created = await response.json(); ids.push(created.id);
  if (options.project) for (const content of contents) { expect((await request.post(`/api/sessions/${created.id}/messages`, { data: { content } })).ok()).toBe(true); await expect.poll(async () => (await (await request.get(`/api/sessions/${created.id}`)).json()).session.status).toBe('idle'); }
  if (options.archived) { const update = await request.patch(`/api/sessions/${created.id}`, { data: { archived: true } }); expect(update.ok()).toBe(true); }
  const detail = await (await request.get(`/api/sessions/${created.id}`)).json(); return { ...detail.session, messages: detail.messages };
}
async function search(page: Page) {
  await page.keyboard.press('ControlOrMeta+Shift+f'); const dialog = page.getByRole('dialog', { name: 'Search tasks', exact: true }); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Search task names or messages', exact: true })).toBeFocused(); return dialog;
}
test('finds a message in a long task, jumps to it and preserves the current draft', async ({ page, request }) => {
  const earlier = await task(request, 'Refine the quiet interface', ['The tessellated spacing should stay consistent.', 'A clear beginning, with thoughtful typography.', ...Array.from({ length: 18 }, (_, index) => `Later conversation ${index}.\n\n${'Careful alignment and a little breathing room. '.repeat(14)}`)]);
  const current = await task(request, 'Current design question', []); await page.emulateMedia({ colorScheme: 'dark' }); await page.goto(`/#session/${current.id}`);
  const composer = page.getByRole('textbox', { name: 'Message Litespeed' }); await composer.fill('Keep this unfinished question.'); const before = (await (await request.get('/fixture/requests')).json()).count;
  const dialog = await search(page), input = dialog.getByRole('combobox', { name: 'Search task names or messages', exact: true }); await input.fill('tessellated');
  const option = dialog.getByRole('listbox').getByRole('option', { name: earlier.title, exact: true }); await expect(option).toBeVisible(); await expect(option).toContainText('spacing should stay consistent'); await expect(option.locator('mark')).toHaveText('tessellated');
  await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/task-search-desktop.png', animations: 'disabled' });
  await input.press('Enter'); await expect(dialog).toHaveCount(0); await expect(page).toHaveURL(new RegExp(earlier.id));
  const target = page.locator(`[data-message-id="${earlier.messages[0].id}"]`); await expect(target).toBeFocused(); await expect(target).toBeInViewport(); await expect(target).toHaveClass(/search-highlight/);
  await expect(page.getByRole('button', { name: 'Jump to latest', exact: true })).toBeVisible(); await page.screenshot({ path: '.ui-audit/task-search-message-desktop.png', animations: 'disabled' });
  const again = await search(page); await again.getByRole('combobox', { name: 'Search task names or messages', exact: true }).fill('thoughtful typography');
  await expect(again.getByRole('listbox').getByRole('option', { name: earlier.title, exact: true })).toContainText('thoughtful typography');
  await again.getByRole('combobox', { name: 'Search task names or messages', exact: true }).press('Enter');
  const assistant = page.locator(`[data-message-id="${earlier.messages[1].id}"]`); await expect(assistant).toBeFocused(); await expect(assistant).toBeInViewport(); await expect(assistant).toHaveClass(/search-highlight/);
  await page.screenshot({ path: '.ui-audit/task-search-assistant-desktop.png', animations: 'disabled' });
  await page.goto(`/#session/${current.id}`); await expect(composer).toHaveValue('Keep this unfinished question.'); expect((await (await request.get('/fixture/requests')).json()).count).toBe(before);
});
test('filters projects and archives without changing their state and fits a short narrow window', async ({ page, request }) => {
  const archived = await task(request, 'Saved typography decisions', ['Keep the tessellated rhythm.'], { archived: true, project: root }), active = await task(request, 'Current typography decisions', ['The tessellated rhythm is ready.']);
  await page.setViewportSize({ width: 390, height: 500 }); await page.emulateMedia({ colorScheme: 'light' }); await page.goto(`/#session/${active.id}`);
  const dialog = await search(page), input = dialog.getByRole('combobox', { name: 'Search task names or messages', exact: true }); await input.fill('tessellated'); await expect(dialog.getByRole('listbox').getByRole('option')).toHaveCount(2);
  await dialog.getByRole('checkbox', { name: 'Include archived', exact: true }).uncheck(); await expect(dialog.getByRole('listbox').getByRole('option')).toHaveCount(1); await expect(dialog.getByRole('listbox').getByRole('option', { name: active.title, exact: true })).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Include archived', exact: true }).check();
  // A project from an archived task remains searchable even when it is absent
  // from the main sidebar's active-task list.
  await dialog.getByRole('combobox', { name: 'Search project', exact: true }).selectOption(root); await expect(dialog.getByRole('listbox').getByRole('option')).toHaveCount(1);
  await expect(dialog.getByRole('listbox').getByRole('option', { name: archived.title, exact: true })).toContainText('Archived'); await page.screenshot({ path: '.ui-audit/task-search-mobile.png', animations: 'disabled' });
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true); await input.focus(); await input.press('Enter'); await expect(page).toHaveURL(new RegExp(archived.id));
  expect((await (await request.get(`/api/sessions/${archived.id}`)).json()).session.archived).toBe(true);
});
test('ignores delayed older results, recovers from errors and restores focus on dismissal', async ({ page, request }) => {
  const earlier = await task(request, 'A calm workspace', ['A tessellated layout.']); await page.goto(`/#session/${earlier.id}`); const trigger = page.getByRole('button', { name: 'Search tasks', exact: true }); await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Search tasks', exact: true }), input = dialog.getByRole('combobox', { name: 'Search task names or messages', exact: true });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let received!: () => void; const started = new Promise<void>(resolve => { received = resolve; });
  await page.route('**/api/task-search?**', async route => { const value = new URL(route.request().url()).searchParams.get('query'); if (value === 'tessellated') { const response = await route.fetch(); received(); await gate; await route.fulfill({ response }).catch(() => {}); } else await route.continue(); });
  await input.fill('tessellated'); await started; await input.fill('unmatchedword'); await expect(dialog.getByText('No matching tasks', { exact: true })).toBeVisible(); release(); await expect(input).toHaveValue('unmatchedword'); await expect(dialog.getByRole('listbox').getByRole('option')).toHaveCount(0);
  await page.unroute('**/api/task-search?**'); let fail = true; await page.route('**/api/task-search?**', route => fail ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Search temporarily disconnected.' }) }) : route.continue());
  await input.fill('tessellated'); await expect(dialog.getByRole('alert')).toContainText('temporarily disconnected'); fail = false; await dialog.getByRole('button', { name: 'Try again', exact: true }).click(); await expect(dialog.getByRole('listbox').getByRole('option', { name: earlier.title, exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
});
test('keeps result navigation and the modal focus loop usable when the list is long', async ({ page, request }) => {
  for (let index = 0; index < 12; index++) await task(request, `Tessellated task ${index}`, ['An ordinary message.']);
  await page.setViewportSize({ width: 390, height: 500 }); await page.goto(`/#session/${ids[0]}`); const dialog = await search(page), input = dialog.getByRole('combobox', { name: 'Search task names or messages', exact: true }); await input.fill('tessellated'); await expect(dialog.getByRole('listbox').getByRole('option')).toHaveCount(12);
  for (let index = 0; index < 10; index++) await input.press('ArrowDown'); const selected = dialog.getByRole('listbox').getByRole('option', { selected: true }); await expect(selected).toBeInViewport({ ratio: 1 }); await expect(input).toBeFocused();
  await dialog.getByRole('checkbox', { name: 'Include archived', exact: true }).focus(); await page.keyboard.press('Tab'); await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('checkbox', { name: 'Include archived', exact: true })).toBeFocused();
});
