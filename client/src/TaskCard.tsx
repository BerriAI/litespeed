import type { LiteFusionTask } from '../../shared/litefusion-tasks';
import { taskState, taskAttention, compactWorkerText, handoffError, handoffStatus, type HandoffIssue } from '../../shared/worker-presentation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BookOpen, Check, ChevronRight, Circle, RotateCw, Square, X, Zap } from 'lucide-react';
import type { DelegationDetail, DelegationSummary } from '../../shared/delegation';
import type { RunEvent, ToolCall } from '../../shared/types';
import { api, applyEvent, errorMessage } from './api';
import { Conversation, Markdown, toolLabels } from './Conversation';
import { LiteSpeed } from './ui';

const statusLabels: Record<DelegationSummary['status'], string> = { running: 'Researching', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', timed_out: 'Timed out', interrupted: 'Interrupted' };
const sidekick = (task: DelegationSummary) => Boolean(task.role);
const actor = (task: DelegationSummary) => task.role === 'expert' ? 'Expert' : task.role === 'worker' ? 'Worker' : 'Sidekick';
const statusLabel = (task: DelegationSummary) => task.status === 'running' && sidekick(task) ? 'Working' : statusLabels[task.status];
export const delegationPath = (task: DelegationSummary) => `/sessions/${encodeURIComponent(task.parentSessionId)}/delegations/${encodeURIComponent(task.id)}`;
export function TaskCard({ task, scheduled, handoffs=[], tool, label, awaitingApproval, expanded, onCancel, cancelling, error, onInspect }: { handoffs?:HandoffIssue[]; scheduled?: LiteFusionTask; task?: DelegationSummary; tool?: ToolCall; label?: string; awaitingApproval?: boolean; expanded: boolean; onCancel: () => void; cancelling: boolean; error?: string; onInspect?: () => void }) {
  const running = task?.status === 'running';
  const fusion = Boolean(task?.role || tool?.name === 'delegate' || tool?.name === 'sidekick');
  const identity = label ?? (task && fusion ? actor(task) : 'Research');
  const worker = tool?.name === 'delegate' || task?.role === 'worker' || task?.role === 'expert';
  const description = task?.description || String(tool?.args.description || `${identity} task`);
  let state: string;
  if (cancelling) state = 'Cancelling…';
  else if (scheduled?.resolution) state = 'Resolved by lead';
  else if (scheduled && scheduled.status !== 'completed' && scheduled.status !== task?.status) state = scheduled.status === 'queued' ? 'Queued · waiting for prerequisites or capacity' : scheduled.status==='blocked'?'Needs lead attention':scheduled.status[0].toUpperCase() + scheduled.status.slice(1);
  else if (task) state = worker?taskState(task,scheduled):running?task.activity||statusLabel(task):statusLabel(task);
  else state = awaitingApproval ? 'Needs approval' : tool?.status === 'pending' ? 'Queued' : tool?.status === 'running' ? 'Starting' : tool?.status === 'error' ? 'Handoff not started' : tool?.status === 'denied' ? 'Not started' : 'Completed';
  const failure=scheduled?.error||task?.error || (!handoffs.length && !task && tool?.status==='error' ? handoffError(tool.output??'') : undefined);
  if (worker) {
    const canCancel = scheduled ? ['queued', 'running', 'blocked'].includes(scheduled.status) : running;
    const attention = scheduled?.resolution ? undefined : awaitingApproval ? 'Needs approval · respond in the conversation' : taskAttention(task,scheduled) || failure;
    const recent = task?.recentActivity?.[0];
    const [toolName, ...target] = recent?.split(' · ') ?? [];
    const activity = recent ? [toolLabels[toolName] ?? toolName, ...target].join(' · ') : undefined;
    const current = !attention && running && activity && activity !== state ? `${state} · ${activity}` : attention || state;
    const active = running || scheduled?.status === 'running';
    return <section className="research-task worker-task" role="region" aria-label={`${identity} task`}>
      <div className="worker-row">
        <button className="worker-open" aria-label="Inspect worker" disabled={!task && !scheduled} onClick={onInspect}>
          <span className={`worker-status-icon${active ? ' active' : ''}`} aria-hidden="true">{active ? <span className="working-dot" /> : (scheduled?.resolution || task?.status === 'completed') && !attention ? <Check size={16} /> : <Circle size={14} />}</span>
          <span className="worker-summary">
            <span className="worker-title"><span className="worker-number">{identity}</span><strong>{description}</strong></span>
            <span className="worker-current" role="status">{current}</span>
            <span className="worker-model">{task?.model || task?.litefusion?.resolved.model || 'Model assigned when task starts'}{task?.reasoningEffort && ` · ${task.reasoningEffort}`}</span>
          </span>
          <ChevronRight size={16} className="worker-chevron" aria-hidden="true" />
        </button>
        {canCancel && <button className="icon-button worker-stop" aria-label="Cancel task" title="Cancel task" disabled={cancelling} onClick={onCancel}><Square size={13} /></button>}
      </div>
      {handoffs.length>0&&<details className="handoff-history"><summary>{handoffStatus(handoffs)}</summary>{handoffs.map(issue=><div key={issue.key}><p>{issue.recovered?'Rejected handoff · retry accepted':'Rejected handoff · needs attention'}</p><pre>{handoffError(issue.output)}</pre></div>)}</details>}
      {handoffs.some(issue=>!issue.recovered)&&<p className="handoff-attention">{compactWorkerText(handoffError(handoffs.findLast(issue=>!issue.recovered)!.output))}</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
    </section>;
  }
  return <section className="research-task" role="region" aria-label={`${identity} task`}>
    {fusion && <div className="task-identity"><span className="task-actor"><Zap size={13} />{identity}</span><span className={`task-state${running ? ' active' : ''}`} role="status">{running && <span className="working-dot" />}{state}</span></div>}
    <div className="research-task-heading">{!fusion && <BookOpen size={16} />}<strong title={fusion ? `${identity} · edits and commands use this session’s permissions` : "Read-only research"}>{description}</strong>{!fusion && <span className="task-state" role="status">{!running && (task?.status === 'completed' ? <Check size={12} /> : <X size={12} />)}{state}</span>}<div className="research-task-actions">{running &&<button className="text-button" disabled={cancelling} onClick={onCancel}>Cancel task</button>}</div></div>
    {failure && <p className="error-text" role="status">{failure}</p>}
    {error && <p className="error-text" role="alert">{error}</p>}
    {expanded && (task ? <TaskTranscript task={task} label={identity} /> : <div className="task-pending">
      <p>{awaitingApproval ? 'Waiting for permission to start.' : tool?.status === 'pending' ? 'Waiting to start. Its transcript will appear here.' : tool?.status === 'running' ? 'Starting this task…' : tool?.output || 'No live transcript is available for this task.'}</p>
      {typeof tool?.args.prompt === 'string' && <details className="task-assignment"><summary>Assignment</summary><div className="markdown"><Markdown content={tool.args.prompt} /></div></details>}
    </div>)}
  </section>;
}

export function TaskTranscript({ task, label }: { task: DelegationSummary; label?: string }) {
  const [detail, setDetail] = useState<DelegationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const [reload, setReload] = useState(0);
  const current = useRef<DelegationDetail | null>(null);
  const refresh = useRef<() => Promise<void>>(async () => {});
  const previousStatus = useRef(task.status);
  const path = delegationPath(task);
  const fusion = sidekick(task);
  const identity = label ?? (fusion ? actor(task) : 'Research');
  const noun = identity.toLowerCase();
  const viewport = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  useLayoutEffect(() => { if (following && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; }, [detail?.messages, following]);
  useEffect(() => {
    let live = true, source: EventSource | undefined, journal: RunEvent[] = [], latestRead = 0, journalFloor = 0;
    current.current = null; setDetail(null); setLoading(true); setError(''); setConnection('connecting');
    const valid = (value: DelegationDetail) => value.readOnly === true && value.session.id === task.childSessionId && value.delegation.id === task.id && value.delegation.parentSessionId === task.parentSessionId && value.delegation.childSessionId === task.childSessionId && value.delegation.parentTurnId === task.parentTurnId && value.delegation.parentMessageId === task.parentMessageId && value.delegation.toolCallId === task.toolCallId;
    const read = async () => {
      const request = ++latestRead;
      try {
        const next = await api<DelegationDetail>(path);
        if (!live || request !== latestRead) return;
        if (!valid(next)) throw new Error(fusion ? 'Sidekick transcript does not match this task.' : 'Research transcript does not match this task.');
        const newer = journal.filter(event => (event.id ?? 0) > (next.lastEventId ?? 0));
        // If a snapshot predates trimmed journal entries, only the live detail has the complete text.
        const behindJournal = next.delegation.status === 'running' && (next.lastEventId ?? 0) < journalFloor && current.current;
        let reconciled = behindJournal || { ...(next.delegation.status === 'running' ? newer.reduce(applyEvent, next) : next), delegation: next.delegation, readOnly: true } as DelegationDetail;
        // Finished snapshots are sealed by the server. Never resurrect a terminal transcript.
        if (current.current?.delegation.status !== 'running' && current.current) reconciled = current.current;
        else if (next.delegation.status === 'running' && current.current && (current.current.lastEventId ?? 0) > (reconciled.lastEventId ?? 0)) reconciled = current.current;
        current.current = reconciled; setDetail(reconciled); journal = newer; setError(''); setLoading(false);
        if (reconciled.delegation.status !== 'running') { source?.close(); source = undefined; setConnection('connected'); }
        else connect();
      } catch (e) { if (live && request === latestRead) { setError(`Could not load ${noun} transcript: ${errorMessage(e)}`); setLoading(false); } }
    };
    refresh.current = read;
    const connect = () => {
      if (!live || source || !current.current || current.current.delegation.status !== 'running') return;
      source = new EventSource(`/api${path}/events?after=${current.current.lastEventId ?? 0}`);
      source.onopen = () => { if (live && current.current?.delegation.status === 'running') { setConnection('connected'); void read(); } };
      source.onerror = () => { if (live && current.current?.delegation.status === 'running') { setConnection('reconnecting'); void read(); } };
      source.onmessage = event => {
        if (!live || !current.current || current.current.delegation.status !== 'running') return;
        try {
          const data = JSON.parse(event.data) as RunEvent;
          if (data.sessionId !== task.childSessionId) return;
          const id = Number(event.lastEventId || data.id || 0);
          if (id && id <= (current.current.lastEventId ?? 0)) return;
          if (!Number.isSafeInteger(id) || id < 1) throw new Error(`Invalid ${noun} event cursor`);
          data.id = id; journal.push(data);
          if (journal.length > 2000) journalFloor = Math.max(journalFloor, journal.shift()!.id!);
          const next = { ...applyEvent(current.current, data), delegation: current.current.delegation, readOnly: true } as DelegationDetail;
          current.current = next; setDetail(next);
          if (data.type === 'done' || data.type === 'error' || data.type === 'reset') void read();
        } catch { setError(`A ${noun} update could not be read. Refresh the transcript to restore its current state.`); }
      };
    };
    void read();
    return () => { live = false; latestRead++; source?.close(); refresh.current = async () => {}; };
  }, [path, task.childSessionId, task.parentTurnId, task.parentMessageId, task.toolCallId, reload]);
  useEffect(() => {
    if (previousStatus.current !== task.status) { previousStatus.current = task.status; void refresh.current(); }
  }, [task.status]);
  return <div className="research-transcript inline-transcript" role="region" aria-label={`${identity} transcript`}>
    <button className="icon-button transcript-refresh" title="Refresh transcript" disabled={loading} onClick={() => { if (detail) void refresh.current(); else setReload(value => value + 1); }}><RotateCw size={12} /><span className="sr-only">Refresh transcript</span></button>
    {error && <div className="inline-alert" role="alert">{error}</div>}
    {loading && <div className="research-loading"><LiteSpeed compact active /><p>Loading {noun} transcript…</p></div>}
    {detail && <div className="transcript-model">{detail.session.model}</div>}
    <div className="task-transcript-content" ref={viewport} onScroll={event => { const el = event.currentTarget; setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 60); }}>
    {detail && <Conversation detail={detail} connection={connection} busy={false} readOnly inline onDecide={() => {}} onFork={() => {}} renderQuestion={() => null} />}
    </div>
    {!following && <button className="text-button transcript-latest" onClick={() => setFollowing(true)}>Latest {identity.toLowerCase()} activity ↓</button>}
  </div>;
}
