import type { FileChange } from './types.js';

export type GitReviewScope = 'unstaged' | 'staged' | 'branch';
export interface GitReviewEntry { path: string; status: 'added' | 'modified' | 'deleted' | 'conflicted'; additions: number | null; deletions: number | null; untracked?: boolean; }
export interface GitReview {
  isRepo: boolean;
  branch: string;
  head: string | null;
  base: string | null;
  baseRef: string | null;
  refs: string[];
  scope: GitReviewScope;
  files: GitReviewEntry[];
  limited: boolean;
  revision: string;
}
export interface GitFileDiff extends FileChange { revision: string; notice?: string; binary?: boolean; truncated?: boolean; }
export interface ReviewComment { path: string; side: 'before' | 'after'; line: number; text: string; }
export type GitAction = 'stage' | 'unstage' | 'commit' | 'push';
export interface GitActionPlan {
  id: string; action: GitAction; files: string[]; branch: string; expiresAt: number;
  destination?: { remote: string; branch: string; url: string };
}
export interface GitActionResult { action: GitAction; message: string; head?: string; }
