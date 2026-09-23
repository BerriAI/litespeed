import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, GitBranch, RefreshCw, Search } from 'lucide-react';
import type { GitBranches } from '../../shared/git-branches';
import { api, errorMessage, query } from './api';

export function WorktreeStartingPoint({ project, value, disabled, onChange }: { project: string; value: string; disabled: boolean; onChange: (ref: string) => void }) {
  const [branches, setBranches] = useState<GitBranches | null>(null), [open, setOpen] = useState(false), [search, setSearch] = useState('');
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [refresh, setRefresh] = useState(0);
  const container = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), searchInput = useRef<HTMLInputElement>(null), id = useId();
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    api<GitBranches>(`/git/branches?${query({ workspace: project })}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setBranches(result); }).catch(error => { if (!controller.signal.aborted) setError(errorMessage(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [project, refresh]);
  useEffect(() => {
    if (!open) return; searchInput.current?.focus();
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  function close() { setOpen(false); trigger.current?.focus(); }
  const name = value ? value.replace(/^refs\/(?:heads|remotes)\//, '') : branches?.current || (branches?.head ? 'Detached HEAD' : 'Current branch');
  const currentRef = branches?.current ? `refs/heads/${branches.current}` : '';
  const options = [
    { ref: '', name: branches?.current || 'Current checkout', head: branches?.head || '', kind: 'current' },
    ...(branches?.entries ?? []).filter(entry => entry.ref !== currentRef).sort((a, b) => a.name.localeCompare(b.name)),
  ].filter(entry => `${entry.name} ${entry.kind === 'current' ? 'current branch' : entry.kind}`.toLowerCase().includes(search.toLowerCase()));
  return <div ref={container} className="worktree-starting-point" onBlur={event => { if (open && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (open && event.key === 'Enter' && event.target === searchInput.current) { event.preventDefault(); if (options[0]) { onChange(options[0].ref); close(); } }
    if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      if (event.target === searchInput.current && ['Home', 'End'].includes(event.key)) return;
      const entries = [...(container.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
      if (!entries.length) return; event.preventDefault(); event.stopPropagation(); const current = entries.indexOf(document.activeElement as HTMLButtonElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : current < 0 ? event.key === 'ArrowUp' ? entries.length - 1 : 0 : (current + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length;
      entries[index].focus();
    }
  }}>
    <span className="worktree-starting-label">Starting branch</span>
    <button ref={trigger} type="button" className="worktree-starting-trigger" aria-label={`Choose starting branch, current ${name}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={() => { setSearch(''); setOpen(value => !value); }} onKeyDown={event => { if (!open && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setOpen(true); } }}><GitBranch size={14} /><span title={name}>{name}</span>{loading ? <RefreshCw size={13} className="spinning" /> : <ChevronDown size={13} />}</button>
    {open && <div className="worktree-starting-options"><div className="worktree-starting-search"><Search size={13} /><input ref={searchInput} aria-label="Search starting branches" placeholder="Search branches" value={search} onChange={event => setSearch(event.target.value)} /><button type="button" className="icon-button" aria-label="Refresh starting branches" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={13} className={loading ? 'spinning' : ''} /></button></div>
      <div id={id} role="listbox" aria-label="Worktree starting branches">{options.map(entry => <button type="button" role="option" aria-selected={entry.ref === value} tabIndex={-1} key={entry.ref} onClick={() => { onChange(entry.ref); close(); }}><span><strong>{entry.name}</strong><small>{entry.kind === 'current' ? 'Current checkout' : entry.kind === 'remote' ? 'Previously fetched' : 'Local branch'}</small></span>{entry.ref === value ? <Check size={14} /> : <code>{entry.head.slice(0, 7)}</code>}</button>)}{!options.length && <p>No matching branches.</p>}</div>
      {error ? <div className="worktree-starting-error" role="alert">{error}</div> : branches?.limited && <p className="worktree-starting-footnote">Showing 500 recent branches.</p>}
    </div>}
  </div>;
}
