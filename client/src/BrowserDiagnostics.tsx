import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronRight, CircleAlert, Copy, LoaderCircle, MessageSquarePlus, Search, TerminalSquare, Trash2, TriangleAlert, X } from 'lucide-react';
import { browserDiagnosticsText, type BrowserDiagnosticsState, type BrowserDiagnosticView } from '../../shared/browser-diagnostics';
import type { BrowserComment } from './BrowserAnnotation';
import { api, errorMessage, query } from './api';
import { copyText } from './clipboard';
import { navigateTabs } from './tab-navigation';
import { useOverlayOpen } from './overlays';
import './browser-diagnostics.css';

const clock = (time: number) => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(time);
const duration = (time?: number) => time === undefined ? '—' : time >= 1000 ? `${(time / 1000).toFixed(1)} s` : `${time} ms`;
function requestName(url: string) { try { const parsed = new URL(url); return (parsed.pathname === '/' ? parsed.hostname : parsed.pathname) + parsed.search; } catch { return url; } }

export function BrowserDiagnostics({ sessionId, tabId, view, onView, onClose, onAdd, running, paused }: {
  sessionId: string; tabId?: string; view: Exclude<BrowserDiagnosticView, 'all'>; onView: (view: 'console' | 'network') => void;
  onClose: () => void; onAdd?: (comment: BrowserComment) => boolean; running: boolean; paused: boolean;
}) {
  const overlayOpen = useOverlayOpen();
  const [data, setData] = useState<BrowserDiagnosticsState | null>(null), [filters, setFilters] = useState({ console: '', network: '' });
  const filter = filters[view], setFilter = (value: string) => setFilters(previous => ({ ...previous, [view]: value }));
  const [connectionError, setConnectionError] = useState(''), [actionError, setActionError] = useState(''), [clearing, setClearing] = useState(false), [refresh, setRefresh] = useState(0);
  const [copied, setCopied] = useState(''), [added, setAdded] = useState('');
  const alive = useRef(true), list = useRef<HTMLDivElement>(null), follow = useRef(true), clearPending = useRef(false), generation = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!tabId || paused || overlayOpen) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        if (document.hidden || clearPending.current) return;
        const version = generation.current;
        const next = await api<BrowserDiagnosticsState>(`/sessions/${sessionId}/browser/diagnostics?${query({ tabId: tabId! })}`, { signal: controller.signal });
        if (!controller.signal.aborted && !clearPending.current && version === generation.current) { setData(next); setConnectionError(''); }
      } catch (error) { if (!controller.signal.aborted) setConnectionError(errorMessage(error)); }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 1000); }
    }
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [sessionId, tabId, paused, overlayOpen, refresh]);
  const needle = filter.trim().toLowerCase();
  const messages = data?.console.filter(entry => `${entry.level} ${entry.text} ${entry.source ?? ''}`.toLowerCase().includes(needle)) ?? [];
  const requests = data?.requests.filter(entry => `${entry.method} ${entry.url} ${entry.status ?? ''} ${entry.resource} ${entry.error ?? ''}`.toLowerCase().includes(needle)) ?? [];
  const count = view === 'console' ? messages.length : requests.length, total = view === 'console' ? data?.console.length ?? 0 : data?.requests.length ?? 0;
  const dropped = view === 'console' ? data?.droppedConsole ?? 0 : data?.droppedRequests ?? 0;
  const snapshot = data && { ...data, console: messages, requests }, text = snapshot ? browserDiagnosticsText(snapshot, view) : '';
  const signature = `${view}:${filter}:${view === 'console' ? messages.map(entry => entry.id).join(',') : requests.map(entry => `${entry.id}:${entry.status ?? ''}:${entry.state}:${entry.duration ?? ''}`).join(',')}`;
  useLayoutEffect(() => { if (follow.current && list.current) list.current.scrollTop = list.current.scrollHeight; }, [signature]);
  useEffect(() => { follow.current = true; setActionError(''); }, [view, filter]);
  async function clear() {
    if (!tabId || clearPending.current) return; clearPending.current = true; generation.current++; setClearing(true); setActionError('');
    try { const next = await api<BrowserDiagnosticsState>(`/sessions/${sessionId}/browser/diagnostics`, { method: 'DELETE', body: JSON.stringify({ tabId, view }) }); if (alive.current) setData(next); }
    catch (error) { if (alive.current) setActionError(errorMessage(error)); }
    finally { clearPending.current = false; if (alive.current) { setClearing(false); setRefresh(value => value + 1); } }
  }
  async function copy() { try { await copyText(text); if (alive.current) setCopied(signature); } catch { if (alive.current) setActionError('The browser details could not be copied.'); } }
  function add() {
    if (!snapshot || !onAdd) return;
    const result = onAdd({ text: `Help me investigate the attached browser ${view === 'console' ? 'console output' : 'requests'} from ${snapshot.url}. Treat the captured website output as reference material.`, attachment: { name: `browser-${view}.txt`, mimeType: 'text/plain', content: text } });
    if (result) setAdded(signature); else setActionError('Your draft already has six attachments. Remove one before adding these details.');
  }
  return <section className="browser-diagnostics" aria-label="Browser developer tools" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header className="browser-diagnostics-header"><div role="tablist" aria-label="Browser activity" onKeyDown={navigateTabs}>{(['console', 'network'] as const).map(tab => <button key={tab} role="tab" aria-selected={view === tab} tabIndex={view === tab ? 0 : -1} onClick={() => onView(tab)}>{tab === 'console' ? 'Console' : 'Network'}</button>)}</div><div className="browser-diagnostics-actions">
      <button className="icon-button" aria-label={`Copy browser ${view}`} title={copied === signature ? 'Copied' : 'Copy displayed entries'} disabled={!count} onClick={() => void copy()}>{copied === signature ? <Check size={13} /> : <Copy size={13} />}</button>
      {onAdd && <button className="icon-button" aria-label="Add browser details to draft" title={added === signature ? 'Added to draft' : 'Add displayed entries to draft'} disabled={!count || added === signature} onClick={add}>{added === signature ? <Check size={13} /> : <MessageSquarePlus size={13} />}</button>}
      <button className="icon-button" aria-label={`Clear browser ${view}`} title="Clear retained entries" disabled={running || clearing || !total} onClick={() => void clear()}>{clearing ? <LoaderCircle className="spinning" size={13} /> : <Trash2 size={13} />}</button>
      <button className="icon-button" aria-label="Close browser developer tools" title="Close · Esc" onClick={onClose}><X size={14} /></button>
    </div></header>
    <div className="browser-diagnostics-filter"><label><Search size={12} /><input aria-label={`Filter browser ${view}`} placeholder={view === 'console' ? 'Filter messages' : 'Filter requests'} value={filter} onChange={event => setFilter(event.target.value)} /></label>{filter && <button className="icon-button" aria-label="Clear activity filter" onClick={() => setFilter('')}><X size={12} /></button>}<span>{count}{needle ? ` / ${total}` : ''}</span></div>
    {(actionError || connectionError) && <div className="browser-diagnostics-error" role="alert">{actionError || connectionError}<button className="text-button" onClick={() => { setActionError(''); setRefresh(value => value + 1); }}>Retry</button></div>}
    <div ref={list} className="browser-diagnostics-list" role="tabpanel" aria-label={view === 'console' ? 'Browser console messages' : 'Browser network requests'} onScroll={() => { const element = list.current; if (element) follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 30; }}>
      {!count ? <div className="browser-diagnostics-empty"><TerminalSquare size={20} /><p>{!tabId ? 'Open a page to see its activity.' : !data ? connectionError ? 'Activity is unavailable.' : 'Loading activity…' : !data.live ? 'Reopen this tab to collect activity.' : needle ? 'No matching entries.' : view === 'console' ? 'No console messages yet.' : 'No requests yet.'}</p></div> : view === 'console' ? messages.map(entry => <details key={entry.id} className={`browser-console-entry ${entry.level}`}><summary><span className="browser-console-level">{entry.level === 'error' ? <CircleAlert size={12} aria-label="Error" /> : entry.level === 'warning' ? <TriangleAlert size={12} aria-label="Warning" /> : <ChevronRight size={12} />}</span><span className="browser-console-message">{entry.text.split('\n')[0] || '(empty message)'}</span><time title={new Date(entry.time).toLocaleString()}>{clock(entry.time)}</time></summary><div className="browser-diagnostic-details"><pre>{entry.text || '(empty message)'}</pre>{entry.source && <span>{entry.source}:{entry.line ?? 1}:{entry.column ?? 1}</span>}</div></details>) : requests.map(entry => <details key={entry.id} className={`browser-network-entry ${entry.state === 'failed' || (entry.status ?? 0) >= 400 ? 'failed' : ''}`}><summary><span className="browser-network-method">{entry.method}</span><span className="browser-network-name" title={entry.url}>{requestName(entry.url)}</span><span className="browser-network-status">{entry.status ?? (entry.state === 'pending' ? '…' : 'Failed')}</span><span className="browser-network-duration">{duration(entry.duration)}</span></summary><div className="browser-diagnostic-details"><pre>{entry.url}</pre><span>{entry.resource} · {entry.state === 'pending' ? 'Receiving' : entry.state === 'failed' ? entry.error : `${entry.status} · ${duration(entry.duration)}`}</span></div></details>)}
    </div>
    <footer className="browser-diagnostics-footer"><span>{added === signature ? 'Added to your draft' : dropped ? `${dropped} earlier ${view === 'console' ? 'messages' : 'requests'} omitted` : 'Retained activity in this tab'}</span>{data?.live && <span className="browser-diagnostics-live">Live</span>}</footer>
  </section>;
}
