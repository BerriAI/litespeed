import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { chromium, type Page } from 'playwright';
import { SessionBrowsers, browserActionSchema } from '../server/browser.js';
import { browserGesturePage } from '../scripts/e2e-browser-gestures.js';
import { readBrowserSelection } from '../server/browser-selection.js';

describe('browser dragging', () => {
  let root: string, browsers: SessionBrowsers, server: Server, url: string, page: Page;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'litespeed-browser-drag-')); browsers = new SessionBrowsers(root);
    server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(browserGesturePage); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
    const launch = vi.spyOn(chromium, 'launchPersistentContext'); await browsers.execute('one', { action: 'open', url });
    page = (await launch.mock.results.find(result => result.type === 'return')!.value).pages()[0];
  });
  afterEach(async () => { vi.restoreAllMocks(); await browsers.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  async function input() {
    const state = await browsers.state('one');
    return { action: 'drag' as const, tabId: state.activeId!, revision: state.revision, url, width: state.width, height: state.height, x: 107, y: 237, toX: 340, toY: 237, durationMs: 100 };
  }
  it('moves a real slider, selects text, and delivers an HTML drag-and-drop', async () => {
    const dragged = await browsers.execute('one', await input()); expect(dragged.state.tabs[0].title).toMatch(/Preview volume (8\d|9\d)%/);
    await browsers.execute('one', { ...await input(), x: 34, y: 406, toX: 174, toY: 406 });
    expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('quiet place');
    const moved = await browsers.execute('one', { ...await input(), x: 72, y: 325, toX: 210, toY: 325 }); expect(moved.state.tabs[0].title).toBe('Card moved');
  }, 45000);
  it('rejects old views, changed dimensions and inactive tabs before delivering any input', async () => {
    const stale = await input(); await browsers.execute('one', { action: 'resize', width: 480, height: 600 });
    const down = vi.spyOn(page.mouse, 'down'), move = vi.spyOn(page.mouse, 'move');
    await expect(browsers.execute('one', stale)).rejects.toThrow('view changed');
    const fresh = await input();
    for (const change of [{ width: 481 }, { url: url + 'changed' }, { toX: 480 }, { y: 600 }]) await expect(browsers.execute('one', { ...fresh, ...change })).rejects.toThrow(/view changed|inside/);
    const second = await browsers.execute('one', { action: 'open', url });
    await expect(browsers.execute('one', { ...fresh, revision: second.state.revision })).rejects.toThrow('view changed');
    expect((await browsers.state('one')).activeId).toBe(second.state.activeId); expect(down).not.toHaveBeenCalled(); expect(move).not.toHaveBeenCalled();
    await expect(browsers.execute('two', fresh)).rejects.toThrow('in this task');
  }, 45000);
  it('releases the mouse and modifiers after an interrupted movement', async () => {
    const original = page.mouse.move.bind(page.mouse);
    vi.spyOn(page.mouse, 'move').mockImplementationOnce(original).mockRejectedValueOnce(new Error('Movement interrupted'));
    await expect(browsers.execute('one', { ...await input(), modifiers: ['Shift'] })).rejects.toThrow('Movement interrupted');
    await page.mouse.click(20, 20);
    expect(await page.evaluate(() => (window as any).events)).toEqual([
      { type: 'down', buttons: 1, shift: true }, { type: 'up', buttons: 0, shift: true }, { type: 'down', buttons: 1, shift: false }, { type: 'up', buttons: 0, shift: false },
    ]);
    expect((await browsers.state('one')).busy).toBe(false);
  }, 45000);
  it('stops a gesture when its document navigates and releases held controls', async () => {
    await page.evaluate(() => document.addEventListener('mousedown', () => { location.hash = 'changed'; }, { once: true }));
    const up = vi.spyOn(page.mouse, 'up'), keyUp = vi.spyOn(page.keyboard, 'up');
    await expect(browsers.execute('one', { ...await input(), modifiers: ['Alt'], durationMs: 500 })).rejects.toThrow('view changed');
    expect(up).toHaveBeenCalled(); expect(keyUp).toHaveBeenCalledWith('Alt'); expect((await browsers.state('one')).busy).toBe(false);
  }, 45000);
  it('does not reopen saved tabs or launch a browser for a stale drag', async () => {
    const stale = await input(); await browsers.close(); browsers = new SessionBrowsers(root);
    const launch = vi.spyOn(chromium, 'launchPersistentContext'); launch.mockClear();
    await expect(browsers.execute('one', stale)).rejects.toThrow('view changed'); expect(launch).not.toHaveBeenCalled();
    expect((await browsers.state('one')).tabs[0].suspended).toBe(true);
  }, 45000);
  it('requires a complete bounded gesture before input can be attempted', async () => {
    const valid = await input(); expect(browserActionSchema.safeParse(valid).success).toBe(true);
    for (const key of ['tabId', 'url', 'revision', 'width', 'height', 'x', 'y', 'toX', 'toY']) { const bad: any = { ...valid }; delete bad[key]; expect(browserActionSchema.safeParse(bad).success).toBe(false); }
    for (const change of [{ toX: -1 }, { toY: 1201 }, { durationMs: 5000 }, { modifiers: ['Super'] }]) expect(browserActionSchema.safeParse({ ...valid, ...change }).success).toBe(false);
  });
  it('reads exactly the selected text without changing the browser revision or selecting another tab', async () => {
    const dragged = await browsers.execute('one', { ...await input(), x: 34, y: 406, toX: 174, toY: 406 });
    const request = { tabId: dragged.state.activeId!, revision: dragged.state.revision };
    const selected = await browsers.selection('one', request); expect(selected).toMatchObject({ ...request, url, text: 'A quiet place to focus', truncated: false });
    expect((await browsers.state('one')).revision).toBe(request.revision);
    await expect(browsers.selection('two', request)).rejects.toThrow('view changed');
    const second = await browsers.execute('one', { action: 'open', url });
    await expect(browsers.selection('one', { ...request, revision: second.state.revision })).rejects.toThrow('view changed');
    expect((await browsers.state('one')).activeId).toBe(second.state.activeId);
    await browsers.close(); browsers = new SessionBrowsers(root); const launch = vi.spyOn(chromium, 'launchPersistentContext'); launch.mockClear();
    await expect(browsers.selection('one', { tabId: second.state.activeId!, revision: 0 })).rejects.toThrow('view changed'); expect(launch).not.toHaveBeenCalled();
  }, 45000);
  it('reads selected input ranges and focused opaque iframe text but excludes passwords and masked fields', async () => {
    await page.setContent('<input aria-label="Ordinary" value="A useful reference"><input aria-label="Password" type="password" value="synthetic-password"><input aria-label="Masked" style="-webkit-text-security:disc" value="synthetic-mask"><iframe sandbox="allow-scripts" srcdoc="<textarea aria-label=Notes>Inside the website frame</textarea>"></iframe>');
    await page.getByLabel('Ordinary').evaluate((input: HTMLInputElement) => { input.focus(); input.setSelectionRange(2, 8); });
    expect(await readBrowserSelection(page)).toEqual({ text: 'useful', truncated: false });
    for (const name of ['Password', 'Masked']) { await page.getByLabel(name).focus(); await page.keyboard.press('ControlOrMeta+A'); expect(await readBrowserSelection(page)).toEqual({ text: '', truncated: false }); }
    await page.frameLocator('iframe').getByLabel('Notes').focus(); await page.keyboard.press('ControlOrMeta+A'); expect(await readBrowserSelection(page)).toEqual({ text: 'Inside the website frame', truncated: false });
  }, 45000);
  it('bounds selected text, handles shadow input focus, and detects navigation during a read', async () => {
    await page.setContent('<div id="host"></div>');
    await page.evaluate(() => { const root = document.querySelector('#host')!.attachShadow({ mode: 'open' }); root.innerHTML = '<textarea></textarea>'; const field = root.querySelector('textarea')!; field.value = 'a'.repeat(13000); field.focus(); field.select(); });
    expect(await readBrowserSelection(page)).toEqual({ text: 'a'.repeat(12000), truncated: true });
    const value = await input(); vi.spyOn(page, 'title').mockImplementationOnce(async () => { await page.evaluate(() => { location.hash = 'selection-changed'; }); return 'Changed'; });
    await expect(browsers.selection('one', { tabId: value.tabId, revision: value.revision })).rejects.toThrow('view changed'); expect((await browsers.state('one')).busy).toBe(false);
  }, 45000);
  it('releases selection ownership promptly when the reader disconnects', async () => {
    const value = await input(), controller = new AbortController(); let release!: () => void;
    vi.spyOn(page, 'title').mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); return 'Done'; });
    const pending = browsers.selection('one', { tabId: value.tabId, revision: value.revision }, controller.signal); const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(release).toBeTypeOf('function')); controller.abort(); await rejected;
    expect((await browsers.state('one')).busy).toBe(false); release();
  }, 45000);
  it('keeps the compositor moving after many coalesced frames and delivers the settled drag', async () => {
    const initial = await input(), frames: string[] = [];
    const stop = await browsers.stream('one', initial.tabId, frame => frames.push(frame.data), () => {});
    await page.evaluate(() => { document.querySelector('.card')!.animate([{ transform: 'translateY(0px)' }, { transform: 'translateY(15px)' }], { duration: 180, iterations: Infinity, direction: 'alternate' }); });
    await vi.waitFor(() => expect(new Set(frames).size).toBeGreaterThan(10), { timeout: 5000 });
    await page.evaluate(() => document.getAnimations().forEach(animation => animation.cancel()));
    await browsers.execute('one', { ...await input(), x: 34, y: 406, toX: 174, toY: 406, durationMs: 600 });
    const pixel = (data: string) => page.evaluate(async data => {
      const image = new Image(); image.src = 'data:image/jpeg;base64,' + data; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
      return Array.from(context.getImageData(170, 398, 1, 1).data).slice(0, 3);
    }, data);
    // Captures and compositor images use different JPEG color profiles. Compare
    // the selected background at the far end of the line after decoding both.
    const exact = await pixel((await browsers.frame('one'))!.toString('base64'));
    expect(exact[0]).toBeLessThan(220);
    await vi.waitFor(async () => { const actual = await pixel(frames.at(-1)!); expect(Math.max(...actual.map((value, index) => Math.abs(value - exact[index])))).toBeLessThan(20); }, { timeout: 5000 }); stop?.();
  }, 45000);
});
