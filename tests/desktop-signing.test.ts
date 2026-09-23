import { afterEach, describe, expect, it, vi } from 'vitest';
import { cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { notarize, signDesktopApp, signingConfiguration, signingTargets } from '../scripts/desktop/signing.mjs';

const folders: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(folders.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const configuration = { identity: 'Developer ID Application: Fixture (ABCDEFGHIJ)', team: 'ABCDEFGHIJ', profile: 'fixture-notary', keychain: '/tmp/fixture.keychain-db' };
const submissionId = '66fa52cd-d17b-4452-ab0f-75921a71b752';

describe('desktop signing release policy', () => {
  it('keeps local previews explicit and refuses incomplete or ad hoc public release configuration', () => {
    expect(signingConfiguration({})).toBeNull();
    for (const env of [{ LITESPEED_NOTARIZE: '1' }, { LITESPEED_SIGNING_IDENTITY: '-' }, { LITESPEED_NOTARY_PROFILE: 'partial' }, { LITESPEED_SIGNING_KEYCHAIN: '/tmp/partial' }]) {
      expect(() => signingConfiguration(env)).toThrow('Notarized builds require');
    }
    const complete = { LITESPEED_SIGNING_IDENTITY: configuration.identity, LITESPEED_NOTARY_PROFILE: configuration.profile, APPLE_TEAM_ID: configuration.team };
    expect(signingConfiguration(complete)).toMatchObject(configurationWithoutKeychain());
    expect(() => signingConfiguration({ ...complete, APPLE_TEAM_ID: 'wrong' })).toThrow();
  });
  it('does not start credential setup without explicit GitHub credentials', () => {
    expect(() => execFileSync(process.execPath, ['scripts/desktop/ci-signing.mjs'], { env: { PATH: process.env.PATH }, stdio: 'pipe' })).toThrow('This setup is only for GitHub Actions');
  });
});
function configurationWithoutKeychain() { const { keychain: _, ...rest } = configuration; return rest; }

describe('Apple notarization outcomes', () => {
  it('attaches and validates the ticket only after Apple accepts the submission', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const run = vi.fn((command: string, args: string[]) => args[0] === 'notarytool' ? JSON.stringify({ id: submissionId, status: 'Accepted' }) : '');
    notarize('/tmp/app.zip', '/tmp/Litespeed.app', configuration, run);
    expect(run.mock.calls.map(([, args]) => args.slice(0, 2))).toEqual([['notarytool', 'submit'], ['stapler', 'staple'], ['stapler', 'validate']]);
    expect(run.mock.calls[0][1]).toEqual(expect.arrayContaining(['--keychain-profile', configuration.profile, '--keychain', configuration.keychain]));
    expect(run.mock.calls[1][1].at(-1)).toBe('/tmp/Litespeed.app');
  });
  it.each(['Invalid', 'In Progress', 'Rejected'])('refuses %s submissions without attaching a ticket', status => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const run = vi.fn((_command: string, args: string[]) => args[1] === 'log' ? 'Apple rejection details' : JSON.stringify({ id: submissionId, status }));
    expect(() => notarize('/tmp/app.zip', '/tmp/Litespeed.app', configuration, run)).toThrow('Apple did not accept');
    expect(run.mock.calls.some(([, args]) => args[0] === 'stapler')).toBe(false);
  });
  it('retains an actionable rejection when notarytool exits with an error and JSON output', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const run = vi.fn((_command: string, args: string[]) => {
      if (args[1] === 'submit') throw Object.assign(new Error('notarytool failed'), { stdout: JSON.stringify({ id: submissionId, status: 'Invalid' }) });
      return 'Apple rejection details';
    });
    expect(() => notarize('/tmp/app.zip', '/tmp/Litespeed.app', configuration, run)).toThrow('Apple did not accept');
    expect(run.mock.calls.some(([, args]) => args[0] === 'stapler')).toBe(false);
  });
  it('does not turn a timeout or a failed ticket validation into success', () => {
    expect(() => notarize('/tmp/app.zip', '/tmp/Litespeed.app', configuration, () => { throw new Error('timeout'); })).toThrow('did not complete');
    const run = (_command: string, args: string[]) => {
      if (args[0] === 'notarytool') return JSON.stringify({ id: submissionId, status: 'Accepted' });
      if (args[1] === 'validate') throw new Error('No valid ticket');
      return '';
    };
    expect(() => notarize('/tmp/app.zip', '/tmp/Litespeed.app', configuration, run)).toThrow('No valid ticket');
  });
});

describe.skipIf(process.platform !== 'darwin')('native signing discovery', () => {
  async function fixture() {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-signing-test-'))); folders.push(directory);
    const app = join(directory, 'App with spaces.app'), main = join(app, 'Contents/MacOS/Litespeed');
    const runtime = join(app, 'Contents/Resources/litespeed/runtime'), helper = join(runtime, 'helper-with-no-extension'), node = join(runtime, 'node');
    await mkdir(join(app, 'Contents/MacOS'), { recursive: true }); await mkdir(runtime, { recursive: true });
    await cp('/usr/bin/true', main); await cp('/usr/bin/true', helper); await cp('/usr/bin/true', node); await writeFile(join(runtime, 'README'), 'not native code');
    await symlink('helper-with-no-extension', join(runtime, 'alias'));
    return { app, main, helper, runtime, node };
  }
  it('finds real binaries under Resources by format, signs aliases once, and signs the outer app last', async () => {
    const { app, main, helper, node } = await fixture();
    const targets = await signingTargets(app);
    expect(targets).toEqual([{ path: main, executable: true }, { path: helper, executable: true }, { path: node, executable: true }, { path: app, executable: false }]);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const run = vi.fn(() => '');
    await signDesktopApp(app, configuration, run);
    const calls = run.mock.calls as unknown as Array<[string, string[]]>;
    const signing = calls.filter(([, args]) => args.includes('--sign'));
    expect(signing.map(([, args]) => args.at(-1))).toEqual([main, helper, node, app]);
    expect(signing[0][1]).not.toContain('--entitlements');
    expect(signing[1][1]).not.toContain('--entitlements');
    expect(signing[2][1]).toContain('--entitlements');
    expect(signing[3][1]).not.toContain('--entitlements');
    expect(signing.every(([, args]) => args.includes('--timestamp') && args.includes('runtime') && !args.includes('--deep'))).toBe(true);
  });
  it('refuses external links before signing any component', async () => {
    const { app, runtime } = await fixture(); await symlink('/usr/bin/true', join(runtime, 'outside'));
    const run = vi.fn(() => '');
    await expect(signDesktopApp(app, configuration, run)).rejects.toThrow('outside the app');
    expect(run).not.toHaveBeenCalled();
  });
});
