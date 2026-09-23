import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Clock3, Globe2, Search, Trash2, X } from 'lucide-react';
import type { BrowserHistoryResult } from '../../shared/browser';
import { api, errorMessage, query } from './api';

function useHistory(text: string, active: boolean, limit = 100, revision = 0) {
  const [result, setResult] = useState<BrowserHistoryResult>({ entries: [], total: 0 }), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!active) return;
    let disposed = false; const controller = new AbortController(); setLoading(true);
    const timer = setTimeout(() => {
      void api<BrowserHistoryResult>(`/browser/history?${query({ q: text, limit: String(limit) })}`, { signal: controller.signal }).then(value => { if (!disposed) { setResult(value); setError(value.error || ''); } }).catch(error => { if (!disposed) { setResult({ entries: [], total: 0 }); setError(errorMessage(error)); } }).finally(() => { if (!disposed) setLoading(false); });
    }, text ? 140 : 0);
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [text, active, limit, revision]);
  return { result, error, loading };
}
function addressLabel(url: string) { try { const value = new URL(url); return value.host + (value.pathname === '/' ? '' : value.pathname) + value.search; } catch { return url; } }

export function BrowserAddressInput({ value, onChange, onNavigate, input, focused, disabled }: { value: string; onChange: (value: string) => void; onNavigate: (url: string) => void; input: RefObject<HTMLInputElement | null>; focused: RefObject<boolean>; disabled: boolean }) {
  const [open, setOpen] = useState(false), [selected, setSelected] = useState(-1), id = useId();
  const { result, loading } = useHistory(value, open && !disabled, 6);
  const entries = loading ? [] : result.entries, expanded = open && entries.length > 0;
  function choose(url: string) { setOpen(false); setSelected(-1); onChange(url); onNavigate(url); }
  return <div className="browser-address-field">
    <input ref={input} role="combobox" aria-label="Browser address" aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? id : undefined} aria-activedescendant={expanded && selected >= 0 ? `${id}-${selected}` : undefined} placeholder="Search or enter a URL" value={value} disabled={disabled} onFocus={event => { focused.current = true; event.currentTarget.select(); setOpen(true); setSelected(-1); }} onBlur={() => { focused.current = false; setOpen(false); }} onChange={event => { onChange(event.target.value); setOpen(true); setSelected(-1); }} onKeyDown={event => {
      if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
      if (expanded && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setSelected(current => current < 0 ? event.key === 'ArrowDown' ? 0 : entries.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length); }
      else if (event.key === 'Enter' && expanded && selected >= 0 && entries[selected]) { event.preventDefault(); event.stopPropagation(); choose(entries[selected].url); }
      else if (event.key === 'Enter') setOpen(false);
    }} />
    {expanded && <div className="browser-address-suggestions" id={id} role="listbox" aria-label="Browsing history suggestions">{entries.map((entry, index) => <button type="button" role="option" aria-selected={selected === index} id={`${id}-${index}`} tabIndex={-1} key={entry.id} onPointerDown={event => event.preventDefault()} onClick={() => choose(entry.url)}><Clock3 size={14} /><span><strong>{entry.title || addressLabel(entry.url)}</strong><small>{addressLabel(entry.url)}</small></span></button>)}</div>}
  </div>;
}

export function BrowserHistoryPanel({ running, onClose, onOpen }: { running: boolean; onClose: (restoreFocus?: boolean) => void; onOpen: (url: string) => void }) {
  const panel = useRef<HTMLElement>(null), [text, setText] = useState(''), [revision, setRevision] = useState(0), [removing, setRemoving] = useState(''), [actionError, setActionError] = useState('');
  const { result, error, loading } = useHistory(text, true, 100, revision);
  useEffect(() => {
    panel.current?.querySelector('input')?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(true); } };
    const outside = (event: PointerEvent) => { const target = event.target as Element; if (!panel.current?.contains(target) && !target.closest('.browser-history-trigger')) onClose(false); };
    document.addEventListener('keydown', key, true); document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', outside); };
  }, [onClose]);
  async function remove(id: string) {
    setRemoving(id); setActionError('');
    try { await api(`/browser/history/${id}`, { method: 'DELETE' }); setRevision(value => value + 1); }
    catch (error) { setActionError(errorMessage(error)); }
    finally { setRemoving(''); }
  }
  return <section className="browser-downloads browser-history" ref={panel} aria-label="Browsing history">
    <div className="browser-downloads-heading"><span><Clock3 size={15} />History</span><button className="icon-button" aria-label="Close history" onClick={() => onClose(true)}><X size={15} /></button></div>
    <label className="browser-history-search"><Search size={14} /><input aria-label="Search browsing history" placeholder="Search history" value={text} onChange={event => setText(event.target.value)} /></label>
    {(actionError || error) && <div className="inline-alert" role="alert">{actionError || error}</div>}
    <div className="browser-history-list">{result.entries.map(entry => <div key={entry.id}><button disabled={running} className="browser-history-open" title={entry.url} onClick={() => onOpen(entry.url)}><Globe2 size={15} /><span><strong>{entry.title || addressLabel(entry.url)}</strong><small>{addressLabel(entry.url)}</small><time dateTime={new Date(entry.visitedAt).toISOString()}>{new Date(entry.visitedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {new Date(entry.visitedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time></span></button><button className="icon-button" aria-label={`Remove ${entry.title || addressLabel(entry.url)} from history`} disabled={Boolean(removing)} onClick={() => void remove(entry.id)}><Trash2 size={13} /></button></div>)}</div>
    {!result.entries.length && !error && <div className="browser-downloads-empty"><Clock3 size={25} /><strong>{loading ? 'Loading history…' : text ? 'No matching pages' : 'No recent pages'}</strong><span>{text ? 'Try a different title or address.' : 'Pages you visit appear here.'}</span></div>}
    <p className="browser-downloads-note">{result.total > 100 ? 'Search to find older pages. ' : ''}History stays on this computer for 30 days.</p>
  </section>;
}
