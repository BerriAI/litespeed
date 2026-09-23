import { test, expect, type Page } from './fixtures';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let workspace: string, session: { id: string };
function pdf(count = 6, edition = 'Original') {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${Array.from({ length: count }, (_, i) => `${i * 2 + 4} 0 R`).join(' ')}] /Count ${count} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (let i = 0; i < count; i++) {
    const landscape = i === 2, width = landscape ? 640 : 480, height = landscape ? 400 : 640;
    const stream = `BT /F1 22 Tf 36 ${height - 52} Td (Litespeed handbook ${i + 1}) Tj /F1 12 Tf 0 -32 Td (${edition} edition - quiet <angle> text) Tj ${Array.from({ length: 10 }, (_, line) => `0 -24 Td (Page ${i + 1}, line ${line + 1}: Make room for careful reading.) Tj`).join(' ')} ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${i * 2 + 5} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let value = '%PDF-1.4\n'; const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(value.length); value += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = value.length; value += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return value;
}
test.beforeEach(async ({ request }) => {
  workspace = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-pdf-')));
  await writeFile(join(workspace, 'handbook.pdf'), pdf()); await writeFile(join(workspace, 'other.pdf'), pdf(3, 'Companion')); await writeFile(join(workspace, 'notes.md'), '# Reading notes\n\nA place to keep a thought.');
  session = await (await request.post('/api/sessions', { data: { workspace, title: 'Read the handbook', providerId: 'fixture', model: 'test-model', architecture: null } })).json();
});
test.afterEach(async ({ request }) => { await request.delete(`/api/sessions/${session.id}`); await rm(workspace, { recursive: true, force: true }); });
async function file(page: Page, name: string) {
  const browse = page.getByRole('button', { name: 'Browse files', exact: true }); if (await browse.isVisible()) await browse.click();
  await page.locator('.file-list').getByRole('button', { name, exact: true }).click();
}
async function open(page: Page) {
  await page.goto(`/#session/${session.id}`); await page.getByRole('button', { name: 'Show workspace panel', exact: true }).click(); await file(page, 'handbook.pdf');
  await expect(page.getByRole('textbox', { name: 'PDF page', exact: true })).toBeEnabled(); await expect(page.locator('[data-pdf-page="1"] .pdf-text-layer')).toContainText('Litespeed handbook 1');
}
async function go(page: Page, number: number) { const input = page.getByRole('textbox', { name: 'PDF page', exact: true }); await input.fill(String(number)); await input.press('Enter'); await expect(input).toHaveValue(String(number)); }
const settled = (page: Page) => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

test('PDF page navigation, zoom and reading positions survive file switches and reloads', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await open(page); const input = page.getByRole('textbox', { name: 'PDF page', exact: true });
  await expect(page.getByRole('button', { name: 'Previous PDF page', exact: true })).toBeDisabled(); await go(page, 4);
  await page.getByRole('button', { name: 'Next PDF page', exact: true }).click(); await expect(input).toHaveValue('5');
  await page.getByRole('button', { name: 'Previous PDF page', exact: true }).click(); await expect(input).toHaveValue('4');
  await input.fill('2'); await input.press('Escape'); await expect(input).toHaveValue('4');
  await input.fill('not a page'); await input.press('Enter'); await expect(input).toHaveValue('4');
  await input.fill('0'); await input.press('Enter'); await expect(input).toHaveValue('1');
  await input.fill('999999'); await input.press('Enter'); await expect(input).toHaveValue('6'); await expect(page.getByRole('button', { name: 'Next PDF page', exact: true })).toBeDisabled(); await go(page, 4);
  await page.getByRole('button', { name: 'Zoom in PDF', exact: true }).click(); await page.getByRole('button', { name: 'Zoom in PDF', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fit PDF to width', exact: true })).toHaveText('150%');
  await expect(page.locator('[data-pdf-page="4"] .pdf-text-layer')).toContainText('Litespeed handbook 4'); await settled(page);
  const preview = page.getByLabel('PDF document', { exact: true });
  await preview.evaluate(element => { const target = element.querySelector<HTMLElement>('[data-pdf-page="4"]')!; element.scrollTop = target.offsetTop + target.clientHeight * .3; element.scrollLeft = 90; });
  const position = await preview.evaluate(element => ({ top: element.scrollTop, left: element.scrollLeft }));
  await file(page, 'other.pdf'); await expect(page.getByRole('button', { name: 'Next PDF page', exact: true })).toBeEnabled(); await go(page, 2);
  await page.getByRole('tab', { name: 'handbook.pdf', exact: true }).click(); await expect(input).toHaveValue('4');
  await expect.poll(async () => Math.abs(await preview.evaluate(element => element.scrollTop) - position.top)).toBeLessThan(2); await expect.poll(() => preview.evaluate(element => element.scrollLeft)).toBe(position.left);
  await page.reload(); await expect(input).toHaveValue('4'); await expect(page.getByRole('button', { name: 'Fit PDF to width', exact: true })).toHaveText('150%');
  await expect.poll(async () => Math.abs(await preview.evaluate(element => element.scrollTop) - position.top)).toBeLessThan(2);
  const fraction = () => preview.evaluate(element => { const target = element.querySelector<HTMLElement>('[data-pdf-page="4"]')!; return (element.scrollTop - target.offsetTop) / target.clientHeight; });
  const readingOffset = await fraction(); await page.setViewportSize({ width: 900, height: 700 });
  await expect.poll(async () => Math.abs(await fraction() - readingOffset)).toBeLessThan(.02); await expect(input).toHaveValue('4');
  await page.setViewportSize({ width: 1440, height: 1000 }); await expect.poll(async () => Math.abs(await preview.evaluate(element => element.scrollTop) - position.top)).toBeLessThan(2);
  await page.getByRole('tab', { name: 'other.pdf', exact: true }).click(); await expect(input).toHaveValue('2'); await expect(page.locator('[data-pdf-page="2"] .pdf-text-layer')).toContainText('Companion edition');
  await page.getByRole('tab', { name: 'handbook.pdf', exact: true }).click(); await expect(input).toHaveValue('4'); await expect(page.locator('[data-pdf-page="4"] .pdf-text-layer')).toContainText('Original edition');
  await expect.poll(async () => Math.abs(await preview.evaluate(element => element.scrollTop) - position.top)).toBeLessThan(2);
  await page.screenshot({ path: '.ui-audit/pdf-reading-desktop.png', animations: 'disabled' });
});

test('PDF text can be selected and fit-to-width stays aligned in a narrow window', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await open(page);
  const title = page.locator('[data-pdf-page="1"] .pdf-text-layer span').filter({ hasText: 'Litespeed handbook 1' }); await title.dblclick();
  expect(await page.evaluate(() => getSelection()?.toString())).toMatch(/Litespeed|handbook|1/);
  await expect(page.locator('[data-pdf-page="1"] .pdf-text-layer')).toContainText('quiet <angle> text'); await expect(page.locator('.pdf-text-layer angle')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 500 }); await page.emulateMedia({ colorScheme: 'light' }); await go(page, 3);
  await expect(page.locator('[data-pdf-page="3"] .pdf-text-layer')).toContainText('Litespeed handbook 3');
  await page.getByRole('button', { name: 'Zoom in PDF', exact: true }).click(); await page.getByRole('button', { name: 'Fit PDF to width', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fit PDF to width', exact: true })).toHaveText('Fit'); await settled(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.getByLabel('PDF document', { exact: true }).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const alignment = await page.locator('[data-pdf-page="3"]').evaluate(element => { const canvas = element.querySelector('canvas')!.getBoundingClientRect(), text = [...element.querySelectorAll('.pdf-text-layer span')].find(span => span.textContent === 'Litespeed handbook 3')!.getBoundingClientRect(); return { left: (text.left - canvas.left) / canvas.width, top: (text.top - canvas.top) / canvas.height }; });
  expect(alignment.left).toBeCloseTo(36 / 640, 2); expect(alignment.top).toBeGreaterThan(.07); expect(alignment.top).toBeLessThan(.14);
  await page.screenshot({ path: '.ui-audit/pdf-reading-mobile.png', animations: 'disabled' }); expect(errors).toEqual([]);
});

test('PDF refresh retains an unchanged render and restores a changed document at the reading position', async ({ page }) => {
  await open(page); await go(page, 4); const preview = page.getByLabel('PDF document', { exact: true }); await settled(page);
  await preview.evaluate(element => { const target = element.querySelector<HTMLElement>('[data-pdf-page="4"]')!; element.scrollTop = target.offsetTop + target.clientHeight * .25; });
  const position = await preview.evaluate(element => element.scrollTop), canvas = await page.locator('[data-pdf-page="4"] canvas').elementHandle();
  const draft = page.getByRole('textbox', { name: 'Message Litespeed' }); await draft.fill('Keep my reading notes.');
  const response = page.waitForResponse(response => response.url().includes('/api/file-preview?') && new URL(response.url()).searchParams.get('path') === 'handbook.pdf');
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await response; await settled(page);
  expect(await canvas!.evaluate(element => element.isConnected)).toBe(true);
  await writeFile(join(workspace, 'handbook.pdf'), pdf(6, 'Revised')); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('[data-pdf-page="4"] .pdf-text-layer')).toContainText('Revised edition');
  await expect.poll(async () => Math.abs(await preview.evaluate(element => element.scrollTop) - position)).toBeLessThan(2); await expect(draft).toHaveValue('Keep my reading notes.'); await expect(draft).toBeFocused();
  await writeFile(join(workspace, 'handbook.pdf'), pdf(2, 'Shorter')); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.pdf-page')).toHaveCount(2); await expect(page.locator('[data-pdf-page="2"] .pdf-text-layer')).toContainText('Shorter edition');
  await expect(page.getByRole('textbox', { name: 'PDF page', exact: true })).toHaveValue('2'); await expect(page.getByRole('button', { name: 'Next PDF page', exact: true })).toBeDisabled();
});

test('a malformed PDF shows an error and recovers after the file is replaced', async ({ page }) => {
  await writeFile(join(workspace, 'handbook.pdf'), '%PDF-1.7\nThis is not a valid document.');
  await page.goto(`/#session/${session.id}`); await page.getByRole('button', { name: 'Show workspace panel', exact: true }).click(); await file(page, 'handbook.pdf');
  await expect(page.getByRole('alert')).toContainText('Invalid PDF'); await expect(page.getByRole('button', { name: 'Next PDF page', exact: true })).toBeDisabled();
  await writeFile(join(workspace, 'handbook.pdf'), pdf()); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('[data-pdf-page="1"] .pdf-text-layer')).toContainText('Litespeed handbook 1'); await expect(page.getByRole('alert')).toHaveCount(0);
});
