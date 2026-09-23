import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Clock3, CornerDownLeft, Download, ExternalLink, Globe2, Keyboard, LoaderCircle, MessageSquarePlus, Plus, RefreshCw, Search, TerminalSquare, X } from 'lucide-react';
import { EmptyState } from './ui';
import { useBrowser } from './use-browser';
import { navigateTabs } from './tab-navigation';
import { BrowserDownloads } from './BrowserDownloads';
import { BrowserUpload } from './BrowserUpload';
import { BrowserDiagnostics } from './BrowserDiagnostics';
import { BrowserFind } from './BrowserFind';
import { useBrowserSelection } from './BrowserSelection';
import { BrowserAddressInput, BrowserHistoryPanel } from './BrowserHistory';
import { browserAddress, type BrowserAction } from '../../shared/browser';
import { BrowserAnnotation, captureBrowserAnnotation, restoreBrowserAnnotation, type BrowserComment, type BrowserCommentRegion, type BrowserAnnotationSnapshot } from './BrowserAnnotation';
import { useSessionDraft, errorMessage } from './api';
import './browser-links.css';

type Gesture = { x: number; y: number; toX: number; toY: number; clientX: number; clientY: number; tabId: string; url: string; revision: number; width: number; height: number; at: number; pointerId: number; modifiers: BrowserAction['modifiers']; moved: boolean };
export function BrowserPanel({ sessionId, running, onComment, openRequest, onOpenRequestHandled }: { sessionId?: string; running: boolean; onComment?: (comment: BrowserComment) => boolean; openRequest?: { url: string; revision: number }; onOpenRequestHandled?: (revision: number) => void }) {
  const commentDraft = useSessionDraft(`browser-feedback:${sessionId || 'new'}`), annotation = restoreBrowserAnnotation(commentDraft.draft);
  const { ready, state, stateRef, frame, busy, navigationBusy, stopping, stopLoading, address, setAddress, addressFocused, action, upload, error, clearError } = useBrowser(sessionId, running, Boolean(annotation));
  const handledLink = useRef<number | undefined>(undefined), alive = useRef(true);
  const [linkError, setLinkError] = useState('');
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!sessionId || !ready || !openRequest || running || busy || annotation || handledLink.current === openRequest.revision) return;
    handledLink.current = openRequest.revision; onOpenRequestHandled?.(openRequest.revision); setLinkError('');
    let url: string;
    try { const target = new URL(openRequest.url); if (!['http:', 'https:'].includes(target.protocol)) throw new Error(); url = target.href; }
    catch { setLinkError('This link cannot be opened in the task browser.'); return; }
    const tab = stateRef.current.tabs.find(tab => tab.url === url);
    if (tab && !tab.suspended && tab.id === stateRef.current.activeId) return;
    void action(tab ? { action: tab.suspended ? 'resume' : 'select', tabId: tab.id } : { action: 'open', url }).then(success => { if (!success && alive.current) setLinkError('The link wasn’t opened. You can try it again from the conversation.'); });
  }, [sessionId, ready, openRequest?.revision, running, busy, Boolean(annotation), action]);
  const [typing, setTyping] = useState(false), [text, setText] = useState('');
  const [findOpen, setFindOpen] = useState(false);
  const [gesture, setGesture] = useState<Gesture | null>(null), dragging = useRef<Gesture | null>(null);
  const cancelGesture = useCallback(() => { dragging.current = null; setGesture(null); }, []);
  const typingButton = useRef<HTMLButtonElement>(null);
  function closeTyping() { setTyping(false); typingButton.current?.focus(); }
  const panel = useRef<HTMLDivElement>(null), commandHandler = useRef<(command: string) => boolean>(() => false);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const downloadsButton = useRef<HTMLButtonElement>(null);
  const diagnosticsButton = useRef<HTMLButtonElement>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false), [diagnosticView, setDiagnosticView] = useState<'console' | 'network'>('console');
  const closeDiagnostics = useCallback(() => { setDiagnosticsOpen(false); requestAnimationFrame(() => diagnosticsButton.current?.focus()); }, []);
  useEffect(() => { if (diagnosticsOpen) panel.current?.querySelector<HTMLElement>('.browser-diagnostics [aria-selected="true"]')?.focus(); }, [diagnosticsOpen]);
  const historyButton = useRef<HTMLButtonElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false), closeHistory = useCallback((restoreFocus = true) => { setHistoryOpen(false); if (restoreFocus) historyButton.current?.focus(); }, []);
  const [downloadsOpen, setDownloadsOpen] = useState(false), closeDownloads = useCallback((restoreFocus = true) => { setDownloadsOpen(false); if (restoreFocus) downloadsButton.current?.focus(); }, []);
  const downloads = state.downloads || [];
  const [commentError, setCommentError] = useState('');
  const previewImage = useRef<HTMLImageElement>(null), commentButton = useRef<HTMLButtonElement>(null);
  const restoreCommentFocus = useRef(false);
  const viewport = useRef<HTMLDivElement>(null), addressInput = useRef<HTMLInputElement>(null);
  const current = state.tabs.find(t => t.id === state.activeId);
  const canStop = Boolean(current?.loading && current.navigationId && !running);
  const interactive = Boolean(current && !current.suspended);
  const pageDisabled = !interactive || running || busy;
  const navigationDisabled = !interactive || running || navigationBusy;
  const selection = useBrowserSelection({ sessionId, state, disabled: !interactive || running || Boolean(annotation), viewport, onAdd: onComment });
  const previewFits = Boolean(frame && viewport.current && frame.width === Math.max(320, Math.min(1280, Math.round(viewport.current.clientWidth))) && frame.height === Math.max(240, Math.min(1200, Math.round(viewport.current.clientHeight))));
  const controls = useRef({ running, action, commenting: Boolean(annotation) }); controls.current = { running, action, commenting: Boolean(annotation) };
  useEffect(cancelGesture, [cancelGesture, state.activeId, state.revision, state.width, state.height, running, busy, Boolean(annotation), previewFits]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) cancelGesture(); };
    window.addEventListener('blur', cancelGesture); document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('blur', cancelGesture); document.removeEventListener('visibilitychange', hidden); };
  }, [cancelGesture]);
  useEffect(() => {
    if (restoreCommentFocus.current && !annotation && commentButton.current && !commentButton.current.disabled) {
      restoreCommentFocus.current = false;
      if (document.activeElement === document.body) commentButton.current.focus();
    }
  });
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let resizeTimer: ReturnType<typeof setTimeout>, scrollTimer: ReturnType<typeof setTimeout>, scroll = 0;
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const next = stateRef.current;
        if (controls.current.running || controls.current.commenting || !next.activeId) return;
        const width = Math.max(320, Math.min(1280, Math.round(element.clientWidth)));
        const height = Math.max(240, Math.min(1200, Math.round(element.clientHeight)));
        if (next.width !== width || next.height !== height) void controls.current.action({ action: 'resize', width, height });
      }, 220);
    });
    observer.observe(element);
    const wheel = (event: WheelEvent) => {
      if (dragging.current) { event.preventDefault(); return; }
      if (controls.current.running || !stateRef.current.activeId || stateRef.current.tabs.find(tab => tab.id === stateRef.current.activeId)?.suspended) return;
      event.preventDefault(); scroll += event.deltaY * (event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? element.clientHeight : 1);
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => { const delta = Math.max(-5000, Math.min(5000, Math.round(scroll))); scroll = 0; if (delta) void controls.current.action({ action: 'scroll', delta, tabId: stateRef.current.activeId! }); }, 75);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); clearTimeout(resizeTimer); clearTimeout(scrollTimer); element.removeEventListener('wheel', wheel); };
  }, [current?.id, running, stateRef, Boolean(annotation)]);
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (dragging.current) { event.preventDefault(); event.stopPropagation(); if (event.key === 'Escape') cancelGesture(); return; }
    if (running || !current || current.suspended) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); event.stopPropagation(); void selection.copy(); return; }
    if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); event.stopPropagation(); selection.open(); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (canStop) void stopLoading(); addressInput.current?.focus(); return; }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); event.stopPropagation(); void action({ action: 'key', key: 'ControlOrMeta+A', tabId: current.id }); return; }
    if (event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return;
    if (event.key.length === 1) { event.preventDefault(); event.stopPropagation(); void action({ action: 'type', text: event.key, tabId: current.id }); }
    else if (['Tab', 'Backspace', 'Delete', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); void action({ action: 'key', key: `${event.shiftKey ? 'Shift+' : ''}${event.key}`, tabId: current.id });
    }
  }
  function browserCommand(command: string): boolean {
    if (!['address', 'reload', 'back', 'forward', 'new-tab', 'close-tab', 'next-tab', 'previous-tab', 'find'].includes(command) || annotation) return false;
    if (running) return true;
    cancelGesture();
    if (command === 'address') { addressInput.current?.focus(); addressInput.current?.select(); return true; }
    if (command === 'find') { if (interactive && !current?.loading) { setFindOpen(true); requestAnimationFrame(() => { const input = panel.current?.querySelector<HTMLInputElement>('.browser-find input'); input?.focus(); input?.select(); }); } return true; }
    if (navigationBusy) return true;
    if (command === 'new-tab') { void action({ action: 'open' }).then(success => { if (success) addressInput.current?.focus(); }); return true; }
    if (!current) return command !== 'close-tab';
    if (command === 'close-tab') { void action({ action: 'close', tabId: current.id }).then(success => { if (success) addressInput.current?.focus(); }); return true; }
    if (command === 'next-tab' || command === 'previous-tab') {
      const index = state.tabs.findIndex(tab => tab.id === current.id), next = (index + (command === 'previous-tab' ? -1 : 1) + state.tabs.length) % state.tabs.length;
      void action({ action: 'select', tabId: state.tabs[next].id }); return true;
    }
    if (command === 'reload') void action({ action: current.suspended ? 'resume' : 'reload' });
    else if (!current.suspended && command === 'back' && current.canGoBack !== false) void action({ action: 'back' });
    else if (!current.suspended && command === 'forward' && current.canGoForward !== false) void action({ action: 'forward' });
    return true;
  }
  commandHandler.current = browserCommand;
  useEffect(() => {
    const handle = (event: Event) => { if (!event.defaultPrevented && !document.querySelector('[aria-modal="true"]') && panel.current?.contains(document.activeElement) && commandHandler.current((event as CustomEvent<string>).detail)) event.preventDefault(); };
    window.addEventListener('litespeed:workspace-command', handle);
    return () => window.removeEventListener('litespeed:workspace-command', handle);
  }, []);
  function shortcut(event: KeyboardEvent<HTMLDivElement>) {
    if (annotation || event.nativeEvent.isComposing) return;
    const modifier = event.metaKey || event.ctrlKey, key = event.key.toLowerCase();
    const command = modifier && !event.shiftKey && key === 'l' ? 'address'
      : modifier && !event.shiftKey && key === 'f' ? 'find'
      : modifier && !event.shiftKey && key === 'r' ? 'reload'
      : modifier && event.shiftKey && (key === '[' || key === '{') ? 'previous-tab'
      : modifier && event.shiftKey && (key === ']' || key === '}') ? 'next-tab'
      : !mac && event.altKey && key === 'arrowleft' || modifier && key === '[' ? 'back'
      : !mac && event.altKey && key === 'arrowright' || modifier && key === ']' ? 'forward'
      : modifier && !event.shiftKey && key === 't' ? 'new-tab'
      : modifier && !event.shiftKey && key === 'w' ? 'close-tab'
      : event.ctrlKey && key === 'tab' ? event.shiftKey ? 'previous-tab' : 'next-tab' : '';
    if (command && browserCommand(command)) { event.preventDefault(); event.stopPropagation(); }
  }
  function navigate(e: FormEvent) { e.preventDefault(); if (address.trim()) void action({ action: 'navigate', url: browserAddress(address, state.preferences?.searchEngine) }); }
  function saveAnnotation(snapshot: BrowserAnnotationSnapshot, selection: BrowserCommentRegion | null, text: string) {
    const { image, ...metadata } = snapshot;
    commentDraft.setText(text); commentDraft.setAttachments([{ name: 'browser-comment-draft.jpg', dataUrl: image, mimeType: 'image/jpeg', content: JSON.stringify({ ...metadata, selection }) }]);
  }
  function startComment() {
    if (!previewImage.current || !frame || frame.tabId !== current?.id) return;
    if (previewImage.current.naturalWidth !== frame.width || previewImage.current.naturalHeight !== frame.height) return;
    try { setCommentError(''); setDownloadsOpen(false); setHistoryOpen(false); saveAnnotation({ ...captureBrowserAnnotation(previewImage.current, frame.pageUrl, frame.title), tabId: current.id }, null, ''); }
    catch (error) { setCommentError(errorMessage(error)); }
  }
  function point(event: PointerEvent<HTMLImageElement>, width: number, height: number) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(width - 1, Math.max(0, Math.floor((event.clientX - bounds.left) / bounds.width * width))), y: Math.min(height - 1, Math.max(0, Math.floor((event.clientY - bounds.top) / bounds.height * height))), inside: event.clientX >= bounds.left && event.clientX < bounds.right && event.clientY >= bounds.top && event.clientY < bounds.bottom };
  }
  function pointerDown(event: PointerEvent<HTMLImageElement>) {
    if (pageDisabled || !previewFits || !frame || frame.tabId !== current?.id || frame.pageUrl !== current.url || event.button !== 0 || !event.isPrimary || dragging.current) return;
    if (!event.currentTarget.complete || event.currentTarget.naturalWidth !== state.width || event.currentTarget.naturalHeight !== state.height || frame.width !== state.width || frame.height !== state.height) return;
    event.preventDefault(); viewport.current?.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    const start = point(event, frame.width, frame.height), modifiers: BrowserAction['modifiers'] = [];
    if (event.shiftKey) modifiers.push('Shift'); if (event.ctrlKey) modifiers.push('Control'); if (event.altKey) modifiers.push('Alt'); if (event.metaKey) modifiers.push('Meta');
    dragging.current = { ...start, toX: start.x, toY: start.y, clientX: event.clientX, clientY: event.clientY, tabId: current.id, url: current.url, revision: state.revision, width: frame.width, height: frame.height, at: Date.now(), pointerId: event.pointerId, modifiers, moved: false };
  }
  function pointerMove(event: PointerEvent<HTMLImageElement>) {
    const start = dragging.current; if (!start || start.pointerId !== event.pointerId) return;
    const to = point(event, start.width, start.height), moved = start.moved || Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) >= 4;
    dragging.current = { ...start, toX: to.x, toY: to.y, moved }; if (moved) setGesture(dragging.current);
  }
  function pointerUp(event: PointerEvent<HTMLImageElement>) {
    const start = dragging.current; cancelGesture();
    if (!start || start.pointerId !== event.pointerId || pageDisabled || !previewFits || state.activeId !== start.tabId || state.revision !== start.revision || state.width !== start.width || state.height !== start.height) return;
    const to = point(event, start.width, start.height); if (!to.inside) return;
    const moved = start.moved || Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) >= 4;
    void action({ action: moved ? 'drag' : 'click', tabId: start.tabId, url: start.url, revision: start.revision, width: start.width, height: start.height, x: start.x, y: start.y, ...(moved ? { toX: to.x, toY: to.y, durationMs: Math.max(100, Math.min(2000, Date.now() - start.at)), modifiers: start.modifiers } : {}) });
  }
  if (!sessionId) return <EmptyState icon={<Globe2 size={28} />} title="A browser for your task">Start a conversation, then open a page here.</EmptyState>;
  return <div ref={panel} className="browser-panel" onKeyDownCapture={shortcut}>
    {openRequest && <div className="browser-pending-link" role="status"><Globe2 size={14} /><span><strong>{annotation ? 'Finish your page comment to open this link' : running ? 'Link will open when this task is ready' : 'Opening link…'}</strong><small title={openRequest.url}>{openRequest.url}</small></span><button className="icon-button" aria-label="Cancel opening link" title="Cancel opening link" onClick={() => onOpenRequestHandled?.(openRequest.revision)}><X size={14} /></button></div>}
    <div className="browser-surface">{annotation && onComment && <BrowserAnnotation sessionId={sessionId} running={running} snapshot={annotation.snapshot} initialSelection={annotation.selection} text={commentDraft.draft.text} notice={commentDraft.notice} onDraft={(selection, text, snapshot = annotation.snapshot) => saveAnnotation(snapshot, selection, text)} onClose={(restoreFocus = true) => { restoreCommentFocus.current = restoreFocus; commentDraft.clearSubmitted(commentDraft.draft); }} onComment={onComment} />}
    <div className="browser-live" inert={Boolean(annotation)}><div className="browser-tabs" role="tablist" aria-label="Browser tabs" onKeyDown={navigateTabs}>{state.tabs.map(tab => <div className={tab.id === state.activeId ? 'active' : ''} key={tab.id}><button role="tab" tabIndex={tab.id === state.activeId ? 0 : -1} aria-selected={tab.id === state.activeId} disabled={navigationBusy || running} title={tab.url} onClick={() => void action({ action: 'select', tabId: tab.id })}><span className="browser-tab-icon">{tab.loading ? <LoaderCircle size={13} className="spinning" /> : <Globe2 size={13} />}</span><span>{tab.title || (tab.url === 'about:blank' ? 'New tab' : tab.url)}</span></button><button aria-label={`Close browser tab ${tab.title || 'New tab'}`} disabled={navigationBusy || running} onClick={() => void action({ action: 'close', tabId: tab.id })}><X size={12} /></button></div>)}<button className="icon-button" aria-label="New browser tab" title="New tab · ⌘/Ctrl T" disabled={navigationBusy || running} onClick={() => void action({ action: 'open' }).then(success => { if (success) addressInput.current?.focus(); })}><Plus size={15} /></button></div>
    <form className="browser-addressbar" onSubmit={navigate}><button className="icon-button" type="button" aria-label="Browser back" title={mac ? 'Back · ⌘ [' : 'Back · Alt ←'} disabled={navigationDisabled || current?.canGoBack === false} onClick={() => void action({ action: 'back' })}><ArrowLeft size={15} /></button><button className="icon-button" type="button" aria-label="Browser forward" title={mac ? 'Forward · ⌘ ]' : 'Forward · Alt →'} disabled={navigationDisabled || current?.canGoForward === false} onClick={() => void action({ action: 'forward' })}><ArrowRight size={15} /></button><button className="icon-button" type="button" aria-label={canStop ? 'Stop loading page' : current?.suspended ? 'Reopen saved page' : 'Reload page'} title={canStop ? 'Stop loading · Esc in page' : undefined} disabled={canStop ? stopping : !current || navigationBusy || running} onClick={() => { if (canStop) void stopLoading(); else void action({ action: current?.suspended ? 'resume' : 'reload' }); }}>{canStop ? <X size={15} /> : busy ? <LoaderCircle size={14} className="spinning" /> : <RefreshCw size={14} />}</button><BrowserAddressInput value={address} onChange={setAddress} input={addressInput} focused={addressFocused} disabled={running} onNavigate={url => { void action({ action: 'navigate', url }); }} /><button className="icon-button" aria-label="Go to address" disabled={!address.trim() || navigationBusy || running}><ArrowRight size={15} /></button></form>
    {findOpen && current && !current.suspended && <BrowserFind key={`${current.id}:${current.url}`} tabId={current.id} url={current.url} result={state.find} disabled={running || Boolean(current.loading)} busy={busy} action={action} onClose={() => { setFindOpen(false); viewport.current?.focus({ preventScroll: true }); }} />}
    {(error || commentError || linkError) && <div className="inline-alert" role="alert">{error || commentError || linkError}<button className="icon-button" aria-label="Dismiss browser error" onClick={() => { clearError(); setCommentError(''); setLinkError(''); }}><X size={14} /></button></div>}
    {downloadsOpen && <BrowserDownloads sessionId={sessionId} downloads={downloads} running={running} onClose={closeDownloads} onChange={() => void action({ action: 'downloads' })} />}
    {historyOpen && <BrowserHistoryPanel running={running} onClose={closeHistory} onOpen={url => { closeHistory(false); void action({ action: 'navigate', url }); }} />}
    {state.upload && <BrowserUpload key={state.upload.id} request={state.upload} disabled={busy || running} onAction={upload} onDone={() => viewport.current?.focus()} />}
    <div ref={viewport} className="browser-viewport" aria-description="Drag to move controls or select text. Tab moves between website controls. Escape cancels a drag, or returns to the address bar." tabIndex={interactive ? 0 : -1} aria-label="Interactive browser page" onContextMenu={event => { event.preventDefault(); cancelGesture(); selection.open(event.clientX, event.clientY); }} onKeyDown={keyboard} onPaste={event => { if (!dragging.current && !running && current && !current.suspended) { event.preventDefault(); void action({ action: 'type', text: event.clipboardData.getData('text/plain').slice(0, 12000), tabId: current.id }); } }} onCompositionEnd={event => { if (!dragging.current && !running && current && !current.suspended && event.data) void action({ action: 'type', text: event.data, tabId: current.id }); }}>{current?.suspended ? <div className="browser-suspended"><Globe2 size={30} /><strong>Saved tab</strong><p>Reopen this page to continue.</p><button className="button secondary" disabled={busy || running} onClick={() => void action({ action: 'resume', tabId: current.id })}>{busy ? 'Opening…' : 'Reopen tab'}</button></div> : frame && frame.tabId === current?.id && current?.url !== 'about:blank' ? <div className="browser-image-frame"><img ref={previewImage} src={frame.url} alt={`Browser preview of ${current?.title || current?.url || 'the current page'}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancelGesture} onLostPointerCapture={cancelGesture} draggable={false} className={running ? 'agent-controlled' : ''} />{gesture?.moved && <svg className="browser-drag-guide" viewBox={`0 0 ${gesture.width} ${gesture.height}`} aria-hidden="true"><line x1={gesture.x} y1={gesture.y} x2={gesture.toX} y2={gesture.toY} /><circle cx={gesture.x} cy={gesture.y} r="4" /><circle cx={gesture.toX} cy={gesture.toY} r="6" /></svg>}</div> : <EmptyState icon={<Globe2 size={32} />} title={busy ? 'Opening browser…' : 'Where would you like to go?'}>{busy ? 'Your page will appear here.' : 'Open a website or preview your local app.'}</EmptyState>}</div>
    {typing && interactive && <form className="browser-type-bar" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeTyping(); } }} onSubmit={e => { e.preventDefault(); const submitted = text; void action({ action: 'type', text: submitted }).then(success => { if (success) setText(current => current === submitted ? '' : current); }); }}><input autoFocus aria-label="Text to type into page" placeholder="Type into the selected field…" value={text} onChange={e => setText(e.target.value)} disabled={running} /><button className="icon-button" aria-label="Type text into page" disabled={busy || running || !text}><ArrowUp size={15} /></button><span className="browser-type-divider" /><button type="button" className="icon-button" aria-label="Press Enter in page" title="Press Enter" disabled={pageDisabled} onClick={() => void action({ action: 'key', key: 'Enter' })}><CornerDownLeft size={14} /></button><button type="button" className="icon-button" aria-label="Scroll page up" title="Scroll up" disabled={pageDisabled} onClick={() => void action({ action: 'scroll', delta: -600 })}><ArrowUp size={14} /></button><button type="button" className="icon-button" aria-label="Scroll page down" title="Scroll down" disabled={pageDisabled} onClick={() => void action({ action: 'scroll', delta: 600 })}><ArrowDown size={14} /></button><button type="button" className="icon-button" aria-label="Close typing bar" onClick={closeTyping}><X size={14} /></button></form>}
    {diagnosticsOpen && <BrowserDiagnostics key={current?.id || 'no-tab'} sessionId={sessionId} tabId={current?.id} running={running} paused={Boolean(annotation)} view={diagnosticView} onView={setDiagnosticView} onClose={closeDiagnostics} onAdd={onComment} />}
    <div className="browser-statusbar"><span role={selection.notice ? 'status' : undefined}>{selection.notice || (running ? <><span className="working-dot" />Agent has control</> : stopping ? 'Stopping…' : busy || current?.loading ? 'Loading…' : current?.suspended ? 'Saved with this task' : current ? gesture ? 'Release to drag · Esc to cancel' : 'Click, drag and type · Esc to leave' : 'Task browser')}</span><div><button className={`icon-button ${findOpen ? 'selected' : ''}`} aria-label="Find on page" aria-expanded={findOpen} title="Find on page · ⌘/Ctrl F" disabled={!interactive || running || Boolean(current?.loading)} onClick={() => browserCommand('find')}><Search size={15} /></button>{onComment && <button ref={commentButton} className="icon-button" aria-label="Comment on browser page" title="Comment on this page" disabled={pageDisabled || !previewFits || !frame || frame.tabId !== current?.id || current?.url === 'about:blank'} onClick={startComment}><MessageSquarePlus size={14} /></button>}<button ref={diagnosticsButton} className={`icon-button ${diagnosticsOpen ? 'selected' : ''}`} aria-label="Browser developer tools" aria-expanded={diagnosticsOpen} title="Console and network" onClick={() => { setDownloadsOpen(false); setHistoryOpen(false); setDiagnosticsOpen(value => !value); }}><TerminalSquare size={15} /></button><button ref={historyButton} className={`icon-button browser-history-trigger ${historyOpen ? 'selected' : ''}`} aria-label="Browser history" aria-expanded={historyOpen} title="History" onClick={() => { setDownloadsOpen(false); setHistoryOpen(value => !value); }}><Clock3 size={15} /></button><button ref={downloadsButton} className={`icon-button browser-downloads-trigger ${downloadsOpen ? 'selected' : ''}`} aria-label="Browser downloads" aria-expanded={downloadsOpen} title="Downloads" onClick={() => { setHistoryOpen(false); setDownloadsOpen(value => !value); }}><Download size={15} />{downloads.length > 0 && <span className={downloads.some(item => item.status === 'receiving') ? 'receiving' : ''} />}</button><button ref={typingButton} className={`icon-button ${typing ? 'selected' : ''}`} aria-label="Type into page" aria-expanded={typing} title="Page input and scrolling" disabled={!interactive || running} onClick={() => setTyping(v => !v)}><Keyboard size={15} /></button>{current && /^https?:/.test(current.url) && <a className="icon-button" aria-label="Open page in external browser" title="Open in external browser" href={current.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /></a>}</div></div>
  </div>{selection.element}</div></div>;
}
