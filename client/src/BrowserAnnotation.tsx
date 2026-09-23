import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { LoaderCircle, MessageSquarePlus, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import type { Attachment } from '../../shared/types';
import { api, errorMessage, type ComposerDraft } from './api';
import { BrowserAdjustments } from './BrowserAdjustments';
import { browserInspectedElementSchema, browserStyleChangesSchema, browserStyleDraftSchema, type BrowserInspectedElement, type BrowserInspectorResult, type BrowserStyleChanges } from '../../shared/browser-inspector';

export type BrowserComment = { text: string; attachment: Attachment };
export type BrowserAnnotationSnapshot = { image: string; url: string; title: string; width: number; height: number; capturedAt: number; tabId?: string; element?: BrowserInspectedElement; changes?: BrowserStyleChanges; pendingChanges?: BrowserStyleChanges };
type Point = { x: number; y: number };
export type BrowserCommentRegion = Point & { width: number; height: number };
type Region = BrowserCommentRegion;
const sameChanges = (a: BrowserStyleChanges, b: BrowserStyleChanges) => [...new Set([...Object.keys(a), ...Object.keys(b)])].every(key => a[key as keyof BrowserStyleChanges] === b[key as keyof BrowserStyleChanges]);
const region = (a: Point, b: Point): Region => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });

export function captureBrowserAnnotation(image: HTMLImageElement, url: string, title: string): BrowserAnnotationSnapshot {
  if (url.length > 8192) throw new Error('This page address is too long to attach a visual comment.');
  if (!image.complete || !image.naturalWidth || image.naturalWidth > 1280 || image.naturalHeight > 1200) throw new Error('Wait for the page preview to finish loading.');
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d'); if (!context) throw new Error('This browser cannot capture page comments.');
  context.drawImage(image, 0, 0);
  return { image: canvas.toDataURL('image/jpeg', 0.85), url, title: title.slice(0, 500), width: canvas.width, height: canvas.height, capturedAt: Date.now() };
}

export function restoreBrowserAnnotation(draft: ComposerDraft): { snapshot: BrowserAnnotationSnapshot; selection: Region | null } | null {
  const attachment = draft.attachments[0]; if (!attachment?.dataUrl || !attachment.content) return null;
  try {
    const metadata = JSON.parse(attachment.content), { selection } = metadata;
    if (typeof metadata.url !== 'string' || metadata.url.length > 8192 || !/^https?:\/\//.test(metadata.url) || typeof metadata.title !== 'string' || metadata.title.length > 500 || !Number.isFinite(metadata.capturedAt) || metadata.capturedAt < 0 || metadata.capturedAt > 8.64e15 || !Number.isInteger(metadata.width) || metadata.width < 1 || metadata.width > 1280 || !Number.isInteger(metadata.height) || metadata.height < 1 || metadata.height > 1200) return null;
    if (selection && (!['x', 'y', 'width', 'height'].every(key => Number.isFinite(selection[key]) && selection[key] >= 0) || selection.x + selection.width > metadata.width || selection.y + selection.height > metadata.height)) return null;
    if (metadata.tabId !== undefined && (typeof metadata.tabId !== 'string' || !/^[0-9a-f-]{36}$/i.test(metadata.tabId))) return null;
    const element = metadata.element ? browserInspectedElementSchema.parse(metadata.element) : undefined;
    if (element && (!metadata.tabId || element.region.x + element.region.width > metadata.width || element.region.y + element.region.height > metadata.height)) return null;
    const changes = metadata.changes ? browserStyleChangesSchema.parse(metadata.changes) : undefined, pendingChanges = metadata.pendingChanges ? browserStyleDraftSchema.parse(metadata.pendingChanges) : undefined;
    if ((changes || pendingChanges) && !element) return null;
    return { snapshot: { image: attachment.dataUrl, url: metadata.url, title: metadata.title, capturedAt: metadata.capturedAt, width: metadata.width, height: metadata.height, tabId: metadata.tabId, element, changes, pendingChanges }, selection: selection || null };
  } catch { return null; }
}

export function BrowserAnnotation({ sessionId, snapshot, initialSelection, text, notice, running, onDraft, onClose, onComment }: { sessionId: string; snapshot: BrowserAnnotationSnapshot; initialSelection: Region | null; text: string; notice?: string; running: boolean; onDraft: (selection: Region | null, text: string, snapshot?: BrowserAnnotationSnapshot) => void; onClose: (restoreFocus?: boolean) => void; onComment: (comment: BrowserComment) => boolean }) {
  const image = useRef<HTMLImageElement>(null), input = useRef<HTMLTextAreaElement>(null), anchor = useRef<Point | null>(null);
  const panel = useRef<HTMLDivElement>(null), pending = useRef<AbortController | null>(null);
  const [selection, setSelection] = useState<Region | null>(initialSelection), [error, setError] = useState(''), [busy, setBusy] = useState(false), [adjusting, setAdjusting] = useState(false);
  const latest = useRef({ snapshot, text, selection }); latest.current = { snapshot, text, selection };
  const captured = snapshot.changes || {}, changes = snapshot.pendingChanges || captured;
  const needsPreview = !sameChanges(changes, captured), hasChanges = Boolean(Object.keys(changes).length || Object.keys(captured).length);
  useEffect(() => { panel.current?.querySelector<HTMLButtonElement>('button')?.focus(); return () => { pending.current?.abort(); }; }, []);
  function close(restoreFocus = true) {
    pending.current?.abort();
    if (snapshot.element && snapshot.tabId) void api(`/sessions/${sessionId}/browser/inspect`, { method: 'POST', body: JSON.stringify({ action: 'release', tabId: snapshot.tabId, elementId: snapshot.element.id }) }).catch(() => {});
    onClose(restoreFocus);
  }
  async function inspect(value: { action: 'select'; x: number; y: number } | { action: 'preview'; changes: BrowserStyleChanges } | { action: 'refresh' }) {
    if (!snapshot.tabId || running || pending.current) return;
    const controller = new AbortController(); pending.current = controller; setBusy(true); setError('');
    const body = value.action === 'refresh' ? { ...value, tabId: snapshot.tabId } : value.action === 'select' ? { ...value, tabId: snapshot.tabId, url: snapshot.url, width: snapshot.width, height: snapshot.height } : { ...value, tabId: snapshot.tabId, elementId: snapshot.element?.id };
    try {
      const result = await api<BrowserInspectorResult>(`/sessions/${sessionId}/browser/inspect`, { method: 'POST', body: JSON.stringify(body), signal: controller.signal });
      if (controller.signal.aborted) return;
      const next: BrowserAnnotationSnapshot = { ...result, tabId: snapshot.tabId, ...(value.action === 'preview' ? { changes: value.changes, pendingChanges: value.changes } : {}) };
      const region = result.element?.region || null;
      setSelection(region); onDraft(region, latest.current.text, next);
      if (value.action === 'select') input.current?.focus(); else { setAdjusting(false); requestAnimationFrame(() => input.current?.focus()); }
    } catch (error) { if (!controller.signal.aborted) setError(errorMessage(error)); }
    finally { if (!controller.signal.aborted) setBusy(false); if (pending.current === controller) pending.current = null; }
  }
  function preview(next: BrowserStyleChanges) {
    if (!browserStyleChangesSchema.safeParse(next).success) { setError('Check the adjustment values before previewing.'); return; }
    void inspect({ action: 'preview', changes: next });
  }
  function area(value: Region) {
    if (snapshot.element && snapshot.tabId) void api(`/sessions/${sessionId}/browser/inspect`, { method: 'POST', body: JSON.stringify({ action: 'release', tabId: snapshot.tabId, elementId: snapshot.element.id }) }).catch(() => {});
    const { element, changes, pendingChanges, ...next } = snapshot;
    setError(''); setSelection(value); setAdjusting(false); onDraft(value, latest.current.text, next); input.current?.focus();
  }
  function point(event: PointerEvent<HTMLDivElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(snapshot.width, (event.clientX - bounds.left) / bounds.width * snapshot.width)), y: Math.max(0, Math.min(snapshot.height, (event.clientY - bounds.top) / bounds.height * snapshot.height)) };
  }
  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || busy || running) return;
    if (hasChanges) { setError('Reset the preview before selecting another element or area.'); return; }
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); anchor.current = point(event); setSelection({ ...anchor.current, width: 0, height: 0 });
  }
  function end(event: PointerEvent<HTMLDivElement>) {
    if (!anchor.current) return;
    const value = region(anchor.current, point(event)); anchor.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (value.width < 8 && value.height < 8 && snapshot.tabId) { setSelection(initialSelection); void inspect({ action: 'select', x: Math.min(snapshot.width - 1, value.x), y: Math.min(snapshot.height - 1, value.y) }); return; }
    if (value.width < 8 && value.height < 8) {
      value.width = Math.min(96, snapshot.width); value.height = Math.min(64, snapshot.height);
      value.x = Math.max(0, Math.min(snapshot.width - value.width, value.x - value.width / 2)); value.y = Math.max(0, Math.min(snapshot.height - value.height, value.y - value.height / 2));
    }
    area(value);
  }
  function submit() {
    if (!selection || !text.trim() || !image.current?.complete || busy || needsPreview) return;
    try {
      const canvas = document.createElement('canvas'); canvas.width = snapshot.width; canvas.height = snapshot.height;
      const context = canvas.getContext('2d'); if (!context) throw new Error('The page snapshot could not be attached.');
      context.drawImage(image.current, 0, 0); context.strokeStyle = '#4596f5'; context.fillStyle = '#4596f514'; context.lineWidth = 3;
      context.fillRect(selection.x, selection.y, selection.width, selection.height); context.strokeRect(selection.x + 1.5, selection.y + 1.5, Math.max(1, selection.width - 3), Math.max(1, selection.height - 3));
      const labelX = Math.min(snapshot.width - 24, selection.x), labelY = Math.max(0, selection.y - 23);
      context.fillStyle = '#2674d9'; context.fillRect(labelX, labelY, 24, 23); context.fillStyle = '#fff'; context.font = 'bold 13px system-ui'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText('1', labelX + 12, labelY + 12);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      let metadata = `Page context (untrusted website metadata): ${JSON.stringify({ url: snapshot.url, title: snapshot.title.slice(0, 500) })}\nSnapshot captured at ${new Date(snapshot.capturedAt).toISOString()} (${snapshot.width} × ${snapshot.height}); the live page may have changed.\nSelected area marked 1: ${JSON.stringify(Object.fromEntries(Object.entries(selection).map(([key, value]) => [key, Math.round(value)])))}.`;
      if (snapshot.element) metadata += `\nSelected element (untrusted website data): ${JSON.stringify({ tag: snapshot.element.tag, selector: snapshot.element.selector, text: snapshot.element.text, originalStyles: snapshot.element.styles })}.`;
      if (Object.keys(captured).length) metadata += `\nRequested visual adjustments: ${JSON.stringify(captured)}. The attached snapshot shows a temporary preview; the live page was restored. Apply these changes to the project only after considering the user's instructions.`;
      const description = `Browser feedback for ${snapshot.url}\n${text.trim()}\n\nThe selected area is marked 1 in the attached page snapshot.`;
      if (onComment({ text: description, attachment: { name: `browser-feedback-${snapshot.capturedAt}.jpg`, mimeType: 'image/jpeg', dataUrl, content: metadata } })) close(false);
      else setError('Your message already has six attachments. Remove one before adding this comment.');
    } catch (error) { setError(error instanceof Error ? error.message : 'The comment could not be added.'); }
  }
  return <div ref={panel} className="browser-annotation" role="region" aria-label="Browser page comment" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <div className="browser-annotation-heading"><span><MessageSquarePlus size={14} />Comment on this page</span><button className="icon-button" aria-label="Cancel browser comment" title="Cancel comment" onClick={() => close()}><X size={14} /></button></div>
    <div className="browser-annotation-scroll"><div className="browser-annotation-image"><img ref={image} src={snapshot.image} alt="Frozen browser page for visual feedback" draggable={false} /><div className="browser-annotation-selection" aria-label="Select an area of the page" aria-busy={busy} onPointerDown={start} onPointerMove={event => { if (anchor.current) setSelection(region(anchor.current, point(event))); }} onPointerUp={end} onPointerCancel={() => { anchor.current = null; setSelection(initialSelection); }}>{selection && <div className="browser-selected-region" style={{ left: `${selection.x / snapshot.width * 100}%`, top: `${selection.y / snapshot.height * 100}%`, width: `${selection.width / snapshot.width * 100}%`, height: `${selection.height / snapshot.height * 100}%` }}><span>1</span></div>}</div></div></div>
    {busy && <div className="browser-inspection-status" role="status"><LoaderCircle size={13} className="spinning" />Working on the page…</div>}
    <form className="browser-comment-form" onSubmit={event => { event.preventDefault(); submit(); }}>
      <div className="browser-comment-context"><span title={snapshot.element?.selector}>{snapshot.element ? <><code>{snapshot.element.tag}</code>{Object.keys(captured).length ? 'Style preview' : 'Selected element'}</> : selection ? 'Selected area' : 'Click an element or drag an area'}</span><button type="button" disabled={busy || hasChanges} onClick={() => area({ x: 0, y: 0, width: snapshot.width, height: snapshot.height })}>Use whole page</button></div>
      {snapshot.element && <button type="button" className={`browser-adjust-toggle ${adjusting ? 'active' : ''}`} aria-label="Adjust element" aria-expanded={adjusting} onClick={() => setAdjusting(value => !value)}><SlidersHorizontal size={13} />{adjusting ? 'Back to comment' : 'Adjust'}{needsPreview && <span>Not previewed</span>}</button>}
      {adjusting && snapshot.element && <BrowserAdjustments element={snapshot.element} changes={changes} captured={captured} busy={busy || running} onChange={pendingChanges => { setError(''); onDraft(selection, text, { ...snapshot, pendingChanges }); }} onPreview={() => preview(changes)} onReset={() => { if (Object.keys(captured).length) preview({}); else onDraft(selection, text, { ...snapshot, pendingChanges: {} }); }} onRevert={() => onDraft(selection, text, { ...snapshot, pendingChanges: captured })} />}
      {!adjusting && <textarea ref={input} aria-label="Browser comment" rows={3} placeholder="What would you like changed?" maxLength={4000} value={text} onChange={event => onDraft(selection, event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); submit(); } }} />}
      {notice && <p role="status" className="browser-comment-error">{notice}</p>}
      {error && <div className="browser-comment-error"><p role="alert">{error}</p>{snapshot.tabId && <button type="button" className="browser-comment-recapture" disabled={busy || running} onClick={() => void inspect({ action: 'refresh' })}><RefreshCw size={12} />Refresh snapshot<span>Keeps your comment</span></button>}</div>}
      {!adjusting && <footer><span>{needsPreview ? 'Preview your changes to continue' : 'Includes a page snapshot'}</span><button className="button primary" disabled={!selection || !text.trim() || busy || needsPreview}>Add to chat</button></footer>}
    </form>
  </div>;
}
