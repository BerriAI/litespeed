import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { inspectGit, protectedPath } from './tools.js';
import type { WorktreeSetupFiles } from '../shared/worktrees.js';

const fail = (message: string) => Object.assign(new Error(message), { status: 409 });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identity = (stat: { dev: number; ino: number; size: number; mode: number; mtimeMs: number; ctimeMs: number }) => JSON.stringify([stat.dev, stat.ino, stat.size, stat.mode, stat.mtimeMs, stat.ctimeMs]);
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
type Copy = { bytes: Buffer; identity: string; hash: string; mode: number };
export type WorktreeSetupSnapshot = { public: WorktreeSetupFiles; copies: Map<string, Copy>; revision: string };
const maximumFile = 8 * 1024 * 1024;

function allowed(root: string, path: string) {
  if (!path || path.length > 4096 || isAbsolute(path) || /[\0\\]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) return false;
  if (!protectedPath(path, root)) return true;
  // Explicit host-side setup copying can carry environment files without
  // making their contents available to file previews or agent read tools.
  const name = basename(path).toLowerCase();
  return (name === '.env' || name.startsWith('.env.')) && !protectedPath(join(dirname(path), 'worktree-local-configuration'), root);
}
async function checkedPath(root: string, path: string) {
  if (!allowed(root, path)) throw fail('This local setup path is restricted.');
  if (await realpath(root) !== resolve(root)) throw fail('The project folder changed. Reopen it before copying setup files.');
  let current = root;
  const parts = path.split('/');
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    const stat = await lstat(current).catch(error => { if (absent(error)) return null; throw error; });
    if (!stat) return join(current, ...parts.slice(index + 1));
    if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) throw fail('Local setup copying only supports regular files and folders.');
  }
  return current;
}
async function capture(root: string, path: string, maximum = maximumFile): Promise<Copy | null> {
  const absolute = await checkedPath(root, path); let handle;
  try {
    handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > maximum) throw fail(`${path} exceeds the setup-file limit or is no longer a regular file.`);
    const bytes = Buffer.alloc(before.size + 1); let length = 0;
    while (length < bytes.length) { const result = await handle.read(bytes, length, bytes.length - length, length); if (!result.bytesRead) break; length += result.bytesRead; }
    const after = await handle.stat(), named = await lstat(absolute);
    if (identity(before) !== identity(after) || named.dev !== before.dev || named.ino !== before.ino || length !== before.size || await checkedPath(root, path) !== absolute) throw fail('A local setup file changed while being read. Refresh the review.');
    return { bytes: bytes.subarray(0, length), identity: identity(before), hash: createHash('sha256').update(bytes.subarray(0, length)).digest('hex'), mode: (before.mode & 0o100) | 0o600 };
  } catch (error) {
    if (absent(error) && !await lstat(absolute).catch(error => { if (absent(error)) return null; throw error; })) return null;
    throw error;
  } finally { await handle?.close(); }
}

/** Setup copies never return file contents through the API. Patterns use Git's
 * own ignore parser, and only repository-ignored files are eligible. */
export async function captureWorktreeSetup(project: string, head: string, signal?: AbortSignal): Promise<WorktreeSetupSnapshot> {
  const git = await inspectGit(project, signal); if (!git) throw fail('The original Git project is unavailable.');
  const run = async (args: string[]) => { const result = await git.run(args); if (result.code !== 0 || result.truncated) throw fail('The local setup file list could not be read completely. Narrow the patterns in .worktreeinclude and try again.'); return result.output; };
  const rules = await capture(git.root, '.worktreeinclude', 32 * 1024);
  if (rules) { try { new TextDecoder('utf-8', { fatal: true }).decode(rules.bytes); if (rules.bytes.includes(0)) throw new Error('NUL'); } catch { throw fail('Use a UTF-8 text file for .worktreeinclude, with one ignored path or pattern per line.'); } }
  const selected = await run(['ls-files', '--others', '--ignored', '-z', ...(rules ? [`--exclude-from=${join(git.root, '.worktreeinclude')}`] : []), '--exclude=/AGENTS.override.md']);
  const candidates = [...new Set(selected.split('\0').filter(Boolean))].sort();
  if (candidates.length > 200) throw fail('Local setup patterns match more than 200 files. Narrow .worktreeinclude before continuing.');
  const ignored = candidates.length ? await run(['--literal-pathspecs', 'ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', ...candidates]) : '';
  const paths = [...new Set(ignored.split('\0').filter(Boolean))].sort();
  if (paths.some(path => !candidates.includes(path))) throw fail('The local setup file list changed. Refresh the review.');
  const trackedText = paths.length ? await run(['--literal-pathspecs', 'ls-tree', '-r', '--name-only', '-z', head, '--', ...paths]) : '';
  const tracked = new Set(trackedText.split('\0').filter(Boolean));
  const copies = new Map<string, Copy>(), skipped: WorktreeSetupFiles['skipped'] = []; let bytes = 0;
  for (const path of paths) {
    signal?.throwIfAborted();
    if (!allowed(git.root, path)) { skipped.push({ path, reason: 'Restricted file' }); continue; }
    if (tracked.has(path)) { skipped.push({ path, reason: 'Already in starting commit' }); continue; }
    try { await checkedPath(git.root, path); } catch (error) { if ((error as { status?: number }).status === 409) { skipped.push({ path, reason: 'Linked or unsupported file' }); continue; } throw error; }
    const copy = await capture(git.root, path); if (!copy) throw fail('A local setup file disappeared. Refresh the review.');
    bytes += copy.bytes.length; if (bytes > 16 * 1024 * 1024) throw fail('Local setup files exceed the 16 MiB copy limit. Narrow .worktreeinclude before continuing.');
    copies.set(path, copy);
  }
  const finalRules = await capture(git.root, '.worktreeinclude', 32 * 1024);
  if (rules?.identity !== finalRules?.identity || rules?.hash !== finalRules?.hash) throw fail('.worktreeinclude changed while preparing the review. Try again.');
  return {
    public: { files: [...copies].map(([path, copy]) => ({ path, bytes: copy.bytes.length })), skipped, bytes, hasRules: Boolean(rules) }, copies,
    revision: digest([rules?.identity, rules?.hash, selected, ignored, trackedText, skipped, [...copies].map(([path, copy]) => [path, copy.identity, copy.hash, copy.mode])]),
  };
}

export async function applyWorktreeSetup(destination: string, snapshot: WorktreeSetupSnapshot, signal?: AbortSignal) {
  const git = await inspectGit(destination, signal); if (!git) throw fail('The new Git working copy is unavailable.');
  const assertIgnored = async (path: string) => {
    const result = await git.run(['check-ignore', '--quiet', '--', path]);
    if (result.code !== 0 || result.truncated) throw fail('A selected setup file is not ignored in the new copy. Include the project’s .gitignore edits or keep this file local.');
  };
  for (const [path] of snapshot.copies) {
    signal?.throwIfAborted(); const target = await checkedPath(destination, path);
    if (await lstat(target).catch(error => { if (absent(error)) return null; throw error; })) throw fail('A setup-file destination already exists. It was not overwritten; inspect the retained working copy.');
    await assertIgnored(path);
  }
  for (const [path, copy] of snapshot.copies) {
    signal?.throwIfAborted(); const target = await checkedPath(destination, path), parent = dirname(target);
    await mkdir(parent, { recursive: true, mode: 0o700 }); await checkedPath(destination, path); const parentBefore = await lstat(parent);
    const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const created = await handle.stat(); let complete = false;
    try {
      await handle.writeFile(copy.bytes); await handle.chmod(copy.mode); await handle.sync();
      const parentAfter = await lstat(parent), observed = await capture(destination, path);
      if (parentAfter.dev !== parentBefore.dev || parentAfter.ino !== parentBefore.ino || !observed || observed.hash !== copy.hash) throw fail('The setup-file destination changed during copying. Inspect the retained working copy.');
      complete = true;
    } finally {
      await handle.close();
      if (!complete) { const leftover = await lstat(target).catch(() => null); if (leftover?.dev === created.dev && leftover.ino === created.ino && !leftover.isSymbolicLink()) await unlink(target).catch(() => {}); }
    }
  }
  // A selected ignored .gitignore can itself affect later matching. Do not
  // release the working copy to a task if setup files became unignored.
  for (const [path] of snapshot.copies) await assertIgnored(path);
}
