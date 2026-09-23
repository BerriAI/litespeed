export type ComputerWindow = { id: string; app: string; title: string };
export type ComputerApp = { bundleId: string; name: string; running: boolean; active: boolean };
export type ComputerElement = { ref: string; role: string; label: string; value?: string };
export type ComputerState = {
  windows: ComputerWindow[]; windowId: string | null; busy: boolean; revision: number;
  snapshotId: string | null; capturedAt: number | null; image: { width: number; height: number } | null;
  elements: ComputerElement[]; notice?: string; error?: string;
  apps?: ComputerApp[];
  status: 'unchecked' | 'ready' | 'missing' | 'permissions';
};
export type ComputerAction = {
  action: 'windows' | 'apps' | 'launch' | 'select' | 'snapshot' | 'click' | 'drag' | 'type' | 'key' | 'scroll' | 'menu' | 'release';
  windowId?: string; snapshotId?: string; ref?: string; x?: number; y?: number;
  text?: string; key?: string; modifiers?: ('cmd' | 'shift' | 'option' | 'ctrl' | 'fn')[];
  direction?: 'up' | 'down' | 'left' | 'right'; amount?: number; menu?: string[];
  delivery?: 'background' | 'foreground';
  bundleId?: string; toX?: number; toY?: number; durationMs?: number;
};
