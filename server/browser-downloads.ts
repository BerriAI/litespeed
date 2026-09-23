import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { saveDownloadCopy, validateDownloadDirectory } from './download-destination.js';
import type { BrowserPreferences } from '../shared/browser.js';
import type { BrowserDownload } from '../shared/browser.js';

export interface BrowserDownloadSource {
  suggestedFilename(): string;
  url(): string;
  createReadStream(): Promise<Readable | null>;
  cancel(): Promise<void>;
  delete(): Promise<void>;
}
const entrySchema = z.object({
  id: z.string().uuid(), tabId: z.string().uuid(), name: z.string().min(1).max(180),
  url: z.string().max(8192), createdAt: z.number().int().nonnegative(),
  status: z.enum(['receiving', 'ready', 'failed']), size: z.number().int().nonnegative(), error: z.string().max(500).optional(), savedPath: z.string().max(4096).optional(), savedAt: z.number().int().nonnegative().optional(), saveError: z.string().max(500).optional(),
}).strict();
const indexSchema = z.object({ version: z.literal(1), downloads: z.array(entrySchema).max(25) }).strict()
  .refine(value => new Set(value.downloads.map(item => item.id)).size === value.downloads.length);
const limits = { maxBytes: 50 * 1024 * 1024, totalBytes: 250 * 1024 * 1024, count: 25, timeoutMs: 120_000 };
type DownloadState = { items: BrowserDownload[]; writes: Promise<void>; deleted: boolean };
type Active = { taskId: string; id: string; source: BrowserDownloadSource; controller: AbortController; promise: Promise<void> };

export function downloadFilename(raw: string): string {
  const leaf = raw.replace(/\\/g, '/').split('/').at(-1) || '';
  const name = leaf.replace(/[\x00-\x1f\x7f<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/g, '_').replace(/^\.+|[. ]+$/g, '').trim().slice(0, 180);
  return name && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? name : 'download';
}
function sourceUrl(raw: string): string {
  try { const url = new URL(raw); url.username = ''; url.password = ''; return ['http:', 'https:', 'blob:'].includes(url.protocol) ? url.href.slice(0, 8192) : ''; }
  catch { return ''; }
}

/** Browser downloads are task-owned data, never executable previews. The user
 * saves a copy explicitly, or enables automatic copying in Browser settings. */
export class BrowserDownloads {
  private sessions = new Map<string, Promise<DownloadState>>();
  private active = new Set<Active>();
  private closing = false;
  private saving = new Map<string, Promise<BrowserDownload>>();
  constructor(private directory: string, private options = limits, private preferences: () => BrowserPreferences | undefined = () => undefined) {}
  private async folder(taskId: string, create = false) {
    const root = join(await realpath(this.directory), 'browser-downloads');
    const folder = join(root, createHash('sha256').update(taskId).digest('hex'));
    for (const path of [root, folder]) {
      if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('The browser downloads directory is unavailable.');
    }
    return folder;
  }
  private session(taskId: string): Promise<DownloadState> {
    let pending = this.sessions.get(taskId);
    if (!pending) {
      pending = (async () => {
        let items: BrowserDownload[] = [];
        try {
          const handle = await open(join(await this.folder(taskId), 'index.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          try {
            const info = await handle.stat();
            if (!info.isFile() || info.nlink !== 1 || info.size > 256 * 1024) throw new Error('Invalid download history.');
            const data = Buffer.alloc(256 * 1024 + 1); let length = 0;
            while (length < data.length) { const result = await handle.read(data, length, data.length - length, null); if (!result.bytesRead) break; length += result.bytesRead; }
            if (length > 256 * 1024) throw new Error('Invalid download history.');
            items = indexSchema.parse(JSON.parse(data.subarray(0, length).toString('utf8'))).downloads.map(item => item.status === 'receiving' ? { ...item, status: 'failed', size: 0, error: 'Interrupted when Litespeed closed. Download this file again.' } : item);
          } finally { await handle.close(); }
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('The saved downloads could not be read.'); }
        return { items, writes: Promise.resolve(), deleted: false };
      })();
      this.sessions.set(taskId, pending);
    }
    return pending;
  }
  private async persist(taskId: string, state: DownloadState) {
    const value = JSON.stringify(indexSchema.parse({ version: 1, downloads: state.items }));
    const pending = state.writes.catch(() => {}).then(async () => {
      if (state.deleted) return;
      const folder = await this.folder(taskId, true), temporary = join(folder, randomUUID() + '.tmp');
      try { await writeFile(temporary, value, { mode: 0o600, flag: 'wx' }); await rename(temporary, join(folder, 'index.json')); }
      finally { await rm(temporary, { force: true }); }
    });
    state.writes = pending;
    await pending;
  }
  async list(taskId: string): Promise<BrowserDownload[]> { return (await this.session(taskId)).items.map(item => ({ ...item })); }
  capture(taskId: string, tabId: string, source: BrowserDownloadSource): Promise<void> {
    const active: Active = { taskId, id: randomUUID(), source, controller: new AbortController(), promise: Promise.resolve() };
    this.active.add(active);
    active.promise = this.receive(active, tabId).finally(() => this.active.delete(active));
    return active.promise;
  }
  private async receive(active: Active, tabId: string) {
    const { taskId, id, source, controller } = active;
    let state: DownloadState | undefined, item: BrowserDownload | undefined, temporary: string | undefined;
    const cancel = () => { controller.abort(); void source.cancel().catch(() => {}); };
    const timer = setTimeout(cancel, this.options.timeoutMs);
    try {
      if (this.closing) throw new Error('The browser is closing.');
      state = await this.session(taskId); controller.signal.throwIfAborted();
      if (state.deleted) throw new Error('This task was deleted.');
      const folder = await this.folder(taskId, true); controller.signal.throwIfAborted();
      if (state.items.length >= this.options.count) throw new Error('Remove a previous download before downloading another file.');
      item = { id, tabId, name: downloadFilename(source.suggestedFilename()), url: sourceUrl(source.url()), createdAt: Date.now(), status: 'receiving', size: 0 };
      state.items.unshift(item); await this.persist(taskId, state);
      const stream = await source.createReadStream(); controller.signal.throwIfAborted();
      if (!stream) throw new Error('The website did not provide a downloadable file.');
      temporary = join(folder, `${id}.part`);
      const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      const limit = new Transform({ transform: (chunk: Buffer, _, callback) => {
        item!.size += chunk.length;
        if (item!.size > this.options.maxBytes) return callback(new Error('This download exceeds the 50 MB limit.'));
        if (state!.items.reduce((size, entry) => size + (entry.status === 'failed' ? 0 : entry.size), 0) > this.options.totalBytes) return callback(new Error('This task’s downloads are full. Remove a previous download and try again.'));
        callback(null, chunk);
      } });
      await pipeline(stream, limit, handle.createWriteStream(), { signal: controller.signal });
      controller.signal.throwIfAborted();
      await rename(temporary, join(folder, `${id}.data`)); temporary = undefined;
      item.status = 'ready'; await this.persist(taskId, state);
      clearTimeout(timer);
      const preferences = this.preferences();
      if (preferences?.autoSaveDownloads && !controller.signal.aborted && !state.deleted) {
        // Copy failures leave the retained download available for Save a copy or retry.
        await this.save(taskId, id, preferences.downloadDirectory, controller.signal).catch(() => {});
      }
    } catch (error) {
      await source.cancel().catch(() => {});
      if (item && state && !state.deleted) {
        item.status = 'failed'; item.size = 0;
        item.error = controller.signal.aborted ? 'Download stopped. You can download the file again.' : (error instanceof Error ? error.message : 'The download did not finish.').slice(0, 500);
        await this.persist(taskId, state);
      } else if (!controller.signal.aborted && !this.closing && !state?.deleted) throw error;
    } finally {
      clearTimeout(timer);
      if (temporary) await rm(temporary, { force: true });
      await source.delete().catch(() => {});
    }
  }
  async read(taskId: string, id: string): Promise<{ item: BrowserDownload; data: Buffer }> {
    const state = await this.session(taskId), item = state.items.find(entry => entry.id === id && entry.status === 'ready');
    if (!item || state.deleted) throw new Error('This download is no longer available.');
    const handle = await open(join(await this.folder(taskId), `${item.id}.data`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1 || info.size !== item.size || info.size > this.options.maxBytes) throw new Error('This download could not be verified.');
      const data = Buffer.alloc(info.size + 1); let length = 0;
      while (length < data.length) { const result = await handle.read(data, length, data.length - length, null); if (!result.bytesRead) break; length += result.bytesRead; }
      if (length !== item.size) throw new Error('This download changed while it was being read.');
      return { item: { ...item }, data: data.subarray(0, length) };
    } finally { await handle.close(); }
  }
  async save(taskId: string, id: string, directory?: string, signal?: AbortSignal): Promise<BrowserDownload> {
    const key = `${taskId}:${id}`;
    if (this.saving.has(key)) throw new Error('A copy of this download is already being saved.');
    const pending = this.copy(taskId, id, directory, signal).finally(() => this.saving.delete(key));
    this.saving.set(key, pending); return pending;
  }
  private async copy(taskId: string, id: string, directory?: string, signal?: AbortSignal): Promise<BrowserDownload> {
    const state = await this.session(taskId), item = state.items.find(entry => entry.id === id && entry.status === 'ready');
    if (!item || state.deleted) throw new Error('This download is no longer available.');
    try {
      const target = directory || await validateDownloadDirectory();
      const { data } = await this.read(taskId, id); signal?.throwIfAborted();
      if (state.deleted || !state.items.includes(item)) throw new Error('This download is no longer available.');
      const path = await saveDownloadCopy(target, item.name, data, signal);
      item.savedPath = path; item.savedAt = Date.now(); delete item.saveError;
      await this.persist(taskId, state); return { ...item };
    } catch (error) {
      item.saveError = signal?.aborted ? 'Saving stopped. The download is still available.' : (error instanceof Error && !(error as NodeJS.ErrnoException).code ? error.message : 'The copy could not be saved. Check the folder’s space and access.').slice(0, 500);
      await this.persist(taskId, state); throw error;
    }
  }
  async remove(taskId: string, id: string) {
    const state = await this.session(taskId), item = state.items.find(entry => entry.id === id);
    if (!item) throw new Error('This download is no longer available.');
    const active = [...this.active].find(entry => entry.taskId === taskId && entry.id === id);
    if (active) { active.controller.abort(); await active.source.cancel().catch(() => {}); await active.promise.catch(() => {}); }
    await this.saving.get(`${taskId}:${id}`)?.catch(() => {});
    state.items = state.items.filter(entry => entry.id !== id); await this.persist(taskId, state);
    await rm(join(await this.folder(taskId), `${item.id}.data`), { force: true });
  }
  async deleteSession(taskId: string) {
    // A corrupt index must not prevent removal of the task's own downloads.
    // Removal still verifies both directory components and never follows links.
    const state = await this.session(taskId).catch(() => undefined);
    if (state) state.deleted = true;
    const active = [...this.active].filter(entry => entry.taskId === taskId);
    for (const item of active) { item.controller.abort(); await item.source.cancel().catch(() => {}); }
    await Promise.allSettled(active.map(item => item.promise));
    await Promise.allSettled([...this.saving].filter(([key]) => key.startsWith(`${taskId}:`)).map(([, promise]) => promise));
    await state?.writes.catch(() => {});
    if (state) state.items = [];
    try { await rm(await this.folder(taskId), { recursive: true, force: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (!state) this.sessions.set(taskId, Promise.resolve({ items: [], writes: Promise.resolve(), deleted: true }));
  }
  async close() {
    this.closing = true;
    const active = [...this.active];
    for (const item of active) { item.controller.abort(); await item.source.cancel().catch(() => {}); }
    await Promise.allSettled(active.map(item => item.promise)); await Promise.allSettled([...this.saving.values()]);
  }
}
