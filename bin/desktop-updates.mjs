import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { access, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { newer, RELEASES } from './updates.mjs';

const exec = promisify(execFile), platform = `${process.platform}-${process.arch}`;
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const desktopNewer = (a, b) => newer(a.version, b.version) || (a.version === b.version && a.build > b.build);
export function desktopManifest(value, expectedPlatform = platform) {
  if (!value || value.schema !== 1 || !stable.test(value.version) || !Number.isSafeInteger(value.build ?? 1) || (value.build ?? 1) < 1 || value.platform !== expectedPlatform || !['darwin-arm64', 'darwin-x64'].includes(value.platform)) throw new Error('Invalid desktop release metadata.');
  const asset = value.asset;
  if (!asset || asset.file !== `Litespeed-${value.version}-${value.platform}.zip` || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > 1024 ** 3) throw new Error('Invalid desktop update archive.');
  return { ...value, build: value.build ?? 1 };
}
async function boundedJson(url, limit = 1024 * 1024) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Litespeed desktop updater', Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Could not check desktop updates (HTTP ${response.status}).`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > limit) throw new Error('Desktop update response is too large.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function latestDesktop() {
  const releases = await boundedJson('https://api.github.com/repos/BerriAI/litespeed/releases?per_page=30');
  if (!Array.isArray(releases)) throw new Error('Invalid desktop release list.');
  const candidates = releases.filter(item => !item.draft && /^(v\d+\.\d+\.\d+|desktop-v\d+\.\d+\.\d+-preview\.\d+)$/.test(item.tag_name) && item.assets?.some(asset => asset.name === `desktop-manifest-${platform}.json`));
  let best;
  // The list includes CLI-only releases. Use only desktop manifests for this architecture.
  for (const item of candidates.slice(0, 8)) {
    const release = desktopManifest(await boundedJson(`${RELEASES}/download/${item.tag_name}/desktop-manifest-${platform}.json`, 16384));
    const version = item.tag_name.match(/v(\d+\.\d+\.\d+)/)?.[1];
    if (release.version !== version) throw new Error('Desktop release tag and manifest disagree.');
    if (!best || desktopNewer(release, best)) best = { ...release, tag: item.tag_name };
  }
  return best;
}
export async function desktopInstallation(root) {
  try {
    root = await realpath(root);
    const app = resolve(root, '../../..');
    if (!app.endsWith('.app') || root !== join(app, 'Contents/Resources/litespeed')) return null;
    const release = await json(join(root, 'desktop-release.json'));
    if (release.schema !== 1 || !stable.test(release.version) || !Number.isSafeInteger(release.build) || release.build < 1 || release.platform !== platform) return null;
    return { app, root, release };
  } catch { return null; }
}
export async function desktopUpdateInProgress(directory, ownId) {
  try {
    const lock = await json(join(directory, 'desktop-updates/restart.json'));
    if (!Number.isSafeInteger(lock.pid) || lock.pid < 2 || typeof lock.id !== 'string' || lock.id === ownId || !Number.isFinite(lock.expires) || lock.expires < Date.now()) return false;
    process.kill(lock.pid, 0); return true;
  } catch { return false; }
}
export async function validateDesktopTree(root, directory = root, links = new Map()) {
  for (const name of await readdir(directory)) {
    const path = join(directory, name), info = await lstat(path);
    if (info.isSymbolicLink()) {
      const local = relative(root, await realpath(path));
      if (local === '..' || local.startsWith('../') || isAbsolute(local)) throw new Error('The app contains a link outside its bundle.');
    } else if (info.isDirectory()) await validateDesktopTree(root, path, links);
    else if (!info.isFile()) throw new Error('The app contains an unsupported file.');
    else { const key = `${info.dev}:${info.ino}`, group = links.get(key) || { count: 0, total: info.nlink }; group.count++; links.set(key, group); }
  }
  if (directory === root && [...links.values()].some(group => group.count !== group.total)) throw new Error('The app contains an external hard link.');
}
export async function validateDesktopBundle(app, release) {
  await validateDesktopTree(app);
  const root = join(app, 'Contents/Resources/litespeed'), metadata = await json(join(root, 'desktop-release.json'));
  if (metadata.version !== release.version || metadata.build !== release.build || metadata.platform !== platform) throw new Error('The app does not match the downloaded release.');
  const plist = join(app, 'Contents/Info.plist');
  const field = async name => (await exec('/usr/libexec/PlistBuddy', ['-c', `Print :${name}`, plist])).stdout.trim();
  if (await field('CFBundleIdentifier') !== 'ai.litellm.litespeed.desktop' || await field('CFBundleShortVersionString') !== release.version || await field('CFBundleVersion') !== String(release.build)) throw new Error('The download is not the expected Litespeed app.');
  await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { timeout: 60000 });
}
export async function unpackDesktopUpdate(archive, destination, release) {
  release = desktopManifest(release);
  const digest = createHash('sha256'); for await (const chunk of createReadStream(archive)) digest.update(chunk);
  if ((await lstat(archive)).size !== release.asset.size || digest.digest('hex') !== release.asset.sha256) throw new Error('The update checksum does not match. Your installed app was left unchanged.');
  const { stdout } = await exec('/usr/bin/tar', ['-tf', archive], { maxBuffer: 16 * 1024 ** 2 });
  const entries = stdout.trim().split('\n');
  if (entries.some(name => !(name === 'Litespeed.app/' || name.startsWith('Litespeed.app/') || name === '__MACOSX/' || name.startsWith('__MACOSX/Litespeed.app/')) || name.split('/').includes('..') || name.includes('\\'))) throw new Error('The update contains an unsafe path.');
  // macOS bsdtar refuses writes through archive symlinks and escaping paths.
  await exec('/usr/bin/tar', ['-xf', archive, '--no-same-owner', '-C', destination], { maxBuffer: 1024 ** 2 });
  const app = join(destination, 'Litespeed.app'); await validateDesktopBundle(app, release); return app;
}
async function writeJson(path, value) {
  const temporary = `${path}.${randomUUID()}`;
  await writeFile(temporary, JSON.stringify(value) + '\n', { mode: 0o600 });
  try { await rename(temporary, path); } finally { await rm(temporary, { force: true }); }
}
export function desktopUpdateService({ installation, directory, fetchLatest = latestDesktop, download, validate = validateDesktopBundle }) {
  const cacheRoot = join(directory, 'desktop-updates'), cachePath = join(cacheRoot, 'checked.json'), pendingPath = join(cacheRoot, 'pending.json');
  let cache, loading, checking, installing, progress;
  async function pending() {
    try {
      const value = await json(pendingPath), path = resolve(cacheRoot, value.path);
      if (!/^stage-[a-zA-Z0-9]+\/Litespeed\.app$/.test(value.path) || dirname(dirname(path)) !== cacheRoot || value.target !== installation.app) return;
      const release = desktopManifest(value.release);
      if (!desktopNewer(release, installation.release) || !(await lstat(path)).isDirectory()) return;
      return { app: path, release };
    } catch { return; }
  }
  async function status(force = false) {
    if (!cache) cache = await (loading ||= json(cachePath).catch(() => ({})));
    const age = Date.now() - (cache.checkedAt || 0);
    if ((force || process.env.LITESPEED_NO_UPDATE_CHECK !== '1') && age > (force ? 1000 : cache.error ? 300000 : 3600000)) {
      checking ||= (async () => {
        try { const release = await fetchLatest(); cache = { ...(release ? { release } : {}), checkedAt: Date.now() }; }
        catch (error) { cache = { ...cache, checkedAt: Date.now(), error: error.message }; }
        await mkdir(cacheRoot, { recursive: true, mode: 0o700 }); await writeJson(cachePath, cache).catch(() => {});
      })().finally(() => { checking = undefined; });
      await checking;
    }
    const staged = await pending(); let release;
    try { if (cache.release) release = desktopManifest(cache.release); } catch { /* Invalid cached metadata is not an update. */ }
    let writable = true; try { await access(dirname(installation.app), constants.W_OK); } catch { writable = false; }
    let failure; try { const result = await json(join(cacheRoot, 'last-result.json')); if (!result.ok && desktopNewer(result, installation.release)) failure = result.error; } catch { /* No prior failed update. */ }
    return { kind: 'desktop', currentVersion: installation.release.version, currentBuild: installation.release.build, latestVersion: release?.version, latestBuild: release?.build, available: Boolean(release && desktopNewer(release, installation.release)), packaged: writable, restartRequired: Boolean(staged), installedVersion: staged?.release.version, installedBuild: staged?.release.build, progress, checkedAt: cache.checkedAt, error: failure || cache.error, releaseUrl: release?.tag ? `${RELEASES}/tag/${release.tag}` : RELEASES, command: writable ? 'Update and restart Litespeed.' : 'Drag Litespeed into Applications before updating. If that folder is managed, use Applications in your home folder.' };
  }
  async function install() {
    if (installing) return installing;
    installing = (async () => {
      const current = await status(true);
      if (!current.packaged) throw new Error(current.command);
      if (!cache.release || !desktopNewer(cache.release, installation.release)) return current;
      const release = desktopManifest(cache.release);
      if (!/^(v\d+\.\d+\.\d+|desktop-v\d+\.\d+\.\d+-preview\.\d+)$/.test(release.tag)) throw new Error('Invalid desktop release tag.');
      const prior = await pending(); if (prior?.release.asset.sha256 === release.asset.sha256) return status();
      await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
      const stage = await mkdtemp(join(cacheRoot, 'stage-')), archive = join(stage, release.asset.file);
      try {
        progress = { received: 0, total: release.asset.size };
        if (download) await download(release, archive);
        else {
          const response = await fetch(`${RELEASES}/download/${release.tag}/${release.asset.file}`, { signal: AbortSignal.timeout(600000) });
          if (!response.ok || !response.body) throw new Error(`Desktop download failed (HTTP ${response.status}).`);
          await pipeline(Readable.fromWeb(response.body), async function* (stream) { for await (const chunk of stream) { progress.received += chunk.length; if (progress.received > release.asset.size) throw new Error('Desktop download exceeds its published size.'); yield chunk; } }, createWriteStream(archive, { flags: 'wx', mode: 0o600 }));
        }
        const app = await unpackDesktopUpdate(archive, stage, release);
        await writeJson(pendingPath, { path: relative(cacheRoot, app), target: installation.app, release });
        await rm(archive);
        if (prior && prior.app !== app) await rm(dirname(prior.app), { recursive: true, force: true });
      } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
      finally { progress = undefined; }
      return status();
    })().finally(() => { installing = undefined; });
    return installing;
  }
  async function prepareRestart({ appPid, base, storeId }) {
    if (!Number.isSafeInteger(appPid) || appPid < 2 || appPid === process.pid) throw new Error('Restart this update from the Litespeed Mac app.');
    const current = await desktopInstallation(installation.root);
    if (!current || current.release.version !== installation.release.version || current.release.build !== installation.release.build) throw new Error('The installed app changed. Reopen Litespeed before updating.');
    const { stdout } = await exec('/bin/ps', ['-p', String(appPid), '-o', 'comm=']);
    if (stdout.trim() !== join(installation.app, 'Contents/MacOS/Litespeed')) throw new Error('The Mac app changed. Reopen Litespeed before updating.');
    const staged = await pending(); if (!staged) throw new Error('Download the desktop update before restarting.');
    await validate(staged.app, staged.release);
    await access(dirname(installation.app), constants.W_OK);
    const work = await mkdtemp(join(cacheRoot, 'handoff-')), id = randomUUID();
    const info = await lstat(installation.app);
    try {
      // The helper and its runtime must survive replacement of the running app.
      await cp(process.execPath, join(work, 'node'));
      for (const name of ['desktop-update-helper.mjs', 'desktop-updates.mjs', 'updates.mjs']) await cp(join(installation.root, 'bin', name), join(work, name));
      await writeJson(join(work, 'job.json'), { id, app: installation.app, staged: staged.app, release: staged.release, appPid, serverPid: process.pid, base, storeId, directory, device: info.dev, inode: info.ino, pendingPath });
      const child = spawn(join(work, 'node'), [join(work, 'desktop-update-helper.mjs'), work], { detached: true, stdio: 'ignore', env: { ...process.env, LITESPEED_DATA_DIR: directory } });
      await new Promise((done, reject) => { child.once('spawn', done); child.once('error', reject); }); child.unref();
      for (let attempt = 0; ; attempt++) {
        try { await access(join(work, 'ready')); break; } catch { if (attempt >= 100) throw new Error('The desktop updater did not start.'); await new Promise(done => setTimeout(done, 100)); }
      }
      return { version: staged.release.version, build: staged.release.build, async commit() {
        const lock = join(cacheRoot, 'restart.json');
        // Claim synchronously: concurrent requests in this server cannot remove each other's lock.
        try {
          const prior = JSON.parse(readFileSync(lock, 'utf8'));
          let live = false; try { if (Number.isSafeInteger(prior.pid) && prior.pid > 1) { process.kill(prior.pid, 0); live = true; } } catch {}
          if (live && prior.expires > Date.now()) throw new Error('Another desktop update is already restarting.');
          unlinkSync(lock);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        writeFileSync(lock, JSON.stringify({ id, pid: child.pid, expires: Date.now() + 180000 }), { flag: 'wx', mode: 0o600 });
        await writeFile(join(work, 'commit'), id, { mode: 0o600 });
      }, cancel: () => writeFile(join(work, 'cancel'), id, { mode: 0o600 }), complete: () => writeFile(join(work, 'stopped'), id, { mode: 0o600 }) };
    } catch (error) { await writeFile(join(work, 'cancel'), id, { mode: 0o600 }).catch(() => {}); throw error; }
  }
  return { status, install, prepareRestart };
}
