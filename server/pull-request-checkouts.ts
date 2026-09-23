import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Store } from './store.js';
import { PullRequests } from './pull-requests.js';
import { inspectGit, operateGit, shellEnvironment } from './tools.js';
import type { PullRequestDetail } from '../shared/pull-requests.js';
import type { WorktreePlan } from '../shared/worktrees.js';

const exec = promisify(execFile);
const fail = (message: string, status = 409) => Object.assign(new Error(message), { status });
export interface PullRequestFetcher { fetch(workspace: string, request: PullRequestDetail, id: string, signal?: AbortSignal): Promise<void> }

/** GitHub credentials are offered only to one fixed HTTPS host, from an empty
 * temporary repository. The selected project never controls the network URL,
 * helper, proxy configuration, redirects or Git upload-pack command. */
export class GithubPullRequestFetcher implements PullRequestFetcher {
  constructor(private directory: string) {}
  async fetch(workspace: string, request: PullRequestDetail, id: string, signal?: AbortSignal) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}\/[a-zA-Z0-9_.-]{1,100}$/.test(request.repository) || request.repository.split('/').some(part => part === '.' || part === '..') || !Number.isSafeInteger(request.number) || request.number < 1 || !/^[a-f0-9]{40,64}$/.test(request.head) || !/^[a-f0-9]{40,64}$/.test(request.base) || !/^[a-f0-9-]{36}$/.test(id)) throw fail('Invalid pull request checkout.', 400);
    const root = join(await realpath(this.directory), 'worktree-fetches'); await mkdir(root, { recursive: true, mode: 0o700 });
    if (await realpath(root) !== root) throw fail('The pull request download directory must not be linked.');
    const scratch = await mkdtemp(join(root, 'pull-'));
    const env = Object.fromEntries(Object.entries(shellEnvironment()).filter(([key]) => !key.startsWith('GIT_') && !['GH_DEBUG', 'GH_HOST'].includes(key)));
    Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1', GCM_INTERACTIVE: 'Never' });
    const run = (args: string[]) => exec('git', args, { cwd: scratch, env, signal, timeout: 120_000, maxBuffer: 1024 * 1024, windowsHide: true });
    try {
      await run(['init', '--bare', '--quiet', '.']);
      await run(['-c', 'credential.helper=', '-c', 'credential.https://github.com.helper=!gh auth git-credential', '-c', 'credential.interactive=false', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'http.followRedirects=false', '-c', 'fetch.fsckObjects=true', '-c', 'gc.auto=0', 'fetch', '--quiet', '--no-tags', '--no-recurse-submodules', `https://github.com/${request.repository}.git`, `refs/pull/${request.number}/head:refs/litespeed/source/head`, `${request.base}:refs/litespeed/source/base`]);
      const [head, base] = await Promise.all([run(['rev-parse', '--verify', 'refs/litespeed/source/head^{commit}']), run(['rev-parse', '--verify', 'refs/litespeed/source/base^{commit}'])]);
      if (head.stdout.trim() !== request.head || base.stdout.trim() !== request.base) throw fail('The pull request changed while downloading. Refresh and review its latest version.');
      // Import only verified commits through local file transport. Do not write
      // FETCH_HEAD, tags, remote branches, credentials or the source index.
      const result = await operateGit(workspace, ['-c', 'protocol.allow=never', '-c', 'protocol.file.allow=always', '-c', `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`, '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'fetch.writeCommitGraph=false', 'fetch', '--quiet', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', '--upload-pack=git-upload-pack', scratch, `refs/litespeed/source/head:refs/litespeed/pull-requests/${id}/head`, `refs/litespeed/source/base:refs/litespeed/pull-requests/${id}/base`], signal, { isolatedCheckout: true });
      if (result.code !== 0) throw fail('The verified pull request commits could not be added to this project. Refresh and try again.');
      const git = await inspectGit(workspace, signal); if (!git) throw fail('The original project is no longer available.');
      for (const [part, sha] of [['head', request.head], ['base', request.base]]) {
        const result = await git.run(['rev-parse', '--verify', `refs/litespeed/pull-requests/${id}/${part}^{commit}`]);
        if (result.code !== 0 || result.output.trim() !== sha) throw fail('The downloaded pull request commits could not be verified in this project.');
      }
    } catch (error) {
      if (signal?.aborted) throw fail('Pull request checkout stopped. Any retained working copy is listed under Working copies.');
      if (error instanceof Error && 'status' in error) throw error;
      throw fail('Could not download this pull request. Check your GitHub CLI sign-in and connection, then refresh its changes.', 502);
    } finally { await rm(scratch, { recursive: true, force: true }); }
  }
}

export class PullRequestCheckouts {
  private plans = new Map<string, { workspace: string; request: PullRequestDetail; expiresAt: number }>();
  constructor(private store: Store, private requests: PullRequests, private fetcher: PullRequestFetcher = new GithubPullRequestFetcher(store.directory)) {}
  async prepare(workspace: string, number: number, revision: string, signal?: AbortSignal): Promise<WorktreePlan> {
    const request = await this.requests.detail(workspace, number, signal);
    if (request.revision !== revision) throw fail('The pull request changed since you opened it. Refresh before reviewing a checkout.');
    const plan = await this.store.worktrees.prepare(workspace, `PR-${request.number}`, signal, { head: request.head, branch: request.headBranch, pullRequest: { number: request.number, repository: request.repository, url: request.url, title: request.title, base: request.base } });
    for (const [id, plan] of this.plans) if (plan.expiresAt < Date.now()) this.plans.delete(id);
    while (this.plans.size >= 100) this.plans.delete(this.plans.keys().next().value!);
    this.plans.set(plan.id, { workspace, request, expiresAt: plan.expiresAt }); return plan;
  }
  async create(workspace: string, number: number, id: string, signal?: AbortSignal) {
    const saved = this.plans.get(id);
    if (!saved || saved.workspace !== workspace || saved.request.number !== number || saved.expiresAt < Date.now()) throw fail('This pull request checkout review expired. Review it again before continuing.');
    this.plans.delete(id);
    const current = await this.requests.detail(workspace, number, signal);
    if (current.revision !== saved.request.revision) throw fail('The pull request changed after review. Refresh before opening its working copy.');
    const worktree = await this.store.worktrees.create(workspace, id, signal, plan => this.fetcher.fetch(workspace, saved.request, plan.id, signal));
    return { worktree, request: saved.request };
  }
}
