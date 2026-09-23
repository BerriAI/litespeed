import { randomUUID } from 'node:crypto';
import type { FileChooser, Page } from 'playwright';
import { z } from 'zod';
import { browserUploadLimit, type BrowserUploadRequest } from '../shared/browser.js';

const identity = { requestId: z.string().uuid(), tabId: z.string().min(1).max(64) };
export const browserUploadSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cancel'), ...identity }).strict(),
  z.object({ action: z.literal('upload'), ...identity, files: z.array(z.object({
    name: z.string().min(1).max(255).refine(name => !/[\x00-\x1f\x7f/\\]/.test(name) && name !== '.' && name !== '..', 'Use a filename without folders.'),
    mimeType: z.string().max(127).regex(/^[\x20-\x7e]*$/),
    data: z.string().max(Math.ceil(browserUploadLimit / 3) * 4).refine(data => data.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(data), 'Use base64 file data.'),
  }).strict()).min(1).max(10) }).strict(),
]);
type Pending = { chooser: FileChooser; info: BrowserUploadRequest; ready: boolean; changed: () => void };
const conflict = () => Object.assign(new Error('This file request changed or expired. Choose files from the current page again.'), { status: 409 });

/** Only user-supplied bytes reach the exact input that opened a live chooser.
 * No local pathname is accepted and file contents are never persisted. */
export class BrowserUploads {
  private pending = new Map<Page, Pending>();
  attach(page: Page, tabId: string, changed: () => void) {
    page.on('filechooser', chooser => {
      this.clear(page);
      const pending: Pending = { chooser, changed, ready: false, info: { id: randomUUID(), tabId, url: '', pageUrl: page.url(), multiple: chooser.isMultiple(), accept: '', directory: false, createdAt: Date.now() } };
      this.pending.set(page, pending);
      void (async () => {
        const element = chooser.element(), frame = await element.ownerFrame();
        const attributes = await element.evaluate(input => input instanceof HTMLInputElement ? { accept: (input.getAttribute('accept') || '').slice(0, 500), directory: input.hasAttribute('webkitdirectory'), valid: input.isConnected && input.type === 'file' && !input.matches(':disabled') } : { accept: '', directory: false, valid: false });
        if (this.pending.get(page) !== pending) return;
        if (!frame || !attributes.valid || page.isClosed() || page.url() !== pending.info.pageUrl) { this.clear(page, pending); return; }
        pending.info = { ...pending.info, url: frame.url(), accept: attributes.accept, directory: attributes.directory }; pending.ready = true; changed();
      })().catch(() => this.clear(page, pending));
    });
    // Invalidate even an iframe navigation: an upload belongs to the document
    // whose chooser the user saw, not a later page at the same URL.
    page.on('framenavigated', () => this.clear(page));
    page.on('close', () => this.clear(page));
  }
  private clear(page: Page, expected?: Pending, dispose = true) {
    const pending = this.pending.get(page);
    if (!pending || expected && pending !== expected) return;
    this.pending.delete(page); pending.changed();
    if (dispose) void pending.chooser.element().dispose().catch(() => {});
  }
  request(page: Page | undefined): BrowserUploadRequest | undefined {
    if (!page) return;
    const pending = this.pending.get(page);
    if (pending && (page.isClosed() || Date.now() - pending.info.createdAt > 10 * 60_000)) { this.clear(page, pending); return; }
    return pending?.ready ? { ...pending.info } : undefined;
  }
  async apply(page: Page, raw: unknown, assertCurrent: () => void) {
    const input = browserUploadSchema.parse(raw), pending = this.pending.get(page);
    assertCurrent();
    if (!pending || this.request(page)?.id !== input.requestId || pending.info.tabId !== input.tabId) throw conflict();
    if (input.action === 'cancel') { this.clear(page, pending); return; }
    if (pending.info.directory) throw Object.assign(new Error('This website requested a folder. Folder uploads are not supported in this browser yet.'), { status: 400 });
    if (!pending.info.multiple && input.files.length !== 1) throw Object.assign(new Error('This page accepts one file at a time.'), { status: 400 });
    const bytes = input.files.reduce((sum, file) => sum + Buffer.byteLength(file.data, 'base64'), 0);
    if (bytes > browserUploadLimit) throw Object.assign(new Error('Choose files totaling 8 MB or less.'), { status: 413 });
    const valid = await pending.chooser.element().evaluate((element, expected) => element.isConnected && element instanceof HTMLInputElement && element.type === 'file' && !element.matches(':disabled') && element.multiple === expected.multiple && element.hasAttribute('webkitdirectory') === expected.directory && (element.getAttribute('accept') || '').slice(0, 500) === expected.accept, pending.info).catch(() => false);
    assertCurrent();
    if (!valid || this.pending.get(page) !== pending || page.url() !== pending.info.pageUrl) { this.clear(page, pending); throw conflict(); }
    const files = input.files.map(file => ({ name: file.name, mimeType: file.mimeType || 'application/octet-stream', buffer: Buffer.from(file.data, 'base64') }));
    // Consume the request before change handlers can navigate or open a new
    // chooser. A retry must never deliver the same files twice.
    this.clear(page, pending, false);
    try { await pending.chooser.setFiles(files, { timeout: 8000 }); }
    catch { throw Object.assign(new Error('The file selection did not finish. Check the page before choosing files again; it may already have received them.'), { status: 409 }); }
    finally { await pending.chooser.element().dispose().catch(() => {}); }
  }
}
