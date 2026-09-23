// Credentials are read only by the explicitly enabled, trusted release job.
// Never log child-process errors: they can include secret command arguments.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const run = (command, args, label) => {
  try { return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }); }
  catch { throw new Error(label); }
};
async function cleanup(keychain) {
  const root = resolve(process.env.RUNNER_TEMP || '.');
  if (!keychain || dirname(dirname(keychain)) !== root || !dirname(keychain).startsWith(join(root, 'litespeed-signing-'))) throw new Error('Refusing to clean an unexpected signing directory.');
  try { run('security', ['delete-keychain', keychain], 'Could not delete the temporary signing keychain.'); }
  finally { await rm(dirname(keychain), { recursive: true, force: true }); }
}
async function prepare() {
  if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.RUNNER_TEMP || !process.env.GITHUB_ENV) throw new Error('This setup is only for GitHub Actions. Use an existing Keychain profile for local builds.');
  for (const name of ['APPLE_DEVELOPER_ID_P12_BASE64', 'APPLE_DEVELOPER_ID_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_NOTARY_KEY_ID', 'APPLE_NOTARY_ISSUER_ID', 'APPLE_NOTARY_KEY_P8_BASE64']) {
    if (!process.env[name]?.trim()) throw new Error(`Missing GitHub Actions secret: ${name}`);
  }
  if (!/^[A-Z0-9]{10}$/.test(process.env.APPLE_TEAM_ID)) throw new Error('APPLE_TEAM_ID must contain ten uppercase letters or digits.');
  const directory = await mkdtemp(join(resolve(process.env.RUNNER_TEMP), 'litespeed-signing-'));
  await mkdir(directory, { mode: 0o700, recursive: true });
  const keychain = join(directory, 'release.keychain-db'), certificate = join(directory, 'certificate.p12'), key = join(directory, 'AuthKey.p8');
  try {
    await writeFile(certificate, Buffer.from(process.env.APPLE_DEVELOPER_ID_P12_BASE64, 'base64'), { mode: 0o600 });
    await writeFile(key, Buffer.from(process.env.APPLE_NOTARY_KEY_P8_BASE64, 'base64'), { mode: 0o600 });
    const password = randomBytes(32).toString('hex');
    run('security', ['create-keychain', '-p', password, keychain], 'Could not create the temporary signing keychain.');
    run('security', ['set-keychain-settings', '-lut', '21600', keychain], 'Could not configure the temporary signing keychain.');
    run('security', ['unlock-keychain', '-p', password, keychain], 'Could not unlock the temporary signing keychain.');
    run('security', ['import', certificate, '-k', keychain, '-P', process.env.APPLE_DEVELOPER_ID_PASSWORD, '-T', '/usr/bin/codesign'], 'Could not import the Developer ID certificate. Check its export password.');
    run('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain], 'Could not grant the signing tool access to the certificate.');
    const identities = run('security', ['find-identity', '-v', '-p', 'codesigning', keychain], 'Could not inspect the imported signing identity.');
    const matches = [...identities.matchAll(new RegExp(`([A-Fa-f0-9]{40}) "Developer ID Application: [^"\\n]+\\(${process.env.APPLE_TEAM_ID}\\)"`, 'g'))];
    if (matches.length !== 1) throw new Error('Import exactly one valid Developer ID Application certificate for APPLE_TEAM_ID, including its private key.');
    const profile = 'litespeed-release';
    run('xcrun', ['notarytool', 'store-credentials', profile, '--key', key, '--key-id', process.env.APPLE_NOTARY_KEY_ID, '--issuer', process.env.APPLE_NOTARY_ISSUER_ID, '--keychain', keychain], 'Could not validate the Apple notarization API key. Check its team, permissions, key ID and issuer.');
    await rm(certificate); await rm(key);
    await appendFile(process.env.GITHUB_ENV, `LITESPEED_SIGNING_KEYCHAIN=${keychain}\nLITESPEED_SIGNING_IDENTITY=${matches[0][1]}\nLITESPEED_NOTARY_PROFILE=${profile}\nAPPLE_TEAM_ID=${process.env.APPLE_TEAM_ID}\n`);
    console.log('Developer ID and notarization credentials are ready in a temporary keychain.');
  } catch (error) {
    await cleanup(keychain).catch(() => {});
    throw error;
  }
}
try {
  if (process.argv[2] === 'cleanup') await cleanup(process.env.LITESPEED_SIGNING_KEYCHAIN);
  else await prepare();
} catch (error) { console.error(error.message); process.exitCode = 1; }
