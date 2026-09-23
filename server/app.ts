import { liteFusionReadiness } from '../shared/litefusion-readiness.js';
import { liteFusionEnvironment } from './litefusion-environment.js';
import { LiteFusionEvaluations, evaluationSchema } from './litefusion-evaluations.js';
import { VERSION } from '../shared/version.js';
import type { UpdateStatus } from '../shared/updates.js';
import { shuntSchema } from './shunt.js';
import { shuntConfigured } from '../shared/shunt.js';
import { gatewayBaseUrl } from '../shared/setup.js';
import { clientSurface } from '../shared/client.js';
import { REASONING_EFFORTS } from '../shared/types.js';
import { browserActionSchema, browserStopSchema, browserSelectionSchema } from './browser.js';
import { browserUploadSchema } from './browser-uploads.js';
import type { BrowserFrame } from '../shared/browser.js';
import { computerActionSchema, type ComputerDriver } from './computer.js';
import { GitActions } from './git-actions.js';
import { GitDiscards } from './git-discard.js';
import { GitBranchesService, gitBranchRequestSchema } from './git-branches.js';
import { PullRequests, type PullRequestTransport } from './pull-requests.js';
import { PullRequestCheckouts, type PullRequestFetcher } from './pull-request-checkouts.js';
import { worktreeName, worktreeStartingRef } from './worktrees.js';
import { TaskWorktrees } from './task-worktree.js';
import { TaskLocals } from './task-local.js';
import { defaultDownloadDirectory, validateDownloadDirectory } from './download-destination.js';
import { pullRequestCheckoutDraft, pullRequestDiscussion } from '../shared/pull-requests.js';
import { filePreview, readPreviewAsset } from './file-preview.js';
import { snapshotFileAttachment } from './attachment-files.js';
import { WorkspacePreferences } from './workspace-preferences.js';
import { architectureConfiguration, liteFusionPreset } from '../shared/architecture-config.js';
import { architectureProviders } from '../shared/architectures.js';
import { liteFusionSchema, captureLiteFusion } from './litefusion-routing.js';
import { LITEFUSION_ROLES, LITEFUSION_MODELS, LITEFUSION_VERSION, validateLiteFusion } from '../shared/litefusion.js';
import express, { type Express, type Response } from 'express';
import { z } from 'zod';
import { realpath, stat, readdir, readFile as readStateFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { EventBus } from './events.js';
import { Runner, type ExternalTools } from './runner.js';
import { Memory } from './memory.js';
import { listModels } from './providers.js';
import { modelCatalog } from './budget.js';
import { readProfileCatalog, readEditableProfile, saveProjectProfile, saveProjectProfileSchema, resolveProfileChoice, profileSourceStatus, type ProfileSnapshot } from './profiles.js';
import { skillInvocationSchema, snapshotSkillInvocation } from './skill-invocation.js';
import { skillDiscover, skillPlan, skillApply } from './skill-import.js';
import { mcpImportDiscover, mcpImportPlan, mcpImportApply } from './mcp-import.js';
import { validateRuleSet } from './permissions.js';
import { sandboxBackend } from './command-sandbox.js';
import { permissionReview, hookReview, sourceHash } from './workspace-trust.js';
import { validateHooks } from './hooks.js';
import { validateSidecars } from './sidecars.js';
import { planInstall, applyInstall, uninstall, publicPlan, pluginPlanHash } from './plugins.js';
import { PLUGIN_LIMITS } from '../shared/plugins.js';
import { HOOK_LIMITS } from '../shared/hooks.js';
import type { ProfileDetail } from '../shared/profiles.js';
import { listFiles, listWorkspaceStyles, readFile, readCommand, restoreChanges, searchFiles, gitStatus, resolveWorkspacePath } from './tools.js';
import { collectDiagnostics } from './doctor.js';
import { Schedules } from './schedules.js';
import { nextOccurrence, scheduleTimingSchema } from './schedule-time.js';
import { gitReview, gitFileDiff } from './git-review.js';
import type { ScheduleSelection } from '../shared/schedules.js';
import type { Message, Provider, Session, Settings, UsageReport, UsageTotals } from '../shared/types.js';

const providerSchema = z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),name:z.string().min(1).max(100),kind:z.enum(['openai','anthropic','codex']),baseUrl:z.url().refine(v=>['http:','https:'].includes(new URL(v).protocol)),apiKey:z.string().max(8192).optional(),models:z.array(z.string().max(200)).max(500).optional(),anthropicCacheModels:z.array(z.string().min(1).max(250)).max(500).optional(),contextWindows:z.record(z.string().min(1).max(250),z.number().int().min(1024).max(10000000)).refine(value=>Object.keys(value).length<=100,'At most 100 model context windows may be configured.').optional()});
const browserPreferencesSchema = z.object({ searchEngine: z.enum(['google', 'duckduckgo', 'bing']), rememberHistory: z.boolean(), downloadDirectory: z.string().trim().max(4096).optional(), autoSaveDownloads: z.boolean().optional() }).strict();
const mcpSchema = z.object({command:z.string().max(1000).optional(),args:z.array(z.string().max(4000)).max(100).optional(),env:z.record(z.string(),z.string().max(8192)).optional(),url:z.url().optional(),enabled:z.boolean().optional(),advertise:z.boolean().optional()}).refine(v=>Boolean(v.command)!==Boolean(v.url),'Specify either a command or URL');
const settingsSchema = z.object({browser:browserPreferencesSchema.optional(),providers:z.array(providerSchema).max(30).refine(p=>new Set(p.map(x=>x.id)).size===p.length,'Provider IDs must be unique').optional(),defaultProvider:z.string().max(64).optional(),defaultModel:z.string().max(250).optional(),workspace:z.string().max(4096).optional(),permissionMode:z.enum(['ask','edit','auto']).optional(),maxSteps:z.number().int().min(1).max(200).optional(),theme:z.enum(['light','dark','system']).optional(),mcpServers:z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),mcpSchema).refine(value=>Object.keys(value).length<=30,'At most 30 MCP servers may be configured.').optional(),permissionRules:z.unknown().optional(),memoryEnabled:z.boolean().optional(),hooks:z.unknown().optional(),sidecars:z.unknown().optional(),trustedWorkspaces:z.array(z.string().min(1).max(4096)).max(HOOK_LIMITS.trustedWorkspaces).optional(),notifications:z.boolean().optional(),expectedMcpConfigRevision:z.string().min(1).max(128).optional()});
// planner: the optional planning half of a planner+executor pair; null clears it.
// architecture: the optional multi-model arrangement (shared/architectures.ts); null clears it.
const modelRouteSchema = z.object({providerId:z.string().min(1).max(64),model:z.string().min(1).max(250)}).strict();
const architectureSchema = z.discriminatedUnion('kind', [
  liteFusionSchema,
  z.object({kind:z.literal('sidekick-fusion'),sidekick:modelRouteSchema}).strict(),
  z.object({kind:z.literal('team-fusion'),worker:modelRouteSchema,concurrency:z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4)]).optional()}).strict(),
  z.object({kind:z.literal('expert-fusion'),expert:modelRouteSchema,concurrency:z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4)]).optional()}).strict(),
]);
const sessionSchema = z.object({shunt:shuntSchema.nullable().optional(),modelReasoning:z.record(z.string().max(400),z.enum(REASONING_EFFORTS)).refine(value=>Object.keys(value).length<=100,'At most 100 model reasoning preferences may be configured.').optional(),title:z.string().trim().min(1).max(200).optional(),workspace:z.string().max(4096).optional(),providerId:z.string().max(64).optional(),model:z.string().max(250).optional(),mode:z.enum(['build','plan']).optional(),commandSandbox:z.enum(['off','workspace']).optional(),permissionMode:z.enum(['ask','edit','auto']).optional(),planner:z.object({providerId:z.string().min(1).max(64),model:z.string().min(1).max(250)}).nullable().optional(),architecture:architectureSchema.nullable().optional(),outputStyle:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).nullable().optional()});
const architectureConfigurationSchema=sessionSchema.pick({providerId:true,model:true,architecture:true,planner:true,shunt:true,modelReasoning:true,outputStyle:true}).required();
const architectureConfigurationsSchema=z.object({single:architectureConfigurationSchema.optional(),'sidekick-fusion':architectureConfigurationSchema.optional(),'team-fusion':architectureConfigurationSchema.optional(),'expert-fusion':architectureConfigurationSchema.optional(),litefusion:architectureConfigurationSchema.optional()}).strict().refine(value=>Object.entries(value).every(([key,configuration])=>!configuration||(configuration.architecture?.kind??'single')===key),'Saved architecture must match its key.');
const profileChoiceSchema=z.object({profileId:z.string().min(1).max(64).nullable(),skillIds:z.array(z.string().min(1).max(64)).max(100),catalogRevision:z.string().min(1).max(128).optional()}).strict().refine(choice=>new Set(choice.skillIds).size===choice.skillIds.length,'Skill IDs must be unique.').refine(choice=>(choice.profileId===null&&choice.skillIds.length===0)||Boolean(choice.catalogRevision),'Refresh the profile catalog before choosing profiles or skills.');
const configRevisionSchema=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const profileSelectionSchema=z.object({providerId:z.string().min(1).max(64).optional(),model:z.string().min(1).max(250).optional(),mode:z.enum(['build','plan']).optional()}).strict();
const attachmentSchema = z.object({skillId:z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).optional(),name:z.string().max(255),path:z.string().max(4096).optional(),content:z.string().max(200000).optional(),mimeType:z.string().max(100).optional(),dataUrl:z.string().max(6000000).regex(/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/).optional()});
const inputSchema = z.object({skills:skillInvocationSchema.optional(),content:z.string().max(200000),attachments:z.array(attachmentSchema).max(10).optional()}).refine(v=>v.content.trim() || v.attachments?.length,'A message or attachment is required');
const queryString = (value:unknown) => typeof value === 'string' ? value : '';
const httpError = (status:number,message:string) => Object.assign(new Error(message),{status});
export interface AuthService {
  start(providerId:string,method:'device'|'browser'):Promise<any>;
  status(loginId:string):any;
  connected(providerId:string):boolean;
  disconnect(providerId:string):any;
}
export interface AppOptions { store?:Store; external?:ExternalTools; computerDriver?:ComputerDriver; pullRequestTransport?:PullRequestTransport; pullRequestFetcher?:PullRequestFetcher; workspaceHasTerminal?: (workspace: string) => boolean; auth?:AuthService; updates?: { installation?: string; desktopBuild?: number; status(force?:boolean):Promise<UpdateStatus>; install():Promise<UpdateStatus>; restart(input?: {appPid?: number}):Promise<{version:string}>; draining():boolean }; }

export function createApp(options:AppOptions = {}) {
  const store=options.store || new Store(),bus=new EventBus(store),runner=new Runner(store,bus,options.external,options.computerDriver);
  const app:Express=express();
  app.disable('x-powered-by');
  app.use((req,res,next)=>{
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) runner.browsers.blockOrigin(`http://${host}:${req.socket.localPort}`);
    const hostname=req.hostname.replace(/^\[|\]$/g,'');
    if(!['localhost','127.0.0.1','::1'].includes(hostname)) return res.status(403).json({error:'Litespeed only accepts local connections.'});
    const origin=req.get('origin');
    if(origin){try{if(new URL(origin).host!==req.get('host'))return res.status(403).json({error:'Cross-origin requests are not allowed.'});}catch{return res.status(403).json({error:'Invalid request origin.'});}}
    if(req.get('sec-fetch-site')==='cross-site')return res.status(403).json({error:'Cross-site requests are not allowed.'});
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    next();
  });
  app.use('/api/sessions/:id',(req,res,next)=>{if(runner.delegations.isChild(req.params.id))return res.status(req.method==='GET'||req.method==='HEAD'?404:409).json({error:'Research transcripts are read-only and available through their parent task.'});next();});
  app.use('/api',express.json({limit:'12mb'}));
  app.use('/api',(req,res,next)=>{if(options.updates?.draining() && !['GET','HEAD'].includes(req.method))return res.status(503).json({error:'Litespeed is restarting. Your draft is preserved; try again when it reconnects.'});next();});
  const mcpConfigRevision=()=>options.external?.configRevision?.()??createHash('sha256').update(JSON.stringify(store.settings().mcpServers,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value)).digest('hex');
  const mcpStatus=()=>({servers:options.external?.status?.()??[],configRevision:mcpConfigRevision()});
  const publicSettings=()=>{const s=store.publicSettings();return{...s,mcpConfigRevision:mcpConfigRevision(),providers:s.providers.map(p=>p.kind==='codex'?{...p,configured:options.auth?.connected(p.id)||false}:p)}};
  const workspace=async(value:unknown)=>{const root=await realpath(resolve(queryString(value)||store.settings().workspace));if(!(await stat(root)).isDirectory())throw httpError(400,'Workspace must be a directory.');return root;};
  const checkProvider=(id:string|undefined)=>{if(id&&!store.settings().providers.some(p=>p.id===id))throw httpError(400,'Provider not found. Choose a connected provider.');};
  app.get('/api/workspaces/resolve',async(req,res)=>{
    const value=z.string().trim().min(1).max(4096).parse(req.query.path);
    const path=value==='~'?homedir():value.startsWith('~/')?join(homedir(),value.slice(2)):value;
    res.json({path:await workspace(path)});
  });
  const requestSignal=(res:Response)=>{const controller=new AbortController();res.once('close',()=>{if(!res.writableEnded)controller.abort();});return controller.signal;};
  const profileDetail=(snapshot:ProfileSnapshot|null,source:ProfileDetail['source']={status:snapshot?'current':'inactive'},diagnostics:ProfileDetail['diagnostics']=[]):ProfileDetail=>({active:snapshot?.active??null,pinned:snapshot?{instructions:snapshot.instructions,skills:snapshot.skills,sources:snapshot.sources}:null,source,diagnostics});
  const publishConfiguration=(id:string)=>{for(const [type,data]of [['session',store.session(id)],['queue',store.queue(id)]] as const)try{bus.emit(id,type,data);}catch{console.error('Could not publish configuration update. Refresh to inspect saved state.');}};
  app.get('/api/profiles',async(req,res)=>{const signal=requestSignal(res),root=await workspace(req.query.workspace);signal.throwIfAborted();res.json({...await readProfileCatalog(root,signal),workspace:root});});
  app.get('/api/profiles/edit',async(req,res)=>{const root=await workspace(req.query.workspace),id=z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).parse(req.query.id);res.json(await readEditableProfile(root,id));});
  app.post('/api/profiles/save',async(req,res)=>{const input=saveProjectProfileSchema.parse(req.body),root=await workspace(input.workspace);res.json(await saveProjectProfile(root,input));});
  app.post('/api/profiles/preview',async(req,res)=>{const input=z.object({workspace:z.string().max(4096).optional(),choice:profileChoiceSchema}).strict().parse(req.body),signal=requestSignal(res),root=await workspace(input.workspace);signal.throwIfAborted();const resolved=await resolveProfileChoice(root,input.choice,signal);res.json(profileDetail(resolved.snapshot));});
  // Skill importer: fixed, server-resolved roots only; discovery is explicit,
  // plan is the dry run and apply revalidates the source hash. No client path is
  // ever accepted -- only a fixed root id + skill id, both logged/sanitized.
  const skillRootSchema=z.enum(['claude:home','claude:project','codex:home','codex:agents-home','codex:project','codex:legacy-project']);
  app.get('/api/skills/discover',async(req,res)=>{const root=await workspace(req.query.workspace);res.json(await skillDiscover(root));});
  app.post('/api/skills/plan',async(req,res)=>{const input=z.object({workspace:z.string().max(4096).optional(),rootId:skillRootSchema,id:z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)}).strict().parse(req.body);const root=await workspace(input.workspace);res.json(await skillPlan(root,input.rootId,input.id));});
  app.post('/api/skills/import',async(req,res)=>{const input=z.object({workspace:z.string().max(4096).optional(),rootId:skillRootSchema,id:z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),sourceHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(req.body);const root=await workspace(input.workspace);res.json(await skillApply(root,input.rootId,input.id,input.sourceHash));});
  // MCP import intentionally reads only fixed Claude Code/Codex config files.
  // Discovery is metadata-only. Explicit plan review includes commands/endpoints, never environment credential values.
  const mcpImportIds=z.array(z.string().regex(/^[a-f0-9]{32}$/)).min(1).max(30).refine(value=>new Set(value).size===value.length);
  app.get('/api/mcp/import/discover',async(req,res)=>{const root=await workspace(req.query.workspace);res.json(await mcpImportDiscover(root,store.settings().mcpServers));});
  app.post('/api/mcp/import/plan',async(req,res)=>{const input=z.object({workspace:z.string().max(4096).optional(),ids:mcpImportIds}).strict().parse(req.body);const root=await workspace(input.workspace);res.json(await mcpImportPlan(root,store.settings().mcpServers,input.ids));});
  app.post('/api/mcp/import/apply',async(req,res)=>{
    const input=z.object({workspace:z.string().max(4096).optional(),ids:mcpImportIds,sourceHash:z.string().regex(/^[a-f0-9]{64}$/),expectedMcpConfigRevision:z.string().min(1).max(128),connect:z.boolean().optional()}).strict().parse(req.body);
    if(input.connect&&!options.external?.reconnect)throw httpError(503,'MCP connection operations are unavailable. Import disabled configurations instead.');
    const root=await workspace(input.workspace),result=await mcpImportApply(root,store,input.ids,input.sourceHash,input.expectedMcpConfigRevision,mcpConfigRevision,input.connect);
    if(input.connect){
      result.connected=[];result.connectionErrors=[];
      await runner.externalOperation(async signal=>{
        for(const name of result.imported){
          try{
            if(result.configRevision!==mcpConfigRevision())throw httpError(409,'Saved configuration changed. Review before connecting.');
            const server=options.external!.status!().find(server=>server.name===name);
            if(!server)throw httpError(409,'Imported server is unavailable. Review its configuration.');
            await options.external!.reconnect!(name,server.revision,signal);result.connected!.push(name);
          }catch{result.connectionErrors!.push(`${name}: connection did not complete. Review its status in Integrations before retrying.`);}
        }
      },requestSignal(res));
    }
    res.json(result);
  });
  app.get('/api/health',async(_req,res)=>res.json({ok:true,name:'litespeed',version:VERSION,pid:process.pid,storeId:createHash('sha256').update(await realpath(store.directory)).digest('hex'),...(options.updates?.installation?{installation:options.updates.installation}:{}),...(options.updates?.desktopBuild?{desktopBuild:options.updates.desktopBuild}:{}),...(process.env.LITESPEED_DESKTOP_UPDATE_HANDOFF?{desktopUpdateId:process.env.LITESPEED_DESKTOP_UPDATE_HANDOFF}:{})}));
  app.get('/api/desktop/import', async(_req,res) => {
    try {
      const path = join(store.directory, 'desktop-import.json');
      if ((await stat(path)).size > 4096) return res.json(null);
      const marker = z.object({ imported: z.literal(true), importedAt: z.number(), sessions: z.number().int().nonnegative(), schedulesPaused: z.number().int().nonnegative() }).parse(JSON.parse(await readStateFile(path, 'utf8')));
      res.json(marker);
    } catch { res.json(null); }
  });
  app.get('/api/updates',async(req,res)=>res.json(options.updates?await options.updates.status(req.query.check==='true'):{currentVersion:VERSION,available:false,packaged:false,restartRequired:false,releaseUrl:'https://github.com/BerriAI/litespeed/releases',command:'Update your source checkout and rebuild.'}));
  app.post('/api/updates/install',async(_req,res)=>{if(!options.updates)throw httpError(409,'Packaged updates are unavailable on this server.');res.json(await options.updates.install());});
  app.post('/api/updates/restart',async(req,res)=>{if(!options.updates)throw httpError(409,'Packaged updates are unavailable on this server.');const input=z.object({appPid:z.number().int().min(2).optional()}).strict().parse(req.body??{});res.json(await options.updates.restart(input));});
  // 5.1 usage report. days is zod-clamped 1..90 (coerced from the query
  // string); the store clamps again so no other caller can widen the scan.
  // Token counts are provider-reported; no cost is computed (no rate card in v1).
  app.get('/api/usage',(req,res)=>{
    const days=z.coerce.number().catch(30).transform(value=>Math.min(Math.max(Math.trunc(value),1),90)).parse(req.query.days??30);
    const rows=store.usageSummary({days});
    const add=(totals:UsageTotals,row:{inputTokens:number;outputTokens:number;cachedTokens?:number;requests:number}):UsageTotals=>({inputTokens:totals.inputTokens+row.inputTokens,outputTokens:totals.outputTokens+row.outputTokens,requests:totals.requests+row.requests,
      // cachedTokens stays absent until SOME entry reported one: an honest
      // "providers did not say", never a fabricated 0.
      ...(totals.cachedTokens!==undefined||row.cachedTokens!==undefined?{cachedTokens:(totals.cachedTokens??0)+(row.cachedTokens??0)}:{})});
    const empty=():UsageTotals=>({inputTokens:0,outputTokens:0,requests:0});
    const byDay=new Map<string,{day:string;entries:UsageReport['days'][number]['entries'];totals:UsageTotals}>();
    let totals=empty();
    for(const row of rows){
      const bucket=byDay.get(row.day)??byDay.set(row.day,{day:row.day,entries:[],totals:empty()}).get(row.day)!;
      bucket.entries.push({providerId:row.providerId,model:row.model,inputTokens:row.inputTokens,outputTokens:row.outputTokens,...(row.cachedTokens!==undefined?{cachedTokens:row.cachedTokens}:{}),requests:row.requests});
      bucket.totals=add(bucket.totals,row);totals=add(totals,row);
    }
    res.json({days:[...byDay.values()],totals} satisfies UsageReport);
  });
  // 5.2 redacted diagnostics: hosts only, hasKey booleans, counts — never
  // secrets, env values, full URLs, or message content (see server/doctor.ts).
  app.get('/api/doctor',(_req,res)=>res.json(collectDiagnostics(store)));
  // 5.2 repair v1: rebuild the derived search index. The only repair offered —
  // it is safe because the index is fully derived; other repairs need design.
  app.post('/api/doctor/reindex',(_req,res)=>res.json(runner.reindexSearch()));
  app.get('/api/settings',(_req,res)=>res.json(publicSettings()));
  app.patch('/api/settings',async(req,res)=>{
    const {expectedMcpConfigRevision,...parsed}=settingsSchema.parse(req.body);
    const patch=parsed as Partial<Settings>;
    if(patch.permissionRules!==undefined)patch.permissionRules=validateRuleSet(patch.permissionRules);
    // Hooks validate like permission rules (zod, strict, bounded): invalid
    // configuration is a 400, never partially persisted.
    if(patch.hooks!==undefined)patch.hooks=validateHooks(patch.hooks);
    // Sidecars (design note 4.5) validate the same way: zod, strict, bounded,
    // 400 on any violation, never partially persisted. Settings PATCH is the
    // whole v1 surface — no dedicated routes.
    if(patch.sidecars!==undefined)patch.sidecars=validateSidecars(patch.sidecars);
    if(patch.workspace)patch.workspace=await workspace(patch.workspace);
    if(patch.browser) {
      if (patch.browser.downloadDirectory && (patch.browser.autoSaveDownloads || patch.browser.downloadDirectory !== store.settings().browser?.downloadDirectory)) patch.browser.downloadDirectory = await validateDownloadDirectory(patch.browser.downloadDirectory);
      else if (!patch.browser.downloadDirectory && patch.browser.autoSaveDownloads) patch.browser.downloadDirectory = await validateDownloadDirectory();
      else if (patch.browser.downloadDirectory === '') delete patch.browser.downloadDirectory;
    }
    if(patch.mcpServers&&expectedMcpConfigRevision!==undefined&&expectedMcpConfigRevision!==mcpConfigRevision())throw httpError(409,'Saved MCP configuration changed. Review it before saving your changes.');
    const current=store.settings(),providers=patch.providers||current.providers;
    if(providers.length&&!providers.some(p=>p.id===(patch.defaultProvider||current.defaultProvider)))throw httpError(400,'Default provider must be in the provider list.');
    if(patch.mcpServers)for(const[name,config]of Object.entries(patch.mcpServers))if(config.env)for(const[key,value]of Object.entries(config.env))if(value==='••••••••')config.env[key]=current.mcpServers[name]?.env?.[key]||'';
    store.saveSettings(patch);options.external?.status?.();res.json(publicSettings());
  });
  // Workspace trust for project hooks (design note 4.3): one explicit act per
  // workspace, persisted as a CANONICAL (realpath) path so a symlinked alias
  // can never inherit trust. POST adds, DELETE removes; both are idempotent.
  const trustInput=(body:unknown)=>z.object({workspace:z.string().min(1).max(4096),sourceHash:z.string().optional()}).strict().parse(body).workspace;
  app.get('/api/workspaces/permissions',async(req,res)=>{
    const root=await workspace(queryString(req.query.workspace)||store.settings().workspace), settings=store.settings();
    const rules=permissionReview(root), hooks=hookReview(root);
    res.json({sandboxBackend:sandboxBackend(),workspace:root,rules:{...rules,trusted:settings.trustedPermissionRules?.[root]===rules.sourceHash},hooks:{...hooks,trusted:(settings.trustedWorkspaces??[]).includes(root)},grants:store.projectToolGrants(root),appHooks:settings.hooks??[],appHooksRevision:sourceHash(JSON.stringify(settings.hooks??[])),sidecars:settings.sidecars??[]});
  });
  app.post('/api/hooks/enabled',(req,res)=>{
    const input=z.object({index:z.number().int().min(0),enabled:z.boolean(),expectedRevision:z.string()}).strict().parse(req.body), hooks=store.settings().hooks??[];
    if(input.expectedRevision!==sourceHash(JSON.stringify(hooks))||!hooks[input.index])throw httpError(409,'App hooks changed. Review them again.');
    store.saveSettings({hooks:hooks.map((hook,index)=>index===input.index?{...hook,enabled:input.enabled}:hook)});res.json({ok:true});
  });
  app.post('/api/workspaces/permission-rules',async(req,res)=>{
    const input=z.object({workspace:z.string(),sourceHash:z.string()}).strict().parse(req.body), root=await workspace(input.workspace), review=permissionReview(root);
    if(review.advisory||input.sourceHash!==review.sourceHash)throw httpError(409,'Project rules changed or are invalid. Review them again.');
    store.saveSettings({trustedPermissionRules:{...store.settings().trustedPermissionRules,[root]:review.sourceHash}});
    res.json({ok:true});
  });
  app.delete('/api/workspaces/permission-rules',async(req,res)=>{
    const root=await workspace(trustInput(req.body)), values={...store.settings().trustedPermissionRules};delete values[root];store.saveSettings({trustedPermissionRules:values});res.json({ok:true});
  });
  app.delete('/api/workspaces/tool-grants',async(req,res)=>{const root=await workspace(trustInput(req.body));store.clearProjectToolGrants(root);res.json({ok:true});});
  app.post('/api/workspaces/trust',async(req,res)=>{
    const root=await workspace(trustInput(req.body));
    if(req.body.sourceHash!==undefined&&req.body.sourceHash!==hookReview(root).sourceHash)throw httpError(409,'Project hooks changed. Review them again.');
    const current=store.settings().trustedWorkspaces??[];
    if(!current.includes(root)){
      if(current.length>=HOOK_LIMITS.trustedWorkspaces)throw httpError(400,`At most ${HOOK_LIMITS.trustedWorkspaces} workspaces may be trusted.`);
      store.saveSettings({trustedWorkspaces:[...current,root]});
    }
    res.json({trustedWorkspaces:store.settings().trustedWorkspaces??[]});
  });
  app.delete('/api/workspaces/trust',async(req,res)=>{
    // Canonicalize when possible so the caller can untrust by any alias, but a
    // DELETED workspace (realpath fails) must still be removable verbatim.
    const raw=trustInput(req.body);
    let canonical=raw;try{canonical=await workspace(raw);}catch{/* remove the raw path */}
    const current=store.settings().trustedWorkspaces??[];
    store.saveSettings({trustedWorkspaces:current.filter(p=>p!==canonical&&p!==raw)});
    res.json({trustedWorkspaces:store.settings().trustedWorkspaces??[]});
  });
  app.get('/api/models',async(req,res)=>{
    const provider=store.settings().providers.find(p=>p.id===(queryString(req.query.providerId)||store.settings().defaultProvider));
    if(!provider)throw httpError(404,'Provider not found.');
    // OAuth account identity is not part of the provider configuration cache key.
    if(provider.kind==='codex')modelCatalog.clear(provider.id);
    try{const models=await listModels(provider,AbortSignal.timeout(30000));if(provider.kind!=='codex')modelCatalog.remember(provider,models);res.json({models});}
    catch(error){res.status(502).json({models:[],error:safeError(error,store)});}
  });
  app.post('/api/providers/connect',async(req,res)=>{
    const input=z.object({providerId:providerSchema.shape.id,baseUrl:providerSchema.shape.baseUrl,apiKey:providerSchema.shape.apiKey}).strict().parse(req.body);
    try{gatewayBaseUrl(input.baseUrl);}catch(error){throw httpError(400,(error as Error).message);}
    const previous=store.settings().providers.find(p=>p.id===input.providerId);
    if(previous&&previous.kind!=='openai')throw httpError(400,'Choose a different provider ID for this gateway.');
    const provider:Provider={...previous,id:input.providerId,name:previous?.name||'LiteLLM',kind:'openai',baseUrl:input.baseUrl,apiKey:input.apiKey??(previous?.baseUrl===input.baseUrl?previous.apiKey:'')};
    try{
      const models=await listModels(provider,AbortSignal.timeout(15000));
      if(!models.length)throw httpError(400,'Connected, but this key has no available models. Check its model access in your LiteLLM gateway.');
      const current=store.settings(),latest=current.providers.find(p=>p.id===provider.id);
      if(JSON.stringify(latest)!==JSON.stringify(previous))throw httpError(409,'This provider changed while connecting. Try again.');
      if(!latest&&current.providers.length>=30)throw httpError(400,'Remove a provider before adding another.');
      store.saveSettings({providers:latest?current.providers.map(p=>p.id===provider.id?provider:p):[...current.providers,provider],...(!current.providers.some(p=>p.id===current.defaultProvider)?{defaultProvider:provider.id}:{})});
      modelCatalog.remember(provider,models);
      res.json({settings:publicSettings(),models,providerId:provider.id});
    }catch(error){res.status((error as {status?:number}).status||502).json({error:safeError(error,store)});}
  });
  app.post('/api/providers/test',async(req,res)=>{
    const{providerId}=z.object({providerId:z.string()}).parse(req.body);
    const provider=store.settings().providers.find(p=>p.id===providerId);if(!provider)throw httpError(404,'Provider not found.');
    if(provider.kind==='codex')modelCatalog.clear(provider.id);
    try{const models=await listModels(provider,AbortSignal.timeout(30000));if(provider.kind!=='codex')modelCatalog.remember(provider,models);res.json({ok:true,models:models.length});}catch(error){res.status(502).json({ok:false,error:safeError(error,store)});}
  });
  const checkArchitecture=(architecture: import('../shared/architectures.js').ArchitectureSelection)=>{
    architectureProviders(architecture).forEach(checkProvider);
    if(architecture.kind==='litefusion') {
      try {validateLiteFusion(architecture);}catch(error){throw httpError(400,error instanceof Error?error.message:'Invalid LiteFusion policy.');}
    }
  };
  const fusionEvaluations=new LiteFusionEvaluations(store);
  app.post('/api/sessions/:id/litefusion/evaluations',(req,res)=>{
    const session=store.session(req.params.id);
    if(store.isChild(session.id))throw httpError(404,'Session not found.');
    if(session.architecture?.kind!=='litefusion'&&!runner.tasks.list(session.id).length&&!runner.delegations.list(session.id).some(task=>task.litefusion))throw httpError(400,'This session has no LiteFusion history.');
    res.status(201).json(fusionEvaluations.record(session.id,evaluationSchema.parse(req.body)));
  });
  app.get('/api/litefusion/catalog',(_req,res)=>res.json({version:LITEFUSION_VERSION,roles:LITEFUSION_ROLES,models:LITEFUSION_MODELS}));
  app.get('/api/litefusion/preset',async(req,res)=>{
    const provider=store.settings().providers.find(p=>p.id===queryString(req.query.providerId));
    if(!provider||provider.kind==='codex')throw httpError(400,'Choose an API gateway for the LiteFusion preset.');
    let models=modelCatalog.snapshot(provider),discoveryError:string|undefined;
    try {const listed=await listModels(provider,AbortSignal.timeout(15000));modelCatalog.remember(provider,listed);models=listed;}
    catch(error){discoveryError=safeError(error,store);}
    const selection=liteFusionPreset(provider.id,models);
    res.json({selection,discoveryError,executionVerified:false});
  });
  app.post('/api/litefusion/routes',async(req,res)=>{
    // Setup may have discovered specialists before the user chooses a lead.
    const draft=req.body?.lead?.model===''?{...req.body,lead:undefined}:req.body;
    const selection=liteFusionSchema.parse(draft);checkArchitecture(selection);
    const discoveryError=await runner.liteFusionDiscovery.ensure(selection,store.settings().providers);
    const {version,hash,routes}=captureLiteFusion(selection,store.settings().providers);
    const lease=options.external?.capture(new AbortController().signal);try{res.json({version,hash,routes,readiness:{...liteFusionReadiness(routes,selection.lead),discoveryError},environment:liteFusionEnvironment(lease?.definitions??[]),executionVerified:false});}finally{lease?.release();}
  });
  app.get('/api/sessions/:id/litefusion/export',(req,res)=>{
    const session=store.session(req.params.id);
    if(store.isChild(session.id))throw httpError(404,'Session not found.');
    if(session.architecture?.kind!=='litefusion'&&!runner.tasks.list(session.id).length&&!runner.delegations.list(session.id).some(task=>task.litefusion))throw httpError(400,'This session has no LiteFusion history.');
    const assignments=runner.delegations.list(session.id);
    const turns=[...new Set(assignments.map(item=>item.parentTurnId))];
    for(const message of store.messages(session.id))if(message.role==='user'&&!turns.includes(message.id))turns.push(message.id);
    res.json({schemaVersion:1,sessionId:session.id,policyVersion:LITEFUSION_VERSION,selection:session.architecture,tasks:runner.tasks.list(session.id),assignments,turns:turns.map(id=>{const evaluations=fusionEvaluations.list(session.id,id);return {id,scheduling:runner.tasks.metrics(session.id,id),usage:runner.usage.turn(session.id,id),checks:store.messages(session.id).filter(message=>message.turnId===id).flatMap(message=>(message.toolCalls??[]).filter(call=>['verify','bash'].includes(call.name)).map(call=>({id:call.id,command:call.args.command,status:call.status,execution:call.execution}))),evaluation:evaluations.at(-1)??{success:null,source:null},evaluations};}),limitations:['Unreported costs remain unknown.','Worker completion is not an external success label.']});
  });
  const preferences=new WorkspacePreferences(store);
  const schedules=new Schedules(store,runner,bus);
  const scheduleFields=z.object({name:z.string().trim().min(1).max(120),prompt:z.string().trim().min(1).max(200000),workspace:z.string().min(1).max(4096),timing:scheduleTimingSchema,selection:sessionSchema.omit({title:true,workspace:true}).strict().optional()}).strict();
  const resolveSchedule=async(input:z.infer<typeof scheduleFields>)=>{
    const root=await workspace(input.workspace),settings=store.settings(),preferred=preferences.get(root);
    const selection={providerId:settings.defaultProvider,model:settings.defaultModel,mode:'build',permissionMode:settings.permissionMode,...preferred,...input.selection} as Record<string,unknown>;
    for(const key of ['setupComplete','architectureConfigurations'])delete selection[key];
    for(const key of ['architecture','planner','shunt','outputStyle'])if(selection[key]===null)delete selection[key];
    const parsed=sessionSchema.omit({title:true,workspace:true}).required({providerId:true,model:true,mode:true,permissionMode:true}).parse(selection);
    if(!parsed.providerId.trim()||!parsed.model.trim())throw httpError(400,'Choose a connected model before scheduling a task.');
    checkProvider(parsed.providerId);if(parsed.architecture)checkArchitecture(parsed.architecture);if(parsed.planner)checkProvider(parsed.planner.providerId);
    if(!shuntConfigured(parsed.shunt,settings.providers))throw httpError(400,'Choose an API-key Shunt model or turn Shunt off.');
    return {...input,workspace:root,selection:parsed as ScheduleSelection};
  };
  app.get('/api/schedules',(_req,res)=>res.json(schedules.list()));
  app.post('/api/schedules/preview',(req,res)=>{const{timing}=z.object({timing:scheduleTimingSchema}).strict().parse(req.body);res.json({nextRunAt:nextOccurrence(timing,Date.now())});});
  app.post('/api/schedules',async(req,res)=>{res.status(201).json(schedules.create(await resolveSchedule(scheduleFields.parse(req.body))));});
  app.patch('/api/schedules/:id',async(req,res)=>{
    const{expectedRevision,...patch}=scheduleFields.partial().extend({status:z.enum(['active','paused']).optional(),expectedRevision:z.number().int().min(0)}).strict().parse(req.body);
    const previous=schedules.get(req.params.id);
    const changed=Object.keys(patch).some(key=>key!=='status');
    const resolved=changed?await resolveSchedule({...previous,...patch}):undefined;
    res.json(schedules.update(req.params.id,expectedRevision,{...patch,...(resolved?{workspace:resolved.workspace,selection:resolved.selection}:{})} as Parameters<Schedules['update']>[2]));
  });
  app.delete('/api/schedules/:id',(req,res)=>{const revision=z.coerce.number().int().min(0).parse(req.query.revision);schedules.remove(req.params.id,revision);res.json({ok:true});});
  app.post('/api/schedules/:id/run',async(req,res)=>res.status(202).json(await schedules.runNow(req.params.id)));
  app.get('/api/workspace-preferences',async(req,res)=>res.json(preferences.get(await workspace(req.query.workspace))));
  app.post('/api/workspace-preferences',async(req,res)=>{
    const input=sessionSchema.required({providerId:true,model:true}).extend({setupComplete:z.boolean().optional(),architectureConfigurations:architectureConfigurationsSchema.optional()}).parse(req.body), root=await workspace(input.workspace);
    checkProvider(input.providerId);if(input.architecture)checkArchitecture(input.architecture);if(input.planner)checkProvider(input.planner.providerId);if(!shuntConfigured(input.shunt,store.settings().providers))throw httpError(400,'Choose an API-key Shunt model or turn Shunt off.');
    if(input.setupComplete&&!input.model.trim())throw httpError(400,'Choose a model to finish setup.');
    preferences.save(root,{...input,shunt:input.shunt??undefined,architecture:input.architecture??undefined,planner:input.planner??undefined,outputStyle:input.outputStyle??undefined},true);
    res.json({ok:true});
  });
  app.get('/api/task-search',async(req,res)=>{
    const input = z.object({ query: z.string().max(200).default(''), project: z.string().min(1).max(4096).optional(), includeArchived: z.enum(['true','false']).default('true').transform(value=>value==='true') }).strict().parse(req.query);
    res.setHeader('Cache-Control','no-store'); res.json(await runner.searchTasks(input,requestSignal(res)));
  });
  app.get('/api/sessions',(req,res)=>res.json({sessions:store.sessions(queryString(req.query.q),req.query.archived==='true')}));
  app.post('/api/sessions',async(req,res)=>{
    const {profile,...input}=sessionSchema.extend({profile:profileChoiceSchema.optional()}).parse(req.body||{});
    const nonempty=profile&&(profile.profileId!==null||profile.skillIds.length>0);
    if(nonempty&&(input.providerId!==undefined||input.model!==undefined)&&(!input.providerId?.trim()||!input.model?.trim()))throw httpError(400,'Specify both nonempty providerId and model when overriding profile defaults.');
    const session=await runner.prepareConfiguration(undefined,undefined,async signal=>{
      const root=await workspace(input.workspace);signal.throwIfAborted();
      return {root,resolved:profile?await resolveProfileChoice(root,profile,signal):undefined};
    },({root,resolved})=>{
      const defaults=resolved?.defaults,pair=input.providerId&&input.model?{providerId:input.providerId,model:input.model}:nonempty?defaults?.model:undefined;
      const {setupComplete: _setup, ...preferred}=preferences.get(root);
      const selection={...(nonempty?{}:preferred),...input,...pair,mode:input.mode??(nonempty?defaults?.mode:undefined),workspace:root};
      if(selection.mode===undefined)delete selection.mode;
      // planner:null means "no planner" on create; a set planner needs a real provider.
      if(!selection.planner)delete selection.planner;else checkProvider(selection.planner.providerId);
      if(!selection.shunt)delete selection.shunt;else if(!shuntConfigured(selection.shunt,store.settings().providers))throw httpError(400,'Choose an API-key Shunt model or turn Shunt off.');
      // architecture:null means "single model" on create; each role needs a real provider.
      if(!selection.architecture)delete selection.architecture;else checkArchitecture(selection.architecture);
      // outputStyle:null means "no style" on create, mirroring planner.
      if(!selection.outputStyle)delete selection.outputStyle;
      checkProvider(selection.providerId);
      const session=store.createSession(selection as Partial<Session>,resolved);preferences.save(root,session);return session;
    },requestSignal(res));
    res.status(201).json(session);
  });
  app.post('/api/sessions/import',async(req,res)=>{
    const imported=z.object({session:sessionSchema,messages:z.array(z.object({id:z.string(),role:z.enum(['user','assistant','tool','system']),content:z.string().max(500000),createdAt:z.number(),providerMetadata:z.record(z.string(),z.unknown()).optional(),reasoning:z.string().max(500000).optional(),toolCallId:z.string().optional(),toolCalls:z.array(z.object({id:z.string(),name:z.string(),args:z.record(z.string(),z.unknown()),status:z.enum(['pending','running','completed','error','denied']),output:z.string().optional()})).optional(),attachments:z.array(attachmentSchema).max(10).optional()})).max(10000)}).parse(req.body);
    // Imports are inert history: no tools execute and no imported path is opened.
    const settings=store.settings();
    // An imported planner or architecture may name a provider this install does not have; drop both.
    const session=store.createSession({...imported.session,shunt:undefined,planner:undefined,architecture:undefined,title:`${imported.session.title||'Session'} (imported)`.slice(0,200),workspace:settings.workspace,providerId:settings.providers.some(p=>p.id===imported.session.providerId)?imported.session.providerId:settings.defaultProvider,permissionMode:'ask'} as Partial<Session>);
    for(const message of imported.messages)store.saveMessage({...message,attachments:message.attachments?.map(({path: _path,...attachment})=>attachment),id:randomUUID(),sessionId:session.id} as Message);
    res.status(201).json(session);
  });
  app.get('/api/sessions/:id',async(req,res)=>{
    const discoveryError=await runner.refreshLiteFusion(req.params.id),readiness=runner.liteFusionStatus(req.params.id);
    res.json({litefusion:readiness?{...readiness,...(discoveryError?{discoveryError}:{})}:undefined,session:store.session(req.params.id),messages:runner.messages(req.params.id),todos:store.todos(req.params.id),permissions:runner.permissions(req.params.id),questions:runner.questions.pending(req.params.id),queue:store.queue(req.params.id),history:runner.history.state(req.params.id),tasks:runner.tasks.list(req.params.id),delegations:runner.delegations.list(req.params.id),jobs:runner.jobs.list(req.params.id),lastEventId:store.latestEventId(req.params.id) });
  });
  app.get('/api/sessions/:id/delegations',(req,res)=>res.json({delegations:runner.delegations.list(req.params.id)}));
  app.get('/api/sessions/:id/tasks/:taskId',(req,res)=>res.json(runner.tasks.get(req.params.id,req.params.taskId)));
  app.post('/api/sessions/:id/tasks/:taskId/cancel',async(req,res)=>res.json({task:await runner.cancelTask(req.params.id,req.params.taskId)}));
  app.get('/api/sessions/:id/delegations/:delegationId',(req,res)=>{
    const detail=runner.delegations.transcript(req.params.id,req.params.delegationId);
    res.json({...detail,todos:store.todos(detail.session.id),permissions:[],questions:[],queue:{items:[],paused:true},history:{hasCheckpoints:true,canUndo:false,canRedo:false}});
  });
  app.post('/api/sessions/:id/delegations/:delegationId/cancel',async(req,res)=>res.json({delegation:await runner.cancelDelegation(req.params.id,req.params.delegationId)}));
  app.get('/api/sessions/:id/delegations/:delegationId/events',(req,res)=>{
    const delegation=runner.delegations.get(req.params.id,req.params.delegationId),id=delegation.childSessionId;
    res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache, no-transform');res.setHeader('Connection','keep-alive');res.setHeader('X-Accel-Buffering','no');res.flushHeaders();
    const send=(event:any)=>{res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);};
    const cursor=Number(req.get('last-event-id')||req.query.after||0);if(Number.isFinite(cursor)&&cursor>0)for(const event of store.events(id,cursor))send(event);
    const unsubscribe=bus.subscribe(id,send);res.write(': connected\n\n');const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);heartbeat.unref();req.on('close',()=>{clearInterval(heartbeat);unsubscribe();});
  });
  app.get('/api/sessions/:id/profile',async(req,res)=>{
    const id=req.params.id,session=store.session(id),snapshot=store.profileSnapshot(id),signal=requestSignal(res);
    const source=snapshot?await profileSourceStatus(session.workspace,snapshot,signal):{status:'inactive' as const,diagnostics:[]};
    if((store.session(id).configRevision??0)!==(session.configRevision??0))throw httpError(409,'Session configuration changed. Refresh and try again.');
    res.json(profileDetail(snapshot,{status:source.status},source.diagnostics));
  });
  app.post('/api/sessions/:id/profile',async(req,res)=>{
    const id=req.params.id,input=z.object({expectedConfigRevision:configRevisionSchema,choice:profileChoiceSchema,selection:profileSelectionSchema.optional()}).strict().parse(req.body);
    const result=await runner.prepareConfiguration(id,input.expectedConfigRevision,signal=>resolveProfileChoice(store.session(id).workspace,input.choice,signal),resolved=>{
      checkProvider(input.selection?.providerId);
      const session=store.applyProfile(id,input.expectedConfigRevision,resolved,input.selection);
      const queue=store.queue(id);publishConfiguration(id);return{session,queue};
    },requestSignal(res));
    res.json(result);
  });
  app.patch('/api/sessions/:id',(req,res)=>{
    const {expectedConfigRevision,...patch}=sessionSchema.omit({workspace:true}).extend({archived:z.boolean().optional(),expectedConfigRevision:configRevisionSchema.optional()}).parse(req.body);
    // Setting or clearing the planner reroutes future Plan turns, so it follows
    // the exact model-change contract: idle-only, provider validated, queue held.
    // outputStyle rewrites the system prompt of future turns (session-constant
    // cached-prefix config), so it follows the same contract: idle-only PATCH,
    // revision bump in the store, queue held.
    const configChange=patch.shunt!==undefined||patch.modelReasoning!==undefined||patch.model!==undefined||patch.providerId!==undefined||patch.mode!==undefined||patch.permissionMode!==undefined||patch.commandSandbox!==undefined||patch.planner!==undefined||patch.architecture!==undefined||patch.outputStyle!==undefined;
    if(configChange){runner.assertIdle(req.params.id);runner.history.assertReady(req.params.id);}
    if(!shuntConfigured(patch.shunt,store.settings().providers))throw httpError(400,'Choose an API-key Shunt model or turn Shunt off.');
    checkProvider(patch.providerId);if(patch.planner)checkProvider(patch.planner.providerId);if(patch.architecture)checkArchitecture(patch.architecture);
    const session=store.updateSession(req.params.id,patch,expectedConfigRevision);
    const modelChange=patch.shunt!==undefined||patch.modelReasoning!==undefined||patch.model!==undefined||patch.providerId!==undefined||patch.planner!==undefined||patch.architecture!==undefined||patch.outputStyle!==undefined;
    if(configChange){preferences.save(session.workspace,session,modelChange);publishConfiguration(req.params.id);}res.json(session);
  });
  // A complete architecture configuration can be staged while work runs.
  // Permissions/mode/workspace remain outside this endpoint and idle-only.
  app.put('/api/sessions/:id/architecture',(req,res)=>{
    const input=sessionSchema.pick({providerId:true,model:true,architecture:true,planner:true,shunt:true,modelReasoning:true,outputStyle:true}).required({providerId:true,model:true,architecture:true}).extend({expectedConfigRevision:configRevisionSchema,expectedPendingId:z.string().nullable().optional()}).strict().parse(req.body);
    const {expectedConfigRevision,expectedPendingId,...value}=input;
    if((store.session(req.params.id).pendingArchitecture?.id??null)!==(expectedPendingId??null))throw httpError(409,'The pending architecture changed. Refresh and review it before saving.');
    checkProvider(value.providerId);if(value.architecture)checkArchitecture(value.architecture);if(value.planner)checkProvider(value.planner.providerId);
    if(!shuntConfigured(value.shunt,store.settings().providers))throw httpError(400,'Choose an API-key Shunt model or turn Shunt off.');
    const configuration=architectureConfiguration({...value,architecture:value.architecture??undefined,planner:value.planner??undefined,shunt:value.shunt??undefined,outputStyle:value.outputStyle??undefined});
    if(runner.active(req.params.id)) {
      const session=store.updateSession(req.params.id,{pendingArchitecture:{id:randomUUID(),requestedAt:Date.now(),expectedRevision:expectedConfigRevision,configuration}},expectedConfigRevision);
      publishConfiguration(session.id);res.status(202).json(session);return;
    }
    runner.assertIdle(req.params.id);runner.history.assertReady(req.params.id);
    const session=store.updateSession(req.params.id,{...configuration,pendingArchitecture:undefined},expectedConfigRevision);
    preferences.save(session.workspace,session,true);publishConfiguration(session.id);res.json(session);
  });
  app.delete('/api/sessions/:id',async(req,res)=>{runner.assertIdle(req.params.id);runner.deleteSessionJobs(req.params.id);await Promise.all([runner.browsers.closeSession(req.params.id),runner.computers.closeSession(req.params.id)]);store.deleteSession(req.params.id);runner.removeFromSearchIndex(req.params.id);res.json({ok:true});});
  const memory=new Memory(store);
  const memoryWorkspace=(value:unknown)=>{const workspace=queryString(value);if(!workspace.trim())throw httpError(400,'workspace is required.');return workspace;};
  app.get('/api/memory',(req,res)=>res.json({facts:memory.list(memoryWorkspace(req.query.workspace))}));
  app.delete('/api/memory/:name',(req,res)=>res.json({removed:memory.forget(memoryWorkspace(req.query.workspace),req.params.name)}));
  // 5.4 activation tier: pin/unpin one fact. 404 for unknown names, 409 at the
  // 10-pin cap — the Memory core owns both rules; this route only validates shape.
  app.patch('/api/memory/:name',(req,res)=>{
    const {pinned}=z.object({pinned:z.boolean()}).strict().parse(req.body);
    res.json({fact:memory.setPinned(memoryWorkspace(req.query.workspace),req.params.name,pinned)});
  });
  // 5.7 output styles: enumerate workspace .litespeed/styles/*.md names for the
  // picker. Advisory read-only listing; builtins are a client-side constant.
  app.get('/api/styles',async(req,res)=>res.json({styles:await listWorkspaceStyles(await workspace(req.query.workspace))}));
  app.get('/api/sessions/:id/events',(req,res)=>{
    const id=req.params.id;store.session(id);
    res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache, no-transform');res.setHeader('Connection','keep-alive');res.setHeader('X-Accel-Buffering','no');res.flushHeaders();
    const send=(event:any)=>{res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);};
    // Snapshot is fetched separately; only reconnects replay from a cursor.
    const cursor=Number(req.get('last-event-id')||req.query.after||0);
    if(Number.isFinite(cursor)&&cursor>0)for(const event of store.events(id,cursor))send(event);
    const unsubscribe=bus.subscribe(id,send);res.write(': connected\n\n');
    const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);heartbeat.unref();
    req.on('close',()=>{clearInterval(heartbeat);unsubscribe();});
  });
  const snapshotInput=async(id:string,body:unknown,surface:unknown)=>{
    const {skills,...input}=inputSchema.parse(body),session=store.session(id);
    if (session.worktree?.removed) throw httpError(409, 'This working copy was removed. Open the original project or create another worktree to continue.');
    // Recalled skill attachments are display snapshots, never instructions to trust on a new send.
    input.attachments=(input.attachments??[]).filter(attachment=>!attachment.skillId);
    const invoked=await snapshotSkillInvocation(session.workspace,skills);
    if(!input.content.trim()&&!input.attachments.length&&!invoked.length)throw httpError(400,'A message or attachment is required.');
    if(input.attachments.length+invoked.length>10)throw httpError(400,'A message can have up to 10 files and skills combined.');
    for (let index = 0; index < input.attachments.length; index++) input.attachments[index] = await snapshotFileAttachment(session.workspace, input.attachments[index]);
    return {...input,attachments:[...input.attachments,...invoked],clientSurface:clientSurface(surface)};
  };
  app.post('/api/sessions/:id/messages',async(req,res)=>{
    const messageId=await runner.submit(req.params.id,()=>snapshotInput(req.params.id,req.body,req.get('X-Litespeed-Client')));
    res.status(202).json({ok:true,messageId});
  });
  app.get('/api/sessions/:id/queue',(req,res)=>res.json(store.queue(req.params.id)));
  app.post('/api/sessions/:id/queue',async(req,res)=>{
    const queue=await runner.submitQueued(req.params.id,()=>snapshotInput(req.params.id,req.body,req.get('X-Litespeed-Client')));
    res.status(202).json(queue);
  });
  app.delete('/api/sessions/:id/queue/:queueId',(req,res)=>res.json(runner.removeQueued(req.params.id,req.params.queueId)));
  app.post('/api/sessions/:id/queue/recall',(req,res)=>{
    const {ids}=z.object({ids:z.array(z.string().min(1).max(128)).min(1).max(20)}).strict().parse(req.body);
    res.json(runner.recallQueued(req.params.id,ids));
  });
  app.post('/api/sessions/:id/queue/:queueId/steer',(req,res)=>res.status(202).json(runner.steer(req.params.id,'',req.params.queueId,clientSurface(req.get('X-Litespeed-Client')))));
  // Mid-turn steering: unlike /queue (waits for the run to end), a steering note
  // is delivered between steps of the ACTIVE response. Child ids are already
  // rejected by the app-level child guard above; the runner 409s when idle.
  app.post('/api/sessions/:id/steer',async(req,res)=>{
    const input=z.object({content:z.string().trim().min(1).max(4000),skills:skillInvocationSchema.optional()}).parse(req.body);
    await runner.submitSteering(req.params.id,()=>snapshotInput(req.params.id,input,req.get('X-Litespeed-Client')));
    res.status(202).json({ok:true});
  });
  // GOAL MODE: set one session objective pursued across host-continued turns.
  // Idle-only (runner.assertIdle inside setGoal/clearGoal); 409 while a run is
  // active or another goal is still 'active'. Goal text is a USER instruction.
  app.post('/api/sessions/:id/goal',(req,res)=>{
    const input=z.object({text:z.string().min(1).max(2000),maxTurns:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional()}).strict().parse(req.body);
    res.json(runner.setGoal(req.params.id,input.text,input.maxTurns));
  });
  app.delete('/api/sessions/:id/goal',(req,res)=>res.json(runner.clearGoal(req.params.id)));
  app.post('/api/sessions/:id/queue/pause',(req,res)=>res.json(runner.pauseQueue(req.params.id)));
  app.post('/api/sessions/:id/queue/resume',(req,res)=>res.json(runner.resumeQueue(req.params.id)));
  app.post('/api/sessions/:id/cancel',(req,res)=>{runner.cancel(req.params.id);res.json({ok:true});});
  app.post('/api/sessions/:id/interrupt',(req,res)=>{
    const {turnId}=z.object({turnId:z.string().min(1).max(128)}).strict().parse(req.body);
    runner.interrupt(req.params.id,turnId);res.json({ok:true});
  });
  app.patch('/api/sessions/:id/permission-mode',(req,res)=>{
    const {permissionMode,expectedConfigRevision}=z.object({permissionMode:z.enum(['ask','edit','auto']),expectedConfigRevision:configRevisionSchema}).strict().parse(req.body);
    res.json(runner.setPermissionMode(req.params.id,permissionMode,expectedConfigRevision));
  });
  app.post('/api/sessions/:id/permissions/:requestId',(req,res)=>{const{decision}=z.object({decision:z.enum(['allow','always','project','deny'])}).parse(req.body);runner.decide(req.params.id,req.params.requestId,decision);res.json({ok:true});});
  app.get('/api/sessions/:id/questions',(req,res)=>res.json({questions:runner.questions.pending(req.params.id)}));
  app.post('/api/sessions/:id/questions/:questionId/answer',(req,res)=>res.json(runner.questions.answer(req.params.id,req.params.questionId,req.body)));
  app.get('/api/sessions/:id/tool-grants',(req,res)=>res.json({tools:[...new Set(store.toolGrants(req.params.id).map(g=>g.tool))]}));
  app.delete('/api/sessions/:id/tool-grants',(req,res)=>{store.clearToolGrants(req.params.id);res.json({ok:true});});
  app.post('/api/sessions/:id/fork',(req,res)=>{runner.assertIdle(req.params.id);const input=z.object({messageId:z.string().optional()}).parse(req.body||{});res.status(201).json(store.fork(req.params.id,input.messageId));});
  app.post('/api/sessions/:id/compact',async(req,res)=>{await runner.compact(req.params.id);res.json({ok:true});});
  app.get('/api/sessions/:id/export',(req,res)=>{const id=req.params.id;res.setHeader('Content-Disposition',`attachment; filename="litespeed-session-${id}.json"`);res.json({session:store.session(id),messages:store.messages(id),todos:store.todos(id)});});
  const browserSession = (id: string) => { const session = store.session(id); if (store.isChild(id)) throw httpError(404, 'Session not found.'); return session; };
  app.get('/api/browser/history', async(req,res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await runner.browsers.history.list(queryString(req.query.q).slice(0, 500), req.query.limit ? z.coerce.number().int().min(1).max(100).parse(req.query.limit) : 100)); });
  app.delete('/api/browser/history', async(req,res) => { z.object({ confirm: z.literal(true) }).strict().parse(req.body); await runner.browsers.history.clear(); res.json({ ok: true }); });
  app.delete('/api/browser/history/:entryId', async(req,res) => { await runner.browsers.history.clear(z.uuid().parse(req.params.entryId)); res.json({ ok: true }); });
  app.post('/api/browser/reset', async(req,res) => { z.object({ confirm: z.literal(true) }).strict().parse(req.body); await runner.resetBrowser(); res.json({ ok: true }); });
  app.get('/api/sessions/:id/browser', async(req,res) => { browserSession(req.params.id); res.json(await runner.browsers.state(req.params.id)); });
  app.get('/api/sessions/:id/browser/frame', async(req,res) => {
    browserSession(req.params.id);
    const frame = await runner.browsers.frame(req.params.id, queryString(req.query.tabId) || undefined);
    res.setHeader('Cache-Control', 'no-store');
    if (!frame) return res.status(204).end();
    res.type('image/jpeg').send(frame);
  });
  app.get('/api/sessions/:id/browser/stream', async(req,res) => {
    browserSession(req.params.id);
    const tabId = z.string().min(1).max(64).parse(queryString(req.query.tabId));
    let stopped = false, blocked = false, queued: BrowserFrame | undefined, unsubscribe: (() => void) | null = null;
    const stop = () => { stopped = true; queued = undefined; unsubscribe?.(); clearInterval(heartbeat); };
    const send = (frame: BrowserFrame) => {
      if (stopped) return;
      if (blocked) { queued = frame; return; }
      blocked = !res.write(`data: ${JSON.stringify(frame)}\n\n`);
    };
    const heartbeat = setInterval(() => { if (!stopped && !blocked) blocked = !res.write(': live\n\n'); }, 15000); heartbeat.unref();
    res.on('close', stop); res.on('drain', () => { blocked = false; if (queued) { const latest = queued; queued = undefined; send(latest); } });
    res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-store, no-transform'); res.setHeader('X-Accel-Buffering', 'no');
    try {
      unsubscribe = await runner.browsers.stream(req.params.id, tabId, send, () => { if (!stopped) { res.write('event: suspended\ndata: {}\n\n'); res.end(); } });
      if (stopped) unsubscribe?.();
      else if (!unsubscribe) { stop(); res.status(204).end(); }
      else res.flushHeaders();
    } catch (error) { stop(); if (res.headersSent) res.end(); else throw error; }
  });
  app.get('/api/browser/download-directory', (_req,res) => res.json({ defaultDirectory: defaultDownloadDirectory() }));
  app.post('/api/sessions/:id/browser/downloads/:downloadId/save', async(req,res) => {
    browserSession(req.params.id); runner.assertIdle(req.params.id);
    res.json(await runner.browsers.downloads.save(req.params.id, req.params.downloadId, runner.browsers.preferences().downloadDirectory, requestSignal(res)));
  });
  app.get('/api/sessions/:id/browser/downloads/:downloadId', async(req,res) => {
    browserSession(req.params.id);
    const { item, data } = await runner.browsers.downloads.read(req.params.id, req.params.downloadId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(item.name).replace(/['()*]/g, value => '%' + value.charCodeAt(0).toString(16).toUpperCase())}`);
    res.type('application/octet-stream').send(data);
  });
  app.delete('/api/sessions/:id/browser/downloads/:downloadId', async(req,res) => {
    browserSession(req.params.id); runner.assertIdle(req.params.id);
    await runner.browsers.downloads.remove(req.params.id, req.params.downloadId); res.json({ ok: true });
  });
  app.post('/api/sessions/:id/browser/inspect', async(req,res) => {
    const session = browserSession(req.params.id); runner.assertIdle(req.params.id);
    if (session.archived) throw httpError(409, 'Restore this task before adjusting its browser page.');
    res.setHeader('Cache-Control', 'no-store');
    res.json(await runner.browserInspection(req.params.id, req.body, requestSignal(res)));
  });
  app.post('/api/sessions/:id/browser/selection', async(req,res) => {
    const session = browserSession(req.params.id); runner.assertIdle(req.params.id);
    if (session.archived) throw httpError(409, 'Restore this task before reading its browser selection.');
    res.setHeader('Cache-Control', 'no-store');
    res.json(await runner.browserSelection(req.params.id, browserSelectionSchema.parse(req.body), requestSignal(res)));
  });
  app.post('/api/sessions/:id/browser/upload', async(req,res) => {
    const session = browserSession(req.params.id); runner.assertIdle(req.params.id);
    if (session.archived) throw httpError(409, 'Restore this task before sharing files with its browser.');
    res.setHeader('Cache-Control', 'no-store');
    res.json(await runner.browserUpload(req.params.id, browserUploadSchema.parse(req.body), requestSignal(res)));
  });
  app.post('/api/sessions/:id/browser', async(req,res) => {
    const session = browserSession(req.params.id); runner.assertIdle(req.params.id);
    if (session.archived) throw httpError(409, 'Restore this task before using its browser.');
    const result = await runner.browserInteraction(req.params.id, browserActionSchema.parse(req.body), requestSignal(res));
    res.json({ ...result.state, busy: false });
  });
  app.post('/api/sessions/:id/browser/stop', async(req,res) => {
    const session = browserSession(req.params.id);
    if (session.archived) throw httpError(409, 'Restore this task before using its browser.');
    res.setHeader('Cache-Control', 'no-store');
    res.json(await runner.stopBrowserLoading(req.params.id, browserStopSchema.parse(req.body)));
  });
  app.get('/api/sessions/:id/browser/diagnostics', async(req,res) => {
    browserSession(req.params.id); const tabId = z.string().min(1).max(64).parse(req.query.tabId);
    res.setHeader('Cache-Control', 'no-store'); res.json(await runner.browsers.diagnostics(req.params.id, tabId));
  });
  app.delete('/api/sessions/:id/browser/diagnostics', async(req,res) => {
    const session = browserSession(req.params.id), input = z.object({ tabId: z.string().min(1).max(64), view: z.enum(['console', 'network', 'all']) }).strict().parse(req.body);
    if (session.archived) throw httpError(409, 'Restore this task before clearing its browser activity.');
    res.json(await runner.exclusive(req.params.id, () => runner.browsers.clearDiagnostics(req.params.id, input.tabId, input.view)));
  });
  app.get('/api/sessions/:id/computer', (req,res) => { browserSession(req.params.id); res.json(runner.computers.state(req.params.id)); });
  app.get('/api/sessions/:id/computer/frame', (req,res) => {
    browserSession(req.params.id);
    const frame = runner.computers.frame(req.params.id, queryString(req.query.snapshotId));
    res.setHeader('Cache-Control', 'no-store');
    if (!frame) { res.status(204).end(); return; }
    res.type('image/png').send(frame);
  });
  app.post('/api/sessions/:id/computer', async(req,res) => {
    const session = browserSession(req.params.id); runner.assertIdle(req.params.id);
    if (session.archived) throw httpError(409, 'Restore this task before using its computer view.');
    const result = await runner.computerInteraction(req.params.id, computerActionSchema.parse(req.body), requestSignal(res));
    res.json(result.state);
  });
  app.get('/api/files',async(req,res)=>res.json({entries:await listFiles(await workspace(req.query.workspace),queryString(req.query.path))}));
  app.get('/api/file',async(req,res)=>res.json(await readFile(await workspace(req.query.workspace),queryString(req.query.path))));
  app.get('/api/file-preview',async(req,res)=>res.json(await filePreview(await workspace(req.query.workspace),queryString(req.query.path))));
  app.get('/api/file-content',async(req,res)=>{
    const asset=await readPreviewAsset(await workspace(req.query.workspace),queryString(req.query.path));
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(asset.path.split('/').at(-1)!)}`);
    res.type(asset.mimeType).send(asset.data);
  });
  app.get('/api/search',async(req,res)=>res.json({files:await searchFiles(await workspace(req.query.workspace),queryString(req.query.q))}));
  app.get('/api/git',async(req,res)=>res.json(await gitStatus(await workspace(req.query.workspace))));
  const gitReviewQuery=z.object({workspace:z.string().max(4096).optional(),scope:z.enum(['unstaged','staged','branch']).default('unstaged'),base:z.string().min(1).max(256).optional()});
  const pullRequests = new PullRequests(options.pullRequestTransport);
  const pullRequestCheckouts = new PullRequestCheckouts(store, pullRequests, options.pullRequestFetcher);
  app.get('/api/pull-requests', async(req,res) => {
    const input = z.object({ workspace: z.string().max(4096).optional(), state: z.enum(['open', 'closed', 'all']).default('open'), page: z.coerce.number().int().min(1).max(100).default(1) }).parse(req.query);
    res.json(await pullRequests.list(await workspace(input.workspace), input.state, input.page, requestSignal(res)));
  });
  app.get('/api/pull-requests/:number', async(req,res) => {
    const id = z.coerce.number().int().positive().max(2_147_483_647).parse(req.params.number);
    res.json(await pullRequests.detail(await workspace(req.query.workspace), id, requestSignal(res)));
  });
  app.post('/api/pull-requests/:number/discussion', async(req,res) => {
    const id = z.coerce.number().int().positive().max(2_147_483_647).parse(req.params.number);
    const input = z.object({ workspace: z.string().max(4096), revision: z.string().regex(/^[a-f0-9]{64}$/), providerId: z.string().min(1).max(64), model: z.string().min(1).max(250) }).strict().parse(req.body);
    checkProvider(input.providerId);
    const result = await runner.prepareConfiguration(undefined, undefined, async signal => {
      const root = await workspace(input.workspace), detail = await pullRequests.detail(root, id, signal);
      if (detail.revision !== input.revision) throw httpError(409, 'The pull request changed since you opened it. Refresh its changes before starting a discussion.');
      return { root, detail };
    }, ({ root, detail }) => ({
      session: store.createSession({ workspace: root, title: `Review #${id}: ${detail.title}`.slice(0, 200), providerId: input.providerId, model: input.model, mode: 'plan', permissionMode: 'ask' }),
      draft: pullRequestDiscussion(detail),
    }), requestSignal(res));
    res.status(201).json(result);
  });
  app.post('/api/pull-requests/:number/worktree/prepare', async(req,res) => {
    const id = z.coerce.number().int().positive().max(2_147_483_647).parse(req.params.number);
    const input = z.object({ workspace: z.string().min(1).max(4096), revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(req.body), root = await workspace(input.workspace);
    res.json(await runner.workspaceOperation(root, signal => pullRequestCheckouts.prepare(root, id, input.revision, signal), requestSignal(res)));
  });
  app.post('/api/pull-requests/:number/worktree', async(req,res) => {
    const id = z.coerce.number().int().positive().max(2_147_483_647).parse(req.params.number);
    const input = z.object({ workspace: z.string().min(1).max(4096), planId: z.string().uuid(), providerId: z.string().min(1).max(64), model: z.string().min(1).max(250) }).strict().parse(req.body), root = await workspace(input.workspace);
    checkProvider(input.providerId);
    const result = await runner.workspaceOperation(root, async signal => {
      const { worktree, request } = await pullRequestCheckouts.create(root, id, input.planId, signal);
      const session = store.createSession({ workspace: worktree.path, title: `Review #${id}: ${request.title}`.slice(0, 200), providerId: input.providerId, model: input.model, mode: 'plan', permissionMode: 'ask' });
      return { worktree, session, draft: pullRequestCheckoutDraft(request) };
    }, requestSignal(res));
    res.status(201).json(result);
  });
  const gitActions = new GitActions();
  const gitBranches = new GitBranchesService();
  const taskWorktrees = new TaskWorktrees(store, runner.history);
  const taskLocals = new TaskLocals(store, runner.history);
  async function localTaskOperation<T>(id: string, operation: (signal: AbortSignal) => Promise<T>, signal: AbortSignal) {
    const session = store.session(id), project = session.worktree?.project;
    if (!project || session.worktree?.removed) throw httpError(409, 'Choose an available worktree task to continue locally.');
    if (options.workspaceHasTerminal?.(session.workspace) || options.workspaceHasTerminal?.(project)) throw httpError(409, 'Close terminals in the worktree and local project before moving this task.');
    return runner.workspaceOperation(project, signal => runner.taskWorkspaceOperation(id, operation, signal), signal);
  }
  app.post('/api/sessions/:id/local/prepare', async(req,res) => {
    const id = z.string().uuid().parse(req.params.id), input = z.object({ expectedConfigRevision: z.number().int().nonnegative() }).strict().parse(req.body);
    res.json(await localTaskOperation(id, signal => taskLocals.prepare(id, input.expectedConfigRevision, signal), requestSignal(res)));
  });
  app.post('/api/sessions/:id/local', async(req,res) => {
    const id = z.string().uuid().parse(req.params.id), input = z.object({ planId: z.string().uuid() }).strict().parse(req.body);
    res.json(await localTaskOperation(id, async signal => {
      const result = await taskLocals.apply(id, input.planId, signal);
      publishConfiguration(id); try { bus.emit(id, 'history', runner.history.state(id)); bus.emit(id, 'message', store.messages(id).at(-1)!); } catch { console.error('Could not publish local continuation. Refresh to read the saved task.'); }
      return result;
    }, requestSignal(res)));
  });
  app.post('/api/sessions/:id/worktree/prepare', async(req,res) => {
    const id = z.string().uuid().parse(req.params.id), input = z.object({ name: worktreeName, includeLocalSetup: z.boolean().default(false), expectedConfigRevision: z.number().int().nonnegative() }).strict().parse(req.body);
    if (options.workspaceHasTerminal?.(store.session(id).workspace)) throw httpError(409, 'Close this project’s terminals before moving its task.');
    res.json(await runner.taskWorkspaceOperation(id, signal => taskWorktrees.prepare(id, input.name, input.includeLocalSetup, input.expectedConfigRevision, signal), requestSignal(res)));
  });
  app.post('/api/sessions/:id/worktree', async(req,res) => {
    const id = z.string().uuid().parse(req.params.id), input = z.object({ planId: z.string().uuid() }).strict().parse(req.body);
    const result = await runner.taskWorkspaceOperation(id, async signal => {
      if (options.workspaceHasTerminal?.(store.session(id).workspace)) throw httpError(409, 'Close this project’s terminals before moving its task.');
      const moved = await taskWorktrees.apply(id, input.planId, signal);
      publishConfiguration(id); try { bus.emit(id, 'history', runner.history.state(id)); bus.emit(id, 'message', store.messages(id).at(-1)!); } catch { console.error('Could not publish task move. Refresh to read the saved state.'); }
      return moved;
    }, requestSignal(res));
    res.json(result);
  });
  app.get('/api/worktrees', async(req,res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ worktrees: store.worktrees.list(queryString(req.query.workspace) || undefined, req.query.includeRemoved === 'true') });
  });
  app.post('/api/worktrees/prepare', async(req,res) => {
    const input = z.object({ workspace: z.string().min(1).max(4096), name: worktreeName, includeLocalEdits: z.boolean().optional(), includeLocalSetup: z.boolean().optional(), startingRef: worktreeStartingRef.optional() }).strict().parse(req.body), root = await workspace(input.workspace);
    res.json(await runner.workspaceOperation(root, signal => store.worktrees.prepare(root, input.name, signal, undefined, input.includeLocalEdits, input.includeLocalSetup, input.startingRef), requestSignal(res)));
  });
  app.post('/api/worktrees/create', async(req,res) => {
    const input = z.object({ workspace: z.string().min(1).max(4096), id: z.string().uuid(), providerId: z.string().min(1).max(64), model: z.string().min(1).max(250) }).strict().parse(req.body), root = await workspace(input.workspace);
    checkProvider(input.providerId);
    const result = await runner.workspaceOperation(root, async signal => {
      const worktree = await store.worktrees.create(root, input.id, signal);
      const session = store.createSession({ workspace: worktree.path, worktree: store.worktrees.metadata(worktree), title: worktree.name.replaceAll('-', ' '), providerId: input.providerId, model: input.model, mode: 'build', permissionMode: 'ask' });
      return { worktree, session };
    }, requestSignal(res));
    res.status(201).json(result);
  });
  app.post('/api/worktrees/:id/tasks', async(req,res) => {
    const id = z.string().uuid().parse(req.params.id), input = z.object({ providerId: z.string().min(1).max(64), model: z.string().min(1).max(250) }).strict().parse(req.body);
    checkProvider(input.providerId);
    const result = await runner.workspaceOperation(store.worktrees.get(id).path, async signal => {
      const worktree = await store.worktrees.ready(id, signal);
      return store.createSession({ workspace: worktree.path, worktree: store.worktrees.metadata(worktree), title: 'New task', providerId: input.providerId, model: input.model, mode: 'build', permissionMode: 'ask' });
    }, requestSignal(res));
    res.status(201).json(result);
  });
  app.post('/api/worktrees/:id/remove/prepare', async(req,res) => {
    const id = z.string().uuid().parse(req.params.id), record = store.worktrees.get(id);
    if (options.workspaceHasTerminal?.(record.path)) throw httpError(409, 'Close this worktree’s terminals before removing it.');
    res.json(await runner.workspaceOperation(record.path, signal => store.worktrees.prepareRemove(id, signal), requestSignal(res)));
  });
  app.post('/api/worktrees/:id/recover', async(req,res) => {
    const id = z.string().uuid().parse(req.params.id), record = store.worktrees.get(id);
    res.json(await runner.workspaceOperation(record.path, async signal => { const recovered = await store.worktrees.recover(id, signal); for (const session of [...store.sessions(), ...store.sessions('', true)]) if (session.workspace === record.path) publishConfiguration(session.id); return recovered; }, requestSignal(res)));
  });
  app.post('/api/worktrees/:id/restore/prepare', async(req,res) => {
    const id = z.string().uuid().parse(req.params.id), record = store.worktrees.get(id, true);
    res.json(await runner.workspaceOperation(record.project, signal => store.worktrees.prepareRestore(id, signal), requestSignal(res)));
  });
  app.post('/api/worktrees/:id/restore', async(req,res) => {
    const id = z.string().uuid().parse(req.params.id), input = z.object({ planId: z.string().uuid() }).strict().parse(req.body), record = store.worktrees.get(id, true);
    const result = await runner.workspaceOperation(record.project, signal => runner.workspaceOperation(record.path, async () => {
      if (options.workspaceHasTerminal?.(record.path)) throw httpError(409, 'Close this worktree’s terminals before restoring it.');
      const worktree = await store.worktrees.restore(id, input.planId, signal);
      const sessions = [...store.sessions(), ...store.sessions('', true)].filter(session => session.workspace === record.path);
      for (const session of sessions) publishConfiguration(session.id);
      return { worktree, sessions };
    }, signal), requestSignal(res));
    res.json(result);
  });
  app.post('/api/worktrees/:id/remove', async(req,res) => {
    const id = z.string().uuid().parse(req.params.id), input = z.object({ planId: z.string().uuid() }).strict().parse(req.body), record = store.worktrees.get(id);
    const result = await runner.workspaceOperation(record.project, signal => runner.workspaceOperation(record.path, async () => {
      if (options.workspaceHasTerminal?.(record.path)) throw httpError(409, 'Close this worktree’s terminals before removing it.');
      const removed = await store.worktrees.remove(id, input.planId, signal);
      for (const session of [...store.sessions(), ...store.sessions('', true)]) if (session.workspace === record.path) publishConfiguration(session.id);
      return removed;
    }, signal), requestSignal(res));
    res.json(result);
  });
  app.get('/api/git/branches', async(req,res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await gitBranches.list(await workspace(req.query.workspace), requestSignal(res)));
  });
  app.post('/api/git/branches/prepare', async(req,res) => {
    const input = z.object({ workspace: z.string().max(4096).optional(), request: gitBranchRequestSchema }).strict().parse(req.body), root = await workspace(input.workspace);
    res.json(await runner.workspaceOperation(root, signal => gitBranches.prepare(root, input.request, signal), requestSignal(res)));
  });
  app.post('/api/git/branches/apply', async(req,res) => {
    const input = z.object({ workspace: z.string().max(4096).optional(), id: z.string().uuid() }).strict().parse(req.body), root = await workspace(input.workspace);
    res.json(await runner.workspaceOperation(root, signal => gitBranches.apply(root, input.id, signal), requestSignal(res)));
  });
  app.post('/api/git/actions/prepare', async(req,res) => {
    const input = z.object({ workspace: z.string().max(4096).optional(), action: z.enum(['stage','unstage','commit','push']), paths: z.array(z.string().min(1).max(4096)).min(1).max(500).optional() }).strict().parse(req.body);
    const root = await workspace(input.workspace);
    res.json(await runner.workspaceOperation(root, signal => gitActions.prepare(root, input.action, input.paths, signal), requestSignal(res)));
  });
  app.post('/api/git/actions/apply', async(req,res) => {
    const input = z.object({ workspace: z.string().max(4096).optional(), id: z.string().uuid(), message: z.string().max(10_000).optional() }).strict().parse(req.body);
    const root = await workspace(input.workspace);
    res.json(await runner.workspaceOperation(root, signal => gitActions.apply(root, input.id, input.message, signal), requestSignal(res)));
  });
  const gitDiscards = new GitDiscards(store);
  const discardWorkspace = z.object({ workspace: z.string().max(4096).optional() });
  const discardPaths = z.array(z.string().min(1).max(4096)).min(1).max(100);
  app.get('/api/git/discards', async(req,res) => {
    const all = z.enum(['true', 'false']).optional().parse(req.query.all);
    res.json({ backups: gitDiscards.list(all === 'true' ? undefined : await workspace(req.query.workspace)) });
  });
  app.post('/api/git/discards/prepare', async(req,res) => {
    const input = discardWorkspace.extend({ paths: discardPaths }).strict().parse(req.body), root = await workspace(input.workspace);
    res.json(await runner.workspaceOperation(root, signal => gitDiscards.prepare(root, input.paths, signal), requestSignal(res)));
  });
  app.post('/api/git/discards/apply', async(req,res) => {
    const input = discardWorkspace.extend({ id: z.string().uuid() }).strict().parse(req.body), root = await workspace(input.workspace);
    res.json(await runner.workspaceOperation(root, signal => gitDiscards.apply(root, input.id, signal), requestSignal(res)));
  });
  app.post('/api/git/discards/:id/restore', async(req,res) => {
    const id = z.string().uuid().parse(req.params.id), input = discardWorkspace.extend({ paths: discardPaths.optional() }).strict().parse(req.body);
    const root = await workspace(input.workspace).catch(error => { if (error.code === 'ENOENT') throw httpError(409, 'This project folder is unavailable. Save the original copies, or reopen the project at its saved location before restoring.'); throw error; });
    res.json(await runner.workspaceOperation(root, signal => gitDiscards.prepareRestore(root, id, input.paths, signal), requestSignal(res)));
  });
  app.get('/api/git/discards/:id/original', async(req,res) => {
    const id = z.string().uuid().parse(req.params.id), path = z.string().min(1).max(4096).parse(queryString(req.query.path));
    const root = resolve(z.string().min(1).max(4096).parse(queryString(req.query.workspace)));
    const data = gitDiscards.original(root, id, path), name = path.split('/').at(-1)!;
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, value => '%' + value.charCodeAt(0).toString(16).toUpperCase())}`);
    res.type('application/octet-stream').send(data);
  });
  app.delete('/api/git/discards/:id', async(req,res) => {
    const id = z.string().uuid().parse(req.params.id), input = discardWorkspace.extend({ workspace: z.string().min(1).max(4096), confirm: z.literal(true) }).strict().parse(req.body), root = resolve(input.workspace);
    await runner.workspaceOperation(root, async () => gitDiscards.remove(root, id), requestSignal(res)); res.json({ ok: true });
  });
  app.get('/api/git/review',async(req,res)=>{const input=gitReviewQuery.parse(req.query);res.json(await gitReview(await workspace(input.workspace),input.scope,input.base,requestSignal(res)));});
  app.get('/api/git/diff',async(req,res)=>{const input=gitReviewQuery.extend({path:z.string().min(1).max(4096)}).parse(req.query);res.json(await gitFileDiff(await workspace(input.workspace),input.scope,input.path,input.base,requestSignal(res)));});
  app.get('/api/sessions/:id/changes',(req,res)=>{store.session(req.params.id);res.json({changes:store.changes(req.params.id)});});
  app.get('/api/sessions/:id/history',(req,res)=>res.json(runner.history.state(req.params.id)));
  const publishHistory=(id:string)=>{
    bus.emit(id,'reset',{messages:store.messages(id),delegations:runner.delegations.list(id)});
    bus.emit(id,'todos',store.todos(id));bus.emit(id,'queue',store.queue(id));
    bus.emit(id,'session',store.session(id));bus.emit(id,'history',runner.history.state(id));
  };
  for(const direction of ['undo','redo','recover'] as const)app.post(`/api/sessions/:id/history/${direction}`,async(req,res)=>{
    const id=req.params.id;
    const checkpointId=direction==='recover'?undefined:z.object({checkpointId:z.string().min(1).max(100)}).parse(req.body).checkpointId;
    const state=await runner.exclusive(id,async()=>{
      try {return direction==='recover'?await runner.history.recover(id):await runner.history[direction](id,checkpointId!);}
      finally {publishHistory(id);}
    });
    // Undo/redo rewrite the provider-visible history; the next request should
    // attribute its prompt-cache miss to that rather than reporting a clean prefix.
    if(direction!=='recover')runner.notePrefixHistoryChange(id,'history_edited');
    res.json(state);
  });
  app.post('/api/sessions/:id/undo',async(req,res)=>{
    const id=req.params.id;
    await runner.exclusive(id,async()=>{
      runner.history.assertReady(id);
      if(runner.history.hasCheckpoints(id))throw httpError(409,'This session has turn checkpoints. Use Undo last turn instead of session-wide file restoration.');
      const session=store.session(id);
      await restoreChanges(session.workspace,store.changes(id),change=>store.clearChange(id,change.path));
    });
    res.json({ok:true});
  });
  app.get('/api/commands',async(req,res)=>{
    const root=await workspace(req.query.workspace),commands:{name:string,description:string,content:string}[]=[];
    for(const dir of ['.litespeed/commands','.claude/commands']){
      let names:string[]=[];try{names=await readdir(await resolveWorkspacePath(root,dir));}catch{continue;}
      for(const name of names.filter(n=>n.endsWith('.md')).slice(0,100)){
        try{const content=await readCommand(root,join(dir,name));commands.push({name:name.slice(0,-3),description:content.split('\n').find(l=>l.trim()&&!l.startsWith('---'))?.replace(/^#+\s*/,'').slice(0,120)||name,content});}catch{/* Skip unreadable commands. */}
      }
    }
    res.json({commands});
  });
  // Plugin packages (design note 4.4). Local directories only (git URLs are
  // out of scope: clone first). POST /plan is the pure dry run; POST /install
  // RE-PLANS and applies in one call so there is no stale-plan window between
  // reviewing and applying. Settings UI is deliberately absent in v1 —
  // config/CLI-first; the API is the whole surface.
  const pluginInput=z.object({source:z.string().min(1).max(PLUGIN_LIMITS.sourcePath),workspace:z.string().max(4096).optional()}).strict();
  app.post('/api/plugins/plan',async(req,res)=>{
    const input=pluginInput.parse(req.body);
    const root=await workspace(input.workspace);
    const plan=await planInstall(input.source,root,store);
    res.json({plan:publicPlan(plan),planHash:pluginPlanHash(plan)});
  });
  app.post('/api/plugins/install',async(req,res)=>{
    const input=pluginInput.extend({expectedPlanHash:z.string().regex(/^[a-f0-9]{64}$/).optional()}).parse(req.body);
    const root=await workspace(input.workspace);
    const plan=await planInstall(input.source,root,store);
    if(input.expectedPlanHash&&input.expectedPlanHash!==pluginPlanHash(plan))throw httpError(409,'The plugin or destination changed. Review the installation again.');
    const result=await applyInstall(plan,root,store);
    res.json({plan:publicPlan({...plan,warnings:result.warnings}),applied:true,plugin:{name:result.name,...result.entry}});
  });
  app.get('/api/plugins',(_req,res)=>res.json({plugins:store.settings().plugins??{}}));
  app.delete('/api/plugins/:name',async(req,res)=>{
    const name=z.string().min(1).max(64).parse(req.params.name);
    const root=queryString(req.query.workspace)||store.settings().workspace;
    res.json(await uninstall(name,root,store));
  });
  app.get('/api/mcp',(_req,res)=>res.json(mcpStatus()));
  for(const action of ['refresh','reconnect','login','logout'] as const)app.post(`/api/mcp/:name/${action}`,async(req,res)=>{
    const name=z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).parse(req.params.name);
    const input=z.object({expectedRevision:z.string().min(1).max(128),expectedConfigRevision:z.string().min(1).max(128)}).strict().parse(req.body);
    const operation: ((name:string, revision:string, signal:AbortSignal)=>Promise<unknown>) | undefined = options.external?.[action];if(!operation)throw httpError(503,'MCP lifecycle operations are unavailable.');
    const result = await runner.externalOperation(signal=>{
      if(input.expectedConfigRevision!==mcpConfigRevision())throw httpError(409,'Saved MCP configuration changed. Review it before connecting tools.');
      return operation.call(options.external,name,input.expectedRevision,signal);
    },requestSignal(res));
    res.json(action === 'login' ? result : mcpStatus());
  });
  app.get('/api/mcp/login/:id',(req,res)=>{
    if(!options.external?.loginStatus)throw httpError(503,'MCP sign-in is unavailable.');
    res.json(options.external.loginStatus(z.string().uuid().parse(req.params.id)));
  });
  app.delete('/api/mcp/login/:id',(req,res)=>{
    if(!options.external?.cancelLogin)throw httpError(503,'MCP sign-in is unavailable.');
    options.external.cancelLogin(z.string().uuid().parse(req.params.id));res.json({ok:true});
  });
  app.post('/api/auth/codex/start',async(req,res)=>{if(!options.auth)throw httpError(503,'Subscription login is unavailable.');const{providerId,method}=z.object({providerId:z.string(),method:z.enum(['browser','device']).default('device')}).parse(req.body);if(!store.settings().providers.some(p=>p.id===providerId&&p.kind==='codex'))throw httpError(400,'Add a ChatGPT subscription provider first.');res.json(await options.auth.start(providerId,method));});
  app.get('/api/auth/codex/:loginId',(req,res)=>{if(!options.auth)throw httpError(503,'Subscription login is unavailable.');res.json(options.auth.status(req.params.loginId));});
  app.delete('/api/auth/codex/:providerId',async(req,res)=>{if(!options.auth)throw httpError(503,'Subscription login is unavailable.');await options.auth.disconnect(req.params.providerId);res.json({ok:true});});
  app.use('/api',(_req,res)=>res.status(404).json({error:'API route not found.'}));
  app.use((error:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
    if(res.headersSent)return res.end();
    if(error instanceof z.ZodError)return res.status(400).json({error:error.issues.map(i=>`${i.path.join('.')||'Request'}: ${i.message}`).join('; ')});
    const status=error.status||((error.code==='ENOENT'||error.code==='ENOTDIR')?404:500);
    res.status(status).json({error:safeError(error,store)});
  });
  return{app,store,bus,runner,schedules};
}
function safeError(error:unknown,store:Store){let text=error instanceof Error?error.message:'An unexpected error occurred.';for(const p of store.settings().providers)if(p.apiKey)text=text.split(p.apiKey).join('[redacted]');return text.slice(0,2000);}
