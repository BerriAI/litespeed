import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Folder, RefreshCw } from 'lucide-react';
import type { Session } from '../../shared/types';
import type { WorkspaceTrustReview } from '../../shared/workspace-trust';
import { api, errorMessage } from './api';
import './permissions-settings.css';

export function WorkspacePermissions({ workspace, session }: { workspace: string; session?: Session }) {
  const [review, setReview] = useState<WorkspaceTrustReview>();
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [configuration, setConfiguration] = useState(session);
  const alive = useRef(true), operation = useRef(false);
  const current = configuration?.id === session?.id && (configuration?.configRevision ?? -1) > (session?.configRevision ?? -1) ? configuration : session;
  async function reload() {
    const value = await api<WorkspaceTrustReview>(`/workspaces/permissions?${new URLSearchParams({ workspace })}`);
    if (alive.current) setReview(value);
  }
  useEffect(() => {
    alive.current = true;
    void reload().catch(cause => { if (alive.current) setError(errorMessage(cause)); });
    return () => { alive.current = false; };
  }, [workspace]);
  async function act(action: () => Promise<void>, message: string) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); if (alive.current) setNotice(message); }
    catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  function change(path: string, method: 'POST' | 'DELETE', message: string, sourceHash?: string) {
    void act(async () => { await api(path, { method, body: JSON.stringify({ workspace, sourceHash }) }); await reload(); }, message);
  }
  const confined = current?.commandSandbox === 'workspace';
  return <section className="project-permissions" aria-label="Project permissions">
    <div className="permissions-section-heading"><div><h4>Project access</h4><p>Changes here apply immediately.</p></div><button className="icon-button" aria-label="Refresh project access" title="Refresh project access" disabled={busy} onClick={() => void act(reload, 'Project access refreshed.')}><RefreshCw size={15} className={busy ? 'spinning' : ''} /></button></div>
    <details className="permissions-project-path"><summary><Folder size={14} /><span>{workspace.split('/').filter(Boolean).at(-1) || workspace}</span><ChevronRight size={13} /></summary><p>{workspace}</p></details>
    {!review && !error && <p className="field-hint" role="status">Loading project access…</p>}
    {review && <div className="permission-access-list">
      {current && <section className="permission-access-item" data-setting="command-confinement">
        <div className="permission-access-row"><div><strong>Keep commands in this workspace</strong><p>{review.sandboxBackend ? 'In Allow project edits mode, confined commands can run automatically. Broader access still needs approval.' : 'Command confinement is unavailable on this computer.'}</p></div><button role="switch" aria-checked={confined} aria-label="Keep commands in this workspace" className="settings-switch" disabled={busy || current.status === 'running' || current.status === 'waiting' || !review.sandboxBackend} onClick={() => void act(async () => {
          const updated = await api<Session>(`/sessions/${current.id}`, { method: 'PATCH', body: JSON.stringify({ commandSandbox: confined ? 'off' : 'workspace', expectedConfigRevision: current.configRevision ?? 0 }) });
          if (alive.current) setConfiguration(updated);
        }, confined ? 'Command confinement disabled for this task.' : 'Command confinement enabled for this task.')}><span /></button></div>
        <small className="permission-access-scope">This task{review.sandboxBackend ? ` · ${review.sandboxBackend}` : ''}</small>
      </section>}
      <section className="permission-access-item" data-setting="project-allow-rules">
        <div className="permission-access-row"><div><strong>Project allow rules</strong><p>{review.rules.trusted ? 'This reviewed version can allow tools automatically. Deny and ask rules still apply.' : review.rules.source ? 'Deny and ask rules always apply. Review this version before enabling its allow rules.' : 'This project has no custom permission rules.'}</p></div>{(review.rules.source || review.rules.trusted) && <span className={`permission-access-status ${review.rules.trusted ? 'enabled' : ''}`}>{review.rules.trusted ? 'Enabled' : 'Needs review'}</span>}</div>
        {(review.rules.source || review.rules.advisory) && <details className="permission-source-review"><summary>Review project permission rules<ChevronRight size={13} /></summary><pre>{review.rules.source || 'No readable project rules.'}</pre></details>}
        {review.rules.advisory && <p className="error-text" role="alert">{review.rules.advisory}</p>}
        {(review.rules.source || review.rules.trusted) && <button className="text-button" disabled={busy || !review.rules.trusted && Boolean(review.rules.advisory)} onClick={() => change('/workspaces/permission-rules', review.rules.trusted ? 'DELETE' : 'POST', review.rules.trusted ? 'Project allow rules revoked.' : 'This version of the project allow rules is enabled.', review.rules.sourceHash)}>{review.rules.trusted ? 'Revoke project allow rules' : 'Trust reviewed allow rules'}</button>}
      </section>
      <section className="permission-access-item" data-setting="project-hooks">
        <div className="permission-access-row"><div><strong>Project hooks</strong><p>{review.hooks.source || review.hooks.trusted ? 'Hooks run commands with your account’s access. Trust includes future edits to this project’s hooks.' : 'No automatic project commands are configured.'}</p></div>{(review.hooks.source || review.hooks.trusted) && <span className={`permission-access-status ${review.hooks.trusted ? 'enabled' : ''}`}>{review.hooks.trusted ? 'Trusted' : 'Off'}</span>}</div>
        {(review.hooks.source || review.hooks.advisory) && <details className="permission-source-review"><summary>Review project hooks<ChevronRight size={13} /></summary><pre>{review.hooks.source || 'No readable project hooks.'}</pre></details>}
        {review.hooks.advisory && <p className="error-text" role="alert">{review.hooks.advisory}</p>}
        {(review.hooks.source || review.hooks.trusted) && <button className="text-button" disabled={busy || !review.hooks.trusted && Boolean(review.hooks.advisory)} onClick={() => change('/workspaces/trust', review.hooks.trusted ? 'DELETE' : 'POST', review.hooks.trusted ? 'Project hooks disabled.' : 'Project hooks trusted.', review.hooks.sourceHash)}>{review.hooks.trusted ? 'Disable project hooks' : 'Trust project hooks'}</button>}
      </section>
      <section className="permission-access-item" data-setting="project-approvals">
        <div className="permission-access-row"><div><strong>Remembered approvals</strong><p>{review.grants.length ? `${review.grants.length} ${review.grants.length === 1 ? 'approval' : 'approvals'} saved for this project.` : 'Tools ask again unless you have allowed them through a rule or task setting.'}</p></div>{review.grants.length > 0 && <button className="button secondary" disabled={busy} onClick={() => change('/workspaces/tool-grants', 'DELETE', 'Remembered project approvals cleared.')}>Clear project approvals</button>}</div>
        {review.grants.length > 0 && <details className="permission-source-review"><summary>Review remembered approvals<ChevronRight size={13} /></summary><ul>{review.grants.map(grant => <li key={grant.tool + grant.scope}><strong>{grant.tool}</strong><span>{grant.description}</span></li>)}</ul></details>}
      </section>
      {(review.appHooks.length > 0 || review.sidecars.length > 0) && <details className="permission-access-item permission-app-commands" data-setting="app-commands"><summary><span><strong>App commands</strong><small>{review.appHooks.length} hooks · {review.sidecars.length} sidecars</small></span><ChevronRight size={14} /></summary><p>These were installed or configured for the app and run across projects.</p>
        {review.appHooks.map((hook, index) => <div className="permission-app-hook" key={index}><strong>{hook.event}</strong><pre>{hook.command}</pre><button className="text-button" disabled={busy} onClick={() => void act(async () => { await api('/hooks/enabled', { method: 'POST', body: JSON.stringify({ index, enabled: hook.enabled === false, expectedRevision: review.appHooksRevision }) }); await reload(); }, hook.enabled === false ? 'App hook enabled.' : 'App hook disabled.')}>{hook.enabled === false ? 'Enable reviewed app hook' : 'Disable app hook'}</button></div>)}
        {review.sidecars.length > 0 && <details className="permission-source-review"><summary>Review sidecars<ChevronRight size={13} /></summary><pre>{JSON.stringify(review.sidecars, null, 2)}</pre></details>}
      </details>}
    </div>}
    {notice && <p className="permission-access-notice" role="status">{notice}</p>}
    {error && <div className="inline-alert" role="alert">{error}</div>}
  </section>;
}
