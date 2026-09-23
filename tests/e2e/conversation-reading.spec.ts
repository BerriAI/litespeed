import { test, expect, type APIRequestContext, type Page } from './fixtures';
let ids: string[];
test.beforeEach(() => { ids = []; });
test.afterEach(async ({ request }) => { for (const id of ids) { await request.post(`/api/sessions/${id}/cancel`); await request.delete(`/api/sessions/${id}`); } });
async function task(request: APIRequestContext, title: string) {
  const result = await request.post('/api/sessions/import', { data: { session: { title, providerId: 'fixture', model: 'test-model' }, messages: Array.from({ length: 24 }, (_, index) => ({ id: String(index), role: index % 2 ? 'assistant' : 'user', content: `Reading note ${index + 1}.\n\n${'A thoughtful interface keeps the work clear and the details within reach. '.repeat(index % 2 ? 6 : 1)}`, createdAt: Date.now() + index })) } });
  expect(result.ok()).toBe(true); const session = await result.json(); ids.push(session.id); return session;
}
async function bottom(page: Page) { await expect.poll(() => page.locator('.conversation-scroll').evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(3); }
test('returns to the same passage after switching tasks and reloading', async ({ page, request }) => {
  const first = await task(request, 'Design reading notes'), second = await task(request, 'A separate discussion');
  await page.goto(`/#session/${first.id}`); await bottom(page);
  const scroll = page.locator('.conversation-scroll'); await scroll.evaluate(node => { node.scrollTop = 800; });
  await expect(page.getByRole('button', { name: 'Jump to latest' })).toBeVisible();
  const position = await scroll.evaluate(node => node.scrollTop);
  await page.getByRole('textbox', { name: 'Message Litespeed' }).fill('Keep this thought.');
  await page.locator('.session-link').filter({ hasText: second.title }).click(); await expect(page).toHaveURL(new RegExp(second.id)); await bottom(page);
  await page.locator('.session-link').filter({ hasText: first.title }).click(); await expect(page).toHaveURL(new RegExp(first.id));
  await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBeCloseTo(position, 0);
  await expect(page.getByRole('textbox', { name: 'Message Litespeed' })).toHaveText('Keep this thought.');
  await page.reload(); await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBeCloseTo(position, 0);
});

test('keeps the visible passage steady during streaming and resizing, and follows after Jump to latest or Send', async ({ page, request }) => {
  const session = await task(request, 'Live reading notes'); await page.goto(`/#session/${session.id}`); await bottom(page);
  const scroll = page.locator('.conversation-scroll'); await scroll.evaluate(node => { node.scrollTop = 800; }); await expect(page.getByRole('button', { name: 'Jump to latest' })).toBeVisible();
  const anchor = await scroll.evaluate(node => { const top = node.getBoundingClientRect().top; const message = [...node.querySelectorAll<HTMLElement>('[data-message-id]')].find(item => item.getBoundingClientRect().bottom > top + 1)!; return { id: message.dataset.messageId!, y: message.getBoundingClientRect().top }; });
  expect((await request.post(`/api/sessions/${session.id}/messages`, { data: { content: 'slow response while I read earlier notes' } })).ok()).toBe(true);
  await expect(page.getByRole('button', { name: 'Stop generation', exact: true })).toBeVisible();
  await expect.poll(() => page.locator(`[data-message-id="${anchor.id}"]`).evaluate(node => node.getBoundingClientRect().top)).toBeCloseTo(anchor.y, 0);
  await expect(page.getByRole('button', { name: 'Stop generation', exact: true })).toHaveCount(0);
  await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBeCloseTo(800, 0);
  await page.getByRole('button', { name: 'Show workspace panel' }).click(); await expect(page.locator(`[data-message-id="${anchor.id}"]`)).toBeInViewport();
  await page.getByRole('button', { name: 'Jump to latest' }).click(); await bottom(page);
  await scroll.evaluate(node => { node.scrollTop = 400; }); await expect(page.getByRole('button', { name: 'Jump to latest' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Message Litespeed' }).fill('slow response after I send'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await bottom(page); await expect(page.getByRole('button', { name: 'Stop generation', exact: true })).toHaveCount(0); await bottom(page);
});

async function longPrompt(request: APIRequestContext) {
  const content = 'Please refine this workspace.\n\n' + Array.from({ length: 12 }, (_, index) => `**Detail ${index + 1}.** Keep the interface calm, with clear type, generous spacing and straightforward controls.`).join('\n\n') + '\n\nThe tessellated finish should be easy to find. [Read the project notes](https://example.com/notes).';
  const response = await request.post('/api/sessions/import', { data: { session: { title: 'A considered workspace', providerId: 'fixture', model: 'test-model' }, messages: [{ id: 'prompt', role: 'user', content, createdAt: 1 }, { id: 'answer', role: 'assistant', content: 'I’ll keep the workspace simple and the details close at hand.\n\nThe conversation stays central, with files and previews beside it.', createdAt: 2 }] } });
  expect(response.ok()).toBe(true); const session = await response.json(); ids.push(session.id); return session;
}
for (const width of [1440, 390]) test(`folds long prompts cleanly and keeps expanded state at ${width}px`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await page.emulateMedia({ colorScheme: width === 390 ? 'light' : 'dark' });
  const session = await longPrompt(request); await page.goto(`/#session/${session.id}`); await bottom(page);
  const prompt = page.getByRole('article', { name: 'Your message', exact: true }), clip = prompt.locator('.prompt-clip');
  await expect(prompt.getByRole('button', { name: 'Show full message' })).toBeVisible(); expect((await clip.boundingBox())!.height).toBeLessThanOrEqual(280);
  await page.screenshot({ path: `.ui-audit/conversation-prompt-${width}.png`, animations: 'disabled' });
  await prompt.getByRole('button', { name: 'Show full message' }).click(); await expect(prompt.getByRole('button', { name: 'Show less of message' })).toHaveAttribute('aria-expanded', 'true');
  expect((await clip.boundingBox())!.height).toBeGreaterThan(600);
  await prompt.getByRole('link', { name: 'Read the project notes' }).scrollIntoViewIfNeeded(); await page.reload();
  await expect(prompt.getByRole('button', { name: 'Show less of message' })).toBeInViewport();
  await prompt.getByRole('button', { name: 'Show less of message' }).click(); await expect(prompt.getByRole('button', { name: 'Show full message' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('reveals folded messages for keyboard links and task-search results', async ({ page, request }) => {
  const session = await longPrompt(request); await page.goto(`/#session/${session.id}`); await bottom(page);
  const prompt = page.getByRole('article', { name: 'Your message', exact: true }); await expect(prompt.getByRole('button', { name: 'Show full message' })).toBeVisible();
  const link = prompt.getByRole('link', { name: 'Read the project notes' }); await link.focus(); await expect(link).toBeFocused(); await expect(link).toBeInViewport();
  await expect(prompt.getByRole('button', { name: 'Show less of message' })).toHaveAttribute('aria-expanded', 'true');
  await prompt.getByRole('button', { name: 'Show less of message' }).click();
  await page.keyboard.press('ControlOrMeta+Shift+f'); const search = page.getByRole('dialog', { name: 'Search tasks', exact: true }); await search.getByRole('combobox', { name: 'Search task names or messages', exact: true }).fill('tessellated');
  await expect(search.getByRole('option', { name: session.title, exact: true })).toBeVisible(); await search.getByRole('combobox', { name: 'Search task names or messages', exact: true }).press('Enter');
  await expect(prompt).toBeFocused(); await expect(prompt.getByRole('button', { name: 'Show less of message' })).toHaveAttribute('aria-expanded', 'true');
  await page.reload(); await expect(prompt.getByRole('button', { name: 'Show less of message' })).toHaveAttribute('aria-expanded', 'true');
});
test('keeps conversation reading usable when saved view storage is unavailable', async ({ page, request }) => {
  await page.addInitScript(() => { const get = Storage.prototype.getItem, set = Storage.prototype.setItem; Storage.prototype.getItem = function(key) { if (key === 'litespeed:conversation-views:v1') throw new Error('Unavailable'); return get.call(this, key); }; Storage.prototype.setItem = function(key, value) { if (key === 'litespeed:conversation-views:v1') throw new Error('Full'); return set.call(this, key, value); }; });
  const session = await longPrompt(request); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/#session/${session.id}`); await page.getByRole('button', { name: 'Show full message' }).click(); await expect(page.getByRole('button', { name: 'Show less of message' })).toBeVisible();
  await page.getByRole('button', { name: 'Jump to latest' }).click(); await bottom(page); expect(errors).toEqual([]);
});
