// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { McpImporter } from '../client/src/McpImporter';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const candidate = { id: 'a'.repeat(32), rootId: 'claude:user' as const, source: 'claude' as const, scope: 'user' as const, name: 'demo', transport: 'stdio' as const, envKeys: ['TOKEN'], compatible: true, conflict: false };
const json = (value: unknown) => new Response(JSON.stringify(value));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function button(label: string) { const value = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === label); expect(value).toBeDefined(); return value!; }
async function mount(props: Partial<Parameters<typeof McpImporter>[0]> = {}) { const root = createRoot(document.body.appendChild(document.createElement('div'))); await act(async () => root.render(createElement(McpImporter, { workspace: '/work', onClose: vi.fn(), onImported: vi.fn(), ...props }))); return root; }
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

it('discovers issues and requires explicit selection, review, and confirmation', async () => {
  const calls: string[] = []; let imported: any;
  vi.stubGlobal('fetch', vi.fn(async (input: string) => { const path = String(input); calls.push(path); if (path.includes('discover')) return json({ candidates: [candidate], issues: ['codex project: unavailable'] }); if (path === '/api/mcp') return json({ configRevision: 'fresh' }); if (path.includes('/plan')) return json({ candidates: [candidate], sourceHash: 'b'.repeat(64), warnings: ['review warning'], destination: 'global-settings' }); return json({ imported: ['demo'], skipped: [], configRevision: 'next' }); }));
  const root = await mount({ onImported: value => { imported = value; } }); await act(async () => {});
  expect(document.body.textContent).toContain('codex project: unavailable'); expect(calls.some(path => path.includes('/apply'))).toBe(false);
  await act(async () => document.querySelector<HTMLInputElement>('input')!.click()); await act(async () => button('Review selected servers').click()); await act(async () => {});
  expect(document.body.textContent).toContain('review warning'); expect(calls).toContain('/api/mcp'); await act(async () => button('Confirm import').click()); await act(async () => {});
  expect(imported.imported).toEqual(['demo']); expect(calls.filter(path => path.includes('/apply'))).toHaveLength(1); await act(async () => root.unmount());
});

it('shows empty discovery, retries after an error, and clears stale state on refresh', async () => {
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: string) => { if (!String(input).includes('discover')) throw new Error('unexpected'); calls++; if (calls === 1) throw new Error('offline'); return json(calls === 2 ? { candidates: [], issues: [] } : { candidates: [candidate], issues: [] }); }));
  const root = await mount(); await act(async () => {}); expect(document.body.textContent).toContain('offline'); await act(async () => button('Retry discovery').click()); await act(async () => {});
  expect(document.body.textContent).toContain('No importable MCP configurations found.'); await act(async () => button('Refresh discovery').click()); await act(async () => {}); expect(document.body.textContent).toContain('demo'); await act(async () => root.unmount());
});

it('does not close while deferred discovery is busy and ignores its completion after unmount', async () => {
  const request = deferred<Response>(), onClose = vi.fn(); vi.stubGlobal('fetch', vi.fn(() => request.promise));
  const root = await mount({ onClose }); await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); expect(onClose).not.toHaveBeenCalled();
  await act(async () => root.unmount()); await act(async () => request.resolve(json({ candidates: [candidate], issues: [] }))); expect(onClose).not.toHaveBeenCalled();
});
