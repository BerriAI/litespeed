import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitBranchesService } from '../server/git-branches.js';
import type { GitBranchRequest } from '../shared/git-branches.js';
const exec = promisify(execFile);
describe('project branches', () => {
  let root: string, workspace: string, branches: GitBranchesService;
  const git = (...args: string[]) => exec('git', args, { cwd: workspace });
  const apply = async (request: GitBranchRequest) => branches.apply(workspace, (await branches.prepare(workspace, request)).id);
  beforeEach(async () => {
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1'); vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
    root = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-branches-'))); workspace = join(root, 'project'); await mkdir(workspace); branches = new GitBranchesService();
    await git('init', '-b', 'main'); await git('config', 'user.name', 'Test'); await git('config', 'user.email', 'test@example.com');
    await writeFile(join(workspace, 'file.txt'), 'main\n'); await git('add', '.'); await git('commit', '-m', 'Main');
  });
  afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
  it('lists, switches and creates branches while retaining the original branch and commits', async () => {
    await git('checkout', '-b', 'feature'); await writeFile(join(workspace, 'file.txt'), 'feature\n'); await git('commit', '-am', 'Feature'); await git('checkout', 'main');
    const listed = await branches.list(workspace); expect(listed.current).toBe('main'); expect(listed.entries.map(entry => entry.name).sort()).toEqual(['feature', 'main']); expect(listed.changedFiles).toBe(0);
    expect((await apply({ action: 'switch', ref: 'refs/heads/feature' })).current).toBe('feature'); expect(await readFile(join(workspace, 'file.txt'), 'utf8')).toBe('feature\n');
    expect((await apply({ action: 'create', name: 'design/polish' })).current).toBe('design/polish'); expect((await git('show', 'main:file.txt')).stdout).toBe('main\n');
  });
  it('carries staged, unstaged and new files to a new branch, but refuses switching with local changes', async () => {
    await git('branch', 'other'); await writeFile(join(workspace, 'file.txt'), 'staged'); await git('add', '.'); await writeFile(join(workspace, 'file.txt'), 'working'); await writeFile(join(workspace, 'new.txt'), 'new');
    await expect(branches.prepare(workspace, { action: 'switch', ref: 'refs/heads/other' })).rejects.toThrow('Commit or discard');
    const plan = await branches.prepare(workspace, { action: 'create', name: 'keep-work' }); expect(plan.changedFiles).toBe(2); await branches.apply(workspace, plan.id);
    expect((await git('show', ':file.txt')).stdout).toBe('staged'); expect(await readFile(join(workspace, 'file.txt'), 'utf8')).toBe('working'); expect(await readFile(join(workspace, 'new.txt'), 'utf8')).toBe('new');
  });
  it('creates a local tracking branch from an existing remote ref without fetching', async () => {
    await git('remote', 'add', 'origin', join(root, 'unavailable.git')); const sha = (await git('rev-parse', 'HEAD')).stdout.trim(); await git('update-ref', 'refs/remotes/origin/design', sha); await git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/design');
    const listed = await branches.list(workspace); expect(listed.entries.map(entry => entry.name)).toContain('origin/design'); expect(listed.entries.map(entry => entry.name)).not.toContain('origin/HEAD');
    const plan = await branches.prepare(workspace, { action: 'track', ref: 'refs/remotes/origin/design', name: 'design' }); expect(plan.upstream).toBe('origin/design'); await branches.apply(workspace, plan.id);
    expect((await git('rev-parse', '--abbrev-ref', '@{upstream}')).stdout.trim()).toBe('origin/design');
  });
  it('supports detached and unborn branches without changing files', async () => {
    await git('checkout', '--detach'); expect((await branches.list(workspace)).current).toBeNull(); await apply({ action: 'create', name: 'from-detached' });
    workspace = join(root, 'unborn'); await mkdir(workspace); await git('init', '-b', 'main'); await writeFile(join(workspace, 'draft.txt'), 'draft');
    expect(await branches.list(workspace)).toMatchObject({ current: 'main', head: null, changedFiles: 1 }); await apply({ action: 'create', name: 'first-work' }); expect((await git('symbolic-ref', '--short', 'HEAD')).stdout.trim()).toBe('first-work'); expect(await readFile(join(workspace, 'draft.txt'), 'utf8')).toBe('draft');
  });
  it('refuses occupied worktree branches and works normally from a registered working copy', async () => {
    const secondary = join(root, 'second project'); await git('worktree', 'add', '-b', 'other', secondary);
    expect((await branches.list(workspace)).entries.find(entry => entry.name === 'other')?.checkedOutAt).toBe(secondary);
    await expect(branches.prepare(workspace, { action: 'switch', ref: 'refs/heads/other' })).rejects.toThrow('another working copy');
    const plan = await branches.prepare(secondary, { action: 'create', name: 'worktree-feature' }); expect((await branches.apply(secondary, plan.id)).current).toBe('worktree-feature'); expect((await branches.list(workspace)).current).toBe('main');
  });
  it('rejects stale, expired, cross-project and replayed plans', async () => {
    const plan = await branches.prepare(workspace, { action: 'create', name: 'new' }); await git('branch', 'external'); await expect(branches.apply(workspace, plan.id)).rejects.toThrow('changed after review'); await expect(branches.apply(workspace, plan.id)).rejects.toThrow('expired');
    const valid = await branches.prepare(workspace, { action: 'create', name: 'new' }); await expect(branches.apply(root, valid.id)).rejects.toThrow('expired'); await branches.apply(workspace, valid.id); await expect(branches.apply(workspace, valid.id)).rejects.toThrow('expired');
    const expired = await branches.prepare(workspace, { action: 'create', name: 'later' }), now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60_000); await expect(branches.apply(workspace, expired.id)).rejects.toThrow('expired');
  });
  it('rechecks the remote commit when applying a tracking plan', async () => {
    await git('remote', 'add', 'origin', join(root, 'remote.git')); await git('update-ref', 'refs/remotes/origin/next', 'HEAD'); const plan = await branches.prepare(workspace, { action: 'track', ref: 'refs/remotes/origin/next', name: 'next' });
    await writeFile(join(workspace, 'file.txt'), 'newer'); await git('commit', '-am', 'Newer'); await git('update-ref', 'refs/remotes/origin/next', 'HEAD'); await expect(branches.apply(workspace, plan.id)).rejects.toThrow('changed after review'); expect((await branches.list(workspace)).current).toBe('main');
  });
  it('refuses invalid/existing branch names, missing refs and active Git operations', async () => {
    for (const name of ['-f', '@{-1}', '../escape', 'a b', 'main', 'foo.lock', 'refs/../other']) await expect(branches.prepare(workspace, { action: 'create', name })).rejects.toThrow();
    await expect(branches.prepare(workspace, { action: 'switch', ref: 'refs/heads/missing' })).rejects.toThrow('no longer');
    await writeFile(join(workspace, '.git/MERGE_HEAD'), (await git('rev-parse', 'HEAD')).stdout); expect((await branches.list(workspace)).blocked).toContain('Finish or cancel'); await expect(branches.prepare(workspace, { action: 'create', name: 'new' })).rejects.toThrow('Finish or cancel');
  });
  it('keeps ignored files that the target branch would replace and does not force checkout', async () => {
    await writeFile(join(workspace, '.gitignore'), 'local.txt\n'); await git('add', '.'); await git('commit', '-m', 'Ignore'); await git('checkout', '-b', 'target'); await writeFile(join(workspace, 'local.txt'), 'tracked'); await git('add', '-f', 'local.txt'); await git('commit', '-m', 'Tracked'); await git('checkout', 'main'); await writeFile(join(workspace, 'local.txt'), 'private local');
    const plan = await branches.prepare(workspace, { action: 'switch', ref: 'refs/heads/target' }); await expect(branches.apply(workspace, plan.id)).rejects.toThrow('could not change'); expect(await readFile(join(workspace, 'local.txt'), 'utf8')).toBe('private local'); expect((await branches.list(workspace)).current).toBe('main');
  });
  it('honors the configured checkout hook and returns no branches for ordinary folders', async () => {
    const { chmod } = await import('node:fs/promises'); await writeFile(join(workspace, '.git/hooks/post-checkout'), '#!/bin/sh\nprintf ran > "$GIT_DIR/hook-ran"\n'); await chmod(join(workspace, '.git/hooks/post-checkout'), 0o755);
    await apply({ action: 'create', name: 'hooked' }); expect(await readFile(join(workspace, '.git/hook-ran'), 'utf8')).toBe('ran'); expect((await branches.list(root)).isRepo).toBe(false);
  });
  it('protects credentials, configured application state and hard-linked checkout targets', async () => {
    await git('checkout', '-b', 'credentials'); await writeFile(join(workspace, '.env'), 'example credential'); await git('add', '-f', '.env'); await git('commit', '-m', 'Credentials'); await git('checkout', 'main');
    await expect(branches.prepare(workspace, { action: 'switch', ref: 'refs/heads/credentials' })).rejects.toThrow('protected files');
    await git('checkout', '-b', 'app-state'); await mkdir(join(workspace, 'desktop-data')); await writeFile(join(workspace, 'desktop-data/saved.json'), 'saved'); await git('add', '.'); await git('commit', '-m', 'State'); await git('checkout', 'main');
    vi.stubEnv('LITESPEED_DATA_DIR', join(workspace, 'desktop-data')); await expect(branches.prepare(workspace, { action: 'switch', ref: 'refs/heads/app-state' })).rejects.toThrow('protected files');
    await git('checkout', '-b', 'linked'); await writeFile(join(workspace, 'file.txt'), 'target'); await git('commit', '-am', 'Target'); await git('checkout', 'main');
    const { link } = await import('node:fs/promises'); await link(join(workspace, 'file.txt'), join(root, 'external.txt')); await expect(branches.prepare(workspace, { action: 'switch', ref: 'refs/heads/linked' })).rejects.toThrow('linked files'); expect(await readFile(join(root, 'external.txt'), 'utf8')).toBe('main\n');
  });
  it('lists branches in large clean projects without returning the full index', async () => {
    await mkdir(join(workspace, 'files'));
    await Promise.all(Array.from({ length: 700 }, (_, index) => writeFile(join(workspace, 'files', `${index}-` + 'long-name-'.repeat(8) + '.txt'), 'content')));
    await git('add', '.'); await git('commit', '-m', 'Large index'); await git('branch', 'feature');
    const result = await branches.list(workspace); expect(result.current).toBe('main'); expect(result.entries.map(entry => entry.name).sort()).toEqual(['feature', 'main']); expect(result.changedFiles).toBe(0);
  });
});
