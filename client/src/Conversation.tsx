import { approvalPresentation } from '../../shared/approval-presentation.js';
import { cacheHitLabel, usagePhase } from '../../shared/usage';
import { shuntLabel } from '../../shared/shunt';
import { steeringContent } from '../../shared/steering-presentation';
import { ChangeSummary } from './ChangeSummary';
import { Attachments } from './Attachments';
import { conversationBlocks } from './conversation-blocks';
import { responseBlocks } from './response-blocks';
import { createContext, useContext, memo, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { QuestionRequest } from '../../shared/questions';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowDown, Check, ChevronDown, ChevronRight, Clock3, File, GitFork, Shield, Terminal, X } from 'lucide-react';
import type { Message, PermissionRequest, SessionDetail, ToolCall, Usage } from '../../shared/types';
import { CopyButton, Logo, LiteSpeed } from './ui';
import { withoutVerificationNotice } from '../../shared/verification';
import { executionFailed } from '../../shared/receipts';
import { workerProjection, type WorkerProjection } from '../../shared/worker-presentation';
import { previousWorkspaces, workspaceFileLink, type FileLink } from './file-links';
import { query } from './api';
import { useConversationReading } from './use-conversation-reading';
export const WorkspaceLinksContext = createContext<{ workspace: string; previous?: readonly string[]; baseFile?: string; onFile: (link: FileLink) => void; onUrl?: (url: string) => void } | undefined>(undefined);
const ToolOpenContext = createContext<((tool: ToolCall) => void) | undefined>(undefined);
const WorkerRowsContext=createContext(new Map<string,WorkerProjection>());

const MarkdownImagesContext = createContext(false);
// Stable renderers retain links, selection and keyboard focus when a disclosure changes.
const markdownComponents: Components = {
  pre({ children, node, ...props }) { return <div className="code-block"><pre {...props}>{children}</pre><CopyCode>{children}</CopyCode></div>; },
  a({ children, node, ...props }) {
    const links = useContext(WorkspaceLinksContext);
    const file = links && props.href ? workspaceFileLink(props.href, links.workspace, links.baseFile, links.previous) : null;
    if (file) return <a {...props} title={`Open ${file.path}`} onClick={e => { e.preventDefault(); links!.onFile(file); }}>{children}</a>;
    const browser = links?.onUrl && /^https?:\/\//i.test(props.href || '');
    return <a {...props} target="_blank" rel="noopener noreferrer" title={browser ? 'Open in task browser' : undefined} onClick={browser ? event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); links!.onUrl!(props.href!); } } : undefined}>{children}</a>;
  },
  table({ children, node, ...props }) { return <div className="markdown-table"><table {...props}>{children}</table></div>; },
  img({ src, alt }) {
    const links = useContext(WorkspaceLinksContext), renderImages = useContext(MarkdownImagesContext);
    const file = links && typeof src === 'string' ? workspaceFileLink(src, links.workspace, links.baseFile, links.previous) : null;
    if (file) return renderImages ? <img loading="lazy" src={`/api/file-content?${query({ workspace: links!.workspace, path: file.path })}`} alt={alt || file.path} /> : <button className="image-link" onClick={() => links!.onFile(file)}>{alt || file.path} ↗</button>;
    return <a href={src} target="_blank" rel="noopener noreferrer" className="image-link">{alt || 'View image'} ↗</a>;
  },
};
export const Markdown = memo(function Markdown({ content, renderImages = false }: { content: string; renderImages?: boolean }) {
  const links = useContext(WorkspaceLinksContext);
  return <MarkdownImagesContext.Provider value={renderImages}><ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={(url, key) => {
    const safe = defaultUrlTransform(url);
    if (safe || key !== 'href' || !links) return safe;
    // Root filenames with line numbers otherwise look like URL schemes.
    return workspaceFileLink(url, links.workspace, links.baseFile, links.previous) ? `./${url}` : '';
  }} components={markdownComponents}>{content}</ReactMarkdown></MarkdownImagesContext.Provider>;
});
function CopyCode({ children }: { children: React.ReactNode }) {
  function text(node: React.ReactNode): string {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(text).join('');
    if (node && typeof node === 'object' && 'props' in node) return text((node.props as { children: React.ReactNode }).children);
    return '';
  }
  return <CopyButton text={text(children).replace(/\n$/, '')} label="Copy code" />;
}
function PromptContent({ content, expanded, onExpand, onSettled }: { content: string; expanded: boolean; onExpand: (open: boolean) => void; onSettled: () => void }) {
  const clip = useRef<HTMLDivElement>(null), text = useRef<HTMLDivElement>(null), id = useId();
  const [long, setLong] = useState(false), collapsed = long && !expanded;
  useLayoutEffect(() => {
    const element = text.current; if (!element) return;
    const measure = () => setLong(element.scrollHeight > 320);
    measure(); if (typeof ResizeObserver === 'undefined') return; const observer = new ResizeObserver(measure); observer.observe(element); return () => observer.disconnect();
  }, [content]);
  function toggle() {
    onExpand(!expanded);
    if (expanded) requestAnimationFrame(() => { clip.current?.closest('article')?.scrollIntoView({ block: 'nearest' }); onSettled(); });
  }
  return <div className={`prompt-content${collapsed ? ' collapsed' : ''}`}>
    <div ref={clip} id={id} className="prompt-clip" onFocusCapture={event => {
      const target = event.target;
      if (collapsed && target instanceof HTMLElement) {
        onExpand(true); requestAnimationFrame(() => { target.scrollIntoView({ block: 'nearest' }); onSettled(); });
      }
    }}><div className="markdown" ref={text}><Markdown content={content} /></div></div>
    {long && <button className="prompt-toggle" aria-expanded={expanded} aria-controls={id} aria-label={expanded ? 'Show less of message' : 'Show full message'} onClick={toggle}>{expanded ? 'Show less' : 'Show more'}<ChevronDown size={13} /></button>}
  </div>;
}
export const toolLabels: Record<string, string> = { computer: 'Use computer', browser: 'Use browser', wait_tasks:'Wait for tasks',resolve_task:'Record task resolution', bulk_read:'Shunt reader',code_write:'Shunt writer', read_file: 'Read file', write_file: 'Write file', edit_file: 'Edit file', glob: 'Find files', grep: 'Search code', bash: 'Run command', web_fetch: 'Fetch page', web_search: 'Search web', view_image: 'View image', todo_write: 'Update plan', todo_read: 'Read plan', task: 'Research task', sidekick: 'Sidekick', delegate: 'Worker', verify: 'Driver verification', takeover: 'Driver takeover', ask_user: 'Ask a question', history_search: 'Search history', memory_remember: 'Remember fact', memory_forget: 'Forget fact', memory_recall: 'Recall memory' };
function ToolCard({ tool }: { tool: ToolCall }) {
  const onOpen = useContext(ToolOpenContext);
  const working = tool.status === 'running' || tool.status === 'pending' || tool.execution?.status === 'running';
  const failed = tool.status === 'error' || executionFailed(tool.execution);
  if(tool.shunt||tool.routing||tool.name==='bulk_read'||tool.name==='code_write')return <section className={`shunt-operation${tool.status==='error'||tool.status==='denied'?' failed':''}`} aria-label={tool.shunt?.kind==='writer'||tool.name==='code_write'?'Shunt writer':'Shunt reader'}>
    <div className="shunt-operation-heading">{working?<span className="working-dot"/>:tool.status==='completed'?<Check size={13}/>:<X size={13}/>}<span>{shuntLabel(tool)}</span></div>
    {typeof tool.args.question==='string'&&<p className="shunt-question">{String(tool.args.question)}</p>}
    {tool.output&&<div className="shunt-answer"><Markdown content={tool.output}/></div>}
    {tool.shunt&&<details className="shunt-sources"><summary>{tool.shunt.sources.length} source{tool.shunt.sources.length===1?'':'s'}{tool.shunt.target?` → ${tool.shunt.target}`:''}</summary>{tool.shunt.sources.map((source,index)=><div key={index}><code>{source.path}</code> · {source.lines} lines · {source.bytes} bytes<small>sha256 {source.sha256}</small></div>)}</details>}
  </section>;
  const title = (tool.name === 'capability' ? `${String(tool.args.operation)} ${String(tool.args.query ?? tool.args.name ?? '')}` : '') || tool.waitingForWorkspace || tool.args?.path || tool.args?.command || tool.args?.pattern || tool.args?.url;
  // Sidecar interception is VISIBLE by design (design note 4.5): the summary
  // row is tagged with the interceptor's name, and the expanded body shows the
  // unmodified original arguments above the (modified) executed ones.
  return <details className={`tool-card ${working ? 'working' : ''} ${failed ? 'failed' : ''}`}><summary><span className="tool-status">{working ? <span className="working-dot" /> : tool.status === 'completed' && !failed ? <Check size={13} /> : <X size={13} />}</span><span className="tool-name">{tool.name === 'capability' ? 'MCP tools' : toolLabels[tool.name] || tool.name}</span><span className="tool-summary">{typeof title === 'string' ? title : ''}</span>{tool.execution?.exitCode !== undefined && tool.execution.exitCode !== 0 && <span>exit {tool.execution.exitCode}</span>}{tool.intercepted && <span className="tool-intercepted-tag" title={tool.intercepted.reason}>modified by {tool.intercepted.by}</span>}<ChevronRight size={13} className="disclosure-chevron" /></summary><div className="tool-body">{onOpen && tool.status === 'completed' && ['read_file', 'write_file', 'edit_file', 'browser', 'computer'].includes(tool.name) && <button className="tool-open-button" onClick={() => onOpen(tool)}><File size={14} />Open in workspace<ChevronRight size={13} /></button>}{tool.intercepted && <><div className="tool-section-title">Original arguments</div><pre>{JSON.stringify(tool.intercepted.originalArgs, null, 2)}</pre></>}<div className="tool-section-title">Arguments</div><pre>{JSON.stringify(tool.args, null, 2)}</pre>{tool.mcpCalls && <><div className="tool-section-title">MCP calls</div><pre>{tool.mcpCalls.map(inner => `${inner.name} · ${inner.status} · ${inner.argumentBytes} argument bytes${inner.resultBytes === undefined ? '' : ` · ${inner.resultBytes} result bytes`}`).join('\n') || 'No tool calls yet.'}</pre></>}{tool.output !== undefined && <><div className="tool-section-title">{failed ? 'Error' : 'Result'}<CopyButton text={tool.output} /></div><pre>{tool.output || '(No output)'}</pre></>}</div></details>;
}
function Approval({ request, onDecide, onAllowAll, busy }: { request: PermissionRequest; onDecide: (id: string, decision: 'allow' | 'always' | 'project' | 'deny') => void; onAllowAll?: () => void; busy: boolean }) {
  const forced = request.ruleMatch?.decision === 'ask';
  const presentation = approvalPresentation(request, request.invocationId ? 'Worker' : 'Agent');
  return <section className="approval" aria-label="Permission requested">
    <div className="approval-heading"><span><Shield size={17} /></span><div><strong>{presentation.title}</strong><p>{request.description || `${toolLabels[request.tool] || request.tool} needs your permission.`}</p></div></div>
    {presentation.target && <p><strong>{presentation.target}</strong></p>}
    {presentation.body && <pre className="approval-preview">{presentation.body}</pre>}
    {request.scopeDescription && <p className="field-hint">Remember: {request.scopeDescription}.</p>}
    <details><summary>Review {toolLabels[request.tool]?.toLowerCase() || request.tool}<ChevronRight size={13} /></summary><pre>{JSON.stringify(request.args, null, 2)}</pre></details>
    {forced && <p className="field-hint">An explicit {request.ruleMatch!.source} rule requires approval each time.</p>}
    <div className="approval-actions"><button className="button secondary" disabled={busy} onClick={() => onDecide(request.id, 'deny')}>Deny</button>{!forced && <button className="text-button" title={request.scopePath ? `Remember this tool at ${request.scopePath} for this session and its workers.` : 'Remember this tool for this session and its workers.'} disabled={busy} onClick={() => onDecide(request.id, 'always')}>Remember for session</button>}<button className="button primary" disabled={busy} onClick={() => onDecide(request.id, 'allow')}>Allow once<Check size={14} /></button></div>
    {!forced && <div className="approval-mode"><button className="text-button" disabled={busy} onClick={() => onDecide(request.id, 'project')}>Remember for this project</button><span>Applies to the scope shown above; revoke in Settings → Permissions</span></div>}
    {!forced && onAllowAll && <div className="approval-mode"><button className="button secondary" disabled={busy} onClick={onAllowAll}>Allow all tools</button><span>This session and its workers · explicit rules still apply</span></div>}
  </section>;
}
export function Conversation({ onOpenUrl, messageFocus, onMessageFocused, onReview, onUndo, onOpenFile, onOpenTool, detail, connection, onDecide, onAllowAll, onFork, renderQuestion, renderTask, busy, readOnly = false, inline = false }: { onOpenUrl?: (url: string) => void; messageFocus?: { messageId: string; requestId: number }; onMessageFocused?: (found: boolean) => void; onReview?: (path?: string) => void; onUndo?: () => void; onOpenFile?: (link: FileLink) => void; onOpenTool?: (tool: ToolCall) => void; detail: SessionDetail; connection: 'connecting' | 'connected' | 'reconnecting'; onDecide: (id: string, decision: 'allow' | 'always' | 'project' | 'deny') => void; onAllowAll?: () => void; onFork: (messageId: string) => void; renderQuestion: (question: QuestionRequest) => ReactNode; renderTask?: (tool: ToolCall, message: Message, expanded: boolean) => ReactNode; busy: boolean; readOnly?: boolean; inline?: boolean }) {
  const { scroll, following, atBottom, setAtBottom, remember, hold, latest, onScroll, expandedSteps, setExpandedSteps, expandedPrompts, setExpandedPrompts } = useConversationReading(detail, inline);
  const [highlightedMessage, setHighlightedMessage] = useState(''); const lastFocused = useRef<number | undefined>(undefined);
  const running = detail.session.status === 'running' || detail.session.status === 'waiting';
  const last = detail.messages.filter(message => message.role !== 'tool').at(-1);
  const groups = conversationBlocks(detail.messages);
  const tasks=detail.delegations?.filter(task=>task.status==='running')??[];
  const workActivity=detail.permissions.length||detail.questions?.length?false:tasks.length>1?`${tasks.length} workers running`:tasks.length===1?`${tasks[0].role?tasks[0].role[0].toUpperCase()+tasks[0].role.slice(1):'Research'} · ${tasks[0].activity??tasks[0].description}`:undefined;
  const hasWork = groups.at(-1)?.closesTranscript && groups.at(-1)?.steps.some(message => message.reasoning || message.toolCalls?.length);
  useLayoutEffect(() => {
    if (!messageFocus || messageFocus.requestId === lastFocused.current || inline) return;
    const target = [...(scroll.current?.querySelectorAll<HTMLElement>('[data-message-id]') || [])].find(element => element.dataset.messageId === messageFocus.messageId);
    if (!target) { lastFocused.current = messageFocus.requestId; onMessageFocused?.(false); return; }
    // Let the new conversation and its composer finish laying out before
    // overriding the normal initial scroll to the latest message.
    following.current = false; setAtBottom(false); setHighlightedMessage(messageFocus.messageId);
    if (target.classList.contains('user-message')) setExpandedPrompts(current => new Set([...current, messageFocus.messageId]));
    const frame = requestAnimationFrame(() => { lastFocused.current = messageFocus.requestId; following.current = false; target.scrollIntoView({ block: target.clientHeight > (scroll.current?.clientHeight ?? 0) * .8 ? 'start' : 'center' }); target.focus({ preventScroll: true }); remember(); setAtBottom(false); onMessageFocused?.(true); });
    return () => cancelAnimationFrame(frame);
  }, [messageFocus?.requestId, inline]);
  useEffect(() => { if (!highlightedMessage) return; const timer = setTimeout(() => setHighlightedMessage(''), 6000); return () => clearTimeout(timer); }, [highlightedMessage]);
  return <WorkspaceLinksContext.Provider value={onOpenFile ? { workspace: detail.session.workspace, previous: previousWorkspaces(detail.messages, detail.session.workspace), onFile: onOpenFile, onUrl: onOpenUrl } : undefined}><ToolOpenContext.Provider value={onOpenTool}><WorkerRowsContext.Provider value={workerProjection(detail)}><div className="conversation-shell"><div className="conversation-scroll" ref={scroll} onScroll={onScroll}><div className="conversation-content">
    {detail.messages.length > 0 && <div className="conversation-start"><span />{new Date(detail.session.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}<span /></div>}
    {groups.map(({ message, startsRun, endsRun, closesTranscript, runUsage, steps }, index) => <MessageView promptExpanded={expandedPrompts.has(message.id)} onPromptExpand={open => { hold(); setExpandedPrompts(current => { const next = new Set(current); if (open) next.add(message.id); else next.delete(message.id); return next; }); }} onReadingSettled={remember} highlighted={message.id === highlightedMessage} lead={detail.session.architecture?.kind==='litefusion'} driver={!inline && Boolean(detail.session.architecture)} workerNoun={detail.session.architecture?.kind === 'expert-fusion' ? 'expert' : 'worker'} key={message.id} message={message} running={running && message.id === last?.id} grouped={message.role === 'assistant' && !startsRun} tail={endsRun} live={running && closesTranscript && index === groups.length - 1} runUsage={runUsage} steps={steps} forcedExpanded={steps.some(step=>step.toolCalls?.some(call=>call.taskId&&detail.tasks?.some(task=>task.id===call.taskId&&['queued','running','blocked'].includes(task.status))))} expanded={expandedSteps} onExpand={(key, open) => { hold(); setExpandedSteps(current => { const next = new Map(current); next.set(key,open); return next; }); }} inline={inline} workActivity={workActivity} onFork={() => onFork(message.id)} disabled={busy || running} readOnly={readOnly} renderTask={readOnly ? undefined : renderTask} />)}
    {!readOnly && !inline && onReview && detail.messages.length > 0 && <ChangeSummary sessionId={detail.session.id} revision={detail.session.updatedAt} running={running} onReview={onReview} onUndo={onUndo} />}
    {!detail.messages.length && <div className="session-empty"><h2>{readOnly ? 'No activity yet' : 'What should we work on?'}</h2></div>}
    {!readOnly && detail.questions?.map(renderQuestion)}
    {!readOnly && detail.permissions.map(request => <Approval key={request.id} request={request} onDecide={onDecide} onAllowAll={onAllowAll} busy={busy} />)}
    {running && !last?.content && !last?.reasoning && !hasWork && !detail.permissions.length && !detail.questions?.length && <div className="run-status" role="status"><LiteSpeed compact active /><span>{detail.session.status === 'waiting' ? detail.questions?.length ? 'Waiting for your answer' : 'Waiting for your approval' : detail.session.mode === 'plan' ? 'Exploring and planning' : last?.activity || 'Working'}<span className="animated-ellipsis">…</span></span></div>}
    {connection !== 'connected' && <div className="connection-status" role="status"><Clock3 size={13} />{connection === 'reconnecting' ? 'Reconnecting to your session… Your run continues on the server.' : 'Connecting to live updates…'}</div>}
  </div></div>{!atBottom && <button className="scroll-bottom" aria-label="Jump to latest" title="Jump to latest" onClick={latest}><ArrowDown size={16} /></button>}</div></WorkerRowsContext.Provider></ToolOpenContext.Provider></WorkspaceLinksContext.Provider>;
}
/** Show work live, then fold the completed block when prose continues. */
function WorkLog({ workerNoun, messages, live, renderTask, workActivity, expanded, onExpand }: { expanded: boolean; onExpand: (open: boolean) => void; messages: Message[]; live: boolean; workerNoun: string; workActivity?: string|false; renderTask?: (tool: ToolCall, message: Message, expanded: boolean) => ReactNode }) {
  const workerRows=useContext(WorkerRowsContext);
  const shown=(message:Message)=>(message.toolCalls??[]).filter(tool=>!workerRows.get(`${message.id}:${tool.id}`)?.hidden);
  const calls = messages.flatMap(message => shown(message).map(tool => ({ tool, message })));
  const thinking = messages.filter(message => message.reasoning);
  if (!calls.length && !thinking.length) return null;
  const current = calls.findLast(({ tool }) => tool.status === 'running' || tool.status === 'pending')?.tool;
  const working = live && workActivity!==false && Boolean(current || !messages.at(-1)?.content);
  const visible = live || expanded;
  const action = current && (current.args?.description || current.args?.path || current.args?.command || current.args?.pattern);
  const workers = calls.filter(({tool,message}) => tool.name === 'delegate'&&(!workerRows.has(`${message.id}:${tool.id}`)||workerRows.get(`${message.id}:${tool.id}`)?.logicalId));
  const runningWorkers = workers.filter(({tool}) => tool.status === 'running').length;
  const queuedWorkers = workers.filter(({tool}) => tool.status === 'pending').length;
  const workerStates = [runningWorkers && `${runningWorkers} running`, queuedWorkers && `${queuedWorkers} queued`].filter(Boolean).join(' · ');
  const label = workers.length ? `${workers.length} ${workerNoun}${workers.length === 1 ? '' : 's'}${working && workerStates ? ` · ${workerStates}` : ''}${calls.length > workers.length ? ` · ${calls.length - workers.length} other ${calls.length-workers.length===1?'step':'steps'}` : ''}` : working ? workActivity || (current ? `${toolLabels[current.name] || (current.name === 'sidekick' ? 'Sidekick' : current.name)}${typeof action === 'string' ? ` · ${action}` : ''}` : 'Thinking') : calls.length ? `${calls.length} ${calls.length === 1 ? 'step' : 'steps'}` : 'Thought process';
  const failed = calls.filter(({tool,message}) => {const issues=workerRows.get(`${message.id}:${tool.id}`)?.handoffs;return issues?issues.some(issue=>!issue.recovered):tool.status==='error'||tool.status==='denied';}).length;
  const modified = calls.filter(({ tool }) => tool.intercepted).length;
  return <details className={`work-log${working ? ' active' : ''}`} aria-label="Response steps" open={visible}>
    <summary onClick={event => { event.preventDefault(); if (!live) onExpand(!expanded); }}>{working ? <span className="working-dot" /> : <Check size={13} />}<span>{label}</span>{failed > 0 && <span className="work-warning">{failed} {failed === 1 ? 'issue' : 'issues'}</span>}{modified > 0 && <span className="work-warning">{modified} modified {modified === 1 ? 'tool' : 'tools'}</span>}<ChevronRight size={13} className="disclosure-chevron" /></summary>
    <div className="work-log-body">
      {messages.map(message => <div key={message.id}>{message.reasoning && <div className="thinking-inline markdown"><Markdown content={message.reasoning} /></div>}
        {toolGroups(shown(message)).map(group => group[0].name === 'delegate' ? <div className="worker-grid" key={group[0].id}>{group.map(tool => <div key={tool.id}>{renderTask?.(tool, message, visible) ?? <ToolCard tool={tool} />}</div>)}</div> : group.map(tool => <div key={tool.id}>{renderTask?.(tool, message, visible) ?? <ToolCard tool={tool} />}</div>))}
      </div>)}
    </div>
  </details>;
}
/** Keep adjacent workers together without moving them across driver tool calls. */
function toolGroups(tools: ToolCall[]): ToolCall[][] {
  const groups: ToolCall[][] = [];
  for (const tool of tools) {
    const previous = groups.at(-1);
    if (tool.name === 'delegate' && previous?.[0].name === 'delegate') previous.push(tool);
    else groups.push([tool]);
  }
  return groups;
}
function MessageView({ forcedExpanded, promptExpanded, onPromptExpand, onReadingSettled, highlighted, lead, driver, workerNoun, message, running, grouped, tail, live, runUsage, steps, workActivity, onFork, disabled, readOnly, renderTask, inline, expanded, onExpand }: { promptExpanded: boolean; onPromptExpand: (open: boolean) => void; onReadingSettled: () => void; highlighted?: boolean; forcedExpanded: boolean; expanded: ReadonlyMap<string, boolean>; onExpand: (key: string, open: boolean) => void; lead?:boolean; driver: boolean; workerNoun: string; message: Message; running: boolean; grouped: boolean; tail: boolean; live: boolean; runUsage?: Usage; steps: Message[]; workActivity?: string|false; onFork: () => void; disabled: boolean; readOnly?: boolean; inline?: boolean; renderTask?: (tool: ToolCall, message: Message, expanded: boolean) => ReactNode }) {
  const links = useContext(WorkspaceLinksContext);
  const steering = steeringContent(message);
  if (steering !== undefined) message = { ...message, content: steering };
  if (message.role === 'system' && message.workspaceMove) return <details className="workspace-move-message"><summary><GitFork size={13} /><span>{message.workspaceMove.destination === 'local' ? 'Continued in the local project' : 'Continued in a working copy'}</span><ChevronRight size={13} className="disclosure-chevron" /></summary><div><dl><dt>Previous workspace</dt><dd>{message.workspaceMove.from}</dd><dt>{message.workspaceMove.destination === 'local' ? 'Local project' : 'Working copy'}</dt><dd>{message.workspaceMove.to}</dd></dl><p>Your previous workspace is preserved. Undo is available for new turns here.</p></div></details>;
  if (message.role === 'system' && steering === undefined) return <div className="system-message"><Terminal size={12} />{message.content}</div>;
  const assistant = message.role === 'assistant';
  const content = assistant ? withoutVerificationNotice(message.content, message.receipts) : message.content;
  return <article className={`message ${assistant ? 'assistant-message' : 'user-message'}${grouped ? ' grouped' : ''}${highlighted ? ' search-highlight' : ''}`} data-message-id={message.id} tabIndex={-1} aria-label={assistant ? 'Assistant message' : inline ? 'Assignment' : 'Your message'}>
    {assistant && !grouped && <div className="message-byline"><Logo small /><span>Litespeed</span></div>}
    <div className="message-body">{assistant && driver && (message.content || !message.toolCalls?.some(tool => tool.name === 'delegate' || tool.name === 'sidekick')) && <div className="driver-identity">{lead?'Lead':'Driver'}</div>}
      {!assistant && content && (inline ? <details className="task-assignment"><summary>Assignment</summary><div className="markdown"><Markdown content={content} /></div></details> : <PromptContent content={content} expanded={promptExpanded || Boolean(highlighted)} onExpand={onPromptExpand} onSettled={onReadingSettled} />)}
      {assistant && responseBlocks(steps).map((block, index, blocks) => block.kind === 'text'
        ? <div className="markdown" key={block.key}><Markdown content={block.content} /></div>
        : <WorkLog key={block.key} workerNoun={workerNoun} expanded={forcedExpanded || (expanded.get(block.key) ?? expanded.get(message.id) ?? inline ?? false)} onExpand={open => onExpand(block.key, open)} messages={block.messages} live={live && index === blocks.length - 1} renderTask={renderTask} workActivity={workActivity} />)}
      {message.attachments && message.attachments.length > 0 && <Attachments attachments={message.attachments} workspace={links?.workspace} previousWorkspaces={links?.previous} onOpenFile={links ? path => links.onFile({ path }) : undefined} />}

      {message.error && <div className="inline-alert" role="alert">{message.error}</div>}
    </div>
    {assistant && tail && !live && !inline && <div className="message-actions"><CopyButton text={content} />{!readOnly && <button className="icon-button" onClick={onFork} disabled={disabled} aria-label="Fork session at this message" title="Fork from here"><GitFork size={13} /></button>}{runUsage && <UsageDetails usage={runUsage} family={steps.at(-1)?.turnUsage} />}</div>}
  </article>;
}

function UsageDetails({usage,family}:{usage:Usage;family?:Message['turnUsage']}) {
  const complete=!family||family.reportedRequests===family.requests;
  const reported=!family||family.reportedRequests>0;
  const rows=new Map<string,{label:string;input:number;output:number;requests:number;reported:number;usage:Usage[]}>();
  for(const record of family?.breakdown??[]) {
    const key=JSON.stringify([record.providerId,record.model,record.role,record.phase]);
    const row=rows.get(key)??{label:`${record.role==='lead'?'Driver':record.role[0].toUpperCase()+record.role.slice(1)} · ${record.model}${record.phase==='response'?'':` · ${usagePhase(record.phase)}`}`,input:0,output:0,requests:0,reported:0,usage:[]};
    row.requests++;if(record.usage){row.reported++;row.input+=record.usage.inputTokens;row.output+=record.usage.outputTokens;row.usage.push(record.usage);}rows.set(key,row);
  }
  const summary=<>{reported?`${(usage.inputTokens+usage.outputTokens).toLocaleString()} tokens${complete?'':' reported'}`:'Usage unavailable'}{` · ${cacheHitLabel(family?.breakdown.map(record=>record.usage)??usage)}`}{usage.durationMs?` · ${(usage.durationMs/1000).toFixed(1)}s`:''}{usage.cost!==undefined?` · $${usage.cost.toFixed(4)}`:''}</>;
  const cacheHelp='Cache hit = cached input tokens / input tokens for requests reporting both. Missing reports and output tokens are excluded.';
  return family?<details className="usage usage-details"><summary title={cacheHelp}>{summary}</summary><div className="usage-breakdown">{[...rows].map(([key,row])=><div key={key}><strong>{row.label}</strong><span>{row.reported?`${row.input.toLocaleString()} in · ${row.output.toLocaleString()} out`:'Usage not reported'}{` · ${cacheHitLabel(row.usage)}`}{row.reported<row.requests?` · ${row.requests-row.reported} request(s) unreported`:''}</span></div>)}</div></details>:<span className="usage" title={cacheHelp}>{summary}</span>;
}
