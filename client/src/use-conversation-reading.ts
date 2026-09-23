import { useLayoutEffect, useRef, useState } from 'react';
import type { SessionDetail } from '../../shared/types';
import { readConversationView, saveConversationView, type ConversationView } from './conversation-state';

function capture(viewport: HTMLElement): Pick<ConversationView, 'top' | 'anchor'> {
  const top = viewport.getBoundingClientRect().top;
  const message = [...viewport.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => node.getBoundingClientRect().bottom > top + 1);
  if (!message) return { top: viewport.scrollTop };
  const bounds = message.getBoundingClientRect(), blocks = [...message.querySelectorAll<HTMLElement>('.markdown > *')];
  const block = blocks.findIndex(node => { const box = node.getBoundingClientRect(); return node.getClientRects().length && box.bottom > top + 1 && box.top < bounds.bottom; });
  const anchor = block >= 0 ? blocks[block] : message;
  return { top: viewport.scrollTop, anchor: { message: message.dataset.messageId!, ...(block >= 0 ? { block } : {}), offset: top - anchor.getBoundingClientRect().top } };
}
function restore(viewport: HTMLElement, value: ConversationView) {
  if (value.following !== false) { viewport.scrollTop = viewport.scrollHeight; return; }
  const message = [...viewport.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => node.dataset.messageId === value.anchor?.message);
  const block = message && value.anchor?.block !== undefined ? message.querySelectorAll<HTMLElement>('.markdown > *')[value.anchor.block] : undefined;
  const anchor = block?.getClientRects().length ? block : message;
  viewport.scrollTop = anchor ? viewport.scrollTop + anchor.getBoundingClientRect().top - viewport.getBoundingClientRect().top + (value.anchor?.offset ?? 0) : value.top ?? 0;
}

/** Keep a task's reading location independent of its live updates and other tasks. */
export function useConversationReading(detail: SessionDetail, inline: boolean) {
  const [initial] = useState(() => inline ? {} : readConversationView(detail.session.id));
  const [expandedSteps, setExpandedSteps] = useState(() => new Map((initial.steps ?? []).map(id => [id, true])));
  const [expandedPrompts, setExpandedPrompts] = useState(() => new Set(initial.prompts));
  const scroll = useRef<HTMLDivElement>(null), view = useRef<ConversationView>(initial), following = useRef(initial.following !== false);
  const [atBottom, setAtBottom] = useState(following.current);
  const save = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const persist = () => { if (!inline) saveConversationView(detail.session.id, view.current); };
  function remember() {
    const viewport = scroll.current; if (inline || !viewport?.clientHeight) return;
    view.current = { ...view.current, ...capture(viewport), following: following.current };
    clearTimeout(save.current); save.current = setTimeout(persist, 120);
  }
  function onScroll() {
    const viewport = scroll.current; if (!viewport?.clientHeight) return;
    following.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 72;
    setAtBottom(following.current); remember();
  }
  function hold() { following.current = false; setAtBottom(false); remember(); }
  function latest() {
    following.current = true; view.current.following = true; setAtBottom(true);
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
    remember();
  }
  useLayoutEffect(() => {
    view.current = { ...view.current, steps: [...expandedSteps].filter(([, value]) => value).map(([id]) => id), prompts: [...expandedPrompts], following: following.current };
    if (!inline && scroll.current?.clientHeight) restore(scroll.current, view.current);
  }, [inline, detail.messages, detail.permissions, detail.questions, expandedSteps, expandedPrompts]);
  useLayoutEffect(() => {
    const viewport = scroll.current, content = viewport?.firstElementChild;
    if (inline || !viewport || !content) return;
    const apply = () => { if (viewport.clientHeight) restore(viewport, { ...view.current, following: following.current }); };
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(apply); observer?.observe(viewport); observer?.observe(content);
    const saveNow = () => { remember(); clearTimeout(save.current); persist(); };
    const visibility = () => { if (document.hidden) saveNow(); };
    const sent = (event: Event) => { if ((event as CustomEvent).detail === detail.session.id) latest(); };
    window.addEventListener('litespeed:conversation-latest', sent); window.addEventListener('pagehide', saveNow); document.addEventListener('visibilitychange', visibility);
    return () => { observer?.disconnect(); clearTimeout(save.current); persist(); window.removeEventListener('litespeed:conversation-latest', sent); window.removeEventListener('pagehide', saveNow); document.removeEventListener('visibilitychange', visibility); };
  }, [inline, detail.session.id]);
  return { scroll, following, atBottom, setAtBottom, remember, hold, latest, onScroll, expandedSteps, setExpandedSteps, expandedPrompts, setExpandedPrompts };
}
