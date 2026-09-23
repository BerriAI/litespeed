import { constants } from 'node:fs';
import { lstat, open, realpath, mkdir, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { protectedPath } from './tools.js';

export const DISCARD_FILE_LIMIT = 8 * 1024 * 1024;
export type FileFingerprint = { hash: string; size: number; mode: number } | null;
export type DiscardFileCopy = Exclude<FileFingerprint, null> & { data: string };
export type FileObservation = { fingerprint: FileFingerprint; identity: string | null; copy: DiscardFileCopy | null };
export const discardConflict = (message: string, status = 409) => Object.assign(new Error(message), { status });
export const sameFingerprint = (a: FileFingerprint, b: FileFingerprint) => a === null || b === null ? a === b : a.hash === b.hash && a.size === b.size && a.mode === b.mode;
const changed = (path: string) => discardConflict(`${path} changed or is no longer a regular project file. Refresh the review before continuing.`);
const identity = (stat: { dev: number; ino: number; size: number; mode: number; mtimeMs: number; ctimeMs: number }) => JSON.stringify([stat.dev, stat.ino, stat.size, stat.mode, stat.mtimeMs, stat.ctimeMs]);

/** Unlike ordinary navigation, destructive file actions never follow an alias. */
export async function discardPath(root: string, path: string): Promise<string> {
  if (!path || path.length > 4096 || isAbsolute(path) || /[\0\\]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git') || protectedPath(path, root)) throw discardConflict('Choose regular project files for this action.', 400);
  if (await realpath(root) !== resolve(root)) throw discardConflict('The project location changed. Reopen it before continuing.');
  let current = root;
  const parts = path.split('/');
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    const stat = await lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat) return join(current, ...parts.slice(index + 1));
    if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) throw changed(path);
  }
  return current;
}
export async function observeDiscardFile(root: string, path: string): Promise<FileObservation> {
  const absolute = await discardPath(root, path);
  let handle;
  try {
    handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1) throw changed(path);
    if (before.size > DISCARD_FILE_LIMIT) throw discardConflict(`${path} is larger than the 8 MiB file-operation limit. Use your terminal for this file.`, 400);
    const data = Buffer.alloc(Math.min(before.size + 1, DISCARD_FILE_LIMIT + 1)); let length = 0;
    while (length < data.length) { const { bytesRead } = await handle.read(data, length, data.length - length, length); if (!bytesRead) break; length += bytesRead; }
    const after = await handle.stat(), named = await lstat(absolute);
    if (identity(before) !== identity(after) || named.dev !== before.dev || named.ino !== before.ino || named.isSymbolicLink() || length !== before.size || await discardPath(root, path) !== absolute) throw changed(path);
    const bytes = data.subarray(0, length), fingerprint = { hash: createHash('sha256').update(bytes).digest('hex'), size: length, mode: before.mode & 0o777 };
    return { fingerprint, identity: identity(before), copy: { ...fingerprint, data: bytes.toString('base64') } };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // A disappearing parent or dangling link is not a verified missing file.
      await discardPath(root, path);
      const current = await lstat(absolute).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (!current) return { fingerprint: null, identity: null, copy: null };
    }
    throw error;
  } finally { await handle?.close(); }
}
export async function assertDiscardFile(root: string, path: string, expected: FileObservation) {
  const current = await observeDiscardFile(root, path);
  if (!sameFingerprint(current.fingerprint, expected.fingerprint) || current.identity !== expected.identity) throw changed(path);
}
export async function removeDiscardFile(root: string, path: string, expected: FileObservation) {
  await assertDiscardFile(root, path, expected);
  if (expected.fingerprint === null) return;
  await unlink(await discardPath(root, path));
}
/** A complete sibling file replaces the verified target in one rename. A crash
 * cannot leave a partially written destination; original bytes stay in the DB. */
export async function restoreDiscardFile(root: string, path: string, expected: FileObservation, copy: DiscardFileCopy | null) {
  if (sameFingerprint(expected.fingerprint, copy)) { await assertDiscardFile(root, path, expected); return; }
  if (!copy) { await removeDiscardFile(root, path, expected); return; }
  const bytes = Buffer.from(copy.data, 'base64');
  if (bytes.length !== copy.size || bytes.length > DISCARD_FILE_LIMIT || createHash('sha256').update(bytes).digest('hex') !== copy.hash || !Number.isInteger(copy.mode) || copy.mode < 0 || copy.mode > 0o777) throw discardConflict('The saved file copy could not be verified. Nothing was restored.');
  const absolute = await discardPath(root, path), parent = dirname(absolute);
  await mkdir(parent, { recursive: true }); await discardPath(root, path);
  const parentStat = await lstat(parent), temporary = join(parent, `.litespeed-restore-${randomUUID()}`);
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let temporaryIdentity: { dev: number; ino: number } | undefined;
  try {
    temporaryIdentity = await handle.stat();
    await handle.writeFile(bytes); await handle.chmod(copy.mode); await handle.sync();
    await assertDiscardFile(root, path, expected);
    const currentParent = await lstat(parent);
    if (currentParent.isSymbolicLink() || currentParent.dev !== parentStat.dev || currentParent.ino !== parentStat.ino || !(absolute === root || absolute.startsWith(root + sep))) throw changed(path);
    if (expected.fingerprint === null) {
      // Exclusive hard-link creation avoids replacing a newly appeared target.
      const { link } = await import('node:fs/promises'); await link(temporary, absolute); await unlink(temporary);
    } else await rename(temporary, absolute);
  } finally {
    await handle.close();
    const leftover = await lstat(temporary).catch(() => null);
    if (leftover && temporaryIdentity && !leftover.isSymbolicLink() && leftover.dev === temporaryIdentity.dev && leftover.ino === temporaryIdentity.ino) await unlink(temporary).catch(() => {});
  }
}
