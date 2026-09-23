import { useEffect } from 'react';

export async function copyText(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); return; } catch { /* Older browsers and HTTP connections use the copy event. */ }
  const active = document.activeElement as HTMLElement | null, selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const field = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null;
  const start = field?.selectionStart, end = field?.selectionEnd, direction = field?.selectionDirection;
  // WebKit needs a real selected control for the legacy copy command. Keep
  // the user's selection, editing position and focus intact afterward.
  const temporary = document.createElement('textarea'); temporary.value = text; temporary.readOnly = true; temporary.tabIndex = -1;
  temporary.style.cssText = 'position:fixed;left:-10000px;top:0;opacity:0;pointer-events:none'; document.body.append(temporary); temporary.select();
  const copy = (event: ClipboardEvent) => { event.clipboardData?.setData('text/plain', text); event.preventDefault(); };
  document.addEventListener('copy', copy);
  try { if (!document.execCommand('copy')) throw new Error('Clipboard unavailable.'); }
  finally {
    document.removeEventListener('copy', copy); temporary.remove(); active?.focus({ preventScroll: true });
    if (field && typeof start === 'number' && typeof end === 'number') field.setSelectionRange(start, end, direction || undefined);
    else if (selection) { selection.removeAllRanges(); for (const range of ranges) selection.addRange(range); }
  }
}

export function useCopyOnSelection() {
  useEffect(() => {
    const copy = (event: Event) => {
      if (event instanceof KeyboardEvent && !(event.shiftKey || event.key === 'Shift')) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"], .xterm')) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;
      const text = selection.toString();
      if (text) void copyText(text).catch(() => {});
    };
    document.addEventListener('pointerup', copy);
    document.addEventListener('keyup', copy);
    return () => { document.removeEventListener('pointerup', copy); document.removeEventListener('keyup', copy); };
  }, []);
}
