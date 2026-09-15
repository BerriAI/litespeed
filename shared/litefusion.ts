import catalog from './litefusion-catalog.json';
import type { ModelRoute } from './architectures.js';
import type { Model, ReasoningEffort } from './types.js';

/** Public policy data carries identities and evidence, never gateway credentials. */
export interface SpecialistRoute { modelKey: string; effort: string }
export type LiteFusionTier = 'default' | 'escalation';
export type LiteFusionCapability = 'browser' | 'desktop' | 'gpu' | 'pdf' | 'connected_tools';
export interface LiteFusionRole {
  id: string; task: string; default: SpecialistRoute; escalation: SpecialistRoute;
  execution: 'lead' | 'worker' | 'read' | 'review' | 'bounded';
  external: boolean; requirements: LiteFusionCapability[]; stakes: string;
  handoff: string; acceptance: string; confidence: string; evidence: string;
  equationProfile: string | null; sources: string[];
}
export interface SpecialistModel { name: string; apiId: string; efforts: string[]; historyRule: string; handoffStyle: string; sources: string[]; executionVerified: boolean }
export const LITEFUSION_VERSION = catalog.version;
export const LITEFUSION_ROLES = catalog.roles as LiteFusionRole[];
export const LITEFUSION_MODELS: Readonly<Record<string, SpecialistModel>> = catalog.models;
export const LITEFUSION_CAPABILITIES = ['browser','desktop','gpu','pdf','connected_tools'] as const;
/** Automatic capacity is resolved by the server; no default assignment cutoff. */
export const LITEFUSION_DEFAULTS = {} as const;

export interface LiteFusionSelection {
  kind: 'litefusion';
  gatewayProviderId: string;
  presetVersion?: string;
  lead?: ModelRoute & { effort?: ReasoningEffort };
  /** Explicit assertion of model identity when a deployment uses an alias. */
  bindings?: Record<string, ModelRoute>;
  routes?: Record<string, Partial<Record<LiteFusionTier, SpecialistRoute>>>;
  spend?: { limitUsd: number; rescueReserveUsd: number; requestCeilings: Array<ModelRoute & { usd: number }> };
  handoffs?: Record<string, { instructions: string; acceptance: string }>;
  concurrency?: number;
  maxAssignments?: number;
  /** Legacy import field. Runtime capability checks use the actual tool catalog. */
  capabilities?: LiteFusionCapability[];
}
export interface LiteFusionRouteStatus {
  roleId: string; tier: LiteFusionTier; requested: SpecialistRoute;
  route?: ModelRoute; effort?: ReasoningEffort;
  status: 'configured' | 'listed' | 'metadata-compatible' | 'unavailable' | 'lead';
  reason?: string; adapter?: 'worker' | 'search' | 'edit_suggestion';
}
export interface LiteFusionAssignment {
  assignmentId: string;
  roleId: string; workstream: string; tier: LiteFusionTier;
  reason: 'default' | 'hard' | 'escalation' | 'availability_fallback' | 'continuation' | 'assistance' | 'review';
  requested: SpecialistRoute; resolved: ModelRoute; resolvedModelKey: string; effort: ReasoningEffort;
  policyVersion: string; policyHash: string; handoffVersion: string;
  previousAttemptId?: string; helperFor?: string; contextReused: boolean;
  adapter: 'worker' | 'search' | 'edit_suggestion';
  files: Array<{ path: string; sha256: string | null }>;
  filesAfter?: Array<{ path: string; sha256: string | null }>;
  availabilityFailure?: string; contextResetReason?: string;
  sameRouteRepairs?: number; failureKind?: 'provider' | 'execution' | 'cancelled' | 'timeout' | 'integration';
  outcome?: 'needs_help' | 'needs_handoff';
  request?: { reason: string; evidence: string; suggestedRoleId?: string };
  verification: 'pending' | 'needs_review';
  integration: 'root_workspace' | 'isolated' | 'integrated' | 'conflict' | 'not_applied';
  acceptance: 'unresolved';
}

export function liteFusionRole(id: string): LiteFusionRole {
  const role = LITEFUSION_ROLES.find(item => item.id === id);
  if (!role) throw new Error(`Unknown LiteFusion task ${JSON.stringify(id)}.`);
  return role;
}
export function specialistRoute(selection: LiteFusionSelection, role: LiteFusionRole, tier: LiteFusionTier): SpecialistRoute {
  return selection.routes?.[role.id]?.[tier] ?? role[tier];
}
export function specialistLabel(route: SpecialistRoute): string {
  return `${LITEFUSION_MODELS[route.modelKey]?.name ?? route.modelKey} / ${route.effort}`;
}
export function effectiveSpecialist(role: LiteFusionRole, tier: LiteFusionTier, route: SpecialistRoute, fallback: SpecialistRoute = role.escalation): { route: SpecialistRoute; adapter: LiteFusionAssignment['adapter']; limitation?: string } {
  // These two specialized APIs are explicitly unavailable in the initial policy.
  if (route.modelKey === 'mercury_edit') return { route: fallback, adapter: 'edit_suggestion', limitation: 'Explicit version-checked suggestions only; continuous editor autocomplete is unavailable.' };
  if (route.modelKey === 'voyage_code') return { route: fallback, adapter: 'search', limitation: 'Targeted search and repository investigation only; no embedding index.' };
  return { route, adapter: ['inline_completion','next_edit'].includes(role.id) ? 'edit_suggestion' : role.id === 'semantic_code_index' ? 'search' : 'worker' };
}
export function validateLiteFusion(selection: LiteFusionSelection): void {
  if (selection.kind !== 'litefusion' || !selection.gatewayProviderId.trim()) throw new Error('Choose a LiteFusion gateway provider.');
  for (const [key, binding] of Object.entries(selection.bindings ?? {})) {
    if (!Object.hasOwn(LITEFUSION_MODELS,key)) throw new Error(`Unknown specialist model ${key}.`);
    if (!binding.providerId.trim() || !binding.model.trim()) throw new Error(`Incomplete deployment binding for ${key}.`);
  }
  for (const id of Object.keys(selection.handoffs ?? {})) liteFusionRole(id);
  for (const [id, routes] of Object.entries(selection.routes ?? {})) {
    liteFusionRole(id);
    for (const route of Object.values(routes)) {
      if (!route || !LITEFUSION_MODELS[route.modelKey]?.efforts.includes(route.effort)) throw new Error(`Unsupported model/reasoning configuration for ${id}.`);
    }
  }
}

/** No timestamps or current tool/file state in this stable prefix. */
export function liteFusionLeadPrompt(selection: LiteFusionSelection): string {
  const cards = LITEFUSION_ROLES.map(base => {
    const role = configuredRole(selection, base.id);
    const route = (tier: LiteFusionTier) => role.execution === 'lead' ? 'You, the configured lead' : specialistLabel(effectiveSpecialist(role,tier,specialistRoute(selection,role,tier),specialistRoute(selection,role,'escalation')).route);
    const limitation = effectiveSpecialist(role,'default',specialistRoute(selection,role,'default'),specialistRoute(selection,role,'escalation')).limitation;
    return `${role.id}: ${role.task}\nDefault: ${route('default')}. Hard/escalation: ${route('escalation')}. Mode: ${role.execution}. Stakes: ${role.stakes}. Prerequisites: ${role.requirements.join(', ') || 'ordinary workspace tools'}.\nHandoff: ${role.handoff}\nAcceptance: ${role.acceptance}${limitation ? `\nLimitation: ${limitation}` : ''}`;
  });
  return `LiteFusion policy ${LITEFUSION_VERSION}. You are the persistent user-facing lead. Own intent, scope, user communication, integration and acceptance. For substantial work, briefly scope the request, then delegate coherent specialist tasks by default: repository investigation, implementation, tests and independent review. Read only enough to give a useful handoff; do not complete the investigation yourself before assigning it. Continue independent lead work while workers run. Handle quick questions, tiny edits, tightly coupled integration and acceptance yourself when delegation would cost more than it saves. If you take substantial specialist work on yourself, state a short concrete reason in your progress update (for example: no eligible route, failed handoff, or already-local evidence); 'I can do it' is not a reason. There is no worker quota and no need to split every tool operation. Classify mixed work before delegating. The catalog is an initial research policy, not measured success probabilities.
Call delegate with roleId, workstream, objective, constraints, acceptance criteria, relevant files/evidence and a short routing reason. Code selects the deployment and native reasoning; never invent them. hard=true starts on the role's escalation route. repairOf selects that SAME escalation route and carries previous artifacts and failure evidence. Do not confuse high stakes with difficulty. Do not reassign user-cancelled work.
Use continueFrom to continue compatible completed or yielded work; include new evidence and avoid repeating exploration. A same-route repair uses continueFrom with repair=true and actionable evidence; it is not repairOf. When a worker reports needs_help, create a sibling with helperFor; after it returns, continue the original worker with the findings. needs_handoff returns ownership to you; decide an explicit transfer. Workers cannot create workers or ask users. Independent review is a separate role with original requirements, raw checks and the patch, before the author's explanation.
delegate registers work and returns a task ID immediately. The scheduler starts ready tasks within host capacity. Submit prerequisites first, then dependents using dependsOn task IDs or workstream names. Dependency reports and integrated source are included when dependents start. Continue useful independent lead work; otherwise call wait_tasks to wait without model polling. You receive results as task events without waiting for unrelated siblings. Workers use private source copies and version-checked integration at your execution boundaries. A completed task still needs your acceptance. If you independently resolve blocked or failed work, record its task ID and concrete evidence with resolve_task; this records your judgment, not externally verified success. Compatible worker contexts may continue across attempts. Declare relevant files, integrate and run combined checks. A completed worker is not proof of success. Keep observed facts separate from diagnoses; acceptance remains yours. Allow one actionable same-route repair, then escalate or take over when no progress is made. Do not repeatedly escalate an already-escalated task. An explicit provider rejection can trigger one host-managed availability fallback to the configured escalation route; do not duplicate a queued recovery. This is separate from a hard-task classification.
When the runtime lists a task in leadOnlyTasks, both configured specialist routes are unavailable: handle it directly only if capable and state that fallback briefly. Missing specialists never authorize pretending that a worker ran. Provider availability failures are distinct from quality failures. A routing error does not authorize arbitrary substitution; continue directly if capable, otherwise explain the missing prerequisite. Native autocomplete and vector indexing are unavailable. Memory extraction only proposes updates through your existing memory policy. Do not run hidden classifiers or online benchmark refresh inside dispatch.

${cards.join('\n\n')}

Recipient context rules:\n${Object.entries(LITEFUSION_MODELS).filter(([key]) => !['mercury_edit','voyage_code'].includes(key)).map(([key, model]) => `${key}: ${model.handoffStyle} ${model.historyRule}`).join('\n')}`;
}

export function configuredRole(selection: LiteFusionSelection, id: string): LiteFusionRole {
  const role = liteFusionRole(id), guide = selection.handoffs?.[id];
  return guide ? { ...role, handoff: guide.instructions, acceptance: guide.acceptance } : role;
}
/** Pin only exact identities discovered on the configured gateway. No fuzzy aliases. */
export function bindExactModels(selection: LiteFusionSelection, models: readonly Pick<Model,'id' | 'canonicalId'>[]): LiteFusionSelection {
  const bindings = { ...selection.bindings };
  for (const [key, card] of Object.entries(LITEFUSION_MODELS)) {
    if (bindings[key] || ['mercury_edit','voyage_code'].includes(key)) continue;
    const namespace=card.apiId.startsWith('gpt-')?'openai':card.apiId.startsWith('claude-')?'anthropic':card.apiId.startsWith('gemini-')?'gemini':card.apiId.startsWith('grok-')?'xai':card.apiId.startsWith('kimi-')?'moonshot':card.apiId.startsWith('glm-')?'zai':undefined;
    const identities=[card.apiId,...(namespace?[`${namespace}/${card.apiId}`]:[])];
    // Never infer identity from display names, prefixes or version similarity.
    const exact=identities.find(id=>models.some(model=>model.id===id));
    const aliases=models.filter(model=>model.canonicalId && identities.includes(model.canonicalId));
    const model=exact??(aliases.length===1?aliases[0].id:undefined);
    if(model)bindings[key]={providerId:selection.gatewayProviderId,model};
  }
  return { ...selection, bindings };
}

export function liteFusionPolicy(selection: LiteFusionSelection) {
  return { schemaVersion: 1, catalogVersion: LITEFUSION_VERSION, selection };
}
export function parseLiteFusionPolicy(text: string): LiteFusionSelection {
  const policy = JSON.parse(text);
  if (policy.schemaVersion !== 1 || policy.catalogVersion !== LITEFUSION_VERSION) throw new Error('Unsupported policy version. Review and migrate it against the installed catalog before importing.');
  validateLiteFusion(policy.selection);
  return policy.selection;
}
