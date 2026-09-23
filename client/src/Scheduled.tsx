import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CalendarClock, Check, ChevronDown, Clock3, Folder, MoreHorizontal, Pause, Pencil, Play, Plus, Search, Trash2, X } from 'lucide-react';
import type { ScheduleList, ScheduleRun, ScheduledTask, ScheduleTiming } from '../../shared/schedules';
import { scheduleLabel, scheduleRunLabels } from '../../shared/schedules';
import type { Settings } from '../../shared/types';
import { api, errorMessage, patch, post } from './api';
import type { Selection } from './Composer';
import { ModelPicker } from './ModelPicker';
import { ProjectPicker } from './ProjectPicker';
import { EmptyState, LiteSpeed, Modal } from './ui';
import { navigateTabs } from './tab-navigation';

const folderName = (path: string) => path.split('/').filter(Boolean).at(-1) || path;
const dateLabel = (stamp: number) => new Date(stamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const isActive = (run: ScheduleRun) => ['starting', 'running', 'waiting'].includes(run.status);

export function Scheduled({ workspace, projects, settings, selection, onOpen, onChanged, onSettings }: {
  workspace: string; projects: string[]; settings: Settings; selection: Selection;
  onOpen: (id: string) => void; onChanged: () => void; onSettings: () => void;
}) {
  const [data, setData] = useState<ScheduleList | null>(null), [error, setError] = useState('');
  const [tab, setTab] = useState<'tasks' | 'activity'>('tasks'), [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ScheduledTask | 'new' | null>(null), [removing, setRemoving] = useState<ScheduledTask | null>(null);
  const [busy, setBusy] = useState<string | null>(null), [dialogError, setDialogError] = useState('');
  const alive = useRef(true), generation = useRef(0), operation = useRef(false);
  const load = useCallback(async () => {
    const version = ++generation.current;
    try { const next = await api<ScheduleList>('/schedules'); if (alive.current && version === generation.current) { setData(next); setError(''); } }
    catch (e) { if (alive.current && version === generation.current) setError(errorMessage(e)); }
  }, []);
  useEffect(() => {
    alive.current = true; void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 5000);
    const visible = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', visible);
    return () => { alive.current = false; generation.current++; clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [load]);
  async function act(id: string, fn: () => Promise<void>) {
    if (operation.current) return; operation.current = true; setBusy(id); setError('');
    try { await fn(); onChanged(); if (alive.current) await load(); }
    catch (e) { if (alive.current) setError(errorMessage(e)); }
    finally { operation.current = false; if (alive.current) setBusy(null); }
  }
  const matches = (...values: string[]) => values.join(' ').toLowerCase().includes(search.toLowerCase());
  const tasks = data?.schedules.filter(task => matches(task.name, task.prompt, task.workspace)) ?? [];
  const runs = data?.runs.filter(run => matches(run.name, scheduleRunLabels[run.status])) ?? [];
  return <section className="catalog-page scheduled-page" aria-label="Scheduled tasks">
    <header className="catalog-heading"><div><h1>Scheduled</h1><p>Set a task. Come back to the results.</p></div><button className="button primary" onClick={() => setEditing('new')}><Plus size={15} />New scheduled task</button></header>
    <div className="catalog-controls"><div className="catalog-tabs" role="tablist" aria-label="Scheduled views" onKeyDown={navigateTabs}>{([{ id: 'tasks', label: 'Tasks' }, { id: 'activity', label: 'Activity' }] as const).map(item => <button key={item.id} role="tab" aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => { setTab(item.id); setSearch(''); }}>{item.label}</button>)}</div><label className="catalog-search"><Search size={15} /><input aria-label="Search scheduled tasks" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />{search && <button aria-label="Clear scheduled search" onClick={() => setSearch('')}><X size={13} /></button>}</label></div>
    {error && <div className="inline-alert" role="alert">{error}<button className="text-button" onClick={() => void load()}>Retry</button></div>}
    {!data ? <div className="panel-loading"><LiteSpeed compact active />Loading…</div> : <div role="tabpanel" aria-label={tab === 'tasks' ? 'Scheduled tasks' : 'Scheduled activity'}>
      {tab === 'tasks' ? tasks.length ? <div className="schedule-list">{tasks.map(task => {
        const currentRun = data.runs.find(run => run.scheduleId === task.id && isActive(run));
        return <article className="schedule-row" key={task.id}>
          <span className={`schedule-symbol ${task.status}`}><CalendarClock size={20} /></span>
          <button className="schedule-description" onClick={() => setEditing(task)}><span className="schedule-title">{task.name}{currentRun && <span className="schedule-inline-state">{scheduleRunLabels[currentRun.status]}</span>}{task.status !== 'active' && <span className="schedule-badge">{task.status === 'paused' ? 'Paused' : 'Finished'}</span>}</span><span className="schedule-prompt">{task.prompt}</span><span className="schedule-meta"><span><Folder size={12} />{folderName(task.workspace)}</span><span><Clock3 size={12} />{scheduleLabel(task.timing)}</span></span></button>
          <div className="schedule-next">{currentRun ? <button className={`schedule-run-status ${currentRun.status}`} onClick={() => currentRun.sessionId && onOpen(currentRun.sessionId)}><i />{scheduleRunLabels[currentRun.status]}<ArrowUpRight size={12} /></button> : task.nextRunAt ? <><span>Next run</span><time dateTime={new Date(task.nextRunAt).toISOString()}>{dateLabel(task.nextRunAt)}</time></> : <span>{task.status === 'paused' ? 'Schedule paused' : 'No upcoming runs'}</span>}</div>
          <div className="schedule-actions">{currentRun ? <button className="icon-button" aria-label={`Open ${task.name} run`} title="Open running task" disabled={!currentRun.sessionId} onClick={() => currentRun.sessionId && onOpen(currentRun.sessionId)}><ArrowUpRight size={16} /></button> : <button className="icon-button" aria-label={`Run ${task.name} now`} title="Run now" disabled={Boolean(busy || currentRun)} onClick={() => void act(task.id, async () => { const run = await post<ScheduleRun>(`/schedules/${task.id}/run`); if (run.status === 'failed' && run.error) throw new Error(run.error); if (run.sessionId && alive.current) onOpen(run.sessionId); })}><Play size={15} /></button>}<details className="schedule-menu"><summary aria-label={`Actions for ${task.name}`}><MoreHorizontal size={18} /></summary><div className="schedule-menu-items"><button onClick={e => { e.currentTarget.closest('details')?.removeAttribute('open'); setEditing(task); }}><Pencil size={14} />Edit task</button>{task.status !== 'completed' && <button disabled={Boolean(busy)} onClick={e => { e.currentTarget.closest('details')?.removeAttribute('open'); void act(task.id, async () => { await patch(`/schedules/${task.id}`, { expectedRevision: task.revision, status: task.status === 'active' ? 'paused' : 'active' }); }); }}>{task.status === 'active' ? <Pause size={14} /> : <Play size={14} />}{task.status === 'active' ? 'Pause schedule' : 'Resume schedule'}</button>}<button className="danger" disabled={Boolean(currentRun || busy)} onClick={e => { e.currentTarget.closest('details')?.removeAttribute('open'); setRemoving(task); setDialogError(''); }}><Trash2 size={14} />Delete schedule</button></div></details></div>
        </article>;
      })}</div> : <EmptyState icon={<CalendarClock size={34} />} title={search ? 'No matching tasks' : 'No scheduled tasks yet'}>{search ? 'Try another search.' : 'Schedule a code review, a daily briefing, or a recurring check.'}{!search && <button className="button secondary" onClick={() => setEditing('new')}><Plus size={15} />Create a scheduled task</button>}</EmptyState> : runs.length ? <div className="schedule-activity-list">{runs.map(run => <div className="schedule-activity-row" key={run.id}><span className={`schedule-activity-icon ${run.status}`}>{run.status === 'completed' ? <Check size={17} /> : run.status === 'running' || run.status === 'starting' ? <LiteSpeed active compact /> : <Clock3 size={17} />}</span><div><button className="schedule-result-name" disabled={!run.sessionId} onClick={() => run.sessionId && onOpen(run.sessionId)}>{run.name}{run.sessionId && <ArrowUpRight size={13} />}</button><span className="schedule-activity-date">{dateLabel(run.startedAt)}{run.trigger === 'manual' && ' · Run manually'}</span>{run.error && <p>{run.error}</p>}</div><span className={`schedule-run-status ${run.status}`}>{scheduleRunLabels[run.status]}</span></div>)}</div> : <EmptyState icon={<Clock3 size={32} />} title={search ? 'No matching runs' : 'No runs yet'}>Results will appear here after a scheduled task runs.</EmptyState>}
      <p className="schedule-local-note"><span className={data.running ? 'online' : ''} />{data.running ? 'Runs on this computer while Litespeed is open.' : 'The scheduler is offline. Restart Litespeed to enable scheduled runs.'}</p>
    </div>}
    {editing && <ScheduleEditor task={editing === 'new' ? undefined : editing} workspace={workspace} projects={projects} selection={selection} settings={settings} onClose={() => setEditing(null)} onSettings={onSettings} onSaved={() => { onChanged(); if (alive.current) { setEditing(null); void load(); } }} />}
    {removing && <Modal title={`Delete ${removing.name}?`} onClose={() => { if (!busy) setRemoving(null); }}><div className="schedule-delete-body"><p>This removes the schedule and its run list. Conversations and files from past runs stay in your projects.</p>{dialogError && <div className="inline-alert" role="alert">{dialogError}</div>}</div><div className="modal-footer"><button className="button secondary" disabled={Boolean(busy)} onClick={() => setRemoving(null)}>Cancel</button><button className="button danger" disabled={Boolean(busy)} onClick={async () => { if (operation.current) return; operation.current = true; setBusy(removing.id); try { await api(`/schedules/${removing.id}?revision=${removing.revision}`, { method: 'DELETE' }); onChanged(); if (alive.current) { setRemoving(null); await load(); } } catch (e) { if (alive.current) setDialogError(errorMessage(e)); } finally { operation.current = false; if (alive.current) setBusy(null); } }}>Delete schedule</button></div></Modal>}
  </section>;
}

function ScheduleEditor({ task, workspace, projects, settings, selection, onClose, onSaved, onSettings }: {
  task?: ScheduledTask; workspace: string; projects: string[]; settings: Settings; selection: Selection;
  onClose: () => void; onSaved: () => void; onSettings: () => void;
}) {
  const [name, setName] = useState(task?.name ?? ''), [prompt, setPrompt] = useState(task?.prompt ?? '');
  const [project, setProject] = useState(task?.workspace ?? workspace), [model, setModel] = useState<Selection>(task?.selection ?? selection);
  const [timing, setTiming] = useState<ScheduleTiming>(task?.timing ?? { kind: 'daily', time: '09:00', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  const [view, setView] = useState<'editor' | 'project' | 'model'>('editor');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [nextRun, setNextRun] = useState<number | null>(task?.nextRunAt ?? null), [checking, setChecking] = useState(true);
  const alive = useRef(true), saving = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let current = true; setChecking(true); const timer = setTimeout(() => { void post<{ nextRunAt: number | null }>('/schedules/preview', { timing }).then(result => { if (current) setNextRun(result.nextRunAt); }).catch(() => { if (current) setNextRun(null); }).finally(() => { if (current) setChecking(false); }); }, 150);
    return () => { current = false; clearTimeout(timer); };
  }, [timing]);
  const close = () => { if (!saving.current) onClose(); };
  const changeRepeat = (kind: ScheduleTiming['kind']) => {
    const calendar = timing.kind === 'daily' || timing.kind === 'weekly' ? { time: timing.time, timezone: timing.timezone } : { time: '09:00', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    setTiming(kind === 'once' ? { kind, at: Math.ceil((Date.now() + 60 * 60_000) / 60_000) * 60_000 } : kind === 'hourly' ? { kind, every: 1 } : kind === 'daily' ? { kind, ...calendar } : { kind, ...calendar, days: [1, 2, 3, 4, 5] });
  };
  async function save() {
    if (saving.current) return; saving.current = true; setBusy(true); setError('');
    try {
      const selected = { providerId: model.providerId, model: model.model, mode: model.mode, permissionMode: model.permissionMode, architecture: model.architecture ?? null, planner: model.planner ?? null, shunt: model.shunt ?? null, outputStyle: model.outputStyle ?? null, modelReasoning: model.modelReasoning, commandSandbox: task?.selection.commandSandbox };
      const body = { name, prompt, workspace: project, timing, selection: selected };
      if (task) await patch(`/schedules/${task.id}`, { ...body, expectedRevision: task.revision, ...(task.status === 'completed' ? { status: 'active' } : {}) });
      else await post('/schedules', body);
      onSaved();
    } catch (e) { if (alive.current) setError(errorMessage(e)); }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  if (view === 'project') return <ProjectPicker current={project} projects={projects} onChoose={path => { setProject(path); setView('editor'); }} onClose={() => setView('editor')} />;
  if (view === 'model') return <ModelPicker settings={settings} selection={model} workspace={project} onChange={setModel} onClose={() => setView('editor')} onSettings={() => { onClose(); onSettings(); }} />;
  const localDate = timing.kind === 'once' && Number.isFinite(timing.at) ? new Date(timing.at - new Date(timing.at).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '';
  return <Modal title={task ? 'Edit scheduled task' : 'New scheduled task'} onClose={close}>
    <form className="schedule-form" onSubmit={e => { e.preventDefault(); void save(); }}>
      <div className="schedule-form-body">
        <label className="schedule-field">Name<input autoFocus required maxLength={120} value={name} placeholder="Daily code review" disabled={busy} onChange={e => setName(e.target.value)} /></label>
        <label className="schedule-field">Instructions<textarea required maxLength={200000} value={prompt} placeholder="Review recent changes and flag anything that needs my attention…" rows={5} disabled={busy} onChange={e => setPrompt(e.target.value)} /></label>
        <div className="schedule-field">Project<button type="button" className="schedule-choice" title={project} disabled={busy} onClick={() => setView('project')}><Folder size={15} /><span>{folderName(project)}</span><ChevronDown size={14} /></button></div>
        <div className="schedule-time-row"><label className="schedule-field">Repeat<select value={timing.kind} disabled={busy} onChange={e => changeRepeat(e.target.value as ScheduleTiming['kind'])}><option value="daily">Every day</option><option value="weekly">Every week</option><option value="hourly">Every few hours</option><option value="once">Once</option></select></label>{timing.kind === 'hourly' ? <label className="schedule-field">Hours between runs<input type="number" min={1} max={168} required value={timing.every} disabled={busy} onChange={e => setTiming({ kind: 'hourly', every: Number(e.target.value) })} /></label> : timing.kind === 'once' ? <label className="schedule-field">Date and time<input type="datetime-local" required value={localDate} disabled={busy} onChange={e => setTiming({ kind: 'once', at: new Date(e.target.value).getTime() })} /></label> : <label className="schedule-field">Time<input type="time" required value={timing.time} disabled={busy} onChange={e => setTiming({ ...timing, time: e.target.value })} /></label>}</div>
        {timing.kind === 'weekly' && <fieldset className="schedule-days"><legend>Days</legend>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => <button type="button" key={day} disabled={busy} aria-label={day} aria-pressed={timing.days.includes(index)} onClick={() => setTiming({ ...timing, days: timing.days.includes(index) ? timing.days.filter(day => day !== index) : [...timing.days, index] })}>{day}</button>)}</fieldset>}
        <p className="schedule-preview"><Clock3 size={13} />{checking ? 'Checking schedule…' : nextRun ? `Next run ${dateLabel(nextRun)}` : 'Choose a future run time'}{timing.kind !== 'once' && timing.kind !== 'hourly' && <span>{timing.timezone.replaceAll('_', ' ')}</span>}</p>
        <div className="schedule-field">Model<button type="button" className="schedule-choice" disabled={busy} onClick={() => setView('model')}><span>{model.model || 'Choose a model'}</span><ChevronDown size={14} /></button></div>
        <details className="schedule-options"><summary>More options</summary>{(timing.kind === 'daily' || timing.kind === 'weekly') && <label className="schedule-field">Time zone<input value={timing.timezone} disabled={busy} onChange={e => setTiming({ ...timing, timezone: e.target.value })} placeholder="America/Los_Angeles" /></label>}<div className="schedule-time-row"><label className="schedule-field">Mode<select value={model.mode} disabled={busy} onChange={e => setModel({ ...model, mode: e.target.value as Selection['mode'] })}><option value="build">Build</option><option value="plan">Plan</option></select></label><label className="schedule-field">Permissions<select value={model.permissionMode} disabled={busy} onChange={e => setModel({ ...model, permissionMode: e.target.value as Selection['permissionMode'] })}><option value="ask">Ask before changes</option><option value="edit">Allow file edits</option><option value="auto">Full access</option></select></label></div><p className="field-hint">Approvals appear in the task when they are needed.</p></details>
        {error && <div className="inline-alert" role="alert">{error}</div>}
      </div>
      <div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={close}>Cancel</button><button type="submit" className="button primary" disabled={busy || !name.trim() || !prompt.trim() || !model.model || !nextRun || checking}>{busy ? 'Saving…' : task ? 'Save changes' : 'Create task'}</button></div>
    </form>
  </Modal>;
}
