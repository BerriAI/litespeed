export interface GitBranchEntry {
  ref: string;
  name: string;
  kind: 'local' | 'remote';
  head: string;
  upstream?: string;
  checkedOutAt?: string;
}
export interface GitBranches {
  isRepo: boolean;
  current: string | null;
  head: string | null;
  entries: GitBranchEntry[];
  changedFiles: number;
  limited: boolean;
  blocked?: string;
}
export type GitBranchRequest = { action: 'switch'; ref: string } | { action: 'create'; name: string } | { action: 'track'; ref: string; name: string };
export interface GitBranchPlan {
  id: string;
  action: GitBranchRequest['action'];
  from: string;
  name: string;
  head: string | null;
  upstream?: string;
  changedFiles: number;
  expiresAt: number;
}
export interface GitBranchResult { message: string; current: string; head: string | null; }
