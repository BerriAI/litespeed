import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Folder, RefreshCw } from 'lucide-react';
import type { Session } from '../../shared/types';
import type { TaskLocalPlan } from '../../shared/worktrees';
import { errorMessage, post } from './api';
import { Modal } from './ui';
import { WorktreeLocation } from './Worktrees';
import './worktrees.css';

export function TaskLocal({ session, onClose, onMoved }: { session: Session; onClose: () => void; onMoved: (session: Session) => void }) {
  const [plan, setPlan] = useState<TaskLocalPlan | null>(null), [busy, setBusy] = useState<'review' | 'move' | ''>('review'), [error, setError] = useState('');
  const alive = useRef(true), operation = useRef(false), body = useRef<HTMLDivElement>(null), proceed = useRef<HTMLButtonElement>(null);
  useEffect(() => { alive.current = true; void prepare(); return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (busy) return;
    if (plan && !error && body.current) body.current.scrollTop = 0;
    (error || !plan ? body.current?.querySelector<HTMLElement>('[data-refresh-local]') : proceed.current)?.focus();
  }, [plan?.id, busy, error]);
  async function prepare() {
    if (operation.current) return; operation.current = true; setBusy('review'); setError('');
    try { const next = await post<TaskLocalPlan>(`/sessions/${session.id}/local/prepare`, { expectedConfigRevision: session.configRevision ?? 0 }); if (alive.current) setPlan(next); }
    catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { operation.current = false; if (alive.current) setBusy(''); }
  }
  async function move() {
    if (!plan || operation.current) return; operation.current = true; setBusy('move'); setError('');
    try {
      const result = await post<{ session: Session }>(`/sessions/${session.id}/local`, { planId: plan.id });
      window.dispatchEvent(new CustomEvent('litespeed:git-changed', { detail: { workspace: plan.project } }));
      window.dispatchEvent(new CustomEvent('litespeed:worktrees-changed'));
      if (alive.current) onMoved(result.session);
    } catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { operation.current = false; if (alive.current) setBusy(''); }
  }
  return <Modal title="Continue in the local project?" onClose={() => { if (busy !== 'move') onClose(); }}><div className="worktrees-dialog" ref={body}>
    {!plan && busy === 'review' ? <p className="worktrees-intro" role="status">Checking the local project and your working copy…</p> : plan ? <>
      <p className="worktrees-intro">Bring this conversation and its current files into your local project on a new branch.</p>
      <dl className="worktree-plan"><div><dt>From</dt><dd><WorktreeLocation path={plan.from} /></dd></div><div><dt>Local project</dt><dd><WorktreeLocation path={plan.project} /></dd></div><div><dt>On branch</dt><dd>{plan.previousBranch || `Detached at ${plan.previousHead.slice(0, 7)}`}</dd></div><div><dt>New branch</dt><dd>{plan.branch}</dd></div></dl>
      <p className="worktrees-note">{plan.changedFiles ? `${plan.changedFiles} committed ${plan.changedFiles === 1 ? 'file changes' : 'files change'} in the local project.` : 'Both folders have the same committed files.'} Your previous branch stays available.</p>
      {plan.localEdits.files.length > 0 && <details className="worktree-copy-files"><summary>{plan.localEdits.files.length} {plan.localEdits.files.length === 1 ? 'file' : 'files'} with local edits<ChevronDown size={13} /></summary><ul>{plan.localEdits.files.map(file => <li key={file.path}><span>{file.path}</span><small>{file.status.includes('?') ? 'New' : file.status.includes('D') ? 'Deleted' : file.status.includes('A') ? 'Added' : 'Modified'}</small></li>)}</ul></details>}
      <p className="worktrees-note">Your worktree and ignored setup stay in place. Queued messages pause; Undo starts with new turns here.</p>
    </> : <p className="worktrees-intro">Your task stays in its working copy while the local project is checked.</p>}
    {error && <><div className="inline-alert" role="alert">{error}</div><button data-refresh-local className="text-button worktree-refresh-review" disabled={Boolean(busy)} onClick={() => void prepare()}><RefreshCw size={14} className={busy === 'review' ? 'spinning' : ''} />{busy === 'review' ? 'Reviewing…' : 'Refresh review'}</button></>}
  </div>{plan && <div className="modal-footer task-local-footer"><button className="text-button" disabled={busy === 'move'} onClick={onClose}>Cancel</button><button ref={proceed} className="button primary" disabled={Boolean(busy) || Boolean(error)} onClick={() => void move()}><Folder size={14} />{busy === 'move' ? 'Moving task…' : busy === 'review' ? 'Reviewing…' : 'Continue locally'}</button></div>}</Modal>;
}
