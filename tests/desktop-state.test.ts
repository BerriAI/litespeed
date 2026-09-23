import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findDesktopSource, importDesktopState } from '../bin/desktop-state.mjs';

describe('desktop first-launch import', () => {
  let root: string, source: string, destination: string, db: DatabaseSync;
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-desktop-import-'))); source = join(root, 'existing'); destination = join(root, 'desktop'); await mkdir(source);
    db = new DatabaseSync(join(source, 'litespeed.db')); db.exec('PRAGMA journal_mode=WAL; CREATE TABLE settings(id INTEGER PRIMARY KEY,data TEXT); CREATE TABLE sessions(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE schedules(id TEXT PRIMARY KEY,data TEXT);');
    db.prepare('INSERT INTO settings VALUES(1,?)').run(JSON.stringify({ defaultModel: 'existing-model', providers: [{ apiKey: 'fixture-key' }] })); db.prepare('INSERT INTO sessions VALUES(?,?)').run('task-1', JSON.stringify({ title: 'Existing work' }));
    db.prepare('INSERT INTO schedules VALUES(?,?)').run('schedule-1', JSON.stringify({ status: 'active', nextRunAt: 123, revision: 2 }));
    await writeFile(join(source, 'subscription-auth.json'), '{"fixture":true}');
  });
  afterEach(async () => { db.close(); await rm(root, { recursive: true, force: true }); });
  it('takes a consistent live SQLite backup and retains settings/history without modifying the original', async () => {
    const result = await importDesktopState(source, destination); expect(result).toMatchObject({ imported: true, sessions: 1, schedulesPaused: 1 });
    const copied = new DatabaseSync(join(destination, 'litespeed.db')); try {
      expect(copied.prepare('SELECT data FROM settings').get()).toEqual(db.prepare('SELECT data FROM settings').get());
      expect(copied.prepare('SELECT data FROM sessions').get()).toEqual(db.prepare('SELECT data FROM sessions').get());
      expect(JSON.parse((copied.prepare('SELECT data FROM schedules').get() as { data: string }).data)).toMatchObject({ status: 'paused', nextRunAt: null, revision: 3 });
    } finally { copied.close(); }
    expect(JSON.parse((db.prepare('SELECT data FROM schedules').get() as { data: string }).data).status).toBe('active');
    expect(await readFile(join(destination, 'subscription-auth.json'), 'utf8')).toBe('{"fixture":true}'); expect((await stat(join(destination, 'litespeed.db'))).mode & 0o777).toBe(0o600);
    expect((await stat(destination)).mode & 0o777).toBe(0o700);
  });
  it('never imports again over an existing desktop store', async () => {
    await importDesktopState(source, destination); db.prepare('INSERT INTO sessions VALUES(?,?)').run('task-2', '{}');
    expect(await importDesktopState(source, destination)).toEqual({ imported: false }); const copied = new DatabaseSync(join(destination, 'litespeed.db')); try { expect(copied.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toMatchObject({ count: 1 }); } finally { copied.close(); }
  });
  it('rejects linked authentication files and leaves an existing nonempty destination alone', async () => {
    await symlink(join(source, 'subscription-auth.json'), join(source, 'mcp-auth.json')); await expect(importDesktopState(source, destination)).rejects.toThrow('unsafe'); await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    await rm(join(source, 'mcp-auth.json')); await mkdir(destination); await writeFile(join(destination, 'notes.txt'), 'keep'); await expect(importDesktopState(source, destination)).rejects.toThrow('already contains'); expect(await readFile(join(destination, 'notes.txt'), 'utf8')).toBe('keep');
  });
  it('prefers the explicit/current source and never selects the destination', async () => { expect(await findDesktopSource([destination, source], destination)).toBe(source); expect(await findDesktopSource([source], source)).toBeNull(); });
  it('reuses an abandoned lock file and serializes simultaneous first launches', async () => {
    const lock = new DatabaseSync(destination + '.import-lock.db'); lock.exec('BEGIN IMMEDIATE'); lock.close();
    const outcomes = await Promise.all([importDesktopState(source, destination), importDesktopState(source, destination)]);
    expect(outcomes.filter(value => value.imported)).toHaveLength(1); expect(outcomes.filter(value => !value.imported)).toHaveLength(1);
  });
});
