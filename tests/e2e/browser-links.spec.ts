import { test, expect, type APIRequestContext, type Page } from './fixtures';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrowserSessions } from '../../server/browser-state';

let ids: string[], base: string, workspace: string;
test.beforeEach(async ({ request }) => { ids = []; const settings = await (await request.get('/api/settings')).json(); base = settings.providers.find((provider: { id: string }) => provider.id === 'fixture').baseUrl; workspace = settings.workspace; });
test.afterEach(async ({ request }) => { for (const id of ids) { await request.post(`/api/sessions/${id}/cancel`); await request.delete(`/api/sessions/${id}`); } });
async function task(request: APIRequestContext, title = 'Explore the preview') {
  const result = await request.post('/api/sessions/import', { data: { session: { title, providerId: 'fixture', model: 'test-model' }, messages: [{ id: 'links', role: 'assistant', content: `Review [the overview](${base}/browser-fixture) and [the next page](${base}/browser-next).`, createdAt: Date.now() }] } }); expect(result.ok()).toBe(true); const session = await result.json(); ids.push(session.id); return session;
}
const browser = async (request: APIRequestContext, id: string) => (await (await request.get(`/api/sessions/${id}/browser`)).json());
async function hold(request: APIRequestContext, id: string) { expect((await request.post(`/api/sessions/${id}/messages`, { data: { content: 'TUI_QUEUE_HOLD' } })).ok()).toBe(true); await expect.poll(async () => (await (await request.get(`/api/sessions/${id}`)).json()).session.status).toBe('running'); }
async function stop(request: APIRequestContext, page: Page, id: string) { await request.post(`/api/sessions/${id}/cancel`); await expect(page.getByRole('button', { name: 'Stop generation', exact: true })).toHaveCount(0); }

test('conversation links open beside the draft, reuse matching tabs and support browser shortcuts', async ({ page, request }) => {
  const session = await task(request); await page.emulateMedia({ colorScheme: 'dark' }); await page.goto(`/#session/${session.id}`); const draft = page.getByRole('textbox', { name: 'Message Litespeed' }); await draft.fill('Keep this question.');
  const before = (await (await request.get('/fixture/requests')).json()).count;
  await page.getByRole('link', { name: 'the overview', exact: true }).click(); await expect(page.getByRole('img', { name: 'Browser preview of Workspace preview' })).toBeVisible(); const first = await browser(request, session.id); expect(first.tabs).toHaveLength(1);
  await page.getByRole('link', { name: 'the next page', exact: true }).click(); await expect(page.getByRole('img', { name: 'Browser preview of Next page' })).toBeVisible(); expect((await browser(request, session.id)).tabs).toHaveLength(2);
  await page.getByRole('link', { name: 'the overview', exact: true }).click(); await expect(page.getByRole('tab', { name: 'Workspace preview', exact: true })).toHaveAttribute('aria-selected', 'true'); expect((await browser(request, session.id)).activeId).toBe(first.activeId); expect((await browser(request, session.id)).tabs).toHaveLength(2);
  await expect(draft).toHaveValue('Keep this question.'); expect((await (await request.get('/fixture/requests')).json()).count).toBe(before);
  await expect(page.getByRole('img', { name: 'Browser preview of Workspace preview' })).toBeVisible(); await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/conversation-browser-link.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Close workspace', exact: true }).click(); await draft.focus(); await page.keyboard.press('ControlOrMeta+Shift+b'); await expect(page.getByRole('tab', { name: 'Browser', exact: true })).toHaveAttribute('aria-selected', 'true'); await expect(page.locator('.browser-tabs [role=tab]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Close workspace', exact: true }).click(); await page.evaluate(() => window.dispatchEvent(new CustomEvent('litespeed:desktop-command', { detail: 'browser' }))); await expect(page.getByRole('img', { name: 'Browser preview of Workspace preview' })).toBeVisible();
});

test('clicking a saved page explicitly reopens its existing tab instead of duplicating it', async ({ page, request }) => {
  const session = await task(request), tab = { id: randomUUID(), title: 'Workspace preview', url: base + '/browser-fixture' };
  await new BrowserSessions(join(workspace, 'state')).save(session.id, { tabs: [tab], activeId: tab.id, width: 640, height: 800 });
  await page.goto(`/#session/${session.id}`); await page.getByRole('link', { name: 'the overview', exact: true }).click(); await expect(page.getByRole('img', { name: 'Browser preview of Workspace preview' })).toBeVisible();
  const state = await browser(request, session.id); expect(state.tabs).toHaveLength(1); expect(state.activeId).toBe(tab.id); expect(state.tabs[0].suspended).toBeUndefined();
});

test('waits for the running task before opening a link and offers a visible cancel action', async ({ page, request }) => {
  const session = await task(request); await page.goto(`/#session/${session.id}`); await hold(request, session.id); await expect(page.getByRole('button', { name: 'Stop generation', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'the overview', exact: true }).click(); await expect(page.getByText('Link will open when this task is ready', { exact: true })).toBeVisible(); expect((await browser(request, session.id)).tabs).toHaveLength(0);
  await page.setViewportSize({ width: 390, height: 500 }); await expect(page.getByRole('button', { name: 'Cancel opening link', exact: true })).toBeInViewport(); await page.screenshot({ path: '.ui-audit/browser-link-waiting-mobile.png', animations: 'disabled' });
  await stop(request, page, session.id); await expect(page.getByRole('img', { name: 'Browser preview of Workspace preview' })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 }); await hold(request, session.id); await expect(page.getByRole('button', { name: 'Stop generation', exact: true })).toBeVisible(); await page.getByRole('link', { name: 'the next page', exact: true }).click(); await page.getByRole('button', { name: 'Cancel opening link', exact: true }).click();
  await stop(request, page, session.id); await expect(page.getByText('Link will open when this task is ready', { exact: true })).toHaveCount(0); expect((await browser(request, session.id)).tabs).toHaveLength(1);
});

for (const closeWith of ['top bar', 'desktop menu'] as const) test(`hiding the workspace from the ${closeWith} cancels its waiting link`, async ({ page, request }) => {
  const session = await task(request); await page.goto(`/#session/${session.id}`); const draft = page.getByRole('textbox', { name: 'Message Litespeed' }); await draft.fill('Keep the unfinished draft.');
  await hold(request, session.id); await expect(page.getByRole('button', { name: 'Stop generation', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'the overview', exact: true }).click(); await expect(page.getByRole('button', { name: 'Cancel opening link', exact: true })).toBeVisible();
  if (closeWith === 'top bar') await page.getByRole('button', { name: 'Hide workspace panel', exact: true }).click();
  else await page.evaluate(() => window.dispatchEvent(new CustomEvent('litespeed:desktop-command', { detail: 'workspace' })));
  await expect(page.getByRole('button', { name: 'Show workspace panel', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Show workspace panel', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Browser', exact: true })).toHaveAttribute('aria-selected', 'true'); await expect(page.getByRole('button', { name: 'Cancel opening link', exact: true })).toHaveCount(0);
  await stop(request, page, session.id); await expect(page.getByText('Where would you like to go?', { exact: true })).toBeVisible(); expect((await browser(request, session.id)).tabs).toHaveLength(0); await expect(draft).toHaveValue('Keep the unfinished draft.');
});

test('switching tasks in the sidebar cancels a waiting link and preserves each draft', async ({ page, request }) => {
  const first = await task(request), second = await task(request, 'A separate preview task'); await page.goto(`/#session/${first.id}`); const draft = page.getByRole('textbox', { name: 'Message Litespeed' }); await draft.fill('First task draft.'); await hold(request, first.id); await expect(page.getByRole('button', { name: 'Stop generation', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'the overview', exact: true }).click(); await expect(page.getByRole('button', { name: 'Cancel opening link', exact: true })).toBeVisible();
  await page.getByRole('button', { name: second.title, exact: true }).click(); await expect(page).toHaveURL(new RegExp(`#session/${second.id}$`)); await expect(draft).toHaveValue(''); await draft.fill('Second task draft.'); await request.post(`/api/sessions/${first.id}/cancel`); await page.keyboard.press('ControlOrMeta+Shift+b');
  await expect(page.getByText('Where would you like to go?', { exact: true })).toBeVisible(); expect((await browser(request, first.id)).tabs).toHaveLength(0); expect((await browser(request, second.id)).tabs).toHaveLength(0);
  await expect(page.getByRole('button', { name: first.title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: first.title, exact: true }).click(); await expect(page).toHaveURL(new RegExp(`#session/${first.id}$`)); await expect(draft).toHaveValue('First task draft.'); await expect(page.getByText('Where would you like to go?', { exact: true })).toBeVisible(); expect((await browser(request, first.id)).tabs).toHaveLength(0);
  await page.getByRole('button', { name: second.title, exact: true }).click(); await expect(draft).toHaveValue('Second task draft.');
});

test('a failed link remains retryable and an unfinished page comment stays intact', async ({ page, request }) => {
  const session = await task(request); await page.goto(`/#session/${session.id}`); let fail = true;
  await page.route(`**/api/sessions/${session.id}/browser`, route => route.request().method() === 'POST' && fail ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Browser is temporarily unavailable.' }) }) : route.continue());
  await page.getByRole('link', { name: 'the overview', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('temporarily unavailable'); fail = false;
  await page.getByRole('link', { name: 'the overview', exact: true }).click(); await expect(page.getByRole('img', { name: 'Browser preview of Workspace preview' })).toBeVisible();
  const comment = page.getByRole('button', { name: 'Comment on browser page', exact: true }); await expect(comment).toBeEnabled(); await comment.click(); const input = page.getByRole('textbox', { name: 'Browser comment', exact: true }); await input.fill('Keep this page observation.');
  await page.getByRole('link', { name: 'the next page', exact: true }).click(); await expect(page.getByText('Finish your page comment to open this link', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Cancel opening link', exact: true })).toBeInViewport(); await expect(input).toHaveValue('Keep this page observation.');
  await page.getByRole('button', { name: 'Cancel opening link', exact: true }).click(); await expect(input).toHaveValue('Keep this page observation.'); expect((await browser(request, session.id)).tabs).toHaveLength(1);
});
