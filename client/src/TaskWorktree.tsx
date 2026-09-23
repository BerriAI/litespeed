import { useEffect, useRef, useState } from 'react';
import { ChevronDown, GitFork } from 'lucide-react';
import type { Session } from '../../shared/types';
import type { TaskWorktreePlan } from '../../shared/worktrees';
import { errorMessage, post } from './api';
import { Modal } from './ui';
import { SetupFileReview, WorktreeLocation } from './Worktrees';
import './worktrees.css';

export function TaskWorktree({ session, onClose, onMoved }: { session: Session; onClose: () => void; onMoved: (session: Session) => void }) {
  const [name, setName] = useState(() => session.title.replace(/[^a-zA-Z0-9 ._-]/g, ' ').replace(/^[^a-zA-Z0-9]+/, '').trim().slice(0, 64) || 'Continue task');
  const [setup, setSetup] = useState(false), [plan, setPlan] = useState<TaskWorktreePlan | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const alive = useRef(true), operation = useRef(false), body = useRef<HTMLDivElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (!busy) body.current?.querySelector<HTMLElement>(plan ? '[data-move-task]' : 'input')?.focus(); }, [plan?.id, busy]);
  async function act(action: () => Promise<void>) {
    if (operation.current) return; operation.current = true; setBusy(true); setError('');
    try { await action(); } catch (error) { if (alive.current) setError(errorMessage(error)); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  async function prepare() { await act(async () => { const result = await post<TaskWorktreePlan>(`/sessions/${session.id}/worktree/prepare`, { name, includeLocalSetup: setup, expectedConfigRevision: session.configRevision ?? 0 }); if (alive.current) setPlan(result); }); }
  async function move() { if (!plan) return; await act(async () => { const result = await post<{ session: Session }>(`/sessions/${session.id}/worktree`, { planId: plan.id }); window.dispatchEvent(new CustomEvent('litespeed:worktrees-changed')); if (alive.current) onMoved(result.session); }); }
  return <Modal title={plan ? 'Move task to worktree?' : 'Continue in a worktree'} onClose={() => { if (!busy) onClose(); }}><div className="worktrees-dialog" ref={body}>
    {!plan ? <form onSubmit={event => { event.preventDefault(); void prepare(); }}>
      <p className="worktrees-intro">Give this conversation its own working copy. Current files and local edits are copied over so you can pick up where you left off.</p>
      <label className="worktrees-name">Working copy name<input autoFocus aria-label="Working copy name" maxLength={64} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <label className="worktree-copy-choice"><input type="checkbox" checked={setup} disabled={busy} onChange={event => setSetup(event.target.checked)} /><span><strong>Include local setup</strong><small>Copy ignored files selected by this project’s .worktreeinclude.</small></span></label>
      <div className="worktrees-actions"><button type="button" className="text-button" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy || !name.trim()}>{busy ? 'Reviewing…' : 'Continue'}</button></div>
    </form> : <>
      <p className="worktrees-intro">Keep this conversation and continue in a separate folder. Your model choices and pinned instructions stay with the task.</p>
      <dl className="worktree-plan"><div><dt>From</dt><dd><WorktreeLocation path={plan.project} /></dd></div><div><dt>New branch</dt><dd>{plan.branch}</dd></div><div><dt>Working copy</dt><dd><WorktreeLocation path={plan.path} /></dd></div></dl>
      {Boolean(plan.localEdits?.files.length) && <details className="worktree-copy-files"><summary>{plan.localEdits!.files.length} {plan.localEdits!.files.length === 1 ? 'file' : 'files'} with local edits<ChevronDown size={13} /></summary><ul>{plan.localEdits!.files.map(file => <li key={file.path}><span>{file.path}</span><small>{file.status.includes('?') ? 'New' : file.status.includes('D') ? 'Deleted' : file.status.includes('A') ? 'Added' : 'Modified'}</small></li>)}</ul></details>}
      {plan.localSetup && <SetupFileReview setup={plan.localSetup} />}
      <p className="worktrees-note">The original project stays as it is. Queued messages pause, and Undo begins with new turns in this working copy.</p>
      <div className="worktrees-actions"><button className="text-button" disabled={busy} onClick={() => { setPlan(null); setError(''); }}>Back</button><button data-move-task className="button primary" disabled={busy} onClick={() => void move()}><GitFork size={14} />{busy ? 'Moving task…' : 'Move task'}</button></div>
      {error && <button className="text-button worktree-refresh-review" disabled={busy} onClick={() => void prepare()}>Refresh review</button>}
    </>}
    {error && <div className="inline-alert" role="alert">{error}</div>}
  </div></Modal>;
}
