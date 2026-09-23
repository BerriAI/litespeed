import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const exec = promisify(execFile), source = resolve(import.meta.dirname, '../..'), platform = `${process.platform}-${process.arch}`;
const artifacts = resolve(process.argv[2] || join(source, 'release-artifacts'));
const manifest = JSON.parse(await readFile(join(artifacts, `desktop-manifest-${platform}.json`), 'utf8'));
const archive = join(artifacts, manifest.asset.file), hash = createHash('sha256');
for await (const chunk of createReadStream(archive)) hash.update(chunk);
assert.equal(hash.digest('hex'), manifest.asset.sha256);
const temporary = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-portable-smoke-')));
const moved = join(temporary, 'Moved app with spaces'), workspace = join(temporary, 'project'), state = join(temporary, 'state');
let pid, provider, native;
const waitFor = async (read, label) => { for (let count = 0; count < 200; count++) { if (await read()) return; await new Promise(done => setTimeout(done, 100)); } throw new Error(label); };
try {
  await mkdir(moved); await mkdir(workspace);
  execFileSync('/usr/bin/ditto', ['-x', '-k', archive, moved]);
  const app = join(moved, 'Litespeed.app'), root = join(app, 'Contents/Resources/litespeed'), node = join(root, 'runtime/node');
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
  const configuration = JSON.parse(await readFile(join(app, 'Contents/Resources/desktop.json'), 'utf8'));
  assert.equal(configuration.bundledRuntime, true); assert.equal(configuration.sourceRoot, undefined); assert.equal(configuration.nodePath, undefined); assert.equal(configuration.attachOnly, undefined);
  assert.equal(execFileSync(node, ['--version'], { encoding: 'utf8' }).trim(), 'v26.8.1');
  provider = createServer((request, response) => {
    if (request.url === '/preview') { response.end('<title>Bundled preview</title><button onclick="document.title=\'Bundled browser works\'">Continue</button><a href="/report">Download report</a>'); return; }
    if (request.url === '/report') { response.writeHead(200, { 'Content-Disposition': 'attachment; filename="portable-report.csv"', 'Content-Type': 'text/csv' }); response.end('runtime,bundled\nnode,true\n'); return; }
    response.writeHead(404).end();
  });
  await new Promise(done => provider.listen(0, '127.0.0.1', done)); const fixture = `http://127.0.0.1:${provider.address().port}`;
  const probe = createServer(); await new Promise(done => probe.listen(0, '127.0.0.1', done)); const base = `http://127.0.0.1:${probe.address().port}`; await new Promise(done => probe.close(done));
  const env = { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LITESPEED_DATA_DIR: state, LITESPEED_DESKTOP_URL: base, LITESPEED_WORKSPACE: workspace, LITESPEED_DESKTOP_SKIP_IMPORT: '1', LITESPEED_DESKTOP_BUNDLE: '1', LITESPEED_NO_UPDATE_CHECK: '1', PLAYWRIGHT_BROWSERS_PATH: join(root, 'runtime/browsers') };
  delete env.NODE_OPTIONS; delete env.NODE_PATH;
  const launch = JSON.parse((await exec(node, [join(root, 'bin/desktop-server.mjs')], { cwd: workspace, env })).stdout); pid = launch.pid; assert.ok(pid); assert.equal(launch.started, true);
  const api = async (path, data, method) => { const response = await fetch(base + '/api' + path, { method: method || (data ? 'POST' : 'GET'), ...(data ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}) }); const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result; };
  assert.equal((await api('/health')).storeId, createHash('sha256').update(await realpath(state)).digest('hex'));
  const html = await (await fetch(base)).text(); assert.match(html, /<title>Litespeed<\/title>/);
  const session = await api('/sessions', { workspace, title: 'Portable app check', permissionMode: 'auto' });
  const browser = await api(`/sessions/${session.id}/browser`, { action: 'open', url: fixture + '/preview' }); assert.equal(browser.tabs[0].title, 'Bundled preview');
  const frame = await fetch(`${base}/api/sessions/${session.id}/browser/frame`); assert.equal(frame.status, 200); assert.equal(Buffer.from(await frame.arrayBuffer()).subarray(0, 2).toString('hex'), 'ffd8');
  const found = await api(`/sessions/${session.id}/browser`, { action: 'find', tabId: browser.activeId, url: fixture + '/preview', text: 'Continue' });
  assert.equal(found.find.total, 1); assert.equal(found.find.active, 0);
  const cleared = await api(`/sessions/${session.id}/browser`, { action: 'find', tabId: browser.activeId, url: fixture + '/preview', text: '', findDirection: 'clear' }); assert.equal(cleared.find, undefined);
  const clicked = await api(`/sessions/${session.id}/browser`, { action: 'click', ref: 'e1' }); assert.equal(clicked.tabs[0].title, 'Bundled browser works');
  await api(`/sessions/${session.id}/browser`, { action: 'click', ref: 'e2' });
  await waitFor(async () => (await api(`/sessions/${session.id}/browser`)).downloads[0]?.status === 'ready', 'Bundled browser download did not finish');
  const download = (await api(`/sessions/${session.id}/browser`)).downloads[0];
  assert.equal(await (await fetch(`${base}/api/sessions/${session.id}/browser/downloads/${download.id}`)).text(), 'runtime,bundled\nnode,true\n');
  assert.equal((await api('/updates')).packaged, false); assert.match((await api('/updates')).command, /replace Litespeed.app/);
  const repeated = JSON.parse((await exec(node, [join(root, 'bin/desktop-server.mjs')], { cwd: workspace, env })).stdout); assert.equal(repeated.started, false);
  await assert.rejects(exec(node, [join(root, 'bin/desktop-server.mjs')], { cwd: workspace, env: { ...env, LITESPEED_DATA_DIR: join(temporary, 'other-state') } }), /different saved data/);
  if (process.env.LITESPEED_NATIVE_PACKAGE_SMOKE === '1') {
    await api('/settings', { providers: [{ id: 'fixture', name: 'Local test gateway', kind: 'openai', baseUrl: fixture }], defaultProvider: 'fixture', defaultModel: 'test-model', theme: 'dark' }, 'PATCH');
    process.kill(pid, 'SIGTERM');
    await waitFor(async () => { try { process.kill(pid, 0); return false; } catch { return true; } }, 'The first owned server did not stop'); pid = undefined;
    const audit = join(source, '.ui-audit/portable-native'); await rm(audit, { recursive: true, force: true });
    native = spawn(join(app, 'Contents/MacOS/Litespeed'), ['--audit-dir', audit], { cwd: workspace, env: { ...env, LITESPEED_DESKTOP_AUDIT: '1' }, stdio: 'ignore' });
    await waitFor(async () => {
      try { const health = await api('/health'); if (health.storeId !== createHash('sha256').update(await realpath(state)).digest('hex')) throw new Error('Unexpected native server identity'); pid = health.pid; return Boolean(pid); }
      catch { if (native.exitCode !== null) throw new Error('The relocated native app exited before starting its server'); return false; }
    }, 'The relocated native app did not start its bundled server');
    await waitFor(async () => { try { await readFile(join(audit, 'native-webview.png')); return true; } catch { return false; } }, 'Native WebKit snapshot was not produced');
    const view = JSON.parse(await readFile(join(audit, 'native-state.json'), 'utf8'));
    assert.equal(view.desktop, 'macos'); assert.equal(view.bridge, true); assert.ok(view.text.includes('What should we work on?')); assert.ok(view.scrollWidth <= view.width);
    console.log('Native packaged app also passed: relocated executable starts its own bundled server, loads WebKit with the folder bridge, and produces an app-owned home snapshot. Native OS dialogs are not covered.');
  }
  console.log('Portable Mac package passed: relocated signed app, bundled Node and Chromium, isolated startup, served UI, live browser interaction, retained download, safe reuse and mismatched-store refusal.');
} finally {
  if (native?.exitCode === null) native.kill('SIGTERM');
  if (pid) { try { process.kill(pid, 'SIGTERM'); } catch {} await waitFor(async () => { try { process.kill(pid, 0); return false; } catch { return true; } }, 'Owned server did not stop').catch(() => {}); }
  if (provider) { provider.closeAllConnections(); await new Promise(done => provider.close(done)); }
  await rm(temporary, { recursive: true, force: true });
}
