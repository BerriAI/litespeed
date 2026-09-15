import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';

let dir = '', server: Server, base = '', store: Store;
const reconnect = vi.fn(), refresh = vi.fn();
async function request(path: string, body?: unknown) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() as any };
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'litespeed-mcp-import-api-'));
  vi.stubEnv('HOME', join(dir, 'home')); vi.stubEnv('CODEX_HOME', join(dir, 'codex'));
  await mkdir(join(dir, 'home'));
  store = new Store(join(dir, 'state'));
  const built = createApp({ store, external: { status: () => [], reconnect, refresh } as any });
  server = createServer(built.app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
});
afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  store.close(); vi.unstubAllEnvs(); vi.clearAllMocks();
  await rm(dir, { recursive: true, force: true });
});
it('validates bodies, redacts responses, and imports only on explicit apply without connecting', async () => {
  await mkdir(join(dir, 'work'));
  const workspace = await realpath(join(dir, 'work'));
  await writeFile(join(workspace, '.mcp.json'), JSON.stringify({ mcpServers: {
    demo: { command: 'secret-command', env: { TOKEN: 'fixture-secret' } },
  } }));
  const found = await request(`/mcp/import/discover?workspace=${encodeURIComponent(workspace)}`);
  expect(found.status).toBe(200);
  expect(JSON.stringify(found.data)).not.toContain('secret');
  const id = found.data.candidates[0].id;
  expect((await request('/mcp/import/plan', { workspace, ids: [id], extra: true })).status).toBe(400);
  expect((await request('/mcp/import/plan', { workspace, ids: [id, id] })).status).toBe(400);
  const plan = await request('/mcp/import/plan', { workspace, ids: [id] });
  expect(plan.status).toBe(200);
  expect(store.settings().mcpServers).toEqual({});
  const input = { workspace, ids: [id], sourceHash: plan.data.sourceHash };
  expect((await request('/mcp/import/apply', { ...input, expectedMcpConfigRevision: 'wrong' })).status).toBe(409);
  expect(store.settings().mcpServers).toEqual({});
  const revision = (await request('/mcp')).data.configRevision;
  const applied = await request('/mcp/import/apply', { ...input, expectedMcpConfigRevision: revision });
  expect(applied.status).toBe(200);
  expect(applied.data.imported).toEqual(['demo']);
  expect(applied.data.configRevision).not.toBe(revision);
  expect(store.settings().mcpServers.demo).toEqual({
    command: 'secret-command', env: { TOKEN: 'fixture-secret' }, enabled: false, advertise: false,
  });
  expect(JSON.stringify((await request('/settings')).data)).not.toContain('fixture-secret');
  expect(reconnect).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
});
