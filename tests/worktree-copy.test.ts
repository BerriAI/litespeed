import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, link, mkdtemp, mkdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store.js';
import { applyWorktreeCopy, captureWorktreeCopy } from '../server/worktree-copy.js';

const exec = promisify(execFile);
describe('copying reviewed local edits into a worktree', () => {
  let root: string, project: string, store: Store;
  const git = (...args: string[]) => exec('git', args, { cwd: project });
  const copy = async () => store.worktrees.create(project, (await store.worktrees.prepare(project, 'Include local edits', undefined, undefined, true)).id);
  beforeEach(async () => {
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1'); vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
    root = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-worktree-copy-'))); project = join(root, 'project'); await mkdir(project);
    await git('init', '-b', 'main'); await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'fixture@local');
    await writeFile(join(project, 'notes.txt'), 'Original notes\n'); await writeFile(join(project, 'remove.txt'), 'Remove later\n');
    await writeFile(join(project, 'rename.txt'), 'Rename later\n'); await writeFile(join(project, '.gitignore'), 'cache/\n');
    await git('add', '.'); await git('commit', '-m', 'Initial'); store = new Store(join(root, 'state'));
  });
  afterEach(async () => { store.close(); await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
  it('preserves exact staged and unstaged versions, binary bytes, deletions, renames and new files without writing the original index', async () => {
    await writeFile(join(project, 'notes.txt'), 'Staged notes\n'); await git('add', 'notes.txt'); await writeFile(join(project, 'notes.txt'), 'Working notes\n');
    await git('rm', 'remove.txt'); await rename(join(project, 'rename.txt'), join(project, 'renamed.txt')); await git('add', 'rename.txt', 'renamed.txt');
    const binary = Buffer.from([0, 255, 192, 128, 31, 4]); await writeFile(join(project, 'new, file.bin'), binary); await writeFile(join(project, 'new.txt'), 'Untracked\n');
    await mkdir(join(project, 'cache')); await writeFile(join(project, 'cache', 'data'), 'Not copied');
    const index = await readFile(join(project, '.git', 'index')), status = (await git('status', '--porcelain=v1', '-z')).stdout;
    const plan = await store.worktrees.prepare(project, 'With edits', undefined, undefined, true); expect(plan.localEdits?.files).toHaveLength(6); expect(plan.localEdits?.files.some(file => file.path.startsWith('cache'))).toBe(false);
    const result = await store.worktrees.create(project, plan.id);
    expect(await readFile(join(result.path, 'notes.txt'), 'utf8')).toBe('Working notes\n'); expect((await exec('git', ['show', ':notes.txt'], { cwd: result.path })).stdout).toBe('Staged notes\n');
    expect(await readFile(join(result.path, 'new, file.bin'))).toEqual(binary); expect(await readFile(join(result.path, 'new.txt'), 'utf8')).toBe('Untracked\n');
    await expect(readFile(join(result.path, 'remove.txt'))).rejects.toMatchObject({ code: 'ENOENT' }); await expect(readFile(join(result.path, 'cache', 'data'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await exec('git', ['status', '--porcelain=v1', '-z'], { cwd: result.path })).stdout).toBe(status);
    expect(await readFile(join(project, '.git', 'index'))).toEqual(index); expect((await git('status', '--porcelain=v1', '-z')).stdout).toBe(status);
  });
  it('copies executable permissions, empty new files and intent-to-add without silently staging them', async () => {
    await writeFile(join(project, 'notes.txt'), '#!/bin/sh\n'); await chmod(join(project, 'notes.txt'), 0o755);
    await writeFile(join(project, 'new.txt'), 'Intended content'); await git('add', '-N', 'new.txt'); await writeFile(join(project, 'empty.txt'), '');
    const expected = (await git('status', '--porcelain=v1', '-z')).stdout, result = await copy();
    expect((await exec('git', ['status', '--porcelain=v1', '-z'], { cwd: result.path })).stdout).toBe(expected);
    expect((await exec('git', ['diff', '--cached', '--name-only'], { cwd: result.path })).stdout).toBe('');
    expect(await readFile(join(result.path, 'new.txt'), 'utf8')).toBe('Intended content'); expect((await readFile(join(result.path, 'empty.txt'))).length).toBe(0);
  });
  it('rejects changed content, newly created files and changed staging before creating a folder or branch', async () => {
    await writeFile(join(project, 'notes.txt'), 'Reviewed');
    for (const mutate of [async () => writeFile(join(project, 'notes.txt'), 'Changed'), async () => writeFile(join(project, 'new.txt'), 'New'), async () => git('add', 'notes.txt')]) {
      const plan = await store.worktrees.prepare(project, 'Stale', undefined, undefined, true); await mutate();
      await expect(store.worktrees.create(project, plan.id)).rejects.toThrow('changed after review');
      expect(store.worktrees.list()).toHaveLength(0); expect((await git('branch', '--list', plan.branch)).stdout).toBe('');
    }
  });
  it('copies staged deletion with a recreated untracked file and a staged addition deleted from disk', async () => {
    await git('rm', 'notes.txt'); await writeFile(join(project, 'notes.txt'), 'Recreated outside index');
    await writeFile(join(project, 'added.txt'), 'Only staged now'); await git('add', 'added.txt'); await rm(join(project, 'added.txt'));
    const expected = (await git('status', '--porcelain=v1', '-z')).stdout, result = await copy();
    expect((await exec('git', ['status', '--porcelain=v1', '-z'], { cwd: result.path })).stdout).toBe(expected);
    expect((await exec('git', ['show', ':added.txt'], { cwd: result.path })).stdout).toBe('Only staged now');
    expect(await readFile(join(result.path, 'notes.txt'), 'utf8')).toBe('Recreated outside index');
  });
  it('rejects protected files and linked source files before creating anything', async () => {
    await writeFile(join(project, '.env'), 'PRIVATE_FIXTURE=local'); await expect(copy()).rejects.toThrow('regular project files'); await rm(join(project, '.env'));
    await writeFile(join(root, 'outside'), 'Outside'); await symlink(join(root, 'outside'), join(project, 'linked.txt')); await expect(copy()).rejects.toThrow('regular project file'); await rm(join(project, 'linked.txt'));
    await link(join(root, 'outside'), join(project, 'linked.txt')); await expect(copy()).rejects.toThrow('regular project file'); expect(store.worktrees.list()).toHaveLength(0);
  });
  it('bounds both changed-file count and captured bytes', async () => {
    await Promise.all(Array.from({ length: 201 }, (_, index) => writeFile(join(project, `file-${index}`), ''))); await expect(copy()).rejects.toThrow('200 changed files');
    await Promise.all(Array.from({ length: 201 }, (_, index) => rm(join(project, `file-${index}`))));
    await writeFile(join(project, 'large.bin'), Buffer.alloc(8 * 1024 * 1024 + 1)); await expect(copy()).rejects.toThrow('8 MiB'); await rm(join(project, 'large.bin'));
    for (let index = 0; index < 3; index++) await writeFile(join(project, `large-${index}.bin`), Buffer.alloc(6 * 1024 * 1024));
    await expect(copy()).rejects.toThrow('16 MiB'); expect(store.worktrees.list()).toHaveLength(0);
  });
  it('suppresses checkout hooks and configured filters while copying exact reviewed bytes', async () => {
    await writeFile(join(project, '.gitattributes'), '*.txt filter=fixture\n'); await git('add', '.gitattributes'); await git('commit', '-m', 'Attributes');
    const marker = join(root, 'ran'); await git('config', 'filter.fixture.smudge', `touch '${marker}'; cat`); await git('config', 'filter.fixture.clean', `touch '${marker}'; cat`);
    await writeFile(join(project, '.git', 'hooks', 'post-checkout'), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    await writeFile(join(project, 'notes.txt'), 'Exact copied bytes'); const result = await copy();
    expect(await readFile(join(result.path, 'notes.txt'), 'utf8')).toBe('Exact copied bytes'); await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('refuses to overwrite a destination modified before copying and retains source bytes', async () => {
    await writeFile(join(project, 'notes.txt'), 'Reviewed edit'); const snapshot = await captureWorktreeCopy(project);
    const clean = await store.worktrees.create(project, (await store.worktrees.prepare(project, 'Destination')).id);
    await writeFile(join(clean.path, 'notes.txt'), 'Someone else wrote this');
    await expect(applyWorktreeCopy(clean.path, snapshot)).rejects.toThrow('changed before local edits');
    expect(await readFile(join(clean.path, 'notes.txt'), 'utf8')).toBe('Someone else wrote this'); expect(await readFile(join(project, 'notes.txt'), 'utf8')).toBe('Reviewed edit');
  });
  it('preserves an ignored destination file that appears before applying a reviewed addition', async () => {
    await mkdir(join(project, 'cache')); await writeFile(join(project, 'cache/new.txt'), 'Reviewed addition'); await git('add', '-f', 'cache/new.txt');
    const snapshot = await captureWorktreeCopy(project), target = await store.worktrees.create(project, (await store.worktrees.prepare(project, 'Destination')).id);
    await mkdir(join(target.path, 'cache')); await writeFile(join(target.path, 'cache/new.txt'), 'Appeared in destination');
    await expect(applyWorktreeCopy(target.path, snapshot)).rejects.toThrow('appeared outside Git');
    expect(await readFile(join(target.path, 'cache/new.txt'), 'utf8')).toBe('Appeared in destination');
  });
});
