import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Minus, Plus } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { errorMessage } from './api';
import type { DocumentViewState } from './document-state';
import './pdf-preview.css';

GlobalWorkerOptions.workerSrc = pdfWorker;
export type PdfView = Required<Pick<DocumentViewState, 'pdfPage' | 'pdfOffset' | 'pdfLeft' | 'pdfZoom'>>;
export default function PdfPreview({ url, initialView, onViewChange }: { url: string; initialView: DocumentViewState; onViewChange: (view: PdfView, flush?: boolean) => void }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null), [error, setError] = useState('');
  const [width, setWidth] = useState(440), [ratios, setRatios] = useState<Record<number, number>>({}), [defaultRatio, setDefaultRatio] = useState(1.414);
  const [zoom, setZoom] = useState(initialView.pdfZoom ?? 1), [page, setPage] = useState(initialView.pdfPage ?? 1), [pageInput, setPageInput] = useState(String(initialView.pdfPage ?? 1));
  const container = useRef<HTMLDivElement>(null), editingPage = useRef(false), dirtyPage = useRef(false), cancelPageEdit = useRef(false), restoring = useRef(true), restoreFrame = useRef(0);
  const position = useRef<PdfView>({ pdfPage: initialView.pdfPage ?? 1, pdfOffset: initialView.pdfOffset ?? 0, pdfLeft: initialView.pdfLeft ?? 0, pdfZoom: initialView.pdfZoom ?? 1 });
  const changed = useRef(onViewChange); changed.current = onViewChange;
  const pageWidth = Math.max(200, width - 32) * zoom;
  const remember = useCallback((flush = false) => {
    const element = container.current; if (!element || restoring.current) return;
    const pages = element.querySelectorAll<HTMLElement>('[data-pdf-page]');
    const current = Array.from(pages).find(node => node.offsetTop + node.offsetHeight > element.scrollTop + 1) || pages[pages.length - 1];
    if (!current) return;
    const number = Number(current.dataset.pdfPage);
    position.current = { ...position.current, pdfPage: number, pdfOffset: Math.max(0, Math.min(1, (element.scrollTop - current.offsetTop + 16) / current.offsetHeight)), pdfLeft: element.scrollWidth > element.clientWidth ? element.scrollLeft / (element.scrollWidth - element.clientWidth) : 0 };
    setPage(number); if (!editingPage.current) setPageInput(String(number)); changed.current(position.current, flush);
  }, []);
  useLayoutEffect(() => () => { remember(true); cancelAnimationFrame(restoreFrame.current); }, [remember]);
  useEffect(() => {
    let live = true;
    const task = getDocument({ url });
    restoring.current = true; setDocument(null); setError(''); setRatios({});
    void task.promise.then(async value => {
      const first = await value.getPage(1), viewport = first.getViewport({ scale: 1 });
      if (live) { setDefaultRatio(viewport.height / viewport.width); setDocument(value); }
    }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; void task.destroy(); };
  }, [url]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].target.clientWidth));
    observer.observe(container.current); return () => observer.disconnect();
  }, []);
  const restore = useCallback(() => {
    const element = container.current; if (!document || !element) return;
    const number = Math.max(1, Math.min(document.numPages, position.current.pdfPage)), node = element.querySelector<HTMLElement>(`[data-pdf-page="${number}"]`); if (!node) return;
    restoring.current = true; cancelAnimationFrame(restoreFrame.current);
    element.scrollTop = node.offsetTop - 16 + node.offsetHeight * position.current.pdfOffset;
    element.scrollLeft = position.current.pdfLeft * Math.max(0, element.scrollWidth - element.clientWidth);
    position.current = { ...position.current, pdfPage: number, pdfZoom: zoom }; setPage(number); if (!editingPage.current) setPageInput(String(number)); changed.current(position.current);
    restoreFrame.current = requestAnimationFrame(() => { restoring.current = false; });
  }, [document, zoom]);
  useLayoutEffect(restore, [restore, pageWidth, ratios, defaultRatio]);
  const ratioChanged = useCallback((number: number, ratio: number) => setRatios(current => current[number] === ratio ? current : { ...current, [number]: ratio }), []);
  function goTo(number: number) {
    if (!document) return;
    position.current = { ...position.current, pdfPage: Math.max(1, Math.min(document.numPages, number)), pdfOffset: 0 }; restore();
  }
  function submitPage(force = false) {
    editingPage.current = false;
    if (!dirtyPage.current && !force) { setPageInput(String(page)); return; }
    dirtyPage.current = false;
    const number = /^\d+$/.test(pageInput.trim()) ? Number(pageInput) : page;
    goTo(Number.isSafeInteger(number) ? number : page); setPageInput(String(position.current.pdfPage));
  }
  function changeZoom(value: number) { remember(); position.current.pdfZoom = value; setZoom(value); }
  return <div className="pdf-viewer">
    <div className="pdf-toolbar" aria-label="PDF controls">
      <button className="icon-button" aria-label="Previous PDF page" title="Previous page" disabled={!document || page <= 1} onClick={() => goTo(page - 1)}><ChevronUp size={15} /></button>
      <input aria-label="PDF page" inputMode="numeric" autoComplete="off" value={pageInput} disabled={!document} onFocus={() => { editingPage.current = true; }} onChange={event => { editingPage.current = true; dirtyPage.current = true; setPageInput(event.target.value.slice(0, 7)); }} onBlur={() => { if (cancelPageEdit.current) cancelPageEdit.current = false; else submitPage(); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); submitPage(true); } else if (event.key === 'Escape') { event.preventDefault(); editingPage.current = false; dirtyPage.current = false; cancelPageEdit.current = true; setPageInput(String(page)); event.currentTarget.blur(); } }} />
      <span className="pdf-page-count">of {document?.numPages.toLocaleString() ?? '–'}</span>
      <button className="icon-button" aria-label="Next PDF page" title="Next page" disabled={!document || page >= document.numPages} onClick={() => goTo(page + 1)}><ChevronDown size={15} /></button>
      <div className="pdf-zoom-controls"><button className="icon-button" aria-label="Zoom out PDF" title="Zoom out" disabled={!document || zoom <= .5} onClick={() => changeZoom(Math.max(.5, zoom - .25))}><Minus size={14} /></button>
      <button className="pdf-zoom-value" aria-label="Fit PDF to width" title="Fit to width" disabled={!document} onClick={() => changeZoom(1)}>{zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`}</button>
      <button className="icon-button" aria-label="Zoom in PDF" title="Zoom in" disabled={!document || zoom >= 3} onClick={() => changeZoom(Math.min(3, zoom + .25))}><Plus size={14} /></button></div>
    </div>
    <div className="pdf-preview" ref={container} aria-label="PDF document" tabIndex={0} onScroll={() => remember()}>
      {error && <p className="inline-alert" role="alert">{error}</p>}
      {!document && !error && <p className="panel-loading">Opening document…</p>}
      {document && Array.from({ length: document.numPages }, (_, i) => <PdfPage key={i} document={document} number={i + 1} width={pageWidth} ratio={ratios[i + 1] ?? defaultRatio} onRatio={ratioChanged} />)}
    </div>
  </div>;
}
function PdfPage({ document, number, width, ratio, onRatio }: { document: PDFDocumentProxy; number: number; width: number; ratio: number; onRatio: (number: number, ratio: number) => void }) {
  const holder = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), textLayer = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false), [text, setText] = useState(''), [error, setError] = useState('');
  const textLayout = useRef<{ document: PDFDocumentProxy; width: number } | null>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setVisible(entries.some(e => e.isIntersecting)), { root: holder.current?.closest('.pdf-preview'), rootMargin: '400px' });
    if (holder.current) observer.observe(holder.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let live = true, layer: TextLayer | undefined, render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    setError('');
    void document.getPage(number).then(async page => {
      if (!live || !canvas.current || !textLayer.current) return;
      const initial = page.getViewport({ scale: 1 }); onRatio(number, initial.height / initial.width);
      const scale = width / initial.width, viewport = page.getViewport({ scale: scale * Math.min(devicePixelRatio, 2) });
      const element = canvas.current; element.width = viewport.width; element.height = viewport.height;
      render = page.render({ canvas: element, viewport }); await render.promise;
      if (!live || textLayout.current?.document === document && textLayout.current.width === width) return;
      const content = await page.getTextContent(); if (!live || !textLayer.current) return;
      setText(content.items.map(item => 'str' in item ? item.str : '').join(' '));
      textLayer.current.replaceChildren(); textLayer.current.style.setProperty('--total-scale-factor', String(scale));
      layer = new TextLayer({ textContentSource: content, container: textLayer.current, viewport: page.getViewport({ scale }) });
      await layer.render(); if (live) textLayout.current = { document, width };
    }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; render?.cancel(); layer?.cancel(); };
  }, [document, number, visible, width, onRatio]);
  return <div ref={holder} className="pdf-page" data-pdf-page={number} style={{ width, height: width * ratio }}>
    {visible && <canvas ref={canvas} style={{ width, height: width * ratio }} role="img" aria-label={`Page ${number}${text ? `: ${text}` : ''}`} />}
    <div className="pdf-text-layer" ref={textLayer} aria-hidden="true" />
    {error && <p role="alert">{error}</p>}
  </div>;
}
