import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { BrowserFind } from '../server/browser-find.js';
import { SessionBrowsers, browserActionSchema } from '../server/browser.js';

describe('rendered browser text search', () => {
  let browser: Browser, context: BrowserContext, page: Page, find: BrowserFind;
  beforeAll(async () => { browser = await chromium.launch({ channel: 'chrome', headless: true }); });
  afterAll(async () => { await browser.close(); });
  beforeEach(async () => { context = await browser.newContext({ viewport: { width: 600, height: 400 } }); page = await context.newPage(); find = new BrowserFind(); });
  afterEach(async () => { await find.close(); await context.close(); });
  const search = (text: string, matchCase = false, direction: 'first' | 'next' | 'previous' | 'clear' = 'first') => find.search(page, 'tab', text, matchCase, direction, () => {});
  const highlights = () => page.evaluate(() => [...CSS.highlights.entries()].map(([key, value]) => ({ key, text: [...value].map(range => range.toString()) })));
  it('matches literal punctuation, Unicode and phrases across inline tokens and line breaks', async () => {
    await page.setContent('<p>a.b [x] aXb</p><p>Café 🌙 café 🌙</p><p>A <b>quiet</b>   place<br>to focus</p>');
    expect(await search('a.b [x]')).toMatchObject({ total: 1, active: 0 });
    expect(await search('CAFÉ 🌙')).toMatchObject({ total: 2 });
    expect(await search('Café 🌙', true)).toMatchObject({ total: 1 });
    expect(await search('quiet place to focus')).toMatchObject({ total: 1 });
    expect((await highlights()).flatMap(value => value.text)).toContain('quiet   placeto focus');
  });
  it('wraps both directions, re-reads dynamic text and clears without changing selection, DOM or input values', async () => {
    await page.setContent('<style>p{color:purple}</style><p>Find find FIND</p><input value="keep this"><textarea>keep notes</textarea>');
    await page.evaluate(() => { const range = document.createRange(); range.selectNodeContents(document.querySelector('p')!); getSelection()!.addRange(range); });
    const original = await page.content();
    expect(await search('find')).toMatchObject({ active: 0, total: 3 });
    expect(await search('find', false, 'previous')).toMatchObject({ active: 2 });
    expect(await search('find', false, 'next')).toMatchObject({ active: 0 });
    expect(await page.content()).toBe(original); expect(await page.locator('input').inputValue()).toBe('keep this');
    expect(await page.evaluate(() => getSelection()?.toString())).toBe('Find find FIND');
    await page.locator('p').evaluate(node => { node.textContent += ' find'; });
    expect(await search('find', false, 'next')).toMatchObject({ active: 1, total: 4 });
    await search('', false, 'clear'); expect(await highlights()).toEqual([]);
    expect(await page.evaluate(() => document.adoptedStyleSheets.length)).toBe(0); expect(find.state(page)).toBeUndefined();
  });
  it('excludes invisible and form text but includes visibility overrides, shadow roots and assigned slot content', async () => {
    await page.setContent('<p hidden>needle</p><p style="opacity:0">needle</p><p style="visibility:hidden">needle <b style="visibility:visible">needle</b></p><input value="needle"><textarea>needle</textarea><div id="host"><span>needle slotted</span></div>');
    await page.locator('#host').evaluate(node => { node.attachShadow({ mode: 'open' }).innerHTML = '<p>needle shadow</p><slot></slot>'; });
    expect(await search('needle')).toMatchObject({ total: 3 });
    expect(await search('needle slotted')).toMatchObject({ total: 1 });
    expect(await search('needle shadow')).toMatchObject({ total: 1 });
  });
  it('searches visible frames and brings offscreen and nested scroll matches into view', async () => {
    await page.setContent('<div id="scroll" style="height:80px;overflow:auto"><div style="height:900px"></div><p>needle nested</p></div><div style="height:1000px"></div><p id="far">needle distant</p><iframe srcdoc="<p>needle framed</p>"></iframe><iframe style="display:none" srcdoc="<iframe srcdoc=\'<p>needle hidden</p>\'></iframe>"></iframe>');
    await page.frameLocator('iframe').first().getByText('needle framed').waitFor();
    expect(await search('needle')).toMatchObject({ total: 3 });
    expect(await page.locator('#scroll').evaluate(node => node.scrollTop)).toBeGreaterThan(700);
    await search('needle', false, 'next');
    const rect = (await page.locator('#far').boundingBox())!; expect(rect.y).toBeGreaterThanOrEqual(0); expect(rect.y + rect.height).toBeLessThanOrEqual(400);
    expect(await search('needle', false, 'next')).toMatchObject({ active: 2 });
  });
  it('reports only actual truncation at the match limit and bounds very wide/deep documents', async () => {
    await page.setContent(`<p>${'word '.repeat(1000)}</p>`); expect(await search('word')).toMatchObject({ total: 1000, truncated: false });
    await page.locator('p').evaluate(node => { node.textContent += 'word'; }); expect(await search('word')).toMatchObject({ total: 1000, truncated: true });
    await page.evaluate(() => { document.body.replaceChildren(); const fragment = document.createDocumentFragment(); for (let i = 0; i < 51000; i++) fragment.append(document.createElement('span')); document.body.append(fragment); });
    expect(await search('absent')).toMatchObject({ total: 0, truncated: true });
    await page.evaluate(() => { document.body.replaceChildren(); let parent = document.body; for (let i = 0; i < 4000; i++) { const child = document.createElement('span'); parent.append(child); parent = child; } parent.textContent = 'deep word'; });
    expect(await search('deep word')).toMatchObject({ total: 1, truncated: false });
  });
  it('cleans highlights if the document changes or a search is cancelled during evaluation', async () => {
    await page.setContent('<p>needle</p>'); let checks = 0;
    await expect(find.search(page, 'tab', 'needle', false, 'first', () => { if (++checks === 3) throw new Error('cancelled'); })).rejects.toThrow('cancelled');
    expect(await highlights()).toEqual([]); expect(find.state(page)).toBeUndefined();
    await search('needle'); await find.releasePage(page); expect(await highlights()).toEqual([]);
  });
});

describe('task browser search boundaries', () => {
  let root: string, browsers: SessionBrowsers, server: Server, url: string, page: Page, tabId: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'litespeed-browser-find-')); browsers = new SessionBrowsers(root);
    server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<title>Find fixture</title><p>quiet quiet Quiet</p>'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
    const launch = vi.spyOn(chromium, 'launchPersistentContext'); const result = await browsers.execute('one', { action: 'open', url }); tabId = result.state.activeId!;
    page = (await launch.mock.results.find(result => result.type === 'return')!.value).pages()[0];
  });
  afterEach(async () => { vi.restoreAllMocks(); await browsers.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  const input = () => ({ action: 'find', tabId, url, text: 'quiet', findDirection: 'first' });
  it('requires current page identity and rejects stale, foreign, inactive and saved tabs without selecting or launching them', async () => {
    for (const field of ['tabId', 'url', 'text']) { const value: any = input(); delete value[field]; expect(browserActionSchema.safeParse(value).success).toBe(false); }
    expect(browserActionSchema.safeParse({ ...input(), text: 'a'.repeat(201) }).success).toBe(false);
    await expect(browsers.execute('one', { ...input(), url: url + 'stale' })).rejects.toThrow('page changed');
    await expect(browsers.execute('two', input())).rejects.toThrow('page changed');
    const second = await browsers.execute('one', { action: 'open', url });
    await expect(browsers.execute('one', input())).rejects.toThrow('page changed'); expect((await browsers.state('one')).activeId).toBe(second.state.activeId);
    await browsers.close(); browsers = new SessionBrowsers(root); const launch = vi.spyOn(chromium, 'launchPersistentContext'); launch.mockClear();
    await expect(browsers.execute('one', { ...input(), tabId: second.state.activeId })).rejects.toThrow('page changed'); expect(launch).not.toHaveBeenCalled();
  });
  it('keeps matches with their own tab and clears state on navigation', async () => {
    expect((await browsers.execute('one', input())).state.find).toMatchObject({ total: 3, tabId });
    const second = await browsers.execute('one', { action: 'open', url }); expect(second.state.find).toBeUndefined();
    expect((await browsers.execute('one', { action: 'select', tabId })).state.find).toMatchObject({ total: 3, tabId });
    await browsers.execute('one', { action: 'navigate', url: url + 'next' }); expect((await browsers.state('one')).find).toBeUndefined();
  });
  it('rejects a same-address reload during the final screenshot instead of returning stale matches', async () => {
    vi.spyOn(page, 'title').mockImplementationOnce(async () => { await page.reload(); return 'Reloaded'; });
    await expect(browsers.execute('one', input())).rejects.toThrow('page changed');
    expect((await browsers.state('one')).find).toBeUndefined(); expect((await browsers.state('one')).busy).toBe(false);
  });
  it('cancels a search without closing the website and releases busy ownership', async () => {
    const controller = new AbortController(); vi.spyOn(page, 'frames').mockImplementationOnce(() => { controller.abort(); return [page.mainFrame()]; });
    await expect(browsers.execute('one', input(), controller.signal)).rejects.toThrow();
    expect(page.isClosed()).toBe(false); expect((await browsers.state('one')).busy).toBe(false); expect((await browsers.state('one')).find).toBeUndefined();
  });
});
