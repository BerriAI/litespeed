import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GithubCli, PullRequests, githubRepository } from '../server/pull-requests.js';
import { pullRequestDiscussion } from '../shared/pull-requests.js';
import { pullRequestFixture, pullRequestFilesFixture } from '../scripts/e2e-pull-requests.js';

const exec = promisify(execFile);
describe('pull requests', () => {
  let root: string, calls: string[], changing: boolean;
  const git = (...args: string[]) => exec('git', args, { cwd: root });
  let metadata: typeof pullRequestFixture, files: typeof pullRequestFilesFixture;
  let service: PullRequests;
  beforeEach(async () => {
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1'); vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
    root = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-pr-'))); await git('init', '-b', 'main'); await git('remote', 'add', 'origin', 'git@github.com:fixture/desktop.git');
    calls = []; changing = false; metadata = structuredClone(pullRequestFixture); files = structuredClone(pullRequestFilesFixture);
    service = new PullRequests({ async request(endpoint) {
      calls.push(endpoint);
      if (endpoint.includes('/files?')) { if (changing) metadata.head.sha = 'c'.repeat(40); return structuredClone(files); }
      return endpoint.includes('/pulls?') ? [structuredClone(metadata)] : structuredClone(metadata);
    } });
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
  it('recognizes only explicit GitHub remotes without embedded credentials', () => {
    expect(githubRepository('git@github.com:example/project.git')).toBe('example/project');
    expect(githubRepository('https://github.com/example/project')).toBe('example/project');
    expect(githubRepository('ssh://git@github.com/example/project.git')).toBe('example/project');
    for (const remote of ['https://github.com.evil.test/a/b', 'https://token@github.com/a/b', 'https://github.com:443/a/b?token=secret', 'ssh://git@github.com:22/a/b', 'git@evil.test:a/b', 'https://github.com/a/../b', 'https://github.com/a/%2e%2e', 'file:///a/b', '/tmp/repository', '--upload-pack=bad']) expect(githubRepository(remote)).toBeNull();
  });
  it('uses an explicit repository and lists without touching Git state', async () => {
    const list = await service.list(root); expect(list).toMatchObject({ repository: 'fixture/desktop', state: 'ready', hasMore: false });
    expect(list.requests[0]).toMatchObject({ number: 142, url: 'https://github.com/fixture/desktop/pull/142', state: 'open' });
    expect(calls).toEqual(['repos/fixture/desktop/pulls?state=open&sort=updated&direction=desc&per_page=50&page=1']);
    expect((await git('symbolic-ref', '--short', 'HEAD')).stdout.trim()).toBe('main');
  });
  it('never calls GitHub for a local or unsupported repository', async () => {
    await git('remote', 'set-url', 'origin', 'https://enterprise.example/a/b.git');
    expect((await service.list(root)).state).toBe('unsupported'); expect(calls).toEqual([]);
    await git('remote', 'remove', 'origin'); expect((await service.list(root)).state).toBe('no-remote');
    await rm(join(root, '.git'), { recursive: true }); expect((await service.list(root)).state).toBe('not-repository');
  });
  it('captures consistent revisions and explicit snapshot context', async () => {
    const detail = await service.detail(root, 142); expect(detail.files).toHaveLength(3); expect(detail).toMatchObject({ head: 'a'.repeat(40), base: 'b'.repeat(40), limited: false });
    expect(calls.filter(call => call.endsWith('/142'))).toHaveLength(2);
    const draft = pullRequestDiscussion(detail); expect(draft.text).toContain('local project has not been checked out'); expect(draft.attachments[0].content).toContain('Head commit: ' + 'a'.repeat(40)); expect(draft.attachments[0].content).toContain('BrowserPanel');
  });
  it('rejects a head change while files are being loaded', async () => {
    changing = true; await expect(service.detail(root, 142)).rejects.toThrow('changed while loading');
  });
  it('hides credential changes and makes incomplete reviews explicit', async () => {
    files[0].filename = '.env'; files[0].patch = '+SECRET_FIXTURE';
    const detail = await service.detail(root, 142); expect(detail.files[0].patch).toBeUndefined(); expect(detail.files[0].notice).toContain('Protected'); expect(detail.limited).toBe(true);
    expect(JSON.stringify(detail)).not.toContain('SECRET_FIXTURE'); expect(pullRequestDiscussion(detail).text).toContain('incomplete');
  });
  it('does not expose a protected file through a rename', async () => {
    files[2].previous_filename = '.env'; files[2].patch = '+SECRET_FIXTURE';
    const detail = await service.detail(root, 142); expect(detail.files[2].patch).toBeUndefined(); expect(JSON.stringify(detail)).not.toContain('SECRET_FIXTURE');
  });
  it('detects absent, shortened and oversized patches', async () => {
    files[0].patch = '@@ -1,1 +1,1 @@\n+partial'; files[1].patch = 'x'.repeat(120_001); delete (files[2] as { patch?: string }).patch;
    const detail = await service.detail(root, 142); expect(detail.limited).toBe(true); expect(detail.files[0].notice).toContain('partial'); expect(detail.files[1].patch).toBeUndefined(); expect(detail.files[2].notice).toContain('No text patch');
  });
  it('rejects malformed responses without exposing their content', async () => {
    metadata.head.sha = 'SECRET_BAD_VALUE'; await expect(service.detail(root, 142)).rejects.toThrow('incomplete pull request response');
    await expect(service.detail(root, 142)).rejects.not.toThrow('SECRET_BAD_VALUE');
  });
  it('limits oversized discussions and labels them incomplete', async () => {
    const detail = await service.detail(root, 142); detail.body = 'x'.repeat(190_000); const draft = pullRequestDiscussion(detail);
    expect(draft.attachments[0].content.length).toBeLessThan(200_000); expect(draft.text).toContain('incomplete');
  });
  it('validates pagination before issuing remote requests', async () => {
    await expect(service.list(root, 'open', 0)).rejects.toThrow(); await expect(service.list(root, 'open', 101)).rejects.toThrow(); expect(calls).toEqual([]);
    await expect(new GithubCli().request('https://evil.test')).rejects.toThrow('Invalid pull request endpoint');
  });
});
