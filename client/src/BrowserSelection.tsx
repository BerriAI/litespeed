import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Copy, MessageSquarePlus } from 'lucide-react';
import type { BrowserSelection, BrowserState } from '../../shared/browser';
import type { BrowserComment } from './BrowserAnnotation';
import { api, errorMessage } from './api';
import { copyText } from './clipboard';
import './browser-selection.css';

type Menu = { x: number; y: number; selection?: BrowserSelection; error?: string };
export function useBrowserSelection({ sessionId, state, disabled, viewport, onAdd }: {
  sessionId?: string; state: BrowserState; disabled: boolean; viewport: RefObject<HTMLDivElement | null>; onAdd?: (comment: BrowserComment) => boolean;
}) {
  const [menu, setMenu] = useState<Menu | null>(null), [notice, setNotice] = useState('');
  const menuRef = useRef<HTMLDivElement>(null), pending = useRef<AbortController | null>(null), alive = useRef(true);
  const generation = useRef(0);
  const current = useRef({ state, disabled }); current.current = { state, disabled };
  const close = useCallback((restoreFocus = true) => { generation.current++; pending.current?.abort(); pending.current = null; setMenu(null); if (restoreFocus) viewport.current?.focus(); }, [viewport]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; pending.current?.abort(); }; }, []);
  useEffect(() => { close(false); setNotice(''); }, [close, state.activeId, state.revision, disabled]);
  useEffect(() => {
    if (!notice) return; const timer = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) close(false); };
    const resized = () => close(false);
    document.addEventListener('pointerdown', outside); window.addEventListener('resize', resized); window.addEventListener('blur', resized);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', resized); window.removeEventListener('blur', resized); };
  }, [Boolean(menu), close]);
  useLayoutEffect(() => {
    const element = menuRef.current; if (!element || !menu) return;
    const width = element.offsetWidth, height = element.offsetHeight;
    element.style.left = `${Math.max(8, Math.min(menu.x, innerWidth - width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(menu.y, innerHeight - height - 8))}px`;
    (element.querySelector<HTMLButtonElement>('button:not(:disabled)') || element).focus();
  }, [menu]);
  async function read() {
    if (!sessionId || current.current.disabled || current.current.state.busy || !current.current.state.activeId) throw new Error('Wait for the page before copying text.');
    const version = generation.current;
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    const { activeId: tabId, revision } = current.current.state;
    const selection = await api<BrowserSelection>(`/sessions/${sessionId}/browser/selection`, { method: 'POST', body: JSON.stringify({ tabId, revision }), signal: controller.signal });
    if (!alive.current || version !== generation.current || controller.signal.aborted || current.current.disabled || current.current.state.activeId !== tabId || current.current.state.revision !== revision) throw new Error('The browser view changed. Select the text again.');
    return selection;
  }
  function open(x?: number, y?: number) {
    if (disabled || !state.activeId) return;
    const version = ++generation.current;
    const bounds = viewport.current?.getBoundingClientRect(), position = { x: x ?? (bounds?.left ?? 0) + 24, y: y ?? (bounds?.top ?? 0) + 24 };
    setNotice(''); setMenu(position);
    void read().then(selection => { if (alive.current && version === generation.current) setMenu({ ...position, selection }); }).catch(error => { if (alive.current && version === generation.current) setMenu({ ...position, error: errorMessage(error) }); });
  }
  async function copy(selection?: BrowserSelection) {
    if (disabled) return;
    const version = ++generation.current;
    setNotice('');
    try {
      const result = selection ? Promise.resolve(selection) : read();
      const text = result.then(value => { if (!value.text) throw new Error('Select text in the page first.'); return value.text; });
      // Starting the clipboard write during the key event preserves Safari's
      // user activation while the task browser returns its selected text.
      if (!selection && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        try { await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then(value => new Blob([value], { type: 'text/plain' })) })]); }
        catch { await copyText(await text); }
      } else await copyText(await text);
      const value = await result;
      if (alive.current && version === generation.current) { close(); setNotice(value.truncated ? 'Copied the first 12,000 characters' : 'Copied selected text'); }
    } catch (error) { if (alive.current && version === generation.current) { close(); setNotice(errorMessage(error)); } }
  }
  function add() {
    const selection = menu?.selection; if (!selection?.text || !onAdd) return;
    const content = `Selected text from ${selection.title || 'a browser page'}\nURL: ${selection.url}\nCaptured: ${new Date(selection.capturedAt).toISOString()}${selection.truncated ? '\nSelection shortened to 12,000 characters.' : ''}\n\n${selection.text}`;
    if (onAdd({ text: `Use the attached selection from ${selection.url} as reference.`, attachment: { name: 'browser-selection.txt', mimeType: 'text/plain', content } })) { close(false); setNotice('Selection added to your draft'); }
    else setMenu(previous => previous && { ...previous, error: 'Your draft already has six attachments. Remove one first.' });
  }
  const element = menu && <div ref={menuRef} className="browser-selection-menu" role="menu" aria-label="Selected page text" tabIndex={-1} style={{ left: menu.x, top: menu.y }} onKeyDown={event => {
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = items.findIndex(item => item === document.activeElement);
      items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }
  }}>
    <p className={menu.error ? 'error' : ''}>{menu.error || (menu.selection ? menu.selection.text || 'Select text in the page first.' : 'Reading selection…')}</p>
    <button role="menuitem" disabled={!menu.selection?.text} onClick={() => void copy(menu.selection)}><Copy size={14} /><span>Copy selected text</span><kbd>{/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ C' : 'Ctrl C'}</kbd></button>
    {onAdd && <button role="menuitem" disabled={!menu.selection?.text} onClick={add}><MessageSquarePlus size={14} /><span>Add selection to draft</span></button>}
  </div>;
  return { element, notice, open, copy };
}
