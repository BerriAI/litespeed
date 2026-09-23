import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, realpath, mkdir, rm, writeFile, symlink, readFile as readRaw } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Store } from '../server/store.js';
import { assertReadablePath, executeTool, inspectToolPath, listFiles, readFile, searchFiles, type ToolContext } from '../server/tools.js';
import { gitReview, gitFileDiff } from '../server/git-review.js';
import { GitActions } from '../server/git-actions.js';
import { allowStateWorkspace } from '../server/state-paths.js';
import { filePreview, readPreviewAsset } from '../server/file-preview.js';

const exec = promisify(execFile);
describe('application state outside the project dotfolder', () => {
  let root: string, state: string, store: Store;
  const context = (workspace = root): ToolContext => ({ workspace, sessionId: 'test', signal: new AbortController().signal, onChange: () => {}, onTodos: () => {}, getTodos: () => [] });
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-state-access-')));
    state = join(root, 'Library', 'Application Support', 'Litespeed');
    store = new Store(state);
    await writeFile(join(state, 'subscription-auth.json'), 'SYNTHETIC_PRIVATE_STATE');
    await writeFile(join(root, 'notes.txt'), 'ordinary project content');
  });
  afterEach(async () => { store.close(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

  it('blocks direct reads, attachments and edits from an ancestor or the state root itself', async () => {
    for (const workspace of [root, state]) {
      await expect(readFile(workspace, join(state, 'subscription-auth.json'))).rejects.toThrow('Protected');
      await expect(assertReadablePath(workspace, join(state, 'subscription-auth.json'))).rejects.toThrow('Protected');
      await expect(filePreview(workspace, join(state, 'subscription-auth.json'))).rejects.toThrow('Protected');
      await expect(readPreviewAsset(workspace, join(state, 'subscription-auth.json'))).rejects.toThrow('Protected');
      await expect(executeTool('write_file', { path: join(state, 'new', 'credentials.json'), content: 'replacement' }, context(workspace))).rejects.toThrow('Protected');
      await expect(executeTool('edit_file', { path: join(state, 'subscription-auth.json'), old_string: 'SYNTHETIC_PRIVATE_STATE', new_string: 'replacement' }, context(workspace))).rejects.toThrow('Protected');
    }
    expect(await readRaw(join(state, 'subscription-auth.json'), 'utf8')).toBe('SYNTHETIC_PRIVATE_STATE');
    expect((await readFile(root, 'notes.txt')).content).toBe('ordinary project content');
  });

  it('omits state files from browsing, filename search, glob and text search', async () => {
    expect(await listFiles(state)).toEqual([]);
    expect(await listFiles(root, 'Library/Application Support')).toEqual([]);
    expect(await searchFiles(root, '')).toEqual(['notes.txt']);
    expect(await executeTool('glob', { pattern: '**/*' }, context())).toBe('notes.txt');
    expect(await executeTool('grep', { pattern: 'SYNTHETIC' }, context())).not.toContain('SYNTHETIC_PRIVATE_STATE');
  });

  it('rejects file and project aliases before an external permission grant', async () => {
    await symlink(state, join(root, 'saved'));
    await symlink(join(state, 'subscription-auth.json'), join(root, 'alias.json'));
    await expect(readFile(root, 'alias.json')).rejects.toThrow('Protected');
    await expect(readFile(join(root, 'saved'), 'subscription-auth.json')).rejects.toThrow('Protected');
    await mkdir(join(root, 'project'));
    await expect(inspectToolPath(join(root, 'project'), 'read_file', { path: join(state, 'subscription-auth.json') })).rejects.toThrow('Protected');
    expect((await listFiles(root)).map(entry => entry.name)).not.toContain('saved');
  });

  it('protects a configured location before it exists without matching sibling names', async () => {
    vi.stubEnv('LITESPEED_DATA_DIR', join(root, 'new-state'));
    await expect(executeTool('write_file', { path: 'new-state/auth.json', content: 'invalid' }, context())).rejects.toThrow('Protected');
    await executeTool('write_file', { path: 'new-state-project/file.txt', content: 'safe' }, context());
    expect(await readRaw(join(root, 'new-state-project/file.txt'), 'utf8')).toBe('safe');
  });

  it('retains the explicit project instructions exception with a default store', async () => {
    const projectStore = new Store(join(root, '.litespeed'));
    try {
      await writeFile(join(root, '.litespeed/instructions.md'), 'Project instructions');
      expect((await readFile(root, '.litespeed/instructions.md')).content).toBe('Project instructions');
      await expect(readFile(root, '.litespeed/litespeed.db')).rejects.toThrow('Protected');
    } finally { projectStore.close(); }
  });

  it('allows a host-created working copy only within its own workspace boundary', async () => {
    const worker = join(state, 'workers', 'batch', 'copy');
    await mkdir(worker, { recursive: true });
    await writeFile(join(worker, 'source.ts'), 'const original = true;');
    const release = allowStateWorkspace(worker);
    try {
      await executeTool('write_file', { path: join(worker, 'source.ts'), content: 'const changed = true;' }, context(worker));
      expect((await readFile(worker, 'source.ts')).content).toBe('const changed = true;');
      await expect(readFile(root, join(worker, 'source.ts'))).rejects.toThrow('Protected');
      await expect(inspectToolPath(worker, 'read_file', { path: join(state, 'subscription-auth.json') })).rejects.toThrow('Protected');
      await expect(inspectToolPath(worker, 'write_file', { path: join(state, 'workers', 'other', 'source.ts') })).rejects.toThrow('Protected');
    } finally { release(); }
    await expect(readFile(worker, 'source.ts')).rejects.toThrow('Protected');
  });

  it('excludes private state from Git comparisons and rejects staging or committing it', async () => {
    const git = (...args: string[]) => exec('git', args, { cwd: root, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
    await git('init', '-b', 'main');
    const privatePath = 'Library/Application Support/Litespeed/subscription-auth.json';
    expect((await gitReview(root, 'unstaged')).files.map(file => file.path)).toEqual(['notes.txt']);
    await expect(gitFileDiff(root, 'unstaged', privatePath)).rejects.toThrow('regular project file');
    const actions = new GitActions();
    await expect(actions.prepare(root, 'stage', [privatePath])).rejects.toThrow('regular project files');
    await git('add', '--', privatePath);
    expect((await gitReview(root, 'staged')).files).toEqual([]);
    await expect(gitFileDiff(root, 'staged', privatePath)).rejects.toThrow('regular project file');
    await expect(actions.prepare(root, 'commit')).rejects.toThrow('protected files');
  });
});
