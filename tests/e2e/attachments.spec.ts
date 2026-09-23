import { test, expect, type Page } from './fixtures';
import { mkdir, readFile, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let session: { id: string };
test.beforeEach(async ({ page, request }) => {
  session = await (await request.post('/api/sessions', { data: { title: 'A quieter workspace', providerId: 'fixture', model: 'test-model', architecture: null } })).json();
  await page.goto(`/#session/${session.id}`);
});
test.afterEach(async ({ request }) => { await request.delete(`/api/sessions/${session.id}`); });
async function artwork(page: Page) {
  return Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 1000;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ecece6'; context.fillRect(0, 0, 1600, 1000);
    context.fillStyle = '#8b9786'; context.beginPath(); context.arc(1340, 110, 560, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#273e35'; context.fillRect(90, 90, 42, 6); context.font = '24px system-ui'; context.fillText('DESIGN EXPLORATION / 01', 90, 155);
    context.font = '80px system-ui'; context.fillText('A quieter', 90, 410); context.fillText('workspace.', 90, 510);
    context.fillStyle = '#74816f'; context.font = '28px system-ui'; context.fillText('Make room for your next idea.', 90, 590);
    context.fillStyle = '#273e35'; context.beginPath(); context.roundRect(90, 720, 255, 72, 18); context.fill(); context.fillStyle = '#fff'; context.font = '24px system-ui'; context.fillText('Start something', 125, 766);
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
}
test('draft previews show thumbnails, preserve the draft, zoom, and save the original image', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' }); const buffer = await artwork(page);
  await page.getByRole('textbox', { name: 'Message Litespeed' }).fill('Use this direction for the new project.');
  await page.locator('input[type=file][aria-label="Attach files"]').setInputFiles([{ name: 'workspace-direction.png', mimeType: 'image/png', buffer }, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Spacing: 24px\n<script>window.attachmentEscaped=true</script>') }]);
  await expect(page.locator('.attachments .attachment-thumbnail img')).toBeVisible();
  await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/attachment-draft-desktop.png', animations: 'disabled' });
  const trigger = page.getByRole('button', { name: 'Preview workspace-direction.png' }); await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'workspace-direction.png' }); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'workspace-direction.png' })).toBeVisible();
  await expect(dialog.locator('.attachment-dimensions')).toHaveText('1,600 × 1,000');
  await page.screenshot({ path: '.ui-audit/attachment-viewer-desktop.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Actual image size', exact: true }).click();
  await expect(page.locator('.attachment-image-scroll img')).toHaveCSS('width', '1600px');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click(); await expect(page.locator('.attachment-image-scroll img')).toHaveCSS('width', '3200px');
  await page.getByRole('button', { name: 'Fit image', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const downloaded = page.waitForEvent('download'); await page.getByRole('link', { name: 'Save copy' }).click(); const download = await downloaded;
  expect(download.suggestedFilename()).toBe('workspace-direction.png'); expect(await readFile((await download.path())!)).toEqual(buffer);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('dialog', { name: 'notes.txt' })).toBeVisible(); await expect(page.getByLabel('Contents of notes.txt')).toContainText('<script>window.attachmentEscaped=true</script>');
  expect(await page.evaluate(() => (window as unknown as { attachmentEscaped?: boolean }).attachmentEscaped)).toBeUndefined();
  await page.keyboard.press('ArrowLeft'); await expect(page.getByRole('dialog', { name: 'workspace-direction.png' })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Message Litespeed' })).toHaveValue('Use this direction for the new project.');
  await expect(page.locator('.attachments .attachment-chip')).toHaveCount(2);
});
test('sent attachments reopen inside the task and image previews fit a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const buffer = await artwork(page);
  await page.locator('input[type=file][aria-label="Attach files"]').setInputFiles({ name: 'a-long-name-for-the-new-workspace-design-direction.png', mimeType: 'image/png', buffer });
  await page.getByRole('textbox', { name: 'Message Litespeed' }).fill('Describe this direction.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click(); await expect(page.getByRole('article', { name: 'Assistant message' }).last()).toBeVisible();
  const trigger = page.getByRole('button', { name: 'Preview a-long-name-for-the-new-workspace-design-direction.png' }); await trigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.attachment-image-scroll img')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: '.ui-audit/attachment-viewer-mobile.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).focus(); await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('link', { name: 'Save copy' })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await expect(page.locator('.message-attachments img')).toBeVisible();
});
test('a damaged image has a readable fallback and can be removed without affecting another attachment', async ({ page }) => {
  await page.locator('input[type=file][aria-label="Attach files"]').setInputFiles([{ name: 'damaged.png', mimeType: 'image/png', buffer: Buffer.from('damaged') }, { name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.from('') }]);
  await page.getByRole('button', { name: 'Preview damaged.png' }).click(); await expect(page.getByText('This image could not be displayed.')).toBeVisible();
  await page.getByRole('button', { name: 'Next attachment' }).click(); await expect(page.getByLabel('Contents of empty.txt')).toHaveText('This file is empty.');
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Remove damaged.png' }).click();
  await expect(page.locator('.attachments .attachment-chip')).toHaveCount(1); await expect(page.getByRole('button', { name: 'Preview empty.txt' })).toBeVisible();
});
test('workspace attachments open in file tabs and sent snapshots preserve the attached version', async ({ page, request }) => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-attachment-ui-')));
  try {
    await mkdir(join(workspace, 'docs')); const file = 'docs/a%20note#1.md'; await writeFile(join(workspace, file), '# Attached version\nOriginal design notes.\n');
    await request.delete(`/api/sessions/${session.id}`); session = await (await request.post('/api/sessions', { data: { workspace, title: 'Review attached notes', providerId: 'fixture', model: 'test-model', architecture: null } })).json();
    await page.goto(`/#session/${session.id}`); await page.getByRole('textbox', { name: 'Message Litespeed' }).fill('Review these notes.'); await page.getByRole('button', { name: 'Add workspace file context' }).click(); await page.getByLabel('Search workspace files').fill('note'); await page.getByRole('button', { name: file, exact: true }).click();
    await page.getByRole('button', { name: 'Open a%20note#1.md', exact: true }).click(); await expect(page.getByRole('tab', { name: 'a%20note#1.md', exact: true })).toBeVisible(); await expect(page.locator('.document-markdown')).toContainText('Original design notes.'); await expect(page.getByRole('textbox', { name: 'Message Litespeed' })).toHaveValue('Review these notes.');
    expect((await (await request.get(`/api/sessions/${session.id}`)).json()).messages).toHaveLength(0);
    await page.getByRole('button', { name: 'Send message', exact: true }).click(); await expect(page.getByRole('article', { name: 'Assistant message' }).last()).toBeVisible();
    await writeFile(join(workspace, file), '# Current version\nA later edit on disk.\n'); const trigger = page.getByRole('button', { name: 'Preview a%20note#1.md', exact: true }); await expect(trigger).toContainText('Attached snapshot'); await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'a%20note#1.md', exact: true }); await expect(dialog.getByLabel('Contents of a%20note#1.md')).toContainText('Original design notes.'); await expect(dialog).toContainText('content attached to the message');
    await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/attachment-snapshot-desktop.png', animations: 'disabled' });
    const pending = page.waitForEvent('download'); await dialog.getByRole('link', { name: 'Save copy' }).click(); expect(await readFile((await (await pending).path())!, 'utf8')).toContain('Original design notes.');
    await dialog.getByRole('button', { name: 'Open current file', exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(page.locator('.document-markdown')).toContainText('A later edit on disk.');
    await page.reload(); await trigger.click(); await expect(dialog.getByLabel('Contents of a%20note#1.md')).toContainText('Original design notes.'); await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  } finally { await rm(workspace, { recursive: true, force: true }); }
});
test('a deleted workspace file keeps its readable snapshot and compact mobile actions', async ({ page, request }) => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-attachment-mobile-')));
  try {
    await writeFile(join(workspace, 'notes.txt'), 'Original attached notes.'); await request.delete(`/api/sessions/${session.id}`); session = await (await request.post('/api/sessions', { data: { workspace, title: 'Attached file recovery', providerId: 'fixture', model: 'test-model', architecture: null } })).json();
    await request.post(`/api/sessions/${session.id}/messages`, { data: { content: 'Read the notes.', attachments: [{ name: 'notes.txt', path: 'notes.txt' }] } });
    await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'light' }); await page.goto(`/#session/${session.id}`); await expect(page.getByRole('article', { name: 'Assistant message' }).last()).toBeVisible(); await rm(join(workspace, 'notes.txt'));
    await page.getByRole('button', { name: 'Preview notes.txt' }).click(); const dialog = page.getByRole('dialog', { name: 'notes.txt', exact: true }); await expect(dialog.getByLabel('Contents of notes.txt')).toContainText('Original attached notes.');
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true); const action = dialog.getByRole('button', { name: 'Open current file', exact: true }); const box = (await action.boundingBox())!; expect(box.y + box.height).toBeLessThan(844);
    await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/attachment-snapshot-mobile.png', animations: 'disabled' }); await action.click(); await expect(dialog).toHaveCount(0); await expect(page.getByRole('complementary', { name: 'Workspace', exact: true }).getByRole('alert')).toBeVisible();
    await page.getByRole('button', { name: 'Close workspace', exact: true }).click(); await page.getByRole('button', { name: 'Preview notes.txt' }).click(); await expect(dialog.getByLabel('Contents of notes.txt')).toContainText('Original attached notes.');
  } finally { await rm(workspace, { recursive: true, force: true }); }
});
test('workspace image references send captured image bytes and keep that image after disk edits', async ({ page, request }) => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-attachment-image-'))), buffer = await artwork(page);
  try {
    await writeFile(join(workspace, 'direction.png'), buffer); await request.delete(`/api/sessions/${session.id}`); session = await (await request.post('/api/sessions', { data: { workspace, title: 'Workspace image context', providerId: 'fixture', model: 'test-model', architecture: null } })).json();
    await page.goto(`/#session/${session.id}`); await page.getByRole('button', { name: 'Add workspace file context' }).click(); await page.getByLabel('Search workspace files').fill('direction'); await page.getByRole('button', { name: 'direction.png', exact: true }).click(); await page.getByRole('button', { name: 'Open direction.png', exact: true }).click(); await expect(page.locator('.image-preview img')).toBeVisible();
    await page.getByRole('textbox', { name: 'Message Litespeed' }).fill('Describe the attached direction.'); await page.getByRole('button', { name: 'Send message', exact: true }).click(); await expect(page.getByRole('article', { name: 'Assistant message' }).last()).toBeVisible();
    const detail = await (await request.get(`/api/sessions/${session.id}`)).json(); expect(detail.messages.find((message: { role: string }) => message.role === 'user').attachments[0]).toMatchObject({ path: 'direction.png', mimeType: 'image/png', dataUrl: `data:image/png;base64,${buffer.toString('base64')}` });
    await writeFile(join(workspace, 'direction.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV5kAAAAASUVORK5CYII=', 'base64'));
    await page.getByRole('button', { name: 'Preview direction.png', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'direction.png', exact: true }); await expect(dialog.locator('.attachment-dimensions')).toHaveText('1,600 × 1,000'); await dialog.getByRole('button', { name: 'Open current file', exact: true }).click();
    await expect(page.locator('.image-preview img')).toHaveJSProperty('naturalWidth', 1);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});
