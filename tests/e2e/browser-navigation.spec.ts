import { test, expect, type Page } from './fixtures';

let session: { id: string }, base: string;
test.beforeEach(async ({ request }) => {
  const settings = await (await request.get('/api/settings')).json(); base = settings.providers.find((provider: { id: string }) => provider.id === 'fixture').baseUrl;
  session = await (await request.post('/api/sessions', { data: { workspace: settings.workspace, title: 'Browse with the keyboard', providerId: 'fixture', model: 'test-model', architecture: null, permissionMode: 'auto' } })).json();
});
test.afterEach(async ({ request }) => { await request.delete(`/api/sessions/${session.id}`); });
async function open(page: Page) { await page.goto(`/#session/${session.id}`); await page.getByRole('button', { name: 'Show workspace panel' }).click(); await page.getByRole('tab', { name: 'Browser', exact: true }).click(); await expect(page.getByRole('button', { name: 'Reload page', exact: true })).toBeEnabled(); await expect.poll(() => page.locator('.browser-viewport').evaluate(element => element.querySelector('img')?.naturalWidth === Math.round(element.clientWidth))).toBe(true); }

test('back and forward follow per-tab history and address shortcuts keep the task open', async ({ page, request }) => {
  await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'open', url: base + '/browser-fixture' } });
  await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'navigate', url: base + '/browser-next' } });
  await open(page); await expect(page.getByRole('button', { name: 'Browser back', exact: true })).toBeEnabled(); await expect(page.getByRole('button', { name: 'Browser forward', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Browser back', exact: true }).click(); await expect(page.getByRole('tab', { name: 'Workspace preview', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Browser forward', exact: true })).toBeEnabled();
  await page.getByRole('combobox', { name: 'Browser address' }).focus(); await page.keyboard.press('ControlOrMeta+]'); await expect(page.getByRole('tab', { name: 'Next page', exact: true })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+l'); await expect(page.getByRole('combobox', { name: 'Browser address' })).toBeFocused();
  expect(await page.getByRole('combobox', { name: 'Browser address' }).evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([0, (base + '/browser-next').length]);
  await expect(page.getByRole('button', { name: 'New browser tab', exact: true })).toBeEnabled(); await page.keyboard.press('ControlOrMeta+t'); await expect(page.getByRole('tab', { name: 'New tab', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New browser tab', exact: true })).toBeEnabled(); await page.keyboard.press('Control+Shift+Tab'); await expect(page.getByRole('tab', { name: 'Next page', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'New browser tab', exact: true })).toBeEnabled(); await page.keyboard.press('Control+Tab'); await expect(page.getByRole('tab', { name: 'New tab', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'New browser tab', exact: true })).toBeEnabled(); await page.keyboard.press('ControlOrMeta+Shift+BracketLeft'); await expect(page.getByRole('tab', { name: 'Next page', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'New browser tab', exact: true })).toBeEnabled(); await page.keyboard.press('ControlOrMeta+Shift+BracketRight'); await expect(page.getByRole('tab', { name: 'New tab', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'New browser tab', exact: true })).toBeEnabled(); expect(await page.evaluate(() => window.dispatchEvent(new CustomEvent('litespeed:workspace-command', { detail: 'previous-tab', cancelable: true })))).toBe(false); await expect(page.getByRole('tab', { name: 'Next page', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'New browser tab', exact: true })).toBeEnabled(); expect(await page.evaluate(() => window.dispatchEvent(new CustomEvent('litespeed:workspace-command', { detail: 'next-tab', cancelable: true })))).toBe(false); await expect(page.getByRole('tab', { name: 'New tab', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'New browser tab', exact: true })).toBeEnabled(); await page.keyboard.press('ControlOrMeta+w'); await expect(page.getByRole('tab', { name: 'New tab', exact: true })).toHaveCount(0); await expect(page.getByRole('tab', { name: 'Next page', exact: true })).toBeVisible();
  expect(page.url()).toContain(session.id);
});
test('Tab moves through website controls, and Escape returns to the address bar', async ({ page, request }) => {
  await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'open', url: base + '/browser-keyboard' } }); await open(page);
  await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'click', ref: 'e1' } });
  const viewport = page.getByLabel('Interactive browser page'); await viewport.focus(); await viewport.pressSequentially('Ada'); await viewport.press('Tab'); await expect(viewport).toBeFocused(); await viewport.press('Enter');
  await expect(page.getByRole('tab', { name: 'Hello Ada', exact: true })).toBeVisible();
  await viewport.press('Escape'); await expect(page.getByRole('combobox', { name: 'Browser address' })).toBeFocused();
});
test('a new-tab click during automatic fitting is queued once and preserves the draft', async ({ page, request }) => {
  await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'open', url: base + '/browser-fixture' } });
  let release!: () => void, arrived!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), resizing = new Promise<void>(resolve => { arrived = resolve; });
  await page.route(`**/api/sessions/${session.id}/browser`, async route => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON().action !== 'resize') return route.continue();
    const response = await route.fetch(); arrived(); await gate; await route.fulfill({ response });
  });
  try {
    await page.goto(`/#session/${session.id}`); const draft = page.getByRole('textbox', { name: 'Message Litespeed' }); await draft.fill('Keep this browser question.');
    await page.getByRole('button', { name: 'Show workspace panel', exact: true }).click(); await page.getByRole('tab', { name: 'Browser', exact: true }).click(); await resizing;
    const add = page.getByRole('button', { name: 'New browser tab', exact: true }); await expect(add).toBeEnabled(); await add.click(); await expect(add).toBeDisabled();
    expect((await (await request.get(`/api/sessions/${session.id}/browser`)).json()).tabs).toHaveLength(1);
    release(); await expect(page.locator('.browser-tabs [role=tab]')).toHaveCount(2); await expect(page.getByRole('tab', { name: 'New tab', exact: true })).toHaveAttribute('aria-selected', 'true'); await expect(add).toBeEnabled(); await expect(draft).toHaveValue('Keep this browser question.');
  } finally { release(); }
});
test('native Reload and Close menu events act on the focused browser and fall back elsewhere', async ({ page, request }) => {
  await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'open', url: base + '/browser-fixture' } }); await open(page);
  const address = page.getByRole('combobox', { name: 'Browser address' }); await address.focus();
  const event = (name: string) => page.evaluate(command => window.dispatchEvent(new CustomEvent('litespeed:workspace-command', { detail: command, cancelable: true })), name);
  expect(await event('reload')).toBe(false); await expect(page.getByRole('button', { name: 'Reload page', exact: true })).toBeEnabled();
  await page.getByRole('textbox', { name: 'Message Litespeed' }).focus(); expect(await event('close-tab')).toBe(true); expect(await event('reload')).toBe(true);
  await address.focus(); expect(await event('close-tab')).toBe(false); await expect(page.getByRole('tab', { name: 'Workspace preview', exact: true })).toHaveCount(0);
  expect(page.url()).toContain(session.id);
});

test('a newer address draft survives an in-flight navigation response', async ({ page, request }) => {
  await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'open', url: base + '/browser-fixture' } }); await open(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/sessions/${session.id}/browser`, async route => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON().action !== 'navigate') return route.continue();
    const response = await route.fetch(); await gate; await route.fulfill({ response });
  });
  try {
    const address = page.getByRole('combobox', { name: 'Browser address' }); await address.fill(base + '/browser-next'); await address.press('Enter');
    await expect(page.getByRole('button', { name: 'Go to address' })).toBeDisabled();
    await address.fill('An unsent search'); release();
    await expect(page.getByRole('tab', { name: 'Next page', exact: true })).toBeVisible(); await expect(address).toHaveValue('An unsent search');
  } finally { release(); }
});
test('stops a slow page from the toolbar without closing its tab or losing an address draft', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'open', url: base + '/browser-fixture' } }); await open(page);
  const address = page.getByRole('combobox', { name: 'Browser address' }); await address.fill(base + '/browser-slow'); await address.press('Enter');
  const stop = page.getByRole('button', { name: 'Stop loading page' }); await expect(stop).toBeEnabled();
  await expect(page.getByRole('tab', { name: 'A page taking its time', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Browser preview of A page taking its time' })).toBeVisible();
  await page.screenshot({ path: '.ui-audit/browser-stop-loading.png', animations: 'disabled' });
  await address.fill('Keep this unsent search'); await stop.click(); await expect(page.getByRole('button', { name: 'Reload page', exact: true })).toBeEnabled();
  await expect(address).toHaveValue('Keep this unsent search'); await expect(page.getByRole('alert')).toHaveCount(0);
  const state = await (await request.get(`/api/sessions/${session.id}/browser`)).json(); expect(state.tabs).toHaveLength(1); expect(state.tabs[0].suspended).toBeUndefined(); expect(state.tabs[0].loading).toBeUndefined();
  await address.fill(base + '/browser-next'); await address.press('Enter'); await expect(page.getByRole('tab', { name: 'Next page', exact: true })).toBeVisible();
});
test('Escape stops the current load from the page and returns focus to the address bar', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'light' });
  await request.post(`/api/sessions/${session.id}/browser`, { data: { action: 'open', url: base + '/browser-fixture' } }); await open(page);
  const address = page.getByRole('combobox', { name: 'Browser address' }); await address.fill(base + '/browser-pending-response'); await address.press('Enter');
  await expect(page.getByRole('button', { name: 'Stop loading page' })).toBeEnabled();
  await page.screenshot({ path: '.ui-audit/browser-stop-mobile.png', animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Interactive browser page').focus(); await page.keyboard.press('Escape'); await expect(address).toBeFocused();
  await expect(page.getByRole('button', { name: 'Reload page', exact: true })).toBeEnabled(); await expect(page.getByRole('tab', { name: 'Workspace preview', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
