import type { Page } from 'playwright';

/** Read only the user's selection, including a focused website frame. */
export async function readBrowserSelection(page: Page): Promise<{ text: string; truncated: boolean }> {
  let frame = page.mainFrame();
  for (let depth = 0; depth < 10; depth++) {
    const focused = await frame.evaluateHandle(() => {
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      return active instanceof HTMLIFrameElement || active instanceof HTMLFrameElement ? active : null;
    });
    let child;
    try { child = await focused.asElement()?.contentFrame(); } finally { await focused.dispose(); }
    if (child) { frame = child; continue; }
    const selected = await frame.evaluate(() => {
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      if (active instanceof HTMLIFrameElement || active instanceof HTMLFrameElement) return null;
      let text = '';
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        if (active instanceof HTMLInputElement && !['text', 'search', 'url', 'tel', 'email'].includes(active.type)) return { text: '', truncated: false };
        if (getComputedStyle(active).getPropertyValue('-webkit-text-security') !== 'none' && getComputedStyle(active).getPropertyValue('-webkit-text-security')) return { text: '', truncated: false };
        if (active.selectionStart !== null && active.selectionEnd !== null) text = active.value.slice(active.selectionStart, active.selectionEnd);
      } else text = window.getSelection()?.toString() || '';
      return { text: text.slice(0, 12000), truncated: text.length > 12000 };
    });
    if (selected) return selected;
  }
  return { text: '', truncated: false };
}
