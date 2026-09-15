import type { DelegationSummary, SessionDetail, ToolCall } from './types.js';
import type { LiteFusionTask } from './litefusion-tasks.js';
import { visibleDelegations } from './events.js';

export interface HandoffIssue { key:string; output:string; recovered:boolean }
export interface WorkerProjection {
  task?:DelegationSummary;
  scheduled?:LiteFusionTask;
  hidden:boolean;
  logicalId?:string;
  handoffs?:HandoffIssue[];
}

/** Error output remains immutable. Extract readable validation messages for
 * presentation; never decode arbitrary escape sequences from tool content. */
export function handoffError(output:string):string {
  try {
    const parsed:unknown=JSON.parse(output);
    if(Array.isArray(parsed)&&parsed.length&&parsed.every(item=>item&&typeof item.message==='string')) {
      return parsed.map(item=>`${Array.isArray(item.path)&&item.path.length?`${item.path.join('.')}: `:''}${item.message}`).join('\n');
    }
  } catch { /* Plain provider/runtime error. */ }
  return output;
}
export function handoffStatus(issues:readonly HandoffIssue[]):string {
  return issues.some(issue=>!issue.recovered)?'Handoff not started':'Handoff retried successfully';
}

export function compactWorkerText(value:string,max=140):string {
  const text=value.replace(/\s+/g,' ').trim();
  return text.length>max?text.slice(0,max-1)+'…':text;
}
export function taskState(task?:DelegationSummary,scheduled?:LiteFusionTask):string {
  if(scheduled?.resolution)return 'Resolved by lead';
  if(scheduled?.status==='blocked')return 'Needs lead attention';
  if(scheduled?.status==='queued')return 'Queued';
  if(scheduled?.status==='failed'||task?.status==='failed')return 'Worker stopped · needs lead attention';
  if(task?.status==='running')return compactWorkerText(task.activity||'Working',80);
  return task?workerState(task):scheduled?.status??'Waiting to start';
}
export function taskAttention(task?:DelegationSummary,scheduled?:LiteFusionTask):string|undefined {
  if(scheduled?.resolution)return undefined;
  const text=task?.litefusion?.request?.reason||scheduled?.error||task?.error||task?.verificationNote;
  if(!text)return undefined;
  if(text.includes('Unrecorded changes conflict with command history'))return 'Workspace history needs recovery. Work is retained for the lead.';
  return compactWorkerText(handoffError(text));
}
export function workerReport(task:DelegationSummary):string {
  const request=task.litefusion?.request;
  return [request&&`Request\n${request.reason}\n\nEvidence\n${request.evidence}`,task.verificationNote,task.error].filter(Boolean).join('\n\n');
}

function workerCalls(detail:SessionDetail) {
  const attempts=visibleDelegations(detail);
  let turn='';
  return detail.messages.flatMap(message=>{
    if(message.role==='user')turn=message.turnId??message.id;
    return (message.toolCalls??[]).filter(call=>call.name==='delegate'||call.name==='sidekick').map(call=>{
      const attempt=attempts.find(task=>task.id===call.delegationId&&task.toolCallId===call.id&&task.parentMessageId===message.id);
      return {key:`${message.id}:${call.id}`,call,attempt,turn:message.turnId??turn,id:call.taskId??attempt?.litefusion?.assignmentId??attempt?.id};
    });
  });
}

/** A failed dispatch is an event on a workstream, not a new worker. Only a
 * later accepted dispatch in the same turn can establish that it recovered. */
export function workerProjection(detail:SessionDetail):Map<string,WorkerProjection> {
  const result=new Map<string,WorkerProjection>(),attempts=visibleDelegations(detail),calls=workerCalls(detail),first=new Set<string>();
  const failedHandoff=(row:ReturnType<typeof workerCalls>[number])=>row.call.status==='error'&&!row.attempt&&!row.call.taskId&&(detail.session.architecture?.kind==='litefusion'||typeof row.call.args.roleId==='string'&&typeof row.call.args.workstream==='string');
  const sameAssignment=(a:ToolCall,b:ToolCall)=>typeof a.args.workstream==='string'&&a.args.workstream===b.args.workstream&&typeof a.args.roleId==='string'&&a.args.roleId===b.args.roleId&&a.args.helperFor===b.args.helperFor;
  for(const row of calls) {
    if(!row.id&&failedHandoff(row)) {
      const peer=calls.find(other=>other.id&&sameAssignment(row.call,other.call));
      row.id=peer?.id;
    }
  }
  for(const row of calls) {
    const {id,key,call}=row;
    if(!id) {
      if(failedHandoff(row))result.set(key,{hidden:false,handoffs:[{key,output:call.output??'The assignment was rejected before a worker started.',recovered:false}]});
      continue;
    }
    const task=attempts.filter(task=>(task.litefusion?.assignmentId??task.id)===id).at(-1)??row.attempt;
    const handoffs=calls.flatMap((failed,i)=>failed.id===id&&failedHandoff(failed)?[{
      key:failed.key,output:failed.call.output??'The assignment was rejected before a worker started.',
      recovered:calls.slice(i+1).some(next=>next.id===id&&next.turn===failed.turn&&next.call.status==='completed'&&Boolean(next.call.taskId||next.attempt)&&sameAssignment(failed.call,next.call)),
    }]:[]);
    result.set(key,{task,scheduled:detail.tasks?.find(task=>task.id===id),logicalId:id,hidden:first.has(id),...(handoffs.length?{handoffs}: {})});first.add(id);
  }
  return result;
}

/** LiteFusion numbers accepted logical tasks; rejected calls are handoff
 * events. Other architectures retain their invocation-order identities. */
export function workerLabels(detail: SessionDetail): Map<string, string> {
  const labels = new Map<string, string>();
  const tasks = visibleDelegations(detail);
  const projection=workerProjection(detail);
  const assignments = new Map<string,string>();
  let taskCount=0;
  let counts: Record<string, number> = {};
  for (const message of detail.messages) {
    if (message.role === 'user') counts = {};
    for (const tool of message.toolCalls ?? []) {
      if (tool.name !== 'delegate' && tool.name !== 'sidekick') continue;
      const task = tasks.find(task => task.id === tool.delegationId && task.toolCallId === tool.id && task.parentMessageId === message.id);
      const role = tool.name === 'sidekick' ? 'Sidekick' : task?.role === 'expert' || (!task && detail.session.architecture?.kind === 'expert-fusion') ? 'Expert' : 'Worker';
      if(detail.session.architecture?.kind==='litefusion'||task?.litefusion) {
        const id=projection.get(`${message.id}:${tool.id}`)?.logicalId;
        if(!id){labels.set(`${message.id}:${tool.id}`,'Handoff');continue;}
        if(!assignments.has(id)) assignments.set(id,`Task ${++taskCount}`);
        labels.set(`${message.id}:${tool.id}`,assignments.get(id)!);
        continue;
      }
      labels.set(`${message.id}:${tool.id}`, role === 'Sidekick' ? role : `${role} ${counts[role] = (counts[role] ?? 0) + 1}`);
    }
  }
  return labels;
}

export function logicalWorkers(detail:SessionDetail):DelegationSummary[]{return [...workerProjection(detail).values()].filter(item=>!item.hidden).flatMap(item=>item.task?[item.task]:[]);}
export function workerState(task: DelegationSummary): string {
  const value=task.litefusion?.outcome?.replaceAll('_',' ') ?? (task.status==='completed'?'Completed · needs review':task.status.replaceAll('_',' '));
  return value[0].toUpperCase()+value.slice(1);
}
