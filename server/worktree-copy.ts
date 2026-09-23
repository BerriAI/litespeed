import { createHash } from 'node:crypto';
import { inspectGit, operateGit } from './tools.js';
import { observeDiscardFile as observeFile, restoreDiscardFile as restoreFile, sameFingerprint, type FileObservation } from './git-discard-files.js';
import type { WorktreeCopiedFile } from '../shared/worktrees.js';

const fail = (message: string) => Object.assign(new Error(message), { status: 409 });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Entry = { mode: string; object: string };
export type WorktreeCopySnapshot = {
  revision: string; files: WorktreeCopiedFile[]; bytes: number;
  observations: Map<string, FileObservation>; index: Map<string, Entry>; intent: Set<string>;
};
type Git = NonNullable<Awaited<ReturnType<typeof inspectGit>>>;
async function read(git: Git, args: string[]) {
  const result = await git.run(args);
  if (result.code !== 0 || result.truncated) throw fail('The local edits could not be read completely. Start from committed files or reduce this change set.');
  return result.output;
}
function entries(output: string, tree = false) {
  const result = new Map<string, Entry>();
  for (const row of output.split('\0').filter(Boolean)) {
    const match = (tree ? /^(100644|100755) blob ([a-f0-9]{40,64})\t([\s\S]+)$/ : /^(100644|100755) ([a-f0-9]{40,64}) 0\t([\s\S]+)$/).exec(row);
    if (!match) throw fail('Local edits contain a symbolic link, submodule or conflict. Start from committed files, or handle those changes in your terminal.');
    result.set(match[3], { mode: match[1], object: match[2] });
  }
  return result;
}

/** Copies are reviewed against both index objects and actual file bytes. The
 * source is never stashed, reset, cleaned, or written by this operation. */
export async function captureWorktreeCopy(project: string, signal?: AbortSignal): Promise<WorktreeCopySnapshot> {
  const git = await inspectGit(project, signal); if (!git) throw fail('The original Git project is unavailable.');
  const status = await read(git, ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all', '--ignore-submodules=none']);
  const changed = new Map<string, string>();
  for (const row of status.split('\0').filter(Boolean)) {
    const state = row.slice(0, 2), path = row.slice(3);
    if (row[2] !== ' ' || /[URC]/.test(state) || ['AA', 'DD'].includes(state)) throw fail('Resolve the merge conflicts before copying local edits.');
    changed.set(path, (changed.get(path) || '') + state);
  }
  if (changed.size > 200) throw fail('Copy up to 200 changed files at a time. Commit some work, or start from committed files.');
  const paths = [...changed.keys()].sort();
  const [indexText, headText] = paths.length ? await Promise.all([
    read(git, ['--literal-pathspecs', 'ls-files', '--stage', '-z', '--', ...paths]),
    read(git, ['--literal-pathspecs', 'ls-tree', '-z', 'HEAD', '--', ...paths]),
  ]) : ['', ''];
  const index = entries(indexText), head = entries(headText, true), intent = new Set<string>();
  if ([...index.keys(), ...head.keys()].some(path => !changed.has(path))) throw fail('A file changed into a directory. Start from committed files or handle this change in your terminal.');
  for (const object of new Set([...index.values()].map(entry => entry.object))) await read(git, ['cat-file', '-e', `${object}^{blob}`]);
  const observations = new Map<string, FileObservation>(), files: WorktreeCopiedFile[] = []; let bytes = 0;
  for (const path of paths) {
    signal?.throwIfAborted();
    const observation = await observeFile(git.root, path); observations.set(path, observation);
    bytes += observation.fingerprint?.size ?? 0;
    if (bytes > 16 * 1024 * 1024) throw fail('Local edits exceed the 16 MiB copy limit. Commit larger files or start from committed files.');
    // Intent-to-add entries have an index object but no HEAD version and no
    // staged addition. Preserve that distinction from a genuinely staged file.
    if (index.has(path) && !head.has(path) && changed.get(path)![0] === ' ') intent.add(path);
    if (intent.has(path) && !observation.copy) throw fail('An intent-to-add file is missing. Restore it or remove its index entry before copying local edits.');
    files.push({ path, status: changed.get(path)!, bytes: observation.fingerprint?.size ?? 0 });
  }
  return { files, bytes, index, intent, observations, revision: digest([status, indexText, headText, [...observations].map(([path, value]) => [path, value.fingerprint, value.identity])]) };
}

export async function applyWorktreeCopy(destination: string, snapshot: WorktreeCopySnapshot, signal?: AbortSignal) {
  const target = await inspectGit(destination, signal); if (!target) throw fail('The new working copy is unavailable.');
  const clean = await read(target, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']);
  if (clean) throw fail('The new working copy changed before local edits could be copied. Its folder was retained.');
  const tracked = new Set(snapshot.files.length ? (await read(target, ['--literal-pathspecs', 'ls-files', '--cached', '-z', '--', ...snapshot.files.map(file => file.path)])).split('\0').filter(Boolean) : []);
  const before = new Map<string, FileObservation>();
  // Validate every destination before copying any bytes. A checkout-created
  // link, hard link or unexpected path cannot redirect the source snapshots.
  for (const file of snapshot.files) {
    const observed = await observeFile(destination, file.path);
    if (observed.fingerprint && !tracked.has(file.path)) throw fail(`${file.path} appeared outside Git in the destination. Its contents were preserved; inspect the folder before copying local edits.`);
    before.set(file.path, observed);
  }
  for (const file of snapshot.files) {
    signal?.throwIfAborted(); await restoreFile(destination, file.path, before.get(file.path)!, snapshot.observations.get(file.path)!.copy);
  }
  for (const file of snapshot.files) {
    signal?.throwIfAborted(); const entry = snapshot.index.get(file.path);
    const args = entry && !snapshot.intent.has(file.path)
      ? ['update-index', '--add', '--cacheinfo', `${entry.mode},${entry.object},${file.path}`]
      : ['update-index', '--force-remove', '--', file.path];
    const result = await operateGit(destination, args, signal, { isolatedCheckout: true });
    if (result.code !== 0 || result.truncated) throw fail('The local staging state could not be copied completely. Inspect the retained working copy.');
    if (snapshot.intent.has(file.path)) {
      if (!snapshot.observations.get(file.path)!.copy) throw fail('An intent-to-add file is missing. Inspect the retained working copy before continuing.');
      const result = await operateGit(destination, ['add', '--intent-to-add', '--', file.path], signal, { isolatedCheckout: true });
      if (result.code !== 0 || result.truncated) throw fail('An intent-to-add entry could not be copied. Inspect the retained working copy.');
    }
  }
  for (const file of snapshot.files) {
    signal?.throwIfAborted();
    if (!sameFingerprint((await observeFile(destination, file.path)).fingerprint, snapshot.observations.get(file.path)!.fingerprint)) throw fail('The new working copy changed while copying local edits. Its folder was retained for inspection.');
  }
  const copiedIndex = snapshot.files.length ? entries(await read(target, ['--literal-pathspecs', 'ls-files', '--stage', '-z', '--', ...snapshot.files.map(file => file.path)])) : new Map<string, Entry>();
  if (digest([...copiedIndex].sort()) !== digest([...snapshot.index].sort())) throw fail('The new working copy staging state changed while copying local edits. Inspect its retained folder.');
}
