import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { EventEmitter } from 'node:events';
import { chromium, type Browser, type Page, type Request } from 'playwright';
import { BrowserDiagnostics } from '../server/browser-diagnostics.js';
import { browserDiagnosticsText } from '../shared/browser-diagnostics.js';

describe('live browser diagnostic buffers', () => {
  let browser: Browser, page: Page, server: Server, url: string, diagnostics: BrowserDiagnostics;
  const metadata = () => ({ tabId: 'tab-one', url: page.url(), title: 'Diagnostic fixture' });
  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'chrome' });
    server = createServer((req, res) => {
      if (req.url === '/api/summary') { res.setHeader('Content-Type', 'application/json'); res.end('{"ready":true}'); return; }
      if (req.url === '/pending') return;
      if (req.url === '/missing') { res.writeHead(404); res.end('Missing'); return; }
      res.setHeader('Content-Type', 'text/html'); res.end('<title>Diagnostic fixture</title><h1>Ready</h1><script>console.log("Page is ready");console.warn("Preview data is old");fetch("/api/summary",{method:"POST",headers:{"X-Private":"header-not-collected"},body:"body-not-collected"});fetch("/missing");const controller=new AbortController();fetch("/pending",{signal:controller.signal}).catch(()=>{});setTimeout(()=>controller.abort(),30);setTimeout(()=>{throw new Error("Card could not load")},10);</script>');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  beforeEach(async () => { page = await browser.newPage(); diagnostics = new BrowserDiagnostics(); diagnostics.attach(page); });
  afterEach(async () => { diagnostics.close(); await page.close(); });
  afterAll(async () => { await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  it('captures real console errors and request outcomes without request credentials or bodies', async () => {
    await page.goto(url);
    await vi.waitFor(() => {
      const value = diagnostics.read(page, metadata());
      expect(value.console).toEqual(expect.arrayContaining([expect.objectContaining({ level: 'log', text: 'Page is ready' }), expect.objectContaining({ level: 'warning', text: 'Preview data is old' }), expect.objectContaining({ level: 'error', text: expect.stringContaining('Card could not load') })]));
      expect(value.requests).toEqual(expect.arrayContaining([expect.objectContaining({ url: url + '/api/summary', method: 'POST', status: 200, state: 'complete' }), expect.objectContaining({ url: url + '/missing', status: 404, state: 'complete' }), expect.objectContaining({ url: url + '/pending', state: 'failed', error: expect.any(String) })]));
    });
    const value = diagnostics.read(page, metadata()); expect(JSON.stringify(value)).not.toMatch(/header-not-collected|body-not-collected/);
    expect(value.console.find(entry => entry.text === 'Page is ready')?.line).toBe(1);
    expect(value.requests.every(entry => entry.state === 'pending' || typeof entry.duration === 'number')).toBe(true);
    expect(browserDiagnosticsText(value, 'console')).toContain('untrusted website output'); expect(browserDiagnosticsText(value, 'console')).not.toContain('Network ('); expect(browserDiagnosticsText(value, 'network')).not.toContain('Console (');
  });
  it('clears only the chosen buffer and does not resurrect a cleared pending request', async () => {
    await page.goto(url); await vi.waitFor(() => expect(diagnostics.read(page, metadata()).console.length).toBeGreaterThan(2));
    await page.evaluate(() => { (window as any).debugAbort = new AbortController(); void fetch('/pending', { signal: (window as any).debugAbort.signal }).catch(() => {}); });
    await vi.waitFor(() => expect(diagnostics.read(page, metadata()).requests.some(entry => entry.state === 'pending')).toBe(true));
    diagnostics.clear(page, 'network'); expect(diagnostics.read(page, metadata()).requests).toEqual([]); expect(diagnostics.read(page, metadata()).console.length).toBeGreaterThan(2);
    await page.evaluate(() => (window as any).debugAbort.abort()); await page.evaluate(() => console.log('After clearing'));
    await vi.waitFor(() => expect(diagnostics.read(page, metadata()).console.some(entry => entry.text === 'After clearing')).toBe(true));
    expect(diagnostics.read(page, metadata()).requests).toEqual([]); diagnostics.clear(page, 'console'); expect(diagnostics.read(page, metadata()).console).toEqual([]);
  });
  it('keeps task pages separate and releases listeners and retained data on close', async () => {
    const other = await browser.newPage(); diagnostics.attach(other);
    await page.evaluate(() => console.log('First page')); await other.evaluate(() => console.log('Other page'));
    await vi.waitFor(() => expect(diagnostics.read(page, metadata()).console).toHaveLength(1));
    expect(diagnostics.read(page, metadata()).console[0].text).toBe('First page'); expect(diagnostics.read(other, { ...metadata(), tabId: 'tab-two' }).console[0].text).toBe('Other page');
    await other.close(); expect(diagnostics.read(other, metadata())).toMatchObject({ live: false, console: [], requests: [] });
    diagnostics.close(); await page.evaluate(() => console.log('After detach')); expect(diagnostics.read(page, metadata()).console).toEqual([]);
  });
});

describe('bounded diagnostic retention', () => {
  function fakePage() { return Object.assign(new EventEmitter(), { isClosed: () => false }) as unknown as Page; }
  const emit = (page: Page, text: string) => (page as unknown as EventEmitter).emit('console', { type: () => 'log', text: () => text, location: () => ({ url: 'http://local/fixture', lineNumber: 0, columnNumber: 2 }) });
  it('caps each tab, bounds text, reports evictions and returns independent snapshots', () => {
    const diagnostics = new BrowserDiagnostics(), page = fakePage(); diagnostics.attach(page);
    for (let index = 0; index < 200; index++) emit(page, String(index) + 'x'.repeat(20_000));
    const metadata = { tabId: 'one', url: 'http://local/fixture', title: 'Fixture' }, value = diagnostics.read(page, metadata);
    expect(value.console).toHaveLength(128); expect(value.droppedConsole).toBe(72); expect(value.console[0].text.length).toBeLessThan(4100);
    value.console[0].text = 'Changed copy'; expect(diagnostics.read(page, metadata).console[0].text).not.toBe('Changed copy');
    expect(browserDiagnosticsText(value).length).toBeLessThan(121_000); diagnostics.close();
  });
  it('bounds retained entries across all live pages and counts global evictions per tab', () => {
    const diagnostics = new BrowserDiagnostics(), pages = Array.from({ length: 10 }, fakePage);
    for (const page of pages) { diagnostics.attach(page); for (let index = 0; index < 128; index++) emit(page, 'Entry ' + index); }
    const values = pages.map((page, index) => diagnostics.read(page, { tabId: String(index), url: '', title: '' }));
    expect(values.reduce((sum, value) => sum + value.console.length, 0)).toBe(1000); expect(values.reduce((sum, value) => sum + value.droppedConsole, 0)).toBe(280);
    diagnostics.close();
  });
});
