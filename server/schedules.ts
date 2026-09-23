import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import type { ScheduleList, ScheduleRun, ScheduledTask } from '../shared/schedules.js';
import type { Store } from './store.js';
import type { Runner } from './runner.js';
import type { EventBus } from './events.js';
import { nextOccurrence } from './schedule-time.js';

type TaskInput = Pick<ScheduledTask, 'name' | 'prompt' | 'workspace' | 'timing' | 'selection'>;
const active = ['starting', 'running', 'waiting'];
const conflict = (message: string) => Object.assign(new Error(message), { status: 409 });
const missing = () => Object.assign(new Error('Scheduled task not found.'), { status: 404 });

/** Durable local scheduler. Claims and future occurrences move in one SQLite
 * transaction before dispatch. Interrupted claims are never silently replayed.
 * Missed occurrences are coalesced, and a task cannot overlap its own run. */
export class Schedules {
  private timer?: ReturnType<typeof setInterval>;
  private enabled = false;
  private stopped = false;
  private ticking = false;
  private pending = new Set<Promise<unknown>>();
  private subscriptions = new Map<string, () => void>();
  constructor(private store: Store, private runner: Pick<Runner, 'submit'>, private bus: EventBus, private now = Date.now) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS schedules (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS schedule_runs (id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE, status TEXT NOT NULL, started_at INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS schedule_runs_task ON schedule_runs(schedule_id, started_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS schedule_runs_active ON schedule_runs(schedule_id) WHERE status IN ('starting','running','waiting');`);
    for (const run of this.runningRuns()) this.saveRun({ ...run, status: 'interrupted', endedAt: this.now(), error: 'Litespeed restarted before this run finished. Open its task to review the saved work.' });
  }
  list(): ScheduleList {
    const schedules = (this.store.db.prepare('SELECT data FROM schedules ORDER BY rowid DESC').all() as { data: string }[]).map(row => JSON.parse(row.data) as ScheduledTask);
    const runs = (this.store.db.prepare('SELECT data FROM schedule_runs ORDER BY started_at DESC, rowid DESC LIMIT 100').all() as { data: string }[]).map(row => {
      const run = JSON.parse(row.data) as ScheduleRun;
      if (run.sessionId && !this.store.db.prepare('SELECT 1 FROM sessions WHERE id=?').get(run.sessionId)) run.sessionId = null;
      return run;
    });
    return { schedules, runs, running: this.enabled };
  }
  get(id: string): ScheduledTask {
    const row = this.store.db.prepare('SELECT data FROM schedules WHERE id=?').get(id) as { data: string } | undefined;
    if (!row) throw missing();
    return JSON.parse(row.data);
  }
  create(input: TaskInput): ScheduledTask {
    if (Number((this.store.db.prepare('SELECT COUNT(*) AS count FROM schedules').get() as { count: number }).count) >= 100) throw conflict('You can have up to 100 scheduled tasks. Remove an unused task first.');
    const now = this.now(), nextRunAt = nextOccurrence(input.timing, now, now);
    if (!nextRunAt) throw conflict('Choose a future time for this task.');
    const task: ScheduledTask = { ...input, id: randomUUID(), status: 'active', createdAt: now, updatedAt: now, revision: 0, nextRunAt };
    this.save(task); return task;
  }
  update(id: string, revision: number, patch: Partial<TaskInput> & { status?: 'active' | 'paused' }): ScheduledTask {
    const previous = this.get(id);
    if (previous.revision !== revision) throw conflict('This scheduled task changed. Refresh before saving.');
    const now = this.now(), task = { ...previous, ...patch, updatedAt: now, revision: previous.revision + 1 };
    if (patch.timing || patch.status === 'active' && previous.status !== 'active') {
      task.nextRunAt = nextOccurrence(task.timing, now, task.createdAt);
      if (!task.nextRunAt && task.status === 'active') throw conflict('Choose a future time before resuming this task.');
    }
    if (task.status === 'paused') task.nextRunAt = null;
    this.save(task); return task;
  }
  remove(id: string, revision: number) {
    if (this.get(id).revision !== revision) throw conflict('This scheduled task changed. Refresh before removing it.');
    if (this.runningRuns(id).length) throw conflict('Wait for the current run to finish, or stop it from its task.');
    this.store.db.prepare('DELETE FROM schedules WHERE id=?').run(id);
  }
  start(interval = 15_000) {
    if (this.enabled || this.stopped) return;
    this.enabled = true;
    this.timer = setInterval(() => { void this.tick().catch(() => console.error('Scheduled tasks could not be checked.')); }, interval);
    this.timer.unref();
    void this.tick().catch(() => console.error('Scheduled tasks could not be checked.'));
  }
  async stop() {
    this.enabled = false; this.stopped = true; clearInterval(this.timer);
    await Promise.allSettled([...this.pending]);
    for (const unsubscribe of this.subscriptions.values()) unsubscribe();
    this.subscriptions.clear();
    for (const run of this.runningRuns()) this.saveRun({ ...run, status: 'interrupted', endedAt: this.now(), error: 'Litespeed closed before this run finished. Open its task to review the saved work.' });
  }
  async tick() {
    if (!this.enabled || this.stopped || this.ticking) return;
    this.ticking = true;
    try {
      const now = this.now();
      for (const task of this.list().schedules) {
        if (this.stopped) break;
        if (task.status !== 'active' || task.nextRunAt === null || task.nextRunAt > now) continue;
        const run = this.claim(task, 'scheduled', now);
        if (run.status === 'starting') await this.dispatch(task, run);
      }
    } finally { this.ticking = false; }
  }
  async runNow(id: string): Promise<ScheduleRun> {
    if (this.stopped) throw conflict('Litespeed is closing. Try again after restarting.');
    const task = this.get(id);
    if (this.runningRuns(id).length) throw conflict('This scheduled task already has a run in progress.');
    const run = this.claim(task, 'manual', this.now());
    await this.dispatch(task, run);
    return this.readRun(run.id);
  }
  private claim(task: ScheduledTask, trigger: ScheduleRun['trigger'], now: number): ScheduleRun {
    return this.store.atomic(() => {
      const current = this.get(task.id);
      if (current.revision !== task.revision) throw conflict('The scheduled task changed before it could start.');
      const run: ScheduleRun = { id: randomUUID(), scheduleId: task.id, name: task.name, sessionId: null, trigger, scheduledAt: trigger === 'scheduled' ? task.nextRunAt! : now, startedAt: now, status: 'starting' };
      if (trigger === 'scheduled') {
        const nextRunAt = nextOccurrence(task.timing, now, task.createdAt);
        this.save({ ...task, nextRunAt, status: nextRunAt ? 'active' : 'completed', updatedAt: now, revision: task.revision + 1 });
        if (now - run.scheduledAt > 5 * 60_000) { run.status = 'missed'; run.error = 'Litespeed was not available at the scheduled time. Use Run now to start it.'; }
        else if (this.runningRuns(task.id).length) { run.status = 'skipped'; run.error = 'The previous run is still in progress.'; }
        if (run.status !== 'starting') run.endedAt = now;
      }
      this.saveRun(run);
      // Keep bounded history without deleting active records or conversations.
      this.store.db.prepare("DELETE FROM schedule_runs WHERE schedule_id=? AND status NOT IN ('starting','running','waiting') AND id NOT IN (SELECT id FROM schedule_runs WHERE schedule_id=? ORDER BY started_at DESC, rowid DESC LIMIT 100)").run(task.id, task.id);
      return run;
    });
  }
  private dispatch(task: ScheduledTask, run: ScheduleRun): Promise<void> {
    const operation = this.launch(task, run);
    this.pending.add(operation);
    void operation.finally(() => this.pending.delete(operation)).catch(() => {});
    return operation;
  }
  private async launch(task: ScheduledTask, run: ScheduleRun) {
    try {
      const root = await realpath(task.workspace);
      if (root !== task.workspace || !(await stat(root)).isDirectory()) throw new Error('The saved project folder moved or is no longer available. Edit the scheduled task to choose its project.');
      if (this.stopped) throw new Error('Litespeed closed before this run started.');
      if (!this.store.settings().providers.some(provider => provider.id === task.selection.providerId)) throw new Error('The saved model provider is no longer connected. Edit the scheduled task to choose a model.');
      this.store.atomic(() => {
        const session = this.store.createSession({ ...task.selection, workspace: task.workspace, title: task.name });
        run = { ...run, sessionId: session.id, status: 'running' };
        this.saveRun(run);
      });
      const unsubscribe = this.bus.subscribe(run.sessionId!, event => {
        try {
          const current = this.readRun(run.id);
          if (!active.includes(current.status)) return;
          if (event.type === 'session' && ['running', 'waiting'].includes(event.data.status)) this.saveRun({ ...current, status: event.data.status });
          if (event.type === 'error') this.saveRun({ ...current, error: String(event.data.message || 'The run failed.').slice(0, 2000) });
          if (event.type === 'done') {
            const status = event.data.status === 'error' ? 'failed' : event.data.outcome === 'completed' ? 'completed' : 'interrupted';
            this.saveRun({ ...current, status, endedAt: this.now() });
            unsubscribe(); this.subscriptions.delete(run.id);
          }
        } catch { console.error('Could not save a scheduled run update.'); }
      });
      this.subscriptions.set(run.id, unsubscribe);
      await this.runner.submit(run.sessionId!, async () => ({ content: task.prompt, clientSurface: 'web' }));
    } catch (error) {
      this.subscriptions.get(run.id)?.(); this.subscriptions.delete(run.id);
      // Known filesystem errors expose only the operation, not arbitrary paths.
      const message = error && typeof error === 'object' && 'code' in error ? 'The project folder could not be opened. Check that it is still available.' : error instanceof Error ? error.message.slice(0, 2000) : 'The run could not start.';
      this.saveRun({ ...run, status: this.stopped ? 'interrupted' : 'failed', error: message, endedAt: this.now() });
    }
  }
  private runningRuns(id?: string): ScheduleRun[] {
    const sql = "SELECT data FROM schedule_runs WHERE status IN ('starting','running','waiting')";
    return (id ? this.store.db.prepare(`${sql} AND schedule_id=?`).all(id) : this.store.db.prepare(sql).all()).map(row => JSON.parse(String(row.data)));
  }
  private readRun(id: string): ScheduleRun { return JSON.parse(String(this.store.db.prepare('SELECT data FROM schedule_runs WHERE id=?').get(id)!.data)); }
  private save(task: ScheduledTask) { this.store.db.prepare('INSERT INTO schedules(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(task.id, JSON.stringify(task)); }
  private saveRun(run: ScheduleRun) { this.store.db.prepare('INSERT INTO schedule_runs(id,schedule_id,status,started_at,data) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data').run(run.id, run.scheduleId, run.status, run.startedAt, JSON.stringify(run)); }
}
