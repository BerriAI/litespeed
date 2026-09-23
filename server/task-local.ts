import { createHash, randomUUID } from 'node:crypto';
import type { TaskLocalPlan } from '../shared/worktrees.js';
import type { Store } from './store.js';
import type { History } from './history.js';
import { inspectGit, operateGit } from './tools.js';
import { startingPoint } from './worktrees.js';
import { applyWorktreeCopy, captureWorktreeCopy } from './worktree-copy.js';
import { observeDiscardFile } from './git-discard-files.js';

const fail = (message: string) => Object.assign(new Error(message), { status: 409 });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Git = NonNullable<Awaited<ReturnType<typeof inspectGit>>>;
async function read(git: Git, args: string[]) {
  const result = await git.run(args);
  if (result.code !== 0 || result.truncated) throw fail('The project could not be reviewed completely. Inspect its Git state before continuing locally.');
  return result.output;
}

/** A reviewed copy back to the original project. It uses a new local branch so
 * the managed working copy, its branch, and any other task using it stay intact. */
export class TaskLocals {
  private plans = new Map<string, { plan: TaskLocalPlan; revision: string; messages: string }>();
  constructor(private store: Store, private history: History) {}
  private session(id: string) {
    if (this.store.isChild(id)) throw fail('Continue a researcher through its parent task.');
    const session = this.store.session(id);
    if (session.archived || !session.worktree || session.worktree.removed || session.status === 'running' || session.status === 'waiting') throw fail('Choose an idle worktree task before continuing in the local project.');
    this.store.profileSnapshot(id); this.history.assertCanMove(id); return session;
  }
  private messages(id: string) { return this.store.messages(id).map(message => message.id).join(','); }
  private async review(id: string, signal?: AbortSignal) {
    const session = this.session(id), record = await this.store.worktrees.ready(session.worktree!.id, signal);
    if (session.workspace !== record.path || session.worktree!.project !== record.project) throw fail('This task’s working copy changed. Reload the task before continuing.');
    const source = await inspectGit(record.path, signal), local = await inspectGit(record.project, signal);
    if (!source || !local || source.root !== record.path || local.root !== record.project || source.commonDir !== record.commonDir || local.commonDir !== source.commonDir) throw fail('The original local project is unavailable or belongs to another repository.');
    const [from, to] = await Promise.all([startingPoint(source), startingPoint(local)]);
    if (from.blocked || to.blocked) throw fail(from.blocked || to.blocked!);
    if (!from.head || !to.head) throw fail('Both working folders need a committed starting point before continuing locally.');
    const localStatus = await read(local, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']);
    if (localStatus) throw fail('The local project has changes. Commit them or move them to another working copy before continuing here. Your worktree is unchanged.');
    const copy = await captureWorktreeCopy(record.path, signal);
    // Review all committed checkout changes, including paths outside the copied
    // local edits. Reject links/submodules and unsupported folder transitions.
    const raw = await read(local, ['diff-tree', '--raw', '--no-abbrev', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-commit-id', '-r', '-z', to.head, from.head, '--']);
    const paths = new Set(copy.files.map(file => file.path)), records = raw.split('\0').filter(Boolean);
    if (records.length % 2 || records.length > 10_000) throw fail('This local checkout changes too many files to review completely. Continue from your terminal.');
    for (let index = 0; index < records.length; index += 2) {
      if (!/^:(?:000000|100644|100755) (?:000000|100644|100755) [a-f0-9]{40,64} [a-f0-9]{40,64} [AMD]$/.test(records[index])) throw fail('The local checkout changes symbolic links, submodules or unsupported file types. Review those changes in your terminal.');
      paths.add(records[index + 1]);
    }
    const affected = [...paths].sort();
    if (affected.length > 5000) throw fail('This local checkout changes too many files to review completely. Continue from your terminal.');
    const index = affected.length ? await read(local, ['--literal-pathspecs', 'ls-files', '-v', '-z', '--', ...affected]) : '';
    const tracked = new Set<string>();
    for (const row of index.split('\0').filter(Boolean)) {
      if (!row.startsWith('H ')) throw fail('A file involved in this move uses special Git index flags. Restore its normal tracking before continuing locally.');
      tracked.add(row.slice(2));
    }
    const observations: unknown[] = []; let bytes = 0;
    for (const path of affected) {
      signal?.throwIfAborted();
      const observed = await observeDiscardFile(local.root, path);
      if (observed.fingerprint && !tracked.has(path)) throw fail(`${path} already exists in the local project outside Git. Move it aside before continuing locally.`);
      bytes += observed.fingerprint?.size ?? 0;
      if (bytes > 32 * 1024 * 1024) throw fail('The local checkout affects more than 32 MiB of existing files. Review this move in your terminal.');
      observations.push([path, observed.fingerprint, observed.identity]);
    }
    const confirmed = await Promise.all([startingPoint(source), startingPoint(local)]);
    if (JSON.stringify(confirmed) !== JSON.stringify([from, to])) throw fail('A project changed during review. Review the local copy again.');
    return { session, record, source, local, from, to, copy, changedFiles: records.length / 2, revision: digest([record.gitDir, record.commonDir, local.gitDir, from, to, localStatus, index, observations, copy.revision]) };
  }
  async prepare(id: string, expectedConfigRevision: number, signal?: AbortSignal): Promise<TaskLocalPlan> {
    const result = await this.review(id, signal), { session, record, from, to, copy } = result;
    if (session.configRevision !== expectedConfigRevision) throw fail('The task configuration changed. Reload it before continuing.');
    const planId = randomUUID(), branch = `litespeed/local-${record.name.toLowerCase()}-${planId.slice(0, 8)}`;
    const plan: TaskLocalPlan = { id: planId, sessionId: id, worktreeId: record.id, from: record.path, project: record.project, sourceBranch: from.current, head: from.head!, previousBranch: to.current, previousHead: to.head!, branch, changedFiles: result.changedFiles, localEdits: { files: copy.files, bytes: copy.bytes }, configRevision: session.configRevision!, historyRevision: session.historyRevision ?? 0, expiresAt: Date.now() + 10 * 60_000 };
    for (const [id, saved] of this.plans) if (saved.plan.expiresAt < Date.now()) this.plans.delete(id);
    while (this.plans.size >= 100) this.plans.delete(this.plans.keys().next().value!);
    this.plans.set(plan.id, { plan, revision: result.revision, messages: this.messages(id) }); return plan;
  }
  async apply(id: string, planId: string, signal?: AbortSignal) {
    const saved = this.plans.get(planId), plan = saved?.plan;
    if (!plan || plan.sessionId !== id || plan.expiresAt < Date.now()) throw fail('This local continuation review expired. Review the project again.');
    this.plans.delete(planId);
    const session = this.session(id);
    if (session.configRevision !== plan.configRevision || (session.historyRevision ?? 0) !== plan.historyRevision || this.messages(id) !== saved!.messages) throw fail('The task changed after review. Review it again before continuing locally.');
    const current = await this.review(id, signal);
    if (current.revision !== saved!.revision) throw fail('The project or worktree changed after review. Refresh the review before continuing locally.');
    const exists = await current.local.run(['show-ref', '--verify', '--quiet', `refs/heads/${plan.branch}`]);
    if (exists.code !== 1) throw fail('The proposed local branch is already present or could not be checked. Review a new branch.');
    let started = false;
    try {
      started = true;
      const result = await operateGit(plan.project, ['switch', '--no-guess', '--no-track', '--no-overwrite-ignore', '--no-recurse-submodules', '--no-discard-changes', '-c', plan.branch, '--', plan.head], signal, { isolatedCheckout: true });
      if (result.code !== 0 || result.truncated) throw fail('Git could not prepare the local branch. Inspect the local folder before retrying; no forced checkout was used.');
      const state = await startingPoint(current.local);
      if (state.head !== plan.head || state.current !== plan.branch || state.blocked) throw fail('The local branch changed during checkout. Inspect it before continuing.');
      await applyWorktreeCopy(plan.project, current.copy, signal);
      const source = await startingPoint(current.source), local = await startingPoint(current.local);
      if (source.head !== plan.head || source.current !== plan.sourceBranch || local.head !== plan.head || local.current !== plan.branch || source.blocked || local.blocked || (await captureWorktreeCopy(plan.from, signal)).revision !== current.copy.revision) throw fail('A working folder changed while copying. Inspect both folders before continuing.');
      return { session: this.history.moveToLocal(id, plan.worktreeId, plan.configRevision, plan.historyRevision), branch: plan.branch };
    } catch (error) {
      if (!started) throw error;
      throw fail(`The task remains in its worktree. Inspect ${plan.project} and branch ${plan.branch}; any copied files and the original worktree were retained. ${error instanceof Error ? error.message : ''}`);
    }
  }
}
