import { test, expect, type Page } from './fixtures';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let workspace: string, sessionId: string;
const rules = (command: string) => JSON.stringify({ version: 1, rules: [{ tool: 'bash', decision: 'allow', patterns: [command] }] }, null, 2);
test.beforeEach(async ({ request }) => {
  workspace = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-project-access-')));
  await mkdir(join(workspace, '.litespeed'));
  const response = await request.post('/api/sessions', { data: { workspace, title: 'Project access review', providerId: 'fixture', model: 'test-model', architecture: null } });
  expect(response.ok()).toBe(true); sessionId = (await response.json()).id;
});
test.afterEach(async ({ request }) => {
  await request.delete('/api/workspaces/permission-rules', { data: { workspace } });
  await request.delete('/api/workspaces/trust', { data: { workspace } });
  await request.delete(`/api/sessions/${sessionId}`); await rm(workspace, { recursive: true, force: true });
});
async function open(page: Page) {
  await page.goto(`/#session/${sessionId}`);
  if ((page.viewportSize()?.width ?? 1440) < 750) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Permissions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh project access', exact: true })).toBeVisible();
  await expect(page.locator('[data-setting="project-hooks"]')).toBeVisible();
}
test('reviews changed project rules and keeps immediate access changes after closing settings', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await writeFile(join(workspace, '.litespeed/permissions.json'), rules('echo first'));
  await open(page);
  await expect(page.locator('.permissions-help')).not.toHaveAttribute('open');
  const search = page.getByRole('searchbox', { name: 'Search settings' }); await search.fill('project allow rules'); await search.press('Enter');
  await expect(page.getByRole('button', { name: 'Trust reviewed allow rules' })).toBeFocused();
  expect((await (await request.get(`/api/workspaces/permissions?workspace=${encodeURIComponent(workspace)}`)).json()).rules.trusted).toBe(false);
  await page.getByText('Review project permission rules', { exact: true }).click(); await expect(page.locator('.permission-source-review pre')).toContainText('echo first');
  await writeFile(join(workspace, '.litespeed/permissions.json'), rules('echo second'));
  await page.getByRole('button', { name: 'Trust reviewed allow rules' }).click(); await expect(page.getByRole('alert')).toContainText('Project rules changed');
  await page.getByRole('button', { name: 'Refresh project access' }).click(); await expect(page.locator('.permission-source-review pre')).toContainText('echo second');
  await page.getByRole('button', { name: 'Trust reviewed allow rules' }).click(); await expect(page.getByRole('button', { name: 'Revoke project allow rules' })).toBeVisible();
  await page.getByText('Review project permission rules', { exact: true }).click();
  await expect(page.locator('[data-setting="project-allow-rules"]')).not.toHaveAttribute('data-highlighted');
  await page.locator('.settings-content').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: '.ui-audit/permissions-project-desktop.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await (await request.get(`/api/workspaces/permissions?workspace=${encodeURIComponent(workspace)}`)).json()).rules.trusted).toBe(true);
  await open(page); await page.getByRole('button', { name: 'Revoke project allow rules' }).click();
  await expect(page.getByRole('button', { name: 'Trust reviewed allow rules' })).toBeVisible();
});
test('can disable previously trusted hooks when the configuration becomes linked', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 650 }); await page.emulateMedia({ colorScheme: 'light' });
  const hookFile = join(workspace, '.litespeed/hooks.json');
  await writeFile(hookFile, JSON.stringify({ version: 1, hooks: [{ event: 'Stop', command: 'echo fixture hook' }] }));
  await open(page); await page.getByRole('button', { name: 'Trust project hooks', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disable project hooks', exact: true })).toBeVisible();
  const linked = join(workspace, 'linked-hooks.json'); await writeFile(linked, '{}'); await rm(hookFile); await symlink(linked, hookFile);
  await page.getByRole('button', { name: 'Refresh project access', exact: true }).click();
  const hooks = page.locator('[data-setting="project-hooks"]'); await expect(hooks.getByRole('alert')).toBeVisible();
  await expect(hooks.getByRole('button', { name: 'Disable project hooks', exact: true })).toBeEnabled();
  await hooks.scrollIntoViewIfNeeded(); await page.screenshot({ path: '.ui-audit/permissions-hooks-mobile.png', animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await hooks.getByRole('button', { name: 'Disable project hooks', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Project hooks disabled');
  expect((await (await request.get(`/api/workspaces/permissions?workspace=${encodeURIComponent(workspace)}`)).json()).hooks.trusted).toBe(false);
});
test('task confinement reflects saved configuration and rule editing fits a short window', async ({ page, request }) => {
  await open(page);
  const review = await (await request.get(`/api/workspaces/permissions?workspace=${encodeURIComponent(workspace)}`)).json();
  const toggle = page.getByRole('switch', { name: 'Keep commands in this workspace', exact: true });
  if (review.sandboxBackend) {
    await toggle.click(); await expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect((await (await request.get(`/api/sessions/${sessionId}`)).json()).session.commandSandbox).toBe('workspace');
    await toggle.click(); await expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect((await (await request.get(`/api/sessions/${sessionId}`)).json()).session.commandSandbox).toBe('off');
  } else await expect(toggle).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 500 });
  const search = page.getByRole('searchbox', { name: 'Search settings' }); await search.fill('tool permission'); await search.press('Enter');
  await page.getByRole('button', { name: 'Add rule', exact: true }).click();
  await page.getByRole('textbox', { name: 'Rule 1 patterns' }).fill('git status');
  await expect(page.getByRole('button', { name: 'Save settings', exact: true })).toBeInViewport();
  await page.screenshot({ path: '.ui-audit/permissions-rule-mobile.png', animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('a delayed access result cannot steal focus from a newer settings search', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/workspaces/permissions?*', async route => { const response = await route.fetch(); await held; await route.fulfill({ response }); });
  try {
    await page.goto(`/#session/${sessionId}`); await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const search = page.getByRole('searchbox', { name: 'Search settings' });
    await search.fill('project hooks'); await search.press('Enter');
    await expect(page.getByText('Loading project access…')).toBeVisible();
    await search.fill('appearance'); await search.press('Enter');
    const appearance = page.getByRole('combobox', { name: 'Appearance', exact: true });
    await expect(appearance).toBeFocused(); release();
    await appearance.selectOption('light'); await expect(appearance).toBeFocused();
    await search.fill('theme'); await expect(search).toHaveValue('theme');
    await expect(page.getByRole('button', { name: /^Appearance Use/ })).toBeVisible();
  } finally { release(); }
});
test('saving other settings cannot re-enable a disabled hook or revoked project trust', async ({ page, request }) => {
  const baseline = await (await request.get('/api/settings')).json();
  await writeFile(join(workspace, '.litespeed/hooks.json'), JSON.stringify({ version: 1, hooks: [{ event: 'Stop', command: 'echo project fixture' }] }));
  const review = await (await request.get(`/api/workspaces/permissions?workspace=${encodeURIComponent(workspace)}`)).json();
  expect((await request.post('/api/workspaces/trust', { data: { workspace, sourceHash: review.hooks.sourceHash } })).ok()).toBe(true);
  expect((await request.patch('/api/settings', { data: { hooks: [{ event: 'Stop', command: 'echo app fixture' }] } })).ok()).toBe(true);
  try {
    await open(page);
    await page.getByRole('button', { name: 'Disable project hooks', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Trust project hooks', exact: true })).toBeVisible();
    await page.locator('.permission-app-commands > summary').click();
    await page.getByRole('button', { name: 'Disable app hook', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Enable reviewed app hook', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const saved = await (await request.get(`/api/workspaces/permissions?workspace=${encodeURIComponent(workspace)}`)).json();
    expect(saved.hooks.trusted).toBe(false); expect(saved.appHooks).toMatchObject([{ enabled: false, command: 'echo app fixture' }]);
  } finally { expect((await request.patch('/api/settings', { data: { hooks: baseline.hooks ?? [] } })).ok()).toBe(true); }
});
