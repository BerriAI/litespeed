import { createHash, randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { z } from 'zod';
import { gitReview } from './git-review.js';
import { inspectGit, operateGit } from './tools.js';
import { assertDiscardFile, discardConflict as fail, observeDiscardFile, removeDiscardFile, restoreDiscardFile, sameFingerprint, type DiscardFileCopy, type FileFingerprint, type FileObservation } from './git-discard-files.js';
import type { DiscardBackup, DiscardFile, DiscardPlan, DiscardResult } from '../shared/git-discard.js';

const LIMITS = { files: 100, bytes: 16 * 1024 * 1024, backups: 20, storedBytes: 64 * 1024 * 1024 };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type SavedFile = { path: string; before: DiscardFileCopy | null; after?: FileFingerprint; state: 'pending' | 'discarded' | 'restored' };
type Backup = { id: string; workspace: string; createdAt: number; branch: string; status: DiscardBackup['status']; files: SavedFile[]; version: string };
type Plan = { public: DiscardPlan; workspace: string; revision: string; backupId?: string };
const fingerprintSchema = z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().min(0).max(8 * 1024 * 1024), mode: z.number().int().min(0).max(0o777) }).strict();
const backupSchema = z.object({
  id: z.string().uuid(), workspace: z.string().min(1).max(4096), createdAt: z.number().int().min(0).max(8.64e15), branch: z.string().max(1024),
  status: z.enum(['discarding', 'discarded', 'interrupted', 'restoring', 'restored']), version: z.string().uuid(),
  files: z.array(z.object({ path: z.string().min(1).max(4096), before: fingerprintSchema.extend({ data: z.string().max(Math.ceil(8 * 1024 * 1024 / 3) * 4).regex(/^[A-Za-z0-9+/]*={0,2}$/) }).nullable(), after: fingerprintSchema.nullable().optional(), state: z.enum(['pending', 'discarded', 'restored']) }).strict()).min(1).max(100),
}).strict();
function parseBackup(data: string): Backup {
  try { const backup = backupSchema.parse(JSON.parse(data)); if (new Set(backup.files.map(file => file.path)).size !== backup.files.length) throw new Error('Duplicate paths'); return backup; }
  catch { throw fail('This discarded-change backup could not be read. Its saved data has been retained.'); }
}
const initialized = new WeakSet<Store>();
export class GitDiscards {
  private plans = new Map<string, Plan>();
  constructor(private store: Store) {
    store.db.exec('CREATE TABLE IF NOT EXISTS git_discard_backups (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL, bytes INTEGER NOT NULL)');
    if (!initialized.has(store)) {
      for (const row of store.db.prepare('SELECT data FROM git_discard_backups').all() as unknown as { data: string }[]) {
        try { const backup = parseBackup(row.data); if (backup.status === 'discarding' || backup.status === 'restoring') { backup.status = 'interrupted'; this.save(backup); } } catch { /* Report malformed backups when requested; do not stop unrelated work. */ }
      }
      initialized.add(store);
    }
  }
  private save(backup: Backup) {
    backup.version = randomUUID(); const data = JSON.stringify(backup);
    this.store.db.prepare('INSERT INTO git_discard_backups(id,workspace,created_at,data,bytes) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,bytes=excluded.bytes').run(backup.id, backup.workspace, backup.createdAt, data, Buffer.byteLength(data));
  }
  private read(workspace: string, id: string): Backup {
    const row = this.store.db.prepare('SELECT data FROM git_discard_backups WHERE workspace=? AND id=?').get(workspace, id) as { data: string } | undefined;
    if (!row) throw fail('This discarded-change backup is no longer available.', 404);
    const backup = parseBackup(row.data);
    if (backup.id !== id || backup.workspace !== workspace) throw fail('The saved backup location does not match this project.');
    return backup;
  }
  private public(backup: Backup): DiscardBackup {
    return { id: backup.id, workspace: backup.workspace, createdAt: backup.createdAt, branch: backup.branch, status: backup.status, bytes: backup.files.reduce((total, file) => total + (file.before?.size || 0), 0), files: backup.files.map(file => ({ path: file.path, state: file.state, hasOriginal: file.before !== null })) };
  }
  list(workspace?: string): DiscardBackup[] {
    const rows = (workspace ? this.store.db.prepare('SELECT id,workspace,data FROM git_discard_backups WHERE workspace=? ORDER BY created_at DESC').all(workspace) : this.store.db.prepare('SELECT id,workspace,data FROM git_discard_backups ORDER BY created_at DESC').all()) as unknown as { id: string; workspace: string; data: string }[];
    return rows.map(row => { const backup = parseBackup(row.data); if (backup.workspace !== row.workspace || backup.id !== row.id) throw fail('The saved backup location does not match this project.'); return this.public(backup); });
  }

  remove(workspace: string, id: string) {
    const backup = this.read(workspace, id);
    if (backup.status === 'discarding' || backup.status === 'restoring') throw fail('Wait for the current file operation to finish.');
    this.store.db.prepare('DELETE FROM git_discard_backups WHERE workspace=? AND id=?').run(workspace, id);
  }
  original(workspace: string, id: string, path: string) {
    const copy = this.read(workspace, id).files.find(file => file.path === path)?.before;
    if (!copy) throw fail('There is no original file to save for this path.', 404);
    const data = Buffer.from(copy.data, 'base64');
    if (data.length !== copy.size || createHash('sha256').update(data).digest('hex') !== copy.hash) throw fail('The saved file copy could not be verified.');
    return data;
  }
  private keep(plan: Plan) {
    for (const [id, value] of this.plans) if (value.public.expiresAt < Date.now()) this.plans.delete(id);
    while (this.plans.size >= 100) this.plans.delete(this.plans.keys().next().value!);
    this.plans.set(plan.public.id, plan); return plan.public;
  }
  private capacity(backup: Backup) {
    const totals = this.store.db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(bytes),0) AS bytes FROM git_discard_backups').get() as { count: number; bytes: number };
    if (totals.count >= LIMITS.backups || totals.bytes + Buffer.byteLength(JSON.stringify(backup)) + 64 * 1024 > LIMITS.storedBytes) throw fail('Saved discards have reached the 20-backup or 64 MiB limit. Review and remove an old backup before discarding more changes.');
  }
  private async repository(workspace: string, paths: string[], signal?: AbortSignal) {
    const git = await inspectGit(workspace, signal); if (!git) throw fail('This project is not a Git repository.', 400);
    const [head, branch, index] = await Promise.all([git.run(['rev-parse', '--verify', 'HEAD']), git.run(['symbolic-ref', '--quiet', '--short', 'HEAD']), git.run(['--literal-pathspecs', 'ls-files', '--stage', '-z', '--', ...paths])]);
    if (index.code !== 0 || index.truncated || head.truncated || branch.truncated) throw fail('The selected index entries could not be read completely.');
    const tracked = new Set<string>(), objects = new Set<string>();
    for (const item of index.output.split('\0').filter(Boolean)) { const match = /^100(?:644|755) ([a-f0-9]+) 0\t([\s\S]+)$/.exec(item); if (!match) throw fail('Use your terminal for symbolic links, submodules or conflicted files.'); objects.add(match[1]); tracked.add(match[2]); }
    return { tracked, objects, git, signature: digest([head.code === 0 ? head.output.trim() : null, branch.output, index.output]), branch: branch.code === 0 ? branch.output.trim() : 'Detached HEAD' };
  }
  private async snapshot(workspace: string, paths: string[], signal?: AbortSignal) {
    if (!paths.length || paths.length > LIMITS.files || new Set(paths).size !== paths.length) throw fail('Select between 1 and 100 changed files.', 400);
    const git = await inspectGit(workspace, signal); if (!git) throw fail('This project is not a Git repository.', 400);
    const summary = await gitReview(workspace, 'unstaged', undefined, signal);
    if (summary.limited) throw fail('Filter this change set in your terminal before discarding here. The comparison is incomplete.');
    const files: DiscardFile[] = [];
    for (const path of paths) {
      const entry = summary.files.find(file => file.path === path);
      if (!entry || entry.status === 'conflicted') throw fail('These changes moved or have conflicts. Refresh and review them again.');
      files.push({ path, kind: entry.untracked ? 'new' : entry.status === 'deleted' ? 'deleted' : 'modified' });
    }
    const repository = await this.repository(workspace, paths, signal);
    if (files.some(file => (file.kind !== 'new') !== repository.tracked.has(file.path))) throw fail('The staged files changed while preparing this review. Refresh and try again.');
    for (const object of repository.objects) { const size = await repository.git.run(['cat-file', '-s', object]); if (size.code !== 0 || size.truncated || !/^\d+\s*$/.test(size.output) || Number(size.output) > 8 * 1024 * 1024) throw fail('A selected staged version exceeds the 8 MiB recoverable-discard limit. Use your terminal for this file.', 400); }
    const observations = new Map<string, FileObservation>(); let bytes = 0;
    for (const file of files) {
      signal?.throwIfAborted(); const observation = await observeDiscardFile(git.root, file.path); observations.set(file.path, observation); bytes += observation.fingerprint?.size || 0;
      if (bytes > LIMITS.bytes) throw fail('Select fewer files. One discard can back up at most 16 MiB.', 400);
    }
    return { files, observations, repository: repository.signature, branch: repository.branch, bytes, revision: digest([repository.signature, files, [...observations].map(([path, value]) => [path, value.fingerprint, value.identity])]) };
  }
  async prepare(workspace: string, paths: string[], signal?: AbortSignal): Promise<DiscardPlan> {
    const snapshot = await this.snapshot(workspace, paths, signal);
    const publicPlan: DiscardPlan = { id: randomUUID(), action: 'discard', files: snapshot.files, branch: snapshot.branch, bytes: snapshot.bytes, expiresAt: Date.now() + 10 * 60_000 };
    return this.keep({ public: publicPlan, workspace, revision: snapshot.revision });
  }
  async prepareRestore(workspace: string, id: string, paths?: string[], signal?: AbortSignal): Promise<DiscardPlan> {
    const backup = this.read(workspace, id), selected = paths || backup.files.filter(file => file.state !== 'restored').map(file => file.path);
    const observations = await this.restorable(backup, selected, signal);
    return this.keep({ workspace, backupId: id, revision: digest([backup.version, [...observations].map(([path, value]) => [path, value.fingerprint, value.identity])]), public: { id: randomUUID(), action: 'restore', files: selected.map(path => ({ path, kind: backup.files.find(file => file.path === path)!.before === null ? 'deleted' : 'modified' })), branch: backup.branch, bytes: selected.reduce((size, path) => size + (backup.files.find(file => file.path === path)!.before?.size || 0), 0), expiresAt: Date.now() + 10 * 60_000 } });
  }
  private async restorable(backup: Backup, paths: string[], signal?: AbortSignal) {
    if (!paths.length || paths.length > LIMITS.files || new Set(paths).size !== paths.length || paths.some(path => !backup.files.some(file => file.path === path && file.state !== 'restored'))) throw fail('Choose files from this discarded-change backup.');
    const observations = new Map<string, FileObservation>();
    for (const path of paths) {
      signal?.throwIfAborted(); const file = backup.files.find(file => file.path === path)!, current = await observeDiscardFile(backup.workspace, path);
      if (!sameFingerprint(current.fingerprint, file.before) && (file.after === undefined || !sameFingerprint(current.fingerprint, file.after))) throw fail(`${path} changed after the discard. Keep your current edits, or save the original copy from this backup.`);
      observations.set(path, current);
    }
    return observations;
  }
  async apply(workspace: string, id: string, signal?: AbortSignal): Promise<DiscardResult> {
    const plan = this.plans.get(id);
    if (!plan || plan.workspace !== workspace || plan.public.expiresAt < Date.now()) throw fail('This file review expired. Refresh it before continuing.');
    this.plans.delete(id); signal?.throwIfAborted();
    if (plan.public.action === 'restore') return this.restore(plan, signal);
    const snapshot = await this.snapshot(workspace, plan.public.files.map(file => file.path), signal);
    if (snapshot.revision !== plan.revision) throw fail('The selected files or branch changed after review. Refresh and review them again.');
    const backup: Backup = { id: randomUUID(), workspace, createdAt: Date.now(), branch: snapshot.branch, status: 'discarding', version: '', files: snapshot.files.map(file => ({ path: file.path, before: snapshot.observations.get(file.path)!.copy, state: 'pending' })) };
    this.capacity(backup); this.save(backup);
    try {
      for (const file of snapshot.files) {
        signal?.throwIfAborted();
        if ((await this.repository(workspace, snapshot.files.map(file => file.path), signal)).signature !== snapshot.repository) throw fail('The branch or staged files changed during discard. Remaining files were left alone.');
        const expected = snapshot.observations.get(file.path)!; await assertDiscardFile(workspace, file.path, expected);
        const saved = backup.files.find(value => value.path === file.path)!;
        try {
          if (file.kind === 'new') await removeDiscardFile(workspace, file.path, expected);
          else {
            const result = await operateGit(workspace, ['restore', '--worktree', '--', file.path], signal);
            if (result.code !== 0) throw fail('Git could not discard this file. Your original copies are retained in Discarded changes.');
          }
        } finally {
          const current = await observeDiscardFile(workspace, file.path).catch(() => undefined);
          if (current) { saved.after = current.fingerprint; saved.state = 'discarded'; this.save(backup); }
        }
        if (saved.after === undefined) throw fail('The resulting file could not be verified. Discard stopped.');
      }
      backup.status = 'discarded'; this.save(backup);
      return { message: `${backup.files.length} ${backup.files.length === 1 ? 'file' : 'files'} discarded. Original copies saved.`, backup: this.public(backup) };
    } catch (error) { backup.status = 'interrupted'; this.save(backup); throw fail(`${error instanceof Error ? error.message : 'Discard stopped.'} Original copies are retained in Discarded changes.`); }
  }
  private async restore(plan: Plan, signal?: AbortSignal): Promise<DiscardResult> {
    const backup = this.read(plan.workspace, plan.backupId!), paths = plan.public.files.map(file => file.path), observations = await this.restorable(backup, paths, signal);
    if (digest([backup.version, [...observations].map(([path, value]) => [path, value.fingerprint, value.identity])]) !== plan.revision) throw fail('The files or backup changed after review. Refresh and review the restore again.');
    backup.status = 'restoring'; this.save(backup);
    try {
      for (const path of paths) {
        signal?.throwIfAborted(); const file = backup.files.find(file => file.path === path)!;
        await restoreDiscardFile(backup.workspace, path, observations.get(path)!, file.before); file.state = 'restored'; this.save(backup);
      }
      backup.status = backup.files.every(file => file.state === 'restored') ? 'restored' : backup.files.some(file => file.state === 'pending') ? 'interrupted' : 'discarded'; this.save(backup);
      return { message: `${paths.length} ${paths.length === 1 ? 'file' : 'files'} restored`, backup: this.public(backup) };
    } catch (error) { backup.status = 'interrupted'; this.save(backup); throw fail(`${error instanceof Error ? error.message : 'Restore stopped.'} The backup is still available.`); }
  }
}
