/** Real PTY check for streaming transcript presentation: inline markdown must
 * never flash its literal markers while a response streams, and activity rows
 * must keep the same indentation live and once collapsed into a step summary.
 * The fixture owns an ephemeral server and workspace; no user sessions,
 * configuration, credentials, or provider quota are touched. */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import pty from 'node-pty';
import xterm from '@xterm/headless';

const root = resolve(import.meta.dirname, '..');
const artifacts = join(root, 'test-results-tui', 'stream');
await mkdir(artifacts, { recursive: true });
const config = await mkdtemp(join(tmpdir(), 'litespeed-stream-'));
const server = spawn(process.execPath, ['--import', 'tsx', 'scripts/e2e-server.ts'], { cwd: root, env: { ...process.env, LITESPEED_E2E_PORT: '0', LITESPEED_E2E_NO_VITE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '', terminal, emulator, previous = '';
const frames = [];
server.stdout.on('data', chunk => { log += chunk; });
server.stderr.on('data', chunk => { log += chunk; });
const screen = () => emulator ? Array.from({ length: emulator.rows }, (_, row) => emulator.buffer.active.getLine(emulator.buffer.active.viewportY + row)?.translateToString(true, 0, emulator.cols) ?? '').join('\n') : '';
const delay = ms => new Promise(done => setTimeout(done, ms));
const record = () => { const text = screen(); if (text !== previous) { frames.push(text); previous = text; } };
const waitFor = async (check, label, timeout = 45000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(40); }
  throw new Error(`Timed out: ${label}\n${screen()}\n${log.slice(-1500)}`);
};
/** Column of the disclosure chevron on the line holding a marker. */
const chevronColumn = (text, marker) => {
  const line = text.split('\n').find(row => row.includes(marker));
  assert(line !== undefined, `Missing ${marker}\n${text}`);
  const column = line.search(/[▸▾]/);
  assert(column >= 0, `No chevron on ${JSON.stringify(line)}`);
  return column;
};

try {
  await waitFor(() => /ready at (http:\/\/\S+)/.test(log), 'fixture ready');
  const base = log.match(/ready at (http:\/\/\S+)/)[1];
  const api = async (path, body, method) => {
    const response = await fetch(`${base}/api${path}`, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json();
    assert(response.ok, JSON.stringify(value));
    return value;
  };
  const settings = await api('/settings');
  await writeFile(join(settings.workspace, 'notes.txt'), 'Fixture note.\n');
  const session = await api('/sessions', { workspace: settings.workspace, providerId: 'fixture', model: 'test-model', permissionMode: 'auto' });
  emulator = new xterm.Terminal({ cols: 100, rows: 32, allowProposedApi: true });
  terminal = pty.spawn(process.execPath, ['bin/litespeed.mjs', 'tui', '--url', base, '--session', session.id], { cwd: root, cols: 100, rows: 32, name: 'xterm-256color', env: { ...process.env, TERM: 'xterm-256color', LITESPEED_DISABLE_PROJECT_CONFIG: '1', XDG_CONFIG_HOME: config, XDG_STATE_HOME: config } });
  terminal.onData(chunk => emulator.write(chunk, record));
  await waitFor(() => screen().includes('Commands [Ctrl+P]'), 'composer ready');
  await delay(200);
  terminal.write('TUI_MARKDOWN_STREAM review the transcript.\r');

  await waitFor(() => screen().includes('is stable') && /\d step/.test(screen()), 'run settles into a step summary');
  await delay(400);
  const settled = screen();
  await writeFile(join(artifacts, 'settled.txt'), settled);
  await writeFile(join(artifacts, 'frames.txt'), frames.map((text, index) => `--- frame ${index} ---\n${text}`).join('\n'));
  // The live frame: response text present, activity still uncollapsed.
  const live = frames.findLast(text => /sleep 2/.test(text) && !/\d step/.test(text));
  assert(live, 'no recorded frame showed live activity');
  await writeFile(join(artifacts, 'live.txt'), live);

  // 1. No frame may show raw inline markdown markers in the response text.
  const leaked = frames.filter(text => text.split('\n').some(line => /Reviewing the|transcript/.test(line) && /\*\*|~~|`/.test(line)));
  assert.equal(leaked.length, 0, `Raw markdown markers appeared in ${leaked.length} of ${frames.length} frames:\n${leaked.slice(0, 3).join('\n---\n')}`);

  // 2. Emphasis must not reflow: the bolded word keeps one column from its
  // first frame to the settled response.
  const columns = new Set(frames.flatMap(text => text.split('\n')
    .filter(line => line.includes('Reviewing the') && !line.includes('TUI_MARKDOWN'))
    .map(line => line.indexOf('streaming'))
    .filter(column => column > 0)));
  assert.equal(columns.size, 1, `The bolded word rendered at columns ${[...columns].join(', ')} while streaming`);

  // 3. A live activity row sits no further left than the settled step summary.
  const liveColumn = chevronColumn(live, 'sleep 2');
  const settledColumn = chevronColumn(settled, 'step');
  assert.equal(liveColumn, settledColumn, `Live activity chevron at column ${liveColumn} but the settled step summary is at column ${settledColumn}`);

  console.log(`TUI streaming presentation: ${frames.length} frames inspected, activity chevron column ${liveColumn}. PASS`);
} finally {
  terminal?.kill();
  server.kill('SIGTERM');
  await delay(500);
  server.kill('SIGKILL');
  await rm(config, { recursive: true, force: true });
}
