import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Archive, ArrowUpRight, LoaderCircle, MessageSquare, Search, X } from 'lucide-react';
import type { TaskSearchItem, TaskSearchResult } from '../../shared/task-search';
import { api, errorMessage, query } from './api';
import { Modal } from './ui';
import './task-search.css';

function Highlight({ text, term }: { text: string; term: string }) {
  const words = [...new Set(term.trim().split(/\s+/).filter(Boolean))].sort((a, b) => b.length - a.length).slice(0, 20);
  if (!words.length) return <>{text}</>;
  const pattern = new RegExp(`(${words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'giu');
  return <>{text.split(pattern).map((part, index) => index % 2 ? <mark key={index}>{part}</mark> : part)}</>;
}
const projectName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) || path;
function date(value: number) { return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(new Date(value).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) }); }

export function TaskSearch({ projects, onClose, onOpen }: { projects: string[]; onClose: () => void; onOpen: (item: TaskSearchItem) => void }) {
  const [text, setText] = useState(''), [project, setProject] = useState(''), [includeArchived, setIncludeArchived] = useState(true), [retry, setRetry] = useState(0);
  const [response, setResponse] = useState<{ key: string; value: TaskSearchResult } | null>(null), [error, setError] = useState(''), [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null), id = useId(), key = JSON.stringify([text, project, includeArchived]), result = response?.key === key ? response.value : null;
  const items = result?.items || [], active = items[selected], selection = useRef<string | undefined>(undefined); selection.current = active?.id;
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>, canceled = false;
    setError(''); setSelected(0);
    async function search() {
      try {
        const value = await api<TaskSearchResult>(`/task-search?${query({ query: text.trim(), ...(project ? { project } : {}), includeArchived: String(includeArchived) })}`, { signal: controller.signal });
        if (canceled) return;
        const previous = selection.current; setResponse({ key, value }); setSelected(Math.max(0, value.items.findIndex(item => item.id === previous)));
        if (value.indexing) timer = setTimeout(() => void search(), 350);
      } catch (cause) { if (!canceled) { setResponse(null); setError(errorMessage(cause)); } }
    }
    timer = setTimeout(() => void search(), text.trim() ? 180 : 0);
    return () => { canceled = true; controller.abort(); clearTimeout(timer); };
  }, [key, retry]);
  useLayoutEffect(() => { if (active) document.getElementById(`${id}-${active.id}`)?.scrollIntoView({ block: 'nearest' }); }, [active?.id, id]);
  return <Modal title="Search tasks" onClose={onClose}><div className="task-search">
    <div className="task-search-input"><Search size={18} /><input ref={input} autoFocus type="search" maxLength={200} placeholder="Search task names or messages…" aria-label="Search task names or messages" role="combobox" aria-expanded="true" aria-controls={`${id}-results`} aria-activedescendant={active ? `${id}-${active.id}` : undefined} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSelected(index => Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))); }
      if (event.key === 'Enter') { event.preventDefault(); if (active) onOpen(active); }
    }} />{text && <button className="icon-button" aria-label="Clear task search" onClick={() => { setText(''); input.current?.focus(); }}><X size={15} /></button>}</div>
    <div className="task-search-filters"><select aria-label="Search project" value={project} onChange={event => setProject(event.target.value)}><option value="">All projects</option>{[...new Set([...projects, ...response?.value.projects || [], ...(project ? [project] : [])])].map(path => <option key={path} value={path}>{projectName(path)}</option>)}</select><label><input type="checkbox" checked={includeArchived} onChange={event => setIncludeArchived(event.target.checked)} />Include archived</label></div>
    <div className="task-search-results" role="listbox" id={`${id}-results`} aria-label={text.trim() ? 'Matching tasks' : 'Recent tasks'} aria-busy={!result && !error || result?.indexing}>
      {items.map((item, index) => <button key={item.id} id={`${id}-${item.id}`} type="button" role="option" aria-label={item.title || 'Untitled task'} aria-describedby={`${id}-${item.id}-description`} aria-selected={index === selected} tabIndex={-1} className={index === selected ? 'selected' : ''} onMouseMove={() => setSelected(index)} onClick={() => onOpen(item)}><MessageSquare size={16} /><span><strong><Highlight text={item.title || 'Untitled task'} term={text} /></strong><span id={`${id}-${item.id}-description`}>{item.snippet && <span className="task-search-snippet"><Highlight text={item.snippet.replace(/\s+/g, ' ')} term={text} /></span>}<small><span title={item.project}>{projectName(item.project)}</span><span>·</span><time dateTime={new Date(item.updatedAt).toISOString()}>{date(item.updatedAt)}</time>{item.archived && <span className="task-search-archived"><Archive size={11} />Archived</span>}</small></span></span><ArrowUpRight size={14} /></button>)}
      {error ? <div className="task-search-empty"><Search size={24} /><strong>Search is unavailable</strong><p role="alert">{error}</p><button className="button secondary" onClick={() => setRetry(value => value + 1)}>Try again</button></div> : !result ? <div className="task-search-empty" role="status"><LoaderCircle size={22} className="spinning" /><span>Searching your tasks…</span></div> : !items.length ? <div className="task-search-empty"><Search size={24} /><strong>{result.indexing ? 'Searching older conversations…' : text.trim() ? 'No matching tasks' : 'No tasks here yet'}</strong><p>{result.indexing ? 'Your saved history is being added to search.' : text.trim() ? 'Try a different word or search all projects.' : 'Start a conversation and it will appear here.'}</p></div> : null}
    </div>
    <div className="task-search-footer"><span role="status">{result?.indexing ? 'Updating older conversations…' : result?.more ? 'First 50 matches · Refine your search for more' : text.trim() && result ? `${items.length} ${items.length === 1 ? 'task' : 'tasks'} found` : 'Recent tasks'}</span><span><kbd>↑</kbd><kbd>↓</kbd> to navigate <kbd>↵</kbd> to open</span></div>
  </div></Modal>;
}
