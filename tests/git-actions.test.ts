import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitActions } from '../server/git-actions.js';

const exec = promisify(execFile);
describe('reviewed Git actions', () => {
  let root: string, actions: GitActions;
  const git = (...args: string[]) => exec('git', args, { cwd: root });
  beforeEach(async () => {
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1'); vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
    root = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-git-action-'))); actions = new GitActions();
    await git('init', '-b', 'main'); await git('config', 'user.name', 'Test'); await git('config', 'user.email', 'test@example.com');
    await writeFile(join(root, 'a.txt'), 'initial\n'); await git('add', 'a.txt'); await git('commit', '-m', 'Initial');
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
  it('stages only selected files and unstages without changing working contents', async () => {
    await writeFile(join(root, 'a.txt'), 'updated\n'); await writeFile(join(root, 'b.txt'), 'new\n');
    const plan = await actions.prepare(root, 'stage', ['a.txt']); expect(plan.files).toEqual(['a.txt']); await actions.apply(root, plan.id);
    expect((await git('show', ':a.txt')).stdout).toBe('updated\n'); expect((await git('diff', '--cached', '--name-only')).stdout).toBe('a.txt\n');
    await writeFile(join(root, 'a.txt'), 'later\n'); const unstage = await actions.prepare(root, 'unstage', ['a.txt']); await actions.apply(root, unstage.id);
    expect((await git('diff', '--cached', '--name-only')).stdout).toBe(''); expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('later\n');
  });
  it('stages deletions and treats magic pathspec names literally', async () => {
    await rm(join(root, 'a.txt')); await writeFile(join(root, ':(glob)*'), 'literal\n'); await writeFile(join(root, 'other.txt'), 'unselected');
    const plan = await actions.prepare(root, 'stage', ['a.txt', ':(glob)*']); await actions.apply(root, plan.id);
    expect((await git('diff', '--cached', '--name-only')).stdout.trim().split('\n').sort()).toEqual([':(glob)*', 'a.txt']);
  });
  it('rejects changed file contents even when line counts are unchanged, and plans cannot replay', async () => {
    await writeFile(join(root, 'a.txt'), 'first\n'); const plan = await actions.prepare(root, 'stage', ['a.txt']); await writeFile(join(root, 'a.txt'), 'other\n');
    await expect(actions.apply(root, plan.id)).rejects.toThrow('changed after'); expect((await git('diff', '--cached')).stdout).toBe('');
    await expect(actions.apply(root, plan.id)).rejects.toThrow('expired');
  });
  it('commits the reviewed index and retains subsequent unstaged changes', async () => {
    await writeFile(join(root, 'a.txt'), 'staged\n'); await git('add', 'a.txt'); const plan = await actions.prepare(root, 'commit');
    await writeFile(join(root, 'a.txt'), 'working\n'); const result = await actions.apply(root, plan.id, 'A useful commit');
    expect(result.message).toMatch(/^Committed [a-f0-9]{7}$/); expect((await git('show', 'HEAD:a.txt')).stdout).toBe('staged\n'); expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('working\n');
    expect((await git('log', '-1', '--format=%s')).stdout.trim()).toBe('A useful commit');
  });
  it('rejects a changed index between commit review and confirmation', async () => {
    await writeFile(join(root, 'a.txt'), 'staged\n'); await git('add', 'a.txt'); const plan = await actions.prepare(root, 'commit');
    await writeFile(join(root, 'b.txt'), 'added later\n'); await git('add', 'b.txt'); await expect(actions.apply(root, plan.id, 'Must not commit')).rejects.toThrow('changed after');
    expect((await git('log', '-1', '--format=%s')).stdout.trim()).toBe('Initial');
  });
  it('preserves configured clean filters and commit hooks for user actions', async () => {
    await writeFile(join(root, '.gitattributes'), '*.txt filter=upper\n'); await git('config', 'filter.upper.clean', 'tr a-z A-Z');
    await writeFile(join(root, 'a.txt'), 'lowercase\n'); const stage = await actions.prepare(root, 'stage', ['a.txt']); await actions.apply(root, stage.id);
    expect((await git('show', ':a.txt')).stdout).toBe('LOWERCASE\n');
    const hook = join(root, '.git/hooks/pre-commit'); await writeFile(hook, '#!/bin/sh\nprintf hook > hook-ran.txt\n'); await chmod(hook, 0o755);
    const commit = await actions.prepare(root, 'commit'); await actions.apply(root, commit.id, 'With hook'); expect(await readFile(join(root, 'hook-ran.txt'), 'utf8')).toBe('hook');
  });
  it('rejects protected paths, linked files, and protected staged contents', async () => {
    await writeFile(join(root, '.env'), 'private'); await symlink('.env', join(root, 'symbol.txt')); await link(join(root, '.env'), join(root, 'hard.txt'));
    await expect(actions.prepare(root, 'stage', ['.env'])).rejects.toThrow('regular project');
    await expect(actions.prepare(root, 'stage', ['symbol.txt'])).rejects.toThrow(); await expect(actions.prepare(root, 'stage', ['hard.txt'])).rejects.toThrow('regular project');
    await git('add', '.env'); await expect(actions.prepare(root, 'commit')).rejects.toThrow('protected files');
  });
  it('unstages before the first commit and supports registered worktrees', async () => {
    const unborn = join(root, 'unborn'); await mkdir(unborn); await exec('git', ['init', '-b', 'main'], { cwd: unborn }); await writeFile(join(unborn, 'first.txt'), 'first'); await exec('git', ['add', 'first.txt'], { cwd: unborn });
    const unstage = await actions.prepare(unborn, 'unstage'); await actions.apply(unborn, unstage.id); expect((await exec('git', ['ls-files'], { cwd: unborn })).stdout).toBe(''); expect(await readFile(join(unborn, 'first.txt'), 'utf8')).toBe('first');
    const tree = join(root, 'worktree'); await git('worktree', 'add', '-b', 'feature', tree); await writeFile(join(tree, 'a.txt'), 'tree'); const stage = await actions.prepare(tree, 'stage', ['a.txt']); await actions.apply(tree, stage.id);
    expect((await exec('git', ['show', ':a.txt'], { cwd: tree })).stdout).toBe('tree'); expect((await git('show', ':a.txt')).stdout).toBe('initial\n');
  });
  it('pushes the reviewed commit to a local test remote and rejects a changed branch', async () => {
    const remote = join(root, 'remote.git'); await exec('git', ['init', '--bare', remote]); await git('remote', 'add', 'origin', remote);
    const plan = await actions.prepare(root, 'push'); expect(plan.destination).toMatchObject({ remote: 'origin', branch: 'main', url: remote }); await actions.apply(root, plan.id);
    expect((await exec('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/main'])).stdout).toBe((await git('rev-parse', 'HEAD')).stdout);
    const stale = await actions.prepare(root, 'push'); await git('checkout', '-b', 'other'); await expect(actions.apply(root, stale.id)).rejects.toThrow('changed after');
  });
  it('does not force a non-fast-forward push', async () => {
    const remote = join(root, 'remote.git'); await exec('git', ['init', '--bare', remote]); await git('remote', 'add', 'origin', remote); await git('push', 'origin', 'main');
    await writeFile(join(root, 'a.txt'), 'remote version'); await git('commit', '-am', 'Remote version'); await git('push', 'origin', 'main'); const remoteHead = (await git('rev-parse', 'HEAD')).stdout;
    await git('reset', '--hard', 'HEAD~1'); await writeFile(join(root, 'a.txt'), 'local version'); await git('commit', '-am', 'Local version');
    const plan = await actions.prepare(root, 'push'); await expect(actions.apply(root, plan.id)).rejects.toThrow();
    expect((await exec('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/main'])).stdout).toBe(remoteHead);
  });
});
