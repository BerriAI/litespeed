import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { link, lstat, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store.js';
import { captureProjectGuidance, readFile as readProjectFile } from '../server/tools.js';
import { applyWorktreeSetup, captureWorktreeSetup } from '../server/worktree-setup.js';
import { protectStateDirectory } from '../server/state-paths.js';

const exec = promisify(execFile);
describe('reviewed local worktree setup files', () => {
  let root: string, project: string, store: Store;
  const git = (...args: string[]) => exec('git', args, { cwd: project });
  const plan = () => store.worktrees.prepare(project, 'Local setup', undefined, undefined, false, true);
  const create = async () => store.worktrees.create(project, (await plan()).id);
  beforeEach(async () => {
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1'); vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
    root = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-worktree-setup-'))); project = join(root, 'project'); await mkdir(project);
    await git('init', '-b', 'main'); await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'fixture@local');
    await writeFile(join(project, 'notes.md'), 'Initial notes'); await writeFile(join(project, '.gitignore'), '.env*\nconfig/local/\nAGENTS.override.md\n*.pem\nlinks/\nprivate-state/\n');
    await git('add', '.'); await git('commit', '-m', 'Initial'); store = new Store(join(root, 'state'));
  });
  afterEach(async () => { store.close(); await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
  it('uses Git ignore patterns and negation, copies only ignored files, and never returns private contents in the plan', async () => {
    await writeFile(join(project, '.worktreeinclude'), '# Local setup\n.env\nconfig/local/**\n!config/local/skip.json\npublic.txt\n');
    await writeFile(join(project, '.env'), 'SYNTHETIC_PRIVATE_VALUE=fixture-only\n'); await mkdir(join(project, 'config', 'local'), { recursive: true });
    await writeFile(join(project, 'config', 'local', 'options.json'), '{"fixture":true}'); await writeFile(join(project, 'config', 'local', 'skip.json'), 'Not selected');
    await writeFile(join(project, 'AGENTS.override.md'), 'Local project instructions'); await writeFile(join(project, 'public.txt'), 'Not ignored');
    const reviewed = await plan(); expect(reviewed.localSetup?.files.map(file => file.path)).toEqual(['.env', 'AGENTS.override.md', 'config/local/options.json']);
    expect(JSON.stringify(reviewed)).not.toContain('SYNTHETIC_PRIVATE_VALUE'); expect(JSON.stringify(reviewed)).not.toContain('Local project instructions');
    const result = await store.worktrees.create(project, reviewed.id);
    expect(await readFile(join(result.path, '.env'), 'utf8')).toBe('SYNTHETIC_PRIVATE_VALUE=fixture-only\n'); expect((await lstat(join(result.path, '.env'))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(result.path, 'AGENTS.override.md'), 'utf8')).toBe('Local project instructions');
    expect(captureProjectGuidance(result.path)).toContain('Local project instructions');
    await expect(readFile(join(result.path, 'config', 'local', 'skip.json'))).rejects.toMatchObject({ code: 'ENOENT' }); await expect(readFile(join(result.path, 'public.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readProjectFile(result.path, '.env')).rejects.toThrow('Protected');
    expect(await readFile(join(project, '.env'), 'utf8')).toBe('SYNTHETIC_PRIVATE_VALUE=fixture-only\n');
  });
  it('does not copy setup by default and handles a missing rule file with only the ignored override eligible', async () => {
    await writeFile(join(project, '.env'), 'fixture-only'); await writeFile(join(project, 'AGENTS.override.md'), 'Local override');
    const regular = await store.worktrees.create(project, (await store.worktrees.prepare(project, 'Default')).id);
    await expect(readFile(join(regular.path, '.env'))).rejects.toMatchObject({ code: 'ENOENT' }); await expect(readFile(join(regular.path, 'AGENTS.override.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    const reviewed = await plan(); expect(reviewed.localSetup).toMatchObject({ hasRules: false, files: [{ path: 'AGENTS.override.md' }] });
    const result = await store.worktrees.create(project, reviewed.id); expect(await readFile(join(result.path, 'AGENTS.override.md'), 'utf8')).toBe('Local override');
    await expect(readFile(join(result.path, '.env'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('lists linked, hard-linked and restricted files as skipped without exposing their bytes', async () => {
    await writeFile(join(project, '.worktreeinclude'), '.env*\n*.pem\nlinks/**\nprivate-state/**\n');
    await writeFile(join(root, 'outside'), 'Outside fixture'); await symlink(join(root, 'outside'), join(project, '.env.link')); await link(join(root, 'outside'), join(project, '.env.hard'));
    await writeFile(join(project, 'private-key.pem'), 'Private fixture'); await mkdir(join(project, 'private-state')); await writeFile(join(project, 'private-state', 'settings.json'), 'State fixture');
    const release = protectStateDirectory(join(project, 'private-state'));
    try {
      const reviewed = await plan(); expect(reviewed.localSetup?.files).toEqual([]); expect(reviewed.localSetup?.skipped).toHaveLength(4);
      expect(JSON.stringify(reviewed)).not.toMatch(/Outside fixture|Private fixture|State fixture/);
      const result = await store.worktrees.create(project, reviewed.id); await expect(readFile(join(result.path, '.env.link'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(join(root, 'outside'), 'utf8')).toBe('Outside fixture');
    } finally { release(); }
  });
  it('rejects changed setup bytes, matching files and patterns before creation', async () => {
    await writeFile(join(project, '.worktreeinclude'), '.env*\n'); await writeFile(join(project, '.env'), 'Reviewed');
    for (const mutate of [async () => writeFile(join(project, '.env'), 'Changed'), async () => writeFile(join(project, '.env.local'), 'Another file'), async () => writeFile(join(project, '.worktreeinclude'), '.env\n')]) {
      const reviewed = await plan(); await mutate(); await expect(store.worktrees.create(project, reviewed.id)).rejects.toThrow('changed after review'); expect(store.worktrees.list()).toHaveLength(0);
    }
  });
  it('does not overwrite files from the starting commit, even after source staging removed them', async () => {
    await writeFile(join(project, '.env'), 'Committed fixture'); await git('add', '-f', '.env'); await git('commit', '-m', 'Committed fixture'); await git('rm', '--cached', '.env');
    await writeFile(join(project, '.env'), 'Local replacement'); await writeFile(join(project, '.worktreeinclude'), '.env\n');
    const reviewed = await plan(); expect(reviewed.localSetup?.files).toEqual([]); expect(reviewed.localSetup?.skipped).toEqual([{ path: '.env', reason: 'Already in starting commit' }]);
    const result = await store.worktrees.create(project, reviewed.id); expect(await readFile(join(result.path, '.env'), 'utf8')).toBe('Committed fixture'); expect(await readFile(join(project, '.env'), 'utf8')).toBe('Local replacement');
  });
  it('refuses changed destination files and directory links without overwriting them', async () => {
    await writeFile(join(project, '.worktreeinclude'), '.env\n'); await writeFile(join(project, '.env'), 'Reviewed');
    const snapshot = await captureWorktreeSetup(project, (await git('rev-parse', 'HEAD')).stdout.trim()), target = await store.worktrees.create(project, (await store.worktrees.prepare(project, 'Target')).id);
    await writeFile(join(target.path, '.env'), 'Existing target'); await expect(applyWorktreeSetup(target.path, snapshot)).rejects.toThrow('already exists'); expect(await readFile(join(target.path, '.env'), 'utf8')).toBe('Existing target');
    await rm(join(target.path, '.env')); await symlink(join(root, 'outside'), join(target.path, '.env')); await expect(applyWorktreeSetup(target.path, snapshot)).rejects.toThrow('regular files');
    await expect(readFile(join(root, 'outside'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('validates rule text and file limits without creating a working copy', async () => {
    await writeFile(join(project, '.worktreeinclude'), Buffer.from([0xff, 0])); await expect(create()).rejects.toThrow('UTF-8');
    await writeFile(join(project, '.worktreeinclude'), 'x'.repeat(33 * 1024)); await expect(create()).rejects.toThrow('setup-file limit');
    await writeFile(join(project, '.worktreeinclude'), '.env\n'); await writeFile(join(project, '.env'), Buffer.alloc(8 * 1024 * 1024 + 1)); await expect(create()).rejects.toThrow('setup-file limit');
    expect(store.worktrees.list()).toHaveLength(0);
  });
  it('requires setup files to remain ignored in the new copy and can carry the needed local ignore edits', async () => {
    await writeFile(join(project, '.worktreeinclude'), 'local-settings.json\n');
    await writeFile(join(project, '.gitignore'), (await readFile(join(project, '.gitignore'), 'utf8')) + 'local-settings.json\n');
    await writeFile(join(project, 'local-settings.json'), 'Local-only configuration');
    await expect(create()).rejects.toThrow('not ignored'); expect(store.worktrees.list()[0].status).toBe('error');
    const reviewed = await store.worktrees.prepare(project, 'Include configuration', undefined, undefined, true, true), result = await store.worktrees.create(project, reviewed.id);
    expect(await readFile(join(result.path, 'local-settings.json'), 'utf8')).toBe('Local-only configuration');
    expect((await exec('git', ['status', '--porcelain=v1'], { cwd: result.path })).stdout).not.toContain('local-settings.json');
  });
  it('uses a valid root override in place of AGENTS.md and falls back when the override is empty or unsafe', async () => {
    await writeFile(join(project, 'AGENTS.md'), 'Shared project guidance'); await writeFile(join(project, 'LITESPEED.md'), 'Additional Litespeed guidance');
    await writeFile(join(project, 'AGENTS.override.md'), 'Local override guidance');
    const guidance = captureProjectGuidance(project); expect(guidance).toContain('Local override guidance'); expect(guidance).not.toContain('Shared project guidance'); expect(guidance).toContain('Additional Litespeed guidance');
    await writeFile(join(project, 'AGENTS.override.md'), '  \n'); expect(captureProjectGuidance(project)).toContain('Shared project guidance');
    await rm(join(project, 'AGENTS.override.md')); await symlink(join(project, 'LITESPEED.md'), join(project, 'AGENTS.override.md')); expect(captureProjectGuidance(project)).toContain('Shared project guidance');
  });
});
