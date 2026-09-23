import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { EventBus } from '../server/events.js';
import { Schedules } from '../server/schedules.js';
import type { ScheduledTask } from '../shared/schedules.js';

describe('durable local schedules', () => {
  let root: string, store: Store, bus: EventBus, schedules: Schedules, now: number;
  let submit: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-schedules-')));
    store = new Store(join(root, 'state')); store.saveSettings({ workspace: root, providers: [{ id: 'test', name: 'Test', kind: 'openai', baseUrl: 'http://localhost:9' }], defaultProvider: 'test', defaultModel: 'm' });
    bus = new EventBus(store); now = Date.parse('2026-09-22T16:00:00Z');
    submit = vi.fn(async (id, snapshot) => { const input = await snapshot(); store.updateSession(id, { status: 'running' }); bus.emit(id, 'session', store.session(id)); return input.content; });
    schedules = new Schedules(store, { submit: submit as any }, bus, () => now);
  });
  afterEach(async () => { await schedules.stop(); store.close(); await rm(root, { recursive: true, force: true }); });
  const input = (): Pick<ScheduledTask, 'name' | 'prompt' | 'workspace' | 'timing' | 'selection'> => ({ name: 'Morning review', prompt: 'Review recent changes.', workspace: root, timing: { kind: 'hourly', every: 1 }, selection: { providerId: 'test', model: 'm', mode: 'build', permissionMode: 'ask' } });
  function finish(sessionId: string, status = 'idle') { store.updateSession(sessionId, { status: status as any }); bus.emit(sessionId, 'done', { status, outcome: status === 'error' ? 'failed' : 'completed' }); }

  it('persists a schedule, claims its occurrence once and uses the captured model and permissions', async () => {
    const task = schedules.create(input()); schedules.start(); now += 3600_000;
    await schedules.tick(); await schedules.tick();
    expect(submit).toHaveBeenCalledTimes(1);
    const run = schedules.list().runs[0], session = store.session(run.sessionId!);
    expect(session).toMatchObject({ title: 'Morning review', model: 'm', providerId: 'test', permissionMode: 'ask' });
    expect(schedules.get(task.id).nextRunAt).toBe(now + 3600_000);
    expect(run.status).toBe('running'); finish(session.id);
    expect(schedules.list().runs[0]).toMatchObject({ status: 'completed', endedAt: now });
  });
  it('preserves approval and error states in activity', async () => {
    const task = schedules.create(input()), run = await schedules.runNow(task.id);
    bus.emit(run.sessionId!, 'session', { status: 'waiting' }); expect(schedules.list().runs[0].status).toBe('waiting');
    bus.emit(run.sessionId!, 'session', { status: 'running' }); expect(schedules.list().runs[0].status).toBe('running');
    bus.emit(run.sessionId!, 'error', { message: 'Provider unavailable.' }); finish(run.sessionId!, 'error');
    expect(schedules.list().runs[0]).toMatchObject({ status: 'failed', error: 'Provider unavailable.' });
  });
  it('does not overlap runs and coalesces missed occurrences instead of replaying them', async () => {
    const task = schedules.create(input()); schedules.start();
    const first = await schedules.runNow(task.id);
    await expect(schedules.runNow(task.id)).rejects.toThrow('in progress');
    now += 3600_000; await schedules.tick(); expect(schedules.list().runs[0].status).toBe('skipped');
    finish(first.sessionId!); now += 12 * 3600_000; await schedules.tick();
    expect(schedules.list().runs[0].status).toBe('missed'); expect(submit).toHaveBeenCalledTimes(1);
    expect(schedules.get(task.id).nextRunAt).toBe(now + 3600_000);
  });
  it('pauses and resumes with a new future occurrence and rejects stale edits', async () => {
    const task = schedules.create(input()); schedules.start();
    const paused = schedules.update(task.id, task.revision, { status: 'paused' }); now += 2 * 3600_000;
    await schedules.tick(); expect(submit).not.toHaveBeenCalled(); expect(paused.nextRunAt).toBeNull();
    expect(() => schedules.update(task.id, task.revision, { name: 'Stale' })).toThrow('changed');
    const resumed = schedules.update(task.id, paused.revision, { status: 'active' }); expect(resumed.nextRunAt).toBe(now + 3600_000);
  });
  it('leaves the schedule timing alone for a manual run or a name edit', async () => {
    const task = schedules.create(input()); now += 35 * 60_000;
    await schedules.runNow(task.id);
    expect(schedules.update(task.id, task.revision, { name: 'Renamed' }).nextRunAt).toBe(task.nextRunAt);
  });
  it('completes a one-time schedule and keeps result conversations when deleting it', async () => {
    const task = schedules.create({ ...input(), timing: { kind: 'once', at: now + 60_000 } }); schedules.start(); now += 60_000;
    await schedules.tick(); const run = schedules.list().runs[0], completed = schedules.get(task.id);
    expect(completed).toMatchObject({ status: 'completed', nextRunAt: null });
    expect(() => schedules.remove(task.id, completed.revision)).toThrow('current run');
    finish(run.sessionId!); schedules.remove(task.id, completed.revision);
    expect(schedules.list().schedules).toHaveLength(0); expect(store.session(run.sessionId!).title).toBe(task.name);
  });
  it('marks interrupted claims on restart without re-submitting them', async () => {
    const task = schedules.create(input()), run = await schedules.runNow(task.id);
    await schedules.stop(); schedules = new Schedules(store, { submit: submit as any }, bus, () => now);
    expect(schedules.list().runs[0]).toMatchObject({ id: run.id, status: 'interrupted' });
    schedules.start(); await schedules.tick(); expect(submit).toHaveBeenCalledTimes(1);
  });
  it('records missing project failures and removed conversations without corrupting history', async () => {
    const task = schedules.create({ ...input(), workspace: join(root, 'missing') });
    expect(await schedules.runNow(task.id)).toMatchObject({ status: 'failed', sessionId: null });
    const valid = schedules.create(input()), run = await schedules.runNow(valid.id); finish(run.sessionId!);
    store.db.prepare('DELETE FROM sessions WHERE id=?').run(run.sessionId!);
    expect(schedules.list().runs.find(item => item.id === run.id)?.sessionId).toBeNull();
  });
  it('holds the duplicate-start guard before filesystem and runner preparation', async () => {
    const task = schedules.create(input());
    const results = await Promise.allSettled([schedules.runNow(task.id), schedules.runNow(task.id)]);
    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']); expect(submit).toHaveBeenCalledTimes(1);
  });
});
