// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { findInDocument, markDocumentLine } from '../client/src/document-find';
import { highlightedLines } from '../client/src/syntax';
import { documentViewState, readDocumentView, saveDocumentView } from '../client/src/document-state';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } });
});
afterEach(() => vi.unstubAllGlobals());
it('finds literal punctuation, Unicode and separate occurrences without treating text as a regex', () => {
  const text = '🌿 A.[b] a.[b]\nA.[b]';
  expect(findInDocument(text, 'a.[b]').matches).toEqual([
    { line: 1, start: 3, end: 8, index: 0 }, { line: 1, start: 9, end: 14, index: 1 }, { line: 2, start: 0, end: 5, index: 2 },
  ]);
  expect(findInDocument(text, 'a.[b]', true).matches).toHaveLength(1);
  expect(findInDocument(text, '🌿').matches[0]).toMatchObject({ start: 0, end: 2 });
  expect(findInDocument(text, '').matches).toEqual([]);
});
it('bounds decoration work while explicitly reporting additional matches', () => {
  const result = findInDocument('match '.repeat(1_100), 'match');
  expect(result.matches).toHaveLength(1_000); expect(result.more).toBe(true);
  expect(findInDocument('match '.repeat(1_000), 'match').more).toBe(false);
});
it('preserves syntax and source text when a single match crosses highlighted tokens', () => {
  const content = 'export const quiet = "rhythm";', matches = findInDocument(content, 'const quiet').matches;
  const rendered = document.createElement('div'); rendered.innerHTML = markDocumentLine(highlightedLines(content, 'view.ts')[0], matches, 0);
  expect(rendered.textContent).toBe(content); expect(rendered.querySelector('.hljs-keyword mark')?.textContent).toBe('const');
  expect([...rendered.querySelectorAll('mark')].map(mark => mark.textContent).join('')).toBe('const quiet');
  expect([...rendered.querySelectorAll('mark')].every(mark => mark.dataset.fileMatch === '0')).toBe(true);
  expect([...rendered.querySelectorAll('mark')].every(mark => mark.classList.contains('active-match'))).toBe(true);
  rendered.innerHTML = markDocumentLine(highlightedLines(content, 'view.ts')[0], matches, 1);
  expect(rendered.querySelector('.active-match')).toBeNull();
});
it('decorates escaped file contents without interpreting their markup or entities', () => {
  const content = '<img src=x onerror=alert(1)> & café';
  const rendered = document.createElement('div'); rendered.innerHTML = markDocumentLine(highlightedLines(content, 'note.txt')[0], findInDocument(content, '<img').matches);
  expect(rendered.textContent).toBe(content); expect(rendered.querySelector('img')).toBeNull(); expect(rendered.querySelector('mark')?.textContent).toBe('<img');
});
it('validates saved view preferences and preserves the workspace tabs when saving a position', () => {
  expect(documentViewState({ source: 'false', wrap: true, zoom: 99, sourceTop: -30, previewLeft: Infinity, sourceLeft: NaN })).toEqual({ wrap: true, zoom: 3, sourceTop: 0 });
  expect(documentViewState({ pdfPage: 4.9, pdfOffset: 4, pdfLeft: -2, pdfZoom: 99 })).toEqual({ pdfPage: 4, pdfOffset: 1, pdfLeft: 0, pdfZoom: 3 });
  expect(documentViewState({ pdfPage: NaN, pdfOffset: Infinity, pdfLeft: '1', pdfZoom: undefined })).toEqual({});
  localStorage.setItem('tabs', JSON.stringify({ paths: ['source.ts', 'notes.md'], activeFile: 'notes.md', tab: 'files' }));
  saveDocumentView('tabs', 'source.ts', { source: true, sourceTop: 830, wrap: true });
  saveDocumentView('tabs', 'notes.md', { previewTop: 420 });
  expect(readDocumentView('tabs', 'source.ts')).toEqual({ source: true, wrap: true, sourceTop: 830 });
  expect(JSON.parse(localStorage.getItem('tabs')!)).toMatchObject({ paths: ['source.ts', 'notes.md'], activeFile: 'notes.md', tab: 'files', views: { 'notes.md': { previewTop: 420 } } });
  localStorage.setItem('broken', '{'); expect(readDocumentView('broken', 'source.ts')).toEqual({}); expect(() => saveDocumentView('broken', 'source.ts', {})).not.toThrow();
});
