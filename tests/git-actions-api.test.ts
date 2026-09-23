import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, realpath, rm, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';

const exec = promisify(execFile);
describe('Git action workspace coordination', () => {
  let root: string, workspace: string, base: string, store: Store, server: Server, application: ReturnType<typeof createApp>;
  beforeEach(async () => {
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1'); vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
    root = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-git-api-'))); workspace = join(root, 'project'); await mkdir(workspace);
    await exec('git', ['init', '-b', 'main'], { cwd: workspace }); await writeFile(join(workspace, 'first.txt'), 'first\n');
    store = new Store(join(root, 'state')); store.saveSettings({ workspace }); application = createApp({ store }); server = createServer(application.app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterEach(async () => { await application.schedules.stop(); application.runner.stopAll(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
  const post = async (path: string, data: unknown) => { const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); return { status: response.status, data: await response.json() }; };
  it('prepares and applies fixed actions, requiring an issued one-use plan', async () => {
    const prepared = await post('/api/git/actions/prepare', { workspace, action: 'stage', paths: ['first.txt'] }); expect(prepared.status).toBe(200);
    expect((await post('/api/git/actions/apply', { workspace, id: prepared.data.id })).status).toBe(200);
    expect((await exec('git', ['show', ':first.txt'], { cwd: workspace })).stdout).toBe('first\n');
    expect((await post('/api/git/actions/apply', { workspace, id: prepared.data.id })).status).toBe(409);
    expect((await post('/api/git/actions/prepare', { workspace, action: 'reset --hard' })).status).toBe(400);
  });
  it('rejects Git actions during a session operation and serializes project operations', async () => {
    const session = store.createSession({ workspace }); let release!: () => void;
    const held = application.runner.exclusive(session.id, () => new Promise<void>(resolve => { release = resolve; }));
    try { expect((await post('/api/git/actions/prepare', { workspace, action: 'stage', paths: ['first.txt'] })).status).toBe(409); }
    finally { release(); await held; }
    const heldProject = application.runner.workspaceOperation(workspace, () => new Promise<void>(resolve => { release = resolve; }));
    try { expect((await post('/api/git/actions/prepare', { workspace, action: 'stage', paths: ['first.txt'] })).status).toBe(409); await expect(application.runner.exclusive(session.id, async () => undefined)).rejects.toThrow('Another task'); }
    finally { release(); await heldProject; }
    expect((await post('/api/git/actions/prepare', { workspace, action: 'stage', paths: ['first.txt'] })).status).toBe(200);
  });
  it('does not run actions while a background project command is active', async () => {
    const session = store.createSession({ workspace }); const job = application.runner.jobs.start(session.id, 'sleep 30', workspace, { hidden: true });
    try { expect((await post('/api/git/actions/prepare', { workspace, action: 'stage', paths: ['first.txt'] })).status).toBe(409); }
    finally { application.runner.jobs.kill(session.id, job.id); }
  });
  it('reviews, discards and restores with task coordination and project-scoped original downloads', async () => {
    const prepared = await post('/api/git/discards/prepare', { workspace, paths: ['first.txt'] }); expect(prepared.status).toBe(200);
    const session = store.createSession({ workspace }); let release!: () => void;
    const held = application.runner.exclusive(session.id, () => new Promise<void>(resolve => { release = resolve; }));
    try { expect((await post('/api/git/discards/apply', { workspace, id: prepared.data.id })).status).toBe(409); } finally { release(); await held; }
    const applied = await post('/api/git/discards/apply', { workspace, id: prepared.data.id }); expect(applied.status).toBe(200); await expect(readFile(join(workspace, 'first.txt'))).rejects.toThrow();
    const download = await fetch(`${base}/api/git/discards/${applied.data.backup.id}/original?${new URLSearchParams({ workspace, path: 'first.txt' })}`); expect(download.status).toBe(200); expect(download.headers.get('Content-Disposition')).toContain('attachment'); expect(download.headers.get('Content-Security-Policy')).toContain('sandbox'); expect(await download.text()).toBe('first\n');
    const foreign = await fetch(`${base}/api/git/discards/${applied.data.backup.id}/original?${new URLSearchParams({ workspace: root, path: 'first.txt' })}`); expect(foreign.status).toBe(404);
    const restored = await post(`/api/git/discards/${applied.data.backup.id}/restore`, { workspace }); expect(restored.status).toBe(200); expect((await post('/api/git/discards/apply', { workspace, id: restored.data.id })).status).toBe(200); expect(await readFile(join(workspace, 'first.txt'), 'utf8')).toBe('first\n');
    expect((await fetch(`${base}/api/git/discards/${applied.data.backup.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace }) })).status).toBe(400);
    expect((await fetch(`${base}/api/git/discards/${applied.data.backup.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace, confirm: true }) })).status).toBe(200); expect(await readFile(join(workspace, 'first.txt'), 'utf8')).toBe('first\n');
  });

  it('keeps original copies and cleanup available after a project folder disappears', async () => {
    const plan = await post('/api/git/discards/prepare', { workspace, paths: ['first.txt'] });
    const result = await post('/api/git/discards/apply', { workspace, id: plan.data.id }); await rm(workspace, { recursive: true });
    const all = await (await fetch(base + '/api/git/discards?all=true')).json(); expect(all.backups[0]).toMatchObject({ workspace, id: result.data.backup.id });
    const copy = await fetch(`${base}/api/git/discards/${result.data.backup.id}/original?${new URLSearchParams({ workspace, path: 'first.txt' })}`); expect(copy.status).toBe(200); expect(await copy.text()).toBe('first\n');
    const restore = await post(`/api/git/discards/${result.data.backup.id}/restore`, { workspace }); expect(restore.status).toBe(409); expect(restore.data.error).toContain('folder is unavailable');
    expect((await fetch(`${base}/api/git/discards/${result.data.backup.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace, confirm: true }) })).status).toBe(200);
    expect((await (await fetch(base + '/api/git/discards?all=true')).json()).backups).toEqual([]);
  });

  it('coordinates reviewed branch changes with tasks and background project work', async () => {
    const git = (...args: string[]) => exec('git', args, { cwd: workspace });
    await git('config', 'user.name', 'Test'); await git('config', 'user.email', 'test@example.com'); await git('add', '.'); await git('commit', '-m', 'Initial');
    const listing = await (await fetch(`${base}/api/git/branches?${new URLSearchParams({ workspace })}`)).json(); expect(listing.current).toBe('main');
    const plan = await post('/api/git/branches/prepare', { workspace, request: { action: 'create', name: 'feature' } }); expect(plan.status).toBe(200);
    const session = store.createSession({ workspace }); let release!: () => void;
    const held = application.runner.exclusive(session.id, () => new Promise<void>(resolve => { release = resolve; }));
    try { expect((await post('/api/git/branches/apply', { workspace, id: plan.data.id })).status).toBe(409); } finally { release(); await held; }
    expect((await post('/api/git/branches/apply', { workspace, id: plan.data.id })).data.current).toBe('feature');
    const job = application.runner.jobs.start(session.id, 'sleep 30', workspace, { hidden: true });
    try { expect((await post('/api/git/branches/prepare', { workspace, request: { action: 'switch', ref: 'refs/heads/main' } })).status).toBe(409); } finally { application.runner.jobs.kill(session.id, job.id); }
    expect((await post('/api/git/branches/prepare', { workspace, request: { action: 'force', ref: 'refs/heads/main' } })).status).toBe(400);
  });

});
