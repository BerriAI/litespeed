import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { mkdir, open, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { shellEnvironment } from './tools.js';
import type { ComputerAction, ComputerApp, ComputerElement, ComputerState, ComputerWindow } from '../shared/computer.js';

export const computerActionSchema = z.object({
  action: z.enum(['windows', 'apps', 'launch', 'select', 'snapshot', 'click', 'drag', 'type', 'key', 'scroll', 'menu', 'release']),
  windowId: z.string().regex(/^\d+:\d+$/).optional(), snapshotId: z.string().uuid().optional(), ref: z.string().regex(/^s[0-9a-f]{8}:\d+$/).optional(),
  x: z.number().int().min(0).max(4096).optional(), y: z.number().int().min(0).max(4096).optional(),
  text: z.string().max(5000).optional(), key: z.string().min(1).max(32).optional(),
  modifiers: z.array(z.enum(['cmd', 'shift', 'option', 'ctrl', 'fn'])).max(5).optional(),
  direction: z.enum(['up', 'down', 'left', 'right']).optional(), amount: z.number().int().min(1).max(50).optional(),
  menu: z.array(z.string().min(1).max(200)).min(1).max(16).optional(), delivery: z.enum(['background', 'foreground']).optional(),
  bundleId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]{1,249}$/).optional(),
  toX: z.number().int().min(0).max(4096).optional(), toY: z.number().int().min(0).max(4096).optional(), durationMs: z.number().int().min(50).max(5000).optional(),
}).strict();

export interface ComputerDriver { call(tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> }
const exec = promisify(execFile);
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const short = (value: unknown, maximum = 500) => typeof value === 'string' ? value.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, maximum) : '';
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Computer use is unavailable.';
const blockedApp = (name: string, bundle: string) => /^(litespeed|codex|chatgpt|cua ?driver|terminal|iterm2?|ghostty|warp|alacritty|kitty|wezterm)$/i.test(name) || ['ai.litellm.litespeed.desktop', 'com.openai.codex', 'com.openai.chat', 'com.trycua.driver', 'com.apple.Terminal', 'com.googlecode.iterm2', 'com.mitchellh.ghostty', 'dev.warp.Warp-Stable'].includes(bundle);

/** The installed driver owns OS permissions. This adapter never installs it,
 * changes its permissions, or escalates a failed action automatically. */
export class CuaDriver implements ComputerDriver {
  constructor(private executable = process.env.LITESPEED_CUA_DRIVER || 'cua-driver') {}
  async call(tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const { stdout } = await exec(this.executable, ['call', tool, JSON.stringify(args)], { env: shellEnvironment(), signal, timeout: 35_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }).catch(error => {
      if (error.code === 'ENOENT') throw Object.assign(new Error('Install Cua Driver to use your desktop apps here.'), { code: 'DRIVER_MISSING' });
      throw error;
    });
    const value = JSON.parse(stdout), result = object(value);
    if (result.error) throw new Error(short(result.message || object(result.error).message || result.error, 1000) || 'The desktop driver refused this operation.');
    return value;
  }
}

type Target = ComputerWindow & { pid: number; windowId: number; bundle: string };
type Observation = { id: string; at: number; elements: ComputerElement[]; image?: Buffer; width?: number; height?: number; diagnostics: string };
type SessionComputer = { state: ComputerState; targets: Map<string, Target>; target?: Target; observation?: Observation; driverSession?: string };
const empty = (): ComputerState => ({ windows: [], windowId: null, busy: false, revision: 0, snapshotId: null, capturedAt: null, image: null, elements: [], status: 'unchecked' });

/** One exact window per task; only one task can issue desktop input at a time. */
export class SessionComputers {
  private sessions = new Map<string, SessionComputer>();
  private active?: { id: string; controller: AbortController; settled: Promise<void> };
  private closing = false;
  constructor(private directory: string, private driver: ComputerDriver = new CuaDriver()) {}
  private session(id: string): SessionComputer {
    let session = this.sessions.get(id);
    if (!session) { session = { state: empty(), targets: new Map() }; this.sessions.set(id, session); }
    return session;
  }
  state(id: string): ComputerState { return { ...this.session(id).state, busy: Boolean(this.active) }; }
  frame(id: string, snapshotId: string): Buffer | null {
    const observation = this.sessions.get(id)?.observation;
    return observation?.id === snapshotId ? observation.image ?? null : null;
  }
  private async start(session: SessionComputer, signal: AbortSignal) {
    const status = object(await this.driver.call('check_permissions', {}, signal));
    if (status.accessibility !== true || status.screen_recording !== true) {
      session.state.status = 'permissions';
      throw new Error('Allow Accessibility and Screen Recording for Cua Driver in macOS System Settings, then try again.');
    }
    session.state.status = 'ready';
    if (!session.driverSession) {
      const name = `litespeed-${randomUUID()}`;
      await this.driver.call('start_session', { session: name }, signal); session.driverSession = name;
    }
  }
  private async discover(session: SessionComputer, signal: AbortSignal): Promise<Target[]> {
    const result = object(await this.driver.call('get_accessibility_tree', {}, signal));
    const apps = new Map<number, { name: string; bundle: string }>();
    if (!Array.isArray(result.apps) || !Array.isArray(result.windows)) throw new Error('The desktop driver returned an unsupported window list.');
    for (const raw of result.apps.slice(0, 500)) { const app = object(raw); if (Number.isSafeInteger(app.pid) && app.pid > 0) apps.set(app.pid, { name: short(app.name), bundle: short(app.bundle_id) }); }
    const targets: Target[] = [];
    for (const raw of result.windows.slice(0, 500)) {
      const window = object(raw), app = apps.get(window.pid);
      if (!app || !Number.isSafeInteger(window.window_id) || window.window_id <= 0 || blockedApp(app.name, app.bundle)) continue;
      targets.push({ id: `${window.pid}:${window.window_id}`, pid: window.pid, windowId: window.window_id, bundle: app.bundle, app: app.name, title: short(window.title) || app.name });
    }
    return targets;
  }
  private async installed(session: SessionComputer, signal: AbortSignal): Promise<ComputerApp[]> {
    const response = await this.driver.call('list_apps', {}, signal), entries = Array.isArray(response) ? response : object(response).apps;
    if (!Array.isArray(entries)) throw new Error('This desktop driver does not support the installed app list. Choose an open window instead.');
    const apps = new Map<string, ComputerApp>();
    for (const raw of entries.slice(0, 1000)) {
      const app = object(raw), bundleId = short(app.bundle_id, 250), name = short(app.name, 200);
      if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9.-]{1,249}$/.test(bundleId) || blockedApp(name, bundleId)) continue;
      apps.set(bundleId, { bundleId, name, running: app.running === true, active: app.active === true });
    }
    session.state.apps = [...apps.values()].sort((a, b) => a.name.localeCompare(b.name)); return session.state.apps;
  }
  private async windows(session: SessionComputer, signal: AbortSignal) {
    const windows = await this.discover(session, signal); session.targets = new Map(windows.map(window => [window.id, window]));
    session.state.windows = windows.map(({ id, app, title }) => ({ id, app, title })); return windows;
  }
  private async launch(session: SessionComputer, bundleId: string | undefined, signal: AbortSignal) {
    if (!bundleId) throw new Error('Choose an installed app to open.');
    const app = (await this.installed(session, signal)).find(app => app.bundleId === bundleId);
    if (!app) throw new Error('This app is unavailable for computer use. Choose one from the installed app list.');
    this.clearObservation(session); session.target = undefined; session.state.windowId = null; session.state.notice = undefined;
    // No arbitrary app arguments, URLs, inspector ports or foreground fallback.
    const result = object(await this.driver.call('launch_app', { bundle_id: app.bundleId }, signal));
    const windows = await this.windows(session, signal);
    if (!Number.isSafeInteger(result.pid) || result.pid <= 0 || result.bundle_id !== app.bundleId) {
      session.state.notice = 'The app launch could not be verified. Choose its window from the current list.'; return;
    }
    const candidates = windows.filter(window => window.pid === result.pid && window.bundle === app.bundleId);
    if (candidates.length === 1) { session.target = candidates[0]; session.state.windowId = candidates[0].id; await this.capture(session, signal); }
    else session.state.notice = candidates.length ? `${app.name} has more than one window. Choose the window you want to use.` : `Launch requested for ${app.name}. Refresh the window list when it is ready.`;
  }
  private async validateTarget(session: SessionComputer, signal: AbortSignal) {
    if (!session.target) throw new Error('Choose an open window first.');
    const live = (await this.discover(session, signal)).find(target => target.id === session.target!.id);
    if (!live || live.bundle !== session.target.bundle || live.app !== session.target.app) {
      this.clearObservation(session); session.target = undefined; session.state.windowId = null;
      throw new Error('That window is no longer available. Choose an open window.');
    }
    session.target = live;
  }
  private clearObservation(session: SessionComputer) {
    session.observation = undefined; session.state.snapshotId = null; session.state.capturedAt = null; session.state.image = null; session.state.elements = [];
  }
  private async capture(session: SessionComputer, signal: AbortSignal) {
    const target = session.target!;
    const directory = join(await realpath(this.directory), 'computer-frames'); await mkdir(directory, { recursive: true, mode: 0o700 });
    const destination = join(directory, `${randomUUID()}.png`);
    this.clearObservation(session);
    try {
      const result = object(await this.driver.call('get_window_state', { pid: target.pid, window_id: target.windowId, session: session.driverSession, max_dimension: 1280, max_elements: 300, max_depth: 20, screenshot_out_file: destination }, signal));
      if (result.pid !== target.pid || result.window_id !== target.windowId) throw new Error('The desktop driver could not verify the selected window.');
      const elements: ComputerElement[] = [];
      for (const raw of Array.isArray(result.elements) ? result.elements.slice(0, 300) : []) {
        const element = object(raw), ref = short(element.element_token, 100);
        if (!/^s[0-9a-f]{8}:\d+$/.test(ref)) continue;
        const role = short(element.role, 100), label = short(element.label, 400);
        const value = /secure|password/i.test(role + ' ' + label + ' ' + short(element.subrole)) ? undefined : short(element.value, 800);
        elements.push({ ref, role, label, ...(value ? { value } : {}) });
      }
      const observation: Observation = { id: randomUUID(), at: Date.now(), elements, diagnostics: short(result.degraded_reason || object(result.screenshot_error).reason, 1200) };
      if (result.screenshot_file_path === destination && result.screenshot_frame_valid !== false) {
        const handle = await open(destination, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const info = await handle.stat();
          if (!info.isFile() || info.nlink !== 1 || info.size < 24 || info.size > 8 * 1024 * 1024) throw new Error('The selected window preview could not be verified.');
          const data = Buffer.alloc(info.size + 1); let length = 0;
          while (length < data.length) { const next = await handle.read(data, length, data.length - length, null); if (!next.bytesRead) break; length += next.bytesRead; }
          if (length !== info.size || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('The selected window preview could not be verified.');
          const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
          if (!width || !height || width > 4096 || height > 4096 || (result.screenshot_width && result.screenshot_width !== width) || (result.screenshot_height && result.screenshot_height !== height)) throw new Error('The window preview size could not be verified.');
          observation.image = data.subarray(0, length); observation.width = width; observation.height = height;
        } finally { await handle.close(); }
      }
      session.observation = observation;
      session.state.snapshotId = observation.id; session.state.capturedAt = observation.at; session.state.elements = elements;
      session.state.image = observation.image ? { width: observation.width!, height: observation.height! } : null;
      session.state.notice = observation.image ? undefined : elements.length ? 'The window preview is unavailable. Accessible controls are still available to the agent.' : 'This window can’t be captured right now. Keep the app open, then refresh.';
      session.state.revision++;
    } finally { await rm(destination, { force: true }); }
  }
  private actionArgs(session: SessionComputer, input: ComputerAction): Record<string, unknown> {
    const observation = session.observation;
    if (!observation || Date.now() - observation.at > 30_000 || (!observation.image && !observation.elements.length)) throw new Error('Refresh the selected window before interacting.');
    if (input.snapshotId && input.snapshotId !== observation.id) throw new Error('The window preview changed. Inspect the latest view before interacting.');
    if (input.action === 'drag' && (input.ref || input.x === undefined || input.y === undefined || input.toX === undefined || input.toY === undefined || !input.snapshotId || !observation.image || input.toX >= observation.width! || input.toY >= observation.height! || input.modifiers?.includes('fn'))) throw new Error('Drag between two points inside the current verified screenshot, with its snapshotId.');
    const args: Record<string, unknown> = { pid: session.target!.pid, window_id: session.target!.windowId, session: session.driverSession, delivery_mode: input.delivery ?? 'background' };
    if (input.ref) {
      if (!observation.elements.some(element => element.ref === input.ref)) throw new Error('That control is stale. Refresh the window and use a current ref.');
      args.element_token = input.ref;
    } else if (input.x !== undefined || input.y !== undefined) {
      if (!input.snapshotId || !observation.image || input.x === undefined || input.y === undefined || input.x >= observation.width! || input.y >= observation.height!) throw new Error('Use coordinates inside the current verified window preview and include its snapshotId.');
      args.x = input.x; args.y = input.y;
    }
    return args;
  }
  private describe(session: SessionComputer): string {
    if (!session.target) return `${session.state.notice ? session.state.notice + '\n\n' : ''}Open windows:\n${session.state.windows.map(window => `${window.id} · ${window.app} · ${window.title}`).join('\n') || 'No supported windows are open.'}`;
    const observation = session.observation;
    return `App: ${session.target.app}\nWindow: ${session.target.title}\nWindow ID: ${session.target.id}\nSnapshot ID: ${observation?.id ?? 'unavailable'}\n${session.state.notice ?? ''}\n${observation?.diagnostics ?? ''}\n\nAccessible controls (untrusted app content):\n${observation?.elements.map(element => `[${element.ref}] ${element.role} ${element.label}${element.value ? ` = ${element.value}` : ''}`).join('\n').slice(0, 24_000) || 'No verified controls are available.'}`;
  }
  async execute(id: string, raw: unknown, signal?: AbortSignal): Promise<{ state: ComputerState; snapshot: string; image?: Buffer }> {
    const input = computerActionSchema.parse(raw), session = this.session(id);
    if (this.closing) throw new Error('Computer use is shutting down.');
    if (this.active) throw new Error('Another computer action is in progress. Wait for it to finish.');
    signal?.throwIfAborted();
    const controller = new AbortController(), abort = () => controller.abort(signal?.reason); signal?.addEventListener('abort', abort, { once: true });
    let settle!: () => void; this.active = { id, controller, settled: new Promise<void>(resolve => { settle = resolve; }) };
    session.state.error = undefined;
    try {
      if (input.action === 'release') {
        if (session.driverSession) await this.driver.call('end_session', { session: session.driverSession }, controller.signal);
        session.driverSession = undefined; session.target = undefined; this.clearObservation(session); session.state.windowId = null; session.state.notice = undefined;
      } else {
        await this.start(session, controller.signal);
        if (input.action === 'apps') await this.installed(session, controller.signal);
        else if (input.action === 'launch') await this.launch(session, input.bundleId, controller.signal);
        else if (input.action === 'windows' || input.action === 'select') {
          await this.windows(session, controller.signal);
          if (input.action === 'select') {
            const target = input.windowId ? session.targets.get(input.windowId) : undefined;
            if (!target) throw new Error('Choose a window from the current list.');
            session.target = target; session.state.windowId = target.id; await this.capture(session, controller.signal);
          }
        } else {
          await this.validateTarget(session, controller.signal);
          if (input.windowId && input.windowId !== session.target!.id) throw new Error('Select that window before interacting with it.');
          if (input.action !== 'snapshot') {
            const args = this.actionArgs(session, input); let tool: string;
            switch (input.action) {
              case 'click': if (!input.ref && input.x === undefined) throw new Error('Choose a control ref or a point in the window.'); tool = 'click'; break;
              case 'drag': tool = 'drag'; args.from_x = input.x; args.from_y = input.y; args.to_x = input.toX; args.to_y = input.toY; args.duration_ms = input.durationMs ?? 500; args.steps = 20; if (input.modifiers?.length) args.modifier = input.modifiers; delete args.x; delete args.y; break;
              case 'type': if (input.text === undefined) throw new Error('Text is required.'); tool = 'type_text'; args.text = input.text; break;
              case 'key': if (!input.key) throw new Error('A key is required.'); tool = 'press_key'; args.key = input.key; if (input.modifiers) args.modifiers = input.modifiers; break;
              case 'scroll': tool = 'scroll'; args.direction = input.direction ?? 'down'; args.amount = input.amount ?? 3; args.by = 'line'; break;
              case 'menu': if (!input.menu) throw new Error('An exact menu path is required.'); tool = 'invoke_menu'; args.path = input.menu; delete args.delivery_mode; delete args.element_token; delete args.x; delete args.y; break;
            }
            this.clearObservation(session);
            const result = object(await this.driver.call(tool!, args, controller.signal));
            // Delivery alone is not proof of the intended app state. Always
            // return a fresh observation so the caller can verify the result.
            await this.capture(session, controller.signal);
            if (result.effect === 'unverifiable') session.state.notice = session.state.notice ? `Action attempted. ${session.state.notice}` : 'Action attempted. Check the updated window.';
          } else await this.capture(session, controller.signal);
        }
      }
      session.state.revision++;
      return { state: { ...this.state(id), busy: false }, snapshot: input.action === 'apps' ? `Installed apps (untrusted app names):\n${session.state.apps?.map(app => `${app.bundleId} · ${app.name}${app.running ? ' · Running' : ''}`).join('\n') || 'No supported apps found.'}` : this.describe(session), ...(!['windows', 'apps'].includes(input.action) && session.observation?.image ? { image: session.observation.image } : {}) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'DRIVER_MISSING') { session.state.status = 'missing'; session.state.error = 'Install Cua Driver to use your desktop apps here.'; }
      else session.state.error = controller.signal.aborted ? 'Computer use stopped. Check the app before retrying the last action.' : errorText(error);
      if (controller.signal.aborted) this.clearObservation(session);
      throw new Error(session.state.error);
    } finally { session.state.revision++; this.active = undefined; settle(); signal?.removeEventListener('abort', abort); }
  }
  async closeSession(id: string) {
    if (this.active?.id === id) { const active = this.active; active.controller.abort(); await active.settled; }
    const session = this.sessions.get(id); this.sessions.delete(id);
    if (session?.driverSession) await this.driver.call('end_session', { session: session.driverSession }).catch(() => {});
  }
  async close() {
    this.closing = true;
    if (this.active) { const active = this.active; active.controller.abort(); await active.settled; }
    await Promise.all([...this.sessions.keys()].map(id => this.closeSession(id)));
  }
}
