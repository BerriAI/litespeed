/** Exercise real terminal editing and the image payload; leave the system clipboard alone. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pty from 'node-pty';
import xterm from '@xterm/headless';

const root = resolve(import.meta.dirname, '..');
const directory = await mkdtemp(join(tmpdir(), 'litespeed-images-'));
const artifacts = join(root, 'test-results-tui', 'images'); await mkdir(artifacts, { recursive: true });
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=';
const image = join(directory, 'clipboard.png'); await writeFile(image, Buffer.from(png, 'base64'));
for (const name of ['osascript', 'wl-paste', 'xclip']) await writeFile(join(directory, name), '#!/bin/sh\ncat "$LITESPEED_IMAGE_FIXTURE"\n', { mode: 0o700 });
const server = spawn(process.execPath, ['--import', 'tsx', 'scripts/e2e-server.ts'], { cwd: root, env: { ...process.env, LITESPEED_E2E_PORT: '0', LITESPEED_E2E_NO_VITE: '1', LITESPEED_E2E_SNAPSHOT_DELAY_MS: '250' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '', terminal, emulator;
server.stdout.on('data', chunk => { log += chunk; }); server.stderr.on('data', chunk => { log += chunk; });
const delay = ms => new Promise(done => setTimeout(done, ms));
const screen = () => emulator ? Array.from({ length: emulator.rows }, (_, i) => emulator.buffer.active.getLine(emulator.buffer.active.viewportY + i)?.translateToString(true) ?? '').join('\n') : '';
async function waitFor(check, label) {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await check()) return; await delay(60); }
  throw new Error(`${label}\n${screen()}\n${log.slice(-1000)}`);
}
async function stop() { terminal?.kill(); terminal = undefined; await delay(150); emulator?.dispose(); emulator = undefined; }
try {
  await waitFor(() => /ready at (http:\/\/\S+)/.test(log), 'fixture ready');
  const base = log.match(/ready at (http:\/\/\S+)/)[1];
  const api = async (path, body) => {
    const response = await fetch(base + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json(); assert(response.ok, JSON.stringify(data)); return data;
  };
  const settings = await api('/settings');
  for (const [cols, rows] of [[80, 24], [110, 36]]) {
    const session = await api('/sessions', { workspace: settings.workspace });
    const launch = async (composerText = 'Ask Litespeed to do something') => {
      emulator = new xterm.Terminal({ cols, rows, allowProposedApi: true });
      terminal = pty.spawn(process.execPath, ['bin/litespeed.mjs', 'tui', '--url', base, '--session', session.id], { cwd: root, cols, rows, name: 'xterm-256color', env: { ...process.env, PATH: directory + ':' + process.env.PATH, LITESPEED_IMAGE_FIXTURE: image, TERM: 'xterm-256color', LITESPEED_DISABLE_PROJECT_CONFIG: '1', LITESPEED_CONFIG_DIR: directory, XDG_STATE_HOME: directory } });
      const display = emulator; terminal.onData(chunk => display.write(chunk));
      // The footer renders during loading, before a textarea exists to receive keys.
      await waitFor(() => screen().includes('Send [Enter]') && screen().includes(composerText), 'composer ready');
    };
    await launch();
    terminal.write('Compare '); await waitFor(() => screen().includes('Compare '), 'typing ready');
    terminal.write('\x16'); await waitFor(() => screen().includes('Compare [Image-1]'), 'first image is inline');
    terminal.write(' versus '); await waitFor(() => screen().includes(' versus '), 'text after image');
    terminal.write('\x16'); await waitFor(() => screen().includes('[Image-2]'), 'second image');
    terminal.write(' please'); await waitFor(() => screen().includes('[Image-2] please'), 'typing after second image');
    assert(!screen().includes('Attached clipboard image')); assert(!screen().includes('clipboard-image.png'));
    assert.equal(screen().split('\n').filter(line => line.includes('[Image-1]')).length, 1);
    await writeFile(join(artifacts, `inline-${cols}.txt`), screen());
    if (process.argv.includes('--screenshot')) {
      const { chromium } = await import('@playwright/test'); const browser = await chromium.launch({ channel: 'chrome', headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: cols * 9 + 32, height: rows * 20 + 32 }, deviceScaleFactor: 2 });
        await page.setContent('<body style="margin:0;background:#101010;color:#ddd"><pre style="font:15px/20px Menlo,monospace;margin:16px"></pre></body>');
        await page.locator('pre').evaluate((element, text) => { element.textContent = text; }, screen());
        await page.screenshot({ path: join(artifacts, `inline-${cols}.png`) });
      } finally { await browser.close(); }
    }
    // Remove the image in the middle of the sentence, then undo it as one unit.
    terminal.write('\x1b[D'.repeat(7) + '\x7f');
    await waitFor(() => screen().includes(' versus  please') && !screen().includes('[Image-2]'), 'backspace removes image token');
    terminal.write('\x1b[45;5u');
    await waitFor(() => screen().includes('[Image-2] please'), 'undo restores image');
    await delay(350); await stop(); await launch('Compare [Image-1] versus [Image-2] please');
    terminal.write('\r');
    await waitFor(async () => (await api(`/sessions/${session.id}`)).messages.some(message => message.role === 'user'), 'image message sent');
    const message = (await api(`/sessions/${session.id}`)).messages.find(message => message.role === 'user');
    assert.equal(message.content, 'Compare [Image-1] versus [Image-2] please');
    assert.equal(message.attachments.length, 2);
    assert.deepEqual(message.attachments.map(item => item.name), ['Image-1.png', 'Image-2.png']);
    assert(message.attachments.every(item => item.dataUrl === `data:image/png;base64,${png}`));
    await waitFor(() => screen().includes('Ask Litespeed to do something'), 'composer cleared after send');
    terminal.write('\x1b[200~Plain text and https://example.com\x1b[201~');
    await waitFor(() => screen().includes('Plain text and https://example.com'), 'native bracketed text paste');
    terminal.write('\r');
    await waitFor(async () => (await api(`/sessions/${session.id}`)).messages.filter(message => message.role === 'user').length === 2, 'plain text sent');
    const plain = (await api(`/sessions/${session.id}`)).messages.filter(message => message.role === 'user')[1];
    assert.equal(plain.content, 'Plain text and https://example.com'); assert.equal(plain.attachments?.length ?? 0, 0);
    await stop(); console.log(`PASS ${cols}x${rows}: inline images, surrounding text, deletion, undo, restart, image payload, and native text paste.`);
  }
} finally { await stop(); server.kill('SIGTERM'); await rm(directory, { recursive: true, force: true }); }
