export type BrowserTab = { id: string; title: string; url: string; suspended?: boolean; canGoBack?: boolean; canGoForward?: boolean; loading?: boolean; navigationId?: string };
export type BrowserStopRequest = { tabId: string; navigationId: string };
export type BrowserSelectionRequest = { tabId: string; revision: number };
export type BrowserSelection = BrowserSelectionRequest & { text: string; truncated: boolean; url: string; title: string; capturedAt: number };
export type BrowserFindResult = { tabId: string; url: string; query: string; matchCase: boolean; total: number; active: number; truncated: boolean };
export const browserUploadLimit = 8 * 1024 * 1024;
export type BrowserUploadRequest = { id: string; tabId: string; url: string; pageUrl: string; multiple: boolean; accept: string; directory: boolean; createdAt: number };
export type BrowserUploadFile = { name: string; mimeType: string; data: string };
export type BrowserUploadAction = { action: 'cancel'; requestId: string; tabId: string } | { action: 'upload'; requestId: string; tabId: string; files: BrowserUploadFile[] };
export type BrowserFrame = { tabId: string; data: string; pageUrl: string; title: string; width: number; height: number; capturedAt: number };
export type BrowserPreferences = { searchEngine: 'google' | 'duckduckgo' | 'bing'; rememberHistory: boolean; downloadDirectory?: string; autoSaveDownloads?: boolean };
export const defaultBrowserPreferences: BrowserPreferences = { searchEngine: 'google', rememberHistory: true };
export type BrowserHistoryEntry = { id: string; url: string; title: string; visitedAt: number; visits: number };
export type BrowserHistoryResult = { entries: BrowserHistoryEntry[]; total: number; error?: string };
export function browserAddress(value: string, searchEngine: BrowserPreferences['searchEngine'] = 'google') {
  const text = value.trim();
  if (/\s/.test(text) || !text.includes('.') && !text.includes(':') && !text.includes('/')) {
    const base = { google: 'https://www.google.com/search?q=', duckduckgo: 'https://duckduckgo.com/?q=', bing: 'https://www.bing.com/search?q=' }[searchEngine];
    return base + encodeURIComponent(text);
  }
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(text)) return `http://${text}`;
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}
export type BrowserDownload = { id: string; tabId: string; name: string; url: string; createdAt: number; status: 'receiving' | 'ready' | 'failed'; size: number; error?: string; savedPath?: string; savedAt?: number; saveError?: string };
export type BrowserState = { tabs: BrowserTab[]; activeId: string | null; busy: boolean; width: number; height: number; revision: number; downloads?: BrowserDownload[]; upload?: BrowserUploadRequest; find?: BrowserFindResult; preferences?: BrowserPreferences; error?: string };
export type BrowserAction = {
  action: 'open' | 'navigate' | 'back' | 'forward' | 'reload' | 'select' | 'resume' | 'close' | 'snapshot' | 'click' | 'drag' | 'type' | 'key' | 'scroll' | 'resize' | 'downloads' | 'diagnostics' | 'find';
  findDirection?: 'first' | 'next' | 'previous' | 'clear'; matchCase?: boolean;
  view?: 'console' | 'network' | 'all';
  tabId?: string; url?: string; ref?: string; text?: string; key?: string; x?: number; y?: number; delta?: number; width?: number; height?: number;
  toX?: number; toY?: number; revision?: number; durationMs?: number; modifiers?: ('Shift' | 'Control' | 'Alt' | 'Meta')[];
};
