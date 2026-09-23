import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { randomUUID } from 'node:crypto';
import { BrowserInspector, browserInspectorSchema } from '../server/browser-inspector.js';
import type { BrowserInspectorResult, BrowserStyleChanges } from '../shared/browser-inspector.js';

const html = `<style>body { margin: 30px; } h1 { font: 32px Arial; } </style><h1 id="heading" style="padding-left: 9px !important; padding-top: 3px; margin: 12px 7px; border-top-left-radius: 8px; transition: color 200ms ease; animation-duration: 2s;">Project overview</h1><button id="nested"><span>Continue</span></button><div id="shadow"></div>`;
describe('real browser element previews', () => {
  let browser: Browser, page: Page, inspector: BrowserInspector, tabId: string;
  beforeAll(async () => { browser = await chromium.launch({ channel: 'chrome' }); });
  beforeEach(async () => { page = await browser.newPage({ viewport: { width: 800, height: 600 } }); await page.setContent(html); inspector = new BrowserInspector(); tabId = randomUUID(); });
  afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); await inspector.close(); await page.close(); });
  afterAll(async () => { await browser.close(); });
  async function select(selector = '#heading') {
    const box = (await page.locator(selector).boundingBox())!;
    return (await inspector.execute('task', page, { action: 'select', tabId, url: page.url(), width: 800, height: 600, x: box.x + box.width / 2, y: box.y + box.height / 2 }))! as BrowserInspectorResult & { element: NonNullable<BrowserInspectorResult['element']> };
  }
  async function preview(elementId: string, changes: BrowserStyleChanges, signal?: AbortSignal) { return inspector.execute('task', page, { action: 'preview', tabId, elementId, changes }, signal); }
  it('selects exact elements and previews text and styles while restoring the original attribute byte for byte', async () => {
    const selected = await select(); expect(selected.element).toMatchObject({ selector: '#heading', text: 'Project overview', editableText: true }); expect(selected.image).toMatch(/^data:image\/jpeg;base64,/);
    const original = await page.locator('#heading').getAttribute('style'), screenshot = page.screenshot.bind(page); let seen: unknown;
    vi.spyOn(page, 'screenshot').mockImplementation(async options => { seen = await page.locator('#heading').evaluate(node => ({ text: node.textContent, padding: getComputedStyle(node).padding, color: getComputedStyle(node).color })); return screenshot(options); });
    const result = await preview(selected.element.id, { text: 'A clearer heading', color: '#ff1122', padding: 24, margin: 16, borderRadius: 12, fontSize: 40 });
    expect(result?.image).not.toBe(selected.image); expect(seen).toEqual({ text: 'A clearer heading', padding: '24px', color: 'rgb(255, 17, 34)' });
    expect(await page.locator('#heading').getAttribute('style')).toBe(original); expect(await page.locator('#heading').textContent()).toBe('Project overview');
  });
  it('restores individual longhands and priorities while preserving newer website changes', async () => {
    const selected = await select(), screenshot = page.screenshot.bind(page);
    vi.spyOn(page, 'screenshot').mockImplementation(async options => { await page.locator('#heading').evaluate(node => { node.style.paddingRight = '31px'; node.style.outline = '2px solid red'; node.style.color = 'blue'; node.textContent = 'Website update'; }); return screenshot(options); });
    await preview(selected.element.id, { padding: 24, margin: 16, color: '#ff1122', text: 'Preview text' });
    expect(await page.locator('#heading').evaluate(node => ({ left: node.style.paddingLeft, priority: node.style.getPropertyPriority('padding-left'), top: node.style.paddingTop, right: node.style.paddingRight, bottom: node.style.paddingBottom, margin: node.style.margin, transition: node.style.transition, duration: node.style.animationDuration, outline: node.style.outline, color: node.style.color, text: node.textContent }))).toEqual({ left: '9px', priority: 'important', top: '3px', right: '31px', bottom: '', margin: '12px 7px', transition: 'color 200ms', duration: '2s', outline: 'red solid 2px', color: 'blue', text: 'Website update' });
  });
  it('restores on screenshot failure and cancellation without leaving a style attribute on originally unstyled elements', async () => {
    await page.locator('#heading').evaluate(node => node.removeAttribute('style')); const selected = await select();
    vi.spyOn(page, 'screenshot').mockRejectedValueOnce(new Error('Capture unavailable'));
    await expect(preview(selected.element.id, { text: 'Temporary', padding: 20 })).rejects.toThrow('Capture unavailable');
    expect(await page.locator('#heading').getAttribute('style')).toBeNull(); expect(await page.locator('#heading').textContent()).toBe('Project overview');
    const abort = new AbortController(), screenshot = page.screenshot.bind(page);
    vi.spyOn(page, 'screenshot').mockImplementationOnce(async options => { abort.abort(new Error('Stopped')); return screenshot(options); });
    await expect(preview(selected.element.id, { fontSize: 50 }, abort.signal)).rejects.toThrow('Stopped'); expect(await page.locator('#heading').getAttribute('style')).toBeNull();
  });
  it('rejects stale documents, resized viewports, detached elements and foreign selections', async () => {
    const selected = await select();
    await expect(inspector.execute('other', page, { action: 'preview', tabId, elementId: selected.element.id, changes: { fontSize: 20 } })).rejects.toThrow('expired');
    await expect(inspector.execute('task', page, { action: 'release', tabId: randomUUID(), elementId: selected.element.id })).rejects.toThrow('another browser tab');
    await page.setViewportSize({ width: 900, height: 600 }); await expect(preview(selected.element.id, {})).rejects.toThrow('resized');
    await page.setViewportSize({ width: 800, height: 600 }); await page.locator('#heading').evaluate(node => node.remove()); await expect(preview(selected.element.id, {})).rejects.toThrow('no longer visible');
    await page.setContent(html); const newer = await select(); await page.goto('about:blank#different'); await expect(preview(newer.element.id, {})).rejects.toThrow('page changed');
  });
  it('releases earlier selections and disposes a selection whose first screenshot fails', async () => {
    const first = await select(), second = await select(); await expect(preview(first.element.id, {})).rejects.toThrow('expired');
    await inspector.execute('task', page, { action: 'release', tabId, elementId: second.element.id }); await expect(preview(second.element.id, {})).rejects.toThrow('expired');
    vi.spyOn(page, 'screenshot').mockRejectedValueOnce(new Error('No capture')); await expect(select()).rejects.toThrow('No capture'); expect((inspector as unknown as { entries: Map<string, unknown> }).entries.size).toBe(0);
  });
  it('handles open shadow roots and refuses text replacement on nested controls', async () => {
    await page.locator('#shadow').evaluate(node => { node.attachShadow({ mode: 'open' }).innerHTML = '<span id="inside">Shadow heading</span>'; });
    const shadow = await select('#inside'); expect(shadow.element).toMatchObject({ selector: '#inside', text: 'Shadow heading' });
    const box = (await page.locator('#nested').boundingBox())!;
    const nested = (await inspector.execute('task', page, { action: 'select', tabId, url: page.url(), width: 800, height: 600, x: box.x + 1, y: box.y + 1 }))!;
    expect(nested.element!.editableText).toBe(false); await expect(preview(nested.element!.id, { text: 'Replace controls' })).rejects.toThrow('contains other controls');
  });
  it('restores detached nodes after capture fails and does not rewrite a replacement text node', async () => {
    const selected = await select(), screenshot = page.screenshot.bind(page); const node = await page.locator('#heading').elementHandle(), original = await node!.getAttribute('style');
    vi.spyOn(page, 'screenshot').mockImplementationOnce(async options => { await page.locator('#heading').evaluate(node => node.remove()); return screenshot(options); });
    await expect(preview(selected.element.id, { padding: 24 })).rejects.toThrow('no longer visible'); expect(await node!.getAttribute('style')).toBe(original); await node!.dispose();
    await page.setContent(html); const next = await select();
    vi.spyOn(page, 'screenshot').mockImplementationOnce(async options => { await page.locator('#heading').evaluate(node => node.replaceChildren(document.createTextNode('Preview'))); return screenshot(options); });
    await preview(next.element.id, { text: 'Preview' }); expect(await page.locator('#heading').textContent()).toBe('Preview');
  });
  it('bounds input and permits only the fixed style controls', () => {
    const input = { action: 'preview', tabId, elementId: randomUUID(), changes: {} };
    for (const changes of [{ backgroundColor: 'url(https://example.com)' }, { fontSize: 500 }, { text: 'a'.repeat(2001) }, { position: 'fixed' }, { color: 'var(--anything)' }]) expect(() => browserInspectorSchema.parse({ ...input, changes })).toThrow();
    expect(browserInspectorSchema.parse({ ...input, changes: { fontFamily: 'Georgia', fontWeight: 600, color: '#abcdef' } })).toBeTruthy();
  });
});
