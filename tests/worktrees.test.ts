import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store.js';
import { inspectGit, readFile as readProjectFile, resolveWorkspacePath } from '../server/tools.js';

const exec = promisify(execFile);
describe('managed project worktrees', () => {
  let root: string, project: string, store: Store;
  const git = (...args: string[]) => exec('git', args, { cwd: project });
  beforeEach(async () => {
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1'); vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
    root = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-worktrees-'))); project = join(root, 'original project'); await mkdir(project);
    await git('init', '-b', 'main'); await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'fixture@local');
    await writeFile(join(project, 'file.txt'), 'Committed content\n'); await git('add', '.'); await git('commit', '-m', 'Initial');
    store = new Store(join(root, 'state'));
  });
  afterEach(async () => { store.close(); await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
  it('creates a real registered worktree from the reviewed commit while preserving staged and unstaged source edits', async () => {
    await writeFile(join(project, 'file.txt'), 'Staged content'); await git('add', '.'); await writeFile(join(project, 'file.txt'), 'Unstaged content');
    await writeFile(join(project, 'untracked.txt'), 'Leave here');
    const original = await git('status', '--porcelain=v1'), plan = await store.worktrees.prepare(project, 'Polish browser');
    expect(plan.changedFiles).toBe(2); expect(plan.sourceBranch).toBe('main'); expect(plan.branch).toMatch(/^litespeed\/polish-browser-/);
    const created = await store.worktrees.create(project, plan.id);
    expect(created.status).toBe('ready'); expect(await readFile(join(created.path, 'file.txt'), 'utf8')).toBe('Committed content\n');
    expect((await git('status', '--porcelain=v1')).stdout).toBe(original.stdout); expect((await git('symbolic-ref', '--short', 'HEAD')).stdout.trim()).toBe('main');
    expect((await exec('git', ['rev-parse', 'HEAD'], { cwd: created.path })).stdout.trim()).toBe(plan.head);
    expect((await git('worktree', 'list', '--porcelain')).stdout).toContain(created.path);
    expect(await resolveWorkspacePath(created.path, 'file.txt')).toBe(join(created.path, 'file.txt'));
    await expect(resolveWorkspacePath(created.path, '../../litespeed.db')).rejects.toThrow();
    expect((await store.worktrees.ready(created.id)).path).toBe(created.path);
    await expect(store.worktrees.create(project, plan.id)).rejects.toThrow('expired');
  });
  it('restores only registered owned workspaces after restart and retains them after task deletion', async () => {
    const record = await store.worktrees.create(project, (await store.worktrees.prepare(project, 'Review')).id);
    const session = store.createSession({ workspace: record.path, worktree: store.worktrees.metadata(record) }); store.deleteSession(session.id);
    expect(await readFile(join(record.path, 'file.txt'), 'utf8')).toContain('Committed');
    store.close(); store = new Store(join(root, 'state'));
    expect((await store.worktrees.ready(record.id)).path).toBe(record.path); expect(await inspectGit(record.path)).toBeTruthy();
    await expect(readProjectFile(join(root, 'state'), 'litespeed.db')).rejects.toThrow('Protected');
  });
  it('does not run checkout hooks, copy ignored dependencies or execute project setup during creation', async () => {
    const marker = join(root, 'hook-ran'); await writeFile(join(project, '.git', 'hooks', 'post-checkout'), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    await writeFile(join(project, '.gitignore'), 'node_modules/\n'); await git('add', '.'); await git('commit', '-m', 'Ignore dependencies');
    await mkdir(join(project, 'node_modules')); await writeFile(join(project, 'node_modules', 'local.txt'), 'not copied');
    const record = await store.worktrees.create(project, (await store.worktrees.prepare(project, 'Fresh task')).id);
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' }); await expect(readFile(join(record.path, 'node_modules', 'local.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects a moved starting commit, branch and expired or foreign plan', async () => {
    const plan = await store.worktrees.prepare(project, 'Review'); await git('commit', '--allow-empty', '-m', 'Later');
    await expect(store.worktrees.create(project, plan.id)).rejects.toThrow('branch changed'); expect(store.worktrees.list()).toEqual([]);
    const second = await store.worktrees.prepare(project, 'Review'); await git('switch', '-c', 'other'); await expect(store.worktrees.create(project, second.id)).rejects.toThrow('branch changed');
    const third = await store.worktrees.prepare(project, 'Review'); await expect(store.worktrees.create(root, third.id)).rejects.toThrow('expired');
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600_001); await expect(store.worktrees.create(project, third.id)).rejects.toThrow('expired'); vi.restoreAllMocks();
  });
  it('rejects linked storage and a changed worktree registration', async () => {
    const outside = join(root, 'outside'); await mkdir(outside); await symlink(outside, join(store.directory, 'worktrees'));
    await expect(store.worktrees.create(project, (await store.worktrees.prepare(project, 'Review')).id)).rejects.toThrow('linked');
    await rm(join(store.directory, 'worktrees')); const record = await store.worktrees.create(project, (await store.worktrees.prepare(project, 'Review')).id);
    store.close(); await writeFile(join(record.path, '.git'), `gitdir: ${join(project, '.git')}\n`); store = new Store(join(root, 'state'));
    await expect(store.worktrees.ready(record.id)).rejects.toThrow('registration'); await expect(readProjectFile(record.path, 'file.txt')).rejects.toThrow('Protected');
  });
  it('starts only from a committed Git project and validates human-readable names', async () => {
    await expect(store.worktrees.prepare(root, 'Review')).rejects.toThrow('Git project');
    for (const name of ['', '../outside', '-branch', 'a\nbranch']) await expect(store.worktrees.prepare(project, name)).rejects.toThrow();
    await rm(join(project, '.git'), { recursive: true }); await git('init', '-b', 'main'); await expect(store.worktrees.prepare(project, 'Review')).rejects.toThrow('first commit');
  });
  it('creates worktrees from large clean indexes without serializing the full file list', async () => {
    await mkdir(join(project, 'many-files'));
    await Promise.all(Array.from({ length: 700 }, (_, index) => writeFile(join(project, 'many-files', `${index}-` + 'long-filename-'.repeat(6) + '.txt'), 'content')));
    await git('add', '.'); await git('commit', '-m', 'Many files');
    const plan = await store.worktrees.prepare(project, 'Large project'), record = await store.worktrees.create(project, plan.id);
    expect(record.head).toBe(plan.head); expect(await readFile(join(record.path, 'many-files', '699-' + 'long-filename-'.repeat(6) + '.txt'), 'utf8')).toBe('content');
  });
  it('removes only a reviewed clean working folder, retaining its branch, commits and task history', async () => {
    const record = await store.worktrees.create(project, (await store.worktrees.prepare(project, 'Keep commits')).id);
    const session = store.createSession({ workspace: record.path }); expect(session.worktree?.id).toBe(record.id);
    await writeFile(join(record.path, 'new.txt'), 'New committed work'); await exec('git', ['add', '.'], { cwd: record.path }); await exec('git', ['commit', '-m', 'Work'], { cwd: record.path });
    const plan = await store.worktrees.prepareRemove(record.id); expect(plan.head).not.toBe(record.head);
    await store.worktrees.remove(record.id, plan.id);
    expect(store.worktrees.list()).toEqual([]); expect(store.session(session.id).worktree?.removed).toBe(true);
    expect((await git('show', `${record.branch}:new.txt`)).stdout).toBe('New committed work');
    await expect(readFile(join(record.path, 'file.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(store.worktrees.remove(record.id, plan.id)).rejects.toThrow('expired');
  });
  it('refuses dirty, ignored, detached, locked and changed worktrees without forcing removal', async () => {
    await writeFile(join(project, '.gitignore'), 'cache/\n'); await git('add', '.'); await git('commit', '-m', 'Ignore cache');
    const record = await store.worktrees.create(project, (await store.worktrees.prepare(project, 'Keep files')).id), plan = await store.worktrees.prepareRemove(record.id);
    await writeFile(join(record.path, 'untracked.txt'), 'Keep me'); await expect(store.worktrees.remove(record.id, plan.id)).rejects.toThrow('untracked');
    await rm(join(record.path, 'untracked.txt')); await mkdir(join(record.path, 'cache')); await writeFile(join(record.path, 'cache', 'local.txt'), 'Keep cache'); await expect(store.worktrees.prepareRemove(record.id)).rejects.toThrow('ignored');
    await rm(join(record.path, 'cache'), { recursive: true }); const second = await store.worktrees.prepareRemove(record.id);
    await exec('git', ['commit', '--allow-empty', '-m', 'New commit'], { cwd: record.path }); await expect(store.worktrees.remove(record.id, second.id)).rejects.toThrow('changed since review');
    await exec('git', ['switch', '--detach'], { cwd: record.path }); await expect(store.worktrees.prepareRemove(record.id)).rejects.toThrow('on a branch');
    await exec('git', ['switch', record.branch], { cwd: record.path }); await git('worktree', 'lock', record.path);
    const locked = await store.worktrees.prepareRemove(record.id); await expect(store.worktrees.remove(record.id, locked.id)).rejects.toThrow('locked worktree');
    expect(await readFile(join(record.path, 'file.txt'), 'utf8')).toContain('Committed'); expect(store.worktrees.list()).toHaveLength(1);
  });
  it('retains interrupted creation and requires a registration check before reopening it', async () => {
    const record = await store.worktrees.create(project, (await store.worktrees.prepare(project, 'Interrupted')).id);
    store.db.prepare('UPDATE project_worktrees SET data=? WHERE id=?').run(JSON.stringify({ ...record, status: 'creating' }), record.id);
    await writeFile(join(record.path, 'file.txt'), 'Keep local work'); store.close(); store = new Store(join(root, 'state'));
    expect(store.worktrees.get(record.id).status).toBe('error'); await expect(store.worktrees.ready(record.id)).rejects.toThrow('interrupted');
    expect(() => store.worktrees.assertUsable(record.path)).toThrow('registration check');
    expect((await store.worktrees.recover(record.id)).status).toBe('ready'); expect(await readFile(join(record.path, 'file.txt'), 'utf8')).toBe('Keep local work');
    expect(() => store.worktrees.assertUsable(record.path)).not.toThrow();
  });
  it('reconciles a completed interrupted removal without deleting or replaying anything', async () => {
    const record = await store.worktrees.create(project, (await store.worktrees.prepare(project, 'Removed')).id), session = store.createSession({ workspace: record.path });
    store.db.prepare('UPDATE project_worktrees SET data=? WHERE id=?').run(JSON.stringify({ ...record, status: 'removing' }), record.id);
    await git('worktree', 'remove', record.path); store.close(); store = new Store(join(root, 'state'));
    expect(store.worktrees.list()).toEqual([]); expect(store.session(session.id).worktree?.removed).toBe(true);
    expect((await git('rev-parse', record.branch)).stdout.trim()).toBe(record.head);
  });
  it('retains an incomplete creation when its missing folder still has a Git registration', async () => {
    const record = await store.worktrees.create(project, (await store.worktrees.prepare(project, 'Missing folder')).id);
    store.db.prepare('UPDATE project_worktrees SET data=? WHERE id=?').run(JSON.stringify({ ...record, gitDir: undefined, status: 'error' }), record.id);
    await rm(record.path, { recursive: true });
    await expect(store.worktrees.recover(record.id)).rejects.toThrow('still has a registration');
    expect(store.worktrees.get(record.id).status).toBe('error'); expect((await git('rev-parse', record.branch)).stdout.trim()).toBe(record.head);
  });
  it('starts from another checked-out local branch while preserving the original project and its index', async () => {
    const secondary = join(root, 'other checkout'); await git('worktree', 'add', '-b', 'feature', secondary);
    await writeFile(join(secondary, 'file.txt'), 'Feature content'); await exec('git', ['commit', '-am', 'Feature'], { cwd: secondary });
    await writeFile(join(project, 'file.txt'), 'Original staged work'); await git('add', '.'); await writeFile(join(project, 'file.txt'), 'Original unstaged work');
    const before = await readFile(join(project, '.git', 'index')), head = (await exec('git', ['rev-parse', 'HEAD'], { cwd: secondary })).stdout.trim();
    const plan = await store.worktrees.prepare(project, 'From feature', undefined, undefined, false, false, 'refs/heads/feature');
    expect(plan).toMatchObject({ sourceBranch: 'feature', head, changedFiles: 1 }); const result = await store.worktrees.create(project, plan.id);
    expect(await readFile(join(result.path, 'file.txt'), 'utf8')).toBe('Feature content'); expect((await git('symbolic-ref', '--short', 'HEAD')).stdout.trim()).toBe('main');
    expect(await readFile(join(project, '.git', 'index'))).toEqual(before); expect(await readFile(join(project, 'file.txt'), 'utf8')).toBe('Original unstaged work'); expect((await git('show', ':file.txt')).stdout).toBe('Original staged work');
    expect((await exec('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: secondary })).stdout.trim()).toBe('feature');
  });
  it('starts from a fetched remote ref without fetching or moving remote tracking state', async () => {
    await git('remote', 'add', 'origin', join(root, 'unavailable-remote.git')); await git('update-ref', 'refs/remotes/origin/design', 'HEAD');
    const plan = await store.worktrees.prepare(project, 'Fetched work', undefined, undefined, false, false, 'refs/remotes/origin/design');
    expect(plan.sourceBranch).toBe('origin/design'); const result = await store.worktrees.create(project, plan.id);
    expect(result.head).toBe(plan.head); expect((await git('rev-parse', 'refs/remotes/origin/design')).stdout.trim()).toBe(plan.head);
    await expect(readFile(join(project, '.git', 'FETCH_HEAD'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects moved, removed and invalid starting refs without creating a folder', async () => {
    await git('branch', 'feature'); const initial = (await git('rev-parse', 'HEAD')).stdout.trim(); await git('commit', '--allow-empty', '-m', 'Current commit');
    const plan = await store.worktrees.prepare(project, 'Stale feature', undefined, undefined, false, false, 'refs/heads/feature');
    await git('update-ref', 'refs/heads/feature', 'HEAD'); await expect(store.worktrees.create(project, plan.id)).rejects.toThrow('starting branch moved'); expect(store.worktrees.list()).toHaveLength(0);
    const removed = await store.worktrees.prepare(project, 'Removed feature', undefined, undefined, false, false, 'refs/heads/feature'); await git('branch', '-D', 'feature'); await expect(store.worktrees.create(project, removed.id)).rejects.toThrow('no longer available');
    for (const ref of [initial, 'HEAD', 'refs/heads/main~1', 'refs/heads/main^{commit}', 'refs/tags/version', 'refs/heads/main\n']) await expect(store.worktrees.prepare(project, 'Invalid', undefined, undefined, false, false, ref)).rejects.toThrow();
  });
  it('copies local edits only from the current starting branch', async () => {
    await git('branch', 'feature'); await writeFile(join(project, 'file.txt'), 'Local edits');
    await expect(store.worktrees.prepare(project, 'Other branch', undefined, undefined, true, false, 'refs/heads/feature')).rejects.toThrow('current branch');
    const plan = await store.worktrees.prepare(project, 'Current branch', undefined, undefined, true, false, 'refs/heads/main'), result = await store.worktrees.create(project, plan.id);
    expect(await readFile(join(result.path, 'file.txt'), 'utf8')).toBe('Local edits');
  });
});
