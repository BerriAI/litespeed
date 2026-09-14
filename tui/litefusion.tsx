/** @jsxImportSource @opentui/react */
import { useEffect, useState } from 'react';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Model, Settings } from '../shared/types.js';
import { LITEFUSION_CAPABILITIES, LITEFUSION_MODELS, LITEFUSION_ROLES, bindExactModels, configuredRole, liteFusionPolicy, parseLiteFusionPolicy, specialistRoute, specialistLabel, type LiteFusionSelection, type LiteFusionTier, type LiteFusionRouteStatus } from '../shared/litefusion.js';
import type { TerminalController } from './controller.js';
import { Menu, TextPrompt, TextViewer } from './ui.js';
import { ModelChooser } from './models.js';

export function LiteFusionSettings({controller,settings,value,onChange,onClose}:{controller:TerminalController;settings:Settings;value:LiteFusionSelection;onChange:(value:LiteFusionSelection)=>void;onClose:()=>void}) {
  const [view,setView]=useState('main'),[roleId,setRoleId]=useState(LITEFUSION_ROLES[0].id),[tier,setTier]=useState<LiteFusionTier>('default'),[modelKey,setModelKey]=useState('');
  const [notice,setNotice]=useState(''),[preview,setPreview]=useState<Record<string,Record<LiteFusionTier,LiteFusionRouteStatus>>>({});
  useEffect(()=>{let live=true;controller.client.api<{routes:typeof preview}>('/litefusion/routes',value).then(result=>{if(live){setPreview(result.routes);setNotice('');}}).catch(error=>{if(live)setNotice(error.message);});return()=>{live=false;};},[value]);
  const back=()=>setView('main'),role=configuredRole(value,roleId),route=specialistRoute(value,role,tier);
  const changeRoute=(next:typeof route)=>onChange({...value,routes:{...value.routes,[roleId]:{...value.routes?.[roleId],[tier]:next}}});
  if(view==='tasks')return <Menu title="LiteFusion · all 63 tasks" onClose={back} footer="Type to search · Enter inspect routes and handoff · Esc back" items={LITEFUSION_ROLES.map(role=>({id:role.id,label:role.task,description:role.execution==='lead'?'Your selected lead':`${specialistLabel(specialistRoute(value,role,'default'))} → ${specialistLabel(specialistRoute(value,role,'escalation'))}`,action:()=>{setRoleId(role.id);setView('task');}}))}/>;
  if(view==='task')return <Menu title={role.task} onClose={()=>setView('tasks')} footer={notice||`${role.execution} · Stakes: ${role.stakes}`} items={[
    ...(['default','escalation'] as const).map(tier=>({id:tier,label:`${tier==='default'?'Default':'Hard / escalation'}: ${specialistLabel(specialistRoute(value,role,tier))}`,description:[preview[roleId]?.[tier]?.status,preview[roleId]?.[tier]?.reason].filter(Boolean).join(' · '),disabled:role.execution==='lead',action:()=>{setTier(tier);setView('route');}})),
    {id:'instructions',label:'Edit task handoff',description:role.handoff,action:()=>setView('instructions')},
    {id:'acceptance',label:'Edit required evidence',description:role.acceptance,action:()=>setView('acceptance')},
    {id:'evidence',label:'Research provenance',action:()=>setView('evidence')},
  ]}/>;
  if(view==='evidence')return <TextViewer title="Task provenance" text={[role.confidence,role.evidence,...role.sources].join('\n\n')} onClose={()=>setView('task')}/>;
  if(view==='instructions'||view==='acceptance')return <TextPrompt title={view==='instructions'?'Task handoff':'Required evidence'} value={view==='instructions'?role.handoff:role.acceptance} multiline onClose={()=>setView('task')} onSave={text=>{if(!text.trim())return;onChange({...value,handoffs:{...value.handoffs,[roleId]:{instructions:view==='instructions'?text:role.handoff,acceptance:view==='acceptance'?text:role.acceptance}}});setView('task');}}/>;
  if(view==='route')return <Menu title={`${tier} model`} onClose={()=>setView('task')} items={Object.entries(LITEFUSION_MODELS).map(([key,model])=>({id:key,label:model.name,action:()=>{setModelKey(key);setView('effort');}}))}/>;
  if(view==='effort')return <Menu title={`${LITEFUSION_MODELS[modelKey].name} reasoning`} onClose={()=>setView('route')} items={LITEFUSION_MODELS[modelKey].efforts.map(effort=>({id:effort,label:effort,action:()=>{changeRoute({modelKey,effort});setView('task');}}))}/>;
  if(view==='gateway')return <Menu title="Specialist gateway" onClose={back} items={settings.providers.filter(p=>p.kind!=='codex').map(p=>({id:p.id,label:p.name,action:()=>{onChange({...value,gatewayProviderId:p.id});back();}}))}/>;
  if(view==='bindings')return <Menu title="Exact deployment bindings" onClose={back} footer="Bind aliases only when they deploy the named model. No execution validation has run." items={Object.entries(LITEFUSION_MODELS).filter(([key])=>!['mercury_edit','voyage_code'].includes(key)).map(([key,model])=>({id:key,label:model.name,description:value.bindings?.[key]?.model||`Unbound · expected ${model.apiId}`,action:()=>{setModelKey(key);setView('binding');}}))}/>;
  if(view==='binding')return <ModelChooser controller={controller} settings={{...settings,providers:settings.providers.filter(p=>p.kind!=='codex')}} value={value.bindings?.[modelKey]??{providerId:value.gatewayProviderId,model:LITEFUSION_MODELS[modelKey].apiId}} title={`Bind ${LITEFUSION_MODELS[modelKey].name}`} guidance="Select only a deployment of this exact identity." onClose={()=>setView('bindings')} onChange={binding=>{onChange({...value,bindings:{...value.bindings,[modelKey]:binding}});setView('bindings');}}/>;
  if(view==='capabilities')return <Menu title="Available environment capabilities" onClose={back} footer="Declaring a capability does not connect tools or install hardware." items={LITEFUSION_CAPABILITIES.map(cap=>({id:cap,label:`${value.capabilities?.includes(cap)?'✓':'○'} ${cap}`,action:()=>onChange({...value,capabilities:value.capabilities?.includes(cap)?value.capabilities.filter(c=>c!==cap):[...value.capabilities??[],cap]})}))}/>;
  if(view==='concurrency')return <Menu title="Workers at once" onClose={back} items={([1,2,3,4] as const).map(count=>({id:String(count),label:String(count),action:()=>{onChange({...value,concurrency:count});back();}}))}/>;
  if(view==='limit')return <TextPrompt title="Assignments per turn (1–32)" value={String(value.maxAssignments??8)} onClose={back} onSave={text=>{const n=Number(text);if(Number.isInteger(n)&&n>=1&&n<=32){onChange({...value,maxAssignments:n});back();}}}/>;
  if(view==='import'||view==='export')return <TextPrompt title={view==='import'?'Import policy path':'Export new policy path'} placeholder="litefusion-policy.json" onClose={back} onSave={async filename=>{
    try {const path=resolve(controller.detail!.session.workspace,filename);if(view==='export'){await writeFile(path,JSON.stringify(liteFusionPolicy(value),null,2),{flag:'wx'});setNotice(`Exported ${path}`);}else{const bytes=await readFile(path);if(bytes.length>1024*1024)throw new Error('Policy exceeds 1 MiB.');const next=parseLiteFusionPolicy(bytes.toString());await controller.client.api('/litefusion/routes',next);onChange(next);setNotice('Imported into this draft. Save Models to apply.');}back();}catch(error){setNotice((error as Error).message);back();}
  }}/>;
  return <Menu title="LiteFusion routing" onClose={onClose} footer={notice||'Research policy, not measured ROI. Mercury Edit 2 / Voyage Code 4 use explicit chat fallbacks.'} items={[
    {id:'tasks',label:'All 63 task routes and handoffs',action:()=>setView('tasks')},
    {id:'gateway',label:`Gateway: ${value.gatewayProviderId}`,action:()=>setView('gateway')},
    {id:'refresh',label:'Refresh and pin exact models',action:()=>{void controller.client.api<{models:Model[];error?:string}>(`/models?providerId=${encodeURIComponent(value.gatewayProviderId)}`).then(result=>{onChange(bindExactModels(value,result.models));setNotice(result.error||'Exact identities pinned. Review alias bindings separately.');}).catch(error=>setNotice(error.message));}},
    {id:'bindings',label:'Review deployment identities',action:()=>setView('bindings')},
    {id:'concurrency',label:`Workers at once: ${value.concurrency??2}`,action:()=>setView('concurrency')},
    {id:'limit',label:`Assignments per turn: ${value.maxAssignments??8}`,action:()=>setView('limit')},
    {id:'capabilities',label:'Environment capabilities',action:()=>setView('capabilities')},
    {id:'import',label:'Import reviewed policy',action:()=>setView('import')},
    {id:'export',label:'Export policy',action:()=>setView('export')},
  ]}/>;
}
