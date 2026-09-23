import { afterEach, describe, expect, it, vi } from 'vitest';
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { desktopInstallation, desktopManifest, desktopNewer, desktopUpdateInProgress, desktopUpdateService, unpackDesktopUpdate, validateDesktopTree } from '../bin/desktop-updates.mjs';
import { replaceDesktop } from '../bin/desktop-update-helper.mjs';
const roots: string[] = [], platform = `${process.platform}-${process.arch}`;
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(path => rm(path, {recursive: true, force: true}))); });
async function folder() { const path = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-desktop-update-test-'))); roots.push(path); return path; }
async function fixture(build = 2) {
  const directory = await folder(), app = join(directory, 'Litespeed.app'), root = join(app, 'Contents/Resources/litespeed');
  await mkdir(root, {recursive: true}); await mkdir(join(app, 'Contents/MacOS'));
  await writeFile(join(root, 'desktop-release.json'), JSON.stringify({schema:1, version:'0.1.23', build, platform}));
  await cp('/usr/bin/true', join(app, 'Contents/MacOS/Litespeed'));
  await writeFile(join(app, 'Contents/Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>ai.litellm.litespeed.desktop</string><key>CFBundleExecutable</key><string>Litespeed</string><key>CFBundleShortVersionString</key><string>0.1.23</string><key>CFBundleVersion</key><string>${build}</string></dict></plist>`);
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', app], {stdio: 'pipe'});
  const file = `Litespeed-0.1.23-${platform}.zip`, archive = join(directory, file);
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, archive]);
  const bytes = await readFile(archive);
  const release = {schema:1 as const, version:'0.1.23', build, platform, tag:`desktop-v0.1.23-preview.${build}`, asset:{file, size:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex')}};
  return {directory, app, root, archive, release};
}
describe('desktop release metadata', () => {
  it('holds fresh startup during replacement, admits its owned replacement, and ignores expired locks', async () => {
    const directory=await folder(),cache=join(directory,'desktop-updates');await mkdir(cache);
    const lock={id:'owned-update',pid:process.pid,expires:Date.now()+60000};
    await writeFile(join(cache,'restart.json'),JSON.stringify(lock));
    expect(await desktopUpdateInProgress(directory)).toBe(true);
    expect(await desktopUpdateInProgress(directory,'owned-update')).toBe(false);
    await writeFile(join(cache,'restart.json'),JSON.stringify({...lock,expires:1}));
    expect(await desktopUpdateInProgress(directory)).toBe(false);
  });
  it('orders desktop builds independently from terminal releases and never downgrades', () => {
    expect(desktopNewer({version:'0.1.23',build:2},{version:'0.1.23',build:1})).toBe(true);
    expect(desktopNewer({version:'0.1.22',build:99},{version:'0.1.23',build:1})).toBe(false);
    expect(desktopNewer({version:'0.1.24',build:1},{version:'0.1.23',build:9})).toBe(true);
  });
  it('rejects foreign architectures, paths and invalid hashes', () => {
    const release = {schema:1,version:'0.1.23',build:2,platform:'darwin-arm64',asset:{file:'Litespeed-0.1.23-darwin-arm64.zip',size:123,sha256:'a'.repeat(64)}};
    expect(desktopManifest(release, 'darwin-arm64').build).toBe(2);
    for (const patch of [{build:-1},{version:'../escape'},{platform:'darwin-x64'},{asset:{...release.asset,file:'../../escape.zip'}},{asset:{...release.asset,sha256:'bad'}}]) expect(() => desktopManifest({...release,...patch}, 'darwin-arm64')).toThrow();
  });
});
describe.skipIf(process.platform !== 'darwin')('desktop installation and rollback', () => {
  it('checks and stages one shared download without replacing the running app or saved work', async () => {
    const old = await fixture(1), next = await fixture(2), directory = join(old.directory, 'saved'); await mkdir(directory); await writeFile(join(directory, 'history'), 'keep');
    const download = vi.fn(async (_release, target) => { await cp(next.archive, target); });
    const fetchLatest = vi.fn(async () => next.release);
    const service = desktopUpdateService({installation:(await desktopInstallation(old.root))!, directory, download, fetchLatest});
    const values = await Promise.all([service.status(),service.status()]);
    expect(fetchLatest).toHaveBeenCalledOnce(); expect(values[0]).toMatchObject({kind:'desktop',currentBuild:1,latestBuild:2,available:true,restartRequired:false});
    await Promise.all([service.install(),service.install()]); expect(download).toHaveBeenCalledOnce();
    expect(await service.status()).toMatchObject({restartRequired:true,installedBuild:2});
    expect(await desktopInstallation(old.root)).toMatchObject({release:{build:1}});
    expect(await readFile(join(directory,'history'),'utf8')).toBe('keep');
    const reopened = desktopUpdateService({installation:(await desktopInstallation(old.root))!,directory,fetchLatest});
    expect(await reopened.status()).toMatchObject({restartRequired:true,installedBuild:2});
    expect(fetchLatest).toHaveBeenCalledOnce();
  });
  it('keeps the current app after a corrupt download and permits a retry', async () => {
    const old = await fixture(1), next = await fixture(2), directory = join(old.directory, 'saved');
    const download = vi.fn(async (_release,target) => { await writeFile(target,'bad bytes'); });
    const service = desktopUpdateService({installation:(await desktopInstallation(old.root))!,directory,fetchLatest:async()=>next.release,download});
    await expect(service.install()).rejects.toThrow('checksum');
    expect(await service.status()).toMatchObject({restartRequired:false});
    expect(await desktopInstallation(old.root)).toMatchObject({release:{build:1}});
    download.mockImplementation(async (_release,target)=>{await cp(next.archive,target);});
    await expect(service.install()).resolves.toMatchObject({restartRequired:true});
  });
  it('does not adopt a pending app outside the staging directory or run arbitrary process IDs', async () => {
    const old = await fixture(1), next = await fixture(2), directory = join(old.directory,'saved'), cache = join(directory,'desktop-updates'); await mkdir(cache,{recursive:true});
    await writeFile(join(cache,'pending.json'),JSON.stringify({path:'../../Litespeed.app',target:old.app,release:next.release}));
    const service=desktopUpdateService({installation:(await desktopInstallation(old.root))!,directory,fetchLatest:async()=>next.release});
    expect(await service.status()).toMatchObject({restartRequired:false});
    await expect(service.prepareRestart({appPid:process.pid,base:'http://127.0.0.1:1',storeId:'test'})).rejects.toThrow('Mac app');
  });
  it('reports offline checks while keeping the app usable', async () => {
    const old=await fixture(1),service=desktopUpdateService({installation:(await desktopInstallation(old.root))!,directory:join(old.directory,'saved'),fetchLatest:async()=>{throw new Error('Offline');}});
    expect(await service.status()).toMatchObject({available:false,error:'Offline'});
  });
  it('rejects archive traversal before extraction and external bundle links', async () => {
    const value=await fixture(), destination=join(value.directory,'stage');await mkdir(destination);
    await symlink('/etc/passwd',join(value.root,'outside'));
    await expect(validateDesktopTree(value.app)).rejects.toThrow('outside');
    execFileSync('python3',['-c','import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],"w") as z:z.writestr("../escaped","bad")',value.archive]);
    const bytes=await readFile(value.archive);value.release.asset.size=bytes.length;value.release.asset.sha256=createHash('sha256').update(bytes).digest('hex');
    await expect(unpackDesktopUpdate(value.archive,destination,value.release)).rejects.toThrow('unsafe path');
    await expect(lstat(join(value.directory,'escaped'))).rejects.toThrow();
  });
  it('rolls back the original app when the replacement fails to start', async () => {
    const old=await fixture(1),next=await fixture(2),info=await lstat(old.app);
    await expect(replaceDesktop({app:old.app,staged:next.app,release:next.release,id:'test',device:info.dev,inode:info.ino},async()=>{throw new Error('Launch failed');})).rejects.toThrow('Launch failed');
    expect(await desktopInstallation(old.root)).toMatchObject({release:{build:1}});
  });
  it('replaces the app only after validation and confirms startup before dropping its backup', async () => {
    const old=await fixture(1),next=await fixture(2),info=await lstat(old.app);
    await replaceDesktop({app:old.app,staged:next.app,release:next.release,id:'test',device:info.dev,inode:info.ino},async app=>{
      expect(await desktopInstallation(join(app,'Contents/Resources/litespeed'))).toMatchObject({release:{build:2}});
      expect(await desktopInstallation(join(old.directory,'.Litespeed-previous-test.app/Contents/Resources/litespeed'))).toMatchObject({release:{build:1}});
    });
    expect(await desktopInstallation(old.root)).toMatchObject({release:{build:2}});
    await expect(lstat(join(old.directory,'.Litespeed-previous-test.app'))).rejects.toThrow();
  });
  it('refuses to replace an app whose identity changed during download', async () => {
    const old=await fixture(1),next=await fixture(2),info=await lstat(old.app), launch=vi.fn();
    await expect(replaceDesktop({app:old.app,staged:next.app,release:next.release,id:'test',device:info.dev,inode:info.ino+1},launch)).rejects.toThrow('changed');
    expect(launch).not.toHaveBeenCalled();expect(await desktopInstallation(old.root)).toMatchObject({release:{build:1}});
  });
});
