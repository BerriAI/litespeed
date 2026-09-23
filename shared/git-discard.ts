export type DiscardFile = { path: string; kind: 'modified' | 'new' | 'deleted' };
export type DiscardPlan = { id: string; action: 'discard' | 'restore'; files: DiscardFile[]; branch: string; expiresAt: number; bytes: number };
export type DiscardBackup = {
  id: string; workspace: string; createdAt: number; branch: string; status: 'discarding' | 'discarded' | 'interrupted' | 'restoring' | 'restored';
  files: { path: string; state: 'pending' | 'discarded' | 'restored'; hasOriginal: boolean }[]; bytes: number;
};
export type DiscardResult = { message: string; backup: DiscardBackup };
