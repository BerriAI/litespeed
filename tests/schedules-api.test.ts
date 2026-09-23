import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import { WorkspacePreferences } from '../server/workspace-preferences.js';

describe('schedule API', () => {
  let root: string, store: Store, server: Server, base: string, created: ReturnType<typeof createApp>;
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-schedules-api-'))); store = new Store(join(root, 'state'));
    store.saveSettings({ workspace: root, providers: [{ id: 'test', name: 'Test', kind: 'openai', baseUrl: 'http://localhost:9' }], defaultProvider: 'test', defaultModel: 'm', permissionMode: 'ask' });
    created = createApp({ store }); server = createServer(created.app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve())); base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  });
  afterEach(async () => { await created.schedules.stop(); created.runner.stopAll(); await created.runner.whenIdle(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); await rm(root, { recursive: true, force: true }); });
  async function request(path: string, body?: unknown, method?: string) {
    const response = await fetch(base + path, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  }
  const input = () => ({ name: 'Review changes', prompt: 'Review the project.', workspace: root, timing: { kind: 'daily', time: '09:00', timezone: 'America/Los_Angeles' } });
  it('reuses existing project selection without changing defaults', async () => {
    new WorkspacePreferences(store).save(root, { providerId: 'test', model: 'project-model', permissionMode: 'edit' });
    const before = store.settings(), task = await request('/schedules', input());
    expect(task.status).toBe(201); expect(task.data.selection).toMatchObject({ providerId: 'test', model: 'project-model', permissionMode: 'edit' });
    expect(store.settings()).toEqual(before);
    expect((await request('/schedules')).data.schedules[0].id).toBe(task.data.id);
  });
  it('edits with optimistic revisions, keeps future timing for a title edit, and pauses/resumes', async () => {
    const { data: task } = await request('/schedules', input());
    const renamed = await request(`/schedules/${task.id}`, { expectedRevision: task.revision, name: 'Review tomorrow' }, 'PATCH');
    expect(renamed.status).toBe(200); expect(renamed.data.nextRunAt).toBe(task.nextRunAt);
    expect((await request(`/schedules/${task.id}`, { expectedRevision: task.revision, name: 'Stale' }, 'PATCH')).status).toBe(409);
    const paused = await request(`/schedules/${task.id}`, { expectedRevision: renamed.data.revision, status: 'paused' }, 'PATCH');
    expect(paused.data.nextRunAt).toBeNull();
    const resumed = await request(`/schedules/${task.id}`, { expectedRevision: paused.data.revision, status: 'active' }, 'PATCH'); expect(resumed.data.nextRunAt).toBeGreaterThan(Date.now());
    expect((await request(`/schedules/${task.id}?revision=${task.revision}`, undefined, 'DELETE')).status).toBe(409);
    expect((await request(`/schedules/${task.id}?revision=${resumed.data.revision}`, undefined, 'DELETE')).status).toBe(200);
  });
  it('validates folder, provider, timing and prompt before persisting', async () => {
    for (const patch of [{ workspace: join(root, 'missing') }, { selection: { providerId: 'missing', model: 'm' } }, { timing: { kind: 'weekly', time: '09:00', timezone: 'UTC', days: [] } }, { prompt: ' ' }, { timing: { kind: 'once', at: Date.now() - 1000 } }, { selection: { providerId: 'test', model: '' } }]) expect((await request('/schedules', { ...input(), ...patch })).status).toBeGreaterThanOrEqual(400);
    expect((await request('/schedules')).data.schedules).toHaveLength(0);
  });
  it('allows pausing when the saved provider is no longer connected', async () => {
    const { data: task } = await request('/schedules', input()); store.saveSettings({ providers: [] });
    expect((await request(`/schedules/${task.id}`, { expectedRevision: 0, status: 'paused' }, 'PATCH')).status).toBe(200);
  });
});
