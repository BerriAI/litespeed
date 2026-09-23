import { constants } from 'node:fs';
import { lstat, open, realpath, unlink } from 'node:fs/promises';
import { extname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { protectedPath } from './tools.js';

export const defaultDownloadDirectory = () => join(homedir(), 'Downloads');
const failed = (message: string) => Object.assign(new Error(message), { status: 400 });
export async function validateDownloadDirectory(value?: string): Promise<string> {
  const raw = value?.trim() || defaultDownloadDirectory();
  const path = raw === '~' ? homedir() : raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw;
  if (!isAbsolute(path)) throw failed('Choose an existing download folder with a full path.');
  let directory: string;
  try { directory = await realpath(path); }
  catch { throw failed('The download folder is unavailable. Choose an existing folder.'); }
  if (protectedPath(directory)) throw failed('Choose a download folder outside credential and application data folders.');
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw failed('Choose a regular download folder.');
  return directory;
}
function bytesAtMost(text: string, maximum: number) {
  let value = '', bytes = 0;
  for (const char of text) { bytes += Buffer.byteLength(char); if (bytes > maximum) break; value += char; }
  return value;
}
function safeName(value: string) {
  const leaf = value.replace(/\\/g, '/').split('/').at(-1)?.replace(/[\x00-\x1f\x7f<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/g, '_').replace(/^\.+|[. ]+$/g, '').trim() || 'download';
  const extension = bytesAtMost(extname(leaf), 40), base = bytesAtMost(leaf.slice(0, leaf.length - extname(leaf).length), 180) || 'download';
  return { base: /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base) ? 'download' : base, extension };
}

/** Copies only into the explicitly selected canonical directory. Exclusive
 * creation preserves existing files and links; failed partial copies are removed. */
export async function saveDownloadCopy(directory: string, name: string, data: Buffer, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const canonical = await validateDownloadDirectory(directory);
  if (canonical !== resolve(directory)) throw failed('The download folder moved or became a link. Choose it again in Settings.');
  const folder = await lstat(canonical), { base, extension } = safeName(name);
  for (let suffix = 0; suffix < 1000; suffix++) {
    signal?.throwIfAborted();
    const path = join(canonical, `${base}${suffix ? ` (${suffix})` : ''}${extension}`);
    let handle;
    try { handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue; throw failed('A copy could not be saved to this folder. Check its access or choose another folder.'); }
    const file = await handle.stat(); let complete = false;
    try {
      const current = await lstat(canonical);
      if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== folder.dev || current.ino !== folder.ino || await realpath(canonical) !== canonical) throw failed('The download folder changed while saving. Choose it again in Settings.');
      const destination = await lstat(path);
      if (!destination.isFile() || destination.isSymbolicLink() || destination.nlink !== 1 || destination.dev !== file.dev || destination.ino !== file.ino) throw failed('The download destination changed while saving. Try again.');
      signal?.throwIfAborted(); await handle.writeFile(data, { signal }); await handle.sync();
      const after = await handle.stat(), finalFolder = await lstat(canonical), finalFile = await lstat(path);
      if (!finalFile.isFile() || finalFile.isSymbolicLink() || finalFile.dev !== file.dev || finalFile.ino !== file.ino || after.nlink !== 1 || after.size !== data.length || finalFolder.dev !== folder.dev || finalFolder.ino !== folder.ino || finalFolder.isSymbolicLink() || await realpath(canonical) !== canonical) throw failed('The download folder changed while saving. Choose it again in Settings.');
      complete = true; return path;
    } finally {
      await handle.close();
      if (!complete) {
        const current = await lstat(path).catch(() => null);
        if (current?.isFile() && !current.isSymbolicLink() && current.dev === file.dev && current.ino === file.ino) await unlink(path).catch(() => {});
      }
    }
  }
  throw failed('Too many files have this name. Choose another download folder.');
}
