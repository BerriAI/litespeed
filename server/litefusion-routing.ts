import { createHash } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { z } from 'zod';
import { REASONING_EFFORTS, type Provider, type ReasoningEffort } from '../shared/types.js';
import { bindExactModels, LITEFUSION_CAPABILITIES, LITEFUSION_MODELS, LITEFUSION_ROLES, LITEFUSION_VERSION, effectiveSpecialist, configuredRole, liteFusionRole, specialistRoute, validateLiteFusion, type LiteFusionSelection, type LiteFusionRouteStatus, type LiteFusionTier } from '../shared/litefusion.js';
import { modelCatalog, type ModelCatalogCache } from './budget.js';

const modelKey=z.string().refine(key=>Object.hasOwn(LITEFUSION_MODELS,key),'Unknown specialist model.');
const roleId=z.string().refine(id=>LITEFUSION_ROLES.some(role=>role.id===id),'Unknown LiteFusion task.');
const routeSchema=z.object({modelKey,effort:z.string().min(1).max(30)}).strict();
const bindingSchema=z.object({providerId:z.string().min(1).max(64),model:z.string().min(1).max(250)}).strict();
export const liteFusionCapacity=(selection:LiteFusionSelection)=>({slots:selection.concurrency??Math.max(1,availableParallelism()),source:selection.concurrency?'explicit override':'host available parallelism'});
export const liteFusionSchema=z.object({
  kind:z.literal('litefusion'),gatewayProviderId:z.string().min(1).max(64),
  presetVersion:z.string().min(1).max(100).optional(),
  lead:bindingSchema.extend({effort:z.enum(REASONING_EFFORTS).optional()}).strict().optional(),
  bindings:z.record(modelKey,bindingSchema).optional(),
  routes:z.record(roleId,z.object({default:routeSchema.optional(),escalation:routeSchema.optional()}).strict()).optional(),
  spend:z.object({limitUsd:z.number().positive().finite(),rescueReserveUsd:z.number().nonnegative().finite(),requestCeilings:z.array(bindingSchema.extend({usd:z.number().positive().finite()})).min(1).max(100)}).strict().refine(value=>value.rescueReserveUsd<value.limitUsd,'Rescue reserve must be below the total budget.').refine(value=>new Set(value.requestCeilings.map(route=>JSON.stringify([route.providerId,route.model]))).size===value.requestCeilings.length,'Duplicate request reservation route.').optional(),
  handoffs:z.record(roleId,z.object({instructions:z.string().min(1).max(8000),acceptance:z.string().min(1).max(4000)}).strict()).optional(),
  concurrency:z.number().int().min(1).max(256).optional(),
  maxAssignments:z.number().int().min(1).max(10000).optional(),
  capabilities:z.array(z.enum(LITEFUSION_CAPABILITIES)).max(5).optional(),
}).strict();

export interface LiteFusionSnapshot {
  selection: LiteFusionSelection;
  version: string;
  hash: string;
  providers: Provider[];
  routes: Record<string, Record<LiteFusionTier, LiteFusionRouteStatus>>;
}
export function captureLiteFusion(selection: LiteFusionSelection, providers: readonly Provider[], cache: ModelCatalogCache = modelCatalog): LiteFusionSnapshot {
  validateLiteFusion(selection);
  // Saved preferences are not the executable roster. Fill missing connections
  // from observed identities at every capture, including legacy sessions and
  // queued/goal turns. Explicit bindings and task/lead choices win unchanged.
  const gateway=providers.find(provider=>provider.id===selection.gatewayProviderId);
  if(gateway)selection=bindExactModels(selection,[...cache.snapshot(gateway),...(gateway.models??[]).map(id=>({id}))]);
  const routes: LiteFusionSnapshot['routes']={};
  for(const role of LITEFUSION_ROLES) {
    const resolve=(tier:LiteFusionTier):LiteFusionRouteStatus=>{
      const requested=specialistRoute(selection,role,tier);
      const base={roleId:role.id,tier,requested};
      if(role.execution==='lead')return {...base,status:'lead'};
      const effective=effectiveSpecialist(role,tier,requested,specialistRoute(selection,role,'escalation'));
      const card=LITEFUSION_MODELS[effective.route.modelKey];
      const binding=selection.bindings?.[effective.route.modelKey];
      const provider=providers.find(p=>p.id===(binding?.providerId??selection.gatewayProviderId));
      const unavailable=(reason:string):LiteFusionRouteStatus=>({...base,status:'unavailable',reason,adapter:effective.adapter});
      if(!provider?.baseUrl)return unavailable('The gateway provider is not configured.');
      if(provider.kind==='codex')return unavailable('LiteFusion specialists require API gateway bindings, not subscription routes.');
      if(!card||['mercury_edit','voyage_code'].includes(effective.route.modelKey))return unavailable('The native edit/embedding service is unavailable; configure a chat-model fallback.');
      const model=binding?.model??card.apiId;
      const observed=cache.snapshot(provider).find(item=>item.id===model);
      const listed=Boolean(observed||provider.models?.includes(model));
      if(!binding&&!listed)return unavailable(`No exact gateway binding for ${card.name}. Refresh models or bind its deployment explicitly.`);
      if(!REASONING_EFFORTS.includes(effective.route.effort as ReasoningEffort))return unavailable(`Native reasoning setting ${effective.route.effort} needs a supported adapter; it will not be silently omitted.`);
      const effort=effective.route.effort as ReasoningEffort;
      if(observed?.reasoningEfforts&&!observed.reasoningEfforts.includes(effort))return unavailable(`${model} does not advertise ${effort} reasoning.`);
      return {...base,route:{providerId:provider.id,model},effort,adapter:effective.adapter,status:observed?.reasoningEfforts?'metadata-compatible':listed?'listed':'configured',...(effective.limitation?{reason:effective.limitation}:{})};
    };
    routes[role.id]={default:resolve('default'),escalation:resolve('escalation')};
  }
  // Availability is a turn observation, not policy identity. A cache expiry
  // must not invalidate an explicitly bound compatible worker context.
  const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
  const hash=createHash('sha256').update(JSON.stringify(canonical({version:LITEFUSION_VERSION,selection,roles:LITEFUSION_ROLES,models:LITEFUSION_MODELS}))).digest('hex');
  return {selection:structuredClone(selection),version:LITEFUSION_VERSION,hash,providers:structuredClone([...providers]),routes};
}
export function resolveLiteFusion(snapshot:LiteFusionSnapshot,id:string,hard:boolean,repair:boolean) {
  const role=configuredRole(snapshot.selection,id);
  if(role.execution==='lead')throw new Error(`${id} is owned by the lead. Delegate a scoped specialist task instead.`);
  let tier:LiteFusionTier=hard||repair?'escalation':'default';
  let route=snapshot.routes[id][tier];
  let reason:'default'|'hard'|'escalation'|'availability_fallback'=repair?'escalation':hard?'hard':'default';
  if(tier==='default'&&(route.status==='unavailable'||['mercury_edit','voyage_code'].includes(route.requested.modelKey))) {
    // Exactly one shared escalation destination; no speculative third model.
    tier='escalation';route=snapshot.routes[id].escalation;reason='availability_fallback';
  }
  if(!route.route||!route.effort||route.status==='unavailable')throw new Error(`LiteFusion ${id}: ${route.reason??'no eligible route'}`);
  const provider=snapshot.providers.find(p=>p.id===route.route!.providerId)!;
  return {role,route,provider,tier,reason};
}
