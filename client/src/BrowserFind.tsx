import { useEffect, useRef, useState } from 'react';
import { CaseSensitive, ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import type { BrowserAction, BrowserFindResult } from '../../shared/browser';
import './document-find.css';

export function BrowserFind({ tabId, url, result, disabled, busy, action, onClose }: { tabId: string; url: string; result?: BrowserFindResult; disabled: boolean; busy: boolean; action: (input: BrowserAction) => Promise<boolean>; onClose: () => void }) {
  const [term, setTerm] = useState(result?.query ?? ''), [matchCase, setMatchCase] = useState(result?.matchCase ?? false), [pending, setPending] = useState(false), [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null), alive = useRef(true);
  useEffect(() => { alive.current = true; input.current?.focus(); input.current?.select(); return () => { alive.current = false; }; }, []);
  const found = result?.query === term && result.matchCase === matchCase && result.tabId === tabId && result.url === url ? result : undefined;
  useEffect(() => {
    setPending(false);
    if (disabled || !term && !result?.query || result?.query === term && result.matchCase === matchCase) return;
    let live = true;
    setFailed(false);
    const timer = setTimeout(() => {
      setPending(true);
      void action({ action: 'find', tabId, url, text: term, matchCase, findDirection: 'first' }).then(success => { if (live) { setPending(false); setFailed(!success); } });
    }, 180);
    return () => { live = false; clearTimeout(timer); };
  }, [term, matchCase, tabId, url, disabled, action]);
  function next(direction: 'next' | 'previous') {
    if (disabled || busy || pending || !found?.total) return;
    setPending(true); setFailed(false);
    void action({ action: 'find', tabId, url, text: term, matchCase, findDirection: direction }).then(success => { if (alive.current) { setPending(false); setFailed(!success); } });
  }
  function close() { if (!disabled) void action({ action: 'find', tabId, url, text: '', findDirection: 'clear' }); onClose(); }
  return <div className="document-find browser-find" role="search" aria-label="Find on page" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <div className="document-find-input"><Search size={13} /><input ref={input} aria-label="Find on page" placeholder="Find on page…" value={term} disabled={disabled} maxLength={200} onChange={event => setTerm(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); next(event.shiftKey ? 'previous' : 'next'); } }} /><span role="status" title={found?.truncated ? 'This page reached the search limit: 1,000 matches, 50 frames or 2 million characters per frame.' : undefined}>{term ? failed ? 'Unavailable' : !found ? '…' : found.total ? `${found.active + 1} of ${found.total.toLocaleString()}${found.truncated ? '+' : ''}` : found.truncated ? 'No matches · partial' : 'No matches' : ''}</span></div>
    <button className={`icon-button ${matchCase ? 'selected' : ''}`} aria-label="Match case on page" aria-pressed={matchCase} title="Match case" disabled={disabled} onClick={() => setMatchCase(value => !value)}><CaseSensitive size={16} /></button>
    <button className="icon-button" aria-label="Previous page match" title="Previous match · Shift Enter" disabled={disabled || busy || pending || !found?.total} onClick={() => next('previous')}><ChevronUp size={15} /></button>
    <button className="icon-button" aria-label="Next page match" title="Next match · Enter" disabled={disabled || busy || pending || !found?.total} onClick={() => next('next')}><ChevronDown size={15} /></button>
    <button className="icon-button" aria-label="Close page search" title="Close · Escape" onClick={close}><X size={14} /></button>
  </div>;
}
