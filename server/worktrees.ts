import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import type { Store } from './store.js';
import { allowStateWorkspace } from './state-paths.js';
import { inspectGit, operateGit } from './tools.js';
import type { ProjectWorktree, TaskWorktree, WorktreePlan, WorktreeRemovalPlan, WorktreeRestorePlan } from '../shared/worktrees.js';
import { applyWorktreeCopy, captureWorktreeCopy } from './worktree-copy.js';
import { applyWorktreeSetup, captureWorktreeSetup } from './worktree-setup.js';

const fail = (message: string, status = 409) => Object.assign(new Error(message), { status });
export const worktreeName = z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9 _.-]*$/, 'Use letters, numbers, spaces, dots, underscores or dashes.');
export const worktreeStartingRef = z.string().min(1).max(512).regex(/^refs\/(?:heads|remotes)\/[^\x00-\x20\x7f]+$/, 'Choose an existing local or fetched remote branch.');
const sha = /^[a-f0-9]{40,64}$/;
const uuid = /^[a-f0-9-]{36}$/;
const missing = (path: string) => { try { lstatSync(path); return false; } catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; } };
type SavedPlan = { public: WorktreePlan; record: ProjectWorktree; sourceHead: string | null; sourceBranch: string | null; copyRevision?: string; setupRevision?: string; startingRef?: string };
type PullRequestSource = { head: string; branch: string; pullRequest: NonNullable<ProjectWorktree['pullRequest']> };
async function resolveStartingRef(git: NonNullable<Awaited<ReturnType<typeof inspectGit>>>, requested: string) {
  const ref = worktreeStartingRef.parse(requested), valid = await git.run(['check-ref-format', ref]);
  if (valid.code !== 0 || valid.truncated) throw fail('Choose an existing local or fetched remote branch.');
  const result = await git.run(['rev-parse', '--verify', `${ref}^{commit}`]);
  if (result.code !== 0 || result.truncated || !sha.test(result.output.trim())) throw fail('This starting branch is no longer available. Choose it again.');
  return result.output.trim();
}
export async function startingPoint(git: NonNullable<Awaited<ReturnType<typeof inspectGit>>>) {
  const [head, branch, status] = await Promise.all([git.run(['rev-parse', '--verify', 'HEAD^{commit}']), git.run(['symbolic-ref', '--quiet', 'HEAD']), git.run(['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--ignore-submodules=none'])]);
  if (head.truncated || branch.truncated || status.truncated || status.code !== 0 || ![0, 1].includes(branch.code ?? -1)) throw fail('The project starting point could not be read completely. Check its Git state and try again.');
  const commit = head.code === 0 && sha.test(head.output.trim()) ? head.output.trim() : null;
  const current = branch.code === 0 && branch.output.trim().startsWith('refs/heads/') ? branch.output.trim().slice(11) : null;
  let changedFiles = 0, blocked: string | undefined;
  const records = status.output.split('\0');
  for (let index = 0; index < records.length && records[index]; index++) { changedFiles++; const state = records[index].slice(0, 2); if (state.includes('U') || ['AA', 'DD'].includes(state)) blocked = 'Resolve the merge conflicts before creating a worktree.'; if (/[RC]/.test(state)) index++; }
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'BISECT_START']) if (await lstat(join(git.gitDir, marker)).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) { blocked = 'Finish or cancel the current Git operation before continuing.'; break; }
  return { head: commit, current, changedFiles, blocked };
}

/** The registry owns only server-generated paths. Creation retains all files
 * after an interruption; deleting a task never deletes its working copy. */
export class ProjectWorktrees {
  private plans = new Map<string, SavedPlan>();
  private grants = new Map<string, () => void>();
  private removals = new Map<string, WorktreeRemovalPlan>();
  private restorations = new Map<string, WorktreeRestorePlan>();
  private removing = new Set<string>();
  isRemoving(workspace: string) { return this.removing.has(workspace); }
  constructor(private store: Store) {
    store.db.exec('CREATE TABLE IF NOT EXISTS project_worktrees (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
    for (const record of this.records()) {
      if (record.status === 'removed') continue;
      if (record.status === 'removing' && missing(record.path) && record.gitDir && missing(record.gitDir)) { this.markRemoved(record); continue; }
      try { this.grant(record); }
      catch { this.save({ ...record, status: 'error', error: 'The working copy or its Git registration is unavailable. Inspect its folder, then check it again.' }); continue; }
      if (record.status === 'creating' || record.status === 'removing') this.save({ ...record, status: 'error', error: `${record.status === 'creating' ? 'Creation' : 'Removal'} was interrupted. Inspect the retained folder, then check it again.` });
    }
  }
  private directory() { return join(realpathSync(this.store.directory), 'worktrees'); }
  private expected(record: ProjectWorktree) { return join(this.directory(), record.id, record.name); }
  private records(): ProjectWorktree[] {
    return (this.store.db.prepare('SELECT data FROM project_worktrees').all() as { data: string }[]).flatMap(row => {
      try {
        const value = JSON.parse(row.data) as ProjectWorktree;
        if (!uuid.test(value.id) || !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,63}$/.test(value.name) || value.path !== this.expected(value) || !sha.test(value.head) || !value.project || !value.commonDir) return [];
        if (value.snapshot && (!sha.test(value.snapshot.head) || typeof value.snapshot.ref !== 'string' || value.snapshot.ref !== `refs/litespeed/worktrees/${value.id}/${value.snapshot.ref.split('/').at(-1)}` || !uuid.test(value.snapshot.ref.split('/').at(-1)!) || typeof value.snapshot.branch !== 'string' || !Number.isFinite(value.snapshot.createdAt))) return [];
        return [value];
      } catch { return []; }
    });
  }
  private save(record: ProjectWorktree) { this.store.db.prepare('INSERT INTO project_worktrees(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(record.id, JSON.stringify(record)); }
  private grant(record: ProjectWorktree) {
    if (this.grants.has(record.id)) return;
    if (record.path !== this.expected(record) || realpathSync(record.path) !== record.path || !lstatSync(record.path).isDirectory()) throw fail('The working copy folder changed. Inspect it before continuing.');
    const pointer = join(record.path, '.git'), info = lstatSync(pointer);
    if (!info.isFile() || info.nlink !== 1 || info.size > 8192) throw fail('The working copy registration is unavailable.');
    const text = readFileSync(pointer, 'utf8').trimEnd(), gitDir = text.startsWith('gitdir: ') ? resolve(record.path, text.slice(8)) : '';
    if (!gitDir || dirname(gitDir) !== join(record.commonDir, 'worktrees') || realpathSync(gitDir) !== gitDir || record.gitDir && record.gitDir !== gitDir) throw fail('The working copy registration changed.');
    for (const file of ['gitdir', 'commondir']) { const entry = join(gitDir, file), stat = lstatSync(entry); if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8192) throw fail('The working copy registration is unavailable.'); }
    if (resolve(gitDir, readFileSync(join(gitDir, 'gitdir'), 'utf8').trimEnd()) !== pointer || resolve(gitDir, readFileSync(join(gitDir, 'commondir'), 'utf8').trimEnd()) !== record.commonDir) throw fail('The working copy registration changed.');
    this.grants.set(record.id, allowStateWorkspace(record.path));
  }
  list(project?: string, includeRemoved = false) { return this.records().filter(record => (record.status !== 'removed' || includeRemoved && record.snapshot) && (!project || record.project === project)).sort((a, b) => b.createdAt - a.createdAt); }
  get(id: string, includeRemoved = false) { const record = this.records().find(record => record.id === id && (includeRemoved || record.status !== 'removed')); if (!record) throw fail('Working copy not found.', 404); return record; }
  assertUsable(workspace: string) {
    const record = this.records().find(record => record.path === workspace);
    if (record && (record.status !== 'ready' || this.removing.has(workspace))) throw fail(record.status === 'removed' ? 'This working copy was removed. Open its original project or create another worktree.' : 'This working copy needs a registration check. Open Working copies, inspect its folder and choose Check working copy.');
  }
  async ready(id: string, signal?: AbortSignal) {
    const record = this.get(id); if (record.status !== 'ready') throw fail(record.error || 'This working copy is not ready. Inspect its folder before continuing.');
    this.grant(record); const git = await inspectGit(record.path, signal);
    if (!git || git.gitDir !== record.gitDir || git.commonDir !== record.commonDir) throw fail('The working copy registration changed.');
    return record;
  }
  async recover(id: string, signal?: AbortSignal) {
    const record = this.get(id);
    if (record.status === 'error' && !record.gitDir && missing(record.path)) {
      const source = await inspectGit(record.project, signal);
      if (!source || source.commonDir !== record.commonDir) throw fail('The original project must be available to check this interrupted creation.');
      const registered = await source.run(['worktree', 'list', '--porcelain', '-z']);
      if (registered.code !== 0 || registered.truncated || registered.output.split('\0').includes(`worktree ${record.path}`)) throw fail('Git still has a registration for this missing folder. Inspect it in your terminal before checking again.');
      // Nothing was checked out. Retire only the registry entry; never remove
      // files, branches or downloaded commits as part of recovery.
      this.markRemoved(record); return { ...record, status: 'removed' as const, error: undefined };
    }
    this.grant(record); const git = await inspectGit(record.path, signal);
    if (!git || git.commonDir !== record.commonDir || record.gitDir && git.gitDir !== record.gitDir) throw fail('The working copy registration changed. Repair it in your terminal before checking again.');
    const state = await startingPoint(git); if (!state.head) throw fail('The working copy has no readable commit. Inspect it in your terminal.');
    const recovered: ProjectWorktree = { ...record, head: state.head, branch: state.current || record.branch, gitDir: git.gitDir, status: 'ready', error: undefined }; this.store.atomic(() => { this.save(recovered); this.markAvailable(recovered); }); return recovered;
  }
  async prepare(project: string, requestedName: string, signal?: AbortSignal, source?: PullRequestSource, includeLocalEdits = false, includeLocalSetup = false, startingRef?: string): Promise<WorktreePlan> {
    worktreeName.parse(requestedName);
    const git = await inspectGit(project, signal); if (!git) throw fail('Choose a Git project to create a worktree.', 400);
    const state = await startingPoint(git);
    if (!state.head && !source && !startingRef) throw fail('Make the first commit before creating a worktree.');
    if (source && (!sha.test(source.head) || !sha.test(source.pullRequest.base))) throw fail('The pull request commits could not be verified.');
    if (state.blocked) throw fail(state.blocked);
    if (source && (includeLocalEdits || includeLocalSetup || startingRef)) throw fail('Use the pull request starting point for this working copy.');
    if (includeLocalEdits && startingRef && startingRef !== `refs/heads/${state.current}`) throw fail('Local edits can only be copied when starting from the current branch.');
    const selectedHead = startingRef ? await resolveStartingRef(git, startingRef) : undefined;
    const copy = includeLocalEdits ? await captureWorktreeCopy(git.root, signal) : undefined;
    if (this.list().length >= 100) throw fail('There are 100 retained working copies. Remove an unused clean copy before creating another.');
    const id = randomUUID(), name = requestedName.trim().replace(/[ _]+/g, '-').replace(/\.+/g, '.').replace(/[.-]+$/, '') || 'task';
    const branch = `litespeed/${name.toLowerCase()}-${id.slice(0, 8)}`, path = join(this.directory(), id, name);
    const head = source?.head ?? selectedHead ?? state.head!;
    const setup = includeLocalSetup ? await captureWorktreeSetup(git.root, head, signal) : undefined;
    const plan: WorktreePlan = { id, project: git.root, name, branch, head, sourceBranch: source?.branch ?? (startingRef ? startingRef.replace(/^refs\/(?:heads|remotes)\//, '') : state.current), changedFiles: state.changedFiles, path, expiresAt: Date.now() + 10 * 60_000, ...(source ? { pullRequest: source.pullRequest } : {}), ...(copy ? { localEdits: { files: copy.files, bytes: copy.bytes } } : {}), ...(setup ? { localSetup: setup.public } : {}) };
    for (const [id, value] of this.plans) if (value.public.expiresAt < Date.now()) this.plans.delete(id);
    while (this.plans.size >= 100) this.plans.delete(this.plans.keys().next().value!);
    this.plans.set(id, { public: plan, sourceHead: state.head, sourceBranch: state.current, copyRevision: copy?.revision, setupRevision: setup?.revision, startingRef, record: { id, project: git.root, path, name, branch, head, commonDir: git.commonDir, createdAt: Date.now(), status: 'creating', ...(source ? { pullRequest: source.pullRequest } : {}) } });
    return plan;
  }
  async create(project: string, id: string, signal?: AbortSignal, fetchPullRequest?: (plan: WorktreePlan) => Promise<void>): Promise<ProjectWorktree> {
    const saved = this.plans.get(id);
    if (!saved || saved.public.project !== project || saved.public.expiresAt < Date.now()) throw fail('This worktree review expired. Review it again before creating it.');
    this.plans.delete(id);
    const git = await inspectGit(project, signal); if (!git) throw fail('The source project is no longer available.');
    const state = await startingPoint(git);
    if (git.commonDir !== saved.record.commonDir || state.head !== saved.sourceHead || state.current !== saved.sourceBranch || state.blocked) throw fail('The project branch changed. Review the new starting point before creating a worktree.');
    if (saved.record.pullRequest && !fetchPullRequest) throw fail('Use the pull request checkout action to create this working copy.');
    if (saved.startingRef && await resolveStartingRef(git, saved.startingRef) !== saved.public.head) throw fail('The starting branch moved after review. Refresh the review before creating a working copy.');
    const copy = saved.copyRevision ? await captureWorktreeCopy(git.root, signal) : undefined;
    if (copy && copy.revision !== saved.copyRevision) throw fail('Local edits or staging changed after review. Refresh the review before copying them.');
    const setup = saved.setupRevision ? await captureWorktreeSetup(git.root, saved.record.head, signal) : undefined;
    if (setup && setup.revision !== saved.setupRevision) throw fail('Local setup files or patterns changed after review. Refresh the review before copying them.');
    if (copy || setup) {
      const current = await startingPoint(git);
      if (current.head !== saved.sourceHead || current.current !== saved.sourceBranch || current.blocked) throw fail('The project branch changed while reading local edits. Review the starting point again.');
    }
    if (this.list().length >= 100) throw fail('Remove an unused working copy before creating another.');
    await mkdir(this.directory(), { recursive: true, mode: 0o700 });
    if (await realpath(this.directory()) !== this.directory()) throw fail('The working copy storage folder is linked. Choose a regular application data directory.');
    await mkdir(dirname(saved.record.path), { mode: 0o700 });
    if (await lstat(saved.record.path).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) throw fail('The worktree folder already exists. Review a new working copy.');
    let record = saved.record; this.save(record);
    try {
      if (record.pullRequest) {
        await fetchPullRequest!(saved.public);
        for (const commit of [record.head, record.pullRequest.base]) {
          const verified = await git.run(['rev-parse', '--verify', `${commit}^{commit}`]);
          if (verified.code !== 0 || verified.output.trim() !== commit) throw fail('The fetched pull request commits could not be verified.');
        }
        const current = await startingPoint(git);
        if (current.head !== saved.sourceHead || current.current !== saved.sourceBranch || current.blocked) throw fail('The project branch changed while downloading. Review the starting point again.');
      }
      // Worktree creation is a deliberate Git operation, but it does not run
      // checkout hooks or project setup scripts implicitly.
      const result = await operateGit(project, ['-c', `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`, 'worktree', 'add', '--quiet', '--no-track', '-b', record.branch, '--', record.path, record.head], signal, { isolatedCheckout: Boolean(record.pullRequest || copy || setup || saved.startingRef) });
      if (result.code !== 0 || result.truncated) throw fail('Git could not finish creating the worktree. Its folder is retained for inspection.');
      this.grant(record);
      const created = await inspectGit(record.path, signal); if (!created || created.commonDir !== record.commonDir) throw fail('The new worktree registration could not be verified.');
      const actual = await created.run(['rev-parse', '--verify', 'HEAD^{commit}']), branch = await created.run(['symbolic-ref', '--quiet', 'HEAD']);
      if (actual.code !== 0 || actual.output.trim() !== record.head || branch.output.trim() !== `refs/heads/${record.branch}`) throw fail('The working copy changed during creation. Inspect its files before continuing.');
      if (copy) await applyWorktreeCopy(record.path, copy, signal);
      if (setup) await applyWorktreeSetup(record.path, setup, signal);
      if (copy || setup) {
        const finished = await startingPoint(created);
        if (finished.head !== record.head || finished.current !== record.branch || finished.blocked) throw fail('The new working copy branch changed while copying local edits. Inspect its retained folder.');
      }
      record = { ...record, gitDir: created.gitDir, status: 'ready' }; this.save(record); return record;
    } catch (error) {
      this.grants.get(record.id)?.(); this.grants.delete(record.id);
      this.save({ ...record, status: 'error', error: signal?.aborted ? 'Creation was interrupted. The working folder was retained for inspection.' : error instanceof Error ? error.message : 'Worktree creation failed. Inspect its retained folder.' });
      throw error;
    }
  }
  metadata(record: ProjectWorktree): TaskWorktree { return { id: record.id, project: record.project, branch: record.branch, head: record.head, ...(record.snapshot ? { restorable: true } : {}), ...(record.pullRequest ? { pullRequest: record.pullRequest } : {}) }; }
  private async removable(id: string, signal?: AbortSignal) {
    const record = await this.ready(id, signal), git = (await inspectGit(record.path, signal))!;
    const status = await git.run(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching', '--ignore-submodules=none']);
    if (status.code !== 0 || status.truncated || status.output) throw fail('This worktree has modified, untracked or ignored files. Commit, move or remove them before deleting its working copy.');
    const state = await startingPoint(git);
    if (state.blocked) throw fail(state.blocked);
    if (!state.head || !state.current) throw fail('Keep the current commits on a branch before removing this working copy.');
    return { record, state };
  }
  async prepareRemove(id: string, signal?: AbortSignal): Promise<WorktreeRemovalPlan> {
    const { record, state } = await this.removable(id, signal);
    for (const [id, value] of this.removals) if (value.expiresAt < Date.now()) this.removals.delete(id);
    while (this.removals.size >= 100) this.removals.delete(this.removals.keys().next().value!);
    const plan = { id: randomUUID(), worktreeId: id, path: record.path, branch: state.current, head: state.head!, expiresAt: Date.now() + 10 * 60_000 };
    this.removals.set(plan.id, plan); return plan;
  }
  async remove(id: string, planId: string, signal?: AbortSignal) {
    const plan = this.removals.get(planId);
    if (!plan || plan.worktreeId !== id || plan.expiresAt < Date.now()) throw fail('This removal review expired. Review the working copy again.');
    this.removals.delete(planId);
    if (this.removing.has(plan.path)) throw fail('This working copy is already being removed.');
    this.removing.add(plan.path);
    try {
      const { record, state } = await this.removable(id, signal);
      if (state.head !== plan.head || state.current !== plan.branch || record.path !== plan.path) throw fail('The working copy changed since review. Refresh before removing it.');
      const snapshot = { head: state.head!, branch: state.current!, ref: `refs/litespeed/worktrees/${record.id}/${randomUUID()}`, createdAt: Date.now() };
      const pin = await operateGit(record.path, ['update-ref', snapshot.ref, snapshot.head, '0'.repeat(snapshot.head.length)], signal);
      if (pin.code !== 0 || pin.truncated) throw fail('The recovery snapshot could not be saved. The working copy has not been removed.');
      const verified = await this.removable(id, signal);
      if (verified.state.head !== snapshot.head || verified.state.current !== snapshot.branch) throw fail('The working copy changed while saving its recovery commit. Review it again before removing it.');
      const retained = { ...record, head: snapshot.head, branch: snapshot.branch, snapshot };
      this.save({ ...retained, status: 'removing' });
      try {
        const result = await operateGit(record.path, ['worktree', 'remove', '--', record.path], signal);
        if (result.code !== 0) throw fail('Git could not remove this working copy. Check for new files or a locked worktree, then refresh. No forced removal was used.');
        this.markRemoved(retained);
        return { message: 'Working copy removed. Its saved commit, branch and task history are retained.', worktree: this.get(id, true) };
      } catch (error) {
        if (missing(record.path) && record.gitDir && missing(record.gitDir)) this.markRemoved(retained);
        else this.save(retained);
        throw error;
      }
    } finally { this.removing.delete(plan.path); }
  }
  private async restorable(id: string, signal?: AbortSignal) {
    const record = this.get(id, true);
    if (record.status !== 'removed' || !record.snapshot) throw fail('This working copy has no removed snapshot to restore.');
    if (!missing(record.path) || record.gitDir && !missing(record.gitDir)) throw fail('The old working folder or its Git registration is already present. Inspect it before restoring.');
    const git = await inspectGit(record.project, signal);
    if (!git || git.commonDir !== record.commonDir) throw fail('The original repository must be available to restore its working copy.');
    const [pin, registered] = await Promise.all([git.run(['rev-parse', '--verify', `${record.snapshot.ref}^{commit}`]), git.run(['worktree', 'list', '--porcelain', '-z'])]);
    if (pin.code !== 0 || pin.truncated || pin.output.trim() !== record.snapshot.head) throw fail('The saved recovery commit is missing or changed. Inspect the repository before restoring.');
    if (registered.code !== 0 || registered.truncated || registered.output.split('\0').includes(`worktree ${record.path}`)) throw fail('Git already has a registration for this folder. Inspect it before restoring.');
    return record;
  }
  async prepareRestore(id: string, signal?: AbortSignal): Promise<WorktreeRestorePlan> {
    const record = await this.restorable(id, signal), snapshot = record.snapshot!;
    if (this.list().length >= 100) throw fail('Remove an unused working copy before restoring another.');
    for (const [id, plan] of this.restorations) if (plan.expiresAt < Date.now()) this.restorations.delete(id);
    while (this.restorations.size >= 100) this.restorations.delete(this.restorations.keys().next().value!);
    const plan: WorktreeRestorePlan = { id: randomUUID(), worktreeId: id, project: record.project, path: record.path, name: record.name, head: snapshot.head, sourceBranch: snapshot.branch, branch: `litespeed/restored-${record.name.toLowerCase()}-${randomUUID().slice(0, 8)}`, snapshotAt: snapshot.createdAt, expiresAt: Date.now() + 10 * 60_000 };
    this.restorations.set(plan.id, plan); return plan;
  }
  async restore(id: string, planId: string, signal?: AbortSignal): Promise<ProjectWorktree> {
    const plan = this.restorations.get(planId);
    if (!plan || plan.worktreeId !== id || plan.expiresAt < Date.now()) throw fail('This restoration review expired. Review the saved working copy again.');
    this.restorations.delete(planId);
    const record = await this.restorable(id, signal);
    if (record.snapshot!.head !== plan.head || record.snapshot!.createdAt !== plan.snapshotAt || record.path !== plan.path || record.project !== plan.project) throw fail('The saved snapshot changed after review. Review it again.');
    if (this.list().length >= 100) throw fail('Remove an unused working copy before restoring another.');
    await mkdir(this.directory(), { recursive: true, mode: 0o700 });
    if (await realpath(this.directory()) !== this.directory()) throw fail('The working copy storage folder is linked. Inspect it before restoring.');
    await mkdir(dirname(record.path), { recursive: true, mode: 0o700 });
    if (await realpath(dirname(record.path)) !== dirname(record.path) || !missing(record.path)) throw fail('The working copy folder changed. Inspect it before restoring.');
    let restored: ProjectWorktree = { ...record, head: plan.head, branch: plan.branch, gitDir: undefined, status: 'creating', error: undefined }; this.save(restored);
    try {
      const result = await operateGit(record.project, ['-c', `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`, 'worktree', 'add', '--quiet', '--no-track', '-b', plan.branch, '--', record.path, plan.head], signal, { isolatedCheckout: true });
      if (result.code !== 0 || result.truncated) throw fail('Git could not restore the working copy. Its saved commit and any created files are retained.');
      this.grant(restored);
      const git = await inspectGit(restored.path, signal);
      if (!git || git.commonDir !== record.commonDir) throw fail('The restored worktree registration could not be verified.');
      const state = await startingPoint(git);
      if (state.head !== plan.head || state.current !== plan.branch || state.blocked || state.changedFiles) throw fail('The restored working copy changed during checkout. Inspect it before continuing.');
      restored = { ...restored, gitDir: git.gitDir, status: 'ready' }; this.store.atomic(() => { this.save(restored); this.markAvailable(restored); }); return restored;
    } catch (error) {
      this.grants.get(record.id)?.(); this.grants.delete(record.id);
      this.save({ ...restored, status: 'error', error: signal?.aborted ? 'Restoration was interrupted. Check the retained working copy before continuing.' : error instanceof Error ? error.message : 'Restoration failed. Inspect the retained folder.' });
      throw error;
    }
  }
  private markAvailable(record: ProjectWorktree) {
    for (const session of [...this.store.sessions(), ...this.store.sessions('', true)]) if (session.workspace === record.path) {
      this.store.updateSession(session.id, { worktree: this.metadata(record) });
      const queue = this.store.queue(session.id); if (queue.items.length) this.store.saveQueue(session.id, { ...queue, paused: true, reason: 'This working copy was restored. Review queued messages before resuming.' });
    }
  }
  private markRemoved(record: ProjectWorktree) {
    this.grants.get(record.id)?.(); this.grants.delete(record.id);
    this.store.atomic(() => {
      this.save({ ...record, status: 'removed', error: undefined });
      for (const session of [...this.store.sessions(), ...this.store.sessions('', true)]) if (session.workspace === record.path) {
        this.store.updateSession(session.id, { worktree: { ...this.metadata(record), removed: true } });
        const queue = this.store.queue(session.id); if (queue.items.length) this.store.saveQueue(session.id, { ...queue, paused: true, reason: 'This working copy was removed. Restore it or recall the queued messages into another task.' });
      }
    });
  }
  close() { for (const release of this.grants.values()) release(); this.grants.clear(); this.plans.clear(); this.removals.clear(); this.restorations.clear(); }
}
