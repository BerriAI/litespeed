import { useEffect, useState } from 'react';
import type { WorkspaceTrustReview } from '../../shared/workspace-trust';
import { api, errorMessage } from './api';

export function WorkspacePermissions({workspace,session}:{workspace:string;session?:import('../../shared/types').Session}) {
  const [review,setReview]=useState<WorkspaceTrustReview>(), [error,setError]=useState(''), [busy,setBusy]=useState(false);
  const reload=async()=>setReview(await api<WorkspaceTrustReview>(`/workspaces/permissions?${new URLSearchParams({workspace})}`));
  useEffect(()=>{let live=true;void api<WorkspaceTrustReview>(`/workspaces/permissions?${new URLSearchParams({workspace})}`).then(value=>{if(live&&value?.rules&&value?.hooks)setReview(value);}).catch(cause=>{if(live)setError(errorMessage(cause));});return()=>{live=false;};},[workspace]);
  async function change(path:string,method:'POST'|'DELETE',sourceHash?:string) {
    setBusy(true);setError('');
    try {await api(path,{method,body:JSON.stringify({workspace,sourceHash})});await reload();}
    catch(cause){setError(errorMessage(cause));}
    finally{setBusy(false);}
  }
  return <section className="form-stack" aria-label="Project permissions">
    <h3>Project access</h3><p>{workspace}</p>{error&&<p role="alert">{error}</p>}
    {review&&<>
      {session&&<><p>Command confinement: {review.sandboxBackend || 'unavailable'}. In Allow project edits mode, confined commands run automatically. Broader access still follows approvals.</p><button className="button secondary" disabled={busy||session.status==='running'||session.status==='waiting'||!review.sandboxBackend} onClick={()=>{setBusy(true);void api(`/sessions/${session.id}`,{method:'PATCH',body:JSON.stringify({commandSandbox:session.commandSandbox==='workspace'?'off':'workspace',expectedConfigRevision:session.configRevision??0})}).catch(cause=>setError(errorMessage(cause))).finally(()=>setBusy(false));}}>{session.commandSandbox==='workspace'?'Disable command confinement':'Enable workspace command confinement'}</button></>}

      <details><summary>Review project permission rules</summary><pre>{review.rules.source||'No project rules.'}</pre></details>
      {review.rules.advisory&&<p role="alert">{review.rules.advisory}</p>}
      <p>Deny and ask rules always apply. Allow rules activate only after you review this version.</p>
      <button className="button secondary" disabled={busy||Boolean(review.rules.advisory)||!review.rules.source} onClick={()=>void change('/workspaces/permission-rules',review.rules.trusted?'DELETE':'POST',review.rules.sourceHash)}>{review.rules.trusted?'Revoke project allow rules':'Trust reviewed allow rules'}</button>
      <details><summary>Review project hooks</summary><pre>{review.hooks.source||'No project hooks.'}</pre></details>
      <p>Project hooks execute commands with your account’s access. Trust enables hooks from this project, including future edits.</p>
      <button className="button secondary" disabled={busy||Boolean(review.hooks.advisory)||(!review.hooks.source&&!review.hooks.trusted)} onClick={()=>void change('/workspaces/trust',review.hooks.trusted?'DELETE':'POST',review.hooks.sourceHash)}>{review.hooks.trusted?'Disable project hooks':'Trust project hooks'}</button>
      <details><summary>App executables: {review.appHooks.length} hooks, {review.sidecars.length} sidecars</summary><p>These were explicitly installed or configured for the app and run across workspaces.</p><pre>{JSON.stringify({hooks:review.appHooks,sidecars:review.sidecars},null,2)}</pre></details>
      {review.appHooks.map((hook,index)=><div key={index}><pre>{hook.event}: {hook.command}</pre><button className="button secondary" disabled={busy} onClick={()=>{setBusy(true);void api('/hooks/enabled',{method:'POST',body:JSON.stringify({index,enabled:hook.enabled===false,expectedRevision:review.appHooksRevision})}).then(reload).catch(cause=>setError(errorMessage(cause))).finally(()=>setBusy(false));}}>{hook.enabled===false?'Enable reviewed app hook':'Disable app hook'}</button></div>)}
      <p>{review.grants.length} remembered project approvals</p>
      <ul>{review.grants.map(grant=><li key={grant.tool+grant.scope}>{grant.tool}: {grant.description}</li>)}</ul>
      <button className="button secondary" disabled={busy||!review.grants.length} onClick={()=>void change('/workspaces/tool-grants','DELETE')}>Clear project approvals</button>
    </>}
  </section>;
}
