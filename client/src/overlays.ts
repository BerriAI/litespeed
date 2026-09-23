import { useSyncExternalStore } from 'react';

let count = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => count > 0;
export function enterOverlay() {
  let open = true; count++; listeners.forEach(listener => listener());
  return () => { if (open) { open = false; count--; listeners.forEach(listener => listener()); } };
}
export function useOverlayOpen() { return useSyncExternalStore(subscribe, snapshot, () => false); }
