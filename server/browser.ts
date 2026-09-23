import { chromium, type BrowserContext, type CDPSession, type Page } from 'playwright';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { lstat, realpath, rm } from 'node:fs/promises';
import { z } from 'zod';
import { defaultBrowserPreferences, type BrowserPreferences, type BrowserTab, type BrowserState, type BrowserFrame, type BrowserStopRequest, type BrowserSelection } from '../shared/browser.js';
import { BrowserSessions, type SavedBrowserSession } from './browser-state.js';
import { BrowserDownloads } from './browser-downloads.js';
import { BrowserStream } from './browser-stream.js';
import { BrowserHistory } from './browser-history.js';
import { BrowserInspector, browserInspectorSchema } from './browser-inspector.js';
import { BrowserDiagnostics } from './browser-diagnostics.js';
import { readBrowserSelection } from './browser-selection.js';
import { BrowserUploads, browserUploadSchema } from './browser-uploads.js';
import { BrowserFind } from './browser-find.js';
import { browserDiagnosticsText, type BrowserDiagnosticView } from '../shared/browser-diagnostics.js';

export const browserActionSchema = z.object({
  action: z.enum(['open', 'navigate', 'back', 'forward', 'reload', 'select', 'resume', 'close', 'snapshot', 'click', 'drag', 'type', 'key', 'scroll', 'resize', 'downloads', 'diagnostics', 'find']),
  findDirection: z.enum(['first', 'next', 'previous', 'clear']).optional(), matchCase: z.boolean().optional(),
  view: z.enum(['console', 'network', 'all']).optional(),
  tabId: z.string().max(64).optional(), url: z.string().max(8192).optional(), ref: z.string().regex(/^e\d{1,5}$/).optional(),
  text: z.string().max(12000).optional(), key: z.string().max(64).optional(),
  x: z.number().min(0).max(1280).optional(), y: z.number().min(0).max(1200).optional(), delta: z.number().min(-5000).max(5000).optional(),
  toX: z.number().min(0).max(1280).optional(), toY: z.number().min(0).max(1200).optional(), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  durationMs: z.number().int().min(100).max(2000).optional(), modifiers: z.array(z.enum(['Shift', 'Control', 'Alt', 'Meta'])).max(4).optional(),
  width: z.number().int().min(320).max(1280).optional(), height: z.number().int().min(240).max(1200).optional(),
}).strict().superRefine((input, context) => {
  if (input.action === 'find') {
    for (const field of ['tabId', 'url', 'text'] as const) if (input[field] === undefined) context.addIssue({ code: 'custom', path: [field], message: `Find requires ${field} from the current page.` });
    if ((input.text?.length ?? 0) > 200) context.addIssue({ code: 'custom', path: ['text'], message: 'Search for up to 200 characters.' });
  }
  if (input.action === 'drag') for (const field of ['tabId', 'revision', 'url', 'width', 'height', 'x', 'y', 'toX', 'toY'] as const) {
    if (input[field] === undefined) context.addIssue({ code: 'custom', path: [field], message: `Drag requires ${field} from the current browser view.` });
  }
});
export const browserStopSchema = z.object({ tabId: z.string().min(1).max(64), navigationId: z.string().uuid() }).strict();
export const browserSelectionSchema = z.object({ tabId: z.string().min(1).max(64), revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict();

type SessionBrowser = { id: string; tabs: Map<string, BrowserTab>; pages: Map<string, Page>; activeId: string | null; busy: boolean; revision: number; error?: string; width: number; height: number; writes: Promise<void>; saved: string; deleted: boolean };
export function browserUrl(raw: string): string {
  const value = raw.trim();
  if (!value) throw new Error('Enter a website address.');
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(value) ? `http://${value}` : `https://${value}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS address without embedded credentials.');
  return url.href;
}

/** One separate browser profile, with tabs owned by the task that opened them. */
export class SessionBrowsers {
  private context?: Promise<BrowserContext>;
  private sessions = new Map<string, Promise<SessionBrowser>>();
  private deleted = new Set<string>();
  private persistence: BrowserSessions;
  private closing = false;
  private resetting = false;
  private streams = new Map<Page, BrowserStream>();
  private inspector = new BrowserInspector();
  private uploads = new BrowserUploads();
  private finder = new BrowserFind();
  private diagnosticBuffers = new BrowserDiagnostics();
  private navigationSessions = new Map<Page, Promise<CDPSession>>();
  private pendingNavigations = new Map<Page, { stopped: boolean; stopping?: Promise<boolean>; release: () => void }>();
  private blockedOrigins = new Set<string>();
  readonly downloads: BrowserDownloads;
  readonly history: BrowserHistory;
  constructor(private directory: string, private options: { preferences?: () => BrowserPreferences | undefined } = {}) {
    this.persistence = new BrowserSessions(directory); this.downloads = new BrowserDownloads(directory, undefined, () => this.preferences());
    this.history = new BrowserHistory(directory, () => this.preferences().rememberHistory);
  }
  preferences(): BrowserPreferences { return { ...defaultBrowserPreferences, ...this.options.preferences?.() }; }
  blockOrigin(origin: string) { this.blockedOrigins.add(origin); }
  private async launch(): Promise<BrowserContext> {
    if (this.closing || this.resetting) throw new Error('The browser is shutting down or resetting.');
    if (!this.context) {
      this.context = (async () => {
        const options = { headless: true, viewport: { width: 1280, height: 800 }, acceptDownloads: true, serviceWorkers: 'block' as const };
        let context: BrowserContext;
        if (process.env.LITESPEED_DESKTOP_BUNDLE === '1') context = await chromium.launchPersistentContext(join(this.directory, 'browser-profile'), options);
        else {
          try { context = await chromium.launchPersistentContext(join(this.directory, 'browser-profile'), { ...options, channel: 'chrome' }); }
          catch { context = await chromium.launchPersistentContext(join(this.directory, 'browser-profile'), options); }
        }
        if (this.closing) { await context.close(); throw new Error('The browser is shutting down.'); }
        await context.route('**/*', async route => {
          const url = new URL(route.request().url());
          // The task browser must not drive its own privileged application UI.
          if (this.blockedOrigins.has(url.origin) || !['https:', 'http:', 'data:', 'blob:', 'about:'].includes(url.protocol)) return route.abort('blockedbyclient');
          return route.continue();
        });
        for (const page of context.pages()) await page.close();
        context.on('close', () => {
          this.context = undefined;
          for (const pending of this.sessions.values()) void pending.then(state => { state.pages.clear(); state.revision++; });
        });
        return context;
      })().catch(error => { this.context = undefined; throw new Error(`Could not start the browser. Install Google Chrome or run “npx playwright install chromium”. ${error instanceof Error ? error.message.split('\n')[0] : ''}`); });
    }
    return this.context;
  }
  private async session(id: string): Promise<SessionBrowser> {
    let pending = this.sessions.get(id);
    if (!pending) {
      pending = (async () => {
        const state: SessionBrowser = { id, tabs: new Map(), pages: new Map(), activeId: null, busy: false, revision: 0, width: 1280, height: 800, writes: Promise.resolve(), saved: '', deleted: this.deleted.has(id) };
        if (!state.deleted) try {
          const saved = await this.persistence.load(id);
          if (saved) { state.tabs = new Map(saved.tabs.map(tab => [tab.id, tab])); state.activeId = saved.activeId; state.width = saved.width; state.height = saved.height; state.saved = JSON.stringify(saved); }
        } catch (error) { state.error = error instanceof Error ? error.message : String(error); }
        return state;
      })();
      this.sessions.set(id, pending);
    }
    return pending;
  }
  private persist(state: SessionBrowser): Promise<void> {
    if (state.deleted) return state.writes;
    const value: SavedBrowserSession = { tabs: [...state.tabs.values()].map(tab => ({ id: tab.id, title: tab.title.slice(0, 500), url: this.savedUrl(tab.url) })), activeId: state.activeId, width: state.width, height: state.height };
    const signature = JSON.stringify(value);
    if (signature === state.saved) return state.writes;
    state.saved = signature;
    state.writes = state.writes.catch(() => {}).then(async () => {
      if (!state.deleted) await this.persistence.save(state.id, value);
      if (state.error === 'Browser tabs could not be saved. Your open pages are still available.') state.error = undefined;
    }).catch(() => {
      if (state.saved === signature) state.saved = '';
      state.error = 'Browser tabs could not be saved. Your open pages are still available.';
    });
    return state.writes;
  }
  private savedUrl(url: string): string {
    if (url === 'about:blank') return url;
    try { const value = browserUrl(url); return value.length <= 8192 ? value : 'about:blank'; } catch { return 'about:blank'; }
  }
  private ownPage(state: SessionBrowser, page: Page, id: string = randomUUID()): string {
    state.pages.set(id, page); state.activeId = id; state.revision++;
    if (!state.tabs.has(id)) state.tabs.set(id, { id, title: '', url: page.url() });
    this.diagnosticBuffers.attach(page);
    this.uploads.attach(page, id, () => { state.revision++; });
    void this.navigationConnection(state, page, id).catch(() => {});
    page.setDefaultTimeout(8000); page.setDefaultNavigationTimeout(20000);
    page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
    page.on('download', download => {
      state.revision++;
      void this.downloads.capture(state.id, id, download).catch(error => { state.error = error instanceof Error ? error.message : 'The download did not finish.'; }).finally(() => { state.revision++; });
    });
    page.on('popup', popup => {
      if (state.tabs.size >= 12 || state.deleted || this.closing) void popup.close().catch(() => {});
      else { this.ownPage(state, popup); void popup.setViewportSize({ width: state.width, height: state.height }).catch(() => {}); }
    });
    // An explicit Close action removes metadata. Unexpected page/browser exits
    // suspend the tab so a crash or server shutdown cannot erase the workspace.
    page.on('close', () => { void this.inspector.releasePage(page); void this.finder.releasePage(page); if (state.pages.get(id) === page) state.pages.delete(id); this.streams.delete(page); const connection = this.navigationSessions.get(page); this.navigationSessions.delete(page); void connection?.then(session => session.detach()).catch(() => {}); state.revision++; });
    page.on('framenavigated', frame => {
      void this.finder.releasePage(page);
      if (frame !== page.mainFrame() || !state.tabs.has(id)) return;
      void this.inspector.releasePage(page);
      state.tabs.set(id, { ...state.tabs.get(id)!, url: page.url() }); state.revision++; void this.persist(state);
      void this.history.visit(page.url()).catch(error => { state.error = error instanceof Error ? error.message : 'Browsing history is unavailable.'; });
    });
    void this.persist(state);
    return id;
  }
  private navigationConnection(state: SessionBrowser, page: Page, tabId: string): Promise<CDPSession> {
    let connection = this.navigationSessions.get(page);
    if (!connection) {
      connection = (async () => {
        const session = await page.context().newCDPSession(page);
        try {
          const { frameTree } = await session.send('Page.getFrameTree');
          const mainFrame = frameTree.frame.id;
          session.on('Page.frameStartedLoading', ({ frameId }) => {
            const tab = state.tabs.get(tabId);
            if (frameId !== mainFrame || !tab || state.pages.get(tabId) !== page) return;
            state.tabs.set(tabId, { ...tab, loading: true, navigationId: randomUUID() }); state.revision++;
          });
          session.on('Page.frameStoppedLoading', ({ frameId }) => {
            const tab = state.tabs.get(tabId);
            if (frameId !== mainFrame || !tab || state.pages.get(tabId) !== page) return;
            const { loading: _loading, navigationId: _navigationId, ...rest } = tab;
            state.tabs.set(tabId, rest); state.revision++;
          });
          await session.send('Page.enable'); return session;
        } catch (error) { await session.detach().catch(() => {}); throw error; }
      })();
      this.navigationSessions.set(page, connection);
    }
    return connection;
  }
  private async navigationState(state: SessionBrowser, page: Page, tabId: string): Promise<Pick<BrowserTab, 'canGoBack' | 'canGoForward'>> {
    const connection = this.navigationConnection(state, page, tabId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const history = await Promise.race([
        connection.then(session => session.send('Page.getNavigationHistory')),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Navigation state timed out.')), 2000); timer.unref(); }),
      ]);
      return { canGoBack: history.currentIndex > 0, canGoForward: history.currentIndex < history.entries.length - 1 };
    } catch {
      if (this.navigationSessions.get(page) === connection) this.navigationSessions.delete(page);
      void connection.then(session => session.detach()).catch(() => {});
      return {};
    } finally { clearTimeout(timer); }
  }
  async state(id: string): Promise<BrowserState> {
    const state = await this.session(id);
    await Promise.all([...state.pages].map(async ([tabId, page]) => {
      const [title, navigation] = await Promise.all([page.title().catch(() => state.tabs.get(tabId)?.title ?? ''), this.navigationState(state, page, tabId)]);
      if (state.tabs.has(tabId) && !state.deleted) state.tabs.set(tabId, { ...state.tabs.get(tabId)!, id: tabId, title, url: page.url(), ...navigation });
      await this.history.title(page.url(), title).catch(error => { state.error = error instanceof Error ? error.message : 'Browsing history is unavailable.'; });
    }));
    if (state.pages.size) await this.persist(state);
    const downloads = await this.downloads.list(id).catch(error => { state.error = error instanceof Error ? error.message : 'Downloads are unavailable.'; return []; });
    const upload = this.uploads.request(state.pages.get(state.activeId || ''));
    return { tabs: [...state.tabs.values()].map(({ canGoBack, canGoForward, loading, navigationId, ...tab }) => state.pages.has(tab.id) ? { ...tab, canGoBack, canGoForward, ...(loading ? { loading, navigationId } : {}) } : { ...tab, suspended: true }), activeId: state.activeId, busy: state.busy, width: state.width, height: state.height, revision: state.revision, downloads, upload, find: this.finder.state(state.pages.get(state.activeId || '')), preferences: this.preferences(), error: state.error || this.history.warning };
  }
  async upload(id: string, raw: unknown, signal?: AbortSignal): Promise<BrowserState> {
    const input = browserUploadSchema.parse(raw), state = await this.session(id), page = state.pages.get(input.tabId);
    const assertCurrent = () => {
      signal?.throwIfAborted();
      if (this.closing || this.resetting || state.deleted || !page || page.isClosed() || state.pages.get(input.tabId) !== page || state.activeId !== input.tabId) throw Object.assign(new Error('Select the original live browser tab before sharing files.'), { status: 409 });
    };
    assertCurrent(); if (state.busy) throw Object.assign(new Error('Wait for the browser’s current action to finish.'), { status: 409 }); state.busy = true;
    try { await this.uploads.apply(page!, input, assertCurrent); }
    finally { state.busy = false; }
    return this.state(id);
  }
  async stopLoading(id: string, input: BrowserStopRequest): Promise<BrowserState> {
    browserStopSchema.parse(input);
    const state = await this.session(id), page = state.pages.get(input.tabId);
    const conflict = () => Object.assign(new Error('This page has changed or finished loading. Its current navigation was left alone.'), { status: 409 });
    const matches = () => !this.closing && !this.resetting && !state.deleted && state.activeId === input.tabId && state.pages.get(input.tabId) === page && state.tabs.get(input.tabId)?.loading && state.tabs.get(input.tabId)?.navigationId === input.navigationId;
    if (!page || page.isClosed() || !matches()) throw conflict();
    let finish!: (stopped: boolean) => void;
    const completion = new Promise<boolean>(resolve => { finish = resolve; }), pending = this.pendingNavigations.get(page);
    if (pending) pending.stopping = completion;
    let stopped = false;
    try {
      // A document swap can leave the previous renderer briefly inactive.
      // Attach to the current page and retry only that transition, rechecking
      // the reviewed navigation before every command.
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!matches()) throw conflict();
        const control = await page.context().newCDPSession(page);
        try {
          if (!matches()) throw conflict();
          await control.send('Page.stopLoading'); stopped = true; if (pending) { pending.stopped = true; pending.release(); } break;
        } catch (error) {
          if (attempt >= 2 || !/Not attached to an active page/.test(String(error))) throw error;
          await new Promise(resolve => setTimeout(resolve, 25));
        } finally { await control.detach().catch(() => {}); }
      }
    } catch (error) {
      if ((error as { status?: number }).status === 409) throw error;
      throw Object.assign(new Error('This page could not be stopped while it was changing. Try again.'), { status: 409 });
    } finally { finish(stopped); }
    const tab = state.tabs.get(input.tabId);
    if (tab?.navigationId === input.navigationId) { const { loading: _loading, navigationId: _id, ...rest } = tab; state.tabs.set(input.tabId, rest); state.revision++; }
    return this.state(id);
  }
  async frame(id: string, tabId?: string): Promise<Buffer | null> {
    const state = await this.session(id), page = state.pages.get(tabId ?? state.activeId ?? '');
    if (!page || page.isClosed()) return null;
    return page.screenshot({ type: 'jpeg', quality: 78, timeout: 5000 });
  }
  async diagnostics(id: string, tabId?: string) {
    const state = await this.session(id), target = tabId ?? state.activeId ?? '', tab = state.tabs.get(target);
    if (!tab || state.deleted) throw Object.assign(new Error('Open a browser tab in this task to inspect its activity.'), { status: 409 });
    return this.diagnosticBuffers.read(state.pages.get(target), { tabId: target, url: tab.url, title: tab.title });
  }
  async selection(id: string, raw: unknown, signal?: AbortSignal): Promise<BrowserSelection> {
    const input = browserSelectionSchema.parse(raw), state = await this.session(id), page = state.pages.get(input.tabId);
    const conflict = () => Object.assign(new Error('The browser view changed. Select text in the current page and try again.'), { status: 409 });
    const assertCurrent = () => {
      signal?.throwIfAborted();
      if (this.closing || this.resetting || state.deleted || !page || page.isClosed() || state.pages.get(input.tabId) !== page || state.activeId !== input.tabId || state.revision !== input.revision) throw conflict();
    };
    assertCurrent(); if (state.busy) throw conflict(); state.busy = true;
    let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
    try {
      return await Promise.race([
        (async () => { const selected = await readBrowserSelection(page!), title = (await page!.title()).slice(0, 500); assertCurrent(); return { ...input, ...selected, url: page!.url(), title, capturedAt: Date.now() }; })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('The page did not return its selection. Try again when it responds.')), 5000); timer.unref();
          abort = () => reject(signal?.reason ?? new Error('Selection canceled.')); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
        }),
      ]);
    } finally { clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort); state.busy = false; }
  }
  async clearDiagnostics(id: string, tabId: string, view: BrowserDiagnosticView) {
    const state = await this.session(id), page = state.pages.get(tabId);
    if (!state.tabs.has(tabId) || state.deleted) throw Object.assign(new Error('This browser tab is no longer available.'), { status: 409 });
    if (page) this.diagnosticBuffers.clear(page, view);
    return this.diagnostics(id, tabId);
  }
  async stream(id: string, tabId: string, frame: (frame: BrowserFrame) => void, end: () => void): Promise<(() => void) | null> {
    const state = await this.session(id), page = state.pages.get(tabId);
    if (this.closing || state.deleted || !page || page.isClosed()) return null;
    let stream = this.streams.get(page);
    if (stream?.closed) { await stream.close(); stream = this.streams.get(page); }
    if (this.closing || state.deleted || page.isClosed()) return null;
    if (!stream || stream.closed) {
      stream = new BrowserStream(page, () => ({ tabId, title: state.tabs.get(tabId)?.title || '' }));
      this.streams.set(page, stream);
    }
    return stream.subscribe(frame, end);
  }
  private async navigation(page: Page, operation: () => Promise<unknown>) {
    let release!: () => void;
    const stopped = new Promise<void>(resolve => { release = resolve; });
    const pending: { stopped: boolean; stopping?: Promise<boolean>; release: () => void } = { stopped: false, release }; this.pendingNavigations.set(page, pending);
    let downloaded = false;
    const observed = () => { downloaded = true; };
    page.on('download', observed);
    try { await Promise.race([operation(), stopped]); }
    catch (error) {
      if (pending.stopped || pending.stopping && await pending.stopping) return;
      if (!/Download is starting|net::ERR_ABORTED/.test(String(error))) throw error;
      // Chromium may reject goto before it emits the Download event. Only
      // suppress that navigation error after the same page confirms a transfer.
      if (!downloaded) await page.waitForEvent('download', { timeout: 2000 }).catch(() => { throw error; });
    } finally { page.removeListener('download', observed); if (this.pendingNavigations.get(page) === pending) this.pendingNavigations.delete(page); }
  }
  async inspect(id: string, raw: unknown, signal?: AbortSignal) {
    const input = browserInspectorSchema.parse(raw), state = await this.session(id);
    const conflict = (message: string) => Object.assign(new Error(message), { status: 409 });
    if (this.closing || this.resetting || state.deleted) throw conflict('This task browser is closed or resetting.');
    if (state.busy) throw conflict('Wait for the browser’s current action to finish.');
    const page = state.pages.get(input.tabId);
    if (!page || page.isClosed() || state.activeId !== input.tabId) throw conflict('Select the original live browser tab before adjusting this comment.');
    signal?.throwIfAborted(); state.busy = true;
    try { return await this.inspector.execute(id, page, input, signal); }
    catch (error) { if (signal?.aborted || (error as { status?: number }).status === 409) throw error; throw conflict('The page could not be captured. Try selecting it again or reload the page.'); }
    finally { state.busy = false; }
  }
  async execute(id: string, raw: unknown, signal?: AbortSignal): Promise<{ state: BrowserState; snapshot: string; image?: Buffer }> {
    const input = browserActionSchema.parse(raw), state = await this.session(id);
    if (this.closing || this.resetting || state.deleted) throw new Error('This task browser is closed or resetting.');
    if (state.busy) throw new Error('The browser is performing another action. Wait for it to finish.');
    signal?.throwIfAborted(); state.busy = true; state.error = undefined;
    let page: Page | undefined;
    const abort = () => { if (page && !page.isClosed()) void page.close().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (input.action === 'downloads') return { state: { ...await this.state(id), busy: false }, snapshot: await this.describeDownloads(id) };
      if (input.action === 'diagnostics') return { state: { ...await this.state(id), busy: false }, snapshot: browserDiagnosticsText(await this.diagnostics(id, input.tabId), input.view) };
      if (input.action === 'find') {
        const target = state.pages.get(input.tabId!);
        const guard = () => { signal?.throwIfAborted(); if (!target || target.isClosed() || state.deleted || this.closing || this.resetting || state.activeId !== input.tabId || state.pages.get(input.tabId!) !== target || target.url() !== input.url) throw Object.assign(new Error('The browser page changed. Select the live tab and search again.'), { status: 409 }); };
        guard();
        try {
          const found = await this.finder.search(target!, input.tabId!, input.text!, input.matchCase ?? false, input.findDirection ?? 'first', guard); state.revision++;
          const snapshot = await this.snapshot(target!), image = await this.frame(id).catch(() => null); guard();
          if (found && this.finder.state(target) !== found) throw Object.assign(new Error('The page changed while searching. Try again.'), { status: 409 });
          return { state: { ...await this.state(id), busy: false }, snapshot: `${found ? `Find in page: ${found.active + 1} of ${found.total}${found.truncated ? '+' : ''} matches.\n\n` : ''}${snapshot}`, ...(image ? { image } : {}) };
        } catch (error) { if (signal?.aborted && target) await this.finder.releasePage(target); throw error; }
      }
      const previousActive = state.activeId, requested = input.tabId ?? state.activeId;
      if (input.tabId && !state.tabs.has(input.tabId)) throw new Error('Open a browser tab in this task first.');
      const guardedPointer = input.action === 'drag' || input.action === 'click' && input.revision !== undefined;
      const assertPointer = () => {
        signal?.throwIfAborted();
        const target = state.pages.get(input.tabId || '');
        if (this.closing || this.resetting || state.deleted || !target || target.isClosed() || state.activeId !== input.tabId || state.revision !== input.revision || state.width !== input.width || state.height !== input.height || target.url() !== input.url) {
          throw Object.assign(new Error('The browser view changed. Wait for the current page, then try the gesture again.'), { status: 409 });
        }
        if ([input.x, input.toX ?? input.x].some(value => value === undefined || value >= state.width) || [input.y, input.toY ?? input.y].some(value => value === undefined || value >= state.height)) throw new Error('Pointer coordinates must be inside the current browser viewport.');
      };
      // A stale gesture must never select another tab before it is rejected.
      if (guardedPointer) assertPointer();
      const destination = input.action === 'navigate' || input.action === 'open' && input.url ? browserUrl(input.url ?? '') : undefined;
      if (input.action === 'open' || input.action === 'navigate' && !requested) {
        if (state.tabs.size >= 12) throw new Error('Close a browser tab before opening another.');
        const context = await this.launch(); signal?.throwIfAborted();
        page = await context.newPage(); const tabId = this.ownPage(state, page); state.activeId = tabId;
        await this.navigationConnection(state, page, tabId);
        await page.setViewportSize({ width: state.width, height: state.height });
      } else {
        if (!requested) throw new Error('Open a browser tab in this task first.');
        state.activeId = requested;
        page = state.pages.get(requested);
        if (!page && ['resume', 'navigate'].includes(input.action)) {
          const savedUrl = state.tabs.get(requested)!.url;
          const context = await this.launch(); signal?.throwIfAborted();
          page = await context.newPage(); this.ownPage(state, page, requested);
          await this.navigationConnection(state, page, requested);
          await page.setViewportSize({ width: state.width, height: state.height });
          if (input.action === 'resume') {
            if (savedUrl !== 'about:blank') await this.navigation(page, () => page!.goto(browserUrl(savedUrl), { waitUntil: 'domcontentloaded' }));
          }
        }
      }
      signal?.throwIfAborted();
      if (!page && !['close', 'select', 'snapshot', 'resize'].includes(input.action)) throw new Error('This tab is saved. Reopen it with the resume action and inspect the new snapshot before interacting.');
      switch (input.action) {
        case 'open': case 'navigate': if (destination) await this.navigation(page!, () => page!.goto(destination, { waitUntil: 'domcontentloaded' })); break;
        case 'back': await this.navigation(page!, () => page!.goBack({ waitUntil: 'domcontentloaded' })); break;
        case 'forward': await this.navigation(page!, () => page!.goForward({ waitUntil: 'domcontentloaded' })); break;
        case 'reload': await this.navigation(page!, () => page!.reload({ waitUntil: 'domcontentloaded' })); break;
        case 'close': {
          const tabId = state.activeId!; state.tabs.delete(tabId); state.pages.delete(tabId); state.activeId = previousActive && state.tabs.has(previousActive) ? previousActive : [...state.tabs.keys()].at(-1) ?? null;
          if (page) await page.close(); break;
        }
        case 'click':
          if (input.ref) await page!.locator(`[data-litespeed-ref="${input.ref}"]`).click();
          else if (input.x !== undefined && input.y !== undefined) {
            if (input.x >= state.width || input.y >= state.height) throw new Error('Click coordinates must be inside the current browser viewport.');
            await page!.mouse.click(input.x, input.y);
          }
          else throw new Error('Specify an element ref from the latest snapshot or x and y.');
          break;
        case 'drag': {
          const held: string[] = [];
          let mouseHeld = false;
          try {
            assertPointer();
            for (const modifier of new Set(input.modifiers || [])) { held.push(modifier); await page!.keyboard.down(modifier); assertPointer(); }
            await page!.mouse.move(input.x!, input.y!); assertPointer();
            mouseHeld = true; await page!.mouse.down();
            const duration = input.durationMs ?? 350, steps = Math.max(8, Math.min(40, Math.ceil(duration / 25))), start = performance.now();
            for (let step = 1; step <= steps; step++) {
              assertPointer();
              await page!.mouse.move(input.x! + (input.toX! - input.x!) * step / steps, input.y! + (input.toY! - input.y!) * step / steps);
              const remaining = start + duration * step / steps - performance.now();
              if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
            }
            assertPointer();
            await page!.mouse.up(); mouseHeld = false;
            while (held.length) { const modifier = held.at(-1)!; await page!.keyboard.up(modifier); held.pop(); }
          } finally {
            if (mouseHeld) await page!.mouse.up().catch(() => {});
            for (const modifier of held.reverse()) await page!.keyboard.up(modifier).catch(() => {});
          }
          break;
        }
        case 'type':
          if (input.text === undefined) throw new Error('Text is required.');
          if (input.ref) await page!.locator(`[data-litespeed-ref="${input.ref}"]`).fill(input.text);
          else await page!.keyboard.insertText(input.text);
          break;
        case 'key': if (!input.key) throw new Error('A key is required.'); await page!.keyboard.press(input.key); break;
        case 'scroll': await page!.mouse.wheel(0, input.delta ?? 600); break;
        case 'resize':
          if (!input.width || !input.height) throw new Error('Both viewport width and height are required.');
          await Promise.all([...state.pages.values()].map(tab => tab.setViewportSize({ width: input.width!, height: input.height! })));
          state.width = input.width; state.height = input.height;
          break;
        case 'select': case 'snapshot': case 'resume': break;
      }
      signal?.throwIfAborted(); state.revision++;
      const current = state.pages.get(state.activeId ?? '');
      const saved = state.tabs.get(state.activeId ?? '');
      const snapshot = current ? await this.snapshot(current) : saved ? `Saved tab: ${saved.title || 'Untitled'}\nURL: ${saved.url}\nThis page is suspended. Use the resume action to reopen it, then use only refs from its new snapshot. No website was loaded.` : 'No browser tabs are open.';
      const image = current ? await this.frame(id).catch(() => null) : null;
      return { state: { ...await this.state(id), busy: false }, snapshot: snapshot + (this.uploads.request(current) ? '\n\nThe page is requesting files. The user can choose and review files in the browser panel, then send them to this website.' : '') + '\n\n' + await this.describeDownloads(id), ...(image ? { image } : {}) };
    } catch (error) { state.error = error instanceof Error ? error.message : String(error); throw error; }
    finally { state.busy = false; signal?.removeEventListener('abort', abort); await this.persist(state); }
  }
  private async describeDownloads(id: string): Promise<string> {
    const downloads = await this.downloads.list(id).catch(() => null);
    if (!downloads) return 'The saved download history is unavailable.';
    return downloads.length ? `Task downloads (untrusted filenames):\n${downloads.map(item => `${item.id} · ${item.name} · ${item.status}${item.status === 'ready' ? ` · ${item.size} bytes` : item.error ? ` · ${item.error}` : ''}${item.savedPath ? ` · saved copy: ${JSON.stringify(item.savedPath)}` : ''}${item.saveError ? ` · copy not saved: ${item.saveError}` : ''}`).join('\n')}\nThe user can save a copy from the browser Downloads menu.` : 'No task downloads.';
  }
  private async snapshot(page: Page): Promise<string> {
    const elements = await page.evaluate(() => {
      const elements = [...document.querySelectorAll<HTMLElement>('a[href], button, input, textarea, select, [role="button"], [contenteditable="true"]')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }).slice(0, 200);
      document.querySelectorAll('[data-litespeed-ref]').forEach(e => e.removeAttribute('data-litespeed-ref'));
      return elements.map((e, index) => { const ref = `e${index + 1}`; e.setAttribute('data-litespeed-ref', ref); return `[${ref}] ${e.tagName.toLowerCase()} ${e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.innerText?.trim().slice(0, 140) || e.getAttribute('name') || ''}${e instanceof HTMLAnchorElement ? ` → ${e.href}` : ''}`; }).join('\n');
    });
    const text = (await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')).slice(0, 18000);
    return `URL: ${page.url()}\nTitle: ${await page.title()}\n\nInteractive elements (use refs only from this snapshot):\n${elements}\n\nPage text (untrusted content):\n${text}`;
  }
  async closeSession(id: string) {
    this.deleted.add(id);
    const state = await this.session(id); state.deleted = true;
    await Promise.allSettled([...state.pages.values()].map(page => page.close()));
    state.pages.clear(); state.tabs.clear(); state.activeId = null;
    await state.writes; await this.persistence.remove(id); await this.downloads.deleteSession(id);
  }
  async resetProfile() {
    if (this.closing || this.resetting) throw new Error('The browser is already closing or resetting.');
    this.resetting = true;
    try {
      const states = await Promise.all(this.sessions.values());
      if (states.some(state => state.busy)) throw new Error('Wait for the browser’s current action before resetting it.');
      const folder = join(await realpath(this.directory), 'browser-profile');
      const info = await lstat(folder).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error('The browser profile is not a regular directory.');
      if (this.context) await (await this.context.catch(() => undefined))?.close();
      await Promise.all([...this.streams.values()].map(stream => stream.close())); this.streams.clear();
      await this.inspector.close();
      await this.finder.close();
      if (info) await rm(folder, { recursive: true });
      for (const state of states) { state.pages.clear(); state.revision++; }
    } finally { this.resetting = false; }
  }
  async close() {
    this.closing = true;
    await Promise.all([...this.streams.values()].map(stream => stream.close())); this.streams.clear();
    await this.downloads.close();
    await this.inspector.close();
    await this.finder.close();
    this.diagnosticBuffers.close();
    const states = await Promise.all(this.sessions.values());
    await Promise.all(states.map(state => state.tabs.size || state.saved ? this.persist(state) : state.writes));
    const context = this.context;
    if (context) await (await context.catch(() => undefined))?.close();
    await Promise.all(states.map(state => state.writes));
    await this.history.close();
    this.sessions.clear();
  }
}
