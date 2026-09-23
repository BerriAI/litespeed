import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, realpath, rm, writeFile, symlink, readFile, mkdir, link, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitFileDiff, gitReview } from '../server/git-review.js';

const exec = promisify(execFile);
describe('desktop Git review', () => {
  let root: string;
  const git = (...args: string[]) => exec('git', args, { cwd: root, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-review-')));
    await git('init', '-b', 'main'); await git('config', 'user.name', 'Test'); await git('config', 'user.email', 'test@example.com');
    await writeFile(join(root, 'hello.ts'), 'export const hello = "hello";\n'); await git('add', 'hello.ts'); await git('commit', '-m', 'Initial');
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  it('distinguishes the index, working tree, and committed branch changes', async () => {
    await git('checkout', '-b', 'feature'); await writeFile(join(root, 'hello.ts'), 'export const hello = "committed";\n'); await git('add', 'hello.ts'); await git('commit', '-m', 'Change greeting');
    await writeFile(join(root, 'hello.ts'), 'export const hello = "staged";\n'); await git('add', 'hello.ts');
    await writeFile(join(root, 'hello.ts'), 'export const hello = "working";\n');
    const working = await gitFileDiff(root, 'unstaged', 'hello.ts'); expect(working.before).toContain('staged'); expect(working.after).toContain('working');
    const staged = await gitFileDiff(root, 'staged', 'hello.ts'); expect(staged.before).toContain('committed'); expect(staged.after).toContain('staged');
    const branch = await gitFileDiff(root, 'branch', 'hello.ts', 'main'); expect(branch.before).toContain('"hello"'); expect(branch.after).toContain('committed');
    expect((await gitReview(root, 'staged')).files[0]).toMatchObject({ path: 'hello.ts', additions: 1, deletions: 1 });
  });
  it('handles new, deleted and empty files with exact before/after semantics', async () => {
    await writeFile(join(root, 'new.txt'), 'new\n'); await writeFile(join(root, 'empty.txt'), ''); await rm(join(root, 'hello.ts'));
    expect(await gitFileDiff(root, 'unstaged', 'new.txt')).toMatchObject({ before: null, after: 'new\n' });
    expect(await gitFileDiff(root, 'unstaged', 'empty.txt')).toMatchObject({ before: null, after: '' });
    expect(await gitFileDiff(root, 'unstaged', 'hello.ts')).toMatchObject({ after: null });
    expect((await gitReview(root, 'unstaged')).files.find(file => file.path === 'hello.ts')?.status).toBe('deleted');
  });
  it('works before the first commit and in registered worktrees', async () => {
    const child = join(root, 'unborn'); await mkdir(child); await exec('git', ['init', '-b', 'main'], { cwd: child }); await writeFile(join(child, 'first.txt'), 'first'); await exec('git', ['add', 'first.txt'], { cwd: child });
    expect(await gitFileDiff(child, 'staged', 'first.txt')).toMatchObject({ before: null, after: 'first' });
    const worktree = join(root, 'worktree'); await git('worktree', 'add', '-b', 'worktree-review', worktree); await writeFile(join(worktree, 'hello.ts'), 'worktree');
    expect((await gitReview(worktree, 'unstaged')).branch).toBe('worktree-review'); expect((await gitFileDiff(worktree, 'unstaged', 'hello.ts')).after).toBe('worktree');
  });
  it('does not return credentials or follow symlinks and hard links', async () => {
    await writeFile(join(root, '.env'), 'SECRET_VALUE'); await mkdir(join(root, '.github')); await writeFile(join(root, '.github', 'config.yml'), 'visible: true'); await symlink('.env', join(root, 'link.txt')); await link(join(root, '.env'), join(root, 'alias.txt'));
    const result = await gitReview(root, 'unstaged'); expect(result.files.some(file => file.path === '.env')).toBe(false); expect(result.files.some(file => file.path === '.github/config.yml')).toBe(true);
    await expect(gitFileDiff(root, 'unstaged', '.env')).rejects.toThrow('regular project file');
    const linked = await gitFileDiff(root, 'unstaged', 'link.txt'); expect(linked.notice).toBeTruthy(); expect(JSON.stringify(linked)).not.toContain('SECRET_VALUE');
    const alias = await gitFileDiff(root, 'unstaged', 'alias.txt'); expect(alias.notice).toBeTruthy(); expect(JSON.stringify(alias)).not.toContain('SECRET_VALUE');
    await expect(gitFileDiff(root, 'unstaged', '../outside')).rejects.toThrow();
  });
  it('never invokes configured diff drivers, text conversion or clean filters while reviewing', async () => {
    const sentinel = join(root, 'executed.txt');
    await writeFile(join(root, '.gitattributes'), '*.ts filter=danger diff=danger\n');
    await git('config', 'filter.danger.clean', `touch ${sentinel}`); await git('config', 'filter.danger.process', `touch ${sentinel}`); await git('config', 'diff.danger.command', `touch ${sentinel}`); await git('config', 'diff.danger.textconv', `touch ${sentinel}`); await git('config', 'core.fsmonitor', `touch ${sentinel}`);
    await writeFile(join(root, 'hello.ts'), 'safe preview');
    expect((await gitFileDiff(root, 'unstaged', 'hello.ts')).after).toBe('safe preview');
    await expect(readFile(sentinel)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('bounds large and binary previews and rejects unknown references', async () => {
    await writeFile(join(root, 'large.txt'), 'x'.repeat(70_000)); await writeFile(join(root, 'binary.bin'), Buffer.from([0, 1, 2]));
    expect((await gitFileDiff(root, 'unstaged', 'large.txt')).truncated).toBe(true); expect((await gitFileDiff(root, 'unstaged', 'binary.bin')).binary).toBe(true);
    await expect(gitReview(root, 'branch', '--output=bad')).rejects.toThrow('Choose a branch');
    await expect(gitFileDiff(root, 'unstaged', 'not-changed.txt')).rejects.toThrow('no longer');
  });
  it('identifies unresolved conflicts without presenting a missing index entry as an added file', async () => {
    await git('checkout', '-b', 'side'); await writeFile(join(root, 'hello.ts'), 'side\n'); await git('commit', '-am', 'Side');
    await git('checkout', 'main'); await writeFile(join(root, 'hello.ts'), 'main\n'); await git('commit', '-am', 'Main');
    await expect(git('merge', 'side')).rejects.toThrow();
    const result = await gitReview(root, 'unstaged'); expect(result.files.filter(file => file.path === 'hello.ts')).toHaveLength(1); expect(result.files[0].status).toBe('conflicted');
    expect((await gitFileDiff(root, 'unstaged', 'hello.ts')).notice).toContain('merge conflict');
  });
  it('labels metadata-only changes rather than showing an empty text diff', async () => {
    await chmod(join(root, 'hello.ts'), 0o755);
    expect((await gitFileDiff(root, 'unstaged', 'hello.ts')).notice).toContain('metadata change');
  });
});
