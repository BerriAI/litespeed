import { randomUUID } from 'node:crypto';
import type { ConsoleMessage, Page, Request, Response } from 'playwright';
import type { BrowserConsoleEntry, BrowserNetworkEntry, BrowserDiagnosticView, BrowserDiagnosticsState } from '../shared/browser-diagnostics.js';

type PageLog = { console: BrowserConsoleEntry[]; requests: BrowserNetworkEntry[]; droppedConsole: number; droppedRequests: number; detach: () => void };
type Row = { page: Page; kind: 'console' | 'requests' };
const clipped = (text: string, maximum = 4000) => text.length > maximum ? text.slice(0, maximum) + '… [shortened]' : text;

/** Live, bounded diagnostic buffers. No request headers, bodies or browser
 * storage are read, and buffers are never written to disk. */
export class BrowserDiagnostics {
  private pages = new Map<Page, PageLog>();
  private rows = new Map<string, Row>();
  private requests = new WeakMap<Request, string>();
  private remove(id: string, dropped = false) {
    const row = this.rows.get(id); if (!row) return;
    const log = this.pages.get(row.page);
    if (log) {
      if (row.kind === 'console') { log.console = log.console.filter(entry => entry.id !== id); if (dropped) log.droppedConsole++; }
      else { log.requests = log.requests.filter(entry => entry.id !== id); if (dropped) log.droppedRequests++; }
    }
    this.rows.delete(id);
  }
  private add(page: Page, kind: Row['kind'], entry: BrowserConsoleEntry | BrowserNetworkEntry) {
    const log = this.pages.get(page); if (!log) return;
    if (kind === 'console') log.console.push(entry as BrowserConsoleEntry); else log.requests.push(entry as BrowserNetworkEntry);
    this.rows.set(entry.id, { page, kind });
    while (log[kind].length > 128) this.remove(log[kind][0].id, true);
    while (this.rows.size > 1000) this.remove(this.rows.keys().next().value!, true);
  }
  attach(page: Page) {
    if (this.pages.has(page)) return;
    const log: PageLog = { console: [], requests: [], droppedConsole: 0, droppedRequests: 0, detach: () => {} }; this.pages.set(page, log);
    const console = (message: ConsoleMessage) => {
      const location = message.location(), raw = message.type();
      const level = raw === 'warning' ? 'warning' : raw === 'error' || raw === 'assert' ? 'error' : raw === 'info' ? 'info' : raw === 'debug' ? 'debug' : 'log';
      this.add(page, 'console', { id: randomUUID(), time: Date.now(), level, text: raw === 'clear' ? 'Console cleared by page' : clipped(message.text()), ...(location.url ? { source: clipped(location.url, 2048), line: location.lineNumber + 1, column: location.columnNumber + 1 } : {}) });
    };
    const error = (error: Error) => this.add(page, 'console', { id: randomUUID(), time: Date.now(), level: 'error', text: clipped(error.stack || error.message) });
    const request = (request: Request) => {
      const id = randomUUID(); this.requests.set(request, id);
      this.add(page, 'requests', { id, time: Date.now(), method: clipped(request.method(), 20), url: clipped(request.url()), resource: clipped(request.resourceType(), 30), state: 'pending' });
    };
    const find = (request: Request) => { const id = this.requests.get(request); return id && this.rows.get(id)?.page === page ? this.pages.get(page)?.requests.find(entry => entry.id === id) : undefined; };
    const response = (response: Response) => { const entry = find(response.request()); if (entry) entry.status = response.status(); };
    const finished = (request: Request, failed = false) => {
      const entry = find(request); if (!entry) return;
      const duration = request.timing().responseEnd;
      entry.state = failed ? 'failed' : 'complete'; entry.duration = Math.max(0, Math.round(duration >= 0 ? duration : Date.now() - entry.time));
      if (failed) entry.error = clipped(request.failure()?.errorText || 'The request did not finish.', 500);
    };
    const failed = (request: Request) => finished(request, true);
    const closed = () => this.detach(page);
    page.on('console', console); page.on('pageerror', error); page.on('request', request); page.on('response', response); page.on('requestfinished', finished); page.on('requestfailed', failed); page.on('close', closed);
    log.detach = () => { page.off('console', console); page.off('pageerror', error); page.off('request', request); page.off('response', response); page.off('requestfinished', finished); page.off('requestfailed', failed); page.off('close', closed); };
  }
  read(page: Page | undefined, metadata: Pick<BrowserDiagnosticsState, 'tabId' | 'url' | 'title'>): BrowserDiagnosticsState {
    const log = page && this.pages.get(page);
    return { ...metadata, live: Boolean(page && !page.isClosed()), capturedAt: Date.now(), console: log?.console.map(entry => ({ ...entry })) ?? [], requests: log?.requests.map(entry => ({ ...entry })) ?? [], droppedConsole: log?.droppedConsole ?? 0, droppedRequests: log?.droppedRequests ?? 0 };
  }
  clear(page: Page, view: BrowserDiagnosticView) {
    const log = this.pages.get(page); if (!log) return;
    if (view !== 'network') { for (const entry of [...log.console]) this.remove(entry.id); log.droppedConsole = 0; }
    if (view !== 'console') { for (const entry of [...log.requests]) this.remove(entry.id); log.droppedRequests = 0; }
  }
  detach(page: Page) {
    const log = this.pages.get(page); if (!log) return;
    log.detach(); this.clear(page, 'all'); this.pages.delete(page);
  }
  close() { for (const page of [...this.pages.keys()]) this.detach(page); }
}
