import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store.js';
import { History } from '../server/history.js';
import { TaskWorktrees } from '../server/task-worktree.js';
import { executeTool } from '../server/tools.js';
import { resolveProfileChoice } from '../server/profiles.js';

const exec = promisify(execFile);
describe('continuing a local task in a worktree', () => {
  let root: string, project: string, store: Store, history: History, moves: TaskWorktrees, id: string;
  const git = async (cwd: string, ...args: string[]) => (await exec('git', args, { cwd })).stdout.trim();
  beforeEach(async () => {
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1'); vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
    root = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-task-worktree-'))); project = join(root, 'project'); await mkdir(project);
    await git(project, 'init', '-b', 'main'); await git(project, 'config', 'user.name', 'Fixture'); await git(project, 'config', 'user.email', 'fixture@local');
    await writeFile(join(project, 'notes.txt'), 'Original'); await git(project, 'add', '.'); await git(project, 'commit', '-m', 'Initial');
    store = new Store(join(root, 'state')); store.saveSettings({ workspace: project }); history = new History(store); moves = new TaskWorktrees(store, history);
    id = store.createSession({ workspace: project, title: 'Keep my conversation', model: 'chosen-model', mode: 'plan', permissionMode: 'ask' }).id;
  });
  afterEach(async () => { store.close(); await rm(root, { recursive: true, force: true }); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  const prepare = () => moves.prepare(id, 'Continue this idea', false, store.session(id).configRevision!);
  async function turn(text: string, content?: string) {
    history.accept(id, { id: randomUUID(), sessionId: id, role: 'user', content: text, createdAt: Date.now() });
    if (content !== undefined) await executeTool('write_file', { path: 'notes.txt', content }, { workspace: store.session(id).workspace, sessionId: id, signal: new AbortController().signal, prepareChange: change => history.prepareChange(id, change), onChange: change => history.commitChange(id, change), getTodos: () => [], onTodos: () => {} });
    store.saveMessage({ id: randomUUID(), sessionId: id, role: 'assistant', content: 'Finished', providerMetadata: { signed: 'fixture' }, createdAt: Date.now() }); history.seal(id);
  }
  it('moves the same conversation, todos and choices with copied staging while preserving the source and queued work', async () => {
    await turn('Improve the notes', 'Staged improvement'); await git(project, 'add', '.'); await writeFile(join(project, 'notes.txt'), 'Latest local edit');
    store.saveTodos(id, [{ id: 'todo', content: 'Review', status: 'pending' }]); store.enqueue(id, 'Review before sending', [], false);
    const before = store.messages(id), sourceStatus = await git(project, 'status', '--porcelain=v1'), sourceIndex = await git(project, 'write-tree');
    const plan = await prepare(), result = await moves.apply(id, plan.id);
    expect(result.session).toMatchObject({ id, title: 'Keep my conversation', model: 'chosen-model', mode: 'plan', permissionMode: 'ask', workspace: result.worktree.path, configRevision: 1, historyRevision: 1 });
    expect(store.sessions()).toHaveLength(1); expect(store.messages(id).slice(0, -1)).toEqual(before); expect(store.messages(id).at(-1)?.content).toContain(result.worktree.path);
    expect(store.todos(id)).toEqual([{ id: 'todo', content: 'Review', status: 'pending' }]); expect(store.queue(id)).toMatchObject({ paused: true, items: [{ content: 'Review before sending' }] });
    expect(await readFile(join(result.worktree.path, 'notes.txt'), 'utf8')).toBe('Latest local edit'); expect(await git(result.worktree.path, 'show', ':notes.txt')).toBe('Staged improvement');
    expect(await git(project, 'status', '--porcelain=v1')).toBe(sourceStatus); expect(await git(project, 'write-tree')).toBe(sourceIndex); expect(await git(project, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
  });
  it('disables earlier Undo and Redo while later turns undo only the new working copy', async () => {
    await turn('Original turn', 'First edit'); const oldUndo = history.state(id).undoId!;
    const result = await moves.apply(id, (await prepare()).id); expect(history.state(id)).toMatchObject({ canUndo: false, canRedo: false });
    await expect(history.undo(id, oldUndo)).rejects.toThrow('moved'); expect(store.changes(id)).toEqual([]);
    await turn('Continue here', 'New working copy edit'); const later = history.state(id).undoId!;
    await history.undo(id, later); expect(await readFile(join(result.worktree.path, 'notes.txt'), 'utf8')).toBe('First edit'); expect(await readFile(join(project, 'notes.txt'), 'utf8')).toBe('First edit');
    expect(history.state(id).canUndo).toBe(false); expect(history.state(id).canRedo).toBe(true);
    await history.redo(id, later); expect(await readFile(join(result.worktree.path, 'notes.txt'), 'utf8')).toBe('New working copy edit'); expect(await readFile(join(project, 'notes.txt'), 'utf8')).toBe('First edit');
    store.close(); store = new Store(join(root, 'state')); history = new History(store); expect(store.session(id).workspace).toBe(result.worktree.path); await history.undo(id, later); expect(await readFile(join(project, 'notes.txt'), 'utf8')).toBe('First edit');
  });
  it('preserves a pinned profile without reading or activating changed source instructions', async () => {
    await mkdir(join(project, '.litespeed'), { recursive: true });
    const config = join(project, '.litespeed', 'profiles.json'); await writeFile(config, JSON.stringify({ version: 1, profiles: [{ id: 'review', name: 'Review', tools: ['read_file'], instructions: 'Pinned original instructions' }], skills: [] }));
    const resolved = await resolveProfileChoice(project, { profileId: 'review', skillIds: [] }); store.applyProfile(id, 0, resolved);
    await writeFile(config, JSON.stringify({ version: 1, profiles: [{ id: 'review', name: 'Review', tools: ['read_file'], instructions: 'Unreviewed later instructions' }], skills: [] }));
    await git(project, 'add', '.'); await git(project, 'commit', '-m', 'Updated profile source');
    const moved = await moves.apply(id, (await prepare()).id); expect(store.profileSnapshot(id)).toEqual(resolved.snapshot); expect(moved.session.profile).toEqual(resolved.snapshot!.active);
    expect(() => store.updateSession(id, { workspace: project })).toThrow('Clear the profile');
  });
  it('rejects stale conversation, configuration, file and branch reviews without creating a copy', async () => {
    const conversation = await prepare(); await turn('One more response'); await expect(moves.apply(id, conversation.id)).rejects.toThrow('task changed');
    const configuration = await prepare(); store.updateSession(id, { model: 'new-model' }); await expect(moves.apply(id, configuration.id)).rejects.toThrow('task changed');
    const file = await prepare(); await writeFile(join(project, 'notes.txt'), 'Changed afterward'); await expect(moves.apply(id, file.id)).rejects.toThrow('changed after review');
    const branch = await prepare(); await git(project, 'commit', '--allow-empty', '-m', 'Later'); await expect(moves.apply(id, branch.id)).rejects.toThrow('branch changed');
    expect(store.worktrees.list()).toEqual([]); expect(store.session(id).workspace).toBe(project);
  });
  it('rejects a foreign task, running/archived tasks and unfinished history', async () => {
    const plan = await prepare(), other = store.createSession({ workspace: project }); await expect(moves.apply(other.id, plan.id)).rejects.toThrow('expired');
    store.updateSession(id, { archived: true }); await expect(prepare()).rejects.toThrow('idle local'); store.updateSession(id, { archived: false, status: 'running' }); await expect(prepare()).rejects.toThrow('idle local'); store.updateSession(id, { status: 'idle' });
    history.accept(id, { id: randomUUID(), sessionId: id, role: 'user', content: 'Unfinished', createdAt: Date.now() });
    await expect(prepare()).rejects.toThrow('Finish the current turn');
    expect(store.session(id).workspace).toBe(project); expect(store.worktrees.list()).toEqual([]);
  });
  it('retains a fully created worktree if the atomic conversation move fails', async () => {
    await turn('Keep this turn', 'Keep these bytes'); const before = store.messages(id), state = history.state(id);
    store.db.exec("CREATE TRIGGER reject_task_move BEFORE INSERT ON messages WHEN NEW.role='system' BEGIN SELECT RAISE(ABORT,'fixture task move failure'); END;");
    await expect(moves.apply(id, (await prepare()).id)).rejects.toThrow('task stayed in its original');
    expect(store.session(id).workspace).toBe(project); expect(store.messages(id)).toEqual(before); expect(history.state(id)).toEqual(state);
    const copy = store.worktrees.list()[0]; expect(copy.status).toBe('ready'); expect(await readFile(join(copy.path, 'notes.txt'), 'utf8')).toBe('Keep these bytes');
  });
});
