import { describe, expect, it } from 'vitest';
import { restoreBrowserAnnotation } from '../client/src/BrowserAnnotation';
import type { ComposerDraft } from '../client/src/api';
const snapshot = { image: 'data:image/jpeg;base64,/9g=', url: 'https://example.com/', title: 'A page', width: 800, height: 600, capturedAt: 1_790_000_000_000 };
const element = { id: '11111111-1111-4111-8111-111111111111', tag: 'h1', selector: '#heading', text: 'Heading', editableText: true, region: { x: 20, y: 20, width: 300, height: 50 }, styles: { fontFamily: 'Arial', fontSize: '32px', fontWeight: '500', lineHeight: '40px', color: 'rgb(0, 0, 0)', backgroundColor: 'transparent', padding: '0px', margin: '0px', borderRadius: '0px' } };
function draft(metadata: Record<string, unknown>): ComposerDraft { return { text: 'A note', attachments: [{ name: 'page.jpg', dataUrl: snapshot.image, content: JSON.stringify(metadata) }] }; }
describe('browser annotation draft restoration', () => {
  it('retains legacy area comments and only known metadata', () => {
    const restored = restoreBrowserAnnotation(draft({ ...snapshot, selection: element.region, unknown: 'ignore' }));
    expect(restored?.snapshot).toMatchObject(snapshot); expect(restored?.selection).toEqual(element.region); expect(restored?.snapshot).not.toHaveProperty('unknown');
  });
  it('retains captured styles and unfinished numeric edits without treating the latter as a valid preview', () => {
    const restored = restoreBrowserAnnotation(draft({ ...snapshot, tabId: element.id, element, changes: { fontSize: 32 }, pendingChanges: { fontSize: 2 }, selection: element.region }));
    expect(restored?.snapshot.changes).toEqual({ fontSize: 32 }); expect(restored?.snapshot.pendingChanges).toEqual({ fontSize: 2 });
  });
  it('rejects malformed metadata, oversized bounds and injected styles', () => {
    for (const extra of [{ capturedAt: 9e15 }, { selection: { ...element.region, width: 801 } }, { tabId: element.id, element: { ...element, region: { ...element.region, height: 1000 } } }, { element }, { tabId: element.id, element, changes: { fontSize: 2 } }, { tabId: element.id, element, pendingChanges: { position: 'fixed' } }, { changes: { color: '#ffffff' } }]) expect(restoreBrowserAnnotation(draft({ ...snapshot, ...extra }))).toBeNull();
  });
});
