import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComputerAction, ComputerState } from '../../shared/computer';
import { api, errorMessage, post } from './api';

const empty: ComputerState = { windows: [], windowId: null, busy: false, revision: 0, snapshotId: null, capturedAt: null, image: null, elements: [], status: 'unchecked' };
type Frame = { url: string; id: string; windowId: string; width: number; height: number };
type Pending = { input: ComputerAction; finish: ((success: boolean) => void)[] };
export function useComputer(sessionId: string | undefined, running: boolean) {
  const [state, setState] = useState(empty), [frame, setFrame] = useState<Frame | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [dismissedError, setDismissedError] = useState('');
  const alive = useRef(true), updating = useRef(false), generation = useRef(0), objectUrl = useRef(''), frameId = useRef('');
  const stateRef = useRef(state), runningRef = useRef(running), queue = useRef<Pending[]>([]); runningRef.current = running;
  const clearQueue = () => { for (const item of queue.current.splice(0)) item.finish.forEach(resolve => resolve(false)); };
  const commit = useCallback((next: ComputerState) => { stateRef.current = next; setState(next); if (!next.image || !next.snapshotId) { setFrame(null); frameId.current = ''; } }, []);
  const capture = useCallback(async (next: ComputerState, version: number, signal?: AbortSignal) => {
    if (!sessionId || !next.image || !next.snapshotId || next.snapshotId === frameId.current) return;
    const response = await fetch(`/api/sessions/${sessionId}/computer/frame?snapshotId=${encodeURIComponent(next.snapshotId)}`, { signal });
    if (response.status === 204) return;
    if (!response.ok) throw new Error('The window preview is reconnecting.');
    const blob = await response.blob();
    if (!alive.current || version !== generation.current) return;
    const previous = objectUrl.current, url = URL.createObjectURL(blob); objectUrl.current = url; frameId.current = next.snapshotId;
    setFrame({ url, id: next.snapshotId, windowId: next.windowId!, ...next.image }); if (previous) URL.revokeObjectURL(previous);
  }, [sessionId]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; clearQueue(); if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }; }, []);
  useEffect(() => { if (running) clearQueue(); }, [running]);
  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const version = generation.current;
      try {
        if (updating.current) return;
        const next = await api<ComputerState>(`/sessions/${sessionId}/computer`, { signal: controller.signal });
        if (!alive.current || controller.signal.aborted || updating.current || version !== generation.current) return;
        commit(next); await capture(next, version, controller.signal);
      } catch (error) { if (alive.current && !controller.signal.aborted) setError(errorMessage(error)); }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => void poll(), document.hidden ? 2500 : 750); }
    }
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [sessionId, capture, commit]);
  const pump = useCallback(async () => {
    if (updating.current || !sessionId) return;
    updating.current = true; setBusy(true); setError('');
    try {
      while (queue.current.length && alive.current && !runningRef.current) {
        const item = queue.current.shift()!, version = ++generation.current;
        try {
          const next = await post<ComputerState>(`/sessions/${sessionId}/computer`, item.input);
          if (alive.current) { commit(next); await capture(next, version); }
          item.finish.forEach(resolve => resolve(true));
        } catch (error) { if (alive.current) setError(errorMessage(error)); item.finish.forEach(resolve => resolve(false)); clearQueue(); break; }
      }
    } finally { updating.current = false; if (alive.current) setBusy(false); }
  }, [sessionId, capture, commit]);
  const action = useCallback((input: ComputerAction): Promise<boolean> => {
    if (!sessionId || runningRef.current || !alive.current) return Promise.resolve(false);
    return new Promise(resolve => {
      const last = queue.current.at(-1);
      if (input.action === 'type' && !input.ref && !input.snapshotId && last?.input.action === 'type' && !last.input.ref && !last.input.snapshotId && last.input.windowId === input.windowId && (last.input.text?.length || 0) + (input.text?.length || 0) <= 5000) {
        last.input.text = (last.input.text || '') + (input.text || ''); last.finish.push(resolve);
      } else queue.current.push({ input, finish: [resolve] });
      void pump();
    });
  }, [sessionId, pump]);
  return { state, stateRef, frame, busy: busy || state.busy, action, error: error || (state.error !== dismissedError ? state.error : ''), clearError: () => { setError(''); setDismissedError(state.error || ''); } };
}
