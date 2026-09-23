import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store.js';
import { PullRequests } from '../server/pull-requests.js';
import { GithubPullRequestFetcher, PullRequestCheckouts, type PullRequestFetcher } from '../server/pull-request-checkouts.js';
import { createPullRequestSource, PullRequestFixture } from '../scripts/e2e-pull-requests.js';

const exec = promisify(execFile);
describe('isolated pull request checkouts', () => {
  let root: string, project: string, source: string, store: Store, transport: PullRequestFixture, requests: PullRequests, checkouts: PullRequestCheckouts, fetcher: PullRequestFetcher;
  let commits: { head: string; base: string };
  const git = (...args: string[]) => exec('git', args, { cwd: project });
  const prepare = async () => checkouts.prepare(project, 142, (await requests.detail(project, 142)).revision);
  beforeEach(async () => {
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1'); vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
    root = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-pr-checkout-'))); project = join(root, 'original'); source = join(root, 'remote');
    const fixture = await createPullRequestSource(source); commits = fixture; fetcher = fixture.fetcher;
    await exec('git', ['clone', '--quiet', source, project]); await git('reset', '--hard', commits.base); await git('remote', 'set-url', 'origin', 'https://github.com/fixture/desktop.git');
    await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'fixture@local');
    store = new Store(join(root, 'state')); transport = new PullRequestFixture(commits); requests = new PullRequests(transport); checkouts = new PullRequestCheckouts(store, requests, fetcher);
  });
  afterEach(async () => { store.close(); await rm(root, { recursive: true, force: true }); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  it('creates the reviewed PR head with its base available, preserving the original branch, staged content and local edits', async () => {
    const file = join(project, 'client', 'src', 'Browser.tsx'); await writeFile(file, 'Staged changes'); await git('add', '.'); await writeFile(file, 'Local changes'); await writeFile(join(project, 'notes.md'), 'Keep these notes');
    const index = await readFile(join(project, '.git', 'index')), status = (await git('status', '--porcelain=v1')).stdout;
    const plan = await prepare(); expect(plan).toMatchObject({ head: commits.head, sourceBranch: 'feature/persistent-browser', changedFiles: 2, pullRequest: { number: 142, base: commits.base } });
    const { worktree } = await checkouts.create(project, 142, plan.id);
    expect(worktree.status).toBe('ready'); expect(await readFile(join(worktree.path, 'client', 'src', 'Browser.tsx'), 'utf8')).toContain('Persistent browser');
    expect((await exec('git', ['rev-parse', 'HEAD'], { cwd: worktree.path })).stdout.trim()).toBe(commits.head);
    expect((await exec('git', ['merge-base', commits.head, commits.base], { cwd: worktree.path })).stdout.trim()).toBe(commits.base);
    expect(await readFile(file, 'utf8')).toBe('Local changes'); expect(await readFile(join(project, '.git', 'index'))).toEqual(index);
    expect((await git('status', '--porcelain=v1')).stdout).toBe(status); expect((await git('symbolic-ref', '--short', 'HEAD')).stdout.trim()).toBe('main');
    await expect(checkouts.create(project, 142, plan.id)).rejects.toThrow('expired');
    expect(store.createSession({ workspace: worktree.path }).worktree?.pullRequest?.number).toBe(142);
  });
  it('does not run configured smudge, process or checkout hooks when checking out PR files', async () => {
    const smudge = join(root, 'smudge-ran'), process = join(root, 'process-ran'), hook = join(root, 'hook-ran');
    await git('config', 'filter.checkout-test.smudge', `touch '${smudge}'; cat`); await git('config', 'filter.checkout-test.process', `touch '${process}'; exit 1`); await git('config', 'filter.checkout-test.required', 'true');
    await writeFile(join(project, '.git', 'hooks', 'post-checkout'), `#!/bin/sh\ntouch '${hook}'\n`, { mode: 0o755 });
    const { worktree } = await checkouts.create(project, 142, (await prepare()).id);
    expect(await readFile(join(worktree.path, 'client', 'src', 'Browser.tsx'), 'utf8')).toContain('Persistent browser');
    for (const path of [smudge, process, hook]) await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('requires the same PR version before preparing and again before downloading', async () => {
    await expect(checkouts.prepare(project, 142, '0'.repeat(64))).rejects.toThrow('changed since');
    const plan = await prepare(), spy = vi.spyOn(fetcher, 'fetch'); transport.commits = { ...commits, head: 'c'.repeat(40) };
    await expect(checkouts.create(project, 142, plan.id)).rejects.toThrow('changed after'); expect(spy).not.toHaveBeenCalled(); expect(store.worktrees.list()).toEqual([]);
  });
  it('rejects foreign projects, PR numbers, expired reviews and bypass through the generic worktree action', async () => {
    const plan = await prepare(); await expect(checkouts.create(root, 142, plan.id)).rejects.toThrow('expired'); await expect(checkouts.create(project, 143, plan.id)).rejects.toThrow('expired');
    await expect(store.worktrees.create(project, plan.id)).rejects.toThrow('pull request checkout action');
    const next = await prepare(); vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600_001); await expect(checkouts.create(project, 142, next.id)).rejects.toThrow('expired');
    expect(store.worktrees.list()).toEqual([]);
  });
  it('retains an interrupted download record without creating a task, branch or changing original files', async () => {
    vi.spyOn(fetcher, 'fetch').mockRejectedValue(new Error('Fixture download failed'));
    const plan = await prepare(); await expect(checkouts.create(project, 142, plan.id)).rejects.toThrow('download failed');
    expect(store.worktrees.get(plan.id)).toMatchObject({ status: 'error', head: commits.head }); expect(store.sessions()).toEqual([]);
    expect((await git('branch', '--list', plan.branch)).stdout).toBe(''); expect((await git('rev-parse', 'HEAD')).stdout.trim()).toBe(commits.base);
    await expect(readFile(join(plan.path, '.git'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await store.worktrees.recover(plan.id)).status).toBe('removed'); expect(store.worktrees.list()).toEqual([]);
  });
  it('rechecks the original project after downloading and rejects a changed branch', async () => {
    const original = fetcher.fetch.bind(fetcher); vi.spyOn(fetcher, 'fetch').mockImplementation(async (...args) => { await original(...args); await git('switch', '-c', 'changed-externally'); });
    const plan = await prepare(); await expect(checkouts.create(project, 142, plan.id)).rejects.toThrow('changed while downloading'); expect(store.worktrees.get(plan.id).status).toBe('error');
  });
  it('supports an unborn local project without switching its branch or adding an index', async () => {
    await rm(join(project, '.git'), { recursive: true }); await git('init', '-b', 'local'); await git('remote', 'add', 'origin', 'https://github.com/fixture/desktop.git');
    const result = await checkouts.create(project, 142, (await prepare()).id); expect(result.worktree.head).toBe(commits.head);
    expect((await git('symbolic-ref', '--short', 'HEAD')).stdout.trim()).toBe('local'); await expect(readFile(join(project, '.git', 'index'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  async function useLocalTransport() {
    const bin = join(root, 'bin'), log = join(root, 'network-arguments.json'); await mkdir(bin);
    const realGit = (await exec('which', ['git'])).stdout.trim();
    await writeFile(join(bin, 'git'), `#!${process.execPath}\nconst {execFileSync}=require('node:child_process');const {writeFileSync}=require('node:fs');let args=process.argv.slice(2);const url='https://github.com/fixture/desktop.git';if(args.includes(url)){writeFileSync(${JSON.stringify(log)},JSON.stringify({args,global:process.env.GIT_CONFIG_GLOBAL,system:process.env.GIT_CONFIG_NOSYSTEM,host:process.env.GH_HOST,debug:process.env.GH_DEBUG}));args=args.map(arg=>arg===url?${JSON.stringify(source)}:arg);args.unshift('-c','protocol.file.allow=always');}try{const out=execFileSync(${JSON.stringify(realGit)},args,{stdio:['ignore','pipe','pipe']});process.stdout.write(out);}catch(e){process.stderr.write(e.stderr||'Git fixture failed');process.exit(e.status||1);}\n`, { mode: 0o755 });
    vi.stubEnv('PATH', bin + ':' + process.env.PATH); vi.stubEnv('GH_DEBUG', 'api'); vi.stubEnv('GH_HOST', 'example.invalid');
    return log;
  }
  it('downloads through the fixed GitHub transport, verifies commits, imports private refs and removes temporary data', async () => {
    const log = await useLocalTransport(), detail = await requests.detail(project, 142), id = crypto.randomUUID();
    await new GithubPullRequestFetcher(store.directory).fetch(project, detail, id);
    const call = JSON.parse(await readFile(log, 'utf8'));
    expect(call).toMatchObject({ global: '/dev/null', system: '1', host: 'github.com' }); expect(call.debug).toBeUndefined();
    expect(call.args).toEqual(expect.arrayContaining(['credential.helper=', 'credential.https://github.com.helper=!gh auth git-credential', 'protocol.allow=never', 'http.followRedirects=false', 'fetch.fsckObjects=true', 'https://github.com/fixture/desktop.git', 'refs/pull/142/head:refs/litespeed/source/head', `${commits.base}:refs/litespeed/source/base`]));
    expect((await git('rev-parse', `refs/litespeed/pull-requests/${id}/head`)).stdout.trim()).toBe(commits.head);
    expect((await git('rev-parse', `refs/litespeed/pull-requests/${id}/base`)).stdout.trim()).toBe(commits.base);
    expect(await readdir(join(store.directory, 'worktree-fetches'))).toEqual([]); await expect(readFile(join(project, '.git', 'FETCH_HEAD'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects a head moved during transport before importing any refs', async () => {
    await useLocalTransport(); const detail = await requests.detail(project, 142), id = crypto.randomUUID();
    await exec('git', ['update-ref', 'refs/pull/142/head', commits.base], { cwd: source });
    await expect(new GithubPullRequestFetcher(store.directory).fetch(project, detail, id)).rejects.toThrow('changed while downloading');
    expect((await git('for-each-ref', `refs/litespeed/pull-requests/${id}`)).stdout).toBe(''); expect(await readdir(join(store.directory, 'worktree-fetches'))).toEqual([]);
  });
});
