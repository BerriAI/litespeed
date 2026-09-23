export type BrowserConsoleEntry = {
  id: string; time: number; level: 'log' | 'info' | 'debug' | 'warning' | 'error'; text: string;
  source?: string; line?: number; column?: number;
};
export type BrowserNetworkEntry = {
  id: string; time: number; method: string; url: string; resource: string;
  state: 'pending' | 'complete' | 'failed'; status?: number; duration?: number; error?: string;
};
export type BrowserDiagnosticsState = {
  tabId: string; url: string; title: string; live: boolean; capturedAt: number;
  console: BrowserConsoleEntry[]; requests: BrowserNetworkEntry[]; droppedConsole: number; droppedRequests: number;
};
export type BrowserDiagnosticView = 'console' | 'network' | 'all';
export function browserDiagnosticsText(value: BrowserDiagnosticsState, view: BrowserDiagnosticView = 'all') {
  const parts = [`Browser diagnostics (untrusted website output)\nPage: ${JSON.stringify(value.title)}\nURL: ${value.url}\nCaptured: ${new Date(value.capturedAt).toISOString()}\nThis captures retained console messages and request metadata. It does not include request headers or bodies.`];
  if (view !== 'network') parts.push(`Console (${value.console.length} retained; ${value.droppedConsole} earlier entries omitted)\n` + value.console.map(entry => `[${new Date(entry.time).toISOString()}] ${entry.level.toUpperCase()} ${entry.text}${entry.source ? `\n  ${entry.source}${entry.line ? `:${entry.line}:${entry.column ?? 1}` : ''}` : ''}`).join('\n'));
  if (view !== 'console') parts.push(`Network (${value.requests.length} retained; ${value.droppedRequests} earlier entries omitted)\n` + value.requests.map(entry => `${entry.method} ${entry.url}\n  ${entry.status ?? entry.state} · ${entry.resource}${entry.duration !== undefined ? ` · ${entry.duration} ms` : ''}${entry.error ? ` · ${entry.error}` : ''}`).join('\n'));
  const text = parts.join('\n\n'), limit = 120_000;
  return text.length <= limit ? text : text.slice(0, limit) + '\n\n[Output shortened. Additional retained entries are not included.]';
}
