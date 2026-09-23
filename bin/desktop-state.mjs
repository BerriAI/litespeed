import { DatabaseSync, backup } from 'node:sqlite';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const present = async path => { try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
async function importLock(lock) {
  if (await present(lock)) await regularFile(lock);
  const db = new DatabaseSync(lock); await chmod(lock, 0o600);
  try {
    for (let attempt = 0; attempt < 200; attempt++) {
      try { db.exec('BEGIN IMMEDIATE'); return () => { try { db.exec('ROLLBACK'); } finally { db.close(); } }; }
      catch (error) { if (error.errcode !== 5) throw error; }
      // Yield instead of SQLite's blocking busy timeout so two launchers in
      // the same Node process can complete their asynchronous backup work.
      await new Promise(done => setTimeout(done, 100));
    }
    throw new Error('Another desktop import is in progress. Try opening Litespeed again shortly.');
  } catch (error) { db.close(); throw error; }
}
async function regularFile(path, maximum = Number.MAX_SAFE_INTEGER) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > maximum || await realpath(path) !== resolve(path)) throw new Error('Saved Litespeed data includes an unsafe or oversized file. The original was left unchanged.');
}
export async function findDesktopSource(candidates, destination) {
  for (const candidate of candidates.filter(Boolean)) if (resolve(candidate) !== resolve(destination) && await present(join(candidate, 'litespeed.db'))) return resolve(candidate);
  return null;
}
/** Copy a consistent SQLite snapshot on the first desktop launch. The source
 * remains live and unmodified; an existing desktop store is never replaced. */
export async function importDesktopState(source, destination) {
  source = resolve(source); destination = resolve(destination);
  if (source === destination || await present(join(destination, 'litespeed.db'))) return { imported: false };
  await regularFile(join(source, 'litespeed.db'));
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const release = await importLock(destination + '.import-lock.db');
  let staging;
  try {
    if (await present(join(destination, 'litespeed.db'))) return { imported: false };
    const existing = await present(destination);
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink() || (await readdir(destination)).length)) throw new Error('The desktop data directory already contains files. Nothing was replaced.');
    staging = await mkdtemp(destination + '.import-'); await chmod(staging, 0o700);
    const original = new DatabaseSync(join(source, 'litespeed.db'), { readOnly: true });
    try { await backup(original, join(staging, 'litespeed.db')); } finally { original.close(); }
    await chmod(join(staging, 'litespeed.db'), 0o600);
    for (const name of ['subscription-auth.json', 'mcp-auth.json']) {
      const file = join(source, name); if (!await present(file)) continue;
      await regularFile(file, 2 * 1024 * 1024);
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { const stat = await handle.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.size > 2 * 1024 * 1024) throw new Error('A saved sign-in changed during import. Try again.'); await writeFile(join(staging, name), await handle.readFile(), { mode: 0o600, flag: 'wx' }); }
      finally { await handle.close(); }
    }
    const copied = new DatabaseSync(join(staging, 'litespeed.db'));
    let schedulesPaused = 0, sessions = 0;
    try {
      const tables = new Set(copied.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
      if (!tables.has('settings') || !tables.has('sessions')) throw new Error('This directory does not contain compatible Litespeed saved data.');
      sessions = Number(copied.prepare('SELECT COUNT(*) AS count FROM sessions').get().count);
      // The old server may still be running. Duplicated schedules must never
      // dispatch merely because the desktop copy was opened.
      if (tables.has('schedules')) for (const row of copied.prepare('SELECT id,data FROM schedules').all()) {
        const value = JSON.parse(row.data); if (value.status !== 'active') continue;
        copied.prepare('UPDATE schedules SET data=? WHERE id=?').run(JSON.stringify({ ...value, status: 'paused', nextRunAt: null, revision: (value.revision ?? 0) + 1 }), row.id); schedulesPaused++;
      }
      copied.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally { copied.close(); }
    const result = { imported: true, source, importedAt: Date.now(), sessions, schedulesPaused };
    await writeFile(join(staging, 'desktop-import.json'), JSON.stringify(result), { mode: 0o600 });
    if (existing) await rmdir(destination);
    await rename(staging, destination); staging = undefined;
    return result;
  } finally { try { if (staging) await rm(staging, { recursive: true, force: true }); } finally { release(); } }
}
