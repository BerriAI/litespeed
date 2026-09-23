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

describe('browser runner integration', () => {
  let directory: string, store: Store, provider: Server, server: Server, url: string, runner: ReturnType<typeof createApp>['runner'];
  let calls: any[], requestTool: boolean;
  beforeEach(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-browser-runner-')));
    store = new Store(join(directory, 'state')); calls = []; requestTool = true;
    provider = createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const part of req) chunks.push(part);
      const body = JSON.parse(Buffer.concat(chunks).toString()); calls.push(body);
      if (!requestTool || body.messages.at(-1)?.role === 'tool') stream(res, {content:'Browser complete.'});
      else stream(res, {tool_calls:[{index:0,id:'browser-call',type:'function',function:{name:'browser',arguments:JSON.stringify({action:'open',url:'https://example.com'})}}]}, 'tool_calls');
    });
    store.saveSettings({workspace:directory,providers:[{id:'test',name:'Test',kind:'openai',baseUrl:await listen(provider),apiKey:'test-key'}],defaultProvider:'test',defaultModel:'model'});
    const app = createApp({store}); runner = app.runner; server = createServer(app.app); url = await listen(server);
    vi.spyOn(runner.browsers, 'execute').mockResolvedValue({snapshot:'[e1] button Continue\nExample page',state:{tabs:[{id:'tab',title:'Example',url:'https://example.com'}],activeId:'tab',busy:false,width:1280,height:800,revision:1},image:Buffer.from([0xff,0xd8,0xff,0xd9])});
  });
  afterEach(async () => { runner.stopAll(); await runner.whenIdle(); await close(server); await close(provider); store.close(); vi.restoreAllMocks(); await rm(directory, {recursive:true,force:true}); });
  const create = async (extra: Record<string, unknown> = {}) => (await (await fetch(url+'/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({permissionMode:'ask',...extra})})).json());
  it('does not allow a new agent run to race with a manual browser action', async () => {
    const session = await create();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const response = { snapshot: 'done', state: { tabs: [], activeId: null, busy: false, width: 480, height: 800, revision: 1 } };
    vi.mocked(runner.browsers.execute).mockImplementationOnce(async () => { await gate; return response; });
    const pending = runner.browserInteraction(session.id, { action: 'open' });
    expect(() => runner.start(session.id, 'Run now')).toThrow('current operation');
    await expect(runner.browserInteraction(session.id, { action: 'open' })).rejects.toThrow('current operation');
    release(); await pending;
    expect(() => runner.assertIdle(session.id)).not.toThrow();
  });
  it('allows only the manual browser stop to overlap its navigation and holds ownership until both settle', async () => {
    const session = await create(), response = { snapshot: 'done', state: { tabs: [], activeId: null, busy: false, width: 480, height: 800, revision: 1 } };
    let releaseNavigation!: () => void, releaseStop!: () => void;
    vi.mocked(runner.browsers.execute).mockImplementationOnce(async () => { await new Promise<void>(resolve => { releaseNavigation = resolve; }); return response; });
    const stop = vi.spyOn(runner.browsers, 'stopLoading').mockImplementationOnce(async () => { await new Promise<void>(resolve => { releaseStop = resolve; }); return response.state; });
    const pending = runner.browserInteraction(session.id, { action: 'navigate', url: 'https://example.com' });
    const input = { tabId: 'tab', navigationId: crypto.randomUUID() }, stopping = runner.stopBrowserLoading(session.id, input);
    expect(stop).toHaveBeenCalledWith(session.id, input); releaseNavigation(); await pending;
    expect(() => runner.start(session.id, 'Run while stopping')).toThrow('current operation');
    await expect(runner.browserInspection(session.id, {})).rejects.toThrow('current operation');
    releaseStop(); await stopping; expect(() => runner.assertIdle(session.id)).not.toThrow();
  });
  it('refuses stop during agent work or an unrelated manual operation and validates the API input', async () => {
    const session = await create(), stop = vi.spyOn(runner.browsers, 'stopLoading');
    const input = { tabId: 'tab', navigationId: crypto.randomUUID() };
    runner.start(session.id, 'Inspect the website'); await vi.waitFor(() => expect(runner.permissions(session.id)).toHaveLength(1));
    await expect(runner.stopBrowserLoading(session.id, input)).rejects.toThrow('current operation'); expect(stop).not.toHaveBeenCalled();
    runner.decide(session.id, runner.permissions(session.id)[0].id, 'deny'); await runner.whenIdle();
    let release!: () => void; const pending = runner.exclusive(session.id, async () => new Promise<void>(resolve => { release = resolve; }));
    await expect(runner.stopBrowserLoading(session.id, input)).rejects.toThrow('current operation'); release(); await pending;
    const request = (id: string, data: unknown) => fetch(`${url}/api/sessions/${id}/browser/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    expect((await request(session.id, { ...input, navigationId: 'unknown' })).status).toBe(400); expect((await request('missing', input)).status).toBe(404);
    store.updateSession(session.id, { archived: true }); expect((await request(session.id, input)).status).toBe(409); expect(stop).not.toHaveBeenCalled();
  });
  it('waits for approval and never executes a denied browser action', async () => {
    const session = await create(); runner.start(session.id, 'Inspect the website');
    await vi.waitFor(() => expect(runner.permissions(session.id)).toHaveLength(1));
    expect(runner.browsers.execute).not.toHaveBeenCalled();
    const permission = runner.permissions(session.id)[0];
    expect(permission.description).toContain('https://example.com');
    runner.decide(session.id, permission.id, 'deny'); await runner.whenIdle();
    expect(runner.browsers.execute).not.toHaveBeenCalled();
  });
  it('runs approved browser actions and sends screenshot attachments back to the model', async () => {
    const session = await create(); runner.start(session.id, 'Inspect the website');
    await vi.waitFor(() => expect(runner.permissions(session.id)).toHaveLength(1));
    runner.decide(session.id, runner.permissions(session.id)[0].id, 'allow'); await runner.whenIdle();
    expect(runner.browsers.execute).toHaveBeenCalledOnce();
    const result = store.messages(session.id).find(message => message.role === 'tool');
    expect(result?.content).toContain('Example page');
    expect(result?.attachments?.[0].dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(JSON.stringify(calls.at(-1).messages)).toContain('image_url');
  });
  it('does not advertise browser actions in Plan mode', async () => {
    requestTool = false;
    const session = await create({mode:'plan'}); runner.start(session.id, 'Plan'); await runner.whenIdle();
    expect(calls[0].tools.map((tool: any) => tool.function.name)).not.toContain('browser');
  });
  it('coordinates selection capture with agent runs and validates task selection requests', async () => {
    const session = await create(), input = { tabId: 'tab', revision: 1 }, selected = { ...input, text: 'Selected page text', truncated: false, url: 'https://example.com', title: 'Page', capturedAt: Date.now() };
    let release!: () => void; const read = vi.spyOn(runner.browsers, 'selection').mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); return selected; });
    const pending = runner.browserSelection(session.id, input); expect(() => runner.start(session.id, 'Run now')).toThrow('current operation'); release(); await pending;
    read.mockResolvedValue(selected);
    const request = (id: string, data: unknown) => fetch(`${url}/api/sessions/${id}/browser/selection`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    expect((await request(session.id, { tabId: 'tab' })).status).toBe(400); expect((await request('missing', input)).status).toBe(404);
    const response = await request(session.id, input); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); expect(await response.json()).toEqual(selected);
    store.updateSession(session.id, { archived: true }); expect((await request(session.id, input)).status).toBe(409);
  });
  it('rejects manual browser actions while the task is running', async () => {
    const session = await create(); runner.start(session.id, 'Inspect the website');
    await vi.waitFor(() => expect(runner.permissions(session.id)).toHaveLength(1));
    const response = await fetch(`${url}/api/sessions/${session.id}/browser`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'open',url:'https://example.com'})});
    expect(response.status).toBe(409);
    expect(runner.browsers.execute).not.toHaveBeenCalled();
    runner.decide(session.id, runner.permissions(session.id)[0].id, 'deny'); await runner.whenIdle();
  });
  it('reserves the task while sharing files and validates upload ownership at the API boundary', async () => {
    const session = await create(), input = { action: 'cancel', requestId: crypto.randomUUID(), tabId: 'tab' }, state = { tabs: [], activeId: null, busy: false, width: 480, height: 800, revision: 1 };
    let release!: () => void; const upload = vi.spyOn(runner.browsers, 'upload').mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); return state; });
    const pending = runner.browserUpload(session.id, input); expect(() => runner.start(session.id, 'Run now')).toThrow('current operation'); await expect(runner.browserInteraction(session.id, { action: 'open' })).rejects.toThrow('current operation'); release(); await pending;
    upload.mockResolvedValue(state);
    const request = (id: string, body: unknown) => fetch(`${url}/api/sessions/${id}/browser/upload`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await request(session.id, { ...input, files: [] })).status).toBe(400); expect((await request('missing', input)).status).toBe(404);
    const response = await request(session.id, input); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    runner.start(session.id, 'Inspect the website'); await vi.waitFor(() => expect(runner.permissions(session.id)).toHaveLength(1)); expect((await request(session.id, input)).status).toBe(409);
    runner.decide(session.id, runner.permissions(session.id)[0].id, 'deny'); await runner.whenIdle();
    store.updateSession(session.id, { archived: true }); expect((await request(session.id, input)).status).toBe(409);
  });
  it('rejects status and frame reads for nonexistent tasks', async () => {
    expect((await fetch(url+'/api/sessions/missing/browser')).status).toBe(404);
    expect((await fetch(url+'/api/sessions/missing/browser/frame')).status).toBe(404);
  });
  it('reads diagnostic metadata during a run, while validating and coordinating clear actions', async () => {
    const session = await create(), value = { tabId: 'tab', title: 'Page', url: 'https://example.com', live: true, capturedAt: Date.now(), console: [], requests: [], droppedConsole: 0, droppedRequests: 0 };
    const read = vi.spyOn(runner.browsers, 'diagnostics').mockResolvedValue(value), clear = vi.spyOn(runner.browsers, 'clearDiagnostics').mockResolvedValue(value);
    const path = `${url}/api/sessions/${session.id}/browser/diagnostics`;
    expect((await fetch(path)).status).toBe(400); expect((await fetch(path + '?tabId=tab')).status).toBe(200); expect(read).toHaveBeenCalledWith(session.id, 'tab');
    const remove = (view: string) => fetch(path, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tabId: 'tab', view }) });
    expect((await remove('unknown')).status).toBe(400); expect(clear).not.toHaveBeenCalled();
    runner.start(session.id, 'Inspect the website'); await vi.waitFor(() => expect(runner.permissions(session.id)).toHaveLength(1));
    expect((await fetch(path + '?tabId=tab')).status).toBe(200); expect((await remove('console')).status).toBe(409); expect(clear).not.toHaveBeenCalled();
    runner.decide(session.id, runner.permissions(session.id)[0].id, 'deny'); await runner.whenIdle();
    expect((await remove('console')).status).toBe(200); expect(clear).toHaveBeenCalledWith(session.id, 'tab', 'console');
    store.updateSession(session.id, { archived: true }); expect((await remove('network')).status).toBe(409);
  });
});
