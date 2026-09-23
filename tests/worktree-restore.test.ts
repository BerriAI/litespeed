import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store.js';
import type { ProjectWorktree } from '../shared/worktrees.js';

const exec = promisify(execFile);
describe('saved working-copy restoration', () => {
  let root: string, project: string, store: Store;
  const git = async (cwd: string, ...args: string[]) => (await exec('git', args, { cwd })).stdout.trim();
  beforeEach(async () => {
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1'); vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
    root = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-restore-'))); project = join(root, 'project'); await mkdir(project);
    await git(project, 'init', '-b', 'main'); await git(project, 'config', 'user.name', 'Fixture'); await git(project, 'config', 'user.email', 'fixture@local');
    await writeFile(join(project, 'notes.txt'), 'Original'); await git(project, 'add', '.'); await git(project, 'commit', '-m', 'Initial');
    store = new Store(join(root, 'state'));
  });
  afterEach(async () => { store.close(); await rm(root, { recursive: true, force: true }); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  async function create(name = 'Saved work') { return store.worktrees.create(project, (await store.worktrees.prepare(project, name)).id); }
  async function remove(record: ProjectWorktree) { return (await store.worktrees.remove(record.id, (await store.worktrees.prepareRemove(record.id)).id)).worktree; }

  it('pins the latest committed work through branch deletion and garbage collection, then restores the same tasks without resuming queues', async () => {
    const record = await create(), active = store.createSession({ workspace: record.path }), archived = store.createSession({ workspace: record.path, archived: true });
    store.enqueue(active.id, 'Review these changes first', [], false);
    await writeFile(join(record.path, 'notes.txt'), 'Latest committed work'); await git(record.path, 'add', '.'); await git(record.path, 'commit', '-m', 'Latest');
    await git(record.path, 'branch', '-m', 'renamed-work');
    const head = await git(record.path, 'rev-parse', 'HEAD'), removed = await remove(record);
    expect(removed.snapshot).toMatchObject({ head, branch: 'renamed-work' }); expect(store.session(active.id).worktree).toMatchObject({ removed: true, restorable: true, head });
    await git(project, 'branch', '-D', 'renamed-work'); await git(project, 'reflog', 'expire', '--expire=now', '--all'); await git(project, 'gc', '--prune=now');
    expect(await git(project, 'rev-parse', removed.snapshot!.ref)).toBe(head);
    await writeFile(join(project, 'notes.txt'), 'Original staged edit'); await git(project, 'add', '.'); await writeFile(join(project, 'notes.txt'), 'Original unstaged edit');
    const status = await git(project, 'status', '--porcelain=v1'), index = await git(project, 'write-tree');
    store.close(); store = new Store(join(root, 'state'));
    expect(store.worktrees.list()).toHaveLength(0); expect(store.worktrees.list(project, true)).toHaveLength(1);
    const plan = await store.worktrees.prepareRestore(record.id), restored = await store.worktrees.restore(record.id, plan.id);
    expect(restored.path).toBe(record.path); expect(restored.head).toBe(head); expect(restored.branch).toMatch(/^litespeed\/restored-saved-work-/);
    expect(await readFile(join(restored.path, 'notes.txt'), 'utf8')).toBe('Latest committed work');
    expect(await git(project, 'status', '--porcelain=v1')).toBe(status); expect(await git(project, 'write-tree')).toBe(index); expect(await git(project, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
    expect(store.session(active.id).worktree?.removed).toBeUndefined(); expect(store.session(archived.id).archived).toBe(true); expect(store.session(archived.id).worktree?.removed).toBeUndefined();
    expect(store.queue(active.id)).toMatchObject({ paused: true, items: [{ content: 'Review these changes first' }] });
    expect(store.queue(active.id).reason).toContain('restored'); expect(store.messages(active.id)).toEqual([]);
    await expect(store.worktrees.restore(record.id, plan.id)).rejects.toThrow('expired');
  });
  it('rejects changed or missing recovery refs before creating files', async () => {
    const record = await remove(await create()), plan = await store.worktrees.prepareRestore(record.id);
    await git(project, 'commit', '--allow-empty', '-m', 'Later'); await git(project, 'update-ref', record.snapshot!.ref, 'HEAD');
    await expect(store.worktrees.restore(record.id, plan.id)).rejects.toThrow('missing or changed');
    await expect(readFile(join(record.path, 'notes.txt'))).rejects.toMatchObject({ code: 'ENOENT' }); expect(store.worktrees.get(record.id, true).status).toBe('removed');
    await git(project, 'update-ref', '-d', record.snapshot!.ref); await expect(store.worktrees.prepareRestore(record.id)).rejects.toThrow('missing or changed');
  });
  it('rejects foreign and expired reviews and never overwrites a reappearing folder', async () => {
    const first = await remove(await create()), other = await remove(await create('Other'));
    const foreign = await store.worktrees.prepareRestore(first.id); await expect(store.worktrees.restore(other.id, foreign.id)).rejects.toThrow('expired');
    const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60_000); await expect(store.worktrees.restore(first.id, foreign.id)).rejects.toThrow('expired'); vi.restoreAllMocks();
    const plan = await store.worktrees.prepareRestore(first.id); await mkdir(first.path); await writeFile(join(first.path, 'keep.txt'), 'User content');
    await expect(store.worktrees.restore(first.id, plan.id)).rejects.toThrow('already present'); expect(await readFile(join(first.path, 'keep.txt'), 'utf8')).toBe('User content');
  });
  it('rejects a linked storage parent without writing into its target', async () => {
    const record = await remove(await create()), plan = await store.worktrees.prepareRestore(record.id), outside = join(root, 'outside');
    await mkdir(outside); await rm(dirname(record.path), { recursive: true }); await symlink(outside, dirname(record.path));
    await expect(store.worktrees.restore(record.id, plan.id)).rejects.toThrow('folder changed');
    await expect(readFile(join(outside, record.name, 'notes.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(store.worktrees.get(record.id, true).status).toBe('removed');
  });
  it('suppresses checkout hooks and filters while restoring committed content', async () => {
    await writeFile(join(project, '.gitattributes'), '*.txt filter=fixture\n'); await git(project, 'add', '.'); await git(project, 'commit', '-m', 'Attributes');
    const record = await remove(await create()), hook = join(root, 'hook-ran'), filter = join(root, 'filter-ran');
    await writeFile(join(project, '.git', 'hooks', 'post-checkout'), `#!/bin/sh\ntouch '${hook}'\n`, { mode: 0o755 });
    await git(project, 'config', 'filter.fixture.smudge', `touch '${filter}'; cat`); await git(project, 'config', 'filter.fixture.required', 'true');
    const plan = await store.worktrees.prepareRestore(record.id); await store.worktrees.restore(record.id, plan.id);
    expect(await readFile(join(record.path, 'notes.txt'), 'utf8')).toBe('Original');
    await expect(readFile(hook)).rejects.toMatchObject({ code: 'ENOENT' }); await expect(readFile(filter)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('retains a failed restoration for inspection and can recover back to its saved snapshot', async () => {
    const record = await remove(await create()), session = store.createSession({ workspace: project });
    const plan = await store.worktrees.prepareRestore(record.id); await git(project, 'branch', plan.branch);
    await expect(store.worktrees.restore(record.id, plan.id)).rejects.toThrow('could not restore');
    expect(store.worktrees.get(record.id).status).toBe('error');
    const checked = await store.worktrees.recover(record.id); expect(checked.status).toBe('removed'); expect(checked.snapshot?.head).toBe(record.head);
    const retry = await store.worktrees.prepareRestore(record.id); const restored = await store.worktrees.restore(record.id, retry.id);
    expect(restored.status).toBe('ready'); expect(store.session(session.id).workspace).toBe(project); expect(await git(project, 'rev-parse', plan.branch)).toBe(record.head);
  });
});
