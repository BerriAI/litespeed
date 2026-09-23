import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../../server/store.js';

const exec = promisify(execFile), root = resolve(import.meta.dirname, '../..');
const temporary = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-desktop-start-'))), source = join(temporary, 'source'), destination = join(temporary, 'desktop'), workspace = join(temporary, 'project');
await mkdir(workspace);
const sourceStore = new Store(source); sourceStore.saveSettings({ workspace, defaultProvider: 'fixture', defaultModel: 'existing-model', theme: 'dark', providers: [{ id: 'fixture', name: 'Existing gateway', kind: 'openai', baseUrl: 'http://127.0.0.1:1', apiKey: 'fixture-key' }] }); const task = sourceStore.createSession({ title: 'Existing project task', workspace }); sourceStore.close();
const probe = createServer(); await new Promise<void>(done => probe.listen(0, '127.0.0.1', done)); const port = (probe.address() as { port: number }).port; await new Promise<void>(done => probe.close(() => done()));
const url = `http://127.0.0.1:${port}`;
let pid: number | undefined;
try {
  const env = { ...process.env, LITESPEED_DATA_DIR: destination, LITESPEED_IMPORT_FROM: source, LITESPEED_DESKTOP_URL: url, LITESPEED_WORKSPACE: workspace };
  const launched = await exec(process.execPath, ['bin/desktop-server.mjs'], { cwd: root, env }); const state = JSON.parse(launched.stdout); pid = state.pid; assert.ok(pid); assert.equal(state.started, true);
  const settings = await (await fetch(url + '/api/settings')).json(); assert.equal(settings.defaultModel, 'existing-model'); assert.equal(settings.workspace, workspace); assert.equal(settings.theme, 'dark'); assert.equal(settings.providers[0].configured, true); assert.ok(!JSON.stringify(settings).includes('fixture-key'));
  const sessions = await (await fetch(url + '/api/sessions')).json(); assert.ok(sessions.sessions.some((item: { id: string }) => item.id === task.id));
  const marker = await (await fetch(url + '/api/desktop/import')).json(); assert.equal(marker.sessions, 1);
  const page = await (await fetch(url)).text(); assert.match(page, /<title>Litespeed<\/title>/);
  const repeated = JSON.parse((await exec(process.execPath, ['bin/desktop-server.mjs'], { cwd: root, env })).stdout); assert.equal(repeated.started, false);
  await assert.rejects(exec(process.execPath, ['bin/desktop-server.mjs'], { cwd: root, env: { ...env, LITESPEED_DATA_DIR: join(temporary, 'other-desktop') } }), /different saved data/);
  assert.equal((await (await fetch(url + '/api/settings')).json()).defaultModel, 'existing-model');
  console.log('Desktop launch passed: saved configuration and history imported, frontend served, existing server reused.');
} finally {
  if (pid) { process.kill(pid, 'SIGTERM'); for (let attempt = 0; attempt < 60; attempt++) { try { process.kill(pid, 0); await new Promise(done => setTimeout(done, 100)); } catch { break; } } }
  await rm(temporary, { recursive: true, force: true });
}
