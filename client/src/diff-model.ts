import { diffLines } from 'diff';
import type { FileChange } from '../../shared/types';

export type Row = { before?: number; after?: number; text: string; kind: 'added' | 'removed' | 'context' };
export function diffRows(change: FileChange): Row[] | null {
  if ((change.before?.length || 0) + (change.after?.length || 0) > 512_000) return null;
  const parts = diffLines(change.before ?? '', change.after ?? '', { timeout: 150 });
  if (!parts) return null;
  let before = 0, after = 0;
  return parts.flatMap(part => {
    const lines = part.value.split('\n'); if (lines.at(-1) === '') lines.pop();
    return lines.map(text => ({ text, kind: part.added ? 'added' as const : part.removed ? 'removed' as const : 'context' as const, before: part.added ? undefined : ++before, after: part.removed ? undefined : ++after }));
  });
}
export function diffStats(change: FileChange) {
  const rows = diffRows(change);
  return rows ? { additions: rows.filter(row => row.kind === 'added').length, deletions: rows.filter(row => row.kind === 'removed').length } : null;
}
