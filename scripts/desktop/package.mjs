import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

if (process.platform !== 'darwin') throw new Error('Build the desktop app on its target Mac architecture.');
const source = resolve(import.meta.dirname, '../..'), platform = `${process.platform}-${process.arch}`;
const metadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')), version = metadata.version, build = metadata.desktopBuild || 1;
const output = resolve(process.argv[2] || join(source, 'release-artifacts'));
const temporary = await mkdtemp(join(tmpdir(), 'litespeed-desktop-package-'));
const run = (executable, args, cwd = source, env = process.env) => execFileSync(executable, args, { cwd, env, stdio: 'inherit' });
try {
  // Reuse the CLI package's pinned, checksum-verified Node runtime and exact
  // production dependency lock. Nothing from the user's saved state is copied.
  const packages = join(temporary, 'packages');
  run(process.execPath, [join(source, 'scripts/release/package.mjs'), packages]);
  const descriptor = JSON.parse(await readFile(join(packages, `manifest-${platform}.json`), 'utf8'));
  run('/usr/bin/tar', ['-xzf', join(packages, descriptor.assets[platform].file), '-C', temporary]);
  const bundle = join(temporary, 'litespeed'), browsers = join(bundle, 'runtime/browsers');
  run(join(bundle, 'runtime/node'), [join(bundle, 'node_modules/playwright/cli.js'), 'install', '--only-shell', 'chromium'], bundle, { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers });
  await writeFile(join(bundle, 'runtime/BROWSER-NOTICES.md'), '# Browser runtime\n\nThis app includes the Chromium headless shell and FFmpeg distributed by Playwright. Their bundled licenses and notices are retained under runtime/browsers. Playwright is Apache-2.0 licensed; its license is retained in node_modules/playwright.\n');
  const app = join(temporary, 'Litespeed.app');
  run(process.execPath, [join(source, 'scripts/desktop/build.mjs'), '--output', app, '--bundle', bundle]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  await mkdir(output, { recursive: true });
  const file = `Litespeed-${version}-${platform}.zip`, archive = join(output, file), staging = archive + '.partial';
  run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, staging]);
  await rename(staging, archive);
  const data = await readFile(archive);
  const background = join(temporary, 'background.png'), retina = join(temporary, 'background@2x.png');
  run('xcrun', ['swift', join(source, 'scripts/desktop/dmg-background.swift'), retina]);
  run('/usr/bin/sips', ['-z', '440', '720', retina, '--out', background]);
  let python = process.env.LITESPEED_DMG_PYTHON;
  if (!python) {
    const environment = join(temporary, 'dmg-tools');
    run('python3', ['-m', 'venv', environment]); python = join(environment, 'bin/python');
    run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', join(source, 'scripts/desktop/dmg-requirements.txt')]);
  }
  const diskFile = `Litespeed-${version}-${platform}.dmg`, disk = join(output, diskFile);
  run(python, [join(source, 'scripts/desktop/dmg.py'), app, background, disk]);
  run('/usr/bin/hdiutil', ['verify', disk]);
  await writeFile(join(output, `desktop-manifest-${platform}.json`), JSON.stringify({ schema: 1, version, build, platform, minimumMacOS: '14.0', notarized: false, asset: { file, sha256: createHash('sha256').update(data).digest('hex'), size: (await stat(archive)).size }, installer: { file: diskFile, sha256: createHash('sha256').update(await readFile(disk)).digest('hex'), size: (await stat(disk)).size } }, null, 2) + '\n');
  // Keep the existing development wrapper intact. The portable copy has its
  // own output directory and can be moved or installed independently.
  const portable = join(output, 'portable'); await mkdir(portable, { recursive: true });
  await rm(join(portable, 'Litespeed.app'), { recursive: true, force: true });
  await rename(app, join(portable, 'Litespeed.app'));
  console.log(`Desktop package ready: ${archive}`);
} finally { await rm(temporary, { recursive: true, force: true }); }
