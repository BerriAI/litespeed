import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { inspectGit, protectedPath, shellEnvironment } from './tools.js';
import type { PullRequestDetail, PullRequestFile, PullRequestFilter, PullRequestList, PullRequestSummary } from '../shared/pull-requests.js';

const exec = promisify(execFile);
const failure = (status: number, message: string) => Object.assign(new Error(message), { status });
const repositoryPattern = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}\/[a-zA-Z0-9_.-]{1,100}$/;
export function githubRepository(remote: string): string | null {
  let candidate: string | undefined;
  const ssh = /^git@github\.com:([^\s?#]+)$/.exec(remote);
  if (ssh) candidate = ssh[1];
  else {
    try {
      const url = new URL(remote);
      if (url.hostname.toLowerCase() !== 'github.com' || url.port || url.search || url.hash || !['https:', 'ssh:'].includes(url.protocol)) return null;
      if (url.password || (url.username && !(url.protocol === 'ssh:' && url.username === 'git'))) return null;
      candidate = url.pathname.slice(1);
    } catch { return null; }
  }
  candidate = candidate.replace(/\.git$/, '');
  return repositoryPattern.test(candidate) && !candidate.split('/').some(part => part === '.' || part === '..') ? candidate : null;
}
export interface PullRequestTransport { request(endpoint: string, signal?: AbortSignal): Promise<unknown> }
export class GithubCli implements PullRequestTransport {
  async request(endpoint: string, signal?: AbortSignal): Promise<unknown> {
    // Only this fixed host receives GitHub credentials. Never derive a host or command from a remote URL.
    if (!/^repos\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/pulls(?:[/?]|$)/.test(endpoint)) throw failure(400, 'Invalid pull request endpoint.');
    const env: NodeJS.ProcessEnv = { ...shellEnvironment(), GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1', GH_PAGER: 'cat', PAGER: 'cat', NO_COLOR: '1' };
    delete env.GH_DEBUG;
    try {
      const { stdout } = await exec('gh', ['api', '--hostname', 'github.com', '--method', 'GET', '-H', 'Accept: application/vnd.github+json', endpoint], { env, signal, timeout: 25_000, maxBuffer: 5 * 1024 * 1024, windowsHide: true });
      return JSON.parse(stdout);
    } catch (error) {
      if (signal?.aborted) throw failure(499, 'Pull request loading was canceled.');
      const code = (error as NodeJS.ErrnoException)?.code;
      const stderr = typeof (error as { stderr?: unknown })?.stderr === 'string' ? (error as { stderr: string }).stderr : '';
      if (code === 'ENOENT') throw failure(503, 'Install the GitHub CLI to view pull requests. Litespeed uses its existing sign-in.');
      if (/auth login|HTTP 401|authentication|GH_TOKEN/i.test(stderr)) throw failure(401, 'Sign in to GitHub with gh auth login, then refresh pull requests.');
      if (/HTTP 404/.test(stderr)) throw failure(404, 'This repository or pull request is unavailable to your GitHub account.');
      if (/HTTP 403|rate limit/i.test(stderr)) throw failure(403, 'GitHub could not grant this request. Check account access or try again after its request limit resets.');
      throw failure(502, 'GitHub could not load these pull requests. Check your connection and try again.');
    }
  }
}
const commit = z.string().regex(/^[a-f0-9]{40,64}$/);
const branch = z.object({ ref: z.string().max(1024), sha: commit });
const number = z.number().int().positive().max(2_147_483_647);
const count = z.number().int().nonnegative();
const pullSchema = z.object({
  number, title: z.string().max(4096), body: z.string().max(100_000).nullable().optional(),
  user: z.object({ login: z.string().max(200) }).nullable(), state: z.enum(['open', 'closed']),
  draft: z.boolean().optional(), merged_at: z.string().nullable().optional(), updated_at: z.string().datetime(),
  head: branch, base: branch, labels: z.array(z.object({ name: z.string().max(200), color: z.string().max(20) })).max(100),
  additions: count.optional(), deletions: count.optional(), changed_files: count.optional(), mergeable: z.boolean().nullable().optional(),
});
const fileSchema = z.object({ filename: z.string().min(1).max(4096), previous_filename: z.string().max(4096).optional(), status: z.string().max(30), additions: count, deletions: count, patch: z.string().optional() });
type Pull = z.infer<typeof pullSchema>;
const summarize = (pull: Pull, repository: string): PullRequestSummary => ({
  number: pull.number, title: pull.title, author: pull.user?.login ?? 'Deleted account', state: pull.merged_at ? 'merged' : pull.state,
  draft: pull.draft ?? false, url: `https://github.com/${repository}/pull/${pull.number}`, updatedAt: pull.updated_at,
  headBranch: pull.head.ref, baseBranch: pull.base.ref, labels: pull.labels.map(label => ({ ...label, color: /^[a-f0-9]{6}$/i.test(label.color) ? label.color : '888888' })),
});
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw failure(502, 'GitHub returned an incomplete pull request response. Refresh and try again.');
  return result.data;
}
export class PullRequests {
  constructor(private transport: PullRequestTransport = new GithubCli()) {}
  async repository(workspace: string, signal?: AbortSignal): Promise<Pick<PullRequestList, 'repository' | 'state'>> {
    const git = await inspectGit(workspace, signal);
    if (!git) return { state: 'not-repository', repository: null };
    const result = await git.run(['config', '--local', '--no-includes', '--get-regexp', '^remote\..*\.url$']);
    if (result.truncated || ![0, 1].includes(result.code ?? -1)) throw failure(400, 'The project’s Git remotes could not be read.');
    const remotes = result.output.split('\n').filter(Boolean).map(line => { const match = /^remote\.(.+)\.url\s+(.+)$/.exec(line); return { name: match?.[1] ?? '', repository: githubRepository(match?.[2] ?? '') }; });
    remotes.sort((a, b) => (a.name === 'origin' ? 0 : a.name === 'upstream' ? 1 : 2) - (b.name === 'origin' ? 0 : b.name === 'upstream' ? 1 : 2));
    const repository = remotes.find(remote => remote.repository)?.repository;
    return repository ? { state: 'ready', repository } : { state: remotes.length ? 'unsupported' : 'no-remote', repository: null };
  }
  async list(workspace: string, state: PullRequestFilter = 'open', page = 1, signal?: AbortSignal): Promise<PullRequestList> {
    z.enum(['open', 'closed', 'all']).parse(state); z.number().int().min(1).max(100).parse(page);
    const source = await this.repository(workspace, signal);
    if (!source.repository) return { ...source, requests: [], page, hasMore: false };
    const result = parse(z.array(pullSchema).max(50), await this.transport.request(`repos/${source.repository}/pulls?state=${state}&sort=updated&direction=desc&per_page=50&page=${page}`, signal));
    return { ...source, requests: result.map(pull => summarize(pull, source.repository!)), page, hasMore: result.length === 50 };
  }
  async detail(workspace: string, id: number, signal?: AbortSignal): Promise<PullRequestDetail> {
    number.parse(id);
    const source = await this.repository(workspace, signal);
    if (!source.repository) throw failure(400, 'Choose a project connected to a GitHub repository.');
    const repository = source.repository, endpoint = `repos/${repository}/pulls/${id}`;
    const first = parse(pullSchema, await this.transport.request(endpoint, signal));
    if (first.number !== id || first.changed_files === undefined || first.additions === undefined || first.deletions === undefined) throw failure(502, 'GitHub returned an incomplete pull request.');
    const files: PullRequestFile[] = []; let bytes = 0, limited = first.changed_files > 300;
    for (let page = 1; page <= Math.min(3, Math.ceil(first.changed_files / 100)); page++) {
      const entries = parse(z.array(fileSchema).max(100), await this.transport.request(`${endpoint}/files?per_page=100&page=${page}`, signal));
      for (const entry of entries) {
        const safe = (path: string) => !path.startsWith('/') && !/[\0\\]/.test(path) && !path.split('/').some(part => part === '..' || part.toLowerCase() === '.git') && !protectedPath(path);
        const file: PullRequestFile = { path: entry.filename, ...(entry.previous_filename ? { previousPath: entry.previous_filename } : {}), status: entry.status, additions: entry.additions, deletions: entry.deletions };
        if (!safe(entry.filename) || (entry.previous_filename && !safe(entry.previous_filename))) file.notice = 'Protected file contents are hidden.';
        else if (entry.patch === undefined) file.notice = 'No text patch supplied by GitHub. This may be a binary, empty, or large file.';
        else if (entry.patch.length > 120_000 || bytes + entry.patch.length > 1_000_000) file.notice = 'This patch is too large for the inline preview.';
        else {
          file.patch = entry.patch; bytes += entry.patch.length;
          const lines = entry.patch.split('\n');
          if (lines.filter(line => line.startsWith('+')).length !== entry.additions || lines.filter(line => line.startsWith('-')).length !== entry.deletions) {
            file.notice = 'GitHub supplied a partial patch for this file.'; limited = true;
          }
        }
        if (file.patch === undefined && (file.additions || file.deletions)) limited = true;
        files.push(file);
      }
      if (entries.length < 100) break;
    }
    if (new Set(files.map(file => file.path)).size !== files.length) throw failure(409, 'The pull request changed while loading. Refresh to see its latest changes.');
    if (files.length !== first.changed_files) limited = true;
    const last = parse(pullSchema, await this.transport.request(endpoint, signal));
    if (first.head.sha !== last.head.sha || first.base.sha !== last.base.sha || first.updated_at !== last.updated_at || first.changed_files !== last.changed_files) throw failure(409, 'The pull request changed while loading. Refresh to see its latest changes.');
    const revision = createHash('sha256').update(JSON.stringify({ ...summarize(first, repository), head: first.head.sha, base: first.base.sha, body: first.body, changedFiles: first.changed_files, additions: first.additions, deletions: first.deletions, files })).digest('hex');
    return { ...summarize(first, repository), repository, body: first.body ?? '', head: first.head.sha, base: first.base.sha, additions: first.additions, deletions: first.deletions, changedFiles: first.changed_files, mergeable: first.mergeable ?? null, files, limited, revision, capturedAt: new Date().toISOString() };
  }
}
