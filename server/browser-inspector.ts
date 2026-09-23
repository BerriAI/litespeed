import { randomUUID } from 'node:crypto';
import type { ElementHandle, Page } from 'playwright';
import { z } from 'zod';
import type { BrowserInspectedElement, BrowserInspectorResult, BrowserStyleChanges } from '../shared/browser-inspector.js';

import { browserStyleChangesSchema } from '../shared/browser-inspector.js';
export { browserStyleChangesSchema } from '../shared/browser-inspector.js';
const tabId = z.string().uuid();
export const browserInspectorSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('select'), tabId, url: z.string().max(8192), width: z.number().int().min(320).max(1280), height: z.number().int().min(240).max(1200), x: z.number().min(0).max(1280), y: z.number().min(0).max(1200) }).strict(),
  z.object({ action: z.literal('preview'), tabId, elementId: z.string().uuid(), changes: browserStyleChangesSchema }).strict(),
  z.object({ action: z.literal('refresh'), tabId }).strict(),
  z.object({ action: z.literal('release'), tabId, elementId: z.string().uuid() }).strict(),
]);
export type BrowserInspectorInput = z.infer<typeof browserInspectorSchema>;
type Entry = { page: Page; owner: string; tabId: string; element: ElementHandle<HTMLElement | SVGElement>; info: BrowserInspectedElement; url: string; width: number; height: number; timer?: ReturnType<typeof setTimeout> };
const failed = (message: string) => Object.assign(new Error(message), { status: 409 });

function cssChanges(changes: BrowserStyleChanges): Record<string, string> {
  const names = { fontFamily: 'font-family', fontSize: 'font-size', fontWeight: 'font-weight', lineHeight: 'line-height', color: 'color', backgroundColor: 'background-color', padding: 'padding', margin: 'margin', borderRadius: 'border-radius' };
  return Object.fromEntries(Object.entries(changes).filter(([key]) => key !== 'text').map(([key, value]) => [names[key as keyof typeof names], `${value}${['fontSize', 'padding', 'margin', 'borderRadius'].includes(key) ? 'px' : ''}`]));
}
/** Exact element handles are short-lived and task-owned. A preview applies
 * only fixed style properties, captures an image, then restores those properties. */
export class BrowserInspector {
  private entries = new Map<string, Entry>();
  async releasePage(page: Page) {
    await Promise.all([...this.entries].filter(([, entry]) => entry.page === page).map(([id]) => this.release(id)));
  }
  private async release(id: string) {
    const entry = this.entries.get(id); if (!entry) return;
    this.entries.delete(id); clearTimeout(entry.timer); await entry.element.dispose().catch(() => {});
  }
  private async geometry(entry: Entry) {
    if (entry.page.isClosed() || entry.page.url() !== entry.url) throw failed('The page changed. Select the element again.');
    const viewport = entry.page.viewportSize();
    if (!viewport || viewport.width !== entry.width || viewport.height !== entry.height) throw failed('The browser was resized. Start a new comment on the current page.');
    const region = await entry.element.evaluate(element => {
      if (!element.isConnected || getComputedStyle(element).visibility !== 'visible') return null;
      const rect = element.getBoundingClientRect(), x = Math.max(0, rect.x), y = Math.max(0, rect.y);
      return { x, y, width: Math.max(0, Math.min(innerWidth, rect.right) - x), height: Math.max(0, Math.min(innerHeight, rect.bottom) - y) };
    }).catch(() => null);
    if (!region || !region.width || !region.height) throw failed('The element is no longer visible. Select it again.');
    return region;
  }
  async execute(owner: string, page: Page, input: BrowserInspectorInput, signal?: AbortSignal): Promise<BrowserInspectorResult | null> {
    signal?.throwIfAborted();
    if (input.action === 'refresh') {
      await this.releasePage(page);
      return this.pageSnapshot(page, signal);
    }
    if (input.action === 'release') {
      const entry = this.entries.get(input.elementId);
      if (entry && (entry.owner !== owner || entry.page !== page || entry.tabId !== input.tabId)) throw failed('This element belongs to another browser tab.');
      await this.release(input.elementId); return null;
    }
    if (input.action === 'select') {
      const viewport = page.viewportSize();
      if (page.url() !== input.url || viewport?.width !== input.width || viewport?.height !== input.height || input.x >= input.width || input.y >= input.height) throw failed('The page changed since the snapshot. Start a new comment.');
      await this.releasePage(page);
      const handle = await page.evaluateHandle(({ x, y }) => {
        let element = document.elementFromPoint(x, y);
        for (let depth = 0; depth < 8 && element?.shadowRoot; depth++) { const child = element.shadowRoot.elementFromPoint(x, y); if (!child || child === element) break; element = child; }
        return element;
      }, { x: input.x, y: input.y });
      const element = handle.asElement() as ElementHandle<HTMLElement | SVGElement> | null;
      if (!element) { await handle.dispose(); throw failed('No page element was found here. Drag to select an area instead.'); }
      let retained = false;
      try {
        const details = await element.evaluate(element => {
          if (!(element instanceof HTMLElement || element instanceof SVGElement) || ['iframe', 'object', 'embed', 'script', 'style'].includes(element.tagName.toLowerCase())) return null;
          const style = getComputedStyle(element), rect = element.getBoundingClientRect();
          if (!element.isConnected || !rect.width || !rect.height || style.visibility === 'hidden') return null;
          const path: string[] = []; let node: Element | null = element;
          for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
            if (node.id) { path.unshift('#' + CSS.escape(node.id)); break; }
            const tag = node.tagName.toLowerCase(), siblings: Element[] = node.parentElement ? [...node.parentElement.children].filter(sibling => sibling.tagName === node!.tagName) : [];
            path.unshift(tag + (siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(node) + 1})` : ''));
          }
          const editableText = !['textarea', 'option'].includes(element.tagName.toLowerCase()) && element.childNodes.length === 1 && element.firstChild?.nodeType === Node.TEXT_NODE && (element.firstChild.textContent?.length ?? 0) <= 2000;
          return {
            tag: element.tagName.toLowerCase(), selector: path.join(' > ').slice(0, 1000), text: (editableText ? element.firstChild?.textContent || '' : (element instanceof HTMLElement ? element.innerText : element.textContent) || '').slice(0, 2000), editableText,
            styles: { fontFamily: style.fontFamily.slice(0, 500), fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, color: style.color, backgroundColor: style.backgroundColor, padding: style.padding, margin: style.margin, borderRadius: style.borderRadius },
          };
        });
        if (!details) throw failed('Use an area comment for this part of the page.');
        const id = randomUUID();
        const entry: Entry = { owner, tabId: input.tabId, page, element, info: { ...details, id, region: { x: 0, y: 0, width: 0, height: 0 } }, url: input.url, width: input.width, height: input.height };
        entry.info.region = await this.geometry(entry); signal?.throwIfAborted();
        const result = await this.capture(entry, signal);
        while (this.entries.size >= 64) await this.release(this.entries.keys().next().value!);
        entry.timer = setTimeout(() => { void this.release(id); }, 10 * 60_000); entry.timer.unref();
        this.entries.set(id, entry); retained = true;
        return result;
      } finally { if (!retained) await element.dispose().catch(() => {}); }
    }
    const entry = this.entries.get(input.elementId);
    if (!entry || entry.owner !== owner || entry.page !== page || entry.tabId !== input.tabId) throw failed('This element selection expired. Select it again before adjusting styles.');
    await this.geometry(entry);
    const changes = browserStyleChangesSchema.parse(input.changes);
    if (changes.text !== undefined && !entry.info.editableText) throw failed('This element contains other controls. Describe its text change in the comment.');
    const properties = cssChanges(changes), hasChanges = Object.keys(changes).length > 0;
    if (!hasChanges) return this.capture(entry, signal);
    const saved = await entry.element.evaluateHandle((element, { properties, text }) => {
      if (!element.isConnected) throw new Error('The selected element was removed.');
      const textNode = element.childNodes.length === 1 && element.firstChild?.nodeType === Node.TEXT_NODE ? element.firstChild : null;
      if (text !== undefined && !textNode) throw new Error('The selected text changed.');
      const originalText = textNode?.textContent ?? null, originalStyle = element.getAttribute('style');
      // Expand only the affected shorthands. Restoring a shorthand alone would
      // lose asymmetric longhands, mixed priorities, and animation subproperties.
      const requested = [...Object.keys(properties), 'transition', 'animation'];
      const computed = getComputedStyle(element);
      const names = [...new Set(requested.flatMap(name => {
        if (['padding', 'margin', 'transition', 'animation'].includes(name)) return [...computed].filter(key => key.startsWith(name + '-'));
        if (name === 'border-radius') return ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius'];
        return [name];
      }))];
      const previous = Object.fromEntries(names.map(name => [name, { value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name) }]));
      for (const [name, value] of Object.entries({ ...properties, transition: 'none', animation: 'none' })) element.style.setProperty(name, value, 'important');
      if (text !== undefined && textNode) textNode.textContent = text;
      return { element, textNode, originalStyle, appliedStyle: element.getAttribute('style'), previous, applied: Object.fromEntries(names.map(name => [name, { value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name) }])), originalText, appliedText: text ?? null };
    }, { properties, text: changes.text });
    try { signal?.throwIfAborted(); return await this.capture(entry, signal); }
    finally {
      // Preserve the exact original attribute in the ordinary case. If the
      // website changed styles during capture, its newer values take precedence.
      await saved.evaluate(saved => {
        const { element } = saved;
        if (element.getAttribute('style') === saved.appliedStyle) {
          if (saved.originalStyle === null) element.removeAttribute('style'); else element.setAttribute('style', saved.originalStyle);
        } else for (const [name, previous] of Object.entries(saved.previous)) {
          if (element.style.getPropertyValue(name) !== saved.applied[name].value || element.style.getPropertyPriority(name) !== saved.applied[name].priority) continue;
          if (previous.value) element.style.setProperty(name, previous.value, previous.priority); else element.style.removeProperty(name);
        }
        if (saved.appliedText !== null && element.childNodes.length === 1 && element.firstChild === saved.textNode && saved.textNode?.textContent === saved.appliedText) saved.textNode.textContent = saved.originalText;
      }).catch(error => { if (!entry.page.isClosed() && entry.page.url() === entry.url && !/Execution context was destroyed|Cannot find context with specified id/.test(String(error))) throw failed('The preview could not restore the page. Reload it before continuing.'); }).finally(() => saved.dispose().catch(() => {}));
    }
  }

  private async pageSnapshot(page: Page, signal?: AbortSignal): Promise<BrowserInspectorResult> {
    const url = page.url(), viewport = page.viewportSize();
    if (!/^https?:\/\//.test(url) || url.length > 8192 || !viewport) throw failed('Open a website before starting a page comment.');
    signal?.throwIfAborted();
    const document = await page.evaluateHandle(() => window.document);
    try {
      const image = await page.screenshot({ type: 'jpeg', quality: 82, timeout: 5000 }), title = (await page.title()).slice(0, 500);
      signal?.throwIfAborted();
      const current = page.viewportSize(), sameDocument = await document.evaluate(value => value === window.document).catch(() => false);
      if (!sameDocument || page.isClosed() || page.url() !== url || current?.width !== viewport.width || current?.height !== viewport.height) throw failed('The page changed during capture. Try refreshing the snapshot again.');
      return { image: `data:image/jpeg;base64,${image.toString('base64')}`, ...viewport, url, title, capturedAt: Date.now() };
    } finally { await document.dispose().catch(() => {}); }
  }

  private async capture(entry: Entry, signal?: AbortSignal): Promise<BrowserInspectorResult> {
    const region = await this.geometry(entry); signal?.throwIfAborted();
    const image = await entry.page.screenshot({ type: 'jpeg', quality: 82, timeout: 5000 });
    const after = await this.geometry(entry); signal?.throwIfAborted();
    if (Object.entries(region).some(([key, value]) => Math.abs(value - after[key as keyof typeof after]) > 0.5)) throw failed('The element moved during capture. Select a stable area of the page instead.');
    return { element: { ...entry.info, region }, image: `data:image/jpeg;base64,${image.toString('base64')}`, width: entry.width, height: entry.height, url: entry.url, title: (await entry.page.title()).slice(0, 500), capturedAt: Date.now() };
  }
  async close() { await Promise.all([...this.entries.keys()].map(id => this.release(id))); }
}
