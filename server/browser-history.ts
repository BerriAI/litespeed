import { constants } from 'node:fs';
import { open, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { BrowserHistoryEntry, BrowserHistoryResult } from '../shared/browser.js';

const MAX_ENTRIES = 500, MAX_BYTES = 2 * 1024 * 1024, RETENTION = 30 * 24 * 60 * 60 * 1000;
export function historyUrl(value: string): string | null {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.href.length <= 2048 ? url.href : null; } catch { return null; }
}
const entry = z.object({ id: z.string().uuid(), url: z.string().max(2048).refine(value => Boolean(historyUrl(value))), title: z.string().max(500), visitedAt: z.number().int().nonnegative(), visits: z.number().int().min(1).max(1_000_000) }).strict();
const schema = z.object({ version: z.literal(1), entries: z.array(entry).max(MAX_ENTRIES) }).strict().refine(value => new Set(value.entries.map(item => item.id)).size === value.entries.length && new Set(value.entries.map(item => item.url)).size === value.entries.length);

/** A local history for the separate browser profile. Reading it never visits a page. */
export class BrowserHistory {
  private loading?: Promise<BrowserHistoryEntry[]>;
  private timer?: ReturnType<typeof setTimeout>;
  private writes: Promise<void> = Promise.resolve();
  private dirty = false;
  private closed = false;
  warning?: string;
  constructor(private directory: string, private enabled: () => boolean = () => true, private now = Date.now) {}
  private async file() { return join(await realpath(this.directory), 'browser-history.json'); }
  private async load() {
    if (!this.loading) this.loading = (async () => {
      try {
        const handle = await open(await this.file(), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const info = await handle.stat();
          if (!info.isFile() || info.nlink !== 1 || info.size > MAX_BYTES) throw new Error('Invalid history file.');
          const data = Buffer.alloc(MAX_BYTES + 1); let length = 0;
          while (length < data.length) { const result = await handle.read(data, length, data.length - length, null); if (!result.bytesRead) break; length += result.bytesRead; }
          if (length > MAX_BYTES) throw new Error('History is too large.');
          const entries = schema.parse(JSON.parse(data.subarray(0, length).toString('utf8'))).entries;
          return entries.sort((a, b) => b.visitedAt - a.visitedAt);
        } finally { await handle.close(); }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw new Error('Browsing history could not be read. You can clear it in Browser settings.');
      }
    })();
    return this.loading;
  }
  private changed() {
    this.dirty = true;
    if (!this.timer && !this.closed) { this.timer = setTimeout(() => { this.timer = undefined; void this.flush().catch(() => { this.warning = 'Browsing history could not be saved.'; }); }, 250); this.timer.unref(); }
  }
  async visit(raw: string, title = '') {
    const url = historyUrl(raw); if (!url || !this.enabled() || this.closed) return;
    const entries = await this.load(); if (!this.enabled() || this.closed) return;
    const existing = entries.find(item => item.url === url), now = this.now();
    if (existing) entries.splice(entries.indexOf(existing), 1);
    entries.unshift({ id: existing?.id || randomUUID(), url, title: title.slice(0, 500), visitedAt: now, visits: Math.min(1_000_000, (existing?.visits || 0) + 1) });
    entries.splice(MAX_ENTRIES); this.prune(entries); this.changed();
  }
  async title(url: string, title: string) {
    if (!this.enabled() || this.closed) return;
    const entries = await this.load(), item = entries.find(item => item.url === url), value = title.slice(0, 500);
    if (item && item.title !== value) { item.title = value; this.changed(); }
  }
  private prune(entries: BrowserHistoryEntry[]) { const cutoff = this.now() - RETENTION; for (let index = entries.length - 1; index >= 0; index--) if (entries[index].visitedAt < cutoff) { entries.splice(index, 1); this.dirty = true; } }
  async list(query = '', limit = 100): Promise<BrowserHistoryResult> {
    const entries = await this.load(); this.prune(entries); if (this.dirty) this.changed();
    const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return { entries: entries.filter(item => tokens.every(token => `${item.title} ${item.url}`.toLocaleLowerCase().includes(token))).slice(0, Math.max(1, Math.min(100, limit))).map(item => ({ ...item })), total: entries.length, ...(this.warning ? { error: this.warning } : {}) };
  }
  async clear(id?: string) {
    if (id) { const entries = await this.load(); const index = entries.findIndex(item => item.id === id); if (index !== -1) entries.splice(index, 1); }
    else { await this.loading?.catch(() => {}); this.loading = Promise.resolve([]); }
    this.changed(); await this.flush();
  }
  async flush() {
    clearTimeout(this.timer); this.timer = undefined;
    if (!this.dirty) return this.writes;
    const entries = await this.load(); this.prune(entries);
    const data = JSON.stringify(schema.parse({ version: 1, entries })); this.dirty = false;
    this.writes = this.writes.catch(() => {}).then(async () => {
      const file = await this.file(), temporary = `${file}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, data, { flag: 'wx', mode: 0o600 }); await rename(temporary, file); this.warning = undefined; }
      finally { await rm(temporary, { force: true }); }
    });
    return this.writes;
  }
  async close() { this.closed = true; await this.flush().catch(() => {}); }
}
