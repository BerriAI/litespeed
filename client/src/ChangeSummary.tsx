import { useEffect, useMemo, useState } from 'react';
import { FileCode2, GitCompareArrows, Undo2 } from 'lucide-react';
import type { FileChange } from '../../shared/types';
import { api } from './api';
import { diffStats } from './diff-model';

export function ChangeSummary({ sessionId, revision, running, onReview, onUndo }: { sessionId: string; revision: number; running: boolean; onReview: (path?: string) => void; onUndo?: () => void }) {
  const [changes, setChanges] = useState<FileChange[]>([]);
  useEffect(() => {
    if (running) return;
    let current = true;
    void api<{ changes: FileChange[] }>(`/sessions/${sessionId}/changes`).then(result => { if (current) setChanges(result.changes.filter(change => change.before !== change.after)); }).catch(() => { if (current) setChanges([]); });
    return () => { current = false; };
  }, [sessionId, revision, running]);
  const files = useMemo(() => changes.map(change => ({ path: change.path, counts: diffStats(change) })), [changes]);
  if (!files.length || running) return null;
  const additions = files.reduce((sum, file) => sum + (file.counts?.additions || 0), 0), deletions = files.reduce((sum, file) => sum + (file.counts?.deletions || 0), 0);
  return <section className="conversation-changes" aria-label="Task file changes"><header><GitCompareArrows size={15} /><span>{files.length} {files.length === 1 ? 'file' : 'files'} changed</span>{additions > 0 && <span className="diff-additions">+{additions}</span>}{deletions > 0 && <span className="diff-deletions">−{deletions}</span>}</header><div>{files.slice(0, 3).map(file => <button key={file.path} title={file.path} onClick={() => onReview(file.path)}><FileCode2 size={13} /><span>{file.path}</span>{Boolean(file.counts?.additions) && <em className="diff-additions">+{file.counts!.additions}</em>}{Boolean(file.counts?.deletions) && <em className="diff-deletions">−{file.counts!.deletions}</em>}</button>)}{files.length > 3 && <span className="conversation-changes-more">{files.length - 3} more {files.length - 3 === 1 ? 'file' : 'files'}</span>}</div><footer><button onClick={() => onReview()}><GitCompareArrows size={13} />Review</button>{onUndo && <button aria-label="Undo last turn" onClick={onUndo}><Undo2 size={13} />Undo</button>}</footer></section>;
}
