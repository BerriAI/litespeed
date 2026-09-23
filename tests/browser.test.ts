import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readdir, readFile, stat, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { SessionBrowsers, browserActionSchema, browserUrl } from '../server/browser.js';
import { toolTarget } from '../client/src/workspace-activity.js';
import type { ToolCall } from '../shared/types.js';
import { chromium } from 'playwright';
import { BrowserSessions } from '../server/browser-state.js';
import { randomUUID } from 'node:crypto';
import type { BrowserFrame } from '../shared/browser.js';
import { jpegDimensions } from '../server/browser-stream.js';

describe('browser and workspace boundaries', () => {
  it('normalizes public and local addresses and rejects non-web protocols and embedded credentials', () => {
    expect(browserUrl('example.com/docs')).toBe('https://example.com/docs');
    expect(browserUrl('localhost:3000/settings')).toBe('http://localhost:3000/settings');
    expect(browserUrl('http://127.0.0.1:3001')).toBe('http://127.0.0.1:3001/');
    for (const url of ['file:///etc/passwd', 'ftp://example.com', 'https://user:password@example.com', 'javascript:alert(1)']) expect(() => browserUrl(url)).toThrow();
    expect(() => browserActionSchema.parse({ action: 'click', ref: 'e1"]script' })).toThrow();
    expect(() => browserActionSchema.parse({ action: 'click', x: -1, y: 1 })).toThrow();
  });
  it('only follows successful file operations inside the current workspace', () => {
    const tool: ToolCall = { id: 'read', name: 'read_file', args: { path: '/project/src/index.ts' }, status: 'completed' };
    expect(toolTarget(tool, '/project', 4)).toEqual({ kind: 'file', path: 'src/index.ts', revision: 4 });
    for (const path of ['/project-other/secret', '../secret', 'src/../../secret']) expect(toolTarget({ ...tool, args: { path } }, '/project', 4)).toBeNull();
    expect(toolTarget({ ...tool, status: 'denied' }, '/project', 4)).toBeNull();
    expect(toolTarget({ ...tool, name: 'glob' }, '/project', 4)).toBeNull();
    expect(toolTarget(tool, '/moved', 5, ['/project'])).toEqual({ kind: 'file', path: 'src/index.ts', revision: 5 });
    expect(toolTarget({ ...tool, args: { path: '/project/../secret' } }, '/moved', 5, ['/project'])).toBeNull();
  });
});

describe('real session browser', () => {
  let root: string, browsers: SessionBrowsers, server: Server, url: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'litespeed-browser-test-'));
    browsers = new SessionBrowsers(root);
    server = createServer((req, res) => {
      if (req.url === '/diagnostics') { res.setHeader('Content-Type', 'text/html'); res.end('<title>Diagnostics</title><script>console.warn("Check the preview");</script><h1>Page activity</h1>'); return; }
      if (req.url === '/slow') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.write('<title>A slow page</title><h1>Still loading</h1><script src="/pending-script"></script>'); return; }
      if (req.url === '/pending-script' || req.url === '/pending-response') return;
      if (req.url === '/background-load') { res.end('<title>Visible while loading</title><h1>The useful part is ready</h1><img src="/pending-image">'); return; }
      if (req.url === '/pending-image') return;
      if (req.url === '/login') { res.setHeader('Set-Cookie', 'signed_in=yes; Path=/'); res.end('<title>Signed in</title>'); return; }
      if (req.url === '/account') { res.end(req.headers.cookie?.includes('signed_in=yes') ? '<title>Account ready</title>' : '<title>Please sign in</title>'); return; }
      if (req.url === '/report') { res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="report.csv"' }); res.end('name,total\nLitespeed,42\n'); return; }
      if (req.url === '/downloads') { res.end('<title>Downloads</title><a href="/report">Download report</a>'); return; }
      res.setHeader('Content-Type', 'text/html');
      res.end(req.url === '/next' ? '<title>Second page</title><h1>Next page</h1>' : '<title>Browser fixture</title><h1>Preview workspace</h1><label>Name <input aria-label="Name"></label><button onclick="document.querySelector(\'h1\').innerText=\'Hello \'+document.querySelector(\'input\').value">Greet</button><a href="/next">Next</a>');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterEach(async () => { await browsers.close(); vi.restoreAllMocks(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  it('shows rendered pages, fills fields, clicks, navigates, and keeps task tabs isolated', async () => {
    const first = await browsers.execute('one', { action: 'open', url });
    expect(first.snapshot).toContain('Preview workspace');
    expect(first.image?.subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(first.state.tabs).toHaveLength(1);
    expect(first.state.busy).toBe(false);
    expect((await browsers.state('two')).tabs).toEqual([]);
    await expect(browsers.execute('two', { action: 'select', tabId: first.state.activeId })).rejects.toThrow('Open a browser tab in this task first');
    await browsers.execute('one', { action: 'type', ref: 'e1', text: 'Litespeed' });
    const greeted = await browsers.execute('one', { action: 'click', ref: 'e2' });
    expect(greeted.snapshot).toContain('Hello Litespeed');
    const next = await browsers.execute('one', { action: 'click', ref: 'e3' });
    expect(next.state.tabs[0].url).toBe(url + '/next');
    const back = await browsers.execute('one', { action: 'back' });
    expect(back.snapshot).toContain('Preview workspace');
    await browsers.execute('one', { action: 'open', url: url + '/next' });
    expect((await browsers.state('one')).tabs).toHaveLength(2);
    await browsers.closeSession('one');
    expect((await browsers.state('one')).tabs).toEqual([]);
  }, 45000);
  it('inspects only the active live task page without resuming saved tabs', async () => {
    const opened = await browsers.execute('one', { action: 'open', url }), tabId = opened.state.activeId!;
    const input = { action: 'select', tabId, url: url + '/', width: 1280, height: 800, x: 80, y: 25 };
    const selected = (await browsers.inspect('one', input))!; expect(selected.element!.tag).toBe('h1');
    await expect(browsers.inspect('two', input)).rejects.toThrow('original live browser tab');
    await browsers.execute('one', { action: 'open', url: url + '/next' }); await expect(browsers.inspect('one', input)).rejects.toThrow('original live browser tab');
    await browsers.execute('one', { action: 'select', tabId });
    const pending = browsers.inspect('one', { action: 'preview', tabId, elementId: selected.element!.id, changes: { fontSize: 44 } });
    await expect(browsers.inspect('one', input)).rejects.toThrow('current action'); await pending;
    await browsers.execute('one', { action: 'navigate', url: url + '/next' });
    const refreshed = (await browsers.inspect('one', { action: 'refresh', tabId }))!; expect(refreshed).toMatchObject({ url: url + '/next', title: 'Second page', width: 1280, height: 800 }); expect(refreshed.element).toBeUndefined();
    await expect(browsers.inspect('one', { action: 'preview', tabId, elementId: selected.element!.id, changes: {} })).rejects.toThrow('expired');
    await browsers.close(); browsers = new SessionBrowsers(root);
    const launch = vi.spyOn(chromium, 'launchPersistentContext');
    await expect(browsers.inspect('one', input)).rejects.toThrow('original live browser tab'); expect(launch).not.toHaveBeenCalled();
  }, 45000);
  it('reports navigation availability for document changes and same-page history without persisting stale controls', async () => {
    const first = await browsers.execute('one', { action: 'open', url }); expect(first.state.tabs[0].canGoForward).toBe(false);
    const next = await browsers.execute('one', { action: 'navigate', url: url + '/next' }); expect(next.state.tabs[0]).toMatchObject({ canGoBack: true, canGoForward: false });
    const back = await browsers.execute('one', { action: 'back' }); expect(back.state.tabs[0]).toMatchObject({ url: url + '/', canGoForward: true });
    const forward = await browsers.execute('one', { action: 'forward' }); expect(forward.state.tabs[0]).toMatchObject({ url: url + '/next', canGoForward: false });
    const hash = await browsers.execute('one', { action: 'navigate', url: url + '/next#details' }); expect(hash.state.tabs[0].canGoBack).toBe(true);
    const previous = await browsers.execute('one', { action: 'back' }); expect(previous.state.tabs[0]).toMatchObject({ url: url + '/next', canGoForward: true });
    await browsers.close(); browsers = new SessionBrowsers(root); const restored = await browsers.state('one'); expect(restored.tabs[0].suspended).toBe(true); expect(restored.tabs[0].canGoBack).toBeUndefined(); expect(restored.tabs[0].canGoForward).toBeUndefined();
  }, 45000);
  it('blocks its own privileged UI origin and rejects cross-task frame reads', async () => {
    browsers.blockOrigin(url);
    await expect(browsers.execute('one', { action: 'open', url })).rejects.toThrow();
    expect(await browsers.frame('two', (await browsers.state('one')).activeId!)).toBeNull();
  }, 45000);
  it('stops a slow document without closing the tab, then allows normal navigation', async () => {
    const first = await browsers.execute('one', { action: 'open', url }), tabId = first.state.activeId!;
    const pending = browsers.execute('one', { action: 'navigate', url: url + '/slow' });
    let navigationId = '';
    await vi.waitFor(async () => { const tab = (await browsers.state('one')).tabs[0]; expect(tab.loading).toBe(true); expect(tab.title).toBe('A slow page'); navigationId = tab.navigationId!; });
    await expect(browsers.stopLoading('two', { tabId, navigationId })).rejects.toThrow('changed or finished');
    await expect(browsers.stopLoading('one', { tabId, navigationId: randomUUID() })).rejects.toThrow('changed or finished');
    const began = Date.now(), stopped = await browsers.stopLoading('one', { tabId, navigationId }); expect(stopped.tabs).toHaveLength(1); expect(stopped.tabs[0].suspended).toBeUndefined();
    const result = await pending; expect(result.state.error).toBeUndefined(); expect(result.state.tabs[0].loading).toBeUndefined(); expect(result.snapshot).toContain('Still loading');
    expect(Date.now() - began).toBeLessThan(5000);
    expect((await browsers.execute('one', { action: 'navigate', url: url + '/next' })).snapshot).toContain('Next page');
    await expect(browsers.stopLoading('one', { tabId, navigationId })).rejects.toThrow('changed or finished');
  }, 45000);
  it('exposes only the selected task tab diagnostics and never resumes a saved tab to read them', async () => {
    const first = await browsers.execute('one', { action: 'open', url: url + '/diagnostics' }), tabId = first.state.activeId!;
    await vi.waitFor(async () => expect((await browsers.diagnostics('one', tabId)).console.some(entry => entry.text === 'Check the preview')).toBe(true));
    await expect(browsers.diagnostics('two', tabId)).rejects.toThrow('in this task'); await expect(browsers.clearDiagnostics('two', tabId, 'all')).rejects.toThrow('no longer available');
    const second = await browsers.execute('one', { action: 'open', url: url + '/next' });
    const result = await browsers.execute('one', { action: 'diagnostics', tabId, view: 'console' }); expect(result.snapshot).toContain('Check the preview'); expect(result.state.activeId).toBe(second.state.activeId); expect(result.image).toBeUndefined();
    await browsers.clearDiagnostics('one', tabId, 'console'); expect((await browsers.diagnostics('one', tabId)).console).toEqual([]); expect((await browsers.diagnostics('one', tabId)).requests.length).toBeGreaterThan(0);
    await browsers.close(); browsers = new SessionBrowsers(root); const launch = vi.spyOn(chromium, 'launchPersistentContext');
    expect(await browsers.diagnostics('one', tabId)).toMatchObject({ tabId, live: false, console: [], requests: [] });
    expect((await browsers.execute('one', { action: 'diagnostics', tabId })).snapshot).toContain('0 retained'); expect(launch).not.toHaveBeenCalled();
  }, 45000);
  it('stops before the response arrives while retaining the previous page and protecting other tabs', async () => {
    const first = await browsers.execute('one', { action: 'open', url }), tabId = first.state.activeId!;
    const second = await browsers.execute('one', { action: 'open', url: url + '/next' });
    await browsers.execute('one', { action: 'select', tabId });
    const pending = browsers.execute('one', { action: 'navigate', url: url + '/pending-response' });
    let navigationId = '';
    await vi.waitFor(async () => { const tab = (await browsers.state('one')).tabs.find(tab => tab.id === tabId)!; expect(tab.loading).toBe(true); navigationId = tab.navigationId!; });
    await expect(browsers.stopLoading('one', { tabId: second.state.activeId!, navigationId })).rejects.toThrow('changed or finished');
    await browsers.stopLoading('one', { tabId, navigationId }); const result = await pending;
    expect(result.state.tabs).toHaveLength(2); expect(result.state.error).toBeUndefined(); expect(result.snapshot).toContain('Preview workspace');
  }, 45000);
  it('reports and stops pending page resources after the interactive document has loaded', async () => {
    const first = await browsers.execute('one', { action: 'open', url: url + '/background-load' });
    expect(first.snapshot).toContain('The useful part is ready'); expect(first.state.tabs[0].loading).toBe(true);
    const { id: tabId, navigationId } = first.state.tabs[0]; await browsers.stopLoading('one', { tabId, navigationId: navigationId! });
    await vi.waitFor(async () => expect((await browsers.state('one')).tabs[0].loading).toBeUndefined());
    expect((await browsers.execute('one', { action: 'snapshot' })).snapshot).toContain('The useful part is ready');
  }, 45000);
  it('streams an exact task-owned page, survives resize, and ends when the tab closes', async () => {
    const opened = await browsers.execute('one', { action: 'open', url }), tabId = opened.state.activeId!;
    const frames: BrowserFrame[] = [], end = vi.fn();
    const stop = await browsers.stream('one', tabId, frame => frames.push(frame), end);
    expect(stop).toBeTypeOf('function');
    expect(await browsers.stream('two', tabId, vi.fn(), vi.fn())).toBeNull();
    await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0), { timeout: 7000 });
    expect(frames[0]).toMatchObject({ tabId, pageUrl: url + '/', width: 1280, height: 800 });
    for (const frame of frames) expect(jpegDimensions(Buffer.from(frame.data, 'base64'))).toEqual({ width: frame.width, height: frame.height });
    await browsers.execute('one', { action: 'resize', width: 470, height: 730 });
    await vi.waitFor(() => expect(frames.at(-1)).toMatchObject({ width: 470, height: 730 }), { timeout: 7000 });
    await browsers.execute('one', { action: 'close' }); expect(end).toHaveBeenCalledOnce(); stop?.();
    const count = frames.length;
    expect(await browsers.stream('one', tabId, vi.fn(), vi.fn())).toBeNull(); expect(frames).toHaveLength(count);
  }, 45000);
  it('does not create a browser for an aborted action or a read-only status poll', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(browsers.execute('one', { action: 'open', url }, controller.signal)).rejects.toThrow();
    expect(await browsers.state('one')).toMatchObject({ tabs: [], busy: false });
    expect(await browsers.frame('one')).toBeNull();
    expect(await browsers.stream('one', 'missing', vi.fn(), vi.fn())).toBeNull();
  });
  it('captures real browser downloads and keeps them available after tabs close and the server restarts', async () => {
    await browsers.execute('one', { action: 'open', url: url + '/downloads' });
    await browsers.execute('one', { action: 'click', ref: 'e1' });
    await vi.waitFor(async () => expect((await browsers.state('one')).downloads?.[0]?.status).toBe('ready'));
    const item = (await browsers.state('one')).downloads![0];
    expect((await browsers.downloads.read('one', item.id)).data.toString()).toBe('name,total\nLitespeed,42\n');
    expect((await browsers.execute('one', { action: 'downloads' })).snapshot).toContain('report.csv');
    await browsers.execute('one', { action: 'close' }); await browsers.close(); browsers = new SessionBrowsers(root);
    expect((await browsers.execute('one', { action: 'downloads' })).state.downloads).toEqual([item]);
    await browsers.closeSession('one'); expect((await browsers.state('one')).downloads).toEqual([]);
  }, 45000);
  it('treats navigation to a download as a file transfer rather than a broken page', async () => {
    const result = await browsers.execute('one', { action: 'open', url: url + '/report' });
    expect(result.state.error).toBeUndefined();
    await vi.waitFor(async () => expect((await browsers.state('one')).downloads?.[0]?.status).toBe('ready'));
  }, 45000);
  it('resizes all task tabs and rejects coordinates outside the visible viewport', async () => {
    await browsers.execute('one', { action: 'open', url });
    await browsers.execute('one', { action: 'open', url: url + '/next' });
    expect((await browsers.execute('one', { action: 'resize', width: 480, height: 920 })).state).toMatchObject({ width: 480, height: 920, busy: false });
    await expect(browsers.execute('one', { action: 'click', x: 481, y: 40 })).rejects.toThrow('inside');
    await expect(browsers.execute('one', { action: 'resize', width: 10, height: 900 })).rejects.toThrow();
    await browsers.execute('one', { action: 'open', url });
    expect((await browsers.state('one')).width).toBe(480);
  }, 45000);
  it('remembers page history and resets only its separate profile while preserving task tab addresses', async () => {
    await browsers.execute('one', { action: 'open', url: url + '/login' });
    const account = await browsers.execute('one', { action: 'navigate', url: url + '/account' }); expect(account.snapshot).toContain('Account ready');
    expect((await browsers.history.list()).entries[0]).toMatchObject({ url: url + '/account', title: 'Account ready' });
    await browsers.resetProfile();
    expect((await browsers.state('one')).tabs).toEqual(account.state.tabs.map(({ canGoBack: _back, canGoForward: _forward, ...tab }) => ({ ...tab, suspended: true })));
    expect((await browsers.history.list()).total).toBe(2);
    const resumed = await browsers.execute('one', { action: 'resume' }); expect(resumed.snapshot).toContain('Please sign in');
  }, 45000);
  it('does not reset a linked profile directory or the directory it points to', async () => {
    const other = join(root, 'untouched'); await writeFile(other, 'keep'); await symlink(other, join(root, 'browser-profile'));
    await expect(browsers.resetProfile()).rejects.toThrow('regular directory'); expect(await readFile(other, 'utf8')).toBe('keep');
  });

  it('restores task tabs after restart without loading websites, then explicitly reopens one', async () => {
    const first = await browsers.execute('one', { action: 'open', url });
    const second = await browsers.execute('one', { action: 'open', url: url + '/next' });
    await browsers.execute('one', { action: 'resize', width: 510, height: 760 });
    await browsers.execute('one', { action: 'select', tabId: first.state.activeId! });
    await browsers.close(); browsers = new SessionBrowsers(root);
    const launch = vi.spyOn(chromium, 'launchPersistentContext');
    const restored = await browsers.state('one');
    expect(restored).toMatchObject({ activeId: first.state.activeId, width: 510, height: 760, busy: false });
    expect(restored.tabs).toEqual(first.state.tabs.concat(second.state.tabs[1]).map(({ canGoBack: _back, canGoForward: _forward, ...tab }) => ({ ...tab, suspended: true })));
    expect(await browsers.stream('one', first.state.activeId!, vi.fn(), vi.fn())).toBeNull();
    expect((await browsers.state('two')).tabs).toEqual([]);
    expect(await browsers.frame('one')).toBeNull();
    expect((await browsers.execute('one', { action: 'snapshot' })).snapshot).toContain('No website was loaded');
    await browsers.execute('one', { action: 'select', tabId: second.state.activeId! });
    await expect(browsers.execute('one', { action: 'click', ref: 'e1' })).rejects.toThrow('Reopen');
    await expect(browsers.execute('one', { action: 'type', text: 'stale input' })).rejects.toThrow('Reopen');
    expect(launch).not.toHaveBeenCalled();
    const resumed = await browsers.execute('one', { action: 'resume' });
    expect(resumed.state.activeId).toBe(second.state.activeId);
    expect(resumed.snapshot).toContain('Next page');
    expect(resumed.state.tabs[0].suspended).toBe(true);
    expect(resumed.state.tabs[1].suspended).toBeUndefined();
    expect(resumed.image).toBeDefined();
    expect(launch).toHaveBeenCalledOnce();
  }, 45000);

  it('closes saved tabs and deletes task metadata without launching a browser', async () => {
    const first = await browsers.execute('one', { action: 'open', url });
    const second = await browsers.execute('one', { action: 'open', url: url + '/next' });
    await browsers.close(); browsers = new SessionBrowsers(root);
    const launch = vi.spyOn(chromium, 'launchPersistentContext');
    const closed = await browsers.execute('one', { action: 'close', tabId: first.state.activeId! });
    expect(closed.state.activeId).toBe(second.state.activeId);
    expect(closed.state.tabs).toHaveLength(1);
    await browsers.close(); browsers = new SessionBrowsers(root);
    expect((await browsers.state('one')).tabs).toHaveLength(1);
    await browsers.closeSession('one');
    expect((await browsers.state('one')).tabs).toEqual([]);
    await browsers.close(); browsers = new SessionBrowsers(root);
    expect((await browsers.state('one')).tabs).toEqual([]);
    expect(launch).not.toHaveBeenCalled();
  }, 45000);

  it('counts suspended tabs toward the tab limit and isolates persisted session identities', async () => {
    const persistence = new BrowserSessions(root);
    const tabs = Array.from({ length: 12 }, (_, i) => ({ id: randomUUID(), title: `Saved ${i}`, url }));
    await persistence.save('../untrusted/session', { tabs, activeId: tabs[0].id, width: 640, height: 480 });
    const launch = vi.spyOn(chromium, 'launchPersistentContext');
    expect((await browsers.state('../untrusted/session')).tabs).toHaveLength(12);
    expect((await browsers.state('session')).tabs).toEqual([]);
    await expect(browsers.execute('../untrusted/session', { action: 'open', url })).rejects.toThrow('Close a browser tab');
    expect(launch).not.toHaveBeenCalled();
    const files = await readdir(join(root, 'browser-tabs'));
    expect(files).toHaveLength(1); expect(files[0]).toMatch(/^[a-f0-9]{64}\.json$/);
    expect((await stat(join(root, 'browser-tabs', files[0]))).mode & 0o777).toBe(0o600);
  });

  it('reports invalid or redirected metadata without visiting or overwriting it during polling', async () => {
    const persistence = new BrowserSessions(root), tab = { id: randomUUID(), title: 'Saved', url };
    await persistence.save('one', { tabs: [tab], activeId: tab.id, width: 640, height: 480 });
    const file = join(root, 'browser-tabs', (await readdir(join(root, 'browser-tabs')))[0]);
    await writeFile(file, '{invalid');
    expect((await browsers.state('one')).error).toContain('could not be restored');
    await browsers.close(); expect(await readFile(file, 'utf8')).toBe('{invalid');
    await rm(file); const other = join(root, 'other.json'); await writeFile(other, '{}'); await symlink(other, file);
    browsers = new SessionBrowsers(root);
    expect((await browsers.state('one')).error).toContain('could not be restored');
    await expect(persistence.save('bad', { tabs: [{ ...tab, url: 'file:///private' }], activeId: tab.id, width: 640, height: 480 })).rejects.toThrow();
  });
});
