import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateDownloadDirectory, saveDownloadCopy } from '../server/download-destination.js';
import { protectStateDirectory } from '../server/state-paths.js';

describe('browser download destinations', () => {
  let root: string, destination: string;
  beforeEach(async () => { root = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-download-copy-'))); destination = join(root, 'Downloads'); await mkdir(destination); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  it('saves privately and preserves existing files, symlinks and hard links with numbered names', async () => {
    const original = join(root, 'original.csv'); await writeFile(original, 'keep'); await symlink(original, join(destination, 'report.csv')); await link(original, join(destination, 'report (1).csv'));
    const path = await saveDownloadCopy(destination, 'report.csv', Buffer.from('new'));
    expect(basename(path)).toBe('report (2).csv'); expect(await readFile(path, 'utf8')).toBe('new'); expect(await readFile(original, 'utf8')).toBe('keep'); expect((await lstat(path)).mode & 0o777).toBe(0o600);
  });
  it('resolves explicitly chosen aliases but refuses a saved directory redirected later', async () => {
    const alias = join(root, 'alias'); await symlink(destination, alias); expect(await validateDownloadDirectory(alias)).toBe(destination);
    const moved = join(root, 'moved'); await rename(destination, moved); await symlink(moved, destination);
    await expect(saveDownloadCopy(destination, 'report.csv', Buffer.from('data'))).rejects.toThrow('became a link'); expect(await readdir(moved)).toEqual([]);
  });
  it('refuses credential and application data directories, missing folders and relative paths', async () => {
    const state = join(root, 'state'), privateFolder = join(root, '.ssh'); await mkdir(state); await mkdir(privateFolder);
    const release = protectStateDirectory(state);
    try { await expect(validateDownloadDirectory(state)).rejects.toThrow('application data'); await expect(validateDownloadDirectory(privateFolder)).rejects.toThrow('credential'); }
    finally { release(); }
    await expect(validateDownloadDirectory('relative')).rejects.toThrow('full path'); await expect(validateDownloadDirectory(join(root, 'missing'))).rejects.toThrow('unavailable');
  });
  it('keeps Unicode filenames inside byte limits and never interprets a filename as a path', async () => {
    const path = await saveDownloadCopy(destination, '../../' + '🌱'.repeat(200) + '.csv', Buffer.from('unicode'));
    expect(Buffer.byteLength(basename(path))).toBeLessThan(255); expect(path.startsWith(destination + '/')).toBe(true); expect(path.endsWith('.csv')).toBe(true);
    expect(basename(await saveDownloadCopy(destination, '.env', Buffer.from('text')))).toBe('env');
  });
  it('cancels before creating a copy and handles simultaneous names exclusively', async () => {
    const controller = new AbortController(); controller.abort(); await expect(saveDownloadCopy(destination, 'report.csv', Buffer.from('text'), controller.signal)).rejects.toThrow(); expect(await readdir(destination)).toEqual([]);
    const files = await Promise.all(Array.from({ length: 5 }, (_, i) => saveDownloadCopy(destination, 'report.csv', Buffer.from(String(i)))));
    expect(new Set(files).size).toBe(5); expect(new Set(await Promise.all(files.map(path => readFile(path, 'utf8'))))).toEqual(new Set(['0', '1', '2', '3', '4']));
  });
});
