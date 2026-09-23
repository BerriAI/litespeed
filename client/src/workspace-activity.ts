import type { ToolCall } from '../../shared/types';
import { workspaceAttachmentPath } from './file-links';

export type WorkspaceTarget = { kind: 'file'; path: string; line?: number; revision: number } | { kind: 'browser'; url?: string; revision: number } | { kind: 'computer'; revision: number } | { kind: 'review'; path?: string; scope?: 'task' | import('../../shared/git-review').GitReviewScope; revision: number };

/** Only completed, workspace-scoped reads and edits may focus a file preview. */
export function toolTarget(tool: ToolCall, workspace: string, revision: number, previous: readonly string[] = []): WorkspaceTarget | null {
  if ((tool.name === 'browser' || tool.name === 'computer') && (tool.status === 'running' || tool.status === 'completed')) return { kind: tool.name, revision };
  if (tool.status !== 'completed' || !['read_file', 'write_file', 'edit_file'].includes(tool.name) || typeof tool.args.path !== 'string') return null;
  if (tool.args.path.split(/[\\/]/).includes('..')) return null;
  const path = workspaceAttachmentPath(tool.args.path, workspace, previous);
  if (!path) return null;
  return { kind: 'file', path, revision };
}
