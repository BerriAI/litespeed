import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, ChevronDown, GitBranch, Globe2, Plus, RefreshCw, Search } from 'lucide-react';
import type { GitBranchEntry, GitBranches, GitBranchPlan, GitBranchRequest, GitBranchResult } from '../../shared/git-branches';
import { api, errorMessage, post, query } from './api';
import { Modal } from './ui';

type View = { kind: 'list' } | { kind: 'name'; remote?: GitBranchEntry } | { kind: 'review'; plan: GitBranchPlan; request: GitBranchRequest };
export function BranchControl({ workspace, disabled = false, refreshKey = 0, compact = false, initialLabel }: { workspace: string; disabled?: boolean; refreshKey?: number; compact?: boolean; initialLabel?: string }) {
  const [state, setState] = useState<GitBranches | null>(null), [view, setView] = useState<View | null>(null);
  const [search, setSearch] = useState(''), [name, setName] = useState(''), [error, setError] = useState('');
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [stale, setStale] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), generation = useRef(0), mounted = useRef(true), opened = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  useEffect(() => { if (view) opened.current = true; else if (opened.current) { opened.current = false; requestAnimationFrame(() => trigger.current?.focus()); } }, [Boolean(view)]);
  async function refresh(clearError = true) {
    const version = ++generation.current; setLoading(true); if (clearError) setError('');
    try { const result = await api<GitBranches>(`/git/branches?${query({ workspace })}`); if (mounted.current && version === generation.current) setState(result); }
    catch (e) { if (mounted.current && version === generation.current) setError(errorMessage(e)); }
    finally { if (mounted.current && version === generation.current) setLoading(false); }
  }
  useEffect(() => { setState(null); setView(null); void refresh(); return () => { generation.current++; }; }, [workspace]);
  useEffect(() => { if (refreshKey) void refresh(false); }, [refreshKey]);
  useEffect(() => {
    const changed = (event: Event) => { if ((event as CustomEvent).detail?.workspace === workspace) void refresh(false); };
    window.addEventListener('litespeed:git-changed', changed); return () => window.removeEventListener('litespeed:git-changed', changed);
  }, [workspace]);
  async function prepare(request: GitBranchRequest) {
    if (busy || disabled) return; setBusy(true); setError('');
    try { const plan = await post<GitBranchPlan>('/git/branches/prepare', { workspace, request }); if (mounted.current) { setStale(false); setView({ kind: 'review', plan, request }); } }
    catch (e) { if (mounted.current) setError(errorMessage(e)); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function apply() {
    if (view?.kind !== 'review' || busy || disabled) return; setBusy(true); setError('');
    try {
      const result = await post<GitBranchResult>('/git/branches/apply', { workspace, id: view.plan.id });
      if (mounted.current) { setView(null); setState(value => value ? { ...value, current: result.current, head: result.head } : value); }
      window.dispatchEvent(new CustomEvent('litespeed:git-changed', { detail: { workspace, message: result.message } }));
    } catch (e) { if (mounted.current) { setError(errorMessage(e)); setStale(true); } window.dispatchEvent(new CustomEvent('litespeed:git-changed', { detail: { workspace } })); }
    finally { if (mounted.current) setBusy(false); }
  }
  const current = state ? state.current || 'Detached HEAD' : initialLabel || 'Branches';
  const matching = (state?.entries || []).filter(entry => entry.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => Number(b.name === state?.current && b.kind === 'local') - Number(a.name === state?.current && a.kind === 'local') || a.name.localeCompare(b.name));
  const blocked = disabled || busy, switchingBlocked = blocked || Boolean(state?.blocked) || Boolean(state?.changedFiles);
  const close = () => { if (!busy) { setView(null); setError(''); } };
  if (state && !state.isRepo) return null;
  return <><button ref={trigger} className={`branch-control ${compact ? 'compact' : ''}`} aria-label={`Choose branch, current ${current}`} title={current} disabled={disabled} onClick={() => { setSearch(''); setView({ kind: 'list' }); void refresh(); }}><GitBranch size={13} /><span>{current}</span><ChevronDown size={11} /></button>
    {view && createPortal(<Modal key={view.kind} title={view.kind === 'list' ? 'Branches' : view.kind === 'name' ? view.remote ? 'Track a remote branch' : 'New branch' : view.plan.action === 'switch' ? 'Switch branch?' : 'Create branch?'} onClose={close}><div className="branch-dialog">
      {view.kind === 'list' ? <>
        <div className="branch-current"><span>Current branch</span><strong title={current}><GitBranch size={14} /><span>{current}</span></strong>{state?.head && <code>{state.head.slice(0, 7)}</code>}</div>
        <div className="branch-search-row"><label><Search size={15} /><input autoFocus aria-label="Search branches" placeholder="Search branches" value={search} onChange={e => setSearch(e.target.value)} /></label><button className="icon-button" aria-label="Refresh branches" title="Refresh branches" disabled={loading || busy} onClick={() => void refresh()}><RefreshCw size={14} className={loading ? 'spinning' : ''} /></button><button className="button" disabled={blocked || loading || !state || Boolean(state.blocked)} onClick={() => { setName(''); setError(''); setView({ kind: 'name' }); }}><Plus size={14} />New branch</button></div>
        {state?.blocked ? <p className="branch-notice">{state.blocked}</p> : Boolean(state?.changedFiles) && <p className="branch-notice">{state!.changedFiles} {state!.changedFiles === 1 ? 'file has' : 'files have'} changes. Create a branch to keep working, or commit or discard your changes before switching.</p>}
        <div className="branch-list">{loading && !state ? <p className="branch-empty">Loading branches…</p> : (['local', 'remote'] as const).map(kind => {
          const entries = matching.filter(entry => entry.kind === kind);
          return entries.length ? <section key={kind} aria-label={kind === 'local' ? 'Local branches' : 'Remote branches'}><h3>{kind === 'local' ? 'Local' : 'Remote'}</h3>{entries.map(entry => {
            const selected = kind === 'local' && entry.name === state?.current, occupied = entry.checkedOutAt && entry.checkedOutAt !== workspace;
            return <button key={entry.ref} disabled={switchingBlocked || selected || Boolean(occupied)} title={occupied ? `Open in ${entry.checkedOutAt}` : entry.name} onClick={() => { setError(''); if (kind === 'remote') { setName(entry.name.slice(entry.name.indexOf('/') + 1)); setView({ kind: 'name', remote: entry }); } else void prepare({ action: 'switch', ref: entry.ref }); }}>
              {kind === 'remote' ? <Globe2 size={15} /> : <GitBranch size={15} />}<span><strong>{entry.name}</strong>{occupied ? <small>Open in another working copy</small> : entry.upstream ? <small>{entry.upstream}</small> : null}</span>{selected ? <Check size={15} className="branch-selected" /> : <code>{entry.head.slice(0, 7)}</code>}
            </button>;
          })}</section> : null;
        })}{!loading && !matching.length && <p className="branch-empty">{search ? 'No matching branches' : state?.head ? 'No available branches' : 'Your first commit will appear on this branch.'}</p>}</div>
        {state?.limited && <p className="field-hint">Showing 500 recent branches. Use your terminal for older branches.</p>}
        {matching.some(entry => entry.kind === 'remote') && <p className="branch-footnote">Remote branches reflect the last fetch from this project.</p>}
      </> : view.kind === 'name' ? <form onSubmit={e => { e.preventDefault(); void prepare(view.remote ? { action: 'track', ref: view.remote.ref, name: name.trim() } : { action: 'create', name: name.trim() }); }}>
        <p className="branch-form-copy">{view.remote ? <>Create a local branch that tracks <strong>{view.remote.name}</strong>.</> : <>Start from <strong>{current}</strong>{state?.head ? '.' : ' before your first commit.'}</>}</p>
        <label className="branch-name-field">Branch name<input autoFocus aria-label="Branch name" maxLength={250} placeholder="feature/my-work" spellCheck={false} autoComplete="off" value={name} onChange={e => setName(e.target.value)} disabled={busy} /></label>
        {!view.remote && Boolean(state?.changedFiles) && <p className="field-hint">Your staged and unstaged changes stay with you on the new branch.</p>}
        <footer><button type="button" className="button" disabled={busy} onClick={() => { setView({ kind: 'list' }); setError(''); }}><ArrowLeft size={14} />Back</button><button className="button primary" disabled={blocked || !name.trim()}>{busy ? 'Preparing…' : 'Continue'}</button></footer>
      </form> : <>
        <dl className="branch-review"><div><dt>From</dt><dd title={view.plan.from}>{view.plan.from}</dd></div><div><dt>{view.plan.action === 'switch' ? 'Switch to' : 'New branch'}</dt><dd title={view.plan.name}>{view.plan.name}</dd></div>{view.plan.upstream && <div><dt>Tracks</dt><dd>{view.plan.upstream}</dd></div>}<div><dt>Commit</dt><dd><code>{view.plan.head?.slice(0, 7) || 'No commits yet'}</code></dd></div></dl>
        <p className="branch-form-copy">{view.plan.action === 'switch' ? 'The files in this project will update to the selected branch. All tasks using this folder will see that branch.' : view.plan.changedFiles ? 'Your current staged and unstaged changes will stay in this project on the new branch.' : 'This project will open on the new branch.'}</p>
        <footer><button className="button" disabled={busy} onClick={() => { setView({ kind: 'list' }); setError(''); void refresh(); }}>Back</button>{stale ? <button className="button primary" disabled={blocked} onClick={() => void prepare(view.request)}>Refresh review</button> : <button className="button primary" disabled={blocked} onClick={() => void apply()}>{busy ? 'Changing branch…' : view.plan.action === 'switch' ? 'Switch branch' : 'Create branch'}</button>}</footer>
      </>}
      {error && <div className="inline-alert" role="alert">{error}</div>}
    </div></Modal>, document.body)}
  </>;
}
