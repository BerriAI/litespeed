import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CuaDriver, SessionComputers, type ComputerDriver } from '../server/computer.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV5kAAAAASUVORK5CYII=', 'base64');
class FakeDriver implements ComputerDriver {
  calls: { tool: string; args: Record<string, any> }[] = [];
  permissions = true; capture = true; elements = true; app = 'Notes'; sequence = 0; effect = 'confirmed';
  gate?: (signal?: AbortSignal) => Promise<void>;
  launchMode: 'one' | 'many' | 'none' | 'mismatch' = 'one'; launched = false;
  async call(tool: string, args: Record<string, any>, signal?: AbortSignal): Promise<unknown> {
    this.calls.push({ tool, args }); signal?.throwIfAborted();
    if (tool === 'check_permissions') return { accessibility: this.permissions, screen_recording: this.permissions };
    if (tool === 'list_apps') return { apps: [{ name: 'Notes', bundle_id: 'com.test.notes', running: true, active: false }, { name: 'Canvas', bundle_id: 'com.test.canvas', running: this.launched, active: false }, { name: 'Litespeed', bundle_id: 'ai.litellm.litespeed.desktop' }, { name: 'Terminal', bundle_id: 'com.apple.Terminal' }, { name: 'No identifier' }] };
    if (tool === 'launch_app') { this.launched = true; return { pid: 10, bundle_id: this.launchMode === 'mismatch' ? 'com.test.other' : 'com.test.canvas' }; }
    if (tool === 'get_accessibility_tree' && this.launched) return { apps: [{ pid: 10, name: 'Canvas', bundle_id: 'com.test.canvas' }], windows: this.launchMode === 'none' ? [] : [{ pid: 10, window_id: 11, title: 'Canvas one' }, ...(this.launchMode === 'many' ? [{ pid: 10, window_id: 12, title: 'Canvas two' }] : [])] };
    if (tool === 'get_accessibility_tree') return { apps: [{ pid: 1, name: this.app, bundle_id: 'com.test.notes' }, { pid: 2, name: 'Litespeed', bundle_id: 'ai.litellm.litespeed.desktop' }], windows: [{ pid: 1, window_id: 3, title: 'Project notes' }, { pid: 2, window_id: 4, title: 'Private controls' }] };
    if (tool === 'get_window_state') {
      await this.gate?.(signal); signal?.throwIfAborted();
      const snapshot = `s${(++this.sequence).toString(16).padStart(8, '0')}`;
      if (this.capture) await writeFile(args.screenshot_out_file, png);
      return { pid: args.pid, window_id: args.window_id, screenshot_frame_valid: this.capture, ...(this.capture ? { screenshot_file_path: args.screenshot_out_file, screenshot_width: 1, screenshot_height: 1 } : { screenshot_error: { code: 'px_capture_unavailable', reason: 'Fixture capture unavailable' } }), elements: this.elements ? [{ element_token: `${snapshot}:1`, role: 'AXTextField', label: 'Note', value: 'A project idea' }, { element_token: `${snapshot}:2`, role: 'AXSecureTextField', label: 'Password', value: 'SYNTHETIC_SECRET' }] : [], snapshot_id: snapshot };
    }
    return { effect: this.effect };
  }
}

describe('exact-window computer use', () => {
  let root: string, driver: FakeDriver, computers: SessionComputers;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'litespeed-computer-')); driver = new FakeDriver(); computers = new SessionComputers(root, driver); });
  afterEach(async () => { await computers.close(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
  const select = () => computers.execute('task', { action: 'select', windowId: '1:3' });

  it('does not inspect the desktop during polling and keeps privileged apps out of the picker', async () => {
    expect(computers.state('task')).toMatchObject({ status: 'unchecked', windows: [] });
    expect(computers.frame('task', 'unknown')).toBeNull(); expect(driver.calls).toEqual([]);
    const result = await computers.execute('task', { action: 'windows' });
    expect(result.state.windows).toEqual([{ id: '1:3', app: 'Notes', title: 'Project notes' }]);
    expect(result.image).toBeUndefined();
    await expect(computers.execute('task', { action: 'select', windowId: '2:4' })).rejects.toThrow('current list');
    expect(driver.calls.some(call => call.tool === 'get_window_state')).toBe(false);
  });

  it('returns a verified window frame and current controls without exposing secure field values', async () => {
    const result = await select();
    expect(result.state.image).toEqual({ width: 1, height: 1 }); expect(result.image).toEqual(png);
    expect(result.snapshot).toContain('A project idea'); expect(result.snapshot).not.toContain('SYNTHETIC_SECRET');
    expect(computers.frame('task', result.state.snapshotId!)).toEqual(png);
    expect(computers.frame('other-task', result.state.snapshotId!)).toBeNull();
    expect(await readdir(join(root, 'computer-frames'))).toEqual([]);
  });

  it('binds input to the current observation and refreshes refs after every action', async () => {
    const first = await select(), ref = first.state.elements[0].ref;
    const second = await computers.execute('task', { action: 'type', ref, text: 'A new idea', windowId: '1:3' });
    expect(driver.calls.find(call => call.tool === 'type_text')?.args).toMatchObject({ pid: 1, window_id: 3, element_token: ref, text: 'A new idea', delivery_mode: 'background' });
    expect(second.state.elements[0].ref).not.toBe(ref);
    await expect(computers.execute('task', { action: 'click', ref })).rejects.toThrow('stale');
    await expect(computers.execute('task', { action: 'click', x: 0, y: 0, snapshotId: first.state.snapshotId })).rejects.toThrow('preview changed');
    await expect(computers.execute('task', { action: 'click', x: 1, y: 0, snapshotId: second.state.snapshotId })).rejects.toThrow('coordinates');
    const clicked = await computers.execute('task', { action: 'click', x: 0, y: 0, snapshotId: second.state.snapshotId });
    expect(clicked.state.snapshotId).not.toBe(second.state.snapshotId);
    expect(driver.calls.filter(call => call.tool === 'click')).toHaveLength(1);
  });

  it('does not redirect input when a window changes owner or becomes unavailable', async () => {
    const first = await select(); driver.app = 'Different app';
    await expect(computers.execute('task', { action: 'click', ref: first.state.elements[0].ref })).rejects.toThrow('no longer available');
    expect(computers.state('task').windowId).toBeNull(); expect(computers.state('task').image).toBeNull();
    expect(driver.calls.filter(call => call.tool === 'click')).toHaveLength(0);
  });

  it('keeps failed captures explicit and refuses ungrounded input without escalating', async () => {
    driver.capture = false; driver.elements = false;
    const result = await select(); expect(result.image).toBeUndefined(); expect(result.state.notice).toContain('can’t be captured');
    await expect(computers.execute('task', { action: 'key', key: 'return', delivery: 'foreground' })).rejects.toThrow('Refresh');
    expect(driver.calls.some(call => call.tool === 'press_key')).toBe(false);
    driver.elements = true;
    const accessible = await computers.execute('task', { action: 'snapshot' });
    expect(accessible.state.image).toBeNull(); expect(accessible.state.elements).toHaveLength(2);
    await computers.execute('task', { action: 'click', ref: accessible.state.elements[0].ref });
    expect(driver.calls.find(call => call.tool === 'click')?.args.delivery_mode).toBe('background');
  });

  it('reports attempted input separately from observed results', async () => {
    const result = await select(); driver.effect = 'unverifiable';
    const after = await computers.execute('task', { action: 'click', ref: result.state.elements[0].ref });
    expect(after.state.notice).toContain('attempted'); expect(after.state.snapshotId).not.toBe(result.state.snapshotId);
    expect(driver.calls.filter(call => call.tool === 'click')).toHaveLength(1);
  });

  it('serializes desktop actions across tasks and cancels its own in-flight observation', async () => {
    let began!: () => void; const started = new Promise<void>(resolve => { began = resolve; });
    driver.gate = signal => new Promise((_, reject) => { began(); signal!.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }); });
    const pending = select(); await started;
    expect(computers.state('second-task').busy).toBe(true);
    await expect(computers.execute('second-task', { action: 'windows' })).rejects.toThrow('Another computer action');
    const failure = expect(pending).rejects.toThrow('stopped'); await computers.closeSession('task'); await failure;
    expect(computers.state('second-task').busy).toBe(false);
    expect(driver.calls.filter(call => call.tool === 'end_session')).toHaveLength(1);
  });

  it('requires existing OS permissions and never invokes an installer or changes driver settings', async () => {
    driver.permissions = false;
    await expect(select()).rejects.toThrow('Accessibility and Screen Recording');
    expect(computers.state('task').status).toBe('permissions');
    expect(driver.calls.map(call => call.tool)).toEqual(['check_permissions']);
    const missing = new SessionComputers(root, new CuaDriver(join(root, 'not-installed')));
    try { await expect(missing.execute('task', { action: 'windows' })).rejects.toThrow('Install Cua Driver'); expect(missing.state('task').status).toBe('missing'); }
    finally { await missing.close(); }
  });

  it('rejects redirected screenshots and never follows an arbitrary returned file path', async () => {
    const outside = join(root, 'private.png'); await writeFile(outside, png);
    const original = driver.call.bind(driver);
    vi.spyOn(driver, 'call').mockImplementation(async (tool, args, signal) => {
      if (tool !== 'get_window_state') return original(tool, args, signal);
      await symlink(outside, args.screenshot_out_file as string);
      return { pid: 1, window_id: 3, screenshot_file_path: args.screenshot_out_file, screenshot_frame_valid: true };
    });
    await expect(select()).rejects.toThrow(); expect(computers.state('task').image).toBeNull();
    expect(await readdir(join(root, 'computer-frames'))).toEqual([]);
  });
  it('lists installed apps without capturing and launches only an exact supported installed app', async () => {
    const result = await computers.execute('task', { action: 'apps' }); expect(result.state.apps?.map(app => app.name)).toEqual(['Canvas', 'Notes']); expect(result.snapshot).toContain('com.test.canvas'); expect(result.image).toBeUndefined(); expect(driver.calls.some(call => call.tool === 'get_window_state')).toBe(false);
    for (const bundleId of ['com.apple.Terminal', 'ai.litellm.litespeed.desktop', 'com.test.uninstalled']) await expect(computers.execute('task', { action: 'launch', bundleId })).rejects.toThrow('unavailable');
    expect(driver.calls.some(call => call.tool === 'launch_app')).toBe(false);
    const launched = await computers.execute('task', { action: 'launch', bundleId: 'com.test.canvas' }); expect(launched.state.windowId).toBe('10:11'); expect(launched.state.image).toEqual({ width: 1, height: 1 }); expect(driver.calls.find(call => call.tool === 'launch_app')?.args).toEqual({ bundle_id: 'com.test.canvas' });
  });
  it.each(['many', 'none', 'mismatch'] as const)('does not guess a window after a %s launch result', async mode => {
    await select(); const before = driver.calls.filter(call => call.tool === 'get_window_state').length; driver.launchMode = mode;
    const result = await computers.execute('task', { action: 'launch', bundleId: 'com.test.canvas' }); expect(result.state.windowId).toBeNull(); expect(result.state.snapshotId).toBeNull(); expect(result.image).toBeUndefined(); expect(result.state.notice).toBeTruthy(); expect(driver.calls.filter(call => call.tool === 'get_window_state')).toHaveLength(before);
  });
  it('requires a current screenshot and both bounded endpoints for drag, then refreshes the observation', async () => {
    const first = await select();
    for (const input of [{ x: 0, y: 0 }, { x: 0, y: 0, toX: 1, toY: 0 }, { x: 0, y: 0, toX: 0, toY: 0, ref: first.state.elements[0].ref }, { x: 0, y: 0, toX: 0, toY: 0, modifiers: ['fn'] }]) await expect(computers.execute('task', { action: 'drag', snapshotId: first.state.snapshotId, ...input })).rejects.toThrow('Drag between');
    expect(driver.calls.some(call => call.tool === 'drag')).toBe(false);
    const next = await computers.execute('task', { action: 'drag', snapshotId: first.state.snapshotId, windowId: '1:3', x: 0, y: 0, toX: 0, toY: 0, durationMs: 350, modifiers: ['shift'] });
    expect(driver.calls.find(call => call.tool === 'drag')?.args).toMatchObject({ pid: 1, window_id: 3, from_x: 0, from_y: 0, to_x: 0, to_y: 0, duration_ms: 350, steps: 20, modifier: ['shift'], delivery_mode: 'background' }); expect(next.state.snapshotId).not.toBe(first.state.snapshotId);
    await expect(computers.execute('task', { action: 'drag', snapshotId: first.state.snapshotId, x: 0, y: 0, toX: 0, toY: 0 })).rejects.toThrow('preview changed');
  });
  it('does not drag after capture disappears even when accessible controls remain', async () => {
    driver.capture = false; const observed = await select(); await expect(computers.execute('task', { action: 'drag', snapshotId: observed.state.snapshotId, x: 0, y: 0, toX: 0, toY: 0 })).rejects.toThrow('verified screenshot'); expect(driver.calls.some(call => call.tool === 'drag')).toBe(false);
  });
});
