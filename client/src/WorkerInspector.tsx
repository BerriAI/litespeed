import { useEffect, useRef } from 'react';
import { ArrowLeft, Square } from 'lucide-react';
import type { DelegationSummary, SessionDetail } from '../../shared/types';
import type { LiteFusionTask } from '../../shared/litefusion-tasks';
import { logicalWorkers, workerLabels, workerState, taskAttention, workerReport } from '../../shared/worker-presentation';
import { liteFusionRole } from '../../shared/litefusion';
import { TaskTranscript } from './TaskCard';

export function WorkerInspector({ task, detail, onSelect, onClose, onCancel, cancelling, error }: { task: DelegationSummary; detail: SessionDetail; onSelect: (id: string) => void; onClose: () => void; onCancel: () => void; cancelling: boolean; error?: string }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { close.current?.focus(); }, []);
  const labels = workerLabels(detail), label = labels.get(`${task.parentMessageId}:${task.toolCallId}`) ?? 'Worker';
  const workers = logicalWorkers(detail);
  const selected = workers.find(item => item.id === task.id || task.litefusion && item.litefusion?.assignmentId === task.litefusion.assignmentId);
  const history = detail.delegations?.filter(item => item.childSessionId === task.childSessionId || task.litefusion && item.litefusion?.assignmentId === task.litefusion.assignmentId) ?? [task];
  const resolution = detail.tasks?.find(item => item.attemptIds.includes(task.id))?.resolution;
  return <aside className="worker-inspector" aria-label="Worker inspector" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <header className="worker-inspector-header">
      <button className="icon-button" ref={close} onClick={onClose} aria-label="Back to conversation" title="Back to conversation"><ArrowLeft size={18} /></button>
      <select aria-label="Inspect worker" value={selected?.id ?? task.id} onChange={event => onSelect(event.target.value)}>{workers.map(item => <option key={item.id} value={item.id}>{labels.get(`${item.parentMessageId}:${item.toolCallId}`)} · {item.description}</option>)}</select>
      {task.status === 'running' && <button className="icon-button" disabled={cancelling} onClick={onCancel} aria-label={cancelling ? 'Stopping…' : 'Stop this worker'} title="Stop this worker"><Square size={14} /></button>}
    </header>
    <div className="worker-inspector-heading"><h2>{task.description}</h2><p className="worker-inspector-status">{task.status === 'running' && <span className="working-dot" />}{workerState(task)}</p><p className="worker-model">{task.model} · {task.reasoningEffort ?? 'provider default'}</p></div>
    <details className="worker-details">
      <summary>Task details{history.length > 1 ? ` · ${history.length} attempts` : ''}</summary>
      {task.litefusion && <dl><div><dt>Specialty</dt><dd>{liteFusionRole(task.litefusion.roleId).task}</dd></div><div><dt>Routing</dt><dd>{task.litefusion.reason.replaceAll('_', ' ')}</dd></div><div><dt>Context</dt><dd>{task.litefusion.contextReused ? 'Continued from the previous attempt' : 'Fresh context'}</dd></div><div><dt>Changes</dt><dd>{task.litefusion.integration.replaceAll('_', ' ')}</dd></div><div><dt>Lead review</dt><dd>{resolution ? resolution.evidence : 'No acceptance recorded'}</dd></div></dl>}
      <label>Attempt history<select aria-label="Worker attempt" value={task.id} onChange={event => onSelect(event.target.value)}>{history.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.model} · {workerState(item)}</option>)}</select></label>
    </details>
    {taskAttention(task)&&!resolution&&<p className="worker-attention">{taskAttention(task)}</p>}
    {workerReport(task)&&<details className="worker-details"><summary>Worker report and evidence</summary><pre>{workerReport(task)}</pre></details>}
    {error&&<p role="alert" className="error-text">{error}</p>}
    <TaskTranscript key={task.id} task={task} label={label} />
  </aside>;
}

export function PendingTaskInspector({ task, detail, onClose, onCancel }: { task: LiteFusionTask; detail: SessionDetail; onClose: () => void; onCancel: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { close.current?.focus(); }, []);
  const call = detail.messages.flatMap(message => message.toolCalls ?? []).findLast(call => call.taskId === task.id);
  return <aside className="worker-inspector" aria-label="Worker inspector" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <header className="worker-inspector-header"><button ref={close} className="icon-button" onClick={onClose} aria-label="Back to conversation"><ArrowLeft size={18} /></button><strong>Task activity</strong>{['queued', 'running', 'blocked'].includes(task.status) && <button className="icon-button" onClick={onCancel} aria-label="Stop this task"><Square size={14} /></button>}</header>
    <div className="worker-inspector-heading"><h2>{task.description}</h2><p className="worker-inspector-status">{task.status}</p></div>
    <details className="worker-details"><summary>Task details</summary><p>{String(call?.args.prompt ?? '')}</p><dl><div><dt>Dependencies</dt><dd>{task.dependencies.map(id => detail.tasks?.find(task => task.id === id)?.description ?? id).join(', ') || 'None'}</dd></div><div><dt>Acceptance</dt><dd>{Array.isArray(call?.args.acceptance) ? call.args.acceptance.join('; ') : 'Not specified'}</dd></div></dl></details>
    {task.error && <p className="error-text" role="alert">{task.error}</p>}
    <div className="worker-pending-state"><p>Waiting to start</p><span>Activity will appear here when a worker picks up this task.</span></div>
  </aside>;
}
