import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrowserAction, BrowserState, BrowserFrame, BrowserUploadAction } from '../../shared/browser';
import { api, errorMessage, post } from './api';
import { useOverlayOpen } from './overlays';

const empty: BrowserState = { tabs: [], activeId: null, busy: false, width: 1280, height: 800, revision: 0 };
type Frame = { url: string; tabId: string; pageUrl: string; title: string; width: number; height: number };
type Pending = { input: BrowserAction; addressVersion: number; finish: ((success: boolean) => void)[] };

export function useBrowser(sessionId: string | undefined, running: boolean, paused = false) {
  const overlayOpen = useOverlayOpen();
  paused = paused || overlayOpen;
  const [state, setState] = useState(empty), [frame, setFrame] = useState<Frame | null>(null);
  const [ready, setReady] = useState(false);
  const [address, setAddressState] = useState(''), [busy, setBusy] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [stopping, setStopping] = useState(false), stoppingRef = useRef(false);
  const [actionError, setActionError] = useState(''), [connectionError, setConnectionError] = useState('');
  const [dismissedError, setDismissedError] = useState('');
  const [visible, setVisible] = useState(!document.hidden);
  const streaming = useRef<string | null>(null), previewPaused = useRef(paused);
  previewPaused.current = paused || !visible;
  const alive = useRef(true), updating = useRef(false), generation = useRef(0), objectUrl = useRef('');
  const addressVersion = useRef(0), addressDirty = useRef(false);
  const setAddress = useCallback((value: string) => { addressVersion.current++; addressDirty.current = true; setAddressState(value); }, []);
  const addressFocused = useRef(false), stateRef = useRef(state), runningRef = useRef(running), queue = useRef<Pending[]>([]);
  runningRef.current = running;
  const clearQueue = (keepResize = false) => {
    const pending = queue.current.splice(0), resize = keepResize ? pending.findLast(item => item.input.action === 'resize') : undefined;
    for (const item of pending) if (item === resize) queue.current.push(item); else item.finish.forEach(resolve => resolve(false));
  };
  const commit = useCallback((next: BrowserState, forceAddress = false) => {
    stateRef.current = next; setState(next);
    const active = next.tabs.find(tab => tab.id === next.activeId);
    if (forceAddress || !addressFocused.current && !addressDirty.current) { addressDirty.current = false; setAddressState(active?.url === 'about:blank' ? '' : active?.url || ''); }
    if (!active || active.suspended) setFrame(null);
  }, []);
  const capture = useCallback(async (next: BrowserState, version: number, signal?: AbortSignal) => {
    if (previewPaused.current || streaming.current === next.activeId || !next.activeId || !sessionId || next.tabs.find(tab => tab.id === next.activeId)?.suspended) return;
    const response = await fetch(`/api/sessions/${sessionId}/browser/frame?tabId=${encodeURIComponent(next.activeId)}`, { signal });
    if (response.status === 204) { if (alive.current && version === generation.current) setFrame(null); return; }
    if (!response.ok) throw new Error('The browser preview is reconnecting.');
    const blob = await response.blob();
    if (!alive.current || version !== generation.current || streaming.current === next.activeId || previewPaused.current) return;
    const previous = objectUrl.current, url = URL.createObjectURL(blob); objectUrl.current = url;
    const tab = next.tabs.find(tab => tab.id === next.activeId);
    setFrame({ url, tabId: next.activeId, pageUrl: tab?.url || '', title: tab?.title || '', width: next.width, height: next.height });
    if (previous) URL.revokeObjectURL(previous);
  }, [sessionId]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; generation.current++; clearQueue(); if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); };
  }, []);
  useEffect(() => {
    const changed = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  const activeId = state.activeId, suspended = state.tabs.find(tab => tab.id === activeId)?.suspended;
  useEffect(() => {
    streaming.current = null;
    if (!sessionId || !activeId || suspended || paused || !visible) return;
    let stopped = false;
    const source = new EventSource(`/api/sessions/${sessionId}/browser/stream?tabId=${encodeURIComponent(activeId)}`);
    source.onmessage = event => {
      if (stopped || !alive.current || previewPaused.current) return;
      try {
        const frame: BrowserFrame = JSON.parse(event.data), current = stateRef.current;
        if (frame.tabId !== activeId || frame.tabId !== current.activeId || frame.width !== current.width || frame.height !== current.height || typeof frame.data !== 'string' || frame.data.length > 4_000_000) return;
        streaming.current = activeId;
        const { data, ...metadata } = frame;
        setFrame({ ...metadata, url: `data:image/jpeg;base64,${data}` }); setConnectionError('');
        if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = ''; }
      } catch { streaming.current = null; }
    };
    source.onerror = () => { streaming.current = null; };
    source.addEventListener('suspended', () => { streaming.current = null; source.close(); });
    return () => { stopped = true; streaming.current = null; source.close(); };
  }, [sessionId, activeId, suspended, paused, visible, state.width, state.height]);
  useEffect(() => { if (running) clearQueue(); }, [running]);
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      const version = generation.current;
      try {
        const next = await api<BrowserState>(`/sessions/${sessionId}/browser`, { signal: controller.signal });
        if (cancelled || version !== generation.current) return;
        commit(next); setReady(true); if (!updating.current) await capture(next, version, controller.signal);
        if (!cancelled) setConnectionError('');
      } catch (e) { if (!cancelled) setConnectionError(errorMessage(e)); }
      finally { if (!cancelled) timer = setTimeout(() => void poll(), document.hidden ? 2500 : 750); }
    }
    void poll();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [sessionId, commit, capture]);
  const pump = useCallback(async () => {
    if (updating.current || !sessionId || !queue.current.length) return;
    updating.current = true; setBusy(true); setActionError('');
    try {
      while (queue.current.length && alive.current && !runningRef.current && !stoppingRef.current) {
        const item = queue.current.shift()!;
        // Keep navigation clickable during automatic fitting; deliberate actions still queue behind it.
        setResizing(item.input.action === 'resize' && queue.current.every(pending => pending.input.action === 'resize'));
        const version = ++generation.current;
        try {
          const next = await post<BrowserState>(`/sessions/${sessionId}/browser`, item.input);
          if (alive.current) { commit(next, ['open', 'navigate', 'back', 'forward', 'reload', 'select', 'resume', 'close'].includes(item.input.action) && item.addressVersion === addressVersion.current); await capture(next, version).catch(e => setConnectionError(errorMessage(e))); }
          item.finish.forEach(resolve => resolve(true));
        } catch (e) {
          if (alive.current) setActionError(errorMessage(e));
          item.finish.forEach(resolve => resolve(false)); clearQueue(); break;
        }
      }
    } finally { updating.current = false; if (alive.current) { setBusy(false); setResizing(false); } }
  }, [sessionId, commit, capture]);
  const action = useCallback((input: BrowserAction): Promise<boolean> => {
    if (!sessionId || runningRef.current || stoppingRef.current || !alive.current) return Promise.resolve(false);
    if (input.action !== 'resize') setResizing(false);
    return new Promise(resolve => {
      const last = queue.current.at(-1);
      // Preserve rapid typing without sending one expensive screenshot request per character.
      if (input.action === 'type' && !input.ref && last?.input.action === 'type' && !last.input.ref && last.input.tabId === input.tabId && (last.input.text?.length || 0) + (input.text?.length || 0) <= 12000) {
        last.input.text = (last.input.text || '') + (input.text || ''); last.finish.push(resolve);
      } else if (input.action === 'find' && (input.findDirection === 'first' || input.findDirection === 'clear') && last?.input.action === 'find' && (last.input.findDirection === 'first' || last.input.findDirection === 'clear') && last.input.tabId === input.tabId) {
        last.finish.forEach(finish => finish(false)); last.input = input; last.finish = [resolve];
      } else queue.current.push({ input, addressVersion: addressVersion.current, finish: [resolve] });
      void pump();
    });
  }, [sessionId, pump]);
  const upload = useCallback(async (input: BrowserUploadAction): Promise<boolean> => {
    if (!sessionId || !alive.current || runningRef.current || updating.current || stoppingRef.current || stateRef.current.busy || queue.current.length) return false;
    updating.current = true; setBusy(true); setActionError(''); const version = ++generation.current;
    try {
      const next = await post<BrowserState>(`/sessions/${sessionId}/browser/upload`, input);
      if (alive.current) { commit(next); await capture(next, version).catch(e => setConnectionError(errorMessage(e))); }
      return true;
    } catch (e) { if (alive.current) setActionError(errorMessage(e)); return false; }
    finally { updating.current = false; if (alive.current) { setBusy(false); void pump(); } }
  }, [sessionId, commit, capture, pump]);
  const stopLoading = useCallback(async () => {
    const current = stateRef.current, tab = current.tabs.find(tab => tab.id === current.activeId);
    if (!sessionId || runningRef.current || stoppingRef.current || !alive.current || !tab?.loading || !tab.navigationId) return false;
    stoppingRef.current = true; setStopping(true); setActionError(''); clearQueue(true);
    try {
      const next = await post<BrowserState>(`/sessions/${sessionId}/browser/stop`, { tabId: tab.id, navigationId: tab.navigationId });
      if (alive.current) commit(next); return true;
    } catch (e) { if (alive.current) setActionError(errorMessage(e)); return false; }
    finally { stoppingRef.current = false; if (alive.current) { setStopping(false); void pump(); } }
  }, [sessionId, commit, pump]);
  return { ready, state, stateRef, frame, busy: busy || state.busy || stopping, navigationBusy: (busy || state.busy) && !resizing || stopping, stopping, stopLoading, address, setAddress, addressFocused, action, upload, error: actionError || connectionError || (state.error !== dismissedError ? state.error : ''), clearError: () => { setActionError(''); setConnectionError(''); setDismissedError(state.error || ''); } };
}
