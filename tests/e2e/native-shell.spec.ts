import { test, expect } from './fixtures';
import { mkdir } from 'node:fs/promises';

test('native menu events and folder selection use the existing project flow', async ({ page, request }) => {
  const settings = await (await request.get('/api/settings')).json();
  await page.addInitScript(({ workspace }) => {
    Object.defineProperty(window, 'litespeedDesktop', { value: { platform: 'darwin', chooseFolder: async () => workspace } });
    document.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.desktop = 'macos'; });
  }, { workspace: settings.workspace });
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'What should we work on?' })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('litespeed:desktop-command', { detail: 'settings' })));
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true }); await expect(dialog).toBeVisible(); await expect(dialog.getByRole('button', { name: 'General', exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'General', exact: true })).toBeVisible();
  const rows = dialog.locator('.general-setting-row');
  await expect(rows).toHaveCount(6);
  expect(await rows.evaluateAll(rows => rows.every(row => {
    const bounds = row.getBoundingClientRect(), label = row.firstElementChild!.getBoundingClientRect(), control = row.lastElementChild!.getBoundingClientRect();
    return label.width >= 200 && control.width >= 30 && control.right <= bounds.right + 1 && label.right + 12 <= control.left;
  }))).toBe(true);
  expect(await dialog.locator('.general-setting-wide > input, .general-setting-wide > select').evaluateAll(fields => {
    const heights = fields.map(field => field.getBoundingClientRect().height); return Math.max(...heights) - Math.min(...heights);
  })).toBeLessThanOrEqual(1);
  await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/native-engine-general.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Providers', exact: true }).click();
  const alignedFields = dialog.getByRole('textbox', { name: 'Provider name', exact: true }).or(dialog.getByRole('combobox', { name: 'API format', exact: true }));
  await expect(alignedFields).toHaveCount(2);
  // Measure both controls in one frame, including while Settings animates in.
  await expect.poll(() => alignedFields.evaluateAll(([name, format]) => { const a = name.getBoundingClientRect(), b = format.getBoundingClientRect(); return Math.max(Math.abs(a.height - b.height), Math.abs(a.y - b.y)); })).toBeLessThanOrEqual(1);
  await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/native-engine-settings.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Back to app' }).click(); await page.keyboard.press('Meta+,'); await expect(dialog.getByRole('heading', { name: 'General', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Back to app' }).click();
  await page.locator('.model-trigger').click(); await page.getByRole('button', { name: 'Manage providers', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Providers', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Back to app' }).click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('litespeed:desktop-command', { detail: 'search' })));
  const search = page.getByRole('dialog', { name: 'Search tasks', exact: true }); await expect(search).toBeVisible(); await expect(search.getByRole('combobox', { name: 'Search task names or messages', exact: true })).toBeFocused(); await page.keyboard.press('Escape'); await expect(search).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('litespeed:desktop-command', { detail: 'commands' })));
  const palette = page.getByRole('dialog', { name: 'Find your next step', exact: true }); await expect(palette).toBeVisible(); await page.keyboard.press('Escape'); await expect(palette).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('litespeed:desktop-command', { detail: 'open-project' })));
  await page.getByRole('button', { name: 'Open a folder', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Choose a project' })).toHaveCount(0); await expect(page.getByRole('heading', { name: 'What should we work on?' })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('litespeed:desktop-command', { detail: 'workspace' }))); await expect(page.getByRole('complementary', { name: 'Workspace', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  await page.setViewportSize({ width: 390, height: 600 }); await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('litespeed:desktop-command', { detail: 'settings' })));
  await expect(dialog.getByRole('heading', { name: 'General', exact: true })).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Appearance', exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Save settings', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.ui-audit/native-engine-general-mobile.png', animations: 'disabled' });
  const folder = dialog.getByRole('textbox', { name: 'Workspace path', exact: true });
  await folder.scrollIntoViewIfNeeded(); await expect(folder).toBeInViewport();
  expect(await folder.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(280);
});
