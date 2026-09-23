import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store.js';
import { History } from '../server/history.js';
import { TaskLocals } from '../server/task-local.js';
import { TaskWorktrees } from '../server/task-worktree.js';
import { executeTool } from '../server/tools.js';
import { resolveProfileChoice } from '../server/profiles.js';
import type { ProjectWorktree } from '../shared/worktrees.js';

const exec = promisify(execFile);
describe('continuing a working copy task in the local project', () => {
  let root: string, project: string, store: Store, history: History, moves: TaskLocals, id: string, copy: ProjectWorktree;
  const git = async (cwd: string, ...args: string[]) => (await exec('git', args, { cwd })).stdout.trim();
  beforeEach(async () => {
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1'); vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
    root = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-task-local-'))); project = join(root, 'project'); await mkdir(project);
    await git(project, 'init', '-b', 'main'); await git(project, 'config', 'user.name', 'Fixture'); await git(project, 'config', 'user.email', 'fixture@local');
    await writeFile(join(project, 'notes.txt'), 'Original'); await writeFile(join(project, '.gitignore'), 'ignored.txt\n'); await git(project, 'add', '.'); await git(project, 'commit', '-m', 'Initial');
    store = new Store(join(root, 'state')); store.saveSettings({ workspace: project }); history = new History(store); moves = new TaskLocals(store, history);
    const plan = await store.worktrees.prepare(project, 'Retained source'); copy = await store.worktrees.create(project, plan.id);
    id = store.createSession({ workspace: copy.path, title: 'Keep my conversation', model: 'chosen-model', mode: 'plan', permissionMode: 'ask' }).id;
  });
  afterEach(async () => { store.close(); await rm(root, { recursive: true, force: true }); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  const prepare = () => moves.prepare(id, store.session(id).configRevision!);
  async function turn(text: string, content: string) {
    history.accept(id, { id: randomUUID(), sessionId: id, role: 'user', content: text, createdAt: Date.now() });
    await executeTool('write_file', { path: 'notes.txt', content }, { workspace: store.session(id).workspace, sessionId: id, signal: new AbortController().signal, prepareChange: change => history.prepareChange(id, change), onChange: change => history.commitChange(id, change), getTodos: () => [], onTodos: () => {} });
    store.saveMessage({ id: randomUUID(), sessionId: id, role: 'assistant', content: 'Finished', createdAt: Date.now() }); history.seal(id);
  }
  it('copies committed work, edits and staging to a fresh local branch and keeps the original worktree intact', async () => {
    const originalMain = await git(project, 'rev-parse', 'main');
    await writeFile(join(copy.path, 'notes.txt'), 'Committed improvement'); await git(copy.path, 'add', '.'); await git(copy.path, 'commit', '-m', 'Improvement');
    await turn('Continue this idea', 'Staged edit'); await git(copy.path, 'add', '.'); await writeFile(join(copy.path, 'notes.txt'), 'Unstaged edit'); await writeFile(join(copy.path, 'new.txt'), 'New file');
    const sourceStatus = await git(copy.path, 'status', '--porcelain=v1'), sourceIndex = await git(copy.path, 'write-tree'), messages = store.messages(id);
    store.saveTodos(id, [{ id: 'keep', content: 'Next step', status: 'pending' }]); store.enqueue(id, 'Review this queue', [], false);
    const plan = await prepare(); expect(plan.changedFiles).toBe(1); expect(plan.localEdits.files).toHaveLength(2);
    const moved = await moves.apply(id, plan.id);
    expect(moved.session).toMatchObject({ id, workspace: project, title: 'Keep my conversation', model: 'chosen-model', mode: 'plan', permissionMode: 'ask', configRevision: 1, historyRevision: 1 }); expect(moved.session.worktree).toBeUndefined();
    expect(store.messages(id).slice(0, -1)).toEqual(messages); expect(store.messages(id).at(-1)?.workspaceMove).toEqual({ from: copy.path, to: project, destination: 'local' });
    expect(store.queue(id)).toMatchObject({ paused: true, items: [{ content: 'Review this queue' }] }); expect(store.todos(id)).toHaveLength(1);
    expect(await git(project, 'symbolic-ref', '--short', 'HEAD')).toBe(plan.branch); expect(await git(project, 'rev-parse', 'main')).toBe(originalMain);
    expect(await readFile(join(project, 'notes.txt'), 'utf8')).toBe('Unstaged edit'); expect(await readFile(join(project, 'new.txt'), 'utf8')).toBe('New file'); expect(await git(project, 'show', ':notes.txt')).toBe('Staged edit');
    expect(await git(copy.path, 'status', '--porcelain=v1')).toBe(sourceStatus); expect(await git(copy.path, 'write-tree')).toBe(sourceIndex); expect(await git(copy.path, 'symbolic-ref', '--short', 'HEAD')).toBe(copy.branch);
    expect(store.worktrees.get(copy.id).status).toBe('ready');
  });
  it('starts new Undo history in local files and can continue the same task in another worktree afterward', async () => {
    await turn('Work in the copy', 'From working copy'); const earlier = history.state(id).undoId!;
    await moves.apply(id, (await prepare()).id); expect(history.state(id).canUndo).toBe(false); await expect(history.undo(id, earlier)).rejects.toThrow('moved');
    await turn('Work locally', 'Local continuation'); const localUndo = history.state(id).undoId!;
    await history.undo(id, localUndo); expect(await readFile(join(project, 'notes.txt'), 'utf8')).toBe('From working copy'); expect(await readFile(join(copy.path, 'notes.txt'), 'utf8')).toBe('From working copy');
    await history.redo(id, localUndo); expect(await readFile(join(copy.path, 'notes.txt'), 'utf8')).toBe('From working copy');
    const outward = new TaskWorktrees(store, history), plan = await outward.prepare(id, 'Another idea', false, store.session(id).configRevision!);
    const next = await outward.apply(id, plan.id); expect(next.session.id).toBe(id); expect(next.worktree.id).not.toBe(copy.id); expect(await readFile(join(next.worktree.path, 'notes.txt'), 'utf8')).toBe('Local continuation'); expect(await readFile(join(project, 'notes.txt'), 'utf8')).toBe('Local continuation');
  });
  it('refuses protected committed configuration before switching the local checkout', async () => {
    await mkdir(join(copy.path, '.litespeed'));
    const file = join(copy.path, '.litespeed/profiles.json');
    await writeFile(file, JSON.stringify({ version: 1, profiles: [{ id: 'review', name: 'Review', tools: ['read_file'], instructions: 'Pinned original' }], skills: [] }));
    await git(copy.path, 'add', '.'); await git(copy.path, 'commit', '-m', 'Profile source');
    const resolved = await resolveProfileChoice(copy.path, { profileId: 'review', skillIds: [] }); store.applyProfile(id, 0, resolved);
    // A protected committed configuration differs from the local checkout, so
    // this GUI move must refuse before replacing it; the pin stays unchanged.
    await expect(prepare()).rejects.toThrow('regular project files');
    expect(store.profileSnapshot(id)).toEqual(resolved.snapshot); expect(store.session(id).workspace).toBe(copy.path);
  });
  it('retains the original pinned profile when both folders contain a newer committed profile source', async () => {
    await mkdir(join(copy.path, '.litespeed'));
    const file = join(copy.path, '.litespeed/profiles.json'), profile = (instructions: string) => JSON.stringify({ version: 1, profiles: [{ id: 'review', name: 'Review', tools: ['read_file'], instructions }], skills: [] });
    await writeFile(file, profile('Pinned original')); await git(copy.path, 'add', '.'); await git(copy.path, 'commit', '-m', 'Profile');
    const resolved = await resolveProfileChoice(copy.path, { profileId: 'review', skillIds: [] }); store.applyProfile(id, 0, resolved);
    await writeFile(file, profile('Newer source')); await git(copy.path, 'add', '.'); await git(copy.path, 'commit', '-m', 'Newer profile');
    await git(project, 'merge', '--ff-only', copy.branch);
    const result = await moves.apply(id, (await prepare()).id);
    expect(result.session.profile).toEqual(resolved.snapshot!.active); expect(store.profileSnapshot(id)).toEqual(resolved.snapshot); expect(result.session.workspace).toBe(project);
  });
  it.each(['source file', 'source branch', 'local edits', 'local branch', 'task configuration', 'task message'] as const)('rejects a changed %s after review before switching the local checkout', async kind => {
    const plan = await prepare();
    if (kind === 'source file') await writeFile(join(copy.path, 'notes.txt'), 'Later source edit');
    if (kind === 'source branch') await git(copy.path, 'commit', '--allow-empty', '-m', 'Later source commit');
    if (kind === 'local edits') await writeFile(join(project, 'notes.txt'), 'Local edit');
    if (kind === 'local branch') await git(project, 'switch', '-c', 'different');
    if (kind === 'task configuration') store.updateSession(id, { model: 'different' });
    if (kind === 'task message') store.saveMessage({ id: randomUUID(), sessionId: id, role: 'system', content: 'A later note', createdAt: Date.now() });
    await expect(moves.apply(id, plan.id)).rejects.toThrow(/changed|local project has changes/i);
    expect(await git(project, 'symbolic-ref', '--short', 'HEAD')).toBe(kind === 'local branch' ? 'different' : 'main'); expect(store.session(id).workspace).toBe(copy.path);
    await expect(git(project, 'rev-parse', '--verify', plan.branch)).rejects.toThrow();
  });
  it('preserves ignored local files that would collide with a committed checkout or a copied addition', async () => {
    await writeFile(join(project, 'ignored.txt'), 'Local ignored file');
    await writeFile(join(copy.path, 'ignored.txt'), 'Source committed version'); await git(copy.path, 'add', '-f', 'ignored.txt'); await git(copy.path, 'commit', '-m', 'Tracked source file');
    await expect(prepare()).rejects.toThrow('already exists'); expect(await readFile(join(project, 'ignored.txt'), 'utf8')).toBe('Local ignored file');
    await git(copy.path, 'rm', 'ignored.txt'); await writeFile(join(copy.path, '.gitignore'), ''); await git(copy.path, 'add', '.'); await git(copy.path, 'commit', '-m', 'Stop ignoring'); await writeFile(join(copy.path, 'ignored.txt'), 'Untracked source version');
    await expect(prepare()).rejects.toThrow('already exists'); expect(await readFile(join(project, 'ignored.txt'), 'utf8')).toBe('Local ignored file'); expect(await git(project, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
  });
  it('rejects linked checkout files and special index flags before any local change', async () => {
    await symlink('notes.txt', join(copy.path, 'link')); await git(copy.path, 'add', 'link'); await git(copy.path, 'commit', '-m', 'Link');
    await expect(prepare()).rejects.toThrow('symbolic links'); await git(copy.path, 'rm', 'link'); await git(copy.path, 'commit', '-m', 'Remove link');
    await writeFile(join(copy.path, 'notes.txt'), 'New source commit'); await git(copy.path, 'add', '.'); await git(copy.path, 'commit', '-m', 'Update'); await git(project, 'update-index', '--assume-unchanged', 'notes.txt');
    await expect(prepare()).rejects.toThrow('special Git index flags'); expect(await readFile(join(project, 'notes.txt'), 'utf8')).toBe('Original');
  });
  it('does not run checkout hooks during local continuation', async () => {
    const marker = join(root, 'hook-ran'); await writeFile(join(project, '.git/hooks/post-checkout'), `#!/bin/sh\necho ran > '${marker}'\n`, { mode: 0o755 });
    await moves.apply(id, (await prepare()).id); await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('retains both copies and the original task if its atomic history move fails', async () => {
    await turn('Source work', 'Keep both copies'); const messages = store.messages(id), before = history.state(id), plan = await prepare();
    store.db.exec("CREATE TRIGGER reject_local_move BEFORE INSERT ON messages WHEN NEW.role='system' BEGIN SELECT RAISE(ABORT,'fixture move failure'); END;");
    await expect(moves.apply(id, plan.id)).rejects.toThrow('task remains in its worktree');
    expect(store.session(id).workspace).toBe(copy.path); expect(store.messages(id)).toEqual(messages); expect(history.state(id)).toEqual(before);
    expect(await readFile(join(project, 'notes.txt'), 'utf8')).toBe('Keep both copies'); expect(await readFile(join(copy.path, 'notes.txt'), 'utf8')).toBe('Keep both copies'); expect(await git(project, 'symbolic-ref', '--short', 'HEAD')).toBe(plan.branch);
  });
  it('requires the owning idle task and rejects unfinished history', async () => {
    const plan = await prepare(), other = store.createSession({ workspace: copy.path }); await expect(moves.apply(other.id, plan.id)).rejects.toThrow('expired');
    store.updateSession(id, { archived: true }); await expect(prepare()).rejects.toThrow('idle worktree'); store.updateSession(id, { archived: false });
    history.accept(id, { id: randomUUID(), sessionId: id, role: 'user', content: 'Unfinished', createdAt: Date.now() }); await expect(prepare()).rejects.toThrow('Finish the current turn');
    expect(await git(project, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
  });
});
