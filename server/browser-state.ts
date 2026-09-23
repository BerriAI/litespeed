import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

const tabSchema = z.object({ id: z.string().uuid(), title: z.string().max(500), url: z.string().max(8192).refine(value => {
  if (value === 'about:blank') return true;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}) }).strict();
const savedSchema = z.object({ version: z.literal(1), tabs: z.array(tabSchema).max(12), activeId: z.string().uuid().nullable(), width: z.number().int().min(320).max(1280), height: z.number().int().min(240).max(1200) }).strict()
  .refine(value => new Set(value.tabs.map(tab => tab.id)).size === value.tabs.length && (value.tabs.length ? value.tabs.some(tab => tab.id === value.activeId) : value.activeId === null));
export type SavedBrowserSession = Omit<z.infer<typeof savedSchema>, 'version'>;

/** Metadata only: loading this file never launches a browser or visits a URL. */
export class BrowserSessions {
  constructor(private directory: string) {}
  private async file(id: string, create = false) {
    const folder = join(await realpath(this.directory), 'browser-tabs');
    if (create) await mkdir(folder, { recursive: true, mode: 0o700 });
    const info = await lstat(folder);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('The saved browser directory is not a regular directory.');
    return join(folder, createHash('sha256').update(id).digest('hex') + '.json');
  }
  async load(id: string): Promise<SavedBrowserSession | null> {
    try {
      const file = await this.file(id), handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.nlink !== 1 || info.size > 128 * 1024) throw new Error('Invalid saved browser metadata.');
        const buffer = Buffer.alloc(128 * 1024 + 1);
        let length = 0;
        while (length < buffer.length) { const result = await handle.read(buffer, length, buffer.length - length, null); if (!result.bytesRead) break; length += result.bytesRead; }
        if (length > 128 * 1024) throw new Error('Invalid saved browser metadata.');
        const { version: _, ...value } = savedSchema.parse(JSON.parse(buffer.subarray(0, length).toString('utf8')));
        return value;
      } finally { await handle.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new Error('Saved browser tabs could not be restored. You can open a new tab.');
    }
  }
  async save(id: string, value: SavedBrowserSession) {
    const content = JSON.stringify(savedSchema.parse({ ...value, version: 1 }));
    if (Buffer.byteLength(content) > 128 * 1024) throw new Error('Saved browser metadata is too large.');
    const file = await this.file(id, true), temporary = file + '.' + randomUUID() + '.tmp';
    try { await writeFile(temporary, content, { mode: 0o600, flag: 'wx' }); await rename(temporary, file); }
    finally { await rm(temporary, { force: true }); }
  }
  async remove(id: string) {
    try { await rm(await this.file(id), { force: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
