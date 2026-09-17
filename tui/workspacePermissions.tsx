/** @jsxImportSource @opentui/react */
import { useEffect, useState } from 'react';
import type { WorkspaceTrustReview } from '../shared/workspace-trust.js';
import type { TerminalController } from './controller.js';
import { Menu, TextViewer } from './ui.js';

export function WorkspacePermissions({controller,workspace,onClose}:{controller:TerminalController;workspace:string;onClose:()=>void}) {
  const [review,setReview]=useState<WorkspaceTrustReview>(),[text,setText]=useState<string>(),[feedback,setFeedback]=useState(''),[busy,setBusy]=useState(false);
  const reload=async()=>setReview(await controller.client.api<WorkspaceTrustReview>(`/workspaces/permissions?${new URLSearchParams({workspace})}`));
  useEffect(()=>{void reload().catch(cause=>setFeedback(String(cause)));},[workspace]);
  async function change(path:string,method:'POST'|'DELETE',sourceHash?:string) {
    setBusy(true);try{await controller.client.api(path,{workspace,sourceHash},method);await reload();}catch(cause){setFeedback(String(cause));}finally{setBusy(false);}
  }
  if(text!==undefined)return <TextViewer title="Review project access" text={text} onClose={()=>setText(undefined)}/>;
  return <Menu title="Project access" onClose={onClose} search={false} footer={feedback||workspace} items={review?[
    {id:'sandbox',label:controller.detail?.session.commandSandbox==='workspace'?'Disable command confinement':'Enable workspace command confinement',description:review.sandboxBackend?`${review.sandboxBackend}: workspace writes and no network. Automatic in Allow project edits mode.`:'Unavailable; commands will not silently run unrestricted.',disabled:busy||!review.sandboxBackend||['running','waiting'].includes(controller.detail?.session.status??''),action:()=>{void controller.configure({commandSandbox:controller.detail?.session.commandSandbox==='workspace'?'off':'workspace'}).then(()=>reload());}},
    {id:'rules',label:'Review project permission rules',description:review.rules.advisory,action:()=>setText(review.rules.source||'No project rules.')},
    {id:'trust-rules',label:review.rules.trusted?'Revoke project allow rules':'Trust reviewed allow rules',description:'Applies to this exact version. Deny and ask rules always apply.',disabled:busy||!!review.rules.advisory||!review.rules.source,action:()=>{void change('/workspaces/permission-rules',review.rules.trusted?'DELETE':'POST',review.rules.sourceHash);}},
    {id:'hooks',label:'Review project hooks',action:()=>setText(review.hooks.source||'No project hooks.')},
    {id:'trust-hooks',label:review.hooks.trusted?'Disable project hooks':'Trust project hooks',description:'Enables executable hooks, including future changes, with your account’s access.',disabled:busy||!!review.hooks.advisory||(!review.hooks.source&&!review.hooks.trusted),action:()=>{void change('/workspaces/trust',review.hooks.trusted?'DELETE':'POST',review.hooks.sourceHash);}},
    {id:'app',label:`App executables: ${review.appHooks.length} hooks, ${review.sidecars.length} sidecars`,description:'Installed app executables run across workspaces.',action:()=>setText(JSON.stringify({hooks:review.appHooks,sidecars:review.sidecars},null,2))},
    ...review.appHooks.map((hook,index)=>({id:`hook-${index}`,label:hook.enabled===false?'Enable reviewed app hook':'Disable app hook',description:`${hook.event}: ${hook.command}`,disabled:busy,action:()=>{setBusy(true);void controller.client.api('/hooks/enabled',{index,enabled:hook.enabled===false,expectedRevision:review.appHooksRevision}).then(reload).catch(cause=>setFeedback(String(cause))).finally(()=>setBusy(false));}})),
    {id:'grants',label:`Review ${review.grants.length} project approvals`,action:()=>setText(review.grants.map(grant=>`${grant.tool}: ${grant.description}`).join('\n')||'No remembered project approvals.')},
    {id:'clear',label:'Clear project approvals',disabled:busy||!review.grants.length,action:()=>{void change('/workspaces/tool-grants','DELETE');}},
  ]:[]}/>;
}
