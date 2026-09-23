import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CaseSensitive, ChevronDown, ChevronUp, Download, RefreshCw, Search, WrapText, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { FilePreview } from '../../shared/file-preview';
import { errorMessage, query } from './api';
import { CopyButton } from './ui';
import { Markdown, WorkspaceLinksContext } from './Conversation';
import { highlightedLines, languageFor } from './syntax';
import type { FileLink } from './file-links';
import { findInDocument, markDocumentLine, type DocumentMatch } from './document-find';
import { readDocumentView, saveDocumentView } from './document-state';
import './document-find.css';
import type { PdfView } from './PdfPreview';
const PdfPreview = lazy(() => import('./PdfPreview'));
const htmlPolicy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";

export function DocumentViewer({ file, workspace, line, lineRevision, storageKey, onRefresh, refreshing, onOpenFile }: { file: FilePreview; workspace: string; line?: number; lineRevision?: number; storageKey?: string; onRefresh?: () => void; refreshing?: boolean; onOpenFile: (link: FileLink) => void }) {
  const extension = file.path.split('.').at(-1)?.toLowerCase();
  const renderable = file.kind !== 'text' || ['md', 'markdown', 'html', 'htm', 'svg'].includes(extension || '');
  const saved = useRef(readDocumentView(storageKey, file.path));
  const [source, setSource] = useState(file.kind === 'text' && (Boolean(line) || !renderable || saved.current.source === true)), [wrap, setWrap] = useState(saved.current.wrap ?? false), [zoom, setZoom] = useState(saved.current.zoom ?? 1);
  const [asset, setAsset] = useState(''), [error, setError] = useState('');
  const assetURL = useRef('');
  const links = useMemo(() => ({ workspace, baseFile: file.path, onFile: onOpenFile }), [workspace, file.path, onOpenFile]);
  const root = useRef<HTMLDivElement>(null), code = useRef<HTMLDivElement>(null), preview = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const [findOpen, setFindOpen] = useState(false), [term, setTerm] = useState(''), [matchCase, setMatchCase] = useState(false), [selected, setSelected] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), focusFrame = useRef(0);
  const scheduleSave = () => { clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => saveDocumentView(storageKey, file.path, saved.current), 150); };
  const rememberPdf = useCallback((view: PdfView, flush = false) => { saved.current = { ...saved.current, ...view }; if (flush) { clearTimeout(saveTimer.current); saveDocumentView(storageKey, file.path, saved.current); } else scheduleSave(); }, [storageKey, file.path]);
  useEffect(() => { saved.current = { ...saved.current, source, wrap, zoom }; scheduleSave(); }, [source, wrap, zoom]);
  useEffect(() => () => { clearTimeout(saveTimer.current); cancelAnimationFrame(focusFrame.current); saveDocumentView(storageKey, file.path, saved.current); }, [storageKey, file.path]);
  function rememberScroll(element: HTMLDivElement, isSource: boolean) {
    saved.current = { ...saved.current, ...(isSource ? { sourceTop: element.scrollTop, sourceLeft: element.scrollLeft } : { previewTop: element.scrollTop, previewLeft: element.scrollLeft }) }; scheduleSave();
  }
  const lines = useMemo(() => highlightedLines(file.content, file.path), [file.content, file.path]);
  const found = useMemo(() => findInDocument(file.content, findOpen && source ? term : '', matchCase), [file.content, findOpen, source, term, matchCase]);
  const active = Math.min(selected, Math.max(0, found.matches.length - 1));
  const displayedLines = useMemo(() => {
    const byLine = new Map<number, DocumentMatch[]>();
    for (const match of found.matches) { const group = byLine.get(match.line) || []; group.push(match); byLine.set(match.line, group); }
    return lines.map((html, index) => markDocumentLine(html, byLine.get(index + 1) || [], active));
  }, [lines, found, active]);
  function openFind() { setSource(true); setFindOpen(true); cancelAnimationFrame(focusFrame.current); focusFrame.current = requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); }); }
  function closeFind() { setFindOpen(false); code.current?.focus({ preventScroll: true }); }
  function nextMatch(direction: number) { if (found.matches.length) setSelected((active + direction + found.matches.length) % found.matches.length); }
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.defaultPrevented || event.shiftKey || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f' || file.kind !== 'text' || document.querySelector('[aria-modal="true"]') || !root.current?.closest('.workspace-panel')?.contains(document.activeElement)) return;
      event.preventDefault(); openFind();
    }
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  }, [file.kind]);
  useLayoutEffect(() => {
    const node = source ? code.current : preview.current; if (!node || source && line) return;
    node.scrollTop = (source ? saved.current.sourceTop : saved.current.previewTop) || 0; node.scrollLeft = (source ? saved.current.sourceLeft : saved.current.previewLeft) || 0;
  }, [source, asset]);
  useLayoutEffect(() => () => {
    // Capture before unmount, even if the browser has not delivered its last scroll event.
    const node = code.current || preview.current;
    if (node) saved.current = { ...saved.current, ...(code.current ? { sourceTop: node.scrollTop, sourceLeft: node.scrollLeft } : { previewTop: node.scrollTop, previewLeft: node.scrollLeft }) };
    saveDocumentView(storageKey, file.path, saved.current);
  }, [storageKey, file.path]);
  useLayoutEffect(() => {
    if (!findOpen || !source) return;
    // Move only for search navigation; refreshed contents must not pull the reader away.
    const frame = requestAnimationFrame(() => code.current?.querySelector(`[data-file-match="${active}"]`)?.scrollIntoView({ block: 'center', inline: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [selected, term, matchCase, findOpen, source]);
  useEffect(() => () => { if (assetURL.current) URL.revokeObjectURL(assetURL.current); }, []);
  useEffect(() => {
    setError('');
    if (file.kind === 'text') return;
    let live = true, url = '';
    const controller = new AbortController();
    void fetch(`/api/file-content?${query({ workspace, path: file.path })}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error((await response.json()).error || 'The preview could not be opened.');
      const blob = await response.blob();
      if (live) { url = URL.createObjectURL(blob); const previous = assetURL.current; assetURL.current = url; setAsset(url); if (previous) URL.revokeObjectURL(previous); }
    }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; controller.abort(); };
  }, [workspace, file]);
  useEffect(() => { if (line) { setFindOpen(false); setSource(true); const frame = requestAnimationFrame(() => code.current?.querySelector(`[data-line="${line}"]`)?.scrollIntoView({ block: 'center' })); return () => cancelAnimationFrame(frame); } }, [line, lineRevision]);
  const download = () => {
    const url = file.kind === 'text' ? URL.createObjectURL(new Blob([file.content], { type: 'text/plain' })) : asset;
    if (!url) return;
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.path.split('/').at(-1)!; anchor.click();
    if (file.kind === 'text') setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="document-viewer" ref={root}>
    <div className="file-preview-toolbar"><span title={file.path}>{file.path}</span>
      {renderable && file.kind === 'text' && <div className="document-view-switch" aria-label="Document view"><button aria-pressed={!source} onClick={() => { setFindOpen(false); setSource(false); }}>Preview</button><button aria-pressed={source} onClick={() => setSource(true)}>Source</button></div>}
      {file.kind === 'text' && <button className={`icon-button ${findOpen ? 'selected' : ''}`} aria-label="Find in file" aria-expanded={findOpen} title="Find in file · ⌘/Ctrl F" onClick={openFind}><Search size={14} /></button>}
      {source && <><button className={`icon-button ${wrap ? 'selected' : ''}`} aria-label="Wrap lines" aria-pressed={wrap} title="Wrap lines" onClick={() => setWrap(v => !v)}><WrapText size={14} /></button><CopyButton text={file.content} /></>}
      {!source && file.kind === 'image' && <><button className="icon-button" aria-label="Zoom out" disabled={zoom <= .5} onClick={() => setZoom(z => z - .25)}><ZoomOut size={14} /></button><button className="icon-button" aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom(z => z + .25)}><ZoomIn size={14} /></button></>}
      {onRefresh && <button className="icon-button" aria-label="Refresh workspace" title="Refresh file" disabled={refreshing} onClick={onRefresh}><RefreshCw size={14} className={refreshing ? 'spinning' : ''} /></button>}
      <button className="icon-button" aria-label="Download file" title="Download" disabled={file.truncated || file.kind !== 'text' && !asset} onClick={download}><Download size={14} /></button>
    </div>
    {findOpen && source && <div className="document-find" role="search" aria-label="Find in file" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeFind(); } }}>
      <div className="document-find-input"><Search size={13} /><input ref={input} aria-label="Find in file" placeholder="Find in file…" value={term} maxLength={200} onChange={event => { setTerm(event.target.value); setSelected(0); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); nextMatch(event.shiftKey ? -1 : 1); } }} /><span role="status">{term ? found.matches.length ? `${active + 1} of ${found.matches.length.toLocaleString()}${found.more ? '+' : ''}` : 'No matches' : ''}</span></div>
      <button className={`icon-button ${matchCase ? 'selected' : ''}`} aria-label="Match case" aria-pressed={matchCase} title="Match case" onClick={() => { setMatchCase(value => !value); setSelected(0); }}><CaseSensitive size={16} /></button>
      <button className="icon-button" aria-label="Previous match" title="Previous match · Shift Enter" disabled={!found.matches.length} onClick={() => nextMatch(-1)}><ChevronUp size={15} /></button><button className="icon-button" aria-label="Next match" title="Next match · Enter" disabled={!found.matches.length} onClick={() => nextMatch(1)}><ChevronDown size={15} /></button><button className="icon-button" aria-label="Close file search" title="Close · Escape" onClick={closeFind}><X size={14} /></button>
    </div>}
    {file.truncated && <div className="quiet-callout">Showing the first part of this large file.</div>}
    {error && <div className="inline-alert" role="alert">{error}</div>}
    {source ? <div ref={code} onScroll={event => rememberScroll(event.currentTarget, true)} className={`code-view ${wrap ? 'wrap-lines' : ''}`} aria-label={file.path} tabIndex={0}>{file.content ? displayedLines.map((html, index) => <div className={`code-line ${!findOpen && line === index + 1 ? 'highlighted-line' : ''}`} data-line={index + 1} key={index}><span className="line-number" aria-hidden="true">{index + 1}</span><code dangerouslySetInnerHTML={{ __html: html || '&nbsp;' }} /></div>) : <div className="empty-file">This file is empty.</div>}</div>
      : file.kind === 'image' ? <div ref={preview} onScroll={event => rememberScroll(event.currentTarget, false)} className="image-preview">{asset ? <img src={asset} alt={file.path.split('/').at(-1)} style={{ width: `${zoom * 100}%`, maxWidth: zoom <= 1 ? '100%' : 'none' }} /> : !error && <span>Opening image…</span>}</div>
      : file.kind === 'pdf' ? asset && <Suspense fallback={<div className="panel-loading">Opening document…</div>}><PdfPreview url={asset} initialView={saved.current} onViewChange={rememberPdf} /></Suspense>
      : extension === 'md' || extension === 'markdown' ? <WorkspaceLinksContext.Provider value={links}><div ref={preview} onScroll={event => rememberScroll(event.currentTarget, false)} className="document-markdown markdown" tabIndex={0}><Markdown content={file.content} renderImages /></div></WorkspaceLinksContext.Provider>
      : <iframe className="html-preview" title={`Preview of ${file.path}`} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${htmlPolicy}"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${file.content}</body></html>`} />}
    <div className="document-status"><span>{file.kind === 'text' ? `${file.content ? lines.length : 0} lines` : `${Math.max(1, Math.round(file.size / 1024))} KB`}</span><span>{file.kind === 'text' ? languageFor(file.path) : file.kind.toUpperCase()}</span><span>Read only</span></div>
  </div>;
}
