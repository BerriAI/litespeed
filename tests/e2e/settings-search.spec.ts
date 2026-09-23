import { test, expect, type Page } from './fixtures';
import { mkdir } from 'node:fs/promises';

async function openSettings(page: Page) {
  await page.goto('/');
  if ((page.viewportSize()?.width ?? 1440) < 750) await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search settings' })).toBeFocused();
}
async function search(page: Page, query: string) {
  const input = page.getByRole('searchbox', { name: 'Search settings' });
  await input.fill(query); return input;
}

test('settings search finds aliases, opens controls and retains unsaved changes', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const before = await (await request.get('/api/settings')).json();
  await openSettings(page);
  await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Providers', exact: true }).click();
  await page.getByLabel('Provider name', { exact: true }).fill('My unsaved provider');
  const key = page.locator('[data-setting="provider-credentials"] input');
  await key.fill('unsaved-fixture-key');
  await search(page, 'unsaved-fixture-key'); await expect(page.locator('[data-setting-result]')).toHaveCount(0);
  const input = await search(page, 'theme');
  await expect(page.getByRole('button', { name: /^Appearance Use/ })).toBeVisible();
  await input.press('Enter');
  const appearance = page.getByRole('combobox', { name: 'Appearance', exact: true });
  await expect(appearance).toBeFocused(); await appearance.selectOption('light');
  await page.keyboard.press('ControlOrMeta+f'); await expect(input).toBeFocused();
  await input.fill('downloads');
  await mkdir('.ui-audit', { recursive: true });
  await page.screenshot({ path: '.ui-audit/settings-search-desktop.png', animations: 'disabled' });
  await input.press('ArrowDown');
  await expect(page.getByRole('button', { name: /^Automatic downloads/ })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('button', { name: /^Download folder/ })).toBeFocused();
  await page.keyboard.press('Enter');
  const folder = page.getByRole('textbox', { name: 'Browser download folder' });
  await expect(folder).toBeFocused(); await folder.fill('/tmp/my-unsaved-downloads');
  await search(page, 'provider connection'); await input.press('Enter');
  await expect(page.getByLabel('Provider name', { exact: true })).toHaveValue('My unsaved provider');
  await expect(key).toHaveValue('unsaved-fixture-key');
  await search(page, 'theme'); await input.press('Enter'); await expect(appearance).toHaveValue('light');
  await search(page, 'download folder'); await input.press('Enter'); await expect(folder).toHaveValue('/tmp/my-unsaved-downloads');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const after = await (await request.get('/api/settings')).json();
  expect(after.providers).toEqual(before.providers); expect(after.theme).toBe(before.theme); expect(after.browser).toEqual(before.browser);
});

test('provider-specific results select a compatible provider and preserve the other provider draft', async ({ page }) => {
  await openSettings(page);
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Providers', exact: true }).click();
  await page.getByRole('button', { name: 'Add provider', exact: true }).click();
  await page.getByLabel('Provider name', { exact: true }).fill('Private gateway draft');
  await page.getByRole('combobox', { name: 'API format', exact: true }).selectOption('anthropic');
  const input = await search(page, 'caching aliases'); await input.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Claude model aliases', exact: true })).toBeFocused();
  await expect(page.getByRole('combobox', { name: 'API format', exact: true })).toHaveValue('openai');
  await page.getByRole('button', { name: 'Private gateway draft', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'API format', exact: true })).toHaveValue('anthropic');
  await expect(page.getByLabel('Provider name', { exact: true })).toHaveValue('Private gateway draft');
});

test('keyboard clearing, empty results and expanded settings keep focus predictable', async ({ page }) => {
  await openSettings(page);
  const input = await search(page, 'context'); await input.press('Enter');
  const details = page.getByLabel('Context window overrides', { exact: true });
  await expect(details).toHaveAttribute('open', '');
  await expect(page.getByRole('button', { name: 'Add context limit' })).toBeFocused();
  await page.getByRole('button', { name: 'Add context limit' }).click();
  await page.getByRole('textbox', { name: 'Model ID 1', exact: true }).fill('unsaved-model');
  await search(page, 'nothing-matches-this-setting');
  await expect(page.getByText('Try a setting such as appearance, downloads or API keys.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(input).toBeFocused(); await expect(details).toHaveAttribute('open', '');
  await expect(page.getByRole('textbox', { name: 'Model ID 1', exact: true })).toHaveValue('unsaved-model');
  await input.fill('browser'); await input.press('ArrowDown'); await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
  await expect(input).toHaveValue(''); await expect(input).toBeFocused();
  await input.fill('cookie'); await input.press('Enter');
  await expect(page.getByRole('button', { name: 'Reset browser', exact: true })).toBeFocused();
  await expect(page.getByRole('region', { name: 'Reset browser profile' })).toHaveCount(0);
  await search(page, 'tool permission'); await input.press('Enter');
  await expect(page.getByRole('button', { name: 'Add rule', exact: true })).toBeFocused();
  await search(page, 'connected tools'); await input.press('Enter');
  await expect(page.getByRole('textbox', { name: 'MCP servers', exact: true })).toBeFocused();
  await search(page, 'cost'); await expect(page.getByRole('button', { name: /^Token usage/ })).toBeVisible();
  await page.getByRole('button', { name: /^Token usage/ }).click(); await expect(page.getByRole('combobox', { name: 'Window', exact: true })).toBeFocused();
});

test('search fits a short narrow window and returning to categories keeps controls reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 }); await page.emulateMedia({ colorScheme: 'light' });
  await openSettings(page); const input = await search(page, 'browser');
  await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Browser', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Save settings', exact: true })).toBeInViewport();
  await page.screenshot({ path: '.ui-audit/settings-search-mobile.png', animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await input.fill('a'.repeat(120));
  await expect(page.getByRole('button', { name: 'Clear search', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear settings search', exact: true }).click();
  await search(page, 'download folder'); await input.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Browser download folder' })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Browser download folder' })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Save settings', exact: true })).toBeInViewport();
  await page.screenshot({ path: '.ui-audit/settings-search-mobile-target.png', animations: 'disabled' });
});
