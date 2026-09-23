import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import { TaskLocals } from '../server/task-local.js';

const exec = promisify(execFile);
describe('project worktree API', () => {
  let root: string, project: string, store: Store, server: Server, app: ReturnType<typeof createApp>, base: string, terminal: string;
  const request = async (path: string, data?: unknown) => { const response = await fetch(base + '/api' + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) }); return { status: response.status, data: await response.json() }; };
  beforeEach(async () => {
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1'); vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
    root = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-worktrees-api-'))); project = join(root, 'project'); terminal = ''; await mkdir(project);
    const git = (...args: string[]) => exec('git', args, { cwd: project });
    await git('init', '-b', 'main'); await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'fixture@local'); await writeFile(join(project, 'notes.md'), 'Project notes'); await git('add', '.'); await git('commit', '-m', 'Initial');
    store = new Store(join(root, 'state')); store.saveSettings({ workspace: project, providers: [{ id: 'test', name: 'Fixture', kind: 'openai', baseUrl: 'http://127.0.0.1:1' }], defaultProvider: 'test', defaultModel: 'test-model' });
    app = createApp({ store, workspaceHasTerminal: workspace => workspace === terminal }); server = createServer(app.app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterEach(async () => { app.runner.stopAll(); await app.runner.whenIdle(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
  async function create() { const plan = (await request('/worktrees/prepare', { workspace: project, name: 'Review' })).data; const result = await request('/worktrees/create', { workspace: project, id: plan.id, providerId: 'test', model: 'test-model' }); expect(result.status).toBe(201); return result.data; }
  it('opens idle tasks at a verified working copy and does not mutate project preferences or send a provider request', async () => {
    const original = (await request('/workspace-preferences?workspace=' + encodeURIComponent(project))).data;
    const { worktree, session } = await create(); expect(session).toMatchObject({ workspace: worktree.path, worktree: { id: worktree.id, project }, status: 'idle', permissionMode: 'ask' }); expect(store.messages(session.id)).toEqual([]);
    expect((await request('/workspace-preferences?workspace=' + encodeURIComponent(project))).data).toEqual(original);
    const next = await request(`/worktrees/${worktree.id}/tasks`, { providerId: 'test', model: 'test-model' }); expect(next.status).toBe(201); expect(next.data.worktree.id).toBe(worktree.id);
    const preview = await request('/file-preview?workspace=' + encodeURIComponent(worktree.path) + '&path=notes.md'); expect(preview.status).toBe(200);
    const forged = await request('/sessions', { workspace: project, worktree: worktree }); expect(forged.data.worktree).toBeUndefined();
  });
  it('reserves project operations and validates provider choices before creating a copy', async () => {
    let release!: () => void, began!: () => void; const started = new Promise<void>(resolve => { began = resolve; });
    const pending = app.runner.workspaceOperation(project, async () => { began(); await new Promise<void>(resolve => { release = resolve; }); }); await started;
    try { expect((await request('/worktrees/prepare', { workspace: project, name: 'Review' })).status).toBe(409); } finally { release(); await pending; }
    const plan = (await request('/worktrees/prepare', { workspace: project, name: 'Review' })).data;
    expect((await request('/worktrees/create', { workspace: project, id: plan.id, providerId: 'missing', model: 'model' })).status).toBe(400); expect(store.worktrees.list()).toEqual([]);
    expect((await request('/worktrees/create', { workspace: project, id: plan.id, providerId: 'test', model: 'test-model' })).status).toBe(201);
    expect((await request('/worktrees/create', { workspace: project, id: plan.id, providerId: 'test', model: 'test-model' })).status).toBe(409);
  });
  it('rechecks terminal ownership before removal and keeps the removed conversation inert', async () => {
    const { worktree, session } = await create(); terminal = worktree.path;
    expect((await request(`/worktrees/${worktree.id}/remove/prepare`, {})).status).toBe(409);
    terminal = ''; const plan = (await request(`/worktrees/${worktree.id}/remove/prepare`, {})).data; terminal = worktree.path;
    expect((await request(`/worktrees/${worktree.id}/remove`, { planId: plan.id })).status).toBe(409);
    terminal = ''; expect((await request(`/worktrees/${worktree.id}/remove`, { planId: plan.id })).status).toBe(200);
    expect(store.session(session.id).worktree?.removed).toBe(true); expect((await request(`/worktrees/${worktree.id}/tasks`, { providerId: 'test', model: 'test-model' })).status).toBe(404);
    expect((await request(`/sessions/${session.id}/messages`, { content: 'Run after removal' })).status).toBe(409); expect(store.messages(session.id)).toEqual([]);
    expect(() => app.runner.start(session.id, 'Start directly')).toThrow('working copy was removed'); expect(() => app.runner.resumeQueue(session.id)).toThrow('working copy was removed');
  });
  it('reviews local edits through the API, rejects changed files, and opens the copied files in an idle task', async () => {
    await writeFile(join(project, 'notes.md'), 'Reviewed local notes');
    const plan = (await request('/worktrees/prepare', { workspace: project, name: 'With edits', includeLocalEdits: true })).data;
    expect(plan.localEdits.files).toMatchObject([{ path: 'notes.md', status: ' M' }]);
    await writeFile(join(project, 'notes.md'), 'Newer local notes');
    expect((await request('/worktrees/create', { workspace: project, id: plan.id, providerId: 'test', model: 'test-model' })).status).toBe(409);
    const fresh = (await request('/worktrees/prepare', { workspace: project, name: 'With edits', includeLocalEdits: true })).data;
    const created = await request('/worktrees/create', { workspace: project, id: fresh.id, providerId: 'test', model: 'test-model' });
    expect(created.status).toBe(201); expect(store.messages(created.data.session.id)).toEqual([]);
    expect(await readFile(join(created.data.worktree.path, 'notes.md'), 'utf8')).toBe('Newer local notes');
    expect(await readFile(join(project, 'notes.md'), 'utf8')).toBe('Newer local notes');
  });
  it('reviews only setup metadata, copies opted-in environment files, and keeps ordinary file previews restricted', async () => {
    await writeFile(join(project, '.gitignore'), '.env\n'); await writeFile(join(project, '.worktreeinclude'), '.env\n');
    await exec('git', ['add', '.'], { cwd: project }); await exec('git', ['commit', '-m', 'Local configuration rules'], { cwd: project });
    await writeFile(join(project, '.env'), 'PRIVATE_TEST_CONTENT=synthetic\n');
    const plan = (await request('/worktrees/prepare', { workspace: project, name: 'With setup', includeLocalSetup: true })).data;
    expect(plan.localSetup.files).toMatchObject([{ path: '.env' }]); expect(JSON.stringify(plan)).not.toContain('PRIVATE_TEST_CONTENT');
    const result = await request('/worktrees/create', { workspace: project, id: plan.id, providerId: 'test', model: 'test-model' }); expect(result.status).toBe(201);
    expect(await readFile(join(result.data.worktree.path, '.env'), 'utf8')).toBe('PRIVATE_TEST_CONTENT=synthetic\n');
    expect((await request('/file-preview?workspace=' + encodeURIComponent(result.data.worktree.path) + '&path=.env')).status).not.toBe(200);
    expect(store.messages(result.data.session.id)).toEqual([]);
  });
  it('accepts an existing starting branch and rejects ref syntax and incompatible local-edit copying', async () => {
    await exec('git', ['branch', 'feature'], { cwd: project });
    for (const startingRef of ['HEAD', 'refs/heads/main~1', 'refs/tags/version']) expect((await request('/worktrees/prepare', { workspace: project, name: 'From branch', startingRef })).status).not.toBe(200);
    expect((await request('/worktrees/prepare', { workspace: project, name: 'From branch', startingRef: 'refs/heads/feature', includeLocalEdits: true })).status).toBe(409);
    const reviewed = await request('/worktrees/prepare', { workspace: project, name: 'From branch', startingRef: 'refs/heads/feature' }); expect(reviewed.status).toBe(200); expect(reviewed.data.sourceBranch).toBe('feature');
    expect((await request('/worktrees/create', { workspace: project, id: reviewed.data.id, providerId: 'test', model: 'test-model' })).status).toBe(201);
    expect((await exec('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: project })).stdout.trim()).toBe('main');
  });
  it('restores reviewed copies under both workspace locks and never resumes an existing queued task', async () => {
    const { worktree, session } = await create(); store.enqueue(session.id, 'Keep queued', [], false);
    const removal = (await request(`/worktrees/${worktree.id}/remove/prepare`, {})).data;
    expect((await request(`/worktrees/${worktree.id}/remove`, { planId: removal.id })).status).toBe(200);
    expect((await request('/worktrees')).data.worktrees).toEqual([]);
    expect((await request('/worktrees?includeRemoved=true')).data.worktrees).toMatchObject([{ id: worktree.id, status: 'removed', snapshot: { head: worktree.head } }]);
    const plan = (await request(`/worktrees/${worktree.id}/restore/prepare`, {})).data;
    for (const target of [project, worktree.path]) {
      let release!: () => void, began!: () => void; const started = new Promise<void>(resolve => { began = resolve; });
      const pending = app.runner.workspaceOperation(target, async () => { began(); await new Promise<void>(resolve => { release = resolve; }); }); await started;
      try { expect((await request(`/worktrees/${worktree.id}/restore`, { planId: plan.id })).status).toBe(409); } finally { release(); await pending; }
    }
    terminal = worktree.path; expect((await request(`/worktrees/${worktree.id}/restore`, { planId: plan.id })).status).toBe(409); terminal = '';
    const result = await request(`/worktrees/${worktree.id}/restore`, { planId: plan.id }); expect(result.status).toBe(200);
    expect(result.data.sessions).toMatchObject([{ id: session.id, workspace: worktree.path, status: 'idle' }]);
    expect(result.data.sessions[0].worktree.removed).toBeUndefined(); expect(store.queue(session.id)).toMatchObject({ paused: true, items: [{ content: 'Keep queued' }] });
    expect(store.messages(session.id)).toEqual([]); expect((await request('/file-preview?workspace=' + encodeURIComponent(worktree.path) + '&path=notes.md')).status).toBe(200);
  });
  it('moves an existing task only after a reviewed copy and rejects starts and project operations during the move', async () => {
    const session = store.createSession({ workspace: project, title: 'Existing task' }); terminal = project;
    expect((await request(`/sessions/${session.id}/worktree/prepare`, { name: 'Continue', expectedConfigRevision: 0 })).status).toBe(409); terminal = '';
    const plan = (await request(`/sessions/${session.id}/worktree/prepare`, { name: 'Continue', expectedConfigRevision: 0 })).data;
    let release!: () => void, began!: () => void; const started = new Promise<void>(resolve => { began = resolve; });
    const original = store.worktrees.create.bind(store.worktrees);
    vi.spyOn(store.worktrees, 'create').mockImplementation(async (...args) => { began(); await new Promise<void>(resolve => { release = resolve; }); return original(...args); });
    const pending = request(`/sessions/${session.id}/worktree`, { planId: plan.id }); await started;
    try {
      expect((await request(`/sessions/${session.id}/messages`, { content: 'Do not send during the move' })).status).toBe(409);
      expect((await request('/worktrees/prepare', { workspace: project, name: 'Competing copy' })).status).toBe(409);
    } finally { release(); }
    const result = await pending; expect(result.status).toBe(200); expect(result.data.session.id).toBe(session.id); expect(result.data.session.workspace).toBe(result.data.worktree.path);
    expect(store.sessions()).toHaveLength(1); expect(store.messages(session.id)).toMatchObject([{ role: 'system' }]); expect(store.queue(session.id).paused).toBe(true);
    expect((await request(`/sessions/${session.id}/worktree`, { planId: plan.id })).status).toBe(409);
    vi.restoreAllMocks();
  });
  it('continues a worktree task locally while reserving both folders against new turns and terminal conflicts', async () => {
    const { worktree, session } = await create(), local = store.createSession({ workspace: project });
    const path = `/sessions/${session.id}/local`;
    for (const folder of [project, worktree.path]) { terminal = folder; expect((await request(path + '/prepare', { expectedConfigRevision: 0 })).status).toBe(409); }
    terminal = ''; const plan = (await request(path + '/prepare', { expectedConfigRevision: 0 })).data;
    terminal = project; expect((await request(path, { planId: plan.id })).status).toBe(409); terminal = '';
    let release!: () => void, began!: () => void; const started = new Promise<void>(resolve => { began = resolve; });
    const original = TaskLocals.prototype.apply;
    vi.spyOn(TaskLocals.prototype, 'apply').mockImplementation(async function (this: TaskLocals, ...args) { began(); await new Promise<void>(resolve => { release = resolve; }); return original.apply(this, args); });
    const pending = request(path, { planId: plan.id }); await started;
    try {
      for (const folder of [project, worktree.path]) expect(app.runner.workspaceOperationActive(folder)).toBe(true);
      for (const task of [session.id, local.id]) expect((await request(`/sessions/${task}/messages`, { content: 'Do not start during a folder transition' })).status).toBe(409);
      expect((await request('/worktrees/prepare', { workspace: project, name: 'Competing copy' })).status).toBe(409);
    } finally { release(); }
    const result = await pending; expect(result.status).toBe(200); expect(result.data.session).toMatchObject({ id: session.id, workspace: project, status: 'idle' }); expect(result.data.session.worktree).toBeUndefined();
    expect(store.worktrees.get(worktree.id).status).toBe('ready'); expect(store.messages(local.id)).toEqual([]); expect(store.messages(session.id)).toMatchObject([{ workspaceMove: { destination: 'local' } }]);
    for (const folder of [project, worktree.path]) expect(app.runner.workspaceOperationActive(folder)).toBe(false);
    vi.restoreAllMocks();
  });
});
