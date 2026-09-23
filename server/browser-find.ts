import { randomUUID } from 'node:crypto';
import type { Frame, JSHandle, Page } from 'playwright';
import type { BrowserFindResult } from '../shared/browser.js';

type FrameMatches = { ranges: Range[]; truncated: boolean; active: Highlight; clear: () => void };
type Entry = { handles: { frame: Frame; handle: JSHandle<FrameMatches>; count: number }[]; result?: BrowserFindResult };

/** Search rendered text without rewriting the website or changing its selection. */
function prepareFrame({ query, matchCase, name, limit }: { query: string; matchCase: boolean; name: string; limit: number }): FrameMatches {
  const ranges: Range[] = [], roots = new Set<Document | ShadowRoot>([document]);
  const expression = new RegExp(query.replace(/\s+/g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'gu' : 'giu');
  type Segment = { node: Text; start: number; text: string; starts: number[]; ends: number[] };
  let segments: Segment[] = [], length = 0, block: Node | null = null, root: Node | null = null, characters = 0, visited = 0, truncated = false;
  const blocks = new WeakMap<Element, Element>();
  // Object methods remain self-contained when the dev server preserves function names.
  const helpers = {
    containingBlock(element: Element): Element {
      const ancestors: Element[] = [];
      let current = element, result: Element;
      while (true) {
        const cached = blocks.get(current);
        if (cached) { result = cached; break; }
        ancestors.push(current);
        const parent = current.parentElement;
        if (!parent || !['inline', 'inline-block', 'contents'].includes(getComputedStyle(current).display)) { result = current; break; }
        current = parent;
      }
      for (const ancestor of ancestors) blocks.set(ancestor, result);
      return result;
    },
    separator() {
      const last = segments.at(-1);
      if (last && !last.text.endsWith(' ')) { last.text += ' '; last.starts.push(last.node.length); last.ends.push(last.node.length); length++; }
    },
    flush() {
      if (!length) return;
      const text = segments.map(segment => segment.text).join('');
      for (const match of text.matchAll(expression)) {
        if (ranges.length >= limit) { truncated = true; break; }
        const from = match.index!, to = from + match[0].length - 1;
        const first = segments.find(segment => segment.start + segment.text.length > from)!, last = segments.find(segment => segment.start + segment.text.length > to)!;
        const range = document.createRange(); range.setStart(first.node, first.starts[from - first.start]); range.setEnd(last.node, last.ends[to - last.start]); ranges.push(range);
      }
      segments = []; length = 0;
    },
    clear() { CSS.highlights.delete(name); CSS.highlights.delete(`${name}-active`); for (const scope of roots) scope.adoptedStyleSheets = scope.adoptedStyleSheets.filter(value => value !== sheet); },
  };
  // Iterators bound traversal memory even when an element has thousands of children.
  const stack: Iterator<Node>[] = document.body ? [[document.body][Symbol.iterator]()] : [];
  while (stack.length && !truncated) {
    const next = stack.at(-1)!.next(); if (next.done) { stack.pop(); continue; }
    const node = next.value; if (++visited > 50_000 || characters >= 2_000_000) { truncated = true; break; }
    if (node instanceof Element) {
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT', 'SELECT', 'IFRAME'].includes(node.tagName)) continue;
      const style = getComputedStyle(node); if (style.display === 'none' || style.opacity === '0') continue;
      if (node.tagName === 'BR') { helpers.separator(); continue; }
      if (node.shadowRoot) { roots.add(node.shadowRoot); stack.push(node.shadowRoot.childNodes.values()); }
      else if (node instanceof HTMLSlotElement && node.assignedNodes().length) stack.push(node.assignedNodes({ flatten: true }).values());
      else stack.push(node.childNodes.values());
      continue;
    }
    if (!(node instanceof Text) || !node.parentElement || !node.data) continue;
    const style = getComputedStyle(node.parentElement);
    if (['hidden', 'collapse'].includes(style.visibility) || !['none', ''].includes(style.getPropertyValue('-webkit-text-security'))) continue;
    const probe = document.createRange(); probe.selectNodeContents(node);
    if (![...probe.getClientRects()].some(rect => rect.width > 0 && rect.height > 0)) continue;
    const nextBlock = helpers.containingBlock(node.parentElement), nextRoot = node.getRootNode();
    if (block !== nextBlock || root !== nextRoot) { helpers.flush(); block = nextBlock; root = nextRoot; if (truncated) break; }
    const starts: number[] = [], ends: number[] = [], parts: string[] = [];
    const value = node.data.slice(0, Math.max(0, 2_000_000 - characters)); characters += node.data.length; if (value.length < node.data.length) truncated = true;
    for (const match of value.matchAll(/\s+|\S/gu)) {
      const space = /^\s/u.test(match[0]);
      if (space && !parts.length && segments.at(-1)?.text.endsWith(' ')) continue;
      starts.push(match.index!); ends.push(match.index! + match[0].length); parts.push(space ? ' ' : match[0]);
      // Keep UTF-16 positions aligned when a character uses a surrogate pair.
      if (!space && match[0].length === 2) { starts.push(match.index! + 1); ends.push(match.index! + 2); }
    }
    const text = parts.join(''); if (text) { segments.push({ node, start: length, text, starts, ends }); length += text.length; }
  }
  helpers.flush();
  const sheet = new CSSStyleSheet(); sheet.replaceSync(`::highlight(${name}){background-color:#ffe58b;color:#171717}::highlight(${name}-active){background-color:#f3ad55;color:#171717}`);
  try {
    for (const scope of roots) scope.adoptedStyleSheets = [...scope.adoptedStyleSheets, sheet];
    const active = new Highlight(); CSS.highlights.set(name, new Highlight(...ranges)); CSS.highlights.set(`${name}-active`, active);
    return { ranges, truncated, active, clear: helpers.clear };
  } catch (error) { helpers.clear(); throw error; }
}

export class BrowserFind {
  private entries = new Map<Page, Entry>();
  state(page?: Page) { return page ? this.entries.get(page)?.result : undefined; }
  private async dispose(handle: JSHandle<FrameMatches>) { await handle.evaluate(value => value.clear()).catch(() => {}); await handle.dispose().catch(() => {}); }
  async releasePage(page: Page) {
    const entry = this.entries.get(page); this.entries.delete(page);
    if (entry) await Promise.all(entry.handles.map(({ handle }) => this.dispose(handle)));
  }
  async close() { await Promise.all([...this.entries.keys()].map(page => this.releasePage(page))); }
  async search(page: Page, tabId: string, query: string, matchCase: boolean, direction: 'first' | 'next' | 'previous' | 'clear', guard: () => void): Promise<BrowserFindResult | undefined> {
    const previous = this.state(page); await this.releasePage(page); guard();
    if (!query || direction === 'clear') return;
    const entry: Entry = { handles: [] }; this.entries.set(page, entry);
    const current = () => { guard(); if (this.entries.get(page) !== entry) throw Object.assign(new Error('The page changed while searching. Try again.'), { status: 409 }); };
    let count = 0, truncated = false;
    try {
      for (const frame of page.frames().slice(0, 50)) {
        current(); if (frame.isDetached()) continue;
        let visible = true;
        for (let ancestor: Frame | null = frame; ancestor?.parentFrame(); ancestor = ancestor.parentFrame()) {
          const element = await ancestor.frameElement();
          try { visible &&= await element.isVisible() && await element.evaluate(node => {
            if (!(node instanceof Element)) return false;
            for (let current: Element | null = node; current; current = current.parentElement) if (getComputedStyle(current).opacity === '0') return false;
            return true;
          }); } finally { await element.dispose(); }
          if (!visible) break;
        }
        if (!visible) continue;
        const handle = await frame.evaluateHandle(prepareFrame, { query, matchCase, name: `ls-find-${randomUUID().replaceAll('-', '')}`, limit: 1000 - count });
        if (this.entries.get(page) !== entry) { await this.dispose(handle); current(); }
        const item = { frame, handle, count: 0 }; entry.handles.push(item);
        const summary = await handle.evaluate(value => ({ count: value.ranges.length, truncated: value.truncated }));
        item.count = summary.count; count += summary.count; truncated ||= summary.truncated;
        if (count >= 1000 && truncated) break;
      }
      truncated ||= page.frames().length > 50;
      current();
      const same = previous?.query === query && previous.matchCase === matchCase;
      const active = count ? direction === 'first' || !same ? 0 : ((previous!.active + (direction === 'previous' ? -1 : 1)) % count + count) % count : -1;
      entry.result = { tabId, url: page.url(), query, matchCase, total: count, active, truncated };
      if (active >= 0) {
        let index = active;
        for (const item of entry.handles) {
          if (index >= item.count) { index -= item.count; continue; }
          const ancestors: Frame[] = []; for (let frame: Frame | null = item.frame; frame?.parentFrame(); frame = frame.parentFrame()) ancestors.unshift(frame);
          for (const frame of ancestors) { const element = await frame.frameElement(); try { await element.scrollIntoViewIfNeeded(); } finally { await element.dispose(); } current(); }
          await item.handle.evaluate((value, index) => {
            const range = value.ranges[index]; if (!range?.startContainer.isConnected || range.collapsed) throw new Error('The matching text changed. Search again.');
            value.active.add(range);
            let element = range.startContainer.parentElement;
            while (element) {
              const rect = range.getBoundingClientRect(), bounds = element.getBoundingClientRect();
              if (element.scrollHeight > element.clientHeight && !['visible', 'clip'].includes(getComputedStyle(element).overflowY)) element.scrollTop += rect.top - bounds.top - element.clientTop - (element.clientHeight - rect.height) / 2;
              if (element.scrollWidth > element.clientWidth && !['visible', 'clip'].includes(getComputedStyle(element).overflowX)) element.scrollLeft += rect.left - bounds.left - element.clientLeft - (element.clientWidth - rect.width) / 2;
              const scope: Node = element.getRootNode(); element = element.parentElement || (scope instanceof ShadowRoot ? scope.host as HTMLElement : null);
            }
            const rect = range.getBoundingClientRect(); window.scrollBy({ top: rect.top - (innerHeight - rect.height) / 2, left: rect.left < 0 || rect.right > innerWidth ? rect.left - (innerWidth - rect.width) / 2 : 0, behavior: 'instant' });
          }, index);
          break;
        }
      }
      current(); return entry.result;
    } catch (error) { if (this.entries.get(page) === entry) await this.releasePage(page); throw error; }
  }
}
