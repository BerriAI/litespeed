import type { TaskWorktreePlan } from '../shared/worktrees.js';
import type { Store } from './store.js';
import type { History } from './history.js';

const fail = (message: string) => Object.assign(new Error(message), { status: 409 });

/** Continue an existing task in a new copy, without changing its source files.
 * Git creation uses the ordinary retained-worktree recovery lifecycle. */
export class TaskWorktrees {
  private plans = new Map<string, { plan: TaskWorktreePlan; messages: string }>();
  constructor(private store: Store, private history: History) {}
  private session(id: string) {
    if (this.store.isChild(id)) throw fail('Continue a researcher through its parent task.');
    const session = this.store.session(id);
    if (session.archived || session.worktree || session.status === 'running' || session.status === 'waiting') throw fail('Choose an idle local task before moving it to a worktree.');
    this.store.profileSnapshot(id); this.history.assertCanMove(id); return session;
  }
  async prepare(id: string, name: string, includeLocalSetup: boolean, expectedConfigRevision: number, signal?: AbortSignal) {
    const session = this.session(id);
    if (session.configRevision !== expectedConfigRevision) throw fail('The task configuration changed. Reload it before continuing.');
    const plan = await this.store.worktrees.prepare(session.workspace, name, signal, undefined, true, includeLocalSetup);
    if (plan.project !== session.workspace) throw fail('Start from the repository root to move this task into a worktree.');
    const result: TaskWorktreePlan = { ...plan, sessionId: id, configRevision: session.configRevision!, historyRevision: session.historyRevision ?? 0 };
    for (const [id, entry] of this.plans) if (entry.plan.expiresAt < Date.now()) this.plans.delete(id);
    while (this.plans.size >= 100) this.plans.delete(this.plans.keys().next().value!);
    this.plans.set(plan.id, { plan: result, messages: this.messageRevision(id) }); return result;
  }
  private messageRevision(id: string) { return this.store.messages(id).map(message => message.id).join(','); }
  async apply(id: string, planId: string, signal?: AbortSignal) {
    const saved = this.plans.get(planId), plan = saved?.plan;
    if (!plan || plan.sessionId !== id || plan.expiresAt < Date.now()) throw fail('This task move review expired. Review the working copy again.');
    this.plans.delete(planId);
    const session = this.session(id);
    if (session.workspace !== plan.project || session.configRevision !== plan.configRevision || (session.historyRevision ?? 0) !== plan.historyRevision || this.messageRevision(id) !== saved!.messages) throw fail('The task changed after review. Review its current state before moving it.');
    const worktree = await this.store.worktrees.create(plan.project, plan.id, signal);
    try { return { worktree, session: this.history.moveToWorktree(id, worktree.id, plan.configRevision, plan.historyRevision) }; }
    catch (error) { throw fail(`The working copy was created at ${worktree.path}, but the task stayed in its original folder. Open Working copies to inspect it. ${error instanceof Error ? error.message : ''}`); }
  }
}
