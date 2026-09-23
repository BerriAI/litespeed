import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { inspectGit, protectedPath, readFile, resolveWorkspacePath } from './tools.js';
import type { GitFileDiff, GitReview, GitReviewEntry, GitReviewScope } from '../shared/git-review.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Inspection = NonNullable<Awaited<ReturnType<typeof inspectGit>>>;
const safePath = (path: string, root: string) => Boolean(path) && path.length <= 4096 && !isAbsolute(path) && !/[\0\\]/.test(path) && !path.split('/').some(part => part === '..' || part.toLowerCase() === '.git') && !protectedPath(path, root);
const failed = (message: string) => Object.assign(new Error(message), { status: 400 });
async function oid(git: Inspection, ref: string): Promise<string | null> {
  const result = await git.run(['rev-parse', '--verify', '--end-of-options', ref]);
  const value = result.output.trim();
  return result.code === 0 && /^[a-f0-9]{40,64}$/.test(value) ? value : null;
}
async function review(git: Inspection, scope: GitReviewScope, requestedBase?: string): Promise<GitReview> {
  const [head, branchResult, refsResult] = await Promise.all([oid(git, 'HEAD^{commit}'), git.run(['symbolic-ref', '--quiet', '--short', 'HEAD']), git.run(['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'])]);
  if (refsResult.code !== 0 || refsResult.truncated) throw failed('The branch list could not be read completely.');
  const refs = refsResult.output.trim().split('\n').filter(Boolean);
  let baseRef = requestedBase || ['main', 'master', 'origin/main', 'origin/master'].find(ref => refs.includes(ref)) || refs[0] || null;
  let base: string | null = null;
  if (scope === 'branch' && head && baseRef) {
    if (!refs.includes(baseRef) && !/^[a-f0-9]{40,64}$/.test(baseRef)) throw failed('Choose a branch from this repository.');
    const baseCommit = await oid(git, `${baseRef}^{commit}`);
    if (!baseCommit) throw failed('The comparison branch is no longer available. Refresh and choose another.');
    const result = await git.run(['merge-base', head, baseCommit]);
    if (result.code !== 0 || !/^[a-f0-9]{40,64}$/.test(result.output.trim())) throw failed('These branches do not share a common ancestor.');
    base = result.output.trim();
  }
  const flags = ['--no-ext-diff', '--no-textconv', '--ignore-submodules=all', '--no-renames', '--numstat', '-z'];
  const result = scope === 'branch' && (!head || !base) ? { output: '', code: 0, truncated: false } : await git.run(['diff', ...flags, ...(scope === 'staged' ? ['--cached'] : scope === 'branch' ? [base!, head!] : []), '--']);
  if (result.code !== 0) throw failed('Git could not read this comparison. Refresh and try again.');
  const records = result.output.split('\0'); records.pop();
  const files: GitReviewEntry[] = [];
  for (const record of records) {
    const match = /^(-|\d+)\t(-|\d+)\t([\s\S]+)$/.exec(record);
    if (!match || !safePath(match[3], git.root)) continue;
    const entry: GitReviewEntry = { path: match[3], status: 'modified', additions: match[1] === '-' ? null : Number(match[1]), deletions: match[2] === '-' ? null : Number(match[2]) };
    const index = files.findIndex(file => file.path === entry.path);
    if (index < 0) files.push(entry); else files[index] = entry;
  }
  const names = scope === 'branch' && (!head || !base) ? { output: '', code: 0, truncated: false } : await git.run(['diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', '--no-renames', '--name-status', '-z', ...(scope === 'staged' ? ['--cached'] : scope === 'branch' ? [base!, head!] : []), '--']);
  const pairs = names.output.split('\0');
  if (names.code !== 0) throw failed('Git could not read file status for this comparison.');
  for (let i = 0; i + 1 < pairs.length; i += 2) { const file = files.find(file => file.path === pairs[i + 1]); if (file && file.status !== 'conflicted') file.status = pairs[i] === 'U' ? 'conflicted' : pairs[i] === 'A' ? 'added' : pairs[i] === 'D' ? 'deleted' : 'modified'; }
  let limited = result.truncated || names.truncated;
  if (scope === 'unstaged') {
    const untracked = await git.run(['ls-files', '--others', '--exclude-standard', '-z']);
    if (untracked.code !== 0) throw failed('Git could not list untracked files.');
    limited ||= untracked.truncated;
    const paths = untracked.output.split('\0'); paths.pop();
    for (const path of paths) if (safePath(path, git.root)) files.push({ path, status: 'added', additions: null, deletions: 0, untracked: true });
  }
  limited ||= files.length > 500;
  const visible = files.slice(0, 500).sort((a, b) => a.path.localeCompare(b.path));
  return { isRepo: true, branch: branchResult.code === 0 ? branchResult.output.trim() : 'Detached HEAD', head, base, baseRef, refs, scope, files: visible, limited, revision: hash([head, base, scope, visible]) };
}
export async function gitReview(workspace: string, scope: GitReviewScope, base?: string, signal?: AbortSignal): Promise<GitReview> {
  const git = await inspectGit(workspace, signal);
  return git ? review(git, scope, base) : { isRepo: false, branch: '', head: null, base: null, baseRef: null, refs: [], scope, files: [], limited: false, revision: hash([]) };
}

async function blob(git: Inspection, ref: string | null, path: string) {
  if (ref === null) return { text: null };
  const object = await oid(git, `${ref}:${path}`);
  if (!object) return { text: null };
  const type = await git.run(['cat-file', '-t', object]);
  if (type.output.trim() !== 'blob') return { text: null, notice: 'Submodule changes are listed without an inline file preview.' };
  const size = await git.run(['cat-file', '-s', object]);
  if (!/^\d+$/.test(size.output.trim()) || Number(size.output) > 60 * 1024) return { text: null, truncated: true, notice: 'This file is too large for an inline Git preview. Open the file to inspect its contents.' };
  const content = await git.run(['cat-file', 'blob', object]);
  if (content.code !== 0) throw failed('Git could not read this file revision.');
  if (content.truncated) return { text: null, truncated: true, notice: 'The file preview was truncated. Open the file to inspect its contents.' };
  if (content.output.includes('\0') || content.output.includes('\ufffd')) return { text: null, binary: true, notice: 'Binary files are listed without an inline text comparison.' };
  return { text: content.output };
}
async function workingFile(git: Inspection, path: string) {
  const lexical = join(git.root, path);
  try {
    const resolved = await resolveWorkspacePath(git.root, path);
    const info = await lstat(lexical);
    if (resolved !== lexical || info.isSymbolicLink()) return { text: null, notice: 'Symbolic links are listed without following their targets.' };
    if (!info.isFile()) return { text: null, notice: 'This change is not a regular text file.' };
    if (info.size > 60 * 1024) return { text: null, truncated: true, notice: 'This file is too large for an inline Git preview. Open the file to inspect its contents.' };
    const value = await readFile(git.root, path);
    if (value.truncated) return { text: null, truncated: true, notice: 'The file changed while it was being read. Refresh the comparison.' };
    return { text: value.content };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return { text: null };
    if (error instanceof Error && /binary|UTF-8/i.test(error.message)) return { text: null, binary: true, notice: 'Binary files are listed without an inline text comparison.' };
    return { text: null, notice: 'This file cannot be previewed safely. Open the project to inspect the change.' };
  }
}
export async function gitFileDiff(workspace: string, scope: GitReviewScope, path: string, base?: string, signal?: AbortSignal): Promise<GitFileDiff> {
  if (!safePath(path, workspace)) throw failed('Choose a regular project file to review.');
  const git = await inspectGit(workspace, signal);
  if (!git) throw failed('This project is not a Git repository.');
  const summary = await review(git, scope, base), entry = summary.files.find(file => file.path === path);
  if (!entry) throw Object.assign(new Error('This file is no longer in the selected comparison. Refresh the changes.'), { status: 404 });
  if (entry.status === 'conflicted') return { path, before: null, after: null, revision: summary.revision, notice: 'This file has an unresolved merge conflict. Open the current file to inspect its conflict markers.' };
  const [before, after] = await Promise.all([
    blob(git, scope === 'unstaged' ? '' : scope === 'staged' ? summary.head : summary.base, path),
    scope === 'unstaged' ? workingFile(git, path) : blob(git, scope === 'staged' ? '' : summary.head, path),
  ]);
  const notice = before.notice || after.notice || (before.text === after.text ? 'File contents are unchanged. Git is tracking a file metadata change.' : undefined);
  return { path, before: before.text, after: after.text, revision: hash([scope, path, before, after]), ...(notice ? { notice } : {}), ...(before.binary || after.binary ? { binary: true } : {}), ...(before.truncated || after.truncated ? { truncated: true } : {}) };
}
