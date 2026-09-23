import type { Message } from '../../shared/types';

export type FileLink = { path: string; line?: number };
/** Follow recorded task moves back from the current folder. These aliases only
 * produce relative paths for the current workspace; they never read old folders. */
export function previousWorkspaces(messages: readonly Message[], workspace: string): string[] {
  const paths = new Set<string>(); let current = workspace;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index], move = message.role === 'system' ? message.workspaceMove : undefined;
    if (!move) continue;
    if (move.to !== current || !/^\/(?:[^/\x00-\x1f\\]+\/)*[^/\x00-\x1f\\]+$/.test(move.from) || move.from.split('/').some(part => part === '.' || part === '..')) break;
    paths.add(move.from); current = move.from;
  }
  paths.delete(workspace); return [...paths];
}

function relativeAbsolutePath(path: string, workspace: string, previous: readonly string[]): string | null {
  const roots = [workspace, ...previous].map(root => root.replace(/\/$/, '') + '/').sort((a, b) => b.length - a.length);
  const root = roots.find(root => path.startsWith(root));
  return root ? path.slice(root.length) : null;
}
/** Attachments contain literal filesystem paths, not URL-encoded links. */
export function workspaceAttachmentPath(path: string | undefined, workspace: string | undefined, previous: readonly string[] = []): string | null {
  if (!path || !workspace || path.length > 4096 || /[\x00-\x1f\\]/.test(path)) return null;
  if (path.startsWith('/')) { const relative = relativeAbsolutePath(path, workspace, previous); if (relative === null) return null; path = relative; }
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(part);
  }
  return parts.length ? parts.join('/') : null;
}
export function workspaceFileLink(href: string, workspace: string, baseFile = '', previous: readonly string[] = []): FileLink | null {
  if (!href || href.startsWith('#') || href.startsWith('//')) return null;
  // A root-level source reference such as README.md:20 is a file link. An
  // actual URL (including a port ending in digits) must stay a URL.
  if (/^[a-z][a-z\d+.-]*:/i.test(href) && (/^(?:https?|javascript|vbscript|data|file|ftp|mailto|tel|sms|blob|about|codex):/i.test(href) || !/^[^/\\:#?]+:\d+(?::\d+)?$/.test(href))) return null;
  let value: string;
  try { value = decodeURIComponent(href); } catch { return null; }
  const match = value.match(/(?::(\d+)(?::\d+)?|#L(\d+)(?:C\d+)?(?:-L?\d+)?)$/);
  const line = match ? Number(match[1] || match[2]) : undefined;
  if (match) value = value.slice(0, match.index);
  if (/[\x00-\x1f?]/.test(value) || value.includes('\\')) return null;
  let parts: string[] = [];
  if (value.startsWith('/')) { const relative = relativeAbsolutePath(value, workspace, previous); if (relative === null) return null; value = relative; }
  else if (baseFile.includes('/')) parts = baseFile.split('/').slice(0, -1);
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return null; parts.pop(); }
    else parts.push(part);
  }
  if (!parts.length) return null;
  return { path: parts.join('/'), ...(line && Number.isSafeInteger(line) ? { line } : {}) };
}
