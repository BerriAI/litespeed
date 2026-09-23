import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, CornerDownLeft, Keyboard, LoaderCircle, Monitor, RefreshCw, Unplug, X } from 'lucide-react';
import { useComputer } from './use-computer';
import { EmptyState } from './ui';
import { ComputerPicker } from './ComputerPicker';
import type { ComputerAction } from '../../shared/computer';

const keys: Record<string, string> = { Enter: 'return', Tab: 'tab', Backspace: 'delete', ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown' };
type Gesture = { x: number; y: number; toX: number; toY: number; clientX: number; clientY: number; windowId: string; snapshotId: string; width: number; height: number; at: number; pointerId: number; modifiers: ComputerAction['modifiers']; moved: boolean };
export function ComputerPanel({ sessionId, running }: { sessionId?: string; running: boolean }) {
  const { state, stateRef, frame, busy, action, error, clearError } = useComputer(sessionId, running);
  const [choosing, setChoosing] = useState(false), [typing, setTyping] = useState(false), [text, setText] = useState('');
  const [pickerMode, setPickerMode] = useState<'windows' | 'apps'>('windows'), [gesture, setGesture] = useState<Gesture | null>(null);
  const dragging = useRef<Gesture | null>(null);
  const viewport = useRef<HTMLDivElement>(null), picker = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const current = state.windows.find(window => window.id === state.windowId);
  const visible = frame && frame.windowId === state.windowId ? frame : null;
  const disabled = busy || running, inputDisabled = disabled || !visible || visible.id !== state.snapshotId;
  const controls = useRef({ action, running, busy, visible, state }); controls.current = { action, running, busy, visible, state };
  function choose() { setChoosing(value => !value); if (!choosing) { setPickerMode('windows'); void action({ action: 'windows' }).then(success => { if (!success) setChoosing(false); }); } }
  useEffect(() => {
    if (choosing && !busy) menu.current?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  }, [choosing, busy]);
  useEffect(() => { dragging.current = null; setGesture(null); }, [visible?.id, state.windowId, running]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout>, horizontal = 0, vertical = 0;
    const wheel = (event: WheelEvent) => {
      const next = controls.current;
      if (event.ctrlKey || dragging.current || next.running || !next.visible || !next.state.windowId || (!next.busy && next.visible.id !== next.state.snapshotId)) return;
      event.preventDefault();
      const scale = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? element.clientHeight : 1;
      horizontal += event.deltaX * scale; vertical += event.deltaY * scale;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const current = controls.current, sideways = Math.abs(horizontal) > Math.abs(vertical), delta = sideways ? horizontal : vertical;
        horizontal = vertical = 0;
        if (!delta || current.running || !current.visible || !current.state.windowId) return;
        void current.action({ action: 'scroll', windowId: current.state.windowId, direction: sideways ? delta > 0 ? 'right' : 'left' : delta > 0 ? 'down' : 'up', amount: Math.max(1, Math.min(50, Math.round(Math.abs(delta) / 40))) });
      }, 75);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { clearTimeout(timer); element.removeEventListener('wheel', wheel); };
  }, [state.windowId, sessionId]);
  useEffect(() => {
    if (!choosing) return;
    const click = (event: globalThis.PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !picker.current?.contains(event.target as Node)) setChoosing(false); };
    const key = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setChoosing(false); picker.current?.focus(); } };
    document.addEventListener('pointerdown', click); document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', click); document.removeEventListener('keydown', key, true); };
  }, [choosing]);
  function point(event: PointerEvent<HTMLImageElement>, width: number, height: number) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(width - 1, Math.max(0, Math.floor((event.clientX - bounds.left) / bounds.width * width))), y: Math.min(height - 1, Math.max(0, Math.floor((event.clientY - bounds.top) / bounds.height * height))), inside: event.clientX >= bounds.left && event.clientX < bounds.right && event.clientY >= bounds.top && event.clientY < bounds.bottom };
  }
  function pointerDown(event: PointerEvent<HTMLImageElement>) {
    if (inputDisabled || !visible || !state.windowId || event.button !== 0 || !event.isPrimary || dragging.current) return;
    event.preventDefault(); viewport.current?.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    const start = point(event, visible.width, visible.height), modifiers: ComputerAction['modifiers'] = [];
    if (event.metaKey) modifiers.push('cmd'); if (event.ctrlKey) modifiers.push('ctrl'); if (event.altKey) modifiers.push('option'); if (event.shiftKey) modifiers.push('shift');
    dragging.current = { ...start, toX: start.x, toY: start.y, clientX: event.clientX, clientY: event.clientY, windowId: state.windowId, snapshotId: visible.id, width: visible.width, height: visible.height, at: Date.now(), pointerId: event.pointerId, modifiers, moved: false };
  }
  function pointerMove(event: PointerEvent<HTMLImageElement>) {
    const start = dragging.current; if (!start || start.pointerId !== event.pointerId) return;
    const to = point(event, start.width, start.height), moved = start.moved || Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) >= 4;
    dragging.current = { ...start, toX: to.x, toY: to.y, moved }; if (moved) setGesture(dragging.current);
  }
  function pointerUp(event: PointerEvent<HTMLImageElement>) {
    const start = dragging.current; dragging.current = null; setGesture(null);
    if (!start || start.pointerId !== event.pointerId || inputDisabled || visible?.id !== start.snapshotId || state.windowId !== start.windowId) return;
    const to = point(event, start.width, start.height); if (!to.inside) return;
    const moved = start.moved || Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) >= 4;
    void action({ action: moved ? 'drag' : 'click', windowId: start.windowId, snapshotId: start.snapshotId, x: start.x, y: start.y, ...(moved ? { toX: to.x, toY: to.y, durationMs: Math.min(2000, Math.max(200, Date.now() - start.at)), modifiers: start.modifiers } : {}) });
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && dragging.current) { event.preventDefault(); event.stopPropagation(); dragging.current = null; setGesture(null); return; }
    if (dragging.current) { event.preventDefault(); event.stopPropagation(); return; }
    if (running || !visible || (!busy && visible.id !== state.snapshotId) || !state.windowId || event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); picker.current?.focus(); return; }
    const modifiers: ('cmd' | 'shift' | 'ctrl' | 'option')[] = [];
    if (event.metaKey) modifiers.push('cmd'); if (event.ctrlKey) modifiers.push('ctrl'); if (event.altKey) modifiers.push('option'); if (event.shiftKey) modifiers.push('shift');
    if (keys[event.key] || (event.key.length === 1 && (event.metaKey || event.ctrlKey))) {
      event.preventDefault(); event.stopPropagation(); void action({ action: 'key', key: keys[event.key] || event.key.toLowerCase(), modifiers, windowId: state.windowId });
    } else if (event.key.length === 1 && !event.altKey) { event.preventDefault(); event.stopPropagation(); void action({ action: 'type', text: event.key, windowId: state.windowId }); }
  }
  if (!sessionId) return <EmptyState icon={<Monitor size={28} />} title="Your apps, beside your work">Start a conversation to use a desktop window here.</EmptyState>;
  return <div className="computer-panel">
    <div className="computer-toolbar"><button ref={picker} className="computer-window-trigger" onClick={choose} disabled={disabled} aria-label="Choose computer window" aria-expanded={choosing}><Monitor size={15} /><span>{current?.app || 'Choose a window'}</span><ChevronDown size={13} /></button><div><button className="icon-button" aria-label="Refresh computer window" title="Refresh window" disabled={disabled || !current} onClick={() => void action({ action: 'snapshot' })}>{busy ? <LoaderCircle size={15} className="spinning" /> : <RefreshCw size={15} />}</button><button className="icon-button" aria-label="Release computer window" title="Release window" disabled={disabled || !current} onClick={() => void action({ action: 'release' })}><Unplug size={15} /></button></div></div>
    {choosing && <div ref={menu} className="computer-window-menu" aria-label="Open desktop windows"><ComputerPicker key={pickerMode} windows={state.windows} apps={state.apps || []} windowId={state.windowId} mode={pickerMode} busy={disabled} onClose={() => { setChoosing(false); picker.current?.focus(); }} onMode={mode => { setPickerMode(mode); void action({ action: mode }); }} onSelect={windowId => void action({ action: 'select', windowId }).then(success => { if (success) { setChoosing(false); requestAnimationFrame(() => viewport.current?.focus()); } })} onLaunch={bundleId => {
      const previous = stateRef.current.snapshotId;
      void action({ action: 'launch', bundleId }).then(success => { if (success) { setPickerMode('windows'); if (stateRef.current.snapshotId && stateRef.current.snapshotId !== previous) { setChoosing(false); requestAnimationFrame(() => viewport.current?.focus()); } } });
    }} /></div>}
    {error && <div className="inline-alert" role="alert">{error}<button className="icon-button" aria-label="Dismiss computer error" onClick={clearError}><X size={14} /></button></div>}
    {current && <div className="computer-window-title" title={current.title}>{current.title}</div>}
    <div ref={viewport} className="computer-viewport" tabIndex={visible ? 0 : -1} aria-label="Interactive desktop window" onKeyDown={keyboard} onPaste={event => { if (!running && visible && state.windowId) { event.preventDefault(); void action({ action: 'type', text: event.clipboardData.getData('text/plain').slice(0, 5000), windowId: state.windowId }); } }} onCompositionEnd={event => { if (!running && visible && state.windowId && event.data) void action({ action: 'type', text: event.data, windowId: state.windowId }); }}>
      {visible ? <div className="computer-image-frame"><img src={visible.url} alt={`Computer preview of ${current?.app || 'the selected window'}`} draggable={false} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { dragging.current = null; setGesture(null); }} onLostPointerCapture={() => { dragging.current = null; setGesture(null); }} />{gesture?.moved && <svg className="computer-drag-guide" viewBox={`0 0 ${gesture.width} ${gesture.height}`} aria-hidden="true"><line x1={gesture.x} y1={gesture.y} x2={gesture.toX} y2={gesture.toY} /><circle cx={gesture.x} cy={gesture.y} r="5" /><circle cx={gesture.toX} cy={gesture.toY} r="7" /></svg>}</div> : <div className="computer-empty"><Monitor size={32} /><strong>{busy ? 'Opening window…' : current ? 'Preview unavailable' : 'Your apps, beside your work'}</strong><p>{busy ? 'Reading the selected window.' : current ? state.notice || 'Refresh to view this window.' : state.notice || 'Choose an open window or launch an app to get started.'}</p>{!current && !busy && <button className="button secondary" onClick={choose} disabled={running}>Choose a window</button>}{state.status === 'missing' && <a href="https://cua.ai/docs/how-to-guides/driver/install" target="_blank" rel="noreferrer">Get Cua Driver</a>}</div>}
    </div>
    {visible && state.notice && <div className="computer-notice" role="status">{state.notice}</div>}
    {typing && visible && <form className="browser-type-bar" onSubmit={event => { event.preventDefault(); void action({ action: 'type', text, windowId: state.windowId! }).then(success => { if (success) setText(''); }); }}><input autoFocus aria-label="Text to type into computer" placeholder="Type into the selected field…" value={text} onChange={event => setText(event.target.value)} disabled={disabled} /><button className="icon-button" aria-label="Type text into computer" disabled={disabled || !text}><ArrowUp size={15} /></button><button type="button" className="icon-button" aria-label="Close computer typing bar" onClick={() => setTyping(false)}><X size={14} /></button></form>}
    <div className="browser-statusbar"><span>{running ? <><span className="working-dot" />Agent has control</> : busy ? 'Working…' : visible ? gesture ? 'Release to drag · Esc to cancel' : 'Click, drag and type · Esc to leave' : 'Computer'}</span><div><button className={`icon-button ${typing ? 'selected' : ''}`} aria-label="Type into computer" title="Type into window" disabled={inputDisabled} onClick={() => setTyping(value => !value)}><Keyboard size={15} /></button><button className="icon-button" aria-label="Press Enter in computer" title="Press Enter" disabled={inputDisabled} onClick={() => void action({ action: 'key', key: 'return', windowId: state.windowId! })}><CornerDownLeft size={14} /></button><button className="icon-button" aria-label="Scroll computer up" title="Scroll up" disabled={inputDisabled} onClick={() => void action({ action: 'scroll', direction: 'up', amount: 5 })}><ArrowUp size={14} /></button><button className="icon-button" aria-label="Scroll computer down" title="Scroll down" disabled={inputDisabled} onClick={() => void action({ action: 'scroll', direction: 'down', amount: 5 })}><ArrowDown size={14} /></button></div></div>
  </div>;
}
