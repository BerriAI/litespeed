import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, ChevronDown, Copy, Folder, GitBranch, GitFork, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import type { ProjectWorktree, WorktreePlan, WorktreeRemovalPlan, WorktreeRestorePlan, WorktreeSetupFiles } from '../../shared/worktrees';
import type { Session } from '../../shared/types';
import { api, errorMessage, post, query } from './api';
import { Modal } from './ui';
import { WorktreeStartingPoint } from './WorktreeStartingPoint';
import { copyText } from './clipboard';

export function Worktrees({ project, providerId, model, sessions, initialRestoreId, preferredSessionId, onOpen, onClose }: {
  project: string; providerId: string; model: string; sessions: Session[]; initialRestoreId?: string; preferredSessionId?: string; onOpen: (session: Session) => void; onClose: () => void;
}) {
  const [copies, setCopies] = useState<ProjectWorktree[]>([]), [name, setName] = useState(''), [plan, setPlan] = useState<WorktreePlan | null>(null);
  const [view, setView] = useState<'list' | 'new' | 'review' | 'remove' | 'restore'>('list'), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState('');
  const [removal, setRemoval] = useState<WorktreeRemovalPlan | null>(null);
  const [restoration, setRestoration] = useState<WorktreeRestorePlan | null>(null);
  const [notice, setNotice] = useState('');
  const [includeLocalEdits, setIncludeLocalEdits] = useState(false);
  const [includeLocalSetup, setIncludeLocalSetup] = useState(false);
  const [startingRef, setStartingRef] = useState('');
  const [reviewing, setReviewing] = useState(false), focusedPlan = useRef('');
  const mounted = useRef(true), operation = useRef(false), restoreOnOpen = useRef(initialRestoreId);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { if (view !== 'review') body.current?.querySelector<HTMLElement>(view === 'new' ? 'input' : view === 'remove' ? '[data-cancel-removal]' : view === 'restore' ? '[data-restore-worktree]' : '.worktrees-new')?.focus(); }, [view]);
  useEffect(() => { if (view === 'review' && plan && !busy && focusedPlan.current !== plan.id) { focusedPlan.current = plan.id; body.current?.querySelector<HTMLElement>('[data-create-worktree]')?.focus(); } }, [view, plan?.id, busy]);
  useEffect(() => { mounted.current = true; const controller = new AbortController();
    api<{ worktrees: ProjectWorktree[] }>(`/worktrees?${query({ workspace: project, includeRemoved: 'true' })}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setCopies(result.worktrees); }).catch(e => { if (!controller.signal.aborted) setError(errorMessage(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { mounted.current = false; controller.abort(); };
  }, [project]);
  useEffect(() => { if (restoreOnOpen.current) void reviewRestoration(restoreOnOpen.current); }, []);
  useEffect(() => { if (view === 'restore' && restoration && !busy) body.current?.querySelector<HTMLElement>('[data-restore-worktree]')?.focus(); }, [view, restoration?.id, busy]);
  async function act(action: () => Promise<void>) {
    if (operation.current) return; operation.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { if (mounted.current) setError(errorMessage(e)); }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  }
  async function prepare() { if (operation.current) return; setReviewing(true); try { await act(async () => { const next = await post<WorktreePlan>('/worktrees/prepare', { workspace: project, name, includeLocalEdits, includeLocalSetup, ...(startingRef ? { startingRef } : {}) }); if (mounted.current) { setPlan(next); setView('review'); } }); } finally { if (mounted.current) setReviewing(false); } }
  async function create() { if (!plan) return; await act(async () => { const result = await post<{ session: Session }>('/worktrees/create', { workspace: project, id: plan.id, providerId, model }); onOpen(result.session); }); }
  async function reviewRemoval(copy: ProjectWorktree) { await act(async () => { const result = await post<WorktreeRemovalPlan>(`/worktrees/${copy.id}/remove/prepare`, {}); if (mounted.current) { setRemoval(result); setView('remove'); } }); }
  async function recover(copy: ProjectWorktree) { await act(async () => { const result = await post<ProjectWorktree>(`/worktrees/${copy.id}/recover`, {}); if (mounted.current) { setCopies(copies => copies.map(copy => copy.id === result.id ? result : copy).filter(copy => copy.status !== 'removed' || copy.snapshot)); setNotice(result.status === 'removed' ? result.snapshot ? 'No working folder remains. Its saved commit is available to restore.' : 'The working copy was never created. Its incomplete entry has been cleared.' : 'Working copy checked and ready to open.'); if (result.status === 'removed') requestAnimationFrame(() => body.current?.querySelector<HTMLElement>('.worktrees-new')?.focus()); } window.dispatchEvent(new CustomEvent('litespeed:worktrees-changed')); }); }
  async function remove() { if (!removal) return; await act(async () => { const result = await post<{ worktree: ProjectWorktree }>(`/worktrees/${removal.worktreeId}/remove`, { planId: removal.id }); if (mounted.current) { setCopies(copies => copies.map(copy => copy.id === removal.worktreeId ? result.worktree : copy)); setRemoval(null); setView('list'); setNotice('Working copy removed. Its saved commit is ready to restore.'); } window.dispatchEvent(new CustomEvent('litespeed:worktrees-changed')); }); }
  async function reviewRestoration(id: string) { await act(async () => { const result = await post<WorktreeRestorePlan>(`/worktrees/${id}/restore/prepare`, {}); if (mounted.current) { setRestoration(result); setView('restore'); } }); }
  async function restore() { if (!restoration) return; await act(async () => {
    const result = await post<{ worktree: ProjectWorktree; sessions: Session[] }>(`/worktrees/${restoration.worktreeId}/restore`, { planId: restoration.id });
    if (mounted.current) { setCopies(copies => copies.map(copy => copy.id === result.worktree.id ? result.worktree : copy)); setView('list'); setRestoration(null); setNotice('Working copy restored. Your tasks can continue here.'); }
    window.dispatchEvent(new CustomEvent('litespeed:worktrees-changed'));
    const task = result.sessions.find(session => session.id === preferredSessionId) || result.sessions.filter(session => !session.archived).sort((a, b) => b.updatedAt - a.updatedAt)[0]; if (mounted.current && task) onOpen(task);
  }); }
  async function open(copy: ProjectWorktree) {
    await act(async () => {
      const existing = sessions.filter(session => !session.archived && session.workspace === copy.path).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (existing) onOpen(existing);
      else onOpen(await post<Session>(`/worktrees/${copy.id}/tasks`, { providerId, model }));
    });
  }
  const available = copies.filter(copy => copy.status !== 'removed'), removed = copies.filter(copy => copy.status === 'removed' && copy.snapshot);
  return <Modal title={view === 'restore' ? 'Restore working copy?' : view === 'remove' ? 'Remove working copy?' : view === 'review' ? 'Create worktree?' : view === 'new' ? 'New worktree' : 'Working copies'} onClose={() => { if (!busy) onClose(); }}><div ref={body} className="worktrees-dialog">
    <div className="worktrees-project"><Folder size={14} /><span title={project}>{project.split('/').at(-1)}</span></div>
    {view === 'list' ? <>
      <p className="worktrees-intro">{!available.length && removed.length ? 'Restore a saved copy to continue its tasks, or start a fresh idea.' : 'Give a task its own files and branch. Your local project stays as it is.'}</p>
      <div className="worktrees-list">{loading ? <p className="field-hint">Loading working copies…</p> : available.length ? available.map(copy => <div key={copy.id} className="worktree-row"><GitFork size={17} /><div><strong>{copy.name.replaceAll('-', ' ')}</strong><span title={copy.branch}>{copy.branch}</span>{copy.error && <p>{copy.error}</p>}<small title={copy.path}>{copy.path}</small></div><button className="icon-button" aria-label={`Copy path for ${copy.name}`} title={copied === copy.id ? 'Copied' : 'Copy folder path'} onClick={() => void copyText(copy.path).then(() => setCopied(copy.id)).catch(() => setError('The folder path could not be copied.'))}><Copy size={14} /></button>{copy.status === 'error' && <button className="icon-button" aria-label={`Check worktree ${copy.name}`} title="Check working copy registration" disabled={busy} onClick={() => void recover(copy)}><RefreshCw size={14} /></button>}<button className="icon-button" aria-label={`Open worktree ${copy.name}`} title="Open task" disabled={busy || copy.status !== 'ready'} onClick={() => void open(copy)}><ArrowUpRight size={16} /></button><button className="icon-button" aria-label={`Remove worktree ${copy.name}`} title="Remove clean working copy" disabled={busy || copy.status !== 'ready'} onClick={() => void reviewRemoval(copy)}><Trash2 size={14} /></button></div>) : removed.length ? null : <div className="worktrees-empty"><GitFork size={26} /><strong>A little room to work</strong><p>Create a separate copy for your next idea.</p></div>}</div>
      {removed.length > 0 && <details className="worktree-removed-list" open={!available.length}><summary>Saved working copies<span>{removed.length}</span><ChevronDown size={14} /></summary>{removed.map(copy => <div className="worktree-row" key={copy.id}><RotateCcw size={16} /><div><strong>{copy.name.replaceAll('-', ' ')}</strong><span>{new Date(copy.snapshot!.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {copy.snapshot!.head.slice(0, 7)}</span></div><button className="text-button" aria-label={`Restore worktree ${copy.name}`} disabled={busy} onClick={() => void reviewRestoration(copy.id)}>Restore</button></div>)}</details>}
      <button className="button secondary worktrees-new" disabled={busy} onClick={() => { setError(''); setName(''); setView('new'); }}><Plus size={15} />New worktree</button>
    </> : view === 'new' ? <form onSubmit={event => { event.preventDefault(); void prepare(); }}>
      <p className="worktrees-intro">Choose a starting branch and give this task a short name.</p>
      <label className="worktrees-name">Task name<input autoFocus aria-label="Worktree task name" placeholder="For example, refine the browser" maxLength={64} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <WorktreeStartingPoint project={project} value={startingRef} disabled={busy} onChange={ref => { setStartingRef(ref); if (ref) setIncludeLocalEdits(false); }} />
      <label className="worktree-copy-choice"><input type="checkbox" checked={includeLocalEdits} disabled={busy || Boolean(startingRef)} onChange={event => setIncludeLocalEdits(event.target.checked)} /><span><strong>Include local edits</strong><small>{startingRef ? 'Available when starting from the current branch.' : 'Copy changed and new files, keeping their staging state.'}</small></span></label>
      <label className="worktree-copy-choice"><input type="checkbox" checked={includeLocalSetup} disabled={busy} onChange={event => setIncludeLocalSetup(event.target.checked)} /><span><strong>Include local setup</strong><small>Copy ignored files selected by this project’s .worktreeinclude.</small></span></label>
      <div className="worktrees-actions"><button type="button" className="text-button" disabled={busy} onClick={() => { setError(''); setView('list'); }}><ArrowLeft size={14} />Working copies</button><button className="button primary" disabled={busy || !name.trim()}>{busy ? 'Reviewing…' : 'Continue'}</button></div>
    </form> : view === 'remove' && removal ? <>
      <p className="worktrees-intro">This removes the clean working folder and saves its current commit for restoration. Your task history and branch stay available.</p>
      <dl className="worktree-plan"><div><dt>Branch kept</dt><dd>{removal.branch}</dd></div><div><dt>Commit kept</dt><dd><code>{removal.head.slice(0, 7)}</code></dd></div><div><dt>Folder removed</dt><dd><WorktreeLocation path={removal.path} /></dd></div></dl>
      <div className="worktrees-actions"><button data-cancel-removal className="text-button" disabled={busy} onClick={() => { setError(''); setView('list'); }}>Cancel</button><button className="button destructive" disabled={busy} onClick={() => void remove()}><Trash2 size={14} />{busy ? 'Removing…' : 'Remove working copy'}</button></div>
    </> : view === 'restore' && restoration ? <>
      <p className="worktrees-intro">Restore the files saved when this working copy was removed. Your existing tasks will use the restored folder.</p>
      <dl className="worktree-plan"><div><dt>Saved commit</dt><dd className="worktree-snapshot"><span title={restoration.sourceBranch}>{restoration.sourceBranch}</span><code>{restoration.head.slice(0, 7)}</code></dd></div><div><dt>New branch</dt><dd>{restoration.branch}</dd></div><div><dt>Folder</dt><dd><WorktreeLocation path={restoration.path} /></dd></div></dl>
      <p className="worktrees-note">Your original project and existing branches stay as they are. Queued messages remain paused.</p>
      <div className="worktrees-actions"><button className="text-button" disabled={busy} onClick={() => { setError(''); setView('list'); }}>Cancel</button><button data-restore-worktree className="button primary" disabled={busy} onClick={() => void restore()}><RotateCcw size={14} />{busy ? 'Restoring…' : 'Restore working copy'}</button></div>
      {error && <button className="text-button worktree-refresh-review" disabled={busy} onClick={() => void reviewRestoration(restoration.worktreeId)}>Refresh review</button>}
    </> : plan && <>
      <p className="worktrees-intro">A new task will open in this separate working copy.</p>
      <dl className="worktree-plan"><div><dt>Starting point</dt><dd><GitBranch size={14} /><span title={plan.sourceBranch || 'Detached HEAD'}>{plan.sourceBranch || 'Detached HEAD'}</span><code>{plan.head.slice(0, 7)}</code></dd></div><div><dt>New branch</dt><dd title={plan.branch}>{plan.branch}</dd></div><div><dt>Folder</dt><dd><WorktreeLocation path={plan.path} /></dd></div></dl>
      {plan.localEdits && <details className="worktree-copy-files"><summary>{plan.localEdits.files.length ? `${plan.localEdits.files.length} ${plan.localEdits.files.length === 1 ? 'file' : 'files'} with local edits` : 'No local edits to copy'}<ChevronDown size={13} /></summary>{plan.localEdits.files.length > 0 && <ul>{plan.localEdits.files.map(file => <li key={file.path}><span title={file.path}>{file.path}</span><small>{file.status.includes('?') ? 'New' : file.status.includes('D') ? 'Deleted' : file.status.includes('A') ? 'Added' : 'Modified'}</small></li>)}</ul>}</details>}
      {plan.localSetup && <SetupFileReview setup={plan.localSetup} />}
      <p className="worktrees-note">{plan.localEdits ? 'Your original files and staging stay intact.' : plan.changedFiles ? `${plan.changedFiles} changed ${plan.changedFiles === 1 ? 'file stays' : 'files stay'} in the local project.` : 'Starts from the reviewed commit.'} {plan.localSetup?.files.length ? 'Selected setup files are copied privately.' : !plan.localEdits ? 'Only committed files are included.' : 'Ignored files and dependency folders aren’t copied.'}</p>
      <div className="worktrees-actions"><button className="text-button" disabled={busy} onClick={() => { setError(''); setView('new'); }}><ArrowLeft size={14} />Back</button><button data-create-worktree className="button primary" disabled={busy || !model || !providerId} onClick={() => void create()}><GitFork size={14} />{busy ? reviewing ? 'Refreshing review…' : 'Creating…' : 'Create and open'}</button></div>
    </>}
    {notice && <p className="worktrees-note" role="status">{notice}</p>}
    {error && <div className="inline-alert" role="alert">{error}{view === 'review' && !busy && <button className="text-button" onClick={() => void prepare()}>Refresh review</button>}</div>}
  </div></Modal>;
}
export function WorktreeLocation({ path }: { path: string }) {
  return <details className="worktree-location"><summary title={path}><span>{path.split('/').at(-1)}</span><ChevronDown size={12} /></summary><span className="worktree-plan-path">{path}</span></details>;
}

export function SetupFileReview({ setup }: { setup: WorktreeSetupFiles }) {
  const count = setup.files.length;
  return <><details className="worktree-copy-files worktree-setup-files"><summary>{count ? `${count} local setup ${count === 1 ? 'file' : 'files'}` : 'No local setup files to copy'}{setup.skipped.length > 0 && ` · ${setup.skipped.length} skipped`}<ChevronDown size={13} /></summary>{count + setup.skipped.length > 0 && <ul>{setup.files.map(file => <li key={file.path}><span title={file.path}>{file.path}</span><small>Copy</small></li>)}{setup.skipped.map(file => <li key={file.path}><span title={file.path}>{file.path}</span><small>Skipped · {file.reason}</small></li>)}</ul>}</details>{!count && <p className="worktrees-note">{setup.hasRules ? 'Only ignored files matching .worktreeinclude are copied. Files already in the starting commit stay as they are.' : 'List ignored paths or patterns in .worktreeinclude to include local configuration. An ignored AGENTS.override.md is included automatically.'}</p>}</>;
}
