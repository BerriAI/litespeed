import { access, cp, lstat, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDesktopBundle } from './desktop-updates.mjs';

const exec = promisify(execFile), sleep = ms => new Promise(done => setTimeout(done, ms));
const exists = async path => { try { await access(path); return true; } catch { return false; } };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

// Export the transaction separately so failures can be tested without touching a real installation.
export async function replaceDesktop({ app, staged, release, id, device, inode }, launch, validate = validateDesktopBundle) {
  const replacement = join(dirname(app), `.Litespeed-update-${id}.app`), backup = join(dirname(app), `.Litespeed-previous-${id}.app`);
  let moved = false, installed = false;
  try {
    const current = await lstat(app);
    if (current.isSymbolicLink() || current.dev !== device || current.ino !== inode || await realpath(app) !== app) throw new Error('The installed app changed while the update was waiting.');
    if (await exists(replacement) || await exists(backup)) throw new Error('Another desktop installation is in progress.');
    await cp(staged, replacement, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false, mode: constants.COPYFILE_FICLONE });
    await validate(replacement, release);
    await rename(app, backup); moved = true;
    await rename(replacement, app); installed = true;
    await launch(app);
  } catch (error) {
    if (!error.retainBackup) {
      if (installed) await rm(app, { recursive: true, force: true });
      if (moved) await rename(backup, app);
    }
    throw error;
  } finally { await rm(replacement, { recursive: true, force: true }).catch(() => {}); }
  // Cleanup failure must never roll back an app that has already started successfully.
  await rm(backup, { recursive: true, force: true }).catch(() => {});
}

async function run(work) {
  const job = JSON.parse(await readFile(join(work, 'job.json'), 'utf8'));
  const cache = dirname(work), result = join(cache, 'last-result.json');
  let launchedApp, launchedServer, committed = false;
  const cancelled = () => exists(join(work, 'cancel'));
  const report = value => writeFile(result, JSON.stringify({ ...value, at: Date.now(), version: job.release.version, build: job.release.build }) + '\n', { mode: 0o600 });
  async function health() {
    const response = await fetch(job.base + '/api/health', { signal: AbortSignal.timeout(1000) });
    if (!response.ok) throw new Error('The updated server is not ready.');
    return response.json();
  }
  const env = { ...process.env, LITESPEED_DATA_DIR: job.directory, LITESPEED_DESKTOP_URL: job.base, LITESPEED_DESKTOP_SKIP_IMPORT: '1', LITESPEED_DESKTOP_BUNDLE: '1', LITESPEED_DESKTOP_UPDATE_HANDOFF: job.id };
  async function launch(app, verify) {
    const root = join(app, 'Contents/Resources/litespeed');
    env.PLAYWRIGHT_BROWSERS_PATH = join(root, 'runtime/browsers');
    const startup = JSON.parse((await exec(join(root, 'runtime/node'), [join(root, 'bin/desktop-server.mjs')], { cwd: root, env, timeout: 30000 })).stdout);
    if (startup.started) launchedServer = startup.pid;
    const state = await health();
    if (state.storeId !== job.storeId || (verify && (state.version !== job.release.version || state.desktopBuild !== job.release.build || state.desktopUpdateId !== job.id))) throw new Error('The updated app did not start with the expected saved data and version.');
    const args = env.LITESPEED_DESKTOP_AUDIT === '1' && env.LITESPEED_DESKTOP_UPDATE_AUDIT ? ['--audit-dir', env.LITESPEED_DESKTOP_UPDATE_AUDIT] : [];
    launchedApp = spawn(join(app, 'Contents/MacOS/Litespeed'), args, { cwd: root, env, detached: true, stdio: 'ignore' });
    await new Promise((done, reject) => { launchedApp.once('spawn', done); launchedApp.once('error', reject); }); launchedApp.unref();
    await sleep(1500);
    if (!alive(launchedApp.pid)) throw new Error('The updated Mac app could not open.');
  }
  async function stopOwned() {
    if (launchedApp?.pid && alive(launchedApp.pid)) launchedApp.kill('SIGTERM');
    if (launchedServer) {
      try { const state = await health(); if (state.pid === launchedServer && state.desktopUpdateId === job.id) process.kill(launchedServer, 'SIGTERM'); } catch { /* Never signal an unidentified process. */ }
    }
    for (let i = 0; i < 100 && (launchedServer && alive(launchedServer) || launchedApp?.pid && alive(launchedApp.pid)); i++) await sleep(100);
    if (launchedServer && alive(launchedServer) || launchedApp?.pid && alive(launchedApp.pid)) throw Object.assign(new Error('The new app has not stopped; its backup has been retained for recovery.'), { retainBackup: true });
    launchedServer = undefined; launchedApp = undefined;
  }
  try {
    await writeFile(join(work, 'ready'), job.id, { mode: 0o600 });
    for (let i = 0; ; i++) {
      if (await cancelled()) return;
      if (await exists(join(work, 'commit'))) { committed = true; break; }
      if (i >= 300) throw new Error('The update was not confirmed.');
      await sleep(100);
    }
    for (let i = 0; ; i++) {
      if (await cancelled()) return;
      if (!alive(job.serverPid) && !alive(job.appPid)) break;
      if (i >= 600) throw new Error('Litespeed did not finish closing. The installed app was left unchanged.');
      await sleep(100);
    }
    if (!await exists(join(work, 'stopped'))) throw new Error('Litespeed did not shut down cleanly. The installed app was left unchanged.');
    await replaceDesktop(job, async app => {
      try { await launch(app, true); }
      catch (error) { await stopOwned(); throw error; }
    });
    await report({ ok: true, appPid: launchedApp.pid, serverPid: launchedServer });
    await rm(job.pendingPath, { force: true });
    await rm(dirname(job.staged), { recursive: true, force: true });
  } catch (error) {
    await report({ ok: false, error: error.message }).catch(() => {});
    if (committed && !alive(job.appPid) && !alive(job.serverPid) && !launchedApp && !launchedServer) await launch(job.app, false).catch(() => {});
  } finally {
    try {
      const path = join(cache, 'restart.json'), lock = JSON.parse(await readFile(path, 'utf8'));
      if (lock.id === job.id) await rm(path, { force: true });
    } catch { /* A cancelled handoff may not have claimed the restart lock. */ }
    // This process runs from a copied runtime, so its temporary files can now go away.
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(resolve(process.argv[2])).catch(() => { process.exitCode = 1; });
}
