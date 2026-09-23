import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import { WorkspacePreferences } from '../server/workspace-preferences.js';
import { createPullRequestSource, PullRequestFixture, pullRequestFixture } from '../scripts/e2e-pull-requests.js';

const exec = promisify(execFile);
describe('pull request API', () => {
  let root: string, store: Store, server: Server, base: string, transport: PullRequestFixture, app: ReturnType<typeof createApp>;
  let commits: { head: string; base: string };
  beforeEach(async () => {
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1'); vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
    root = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-pr-api-'))); await exec('git', ['init', '-b', 'main'], { cwd: root }); await exec('git', ['remote', 'add', 'origin', 'https://github.com/fixture/desktop.git'], { cwd: root });
    store = new Store(join(root, 'state')); store.saveSettings({ workspace: root, providers: [{ id: 'fixture', name: 'Fixture', kind: 'openai', baseUrl: 'http://127.0.0.1:1', apiKey: 'unused' }], defaultProvider: 'fixture', defaultModel: 'fixture-model' });
    const source = await createPullRequestSource(join(root, 'remote')); commits = source;
    transport = new PullRequestFixture(); app = createApp({ store, pullRequestTransport: transport, pullRequestFetcher: source.fetcher }); server = createServer(app.app); base = await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}/api`)));
  });
  afterEach(async () => { await app.schedules.stop(); app.runner.stopAll(); await app.runner.whenIdle(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
  const draft = (revision: string, extra = {}) => fetch(base + '/pull-requests/142/discussion', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace: root, revision, providerId: 'fixture', model: 'fixture-model', ...extra }) });
  it('creates an idle review snapshot in Plan without modifying saved project defaults or sending it', async () => {
    const preferences = new WorkspacePreferences(store); preferences.save(root, { providerId: 'fixture', model: 'saved-model', permissionMode: 'auto', setupComplete: true }); const before = preferences.get(root);
    const detail = await (await fetch(base + '/pull-requests/142')).json();
    const response = await draft(detail.revision); expect(response.status).toBe(201); const value = await response.json();
    expect(value.session).toMatchObject({ mode: 'plan', status: 'idle', providerId: 'fixture', model: 'fixture-model', permissionMode: 'ask', workspace: root });
    expect(value.draft.attachments[0].content).toContain('a'.repeat(40)); expect(store.messages(value.session.id)).toEqual([]); expect(preferences.get(root)).toEqual(before);
    expect((await exec('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: root })).stdout.trim()).toBe('main');
  });
  it('rejects a stale snapshot before creating a task', async () => {
    const detail = await (await fetch(base + '/pull-requests/142')).json();
    const original = transport.request.bind(transport); vi.spyOn(transport, 'request').mockImplementation(async endpoint => { const value = await original(endpoint); if (!Array.isArray(value)) return { ...value, head: { ...pullRequestFixture.head, sha: 'c'.repeat(40) } }; return value; });
    const response = await draft(detail.revision); expect(response.status).toBe(409); expect((await response.json()).error).toContain('changed since'); expect(store.sessions()).toEqual([]);
  });
  it('rejects invalid identifiers, pagination and providers without remote calls', async () => {
    expect((await fetch(base + '/pull-requests/0')).status).toBe(400); expect((await fetch(base + '/pull-requests?page=-1')).status).toBe(400); expect((await draft('a'.repeat(64), { providerId: 'unknown' })).status).toBe(400); expect(transport.calls).toEqual([]);
  });
  const post = (path: string, data: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  it('opens the exact checkout in an idle Plan task with an editable draft, preserving project defaults and files', async () => {
    transport.commits = commits; await writeFile(join(root, 'local.txt'), 'Keep my file');
    const preferences = new WorkspacePreferences(store), before = preferences.get(root), detail = await (await fetch(base + '/pull-requests/142')).json();
    const prepared = await post('/pull-requests/142/worktree/prepare', { workspace: root, revision: detail.revision }); expect(prepared.status).toBe(200); const plan = await prepared.json();
    expect(store.worktrees.list()).toEqual([]); expect(store.sessions()).toEqual([]);
    const response = await post('/pull-requests/142/worktree', { workspace: root, planId: plan.id, providerId: 'fixture', model: 'fixture-model' }); expect(response.status).toBe(201); const value = await response.json();
    expect(value.session).toMatchObject({ workspace: plan.path, mode: 'plan', status: 'idle', permissionMode: 'ask', worktree: { project: root, head: commits.head, pullRequest: { number: 142, base: commits.base } } });
    expect(value.draft.text).toContain('checked out at head ' + commits.head); expect(value.draft.text).toContain('base commit ' + commits.base); expect(value.draft.text).not.toContain('has not been checked out');
    expect(value.draft.attachments[0].content).toContain('https://github.com/fixture/desktop/pull/142'); expect(store.messages(value.session.id)).toEqual([]);
    expect(preferences.get(root)).toEqual(before); expect(await readFile(join(root, 'local.txt'), 'utf8')).toBe('Keep my file');
    const file = await fetch(base + '/file-preview?workspace=' + encodeURIComponent(plan.path) + '&path=client/src/Browser.tsx'); expect(file.status).toBe(200); expect(await file.text()).toContain('Persistent browser');
  });
  it('reserves the project operation and validates providers before consuming a PR checkout review', async () => {
    transport.commits = commits;
    const detail = await (await fetch(base + '/pull-requests/142')).json();
    let release!: () => void, began!: () => void; const started = new Promise<void>(resolve => { began = resolve; });
    const pending = app.runner.workspaceOperation(root, async () => { began(); await new Promise<void>(resolve => { release = resolve; }); }); await started;
    try { expect((await post('/pull-requests/142/worktree/prepare', { workspace: root, revision: detail.revision })).status).toBe(409); } finally { release(); await pending; }
    const plan = await (await post('/pull-requests/142/worktree/prepare', { workspace: root, revision: detail.revision })).json();
    const body = { workspace: root, planId: plan.id, providerId: 'fixture', model: 'fixture-model' };
    expect((await post('/pull-requests/142/worktree', { ...body, providerId: 'missing' })).status).toBe(400); expect(store.worktrees.list()).toEqual([]);
    expect((await post('/pull-requests/142/worktree', body)).status).toBe(201); expect((await post('/pull-requests/142/worktree', body)).status).toBe(409);
  });
});
