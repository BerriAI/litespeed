import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, ChevronRight, FileCode2, GitBranch, GitCompareArrows, RefreshCw, Search, Undo2, X } from 'lucide-react';
import type { FileChange } from '../../shared/types';
import type { GitFileDiff, GitReview, GitReviewEntry, GitReviewScope, ReviewComment } from '../../shared/git-review';
import { api, errorMessage, query } from './api';
import { EmptyState, LiteSpeed } from './ui';
import { DiffView } from './DiffView';
import { GitControls } from './GitControls';
import { BranchControl } from './BranchControl';
import { diffStats } from './diff-model';
import type { WorkspaceTarget } from './workspace-activity';

type Scope = 'task' | GitReviewScope;
const scopeLabels: Record<Scope, string> = { task: 'Task edits', unstaged: 'Unstaged changes', staged: 'Staged changes', branch: 'Branch changes' };
export function ReviewPanel({ workspace, sessionId, refreshKey, target, running, onOpenFile, onComment, onRefresh, onUndo, undoLabel = 'Undo task edits' }: {
  workspace: string; sessionId?: string; refreshKey: number; target?: WorkspaceTarget | null; running: boolean;
  onOpenFile: (path: string) => void; onRefresh: () => void; onComment?: (comment: ReviewComment) => void; onUndo?: () => void; undoLabel?: string;
}) {
  const key = `litespeed.review:${sessionId ?? 'new'}:${workspace}`;
  const saved = useMemo(() => { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } }, [key]);
  const [scope, setScope] = useState<Scope>(['task', 'unstaged', 'staged', 'branch'].includes(saved.scope) && (saved.scope !== 'task' || sessionId) ? saved.scope : sessionId ? 'task' : 'unstaged');
  const [base, setBase] = useState(typeof saved.base === 'string' ? saved.base : '');
  const [summary, setSummary] = useState<GitReview | null>(null), [changes, setChanges] = useState<FileChange[]>([]);
  const [activePath, setActivePath] = useState<string | null>(typeof saved.path === 'string' ? saved.path : null), [diff, setDiff] = useState<GitFileDiff | null>(null);
  const [loading, setLoading] = useState(true), [opening, setOpening] = useState(false), [error, setError] = useState(''), [search, setSearch] = useState('');
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, ReviewComment>>(() => {
    if (!saved.comments || typeof saved.comments !== 'object') return {};
    return Object.fromEntries(Object.entries(saved.comments).filter(([, value]) => {
      const item = value as ReviewComment | null;
      return item && typeof item.path === 'string' && item.path.length <= 4096 && typeof item.text === 'string' && item.text.length <= 4000 && ['before', 'after'].includes(item.side) && Number.isSafeInteger(item.line) && item.line > 0;
    }).slice(-20)) as Record<string, ReviewComment>;
  });
  const feedbackKey = `${scope}${scope === 'branch' ? ':' + (base || summary?.baseRef || '') : ''}:${activePath}`, feedback = feedbackDrafts[feedbackKey] ?? null;
  function setFeedback(value: ReviewComment | null) {
    setFeedbackDrafts(current => { const next = { ...current }; if (value) next[feedbackKey] = value; else delete next[feedbackKey]; return Object.fromEntries(Object.entries(next).slice(-20)); });
  }
  const request = useRef(0);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify({ scope, base, path: activePath, comments: feedbackDrafts })); } catch {} }, [key, scope, base, activePath, feedbackDrafts]);
  useEffect(() => {
    if (target?.kind !== 'review') return;
    setScope(target.scope || (sessionId ? 'task' : 'unstaged')); setActivePath(target.path || null); setSearch('');
  }, [target, sessionId]);
  useEffect(() => {
    let current = true; setLoading(true); setError('');
    void Promise.all([
      api<GitReview>(`/git/review?${query({ workspace, scope: scope === 'task' ? 'unstaged' : scope, ...(scope === 'branch' && base ? { base } : {}) })}`),
      scope === 'task' && sessionId ? api<{ changes: FileChange[] }>(`/sessions/${sessionId}/changes`) : Promise.resolve({ changes: [] }),
    ]).then(([git, task]) => { if (current) { setSummary(git); setChanges(task.changes.filter(change => change.before !== change.after)); } }).catch(e => { if (current) setError(errorMessage(e)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [workspace, sessionId, scope, base, refreshKey]);
  const entries = useMemo<GitReviewEntry[]>(() => scope === 'task' ? changes.map(change => { const stats = diffStats(change); return { path: change.path, status: change.before === null ? 'added' : change.after === null ? 'deleted' : 'modified', additions: stats?.additions ?? null, deletions: stats?.deletions ?? null }; }) : summary?.files ?? [], [scope, changes, summary]);
  useEffect(() => {
    const version = ++request.current;
    if (!activePath || loading) { setOpening(false); if (!activePath) setDiff(null); return; }
    if (!entries.some(entry => entry.path === activePath)) { setActivePath(null); setDiff(null); setOpening(false); return; }
    setOpening(true); setDiff(null); setError('');
    const read = scope === 'task' ? Promise.resolve({ ...changes.find(change => change.path === activePath)!, revision: String(refreshKey) } as GitFileDiff) : api<GitFileDiff>(`/git/diff?${query({ workspace, scope, path: activePath, ...(scope === 'branch' && base ? { base } : {}) })}`);
    void read.then(value => { if (request.current === version) setDiff(value); }).catch(e => { if (request.current === version) setError(errorMessage(e)); }).finally(() => { if (request.current === version) setOpening(false); });
    return () => { request.current++; };
  }, [activePath, scope, base, workspace, entries, changes, refreshKey, loading]);
  const filtered = entries.filter(entry => entry.path.toLowerCase().includes(search.toLowerCase()));
  const additions = entries.reduce((sum, entry) => sum + (entry.additions || 0), 0), deletions = entries.reduce((sum, entry) => sum + (entry.deletions || 0), 0);
  function selectScope(value: Scope) { setScope(value); setActivePath(null); setDiff(null); setSearch(''); }
  return <div className={`review-panel ${activePath ? 'reviewing-file' : ''}`}>
    <div className="review-scope-bar"><select aria-label="Review scope" value={scope} onChange={e => selectScope(e.target.value as Scope)}>{(Object.entries(scopeLabels) as [Scope, string][]).filter(([value]) => value !== 'task' || sessionId).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{summary?.isRepo && <BranchControl key={workspace} workspace={workspace} disabled={running} refreshKey={refreshKey} compact initialLabel={summary.branch} />}<button className="icon-button" aria-label="Refresh workspace" title="Refresh changes" disabled={loading || opening} onClick={onRefresh}><RefreshCw size={13} className={loading ? 'spinning' : ''} /></button></div>
    {scope === 'branch' && summary?.refs.length ? <label className="review-base">Compare with<select aria-label="Base branch" value={base || summary.baseRef || ''} onChange={e => { setBase(e.target.value); setActivePath(null); }}>{summary.refs.map(ref => <option key={ref}>{ref}</option>)}</select></label> : null}
    {error && <div className="inline-alert" role="alert">{error}{scope === 'branch' && base && <button className="text-button" onClick={() => setBase('')}>Choose default branch</button>}</div>}
    {activePath ? <>
      <div className="file-preview-toolbar review-file-toolbar"><button className="icon-button" aria-label="Back to changes" onClick={() => { setActivePath(null); }}><ArrowLeft size={15} /></button><span title={activePath}>{activePath}</span><button className="icon-button" aria-label="Open current file" title="Open current file" disabled={entries.find(entry => entry.path === activePath)?.status === 'deleted'} onClick={() => onOpenFile(activePath)}><ArrowUpRight size={15} /></button></div>
      {opening || loading ? <div className="panel-loading"><LiteSpeed compact active />Opening comparison…</div> : diff?.notice ? <p className="review-notice">{diff.notice}</p> : diff ? <DiffView key={`${scope}:${activePath}`} change={diff} selected={feedback ?? undefined} onComment={onComment ? value => setFeedback({ ...value, text: feedback?.text || '' }) : undefined} /> : null}
      {feedback && onComment && <form className="review-feedback" onSubmit={e => { e.preventDefault(); if (!feedback.text.trim()) return; onComment({ ...feedback, text: feedback.text.trim() }); setFeedback(null); }}><div><span>{feedback.side === 'before' ? 'Original' : 'New'} line {feedback.line}</span><button type="button" className="icon-button" aria-label="Cancel line feedback" onClick={() => setFeedback(null)}><X size={13} /></button></div><textarea autoFocus aria-label="Line feedback" placeholder="What would you like changed?" maxLength={4000} rows={3} value={feedback.text} onChange={e => setFeedback({ ...feedback, text: e.target.value })} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} /><footer><span>Adds to your message draft</span><button className="button primary" disabled={!feedback.text.trim()}>Add to chat</button></footer></form>}
    </> : loading ? <div className="panel-loading"><LiteSpeed compact active />Loading changes…</div> : <div className="review-list-body">
      {entries.length > 0 && <div className="review-summary"><span>{entries.length} {entries.length === 1 ? 'file' : 'files'} changed</span><span className="diff-additions">{additions > 0 && `+${additions}`}</span><span className="diff-deletions">{deletions > 0 && `−${deletions}`}</span>{scope === 'task' && onUndo && <button className="icon-button" disabled={running} aria-label={undoLabel} title={undoLabel} onClick={onUndo}><Undo2 size={14} /></button>}</div>}
      {entries.length > 5 && <label className="file-filter"><Search size={13} /><input aria-label="Filter changed files" placeholder="Filter files" value={search} onChange={e => setSearch(e.target.value)} /></label>}
      <div className="review-file-list">{filtered.map(entry => <button key={entry.path} onClick={() => { setActivePath(entry.path); }} title={entry.path}><FileCode2 size={15} /><span className="review-file-name"><strong>{entry.path.split('/').at(-1)}</strong>{entry.path.includes('/') && <small>{entry.path.split('/').slice(0, -1).join('/')}</small>}</span>{entry.additions !== null && entry.additions > 0 && <span className="diff-additions">+{entry.additions}</span>}{entry.deletions !== null && entry.deletions > 0 && <span className="diff-deletions">−{entry.deletions}</span>}{entry.status === 'conflicted' && <span className="review-conflict">Conflict</span>}{entry.untracked && <span className="review-new-file">New</span>}<ChevronRight size={12} /></button>)}</div>
      {!filtered.length && !error && <EmptyState icon={<GitCompareArrows size={25} />} title={search ? 'No matching files' : scope !== 'task' && summary && !summary.isRepo ? 'No Git repository' : scope === 'staged' ? 'No staged changes' : scope === 'branch' ? 'No branch changes' : 'No changes yet'}>{scope === 'task' ? 'Edits made during this task appear here.' : scope === 'branch' ? 'Compare committed changes against another branch.' : undefined}</EmptyState>}
      {summary?.limited && scope !== 'task' && <p className="review-notice">This is a large comparison. Showing up to 500 files.</p>}
    </div>}
    {scope !== 'task' && summary?.isRepo && <GitControls key={workspace} workspace={workspace} scope={scope} paths={entries.map(entry => entry.path)} activePath={activePath} disabled={running || loading || opening} onRefresh={onRefresh} />}
  </div>;
}
