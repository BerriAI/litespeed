import type { ModelRoute } from './architectures.js';
import { LITEFUSION_ROLES, type LiteFusionRouteStatus, type LiteFusionTier } from './litefusion.js';

export interface LiteFusionReadiness {
  otherModels?: number;
  primary: number;
  backup: number;
  leadOnly: number;
  total: number;
  leadOnlyTasks: string[];
  discoveryError?: string;
  activeTurn?: boolean;
  delegationDisabled?: boolean;
}
export function liteFusionReadiness(routes: Record<string, Record<LiteFusionTier, LiteFusionRouteStatus>>,lead?:ModelRoute): LiteFusionReadiness {
  let primary=0,backup=0;
  const leadOnlyTasks:string[]=[];
  for(const role of LITEFUSION_ROLES) {
    if(role.execution==='lead')continue;
    const route=routes[role.id];
    if(route?.default.route && route.default.status!=='unavailable')primary++;
    else if(route?.escalation.route && route.escalation.status!=='unavailable')backup++;
    else leadOnlyTasks.push(role.id);
  }
  const models=new Set(Object.values(routes).flatMap(pair=>Object.values(pair)).filter(route=>route.route&&route.status!=='unavailable').map(route=>JSON.stringify(route.route)));
  if(lead)models.delete(JSON.stringify({providerId:lead.providerId,model:lead.model}));
  return {...(lead?{otherModels:models.size}:{}),primary,backup,leadOnly:leadOnlyTasks.length,total:primary+backup+leadOnlyTasks.length,leadOnlyTasks};
}
export function liteFusionReadinessLabel(value: LiteFusionReadiness): string {
  if(value.delegationDisabled)return 'Specialists disabled by tool permissions · lead only';
  if(!value.primary&&!value.backup)return 'No specialists connected · tasks will run on the lead';
  if(value.otherModels===0)return 'Only the lead model is connected · no model mixing';
  return `${value.primary+value.backup} specialist task routes${value.backup?` · ${value.backup} using backups`:''}${value.leadOnly?` · ${value.leadOnly} handled by lead`:''}`;
}
