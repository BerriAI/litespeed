/** @jsxImportSource @opentui/react */
import type { DelegationSummary, SessionDetail, Todo } from '../shared/types.js';
import { useContext, useState } from 'react';
import type { TerminalController } from './controller.js';
import { useTheme } from './context.js';
import { useInvocation } from './useInvocation.js';
import { toHex } from './theme.js';
import { terminalText } from './protocol.js';
import { workerLabels, compactWorkerText, taskState, taskAttention } from '../shared/worker-presentation.js';
import { TODO_MARKERS } from './transcriptModel.js';
import { taskInvocations } from './conversation.js';
import { WorkerInspectionContext } from './workerCard.js';

function TaskItems({ todos, actor, compact }: { todos: Todo[]; actor: string; compact?: boolean }) {
  const theme = useTheme(), [expanded, setExpanded] = useState(false);
  if (!todos.length) return null;
  const completed = todos.filter(todo => todo.status === 'completed').length;
  const current = todos.find(todo => todo.status === 'in_progress') ?? todos.find(todo => todo.status === 'pending');
  return <box flexDirection="column" flexShrink={0} marginBottom={compact ? 0 : 1}>
    <text fg={toHex(theme.textMuted)} onMouseDown={compact ? undefined : () => setExpanded(value => !value)}>{`${!compact && completed ? `${expanded ? '▾' : '▸'} ` : ''}${actor} · ${completed}/${todos.length} done`}</text>
    {(compact ? current ? [current] : [] : expanded ? todos : todos.filter(todo => todo.status !== 'completed')).map(todo => <text key={todo.id ?? todo.content} fg={toHex(todo.status === 'in_progress' ? theme.text : theme.textMuted)} wrapMode="word" {...(compact ? { height: 1 } : {})}>{`${TODO_MARKERS[todo.status] ?? '○'} ${terminalText(todo.content)}`}</text>)}
  </box>;
}

function WorkerTasks({ task, label, controller, compact }: { task: DelegationSummary; label: string; controller: TerminalController; compact?: boolean }) {
  const { detail } = useInvocation(controller.client, task);
  const theme = useTheme();
  if (!detail?.todos.length) return task.status === 'running' ? <text fg={toHex(theme.textMuted)} wrapMode="word" {...(compact ? { height: 1 } : {})}>{`${label} · ${terminalText(task.description)}`}</text> : null;
  return <TaskItems todos={detail.todos} actor={label} compact={compact} />;
}

export function TaskProgress({ detail, controller, compact = false }: { detail: SessionDetail; controller: TerminalController; compact?: boolean }) {
  const theme = useTheme(), tasks = taskInvocations(detail), labels = workerLabels(detail),inspect=useContext(WorkerInspectionContext);
  if(detail.session.architecture?.kind==='litefusion'){
    const last=detail.messages.findLast(message=>message.role==='user')?.id;
    const scheduled=(detail.tasks??[]).filter(task=>task.turnId===last||['queued','running','blocked'].includes(task.status));
    const shown=compact?scheduled.filter(task=>task.status==='running'||task.status==='blocked').slice(0,1):scheduled;
    return <box flexDirection="column" paddingLeft={1} paddingRight={1} flexShrink={0}>{!compact&&<text fg={toHex(theme.text)}>Tasks</text>}<TaskItems todos={detail.todos} actor="Lead" compact={compact}/>{shown.map(task=>{const attempt=detail.delegations?.findLast(item=>item.asyncTaskId===task.id);return <box key={task.id} flexDirection="column" marginBottom={compact?0:1} onMouseDown={()=>inspect?.(attempt??task)}><text fg={toHex(theme.text)} height={compact?1:2} wrapMode="word">{terminalText(compactWorkerText(task.description,100))}</text><text fg={toHex(task.error?theme.warning:theme.textMuted)} height={1}>{terminalText(taskState(attempt,task))}</text>{!compact&&taskAttention(attempt,task)&&<text fg={toHex(theme.textMuted)} height={2} wrapMode="word">{terminalText(taskAttention(attempt,task))}</text>}</box>;})}{compact&&scheduled.length>shown.length&&<text fg={toHex(theme.textMuted)}>{`${scheduled.length-shown.length} more tasks · /workers to inspect`}</text>}</box>;
  }
  const active = tasks.filter(task => task.status === 'running');
  const shown = compact ? active.slice(0, 1) : tasks;
  return <box flexDirection="column" flexShrink={0} paddingLeft={1} paddingRight={1}>
    {!compact && <text fg={toHex(theme.text)} marginBottom={1}><strong>Tasks</strong></text>}
    {(!compact || !active.length) && <TaskItems todos={detail.todos} actor="Driver" compact={compact} />}
    {shown.map(task => <WorkerTasks key={task.id} task={task} label={labels.get(`${task.parentMessageId}:${task.toolCallId}`) || 'Research'} controller={controller} compact={compact} />)}
    {compact && active.length > 1 && <text fg={toHex(theme.textMuted)}>{`${active.length - 1} more agents · /todos for all tasks`}</text>}
    {!compact && !detail.todos.length && !tasks.length && <text fg={toHex(theme.textMuted)}>No tasks yet.</text>}
  </box>;
}
