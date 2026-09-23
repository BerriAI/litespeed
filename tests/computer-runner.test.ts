import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';

const listen = (server: Server) => new Promise<string>(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as {port:number}).port}`)));
const close = (server: Server) => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
const stream = (res: ServerResponse, delta: unknown, finish = 'stop') => { res.writeHead(200, {'Content-Type':'text/event-stream'}); res.end(`data: ${JSON.stringify({choices:[{delta,finish_reason:finish}]})}\n\ndata: [DONE]\n\n`); };

describe('computer runner integration', () => {
  let directory: string, store: Store, provider: Server, server: Server, url: string, runner: ReturnType<typeof createApp>['runner'];
  let calls: any[], requestTool: boolean, requestArgs: Record<string, unknown>;
  beforeEach(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-computer-runner-')));
    store = new Store(join(directory, 'state')); calls = []; requestTool = true; requestArgs = { action: 'select', windowId: '1:3' };
    provider = createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const part of req) chunks.push(part);
      const body = JSON.parse(Buffer.concat(chunks).toString()); calls.push(body);
      if (!requestTool || body.messages.at(-1)?.role === 'tool') stream(res, {content:'Computer complete.'});
      else stream(res, {tool_calls:[{index:0,id:'computer-call',type:'function',function:{name:'computer',arguments:JSON.stringify(requestArgs)}}]}, 'tool_calls');
    });
    store.saveSettings({workspace:directory,providers:[{id:'test',name:'Test',kind:'openai',baseUrl:await listen(provider),apiKey:'test-key'}],defaultProvider:'test',defaultModel:'model'});
    const app = createApp({store}); runner = app.runner; server = createServer(app.app); url = await listen(server);
    vi.spyOn(runner.computers, 'execute').mockResolvedValue({snapshot:'[s00000001:1] button Continue\nExample window',state:{windows:[{id:'1:3',app:'Notes',title:'Project notes'}],windowId:'1:3',busy:false,revision:1,snapshotId:null,capturedAt:null,image:null,elements:[],status:'ready'},image:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV5kAAAAASUVORK5CYII=','base64')});
  });
  afterEach(async () => { runner.stopAll(); await runner.whenIdle(); await close(server); await close(provider); store.close(); vi.restoreAllMocks(); await rm(directory, {recursive:true,force:true}); });
  const create = async (extra: Record<string, unknown> = {}) => (await (await fetch(url+'/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({permissionMode:'ask',...extra})})).json());
  it('does not allow a new agent run to race with a manual computer action', async () => {
    const session = await create();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const response = { snapshot: 'done', state: { windows: [], windowId: null, busy: false, revision: 1, snapshotId: null, capturedAt: null, image: null, elements: [], status: 'ready' as const } };
    vi.mocked(runner.computers.execute).mockImplementationOnce(async () => { await gate; return response; });
    const pending = runner.computerInteraction(session.id, { action: 'windows' });
    expect(() => runner.start(session.id, 'Run now')).toThrow('current operation');
    await expect(runner.computerInteraction(session.id, { action: 'windows' })).rejects.toThrow('current operation');
    release(); await pending;
    expect(() => runner.assertIdle(session.id)).not.toThrow();
  });
  it('waits for approval and never executes a denied computer action', async () => {
    const session = await create(); runner.start(session.id, 'Inspect the window');
    await vi.waitFor(() => expect(runner.permissions(session.id)).toHaveLength(1));
    expect(runner.computers.execute).not.toHaveBeenCalled();
    const permission = runner.permissions(session.id)[0];
    expect(permission.description).toContain('window 1:3');
    runner.decide(session.id, permission.id, 'deny'); await runner.whenIdle();
    expect(runner.computers.execute).not.toHaveBeenCalled();
  });
  it('runs approved computer actions and sends screenshot attachments back to the model', async () => {
    const session = await create(); runner.start(session.id, 'Inspect the window');
    await vi.waitFor(() => expect(runner.permissions(session.id)).toHaveLength(1));
    runner.decide(session.id, runner.permissions(session.id)[0].id, 'allow'); await runner.whenIdle();
    expect(runner.computers.execute).toHaveBeenCalledOnce();
    const result = store.messages(session.id).find(message => message.role === 'tool');
    expect(result?.content).toContain('Example window');
    expect(result?.attachments?.[0].dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(JSON.stringify(calls.at(-1).messages)).toContain('image_url');
  });
  it('does not advertise computer actions in Plan mode', async () => {
    requestTool = false;
    const session = await create({mode:'plan'}); runner.start(session.id, 'Plan'); await runner.whenIdle();
    expect(calls[0].tools.map((tool: any) => tool.function.name)).not.toContain('computer');
  });
  it('does not reuse a remembered approval for a different window or desktop action', async () => {
    const session = await create(); runner.start(session.id, 'Inspect the window');
    await vi.waitFor(() => expect(runner.permissions(session.id)).toHaveLength(1));
    runner.decide(session.id, runner.permissions(session.id)[0].id, 'always'); await runner.whenIdle();
    requestArgs = { action: 'key', key: 'return', windowId: '1:3' };
    runner.start(session.id, 'Continue'); await vi.waitFor(() => expect(runner.permissions(session.id)).toHaveLength(1));
    expect(runner.computers.execute).toHaveBeenCalledOnce();
    expect(runner.permissions(session.id)[0].scopeDescription).toContain('exact arguments');
    runner.decide(session.id, runner.permissions(session.id)[0].id, 'deny'); await runner.whenIdle();
    expect(runner.computers.execute).toHaveBeenCalledOnce();
  });
  it('rejects manual computer actions while the task is running', async () => {
    const session = await create(); runner.start(session.id, 'Inspect the window');
    await vi.waitFor(() => expect(runner.permissions(session.id)).toHaveLength(1));
    const response = await fetch(`${url}/api/sessions/${session.id}/computer`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(requestArgs)});
    expect(response.status).toBe(409);
    expect(runner.computers.execute).not.toHaveBeenCalled();
    runner.decide(session.id, runner.permissions(session.id)[0].id, 'deny'); await runner.whenIdle();
  });
  it('rejects status and frame reads for nonexistent tasks', async () => {
    expect((await fetch(url+'/api/sessions/missing/computer')).status).toBe(404);
    expect((await fetch(url+'/api/sessions/missing/computer/frame')).status).toBe(404);
  });
  it('shows the app identity for launch approval and does not reuse it for another app', async () => {
    requestArgs = { action: 'launch', bundleId: 'com.test.canvas' }; const session = await create(); runner.start(session.id, 'Open Canvas');
    await vi.waitFor(() => expect(runner.permissions(session.id)).toHaveLength(1)); expect(runner.permissions(session.id)[0].description).toContain('com.test.canvas');
    runner.decide(session.id, runner.permissions(session.id)[0].id, 'always'); await runner.whenIdle(); expect(runner.computers.execute).toHaveBeenCalledOnce();
    requestArgs = { action: 'launch', bundleId: 'com.test.other' }; runner.start(session.id, 'Open Other'); await vi.waitFor(() => expect(runner.permissions(session.id)).toHaveLength(1)); runner.decide(session.id, runner.permissions(session.id)[0].id, 'deny'); await runner.whenIdle(); expect(runner.computers.execute).toHaveBeenCalledOnce();
    const tool = calls[0].tools.find((tool: any) => tool.function.name === 'computer'); expect(tool.function.parameters.properties.action.enum).toContain('drag');
  });
});
