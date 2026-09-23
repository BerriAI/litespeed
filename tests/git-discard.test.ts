import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { chmod, link, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitDiscards } from '../server/git-discard.js';
import { Store } from '../server/store.js';
import { observeDiscardFile, removeDiscardFile, restoreDiscardFile } from '../server/git-discard-files.js';
const exec = promisify(execFile);
describe('recoverable Git discard', () => {
  let root: string, workspace: string, store: Store, discards: GitDiscards;
  const git = (...args: string[]) => exec('git', args, { cwd: workspace });
  beforeEach(async () => {
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1'); vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
    root = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-discard-'))); workspace = join(root, 'project'); await mkdir(workspace);
    await git('init', '-b', 'main'); await git('config', 'user.name', 'Test'); await git('config', 'user.email', 'test@example.com');
    await writeFile(join(workspace, 'a.txt'), 'initial\n'); await git('add', '.'); await git('commit', '-m', 'Initial');
    store = new Store(join(root, 'state')); discards = new GitDiscards(store);
  });
  afterEach(async () => { vi.restoreAllMocks(); store.close(); await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
  const discard = async (paths: string[]) => discards.apply(workspace, (await discards.prepare(workspace, paths)).id);
  const restore = async (id: string, paths?: string[]) => discards.apply(workspace, (await discards.prepareRestore(workspace, id, paths)).id);
  it('discards only selected unstaged changes and restores their exact contents without changing the index', async () => {
    await writeFile(join(workspace, 'a.txt'), 'staged\n'); await git('add', 'a.txt'); await writeFile(join(workspace, 'a.txt'), 'working\n'); await writeFile(join(workspace, 'other.txt'), 'preserve');
    const result = await discard(['a.txt']); expect(result.backup.status).toBe('discarded'); expect(await readFile(join(workspace, 'a.txt'), 'utf8')).toBe('staged\n');
    expect((await git('show', ':a.txt')).stdout).toBe('staged\n'); expect(await readFile(join(workspace, 'other.txt'), 'utf8')).toBe('preserve');
    await restore(result.backup.id); expect(await readFile(join(workspace, 'a.txt'), 'utf8')).toBe('working\n'); expect((await git('show', ':a.txt')).stdout).toBe('staged\n'); expect(discards.list(workspace)[0].status).toBe('restored');
  });
  it('handles new binary/executable files, tracked deletions, and literal pathspec names', async () => {
    const binary = Buffer.from([0, 255, 1, 2, 3, 13, 10]); await writeFile(join(workspace, ':(glob)*'), binary); await chmod(join(workspace, ':(glob)*'), 0o750); await rm(join(workspace, 'a.txt'));
    const result = await discard([':(glob)*', 'a.txt']); await expect(readFile(join(workspace, ':(glob)*'))).rejects.toThrow(); expect(await readFile(join(workspace, 'a.txt'), 'utf8')).toBe('initial\n');
    expect(discards.original(workspace, result.backup.id, ':(glob)*')).toEqual(binary);
    await restore(result.backup.id); expect(await readFile(join(workspace, ':(glob)*'))).toEqual(binary); expect((await stat(join(workspace, ':(glob)*'))).mode & 0o777).toBe(0o750); await expect(readFile(join(workspace, 'a.txt'))).rejects.toThrow();
  });
  it('restores binary tracked changes and permission-only changes', async () => {
    await writeFile(join(workspace, 'binary.dat'), Buffer.from([0, 1, 2, 255])); await git('add', 'binary.dat'); await git('commit', '-m', 'Binary');
    await writeFile(join(workspace, 'binary.dat'), Buffer.from([0, 1, 5, 255])); await chmod(join(workspace, 'a.txt'), 0o755);
    const result = await discard(['binary.dat', 'a.txt']); expect(await readFile(join(workspace, 'binary.dat'))).toEqual(Buffer.from([0, 1, 2, 255])); expect((await stat(join(workspace, 'a.txt'))).mode & 0o111).toBe(0);
    await restore(result.backup.id); expect(await readFile(join(workspace, 'binary.dat'))).toEqual(Buffer.from([0, 1, 5, 255])); expect((await stat(join(workspace, 'a.txt'))).mode & 0o111).toBe(0o111);
  });
  it('uses the normal Git smudge filter when discarding and the exact original bytes when restoring', async () => {
    await writeFile(join(workspace, '.gitattributes'), '*.txt filter=case\n'); await git('config', 'filter.case.clean', 'tr a-z A-Z'); await git('config', 'filter.case.smudge', 'tr A-Z a-z');
    await writeFile(join(workspace, 'a.txt'), 'staged\n'); await git('add', '.'); await git('commit', '-m', 'Filters'); await writeFile(join(workspace, 'a.txt'), 'Working Copy\r\n');
    const result = await discard(['a.txt']); expect(await readFile(join(workspace, 'a.txt'), 'utf8')).toBe('staged\n'); await restore(result.backup.id); expect(await readFile(join(workspace, 'a.txt'), 'utf8')).toBe('Working Copy\r\n');
  });
  it('retains backups through a restart and refuses to overwrite later edits while allowing an original copy', async () => {
    await writeFile(join(workspace, 'a.txt'), 'discarded work\n'); const result = await discard(['a.txt']);
    store.close(); store = new Store(join(root, 'state')); discards = new GitDiscards(store); expect(discards.list(workspace)[0].id).toBe(result.backup.id);
    await writeFile(join(workspace, 'a.txt'), 'newer work\n'); await expect(restore(result.backup.id)).rejects.toThrow('changed after the discard'); expect(await readFile(join(workspace, 'a.txt'), 'utf8')).toBe('newer work\n');
    expect(discards.original(workspace, result.backup.id, 'a.txt').toString()).toBe('discarded work\n');
  });
  it('rejects changed files, changed index, changed branch, expired plans and replay', async () => {
    await writeFile(join(workspace, 'a.txt'), 'first\n'); const first = await discards.prepare(workspace, ['a.txt']); await writeFile(join(workspace, 'a.txt'), 'other\n'); await expect(discards.apply(workspace, first.id)).rejects.toThrow('changed after'); expect(discards.list(workspace)).toEqual([]);
    const second = await discards.prepare(workspace, ['a.txt']); await git('add', 'a.txt'); await writeFile(join(workspace, 'a.txt'), 'later\n'); await expect(discards.apply(workspace, second.id)).rejects.toThrow('changed after');
    const third = await discards.prepare(workspace, ['a.txt']); await git('checkout', '-b', 'feature'); await expect(discards.apply(workspace, third.id)).rejects.toThrow('changed after');
    await expect(discards.apply(workspace, third.id)).rejects.toThrow('expired');
    const expired = await discards.prepare(workspace, ['a.txt']); const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60_000); await expect(discards.apply(workspace, expired.id)).rejects.toThrow('expired');
  });
  it('preflights every restore target and keeps a durable partial backup when an operation stops', async () => {
    await writeFile(join(workspace, 'a.txt'), 'first edit'); await writeFile(join(workspace, 'b.txt'), 'new file');
    const plan = await discards.prepare(workspace, ['a.txt', 'b.txt']); const abort = new AbortController();
    const original = store.db.prepare.bind(store.db);
    vi.spyOn(store.db, 'prepare').mockImplementation(sql => {
      const statement = original(sql);
      if (sql.startsWith('INSERT INTO git_discard_backups')) {
        const run = statement.run.bind(statement); vi.spyOn(statement, 'run').mockImplementation((...args: Parameters<typeof run>) => { const result = run(...args); const saved = JSON.parse(args[3] as string); if (saved.files[0].state === 'discarded') abort.abort(new Error('Stopped')); return result; });
      }
      return statement;
    });
    await expect(discards.apply(workspace, plan.id, abort.signal)).rejects.toThrow('retained'); vi.restoreAllMocks();
    const backup = discards.list(workspace)[0]; expect(backup.status).toBe('interrupted'); expect(await readFile(join(workspace, 'a.txt'), 'utf8')).toBe('initial\n'); expect(await readFile(join(workspace, 'b.txt'), 'utf8')).toBe('new file');
    await restore(backup.id); expect(await readFile(join(workspace, 'a.txt'), 'utf8')).toBe('first edit'); expect(await readFile(join(workspace, 'b.txt'), 'utf8')).toBe('new file');
  });
  it('rejects later edits during restore review, permits selected restores, and removes only the saved backup', async () => {
    await writeFile(join(workspace, 'a.txt'), 'a edit'); await writeFile(join(workspace, 'b.txt'), 'b edit'); const result = await discard(['a.txt', 'b.txt']);
    const plan = await discards.prepareRestore(workspace, result.backup.id); await writeFile(join(workspace, 'a.txt'), 'later'); await expect(discards.apply(workspace, plan.id)).rejects.toThrow('changed after'); await expect(readFile(join(workspace, 'b.txt'))).rejects.toThrow();
    await restore(result.backup.id, ['b.txt']); expect(await readFile(join(workspace, 'b.txt'), 'utf8')).toBe('b edit'); discards.remove(workspace, result.backup.id); expect(discards.list(workspace)).toEqual([]); expect(await readFile(join(workspace, 'a.txt'), 'utf8')).toBe('later');
  });
  it('rejects protected, linked, aliased-parent and oversized files before changing anything', async () => {
    await writeFile(join(workspace, '.env'), 'secret'); await symlink('a.txt', join(workspace, 'alias')); await link(join(workspace, 'a.txt'), join(workspace, 'hard'));
    for (const name of ['.env', 'alias', 'hard']) await expect(discards.prepare(workspace, [name])).rejects.toThrow();
    await mkdir(join(workspace, 'real')); await writeFile(join(workspace, 'real/file'), 'data'); await symlink('real', join(workspace, 'parent'));
    await expect(observeDiscardFile(workspace, 'parent/file')).rejects.toThrow(); await writeFile(join(workspace, 'large'), Buffer.alloc(8 * 1024 * 1024 + 1)); await expect(discards.prepare(workspace, ['large'])).rejects.toThrow('8 MiB'); expect(discards.list(workspace)).toEqual([]);
  });
  it('refuses a final target that changes before restoration and preserves file contents', async () => {
    const observation = await observeDiscardFile(workspace, 'a.txt'); await writeFile(join(workspace, 'b.txt'), 'new'); const copy = (await observeDiscardFile(workspace, 'b.txt')).copy;
    await writeFile(join(workspace, 'a.txt'), 'newer'); await expect(restoreDiscardFile(workspace, 'a.txt', observation, copy)).rejects.toThrow('changed'); expect(await readFile(join(workspace, 'a.txt'), 'utf8')).toBe('newer');
  });
  it('rechecks no-op restores and missing removals before reporting recovery', async () => {
    const existing = await observeDiscardFile(workspace, 'a.txt'), missing = await observeDiscardFile(workspace, 'missing.txt');
    await restoreDiscardFile(workspace, 'a.txt', existing, existing.copy);
    await removeDiscardFile(workspace, 'missing.txt', missing);
    await writeFile(join(workspace, 'a.txt'), 'newer edit'); await writeFile(join(workspace, 'missing.txt'), 'appeared');
    await expect(restoreDiscardFile(workspace, 'a.txt', existing, existing.copy)).rejects.toThrow('changed');
    await expect(restoreDiscardFile(workspace, 'missing.txt', missing, null)).rejects.toThrow('changed');
    await expect(removeDiscardFile(workspace, 'missing.txt', missing)).rejects.toThrow('changed');
    expect(await readFile(join(workspace, 'a.txt'), 'utf8')).toBe('newer edit'); expect(await readFile(join(workspace, 'missing.txt'), 'utf8')).toBe('appeared');
  });
  it('bounds retained backups and refuses to mutate files when backup persistence fails', async () => {
    await writeFile(join(workspace, 'a.txt'), 'edit'); const first = await discard(['a.txt']);
    const row = store.db.prepare('SELECT data,bytes FROM git_discard_backups WHERE id=?').get(first.backup.id) as { data: string; bytes: number }, backup = JSON.parse(row.data);
    for (let i = 0; i < 19; i++) { const id = randomUUID(); store.db.prepare('INSERT INTO git_discard_backups VALUES(?,?,?,?,?)').run(id, workspace, Date.now(), JSON.stringify({ ...backup, id }), row.bytes); }
    await writeFile(join(workspace, 'a.txt'), 'new edit'); const plan = await discards.prepare(workspace, ['a.txt']); await expect(discards.apply(workspace, plan.id)).rejects.toThrow('20-backup'); expect(await readFile(join(workspace, 'a.txt'), 'utf8')).toBe('new edit');
    store.db.prepare('DELETE FROM git_discard_backups').run(); const next = await discards.prepare(workspace, ['a.txt']); const original = store.db.prepare.bind(store.db);
    vi.spyOn(store.db, 'prepare').mockImplementation(sql => { if (sql.startsWith('INSERT INTO git_discard_backups')) throw new Error('Storage unavailable'); return original(sql); });
    await expect(discards.apply(workspace, next.id)).rejects.toThrow('Storage unavailable'); expect(await readFile(join(workspace, 'a.txt'), 'utf8')).toBe('new edit');
  });
  it('marks unfinished records after restart, leaves unknown intervening contents alone, and validates the saved workspace', async () => {
    await writeFile(join(workspace, 'a.txt'), 'original edit'); const result = await discard(['a.txt']);
    const row = store.db.prepare('SELECT data FROM git_discard_backups WHERE id=?').get(result.backup.id) as { data: string }, backup = JSON.parse(row.data);
    backup.status = 'discarding'; backup.files[0].state = 'pending'; delete backup.files[0].after;
    store.db.prepare('UPDATE git_discard_backups SET data=? WHERE id=?').run(JSON.stringify(backup), result.backup.id);
    store.close(); store = new Store(join(root, 'state')); discards = new GitDiscards(store);
    expect(discards.list(workspace)[0].status).toBe('interrupted'); await expect(restore(result.backup.id)).rejects.toThrow('changed after'); expect(discards.original(workspace, result.backup.id, 'a.txt').toString()).toBe('original edit');
    backup.workspace = root; store.db.prepare('UPDATE git_discard_backups SET data=? WHERE id=?').run(JSON.stringify(backup), result.backup.id);
    await expect(discards.prepareRestore(workspace, result.backup.id)).rejects.toThrow('location');
  });

  it('checks the staged size before replacing a small working file and isolates registered worktrees', async () => {
    await writeFile(join(workspace, 'large.dat'), Buffer.alloc(8 * 1024 * 1024 + 1)); await git('add', 'large.dat'); await writeFile(join(workspace, 'large.dat'), 'small working copy');
    await expect(discards.prepare(workspace, ['large.dat'])).rejects.toThrow('staged version exceeds'); expect(await readFile(join(workspace, 'large.dat'), 'utf8')).toBe('small working copy');
    const tree = join(root, 'worktree'); await git('worktree', 'add', '-b', 'feature', tree); await writeFile(join(tree, 'a.txt'), 'worktree edit');
    const plan = await discards.prepare(tree, ['a.txt']), discarded = await discards.apply(tree, plan.id); expect(await readFile(join(tree, 'a.txt'), 'utf8')).toBe('initial\n');
    expect(discards.list(workspace)).toEqual([]); expect(discards.list(tree)[0].id).toBe(discarded.backup.id);
    await discards.apply(tree, (await discards.prepareRestore(tree, discarded.backup.id)).id); expect(await readFile(join(tree, 'a.txt'), 'utf8')).toBe('worktree edit'); expect(await readFile(join(workspace, 'a.txt'), 'utf8')).toBe('initial\n');
  });

});
