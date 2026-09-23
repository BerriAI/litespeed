import { createHash, randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { inspectGit, operateGit, protectedPath, resolveWorkspacePath } from './tools.js';
import type { GitBranchEntry, GitBranches, GitBranchRequest, GitBranchPlan, GitBranchResult } from '../shared/git-branches.js';

const branchName = z.string().min(1).max(250).refine(value => !value.startsWith('-') && !/[\x00-\x20\x7f]/.test(value) && !value.includes('@{'), 'Choose a valid branch name.');
export const gitBranchRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('switch'), ref: z.string().startsWith('refs/heads/').max(512) }).strict(),
  z.object({ action: z.literal('create'), name: branchName }).strict(),
  z.object({ action: z.literal('track'), ref: z.string().startsWith('refs/remotes/').max(512), name: branchName }).strict(),
]);
const fail = (message: string, status = 409) => Object.assign(new Error(message), { status });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Inspection = NonNullable<Awaited<ReturnType<typeof inspectGit>>>;

async function snapshot(git: Inspection, includeIndex = true) {
  const [head, branch, refs, status, index] = await Promise.all([
    git.run(['rev-parse', '--verify', 'HEAD^{commit}']),
    git.run(['symbolic-ref', '--quiet', 'HEAD']),
    git.run(['for-each-ref', '--count=501', '--sort=-committerdate', '--format=%(refname)%00%(objectname)%00%(upstream:short)%00%(symref)%00%(worktreepath)%00', 'refs/heads', 'refs/remotes']),
    git.run(['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--ignore-submodules=none']),
    includeIndex ? git.run(['ls-files', '--stage', '-z']) : Promise.resolve({ code: 0, truncated: false, output: '' }),
  ]);
  if (refs.code !== 0 || refs.truncated || status.code !== 0 || status.truncated || index.code !== 0 || index.truncated || head.truncated || branch.truncated) throw fail('This repository is too large or unavailable to inspect completely. Check it in your terminal.');
  const entries: GitBranchEntry[] = [], fields = refs.output.split('\0');
  for (let offset = 0; offset + 4 < fields.length; offset += 5) {
    const ref = fields[offset].replace(/^\n/, ''), sha = fields[offset + 1], upstream = fields[offset + 2], symbolic = fields[offset + 3], checkedOutAt = fields[offset + 4];
    if (symbolic) continue;
    if (!/^refs\/(heads|remotes)\/[^\0\r\n]+$/.test(ref) || !/^[a-f0-9]{40,64}$/.test(sha)) throw fail('The branch list changed or could not be read. Refresh and try again.');
    entries.push({ ref, name: ref.replace(/^refs\/(heads|remotes)\//, ''), kind: ref.startsWith('refs/heads/') ? 'local' : 'remote', head: sha, ...(upstream ? { upstream } : {}), ...(checkedOutAt ? { checkedOutAt } : {}) });
  }
  let changedFiles = 0, conflicts = false;
  const records = status.output.split('\0');
  for (let offset = 0; offset < records.length && records[offset]; offset++) {
    changedFiles++; const state = records[offset].slice(0, 2);
    if (state.includes('U') || ['AA', 'DD'].includes(state)) conflicts = true;
    if (/[RC]/.test(state)) offset++;
  }
  let blocked: string | undefined;
  if (conflicts) blocked = 'Resolve the merge conflicts before changing branches.';
  else for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'BISECT_START']) {
    if (await lstat(join(git.gitDir, marker)).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) { blocked = 'Finish or cancel the current merge, rebase or other Git operation before changing branches.'; break; }
  }
  const current = branch.code === 0 && branch.output.trim().startsWith('refs/heads/') ? branch.output.trim().slice(11) : null;
  const commit = head.code === 0 && /^[a-f0-9]{40,64}$/.test(head.output.trim()) ? head.output.trim() : null;
  const publicState: GitBranches = { isRepo: true, current, head: commit, entries: entries.slice(0, 500), changedFiles, limited: Math.floor((fields.length - 1) / 5) > 500, ...(blocked ? { blocked } : {}) };
  return { public: publicState, revision: digest([branch.output, head.output, refs.output, status.output, index.output, blocked]) };
}

/** Branch operations never force a checkout, stash edits or fetch implicitly. */
export class GitBranchesService {
  private plans = new Map<string, { public: GitBranchPlan; input: GitBranchRequest; workspace: string; revision: string }>();
  async list(workspace: string, signal?: AbortSignal): Promise<GitBranches> {
    const git = await inspectGit(workspace, signal);
    return git ? (await snapshot(git, false)).public : { isRepo: false, current: null, head: null, entries: [], changedFiles: 0, limited: false };
  }
  private async review(workspace: string, input: GitBranchRequest, signal?: AbortSignal) {
    const git = await inspectGit(workspace, signal); if (!git) throw fail('This project is not a Git repository.', 400);
    const state = await snapshot(git), current = state.public;
    if (current.blocked) throw fail(current.blocked);
    let name: string, target: GitBranchEntry | undefined;
    if (input.action !== 'create') {
      target = current.entries.find(entry => entry.ref === input.ref && entry.kind === (input.action === 'switch' ? 'local' : 'remote'));
      if (!target) throw fail('This branch is no longer in the available list. Refresh and try again.');
      if (current.changedFiles) throw fail('Commit or discard the current changes before switching branches. You can create a new branch from the current one and keep your edits.');
      if (target.checkedOutAt && target.checkedOutAt !== git.root) throw fail('This branch is open in another working copy. Open that project or choose another branch.');
      if (input.action === 'switch' && target.name === current.current) throw fail('This project is already on that branch.');
      // A branch checkout can touch files outside the visible review filter.
      // Apply the same project-file boundary to every path it may replace.
      const changed = await git.run(current.head ? ['diff-tree', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-commit-id', '--name-only', '-r', '-z', current.head, target.head, '--'] : ['ls-tree', '-r', '--name-only', '-z', target.head]);
      const paths = changed.output.split('\0').filter(Boolean);
      if (changed.code !== 0 || changed.truncated || paths.length > 5000) throw fail('This branch changes too many files to review completely here. Switch branches from your terminal.');
      for (const path of paths) {
        signal?.throwIfAborted();
        if (protectedPath(path, git.root)) throw fail('This branch changes protected files. Review and switch branches from your terminal.');
        const absolute = join(git.root, path);
        try {
          if (await resolveWorkspacePath(git.root, path, { allowMissing: true }) !== absolute) throw fail('This branch changes linked files. Review and switch branches from your terminal.');
          const info = await lstat(absolute).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
          if (info && (info.isSymbolicLink() || info.isFile() && info.nlink !== 1)) throw fail('This branch changes linked files. Review and switch branches from your terminal.');
        } catch (error) { if (error instanceof Error && 'status' in error) throw error; throw fail('A file affected by this branch cannot be safely opened. Review and switch branches from your terminal.'); }
      }
    }
    name = input.action === 'switch' ? target!.name : input.name;
    const valid = await git.run(['check-ref-format', '--branch', name]);
    if (valid.code !== 0 || valid.output.trim() !== name || name.startsWith('-') || name.includes('@{')) throw fail('Choose a valid branch name without spaces or special ref syntax.', 400);
    if (input.action !== 'switch') {
      const exists = await git.run(['show-ref', '--verify', '--quiet', `refs/heads/${name}`]);
      if (exists.code === 0 || current.current === name) throw fail('A local branch with this name already exists. Choose another name.');
      if (exists.code !== 1) throw fail('Git could not check whether this branch exists.');
    }
    return { revision: state.revision, current, name, head: target?.head ?? current.head, upstream: input.action === 'track' ? target!.name : undefined };
  }
  async prepare(workspace: string, request: GitBranchRequest, signal?: AbortSignal): Promise<GitBranchPlan> {
    const input = gitBranchRequestSchema.parse(request), state = await this.review(workspace, input, signal);
    const plan: GitBranchPlan = { id: randomUUID(), action: input.action, from: state.current.current || `Detached at ${state.current.head?.slice(0, 7) || 'unknown'}`, name: state.name, head: state.head, changedFiles: state.current.changedFiles, expiresAt: Date.now() + 10 * 60_000, ...(state.upstream ? { upstream: state.upstream } : {}) };
    for (const [id, saved] of this.plans) if (saved.public.expiresAt < Date.now()) this.plans.delete(id);
    while (this.plans.size >= 100) this.plans.delete(this.plans.keys().next().value!);
    this.plans.set(plan.id, { public: plan, workspace, input, revision: state.revision }); return plan;
  }
  async apply(workspace: string, id: string, signal?: AbortSignal): Promise<GitBranchResult> {
    const saved = this.plans.get(id);
    if (!saved || saved.workspace !== workspace || saved.public.expiresAt < Date.now()) throw fail('This branch review expired. Refresh before continuing.');
    this.plans.delete(id);
    const state = await this.review(workspace, saved.input, signal);
    if (state.revision !== saved.revision) throw fail('The branches or project changed after review. Refresh and review the branch again.');
    const flags = ['switch', '--no-guess', '--no-overwrite-ignore', '--no-recurse-submodules', '--no-discard-changes'];
    const args = saved.input.action === 'switch' ? [...flags, '--', state.name] : saved.input.action === 'track' ? [...flags, '--track=direct', '-c', state.name, '--', saved.input.ref] : [...flags, '--no-track', '-c', state.name, ...(state.head ? ['--', state.head] : [])];
    const result = await operateGit(workspace, args, signal);
    if (result.code !== 0) throw fail('Git could not change branches. Check for files that would be overwritten or a branch open in another working copy, then refresh. No forced checkout was used.');
    const updated = await this.list(workspace, signal);
    if (updated.current !== state.name || updated.head !== state.head) throw fail('The branch changed during the operation. Refresh the project to inspect its current state.');
    return { message: saved.input.action === 'switch' ? `Switched to ${state.name}` : `Created ${state.name}`, current: state.name, head: updated.head };
  }
}
