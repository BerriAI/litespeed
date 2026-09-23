import './check-node.mjs';
import { appendFile, mkdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureTuiServer } from './tui-server.mjs';
import { findDesktopSource, importDesktopState } from './desktop-state.mjs';
import { desktopInstallation, desktopUpdateInProgress } from './desktop-updates.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(process.env.LITESPEED_DATA_DIR || join(homedir(), 'Library/Application Support/Litespeed'));
try {
  if (await desktopUpdateInProgress(destination, process.env.LITESPEED_DESKTOP_UPDATE_HANDOFF)) throw new Error('Litespeed is installing an update. It will reopen automatically in a moment.');
  const source = await findDesktopSource([process.env.LITESPEED_IMPORT_FROM, join(root, '.litespeed'), join(homedir(), '.local/share/litespeed-data')], destination);
  if (source && process.env.LITESPEED_DESKTOP_SKIP_IMPORT !== '1') await importDesktopState(source, destination);
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const storeId = createHash('sha256').update(await realpath(destination)).digest('hex');
  const base = process.env.LITESPEED_DESKTOP_URL || 'http://127.0.0.1:3215';
  const path = [...new Set([dirname(process.execPath), join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', ...(process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin').split(':')])].join(':');
  const started = await ensureTuiServer({ base, root, workspace: process.env.LITESPEED_WORKSPACE || homedir(), explicit: false, storeId, env: { ...process.env, PATH: path, LITESPEED_DATA_DIR: destination } });
  const desktop = process.env.LITESPEED_DESKTOP_BUNDLE === '1' ? await desktopInstallation(root) : null;
  if (desktop && !started) {
    const health = await (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) })).json();
    if (health.version !== desktop.release.version || health.desktopBuild !== desktop.release.build) throw new Error('An earlier Litespeed desktop server is still running. Finish its tasks and restart your Mac once to activate this installation. Future in-app updates restart Litespeed automatically.');
  }
  console.log(JSON.stringify({ url: base, started: Boolean(started), ...(started?.pid ? { pid: started.pid } : {}) }));
} catch (error) {
  await mkdir(destination, { recursive: true, mode: 0o700 }).catch(() => {});
  await appendFile(join(destination, 'desktop-startup.log'), `${new Date().toISOString()} ${error.message}\n`, { mode: 0o600 }).catch(() => {});
  console.error(`Litespeed could not start: ${error.message}`); process.exitCode = 1;
}
