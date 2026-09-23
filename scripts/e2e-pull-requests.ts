import type { PullRequestTransport } from '../server/pull-requests.js';
import type { PullRequestFetcher } from '../server/pull-request-checkouts.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const exec = promisify(execFile);

export const pullRequestFixture = {
  number: 142, title: 'Keep the browser close to your work', user: { login: 'alex' }, state: 'open', draft: false,
  merged_at: null, updated_at: '2026-09-22T21:30:00Z',
  head: { ref: 'feature/persistent-browser', sha: 'a'.repeat(40) }, base: { ref: 'main', sha: 'b'.repeat(40) },
  labels: [{ name: 'desktop', color: '708d7b' }], additions: 19, deletions: 3, changed_files: 3, mergeable: true,
  body: '## A browser that stays with the task\n\nKeep tabs open beside the conversation, and restore them when you return. The page stays visible while Litespeed works.\n\n### What changed\n\n- Remember the active tab for each task\n- Restore saved tabs without loading them in the background\n- Fit the page to the available panel width\n\n### Checked\n\n- [x] Switching between tasks preserves the correct tab\n- [x] Keyboard navigation and narrow screens\n- [ ] Native desktop sign-in flow',
};
export const pullRequestFilesFixture = [
  { filename: 'client/src/Browser.tsx', status: 'modified', additions: 8, deletions: 2, patch: '@@ -24,5 +24,11 @@ export function Browser({ sessionId }: Props) {\n   const browser = useBrowser(sessionId);\n-  const activeTab = browser.tabs[0];\n+  const activeTab = browser.tabs.find(\n+    tab => tab.id === browser.activeTabId,\n+  );\n \n-  return <BrowserPage tab={activeTab} />;\n+  return (\n+    <BrowserPanel aria-label="Task browser">\n+      <BrowserPage tab={activeTab} />\n+    </BrowserPanel>\n+  );\n }' },
  { filename: 'server/browser.ts', status: 'modified', additions: 10, deletions: 1, patch: '@@ -80,3 +80,12 @@ async function restore(sessionId: string) {\n   const saved = await readTabs(sessionId);\n-  return openTabs(saved);\n+  return saved.map(tab => ({\n+    id: tab.id,\n+    title: tab.title,\n+    url: tab.url,\n+    suspended: true,\n+    viewport: {\n+      width: tab.viewport.width,\n+      height: tab.viewport.height,\n+    },\n+  }));\n }' },
  { filename: 'tests/browser.test.ts', previous_filename: 'tests/tabs.test.ts', status: 'renamed', additions: 1, deletions: 0, patch: '@@ -1,2 +1,3 @@\n import { describe, expect, it } from "vitest";\n+import { restore } from "../server/browser";\n ' },
];
export class PullRequestFixture implements PullRequestTransport {
  calls: string[] = [];
  constructor(public commits?: { head: string; base: string }) {}
  async request(endpoint: string) {
    this.calls.push(endpoint);
    if (!endpoint.startsWith('repos/fixture/desktop/pulls')) throw new Error('The pull request fixture has no data for this repository.');
    if (/\/files\?/.test(endpoint)) return structuredClone(pullRequestFilesFixture);
    const fixture = this.commits ? { ...pullRequestFixture, head: { ...pullRequestFixture.head, sha: this.commits.head }, base: { ...pullRequestFixture.base, sha: this.commits.base } } : pullRequestFixture;
    if (/\/pulls\/\d+$/.test(endpoint)) return structuredClone(fixture);
    const values = [fixture,
      { ...pullRequestFixture, number: 139, title: 'Make project setup feel effortless', user: { login: 'jordan' }, draft: true, head: { ...pullRequestFixture.head, ref: 'improve/project-setup' } },
      { ...pullRequestFixture, number: 136, title: 'Refine the file viewer and change summaries', user: { login: 'sam' }, head: { ...pullRequestFixture.head, ref: 'polish/file-viewer' } },
      { ...pullRequestFixture, number: 131, title: 'Bring settings into a simpler, quieter layout', user: { login: 'alex' }, state: 'closed', merged_at: '2026-09-21T18:20:00Z' },
    ];
    const state = new URL('https://fixture.local/' + endpoint).searchParams.get('state');
    return structuredClone(values.filter(pull => state === 'all' || pull.state === state));
  }
}

/** Disposable local Git source for integration tests. It never contacts GitHub. */
export async function createPullRequestSource(directory: string) {
  await mkdir(join(directory, 'client', 'src'), { recursive: true });
  const git = (...args: string[]) => exec('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: directory, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
  await git('init', '-b', 'main'); await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'fixture@local');
  await writeFile(join(directory, 'client', 'src', 'Browser.tsx'), 'export const browser = "First tab";\n'); await git('add', '.'); await git('commit', '-m', 'Initial browser');
  const base = (await git('rev-parse', 'HEAD')).stdout.trim();
  await writeFile(join(directory, 'client', 'src', 'Browser.tsx'), 'export const browser = "Persistent browser";\n');
  await writeFile(join(directory, '.gitattributes'), '*.tsx filter=checkout-test\n'); await git('add', '.'); await git('commit', '-m', 'Keep tabs with the task');
  const head = (await git('rev-parse', 'HEAD')).stdout.trim(); await git('update-ref', 'refs/pull/142/head', head);
  const fetcher: PullRequestFetcher = { async fetch(workspace, request, id, signal) {
    if (request.head !== head || request.base !== base || request.repository !== 'fixture/desktop') throw new Error('Unknown fixture checkout.');
    await exec('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=always', 'fetch', '--no-write-fetch-head', '--no-tags', directory, `${head}:refs/litespeed/pull-requests/${id}/head`, `${base}:refs/litespeed/pull-requests/${id}/base`], { cwd: workspace, signal });
  } };
  return { head, base, fetcher };
}
