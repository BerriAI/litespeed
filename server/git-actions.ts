import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { gitReview } from './git-review.js';
import { inspectGit, operateGit, protectedPath, resolveWorkspacePath } from './tools.js';
import type { GitAction, GitActionPlan, GitActionResult } from '../shared/git-review.js';

const fail = (message: string, status = 409) => Object.assign(new Error(message), { status });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safePath = (path: string, root: string) => path.length > 0 && path.length <= 4096 && !isAbsolute(path) && !/[\0\\]/.test(path) && !path.split('/').some(part => part === '..' || part.toLowerCase() === '.git') && !protectedPath(path, root);
const redact = (value: string) => value.replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, 4000);
interface StoredPlan { public: GitActionPlan; workspace: string; revision: string; head: string | null; }

async function workingRevision(root: string, path: string) {
  const absolute = join(root, path);
  try {
    if (await resolveWorkspacePath(root, path, { allowMissing: true }) !== absolute) throw fail('Stage symbolic links from your terminal.');
    const info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw fail('Only regular project files can be staged here.');
    if (info.size > 50 * 1024 * 1024) throw fail('Stage files larger than 50 MB from your terminal.');
    const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const current = await handle.stat();
      if (!current.isFile() || current.nlink !== 1 || current.size > 50 * 1024 * 1024 || current.ino !== info.ino || current.dev !== info.dev) throw fail('This file changed. Refresh before staging it.');
      const hash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024); let offset = 0;
      while (true) { const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset); if (!bytesRead) break; offset += bytesRead; if (offset > 50 * 1024 * 1024) throw fail('This file changed. Refresh before staging it.'); hash.update(buffer.subarray(0, bytesRead)); }
      const after = await handle.stat();
      if (after.size !== current.size || after.mtimeMs !== current.mtimeMs || after.ctimeMs !== current.ctimeMs) throw fail('This file changed. Refresh before staging it.');
      return [path, hash.digest('hex'), current.mode];
    } finally { await handle.close(); }
  } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [path, null]; throw error; }
}

async function snapshot(workspace: string, action: GitAction, paths?: string[], signal?: AbortSignal) {
  const git = await inspectGit(workspace, signal);
  if (!git) throw fail('This project is not a Git repository.', 400);
  const summary = await gitReview(workspace, action === 'stage' ? 'unstaged' : 'staged', undefined, signal);
  const index = await git.run(['ls-files', '--stage', '-z']);
  if (index.code !== 0 || index.truncated) throw fail('This index is too large to review completely here. Use your terminal.');
  const staged = await git.run(['diff', '--cached', '--name-only', '--no-ext-diff', '--no-textconv', '-z', '--']);
  if (staged.code !== 0 || staged.truncated) throw fail('The staged files could not be read completely.');
  const stagedPaths = staged.output.split('\0').filter(Boolean);
  if (action === 'commit' && stagedPaths.some(path => !safePath(path, git.root))) throw fail('The index includes protected files. Review and commit them from your terminal.');
  if (/^\d+ [a-f0-9]+ [123]\t/m.test(index.output.replaceAll('\0', '\n'))) throw fail('Resolve the merge conflicts before changing Git state here.');
  if (summary.limited) throw fail('This change set is too large to review completely here. Use your terminal.');
  const files = action === 'push' ? [] : action === 'commit' ? stagedPaths : paths ?? summary.files.map(file => file.path);
  if (action !== 'push' && !files.length) throw fail(action === 'commit' ? 'Stage changes before committing.' : 'There are no files for this action.');
  if (files.length > 500 || new Set(files).size !== files.length || files.some(path => !safePath(path, git.root))) throw fail('Choose regular project files for this action.', 400);
  if (action === 'stage' || action === 'unstage') for (const path of files) if (!summary.files.some(file => file.path === path)) throw fail('These changes are out of date. Refresh and try again.');
  const working: unknown[] = [];
  if (action === 'stage') for (const path of files) { signal?.throwIfAborted(); working.push(await workingRevision(git.root, path)); }
  let destination: GitActionPlan['destination'];
  if (action === 'push') {
    if (!summary.head || summary.branch === 'Detached HEAD') throw fail('Check out a branch with a commit before pushing.');
    const upstream = await git.run(['for-each-ref', '--format=%(upstream:remotename)%00%(upstream:remoteref)', `refs/heads/${summary.branch}`]);
    if (upstream.code !== 0 || upstream.truncated) throw fail('Git could not read this branch’s upstream.');
    const [remoteName, remoteRef] = upstream.output.trim().split('\0');
    const remote = remoteName || 'origin';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(remote) || remote === '.') throw fail('Push this branch from your terminal.');
    const result = await operateGit(workspace, ['remote', 'get-url', '--push', '--all', remote], signal);
    const urls = result.output.trim().split('\n').filter(Boolean);
    if (result.code !== 0 || result.truncated || urls.length !== 1) throw fail('Set one push destination for this branch in Git, then try again.');
    const branch = remoteRef?.startsWith('refs/heads/') ? remoteRef.slice(11) : summary.branch;
    destination = { remote, branch, url: redact(urls[0]).replace(/[?#].*$/, '') };
    return { files, branch: summary.branch, head: summary.head, destination, revision: digest([summary.head, summary.branch, destination, urls[0]]) };
  }
  return { files, branch: summary.branch, head: summary.head, destination, revision: digest([summary.head, summary.branch, index.output, files, working]) };
}

/** Prepared operations are short-lived and single-use. A stale comparison
 * never silently stages, commits, or pushes newly changed content. */
export class GitActions {
  private plans = new Map<string, StoredPlan>();
  async prepare(workspace: string, action: GitAction, paths?: string[], signal?: AbortSignal): Promise<GitActionPlan> {
    for (const [id, plan] of this.plans) if (plan.public.expiresAt < Date.now()) this.plans.delete(id);
    if (this.plans.size >= 100) this.plans.delete(this.plans.keys().next().value!);
    const state = await snapshot(workspace, action, paths, signal);
    const plan: GitActionPlan = { id: randomUUID(), action, files: state.files, branch: state.branch, expiresAt: Date.now() + 10 * 60_000, ...(state.destination ? { destination: state.destination } : {}) };
    this.plans.set(plan.id, { public: plan, workspace, revision: state.revision, head: state.head });
    return plan;
  }
  async apply(workspace: string, id: string, message?: string, signal?: AbortSignal): Promise<GitActionResult> {
    const stored = this.plans.get(id);
    if (!stored || stored.workspace !== workspace || stored.public.expiresAt < Date.now()) throw fail('This review expired. Refresh and try again.');
    this.plans.delete(id);
    const { action, files, destination } = stored.public;
    if (action === 'commit' && (!message?.trim() || message.length > 10_000 || message.includes('\0'))) throw fail('Write a commit message first.', 400);
    const current = await snapshot(workspace, action, action === 'stage' || action === 'unstage' ? files : undefined, signal);
    if (current.revision !== stored.revision) throw fail('The files or branch changed after this review. Refresh and review them again.');
    const args = action === 'stage' ? ['add', '--', ...files]
      : action === 'unstage' ? stored.head ? ['reset', '-q', stored.head, '--', ...files] : ['rm', '--cached', '-f', '--ignore-unmatch', '--', ...files]
      : action === 'commit' ? ['commit', '-m', message!.trim()]
      : ['-c', `remote.${destination!.remote}.mirror=false`, 'push', '--porcelain', '--no-follow-tags', '--recurse-submodules=no', destination!.remote, `${stored.head}:refs/heads/${destination!.branch}`];
    const result = await operateGit(workspace, args, signal);
    if (result.code !== 0) throw fail(redact(result.output.trim()) || 'Git could not complete this action. Check the project in your terminal.', 400);
    const updated = await gitReview(workspace, 'staged', undefined, signal).catch(() => null);
    return { action, message: action === 'stage' ? `${files.length} ${files.length === 1 ? 'file' : 'files'} staged` : action === 'unstage' ? `${files.length} ${files.length === 1 ? 'file' : 'files'} unstaged` : action === 'commit' ? `Committed${updated?.head ? ' ' + updated.head.slice(0, 7) : ''}` : `Pushed to ${destination!.remote}/${destination!.branch}`, ...(updated?.head ? { head: updated.head } : {}) };
  }
}
