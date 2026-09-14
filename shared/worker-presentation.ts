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
        const id=task?.litefusion?.assignmentId??prior?.litefusion?.assignmentId??`pending:${message.id}:${tool.id}`;
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
export function workerProjection(detail: SessionDetail) {
  const result = new Map<string, {task: DelegationSummary; hidden: boolean}>();
  const first = new Map<string, DelegationSummary>(), latest = new Map<string, DelegationSummary>();
  const tasks=visibleDelegations(detail);
  const ordered=detail.messages.flatMap(message=>(message.toolCalls??[]).flatMap(call=>{const task=tasks.find(item=>item.parentMessageId===message.id&&item.toolCallId===call.id&&item.id===call.delegationId);return task?[task]:[];}));
  for (const task of ordered) {
    const id = task.litefusion?.assignmentId ?? task.id;
    if (!first.has(id)) first.set(id,task);
    latest.set(id,task);
  }
  for (const task of ordered) {
    const id = task.litefusion?.assignmentId ?? task.id;
    result.set(`${task.parentMessageId}:${task.toolCallId}`, {task:latest.get(id)!,hidden:first.get(id)!.id!==task.id});
  }
  return result;
}
export function logicalWorkers(detail: SessionDetail): DelegationSummary[] {
  return [...workerProjection(detail).values()].filter(item=>!item.hidden).map(item=>item.task);
}
export function workerState(task: DelegationSummary): string {
  const value=task.litefusion?.outcome?.replaceAll('_',' ') ?? (task.status==='completed'?'Completed · needs review':task.status.replaceAll('_',' '));
  return value[0].toUpperCase()+value.slice(1);
}
