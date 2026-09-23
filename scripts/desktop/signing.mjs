import { execFileSync } from 'node:child_process';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const runSigningTool = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 25 * 60 * 1000 });

export function signingConfiguration(env = process.env) {
  const identity = env.LITESPEED_SIGNING_IDENTITY?.trim(), profile = env.LITESPEED_NOTARY_PROFILE?.trim(), team = env.APPLE_TEAM_ID?.trim();
  if (!identity && !profile && !env.LITESPEED_SIGNING_KEYCHAIN && env.LITESPEED_NOTARIZE !== '1') return null;
  if (!identity || identity === '-' || !profile || !/^[A-Z0-9]{10}$/.test(team || '')) {
    throw new Error('Notarized builds require LITESPEED_SIGNING_IDENTITY, LITESPEED_NOTARY_PROFILE and a ten-character APPLE_TEAM_ID.');
  }
  return { identity, profile, team, keychain: env.LITESPEED_SIGNING_KEYCHAIN?.trim() };
}

// Sign nested code explicitly, from the inside out. --deep is for verification,
// not signing: it can miss the runtimes and native modules under Resources.
export async function signingTargets(app) {
  app = await realpath(app);
  const targets = [];
  async function visit(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name), info = await lstat(path);
      if (info.isSymbolicLink()) {
        const local = relative(app, await realpath(path));
        if (local === '..' || local.startsWith('../') || isAbsolute(local)) throw new Error('Signing refused a link outside the app.');
      } else if (info.isDirectory()) {
        await visit(path);
        if (/\.(app|framework|xpc|appex)$/.test(name)) targets.push({ path, executable: false });
      } else if (info.isFile()) {
        const file = await open(path, 'r'), bytes = Buffer.alloc(16);
        try { await file.read(bytes, 0, bytes.length, 0); } finally { await file.close(); }
        const magic = bytes.subarray(0, 4).toString('hex');
        if (['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe'].includes(magic)) {
          const type = magic.startsWith('feed') ? bytes.readUInt32BE(12) : bytes.readUInt32LE(12);
          if ([2, 6, 8].includes(type)) targets.push({ path, executable: type === 2 });
        } else if (['cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(magic)) {
          // Universal Mach-O files share a magic with Java class files. Confirm
          // their format with Apple's tool before treating them as native code.
          const kind = runSigningTool('/usr/bin/file', ['-b', path]);
          if (kind.includes('Mach-O')) targets.push({ path, executable: kind.includes('executable') });
        }
      } else throw new Error('Signing refused an unsupported file in the app.');
    }
  }
  await visit(app);
  targets.push({ path: app, executable: false });
  return targets;
}

export async function signDesktopApp(app, configuration, run = runSigningTool) {
  app = await realpath(app);
  const targets = await signingTargets(app);
  for (const target of targets) {
    const runtime = relative(app, target.path).startsWith('Contents/Resources/litespeed/');
    const jit = runtime && target.executable && /\/(?:node|bun|bunx)(?:\.exe)?$|\/chrome-headless-shell$/.test(target.path);
    run('/usr/bin/codesign', ['--force', '--sign', configuration.identity, '--timestamp', '--options', 'runtime',
      ...(configuration.keychain ? ['--keychain', configuration.keychain] : []),
      ...(jit ? ['--entitlements', join(here, 'runtime-entitlements.plist')] : []), target.path]);
    run('/usr/bin/codesign', ['--verify', '--strict', '-R', `anchor apple generic and certificate leaf[subject.OU] = "${configuration.team}" and certificate leaf[field.1.2.840.113635.100.6.1.13] exists`, target.path]);
  }
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  console.log(`Signed ${targets.length} native components and bundles with Developer ID.`);
}

export function notarize(archive, stapleTarget, configuration, run = runSigningTool) {
  const authentication = ['--keychain-profile', configuration.profile, ...(configuration.keychain ? ['--keychain', configuration.keychain] : [])];
  let submission;
  try {
    submission = JSON.parse(run('xcrun', ['notarytool', 'submit', resolve(archive), ...authentication, '--wait', '--timeout', '20m', '--output-format', 'json']));
  } catch (error) {
    // notarytool can return a nonzero exit status with a structured rejection.
    try { submission = JSON.parse(String(error.stdout)); } catch { throw new Error('Apple notarization did not complete. Check the notarytool credentials and submission history; no verified release was produced.'); }
  }
  if (submission.status !== 'Accepted') {
    if (typeof submission.id === 'string' && /^[a-f0-9-]{36}$/i.test(submission.id)) {
      console.error(run('xcrun', ['notarytool', 'log', submission.id, ...authentication]));
    }
    throw new Error(`Apple did not accept this package (${submission.status || 'unknown status'}).`);
  }
  run('xcrun', ['stapler', 'staple', resolve(stapleTarget)]);
  run('xcrun', ['stapler', 'validate', resolve(stapleTarget)]);
  console.log(`Apple notarization accepted and ticket attached: ${submission.id}`);
}

export function signDiskImage(disk, configuration, run = runSigningTool) {
  run('/usr/bin/codesign', ['--force', '--sign', configuration.identity, '--timestamp',
    ...(configuration.keychain ? ['--keychain', configuration.keychain] : []), disk]);
  run('/usr/bin/codesign', ['--verify', '--strict', disk]);
}
