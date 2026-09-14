import type { DelegationSummary, SessionDetail } from './types.js';
import { visibleDelegations } from './events.js';

/** Assign identity from the driver's call order, before a child exists. A
 * queued call keeps its number when it starts, completes, or is reloaded. */
export function workerLabels(detail: SessionDetail): Map<string, string> {
  const labels = new Map<string, string>();
  const tasks = visibleDelegations(detail);
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
        const prior=tasks.find(item=>item.id===(tool.args.continueFrom??tool.args.repairOf));
        const id=tool.taskId??task?.litefusion?.assignmentId??prior?.litefusion?.assignmentId??`pending:${message.id}:${tool.id}`;
        if(!assignments.has(id)) assignments.set(id,`Task ${++taskCount}`);
        labels.set(`${message.id}:${tool.id}`,assignments.get(id)!);
        continue;
      }
      labels.set(`${message.id}:${tool.id}`, role === 'Sidekick' ? role : `${role} ${counts[role] = (counts[role] ?? 0) + 1}`);
    }
  }
  return labels;
}

/** Keep a logical task at its first anchor; attempts remain immutable in history. */
export function workerProjection(detail:SessionDetail) {
  const result=new Map<string,{task?:DelegationSummary;scheduled?:import('./litefusion-tasks.js').LiteFusionTask;hidden:boolean}>();
  const tasks=visibleDelegations(detail),first=new Set<string>();
  for(const message of detail.messages)for(const call of message.toolCalls??[]){
    if(call.name!=='delegate'&&call.name!=='sidekick')continue;
    const attempt=tasks.find(task=>task.parentMessageId===message.id&&task.toolCallId===call.id&&task.id===call.delegationId);
    const id=call.taskId??attempt?.litefusion?.assignmentId??attempt?.id;if(!id)continue;
    const latest=tasks.filter(task=>(task.litefusion?.assignmentId??task.id)===id).at(-1)??attempt;
    result.set(`${message.id}:${call.id}`,{task:latest,scheduled:detail.tasks?.find(task=>task.id===id),hidden:first.has(id)});first.add(id);
  }
  return result;
}
export function logicalWorkers(detail:SessionDetail):DelegationSummary[]{return [...workerProjection(detail).values()].filter(item=>!item.hidden).flatMap(item=>item.task?[item.task]:[]);}
export function workerState(task: DelegationSummary): string {
  const value=task.litefusion?.outcome?.replaceAll('_',' ') ?? (task.status==='completed'?'Completed · needs review':task.status.replaceAll('_',' '));
  return value[0].toUpperCase()+value.slice(1);
}
