import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Check, ChevronDown, FileDiff, Folder, GitBranch, GitFork, GitMerge, GitPullRequest, GitPullRequestClosed, MessageSquare, RefreshCw, Search, WrapText, X } from 'lucide-react';
import type { PullRequestDetail, PullRequestFilter, PullRequestList, PullRequestSummary } from '../../shared/pull-requests';
import type { WorktreePlan } from '../../shared/worktrees';
import { api, errorMessage, post, query } from './api';
import { Markdown } from './Conversation';
import { EmptyState, LiteSpeed, Modal } from './ui';
import { WorktreeLocation } from './Worktrees';
import { navigateTabs } from './tab-navigation';
import { highlightedLines } from './syntax';

function readPullRequestRoute() {
  const match = /^#pull-requests\/project\/([^/]+)(?:\/pull\/(\d+))?(?:\/session\/|$)/.exec(window.location.hash);
  try {
    const project = match ? decodeURIComponent(match[1]) : undefined, number = match?.[2] ? Number(match[2]) : null;
    return { project: project && project.length <= 4096 ? project : undefined, number: number && Number.isSafeInteger(number) && number <= 2_147_483_647 ? number : null };
  } catch { return { project: undefined, number: null }; }
}
function pullRequestRoute(project: string, number: number | null, replace = false) {
  const session = window.location.hash.match(/\/session\/[\w-]+$/)?.[0] ?? '';
  const url = `#pull-requests/project/${encodeURIComponent(project)}${number ? `/pull/${number}` : ''}${session}`;
  window.history[replace ? 'replaceState' : 'pushState'](number ? { pullRequestDetailFromList: true } : null, '', url);
}
const folder = (path: string) => path.split('/').filter(Boolean).at(-1) || path;
const stateLabel = (pull: PullRequestSummary) => pull.draft && pull.state === 'open' ? 'Draft' : pull.state === 'merged' ? 'Merged' : pull.state === 'closed' ? 'Closed' : 'Open';
function StateIcon({ pull, size = 18 }: { pull: PullRequestSummary; size?: number }) {
  const Icon = pull.state === 'merged' ? GitMerge : pull.state === 'closed' ? GitPullRequestClosed : GitPullRequest;
  return <Icon size={size} className={`pr-state-icon ${pull.draft ? 'draft' : pull.state}`} />;
}
function updated(value: string) {
  const days = Math.floor(Math.max(0, Date.now() - Date.parse(value)) / 86_400_000);
  return days === 0 ? 'Updated today' : days === 1 ? 'Updated yesterday' : days < 7 ? `Updated ${days} days ago` : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));
}
export function PullRequests({ workspace, projects, onDiscuss, onReview, onProject }: {
  workspace: string; projects: string[]; onDiscuss: (request: PullRequestDetail, workspace: string) => Promise<void>; onReview: (number: number, workspace: string, planId: string) => Promise<void>; onProject: () => void;
}) {
  const [project, setProject] = useState(() => readPullRequestRoute().project ?? workspace), [filter, setFilter] = useState<PullRequestFilter>('open');
  const [search, setSearch] = useState(''), [data, setData] = useState<PullRequestList | null>(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [selected, setSelected] = useState<number | null>(() => readPullRequestRoute().number), [refresh, setRefresh] = useState(0);
  const requestRef = useRef<AbortController | null>(null), rowRef = useRef<number | null>(readPullRequestRoute().number);
  const load = useCallback(async (page = 1) => {
    requestRef.current?.abort(); const controller = new AbortController(); requestRef.current = controller;
    setBusy(true); setError('');
    try {
      const result = await api<PullRequestList>(`/pull-requests?${query({ workspace: project, state: filter, page: String(page) })}`, { signal: controller.signal });
      if (!controller.signal.aborted) setData(previous => page === 1 ? result : { ...result, requests: [...(previous?.requests ?? []), ...result.requests].filter((pull, index, all) => all.findIndex(other => other.number === pull.number) === index) });
    } catch (e) { if (!controller.signal.aborted) setError(errorMessage(e)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }, [project, filter]);
  useEffect(() => { setData(null); void load(); return () => requestRef.current?.abort(); }, [load, refresh]);
  useEffect(() => {
    const pop = () => { const route = readPullRequestRoute(); setProject(route.project ?? workspace); setSelected(route.number); };
    window.addEventListener('popstate', pop); window.addEventListener('hashchange', pop); return () => { window.removeEventListener('popstate', pop); window.removeEventListener('hashchange', pop); };
  }, [workspace]);
  useEffect(() => { if (selected === null && rowRef.current) document.getElementById(`pull-request-${rowRef.current}`)?.focus(); }, [selected]);
  if (selected !== null) return <PullRequestView key={`${project}:${selected}`} workspace={project} number={selected} onBack={() => { if (window.history.state?.pullRequestDetailFromList) window.history.back(); else { pullRequestRoute(project, null, true); setSelected(null); } }} onDiscuss={onDiscuss} onReview={onReview} />;
  const requests = data?.requests.filter(pull => `${pull.title} ${pull.number} ${pull.author} ${pull.headBranch}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  return <section className="catalog-page pull-requests-page" aria-label="Pull requests">
    <header className="catalog-heading"><div><h1>Pull requests</h1><p>Follow the changes. Start a thoughtful review.</p></div><div className="pr-project-actions"><label className="pr-project-picker"><Folder size={14} /><select aria-label="Pull request project" value={project} onChange={event => { pullRequestRoute(event.target.value, null); setProject(event.target.value); setSearch(''); }}>{[...new Set([project, ...projects])].map(path => <option value={path} key={path}>{folder(path)}</option>)}</select><ChevronDown size={12} /></label><button className="icon-button" aria-label="Refresh pull requests" title="Refresh pull requests" disabled={busy} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} className={busy ? 'spin' : ''} /></button></div></header>
    <div className="catalog-controls"><div className="catalog-tabs" role="tablist" aria-label="Pull request views" onKeyDown={navigateTabs}>{([{ id: 'open', label: 'Open' }, { id: 'closed', label: 'Closed' }, { id: 'all', label: 'All' }] as const).map(item => <button key={item.id} role="tab" aria-selected={filter === item.id} tabIndex={filter === item.id ? 0 : -1} onClick={() => { setFilter(item.id); setSearch(''); }}>{item.label}</button>)}</div><label className="catalog-search"><Search size={15} /><input aria-label="Filter loaded pull requests" placeholder="Filter pull requests…" value={search} onChange={e => setSearch(e.target.value)} />{search && <button aria-label="Clear pull request filter" onClick={() => setSearch('')}><X size={13} /></button>}</label></div>
    {error && <div className="inline-alert" role="alert">{error}<button className="text-button" onClick={() => void load()}>Try again</button></div>}
    {!data && busy ? <div className="panel-loading"><LiteSpeed compact active />Loading pull requests…</div> : data && <div role="tabpanel" aria-label={`${filter === 'all' ? 'All' : filter === 'open' ? 'Open' : 'Closed'} pull requests`}>
      {data.state !== 'ready' ? <EmptyState icon={<GitPullRequest size={32} />} title={data.state === 'not-repository' ? 'Choose a Git project' : data.state === 'no-remote' ? 'Connect this project to GitHub' : 'GitHub projects are supported'}>{data.state === 'not-repository' ? 'Open a project with a GitHub repository to see its pull requests.' : data.state === 'no-remote' ? 'Add a GitHub remote to this project, then refresh.' : 'Choose a project with a github.com remote. Your GitHub CLI sign-in is used automatically.'}<button className="button secondary" onClick={onProject}><Folder size={14} />Choose project</button></EmptyState> : <>
        <div className="pr-list-heading"><span>{data.repository}</span><span>{data.requests.length}{data.hasMore ? '+' : ''} {filter === 'all' ? 'pull requests' : filter}</span></div>
        {requests.length ? <div className="pr-list">{requests.map(pull => <button id={`pull-request-${pull.number}`} className="pr-row" key={pull.number} onClick={() => { rowRef.current = pull.number; pullRequestRoute(project, pull.number); setSelected(pull.number); }}><StateIcon pull={pull} /><span className="pr-row-content"><span className="pr-row-title">{pull.title}{pull.draft && <span className="pr-draft-badge">Draft</span>}</span><span className="pr-row-meta">#{pull.number}<span>·</span>{pull.author}<span>·</span><time dateTime={pull.updatedAt}>{updated(pull.updatedAt)}</time></span></span><ArrowUpRight size={15} className="pr-row-arrow" /></button>)}</div> : <EmptyState icon={<GitPullRequest size={30} />} title={search ? 'No matching pull requests' : 'You’re all caught up'}>{search ? 'Try another filter or load more pull requests.' : `No ${filter === 'all' ? '' : filter + ' '}pull requests in this repository.`}</EmptyState>}
        {data.hasMore && <div className="pr-load-more"><button className="button secondary" disabled={busy} onClick={() => void load(data.page + 1)}>{busy ? 'Loading…' : 'Load more pull requests'}</button>{search && <span>Filtering the {data.requests.length} loaded pull requests.</span>}</div>}
      </>}
    </div>}
  </section>;
}
function PullRequestView({ workspace, number, onBack, onDiscuss, onReview }: { workspace: string; number: number; onBack: () => void; onDiscuss: (request: PullRequestDetail, workspace: string) => Promise<void>; onReview: (number: number, workspace: string, planId: string) => Promise<void> }) {
  const [detail, setDetail] = useState<PullRequestDetail | null>(null), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const [tab, setTab] = useState<'overview' | 'files'>('overview'), [file, setFile] = useState(''), [wrap, setWrap] = useState(false), [discussing, setDiscussing] = useState(false);
  const alive = useRef(true), operation = useRef(false), heading = useRef<HTMLHeadingElement>(null), diff = useRef<HTMLDivElement>(null);
  const [checkout, setCheckout] = useState<WorktreePlan | null>(null), [checkoutPhase, setCheckoutPhase] = useState<'prepare' | 'create' | null>(null), [checkoutError, setCheckoutError] = useState('');
  const checkoutBusy = checkoutPhase !== null;
  const checkoutTrigger = useRef<HTMLButtonElement>(null), checkoutConfirm = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (checkout && !checkoutBusy) checkoutConfirm.current?.focus(); }, [checkout, checkoutBusy, checkoutError]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setError(''); setDetail(null);
    api<PullRequestDetail>(`/pull-requests/${number}?${query({ workspace })}`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) { setDetail(value); setFile(current => value.files.some(file => file.path === current) ? current : value.files[0]?.path ?? ''); } }).catch(e => { if (!controller.signal.aborted) setError(errorMessage(e)); });
    return () => controller.abort();
  }, [workspace, number, refresh]);
  useEffect(() => { if (!checkout) heading.current?.focus(); }, [detail]);
  useEffect(() => { diff.current?.scrollTo({ top: 0, left: 0 }); }, [file]);
  const selected = detail?.files.find(entry => entry.path === file);
  async function discuss() {
    if (!detail || operation.current) return; operation.current = true; setDiscussing(true); setError('');
    try { await onDiscuss(detail, workspace); } catch (e) { if (alive.current) setError(errorMessage(e)); }
    finally { operation.current = false; if (alive.current) setDiscussing(false); }
  }
  async function prepareCheckout(refreshVersion = false) {
    if (!detail || operation.current) return; operation.current = true; setCheckoutPhase('prepare'); setError(''); setCheckoutError('');
    try {
      const current = refreshVersion ? await api<PullRequestDetail>(`/pull-requests/${number}?${query({ workspace })}`) : detail;
      const plan = await post<WorktreePlan>(`/pull-requests/${number}/worktree/prepare`, { workspace, revision: current.revision });
      if (alive.current) { setDetail(current); setFile(file => current.files.some(entry => entry.path === file) ? file : current.files[0]?.path ?? ''); setCheckout(plan); }
    }
    catch (e) { if (alive.current) { if (checkout) setCheckoutError(errorMessage(e)); else setError(errorMessage(e)); } }
    finally { operation.current = false; if (alive.current) setCheckoutPhase(null); }
  }
  async function createCheckout() {
    if (!checkout || operation.current) return; operation.current = true; setCheckoutPhase('create'); setCheckoutError('');
    try { await onReview(number, workspace, checkout.id); }
    catch (e) { if (alive.current) setCheckoutError(errorMessage(e)); }
    finally { operation.current = false; if (alive.current) setCheckoutPhase(null); }
  }
  function closeCheckout() { if (checkoutBusy) return; setCheckout(null); setCheckoutError(''); requestAnimationFrame(() => checkoutTrigger.current?.focus()); }
  return <section className="catalog-page pr-detail-page" aria-label={`Pull request ${number}`}>
    <div className="pr-detail-top"><button className="text-button" onClick={onBack}><ArrowLeft size={14} />Pull requests</button><button className="icon-button" aria-label="Refresh pull request" disabled={!detail && !error || discussing || checkoutBusy} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15} /></button></div>
    {error && <div className="inline-alert" role="alert">{error}<button className="text-button" onClick={() => setRefresh(value => value + 1)}>Try again</button></div>}
    {!detail ? !error && <div className="panel-loading"><LiteSpeed compact active />Loading changes…</div> : <>
      <header className="pr-detail-heading"><div className="pr-repository">{detail.repository}<span>#{detail.number}</span></div><h1 ref={heading} tabIndex={-1}>{detail.title}</h1><div className="pr-detail-meta"><span className={`pr-state-badge ${detail.draft ? 'draft' : detail.state}`}><StateIcon pull={detail} size={14} />{stateLabel(detail)}</span><span>{detail.author}</span><span className="pr-branch"><GitBranch size={12} /><span title={detail.headBranch}>{detail.headBranch}</span><ArrowLeft size={11} className="pr-branch-arrow" /><span title={detail.baseBranch}>{detail.baseBranch}</span></span></div></header>
      <div className="pr-detail-actions"><button ref={checkoutTrigger} className="button primary" disabled={discussing || checkoutBusy} onClick={() => void prepareCheckout()}><GitFork size={14} />{checkoutBusy && !checkout ? 'Preparing review…' : 'Review in worktree'}</button><button className="button secondary" disabled={discussing || checkoutBusy} onClick={() => void discuss()}><MessageSquare size={14} />{discussing ? 'Preparing draft…' : 'Discuss changes'}</button><a className="button secondary" href={detail.url} target="_blank" rel="noopener noreferrer">Open in GitHub<ArrowUpRight size={14} /></a><span className="pr-change-count"><span className="pr-additions">+{detail.additions.toLocaleString()}</span><span className="pr-deletions">−{detail.deletions.toLocaleString()}</span></span></div>
      <div className="catalog-controls pr-detail-tabs"><div className="catalog-tabs" role="tablist" aria-label="Pull request details" onKeyDown={navigateTabs}><button role="tab" aria-selected={tab === 'overview'} tabIndex={tab === 'overview' ? 0 : -1} onClick={() => setTab('overview')}>Overview</button><button role="tab" aria-selected={tab === 'files'} tabIndex={tab === 'files' ? 0 : -1} onClick={() => setTab('files')}>Files changed<span className="pr-count">{detail.changedFiles}</span></button></div><span className="pr-commit" title={`Head commit ${detail.head}`}>{detail.head.slice(0, 7)}</span></div>
      {tab === 'overview' ? <div role="tabpanel" aria-label="Pull request overview" className="pr-overview"><div className="pr-description markdown">{detail.body ? <Markdown content={detail.body} /> : <p className="pr-no-description">No description provided.</p>}</div><div className="pr-review-note"><MessageSquare size={17} /><div><strong>A little room for a closer look</strong><p>Review in worktree opens the full project at this version in a separate working copy. Discuss changes starts with a snapshot of the changes.</p><span>Both open an editable draft. Your current branch and local work stay in place.</span></div></div></div> : <div role="tabpanel" aria-label="Pull request files" className="pr-files-view">
        {detail.limited && <div className="pr-limited-note">Some changes are too large or unavailable for an inline preview. Open in GitHub to see the full change set.</div>}
        {detail.files.length ? <div className="pr-files-layout"><nav className="pr-file-list" aria-label="Changed pull request files">{detail.files.map(entry => <button key={entry.path} className={file === entry.path ? 'selected' : ''} aria-current={file === entry.path ? 'true' : undefined} title={entry.path} onClick={() => setFile(entry.path)}><FileDiff size={14} /><span>{entry.path}</span><small><i className="pr-additions">+{entry.additions}</i><i className="pr-deletions">−{entry.deletions}</i></small></button>)}</nav><div className="pr-diff-panel"><div className="pr-diff-heading"><span title={selected?.path}>{selected?.path}</span><button className={`icon-button ${wrap ? 'selected' : ''}`} aria-label="Wrap pull request diff" aria-pressed={wrap} onClick={() => setWrap(value => !value)}><WrapText size={15} /></button></div>{selected?.patch !== undefined && selected.notice && <div className="pr-rename">{selected.notice}</div>}{selected?.previousPath && <div className="pr-rename">Renamed from {selected.previousPath}</div>}<div className={`pr-diff-scroll ${wrap ? 'wrap' : ''}`} ref={diff} tabIndex={0} aria-label={`Changes in ${selected?.path}`}>{selected?.patch !== undefined ? <PatchView patch={selected.patch} path={selected.path} /> : <div className="pr-patch-notice"><FileDiff size={24} /><p>{selected?.notice}</p></div>}</div></div></div> : <EmptyState icon={<Check size={28} />} title="No file changes">This pull request has no changed files.</EmptyState>}
      </div>}
    </>}
    {checkout && <Modal title="Review in a worktree?" onClose={closeCheckout}><div className="worktrees-dialog pr-checkout-dialog" aria-busy={checkoutBusy}>
      <div className="worktrees-project"><GitPullRequest size={14} /><span>{checkout.pullRequest?.repository} · #{number}</span></div>
      <p className="worktrees-intro">Open the full project in a separate working copy, with a review draft ready for you.</p>
      <dl className="worktree-plan">
        <div><dt>Pull request</dt><dd>{checkout.pullRequest?.title}</dd></div>
        <div><dt>Head</dt><dd><GitBranch size={14} /><span title={checkout.sourceBranch ?? ''}>{checkout.sourceBranch}</span><code title={checkout.head}>{checkout.head.slice(0, 7)}</code></dd></div>
        <div><dt>Base</dt><dd><code title={checkout.pullRequest?.base}>{checkout.pullRequest?.base.slice(0, 7)}</code></dd></div>
        <div><dt>New branch</dt><dd>{checkout.branch}</dd></div>
        <div><dt>Folder</dt><dd><WorktreeLocation path={checkout.path} /></dd></div>
      </dl>
      <p className="worktrees-note">Your current branch{checkout.changedFiles ? ` and ${checkout.changedFiles} changed ${checkout.changedFiles === 1 ? 'file stay' : 'files stay'}` : ' stays'} in the local project. The new task starts in Plan mode and asks before running project code.</p>
      {checkoutError && <div className="inline-alert" role="alert">{checkoutError}</div>}
      <div className="worktrees-actions"><button className="text-button" disabled={checkoutBusy} onClick={closeCheckout}>Cancel</button>{checkoutError ? <button data-autofocus ref={checkoutConfirm} className="button primary" onClick={() => void prepareCheckout(true)}><RefreshCw size={14} />Refresh review</button> : <button data-autofocus ref={checkoutConfirm} className="button primary" disabled={checkoutBusy} onClick={() => void createCheckout()}><GitFork size={14} />{checkoutPhase === 'prepare' ? 'Refreshing…' : checkoutBusy ? 'Opening worktree…' : 'Open review task'}</button>}</div>
      {checkoutBusy && <p className="pr-checkout-progress" role="status">{checkoutPhase === 'prepare' ? 'Checking the latest version…' : 'Downloading and verifying the reviewed commits…'}</p>}
    </div></Modal>}
  </section>;
}
function PatchView({ patch, path }: { patch: string; path: string }) {
  const allLines = useMemo(() => patch.replace(/\n$/, '').split('\n'), [patch]);
  const lines = useMemo(() => allLines.slice(0, 10_000), [allLines]);
  const highlighted = useMemo(() => highlightedLines(lines.map(line => line.startsWith('@@') || line.startsWith('\\') ? '' : line.slice(1)).join('\n'), path), [lines, path]);
  let before = 0, after = 0;
  return <><pre className="pr-patch">{lines.map((text, index) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) { before = Number(hunk[1]); after = Number(hunk[2]); return <span className="pr-patch-line hunk" key={index}><span className="pr-patch-number" /><span className="pr-patch-number" /><code>{text}</code></span>; }
    const kind = text.startsWith('+') ? 'added' : text.startsWith('-') ? 'removed' : text.startsWith('\\') ? 'notice' : 'context';
    const oldLine = kind === 'added' || kind === 'notice' ? '' : before++, newLine = kind === 'removed' || kind === 'notice' ? '' : after++;
    return <span className={`pr-patch-line ${kind}`} key={index}><span className="pr-patch-number" aria-hidden="true">{oldLine}</span><span className="pr-patch-number" aria-hidden="true">{newLine}</span><code>{text.slice(0, 1)}<span dangerouslySetInnerHTML={{ __html: kind === 'notice' ? '' : highlighted[index] || '&nbsp;' }} />{kind === 'notice' ? text.slice(1) : ''}</code></span>;
  })}</pre>{allLines.length > lines.length && <p className="pr-limited-note">Showing the first 10,000 patch lines. Open in GitHub to view the remaining lines.</p>}</>;
}
