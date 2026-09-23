import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { BrowserDownloads, downloadFilename, type BrowserDownloadSource } from '../server/browser-downloads.js';

class Download implements BrowserDownloadSource {
  cancelled = false; deleted = false; name = 'report.csv'; bytes = Buffer.from('name,total\nLitespeed,42\n');
  suggestedFilename() { return this.name; }
  url() { return 'https://example.com/report'; }
  async createReadStream(): Promise<Readable | null> { return Readable.from([this.bytes]); }
  async cancel() { this.cancelled = true; }
  async delete() { this.deleted = true; }
}
describe('task browser downloads', () => {
  let directory: string, downloads: BrowserDownloads;
  const tabId = randomUUID(), folder = (root: string, id = 'task') => join(root, 'browser-downloads', createHash('sha256').update(id).digest('hex'));
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'litespeed-downloads-')); downloads = new BrowserDownloads(directory); });
  afterEach(async () => { await downloads.close(); await rm(directory, { recursive: true, force: true }); });
  it('automatically saves completed files without replacing existing copies and keeps them after task removal', async () => {
    const destination = join(await realpath(directory), 'copies'); await mkdir(destination); await writeFile(join(destination, 'report.csv'), 'keep existing');
    downloads = new BrowserDownloads(directory, undefined, () => ({ searchEngine: 'google', rememberHistory: true, autoSaveDownloads: true, downloadDirectory: destination }));
    await downloads.capture('task', tabId, new Download()); const [item] = await downloads.list('task');
    expect(item.status).toBe('ready'); expect(item.savedPath).toBe(join(destination, 'report (1).csv')); expect(item.saveError).toBeUndefined();
    expect(await readFile(join(destination, 'report.csv'), 'utf8')).toBe('keep existing');
    await downloads.close(); downloads = new BrowserDownloads(directory); expect((await downloads.list('task'))[0].savedPath).toBe(item.savedPath);
    await downloads.deleteSession('task'); expect(await readFile(item.savedPath!, 'utf8')).toContain('Litespeed,42');
  });
  it('keeps a download after automatic save fails and allows a retry to another destination', async () => {
    const destination = join(await realpath(directory), 'missing');
    downloads = new BrowserDownloads(directory, undefined, () => ({ searchEngine: 'google', rememberHistory: true, autoSaveDownloads: true, downloadDirectory: destination }));
    await downloads.capture('task', tabId, new Download()); const [item] = await downloads.list('task');
    expect(item).toMatchObject({ status: 'ready' }); expect(item.saveError).toContain('unavailable'); expect((await downloads.read('task', item.id)).data.toString()).toContain('Litespeed,42');
    await mkdir(destination); const saved = await downloads.save('task', item.id, destination); expect(saved.savedPath).toBe(join(destination, 'report.csv')); expect(saved.saveError).toBeUndefined();
    await downloads.remove('task', item.id); expect(await readFile(saved.savedPath!, 'utf8')).toContain('Litespeed,42');
  });
  it('does not automatically save unless the user enabled it', async () => {
    const destination = join(await realpath(directory), 'copies'); await mkdir(destination);
    downloads = new BrowserDownloads(directory, undefined, () => ({ searchEngine: 'google', rememberHistory: true, autoSaveDownloads: false, downloadDirectory: destination }));
    await downloads.capture('task', tabId, new Download()); expect(await readdir(destination)).toEqual([]); expect((await downloads.list('task'))[0].savedPath).toBeUndefined();
  });
  it('keeps private, durable copies scoped to a task and cleans browser temporary files', async () => {
    const source = new Download(); await downloads.capture('task', tabId, source);
    const [item] = await downloads.list('task');
    expect(item).toMatchObject({ name: 'report.csv', status: 'ready', tabId, size: source.bytes.length });
    expect((await downloads.read('task', item.id)).data).toEqual(source.bytes);
    expect(await downloads.list('other')).toEqual([]);
    await expect(downloads.read('other', item.id)).rejects.toThrow('no longer available');
    expect(source.deleted).toBe(true);
    expect((await stat(join(folder(directory), `${item.id}.data`))).mode & 0o777).toBe(0o600);
    expect((await stat(join(folder(directory), 'index.json'))).mode & 0o777).toBe(0o600);
    await downloads.close(); downloads = new BrowserDownloads(directory);
    expect((await downloads.read('task', item.id)).data).toEqual(source.bytes);
    await downloads.remove('task', item.id); expect(await downloads.list('task')).toEqual([]);
    expect(await readdir(folder(directory))).toEqual(['index.json']);
  });
  it('never treats suggested filenames as paths and preserves a useful safe name', async () => {
    expect(downloadFilename('../../report.csv')).toBe('report.csv');
    expect(downloadFilename('C:\\private\\report.csv')).toBe('report.csv');
    expect(downloadFilename('..')).toBe('download'); expect(downloadFilename('CON.exe')).toBe('download');
    expect(downloadFilename('report\r\n.csv')).toBe('report__.csv');
    const source = new Download(); source.name = '../../private.txt'; await downloads.capture('../task', tabId, source);
    expect((await downloads.list('../task'))[0].name).toBe('private.txt');
    expect(await readdir(directory)).toEqual(['browser-downloads']);
  });
  it('rejects oversize data and cleans partial files without making them available', async () => {
    downloads = new BrowserDownloads(directory, { maxBytes: 10, totalBytes: 100, count: 25, timeoutMs: 1000 });
    const source = new Download(); await downloads.capture('task', tabId, source);
    const [item] = await downloads.list('task'); expect(item.status).toBe('failed'); expect(item.error).toContain('limit');
    expect(source.cancelled).toBe(true); expect(source.deleted).toBe(true);
    expect(await readdir(folder(directory))).toEqual(['index.json']);
    await expect(downloads.read('task', item.id)).rejects.toThrow('no longer available');
  });
  it('enforces total task storage and count limits across repeated downloads', async () => {
    downloads = new BrowserDownloads(directory, { maxBytes: 100, totalBytes: 30, count: 2, timeoutMs: 1000 });
    await downloads.capture('task', tabId, new Download()); await downloads.capture('task', tabId, new Download());
    expect((await downloads.list('task')).map(item => item.status)).toEqual(['failed', 'ready']);
    const third = new Download(); await expect(downloads.capture('task', tabId, third)).rejects.toThrow('Remove a previous');
    expect(third.cancelled).toBe(true); expect(third.deleted).toBe(true);
  });
  it('marks interrupted downloads as failed on restart without making network requests', async () => {
    await downloads.capture('task', tabId, new Download());
    const file = join(folder(directory), 'index.json'), content = JSON.parse(await readFile(file, 'utf8'));
    content.downloads[0].status = 'receiving'; await writeFile(file, JSON.stringify(content));
    await downloads.close(); downloads = new BrowserDownloads(directory);
    expect((await downloads.list('task'))[0]).toMatchObject({ status: 'failed', size: 0, error: 'Interrupted when Litespeed closed. Download this file again.' });
  });
  it('cancels in-flight downloads before deleting their task directory', async () => {
    let release!: () => void;
    const source = new Download(); source.createReadStream = () => new Promise(resolve => { release = () => resolve(null); });
    source.cancel = async () => { source.cancelled = true; release?.(); };
    const pending = downloads.capture('task', tabId, source);
    while (!release) await new Promise(resolve => setTimeout(resolve, 5));
    await downloads.deleteSession('task'); await pending;
    expect(source.cancelled).toBe(true); expect(source.deleted).toBe(true); expect(await downloads.list('task')).toEqual([]);
    await expect(stat(folder(directory))).rejects.toThrow();
  });
  it('refuses symlinked data and malformed metadata without reading outside files', async () => {
    await downloads.capture('task', tabId, new Download()); const [item] = await downloads.list('task');
    const data = join(folder(directory), `${item.id}.data`), outside = join(directory, 'outside');
    await writeFile(outside, 'SYNTHETIC_PRIVATE_DATA'); await rm(data); await symlink(outside, data);
    await expect(downloads.read('task', item.id)).rejects.toThrow();
    const file = join(folder(directory), 'index.json'); await writeFile(file, '{invalid');
    await downloads.close(); downloads = new BrowserDownloads(directory);
    await expect(downloads.list('task')).rejects.toThrow('could not be read');
    expect(await readFile(file, 'utf8')).toBe('{invalid');
    await downloads.deleteSession('task'); expect(await downloads.list('task')).toEqual([]);
    expect(await readFile(outside, 'utf8')).toBe('SYNTHETIC_PRIVATE_DATA');
  });
});
