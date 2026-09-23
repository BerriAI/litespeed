export interface ProjectWorktree {
  id: string; project: string; path: string; name: string; branch: string; head: string;
  createdAt: number; status: 'creating' | 'ready' | 'removing' | 'error' | 'removed'; error?: string;
  gitDir?: string; commonDir: string;
  snapshot?: { head: string; branch: string; ref: string; createdAt: number };
  pullRequest?: { number: number; repository: string; url: string; title: string; base: string };
}
export interface WorktreePlan {
  id: string; project: string; name: string; branch: string; head: string;
  sourceBranch: string | null; changedFiles: number; path: string; expiresAt: number;
  pullRequest?: ProjectWorktree['pullRequest'];
  localEdits?: { files: WorktreeCopiedFile[]; bytes: number };
  localSetup?: WorktreeSetupFiles;
}
export interface WorktreeCopiedFile { path: string; status: string; bytes: number; }
export interface WorktreeSetupFiles {
  files: { path: string; bytes: number }[]; skipped: { path: string; reason: string }[]; bytes: number; hasRules: boolean;
}
export interface WorktreeRemovalPlan { id: string; worktreeId: string; path: string; branch: string | null; head: string; expiresAt: number; }
export interface WorktreeRestorePlan { id: string; worktreeId: string; project: string; path: string; name: string; head: string; sourceBranch: string; branch: string; snapshotAt: number; expiresAt: number; }
export interface TaskWorktreePlan extends WorktreePlan { sessionId: string; configRevision: number; historyRevision: number; }
export interface TaskLocalPlan {
  id: string; sessionId: string; worktreeId: string; from: string; project: string;
  sourceBranch: string | null; head: string; previousBranch: string | null; previousHead: string;
  branch: string; changedFiles: number; localEdits: { files: WorktreeCopiedFile[]; bytes: number };
  configRevision: number; historyRevision: number; expiresAt: number;
}
export type TaskWorktree = Pick<ProjectWorktree, 'id' | 'project' | 'branch' | 'head' | 'pullRequest'> & { removed?: boolean; restorable?: boolean };
