import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserHistory, historyUrl } from '../server/browser-history.js';
import { browserAddress } from '../shared/browser.js';

let root: string, history: BrowserHistory, enabled: boolean, now: number;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'litespeed-browser-history-')); enabled = true; now = Date.now(); history = new BrowserHistory(root, () => enabled, () => now); });
afterEach(async () => { await history.close(); await rm(root, { recursive: true, force: true }); });
describe('local browser history', () => {
  it('remembers visits and titles across restart, searches terms, and removes one exact entry', async () => {
    await history.visit('https://example.com/docs', 'Documentation'); now++;
    await history.visit('http://localhost:8080/preview', 'Project preview'); now++;
    await history.visit('https://example.com/docs'); await history.title('https://example.com/docs', 'Product documentation');
    await history.close(); history = new BrowserHistory(root, () => enabled, () => now);
    const result = await history.list(); expect(result.total).toBe(2); expect(result.entries[0]).toMatchObject({ title: 'Product documentation', visits: 2 });
    expect((await history.list('product example')).entries).toHaveLength(1);
    await history.clear(result.entries[0].id); expect((await history.list()).entries[0].title).toBe('Project preview');
    expect((await stat(join(root, 'browser-history.json'))).mode & 0o777).toBe(0o600);
  });
  it('honors history-off, removes expired pages, and bounds retained pages', async () => {
    await history.visit('https://expired.test/'); now += 31 * 24 * 60 * 60 * 1000;
    expect((await history.list()).entries).toEqual([]);
    enabled = false; await history.visit('https://private.test/'); expect((await history.list()).entries).toEqual([]);
    enabled = true;
    for (let index = 0; index < 505; index++) { now++; await history.visit(`https://example.com/${index}`); }
    expect((await history.list('', 6)).entries).toHaveLength(6); expect((await history.list()).total).toBe(500);
    await history.flush(); expect((JSON.parse(await readFile(join(root, 'browser-history.json'), 'utf8')) as { entries: unknown[] }).entries).toHaveLength(500);
  });
  it('clearing history does not let title refreshes recreate deleted pages', async () => {
    await history.visit('https://example.com/'); await history.clear(); await history.title('https://example.com/', 'Still open');
    expect((await history.list()).entries).toEqual([]);
    await history.close(); history = new BrowserHistory(root); expect((await history.list()).entries).toEqual([]);
  });
  it('refuses invalid protocols, embedded credentials, corrupt history and redirected reads', async () => {
    for (const value of ['about:blank', 'file:///private', 'https://person:password@example.com', 'not a url']) { expect(historyUrl(value)).toBeNull(); await history.visit(value); }
    expect((await history.list()).entries).toEqual([]); await history.close();
    const file = join(root, 'browser-history.json'); await writeFile(file, '{broken'); history = new BrowserHistory(root);
    await expect(history.list()).rejects.toThrow('could not be read'); await expect(history.visit('https://example.com')).rejects.toThrow(); expect(await readFile(file, 'utf8')).toBe('{broken');
    await history.clear(); expect((await history.list()).total).toBe(0); await history.close();
    await rm(file); const other = join(root, 'other'); await writeFile(other, 'preserve'); await symlink(other, file); history = new BrowserHistory(root);
    await expect(history.list()).rejects.toThrow(); await history.clear(); expect(await readFile(other, 'utf8')).toBe('preserve');
  });
  it('keeps history intact through concurrent flush, clear and new visits', async () => {
    await history.visit('https://old.test'); const writing = history.flush(); await history.clear(); await history.visit('https://new.test'); await writing; await history.flush();
    await history.close(); history = new BrowserHistory(root); expect((await history.list()).entries.map(item => item.url)).toEqual(['https://new.test/']);
  });
});
it('uses the selected search engine without changing direct local and web addresses', () => {
  expect(browserAddress('a quieter workspace', 'duckduckgo')).toBe('https://duckduckgo.com/?q=a%20quieter%20workspace');
  expect(browserAddress('search', 'bing')).toBe('https://www.bing.com/search?q=search');
  expect(browserAddress('localhost:3000')).toBe('http://localhost:3000');
  expect(browserAddress('example.com/docs', 'duckduckgo')).toBe('https://example.com/docs');
});
