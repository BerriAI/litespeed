import { useEffect, useRef } from 'react';
import type { DelegationSummary, SessionDetail } from '../../shared/types';
import { logicalWorkers, workerLabels, workerState } from '../../shared/worker-presentation';
import { liteFusionRole } from '../../shared/litefusion';
import { TaskTranscript } from './TaskCard';

export function WorkerInspector({task,detail,onSelect,onClose,onCancel,cancelling,error}:{task:DelegationSummary;detail:SessionDetail;onSelect:(id:string)=>void;onClose:()=>void;onCancel:()=>void;cancelling:boolean;error?:string}) {
  const close=useRef<HTMLButtonElement>(null);
  useEffect(()=>{close.current?.focus();},[]);
  const labels=workerLabels(detail), label=labels.get(`${task.parentMessageId}:${task.toolCallId}`)??'Worker';
  // Related assignments share a context; escalated attempts share an assignment.
  const history=detail.delegations?.filter(item=>item.childSessionId===task.childSessionId || task.litefusion&&item.litefusion?.assignmentId===task.litefusion.assignmentId)??[task];
  return <aside className="worker-inspector" aria-label="Worker inspector" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();onClose();}}}>
    <header><button className="text-button" ref={close} onClick={onClose}>← Back to conversation</button><strong>{label}</strong></header>
    <label>Worker<select aria-label="Inspect worker" value={logicalWorkers(detail).find(item=>item.litefusion?.assignmentId===task.litefusion?.assignmentId&&task.litefusion||item.id===task.id)?.id??task.id} onChange={event=>onSelect(event.target.value)}>{logicalWorkers(detail).map(item=><option key={item.id} value={item.id}>{labels.get(`${item.parentMessageId}:${item.toolCallId}`)} · {item.description}</option>)}</select></label>
    <p>{task.description}</p><p className="field-hint">{task.model} · {task.reasoningEffort??'provider default'} · {workerState(task)}</p>
    {task.litefusion && <p className="field-hint">{liteFusionRole(task.litefusion.roleId).task} · {task.litefusion.reason} · {task.litefusion.contextReused?'Context reused':'Fresh context'} · Integration: {task.litefusion.integration} · Acceptance unresolved</p>}
    <label>Attempt history<select aria-label="Worker attempt" value={task.id} onChange={event=>onSelect(event.target.value)}>{history.map((item,index)=><option key={item.id} value={item.id}>{index+1}. {item.model} · {workerState(item)}</option>)}</select></label>
    {task.status==='running' && <button className="text-button" disabled={cancelling} onClick={onCancel}>{cancelling?'Stopping…':'Stop this worker'}</button>}
    {task.litefusion?.request && <p className="worker-attention">{task.litefusion.request.reason}</p>}
    {(error||task.error) && <p role="alert" className="error-text">{error||task.error}</p>}
    <TaskTranscript key={task.id} task={task} label={label}/>
  </aside>;
}
