import type { ArchitectureKind, ArchitectureSelection, ModelRoute } from './architectures.js';
import type { ModelReasoning, Provider, ReasoningEffort, Session } from './types.js';
import { bindExactModels, LITEFUSION_MODELS, LITEFUSION_VERSION, type LiteFusionSelection } from './litefusion.js';

export type ArchitectureKey = 'single' | ArchitectureKind;
/** The complete model arrangement. Permissions, project instructions and files
 * belong to the session and are never restored from an architecture preset. */
export interface ArchitectureConfiguration {
  providerId: string;
  model: string;
  architecture: ArchitectureSelection | null;
  modelReasoning: ModelReasoning;
  planner: ModelRoute | null;
  shunt: Session['shunt'] | null;
  outputStyle: string | null;
}
export type ArchitectureConfigurations = Partial<Record<ArchitectureKey, ArchitectureConfiguration>>;
export interface PendingArchitectureConfiguration {
  id: string;
  requestedAt: number;
  expectedRevision: number;
  configuration: ArchitectureConfiguration;
}
export const architectureKey = (value: { architecture?: ArchitectureSelection | null }): ArchitectureKey => value.architecture?.kind ?? 'single';
export function architectureConfiguration(value: {providerId:string;model:string;architecture?:ArchitectureSelection|null;modelReasoning?:ModelReasoning;planner?:ModelRoute|null;shunt?:Session['shunt']|null;outputStyle?:string|null}): ArchitectureConfiguration {
  return structuredClone({providerId:value.providerId,model:value.model,architecture:value.architecture??null,modelReasoning:value.modelReasoning??{},planner:value.planner??null,shunt:value.shunt??null,outputStyle:value.outputStyle??null});
}
export function rememberArchitecture(value: Parameters<typeof architectureConfiguration>[0] & {architectureConfigurations?:ArchitectureConfigurations}):ArchitectureConfigurations {
  return {...value.architectureConfigurations,[architectureKey(value)]:architectureConfiguration(value)};
}
export function liteFusionPreset(gatewayProviderId: string, models: readonly {id:string}[] = []): LiteFusionSelection {
  const selection=bindExactModels({kind:'litefusion',gatewayProviderId,presetVersion:LITEFUSION_VERSION},models);
  const route=selection.bindings?.opus??{providerId:gatewayProviderId,model:LITEFUSION_MODELS.opus.apiId};
  return {...selection,lead:{...route,effort:'high'}};
}
export function liteFusionConfiguration(selection: LiteFusionSelection, fallback?: Pick<Session,'providerId'|'model'|'modelReasoning'> & {outputStyle?:string|null}): ArchitectureConfiguration {
  const lead=selection.lead??(fallback?{providerId:fallback.providerId,model:fallback.model,effort:fallback.modelReasoning?.[JSON.stringify([fallback.providerId,fallback.model])]}:{providerId:selection.gatewayProviderId,model:LITEFUSION_MODELS.opus.apiId,effort:'high' as const});
  return {providerId:lead.providerId,model:lead.model,architecture:{...selection,lead},modelReasoning:lead.effort?{[JSON.stringify([lead.providerId,lead.model])]:lead.effort}:{},planner:null,shunt:null,outputStyle:fallback?.outputStyle??null};
}
export function withLiteFusionLead(selection: LiteFusionSelection, route: ModelRoute, effort?: ReasoningEffort): LiteFusionSelection {
  return {...selection,lead:{...route,...(effort?{effort}:{})}};
}
export function specialistGateway(providers: readonly Provider[], preferred?: string): string {
  return providers.find(p=>p.id===preferred&&p.kind!=='codex')?.id??providers.find(p=>p.kind!=='codex')?.id??preferred??'';
}
export function liteFusionCustomized(selection:LiteFusionSelection):boolean {
  const expected=selection.bindings?.opus??{providerId:selection.gatewayProviderId,model:LITEFUSION_MODELS.opus.apiId};
  return selection.presetVersion!==LITEFUSION_VERSION||!selection.lead||selection.lead.providerId!==expected.providerId||selection.lead.model!==expected.model||selection.lead.effort!=='high'||selection.concurrency!==undefined||selection.maxAssignments!==undefined||Boolean(selection.spend)||Object.keys(selection.routes??{}).length>0||Object.keys(selection.handoffs??{}).length>0;
}
