import { useEffect, useState } from 'react';
import { Check, GitCommitHorizontal, Minus, Plus, Upload } from 'lucide-react';
import { api, errorMessage } from './api';
import { Modal } from './ui';
import { GitDiscardControls } from './GitDiscardControls';
import type { GitAction, GitActionPlan, GitActionResult, GitReviewScope } from '../../shared/git-review';

export function GitControls({ workspace, scope, paths, activePath, disabled, onRefresh }: {
  workspace: string; scope: GitReviewScope; paths: string[]; activePath: string | null; disabled: boolean; onRefresh: () => void;
}) {
  const [discardBusy, setDiscardBusy] = useState(false);
  const [busy, setBusy] = useState(false), [plan, setPlan] = useState<GitActionPlan | null>(null);
  const [error, setError] = useState(''), [result, setResult] = useState(''), [stale, setStale] = useState(false);
  const messageKey = `litespeed.commit:${workspace}`;
  const [message, setMessage] = useState(() => { try { return localStorage.getItem(messageKey) || ''; } catch { return ''; } });
  useEffect(() => { try { if (message) localStorage.setItem(messageKey, message); else localStorage.removeItem(messageKey); } catch {} }, [message, messageKey]);
  useEffect(() => { setResult(''); setError(''); }, [scope, activePath]);
  async function apply(prepared: GitActionPlan) {
    const completed = await api<GitActionResult>('/git/actions/apply', { method: 'POST', body: JSON.stringify({ workspace, id: prepared.id, ...(prepared.action === 'commit' ? { message } : {}) }) });
    if (prepared.action === 'commit') setMessage('');
    setPlan(null); setResult(completed.message); onRefresh();
  }
  async function prepare(action: GitAction) {
    setBusy(true); setError(''); setResult(''); setStale(false);
    try {
      const prepared = await api<GitActionPlan>('/git/actions/prepare', { method: 'POST', body: JSON.stringify({ workspace, action, ...(['stage', 'unstage'].includes(action) ? { paths: activePath ? [activePath] : paths } : {}) }) });
      if (action === 'commit' || action === 'push') setPlan(prepared); else await apply(prepared);
    } catch (e) { setError(errorMessage(e)); onRefresh(); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!plan || busy) return;
    setBusy(true); setError('');
    try { await apply(plan); }
    catch (e) { setError(errorMessage(e)); setStale(true); onRefresh(); }
    finally { setBusy(false); }
  }
  const blocked = disabled || busy || discardBusy;
  return <>
    <div className="git-controls">
      {!plan && error && <p className="git-action-error" role="alert">{error}</p>}
      {result && <p className="git-action-result" role="status"><Check size={12} />{result}</p>}
      <div className="git-action-buttons">
        {scope === 'unstaged' && <button className="button" disabled={blocked || !paths.length} onClick={() => void prepare('stage')}><Plus size={14} />{activePath ? 'Stage file' : 'Stage all'}</button>}
        {scope === 'staged' && <button className="button" disabled={blocked || !paths.length} onClick={() => void prepare('unstage')}><Minus size={14} />{activePath ? 'Unstage file' : 'Unstage all'}</button>}
        <GitDiscardControls workspace={workspace} paths={paths} activePath={activePath} canDiscard={scope === 'unstaged'} disabled={disabled || busy} onBusyChange={setDiscardBusy} onRefresh={onRefresh} onResult={setResult} onError={setError} />
        {scope !== 'branch' && <button className="button primary" disabled={blocked} onClick={() => void prepare('commit')}><GitCommitHorizontal size={14} />Commit…</button>}
        {scope === 'branch' && <button className="button" disabled={blocked} onClick={() => void prepare('push')}><Upload size={14} />Push…</button>}
        {busy && !plan && <span className="git-action-pending" role="status">Working…</span>}
      </div>
    </div>
    {plan && <Modal title={plan.action === 'commit' ? 'Commit changes' : 'Push branch'} onClose={() => { if (!busy) { setPlan(null); setError(''); } }}>
      <form className="git-action-dialog" onSubmit={e => { e.preventDefault(); void confirm(); }}>
        {plan.action === 'commit' ? <>
          <div className="git-plan-heading"><strong>{plan.files.length} {plan.files.length === 1 ? 'staged file' : 'staged files'}</strong><span title={plan.branch}>{plan.branch}</span></div>
          <ul className="git-plan-files" aria-label="Files to commit">{plan.files.map(path => <li key={path} title={path}>{path}</li>)}</ul>
          <label className="git-message-label">Commit message<textarea autoFocus required aria-label="Commit message" rows={4} maxLength={10_000} value={message} onChange={e => setMessage(e.target.value)} placeholder="Describe what changed" disabled={busy} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); if (!stale) e.currentTarget.form?.requestSubmit(); } }} /></label>
          <p className="git-plan-note">Uses your Git hooks and signing settings.</p>
        </> : <>
          <p className="git-push-copy">Push committed changes from <strong>{plan.branch}</strong> to <strong>{plan.destination?.remote}/{plan.destination?.branch}</strong>.</p>
          <code className="git-destination">{plan.destination?.url}</code>
        </>}
        {error && <p className="git-action-error" role="alert">{error}</p>}
        <footer><button type="button" className="button" disabled={busy} onClick={() => { setPlan(null); setError(''); }}>Cancel</button>{stale ? <button type="button" className="button primary" disabled={blocked} onClick={() => void prepare(plan.action)}>Refresh review</button> : <button className="button primary" disabled={blocked || (plan.action === 'commit' && !message.trim())}>{busy ? plan.action === 'commit' ? 'Committing…' : 'Pushing…' : plan.action === 'commit' ? 'Commit' : 'Push branch'}</button>}</footer>
      </form>
    </Modal>}
  </>;
}
