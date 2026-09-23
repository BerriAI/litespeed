export type DocumentViewState = { source?: boolean; wrap?: boolean; zoom?: number; sourceTop?: number; sourceLeft?: number; previewTop?: number; previewLeft?: number; pdfPage?: number; pdfOffset?: number; pdfLeft?: number; pdfZoom?: number };

export function documentViewState(value: unknown): DocumentViewState {
  if (!value || typeof value !== 'object') return {};
  const input = value as Record<string, unknown>, result: DocumentViewState = {};
  for (const key of ['source', 'wrap'] as const) if (typeof input[key] === 'boolean') result[key] = input[key];
  for (const key of ['sourceTop', 'sourceLeft', 'previewTop', 'previewLeft'] as const) if (typeof input[key] === 'number' && Number.isFinite(input[key])) result[key] = Math.max(0, Math.min(10_000_000, input[key]));
  if (typeof input.zoom === 'number' && Number.isFinite(input.zoom)) result.zoom = Math.max(.5, Math.min(3, input.zoom));
  if (typeof input.pdfPage === 'number' && Number.isFinite(input.pdfPage)) result.pdfPage = Math.max(1, Math.min(100_000, Math.floor(input.pdfPage)));
  for (const key of ['pdfOffset', 'pdfLeft'] as const) if (typeof input[key] === 'number' && Number.isFinite(input[key])) result[key] = Math.max(0, Math.min(1, input[key]));
  if (typeof input.pdfZoom === 'number' && Number.isFinite(input.pdfZoom)) result.pdfZoom = Math.max(.5, Math.min(3, input.pdfZoom));
  return result;
}

export function readDocumentView(key: string | undefined, path: string): DocumentViewState {
  try { return key ? documentViewState(JSON.parse(localStorage.getItem(key) || '{}').views?.[path]) : {}; } catch { return {}; }
}
export function saveDocumentView(key: string | undefined, path: string, view: DocumentViewState): void {
  if (!key) return;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    const paths = Array.isArray(saved.paths) ? saved.paths.filter((value: unknown): value is string => typeof value === 'string').slice(-12) : [];
    const views = Object.fromEntries([...new Set([...paths, path])].slice(-12).map(name => [name, name === path ? documentViewState(view) : documentViewState(saved.views?.[name])]));
    localStorage.setItem(key, JSON.stringify({ ...saved, views }));
  } catch { /* Reading a file remains available when browser storage is full. */ }
}
