import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Check, ChevronRight, Circle, File, FileCode2, Folder, GitCompareArrows, Globe2, ListTodo, Monitor, PanelRightClose, RefreshCw, ScanLine, Search, X } from 'lucide-react';
import type { FileEntry, Todo } from '../../shared/types';
import { api, errorMessage, query } from './api';
import { EmptyState, LiteSpeed } from './ui';
import { navigateTabs } from './tab-navigation';
import { BrowserPanel } from './BrowserPanel';
import { ComputerPanel } from './ComputerPanel';
import type { FilePreview as Preview } from '../../shared/file-preview';
import type { BrowserComment } from './BrowserAnnotation';
import type { WorkspaceTarget } from './workspace-activity';
import { documentViewState } from './document-state';
import type { FileLink } from './file-links';

import type { ReviewComment } from '../../shared/git-review';
type Tab = 'files' | 'changes' | 'todos' | 'browser' | 'computer';
type Props = { onTargetHandled?: (revision: number) => void; workspace: string; sessionId?: string; todos: Todo[]; refreshKey: number; fileRefreshKey?: number; onClose: () => void; onUndo?: () => void; undoLabel?: string; onComment?: (comment: ReviewComment) => void; onBrowserComment?: (comment: BrowserComment) => boolean; running: boolean; target?: WorkspaceTarget | null; followActivity?: boolean; onFollowActivity?: (value: boolean) => void };
const ReviewPanel = lazy(() => import('./ReviewPanel').then(module => ({ default: module.ReviewPanel })));
const DocumentViewer = lazy(() => import('./DocumentViewer').then(module => ({ default: module.DocumentViewer })));

export function Workspace({ onTargetHandled, workspace, sessionId, todos, refreshKey, fileRefreshKey = 0, onClose, onUndo, undoLabel, onComment, onBrowserComment, running, target, followActivity = true, onFollowActivity }: Props) {
  const [tab, setTab] = useState<Tab>('files');
  const [path, setPath] = useState('');
  const directory = JSON.stringify([workspace, path]);
  const [listing, setListing] = useState<{ directory: string; entries: FileEntry[] } | null>(null);
  const entries = listing?.directory === directory ? listing.entries : [];
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [files, setFiles] = useState<Preview[]>([]);
  const filesRef = useRef(files); filesRef.current = files;
  const previewVersions = useRef(new Map<string, number>()), branchRevision = useRef(0);
  const [refreshingFiles, setRefreshingFiles] = useState<string[]>([]), [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState('');
  const [filter, setFilter] = useState('');
  const [activeLine, setActiveLine] = useState<number | undefined>();
  const [lineRevision, setLineRevision] = useState(0);
  const staleFiles = useRef(new Set<string>());
  const [fileRefreshEpoch, setFileRefreshEpoch] = useState(0);
  const [width, setWidth] = useState(() => { try { return Math.min(760, Math.max(340, Number(localStorage.getItem('litespeed.workspace-width')) || 480)); } catch { return 480; } });
  const request = useRef(0);
  const panel = useRef<HTMLElement>(null), browseButton = useRef<HTMLButtonElement>(null);
  const fileButtons = useRef(new Map<string, HTMLButtonElement>()), pendingFileFocus = useRef<string | null | undefined>(undefined);
  const fileCommandRef = useRef<(command: string) => boolean>(() => false);
  const closedDuringRestore = useRef(new Set<string>());
  const storageKey = `litespeed.workspace-tabs:${sessionId ?? 'new'}:${workspace}`;
  const [restored, setRestored] = useState(false);
  const restoredRef = useRef(restored); restoredRef.current = restored;
  const [restoreEpoch, setRestoreEpoch] = useState(0);
  const alive = useRef(true);
  const preview = files.find(file => file.path === activeFile);
  const invalidateFiles = useCallback(() => {
    for (const file of filesRef.current) staleFiles.current.add(file.path);
    setFileRefreshEpoch(value => value + 1);
  }, []);
  useEffect(() => { invalidateFiles(); }, [refreshKey, fileRefreshKey, invalidateFiles]);
  useEffect(() => {
    const visible = () => { if (!document.hidden) invalidateFiles(); };
    const focus = (event: FocusEvent) => { if (!(event.relatedTarget instanceof Node) || !panel.current?.contains(event.relatedTarget)) visible(); };
    const element = panel.current; element?.addEventListener('focusin', focus);
    window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible); element?.removeEventListener('focusin', focus); };
  }, [invalidateFiles]);
  useEffect(() => {
    if (!restored || tab !== 'files' || !activeFile || previewLoading || refreshingFiles.includes(activeFile) || document.hidden || !staleFiles.current.has(activeFile)) return;
    const path = activeFile, controller = new AbortController();
    let current = true, started = false, finished = false;
    // Coalesce bursts of file/command activity and keep the current document mounted.
    const timer = setTimeout(() => {
      started = true; staleFiles.current.delete(path);
      const version = (previewVersions.current.get(path) || 0) + 1; previewVersions.current.set(path, version);
      void api<Preview>(`/file-preview?${query({ workspace, path })}`, { signal: controller.signal }).then(file => {
        if (!current || !alive.current || previewVersions.current.get(path) !== version) return;
        setFiles(files => files.map(previous => previous.path !== path || JSON.stringify(previous) === JSON.stringify(file) ? previous : file));
        setFileErrors(errors => { if (!errors[path]) return errors; const next = { ...errors }; delete next[path]; return next; });
      }).catch(error => {
        if (current && alive.current && previewVersions.current.get(path) === version) setFileErrors(errors => ({ ...errors, [path]: errorMessage(error) }));
      }).finally(() => { finished = true; });
    }, 150);
    return () => {
      current = false; clearTimeout(timer); controller.abort();
      if (started && !finished && filesRef.current.some(file => file.path === path)) staleFiles.current.add(path);
    };
  }, [workspace, restored, tab, activeFile, previewLoading, refreshingFiles, fileRefreshEpoch]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current++; }; }, []);
  useEffect(() => {
    const handle = (event: Event) => {
      if (!event.defaultPrevented && !document.querySelector('[aria-modal="true"]') && panel.current?.contains(document.activeElement) && fileCommandRef.current((event as CustomEvent<string>).detail)) event.preventDefault();
    };
    window.addEventListener('litespeed:workspace-command', handle);
    return () => window.removeEventListener('litespeed:workspace-command', handle);
  }, []);
  useEffect(() => { setPath(''); setFiles([]); setActiveFile(null); setError(''); request.current++; }, [workspace, sessionId]);
  useEffect(() => {
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail?.workspace !== workspace) return;
      branchRevision.current++; request.current++; setPreviewLoading(''); setRefresh(value => value + 1); setActiveLine(undefined);
      // A branch notification can arrive just after a task changes folders.
      // Restart its pending tab restoration instead of accepting an empty panel.
      if (!restoredRef.current) { setRestoreEpoch(value => value + 1); return; }
      const paths = filesRef.current.map(file => file.path); setRefreshingFiles(paths); setFileErrors({});
      for (const path of paths) {
        const version = (previewVersions.current.get(path) || 0) + 1; previewVersions.current.set(path, version);
        void api<Preview>(`/file-preview?${query({ workspace, path })}`).then(file => {
          if (alive.current && previewVersions.current.get(path) === version) { staleFiles.current.delete(path); setFiles(current => current.map(value => value.path === path ? file : value)); }
        }).catch(e => {
          if (alive.current && previewVersions.current.get(path) === version) setFileErrors(current => ({ ...current, [path]: errorMessage(e) }));
        }).finally(() => { if (alive.current && previewVersions.current.get(path) === version) setRefreshingFiles(current => current.filter(value => value !== path)); });
      }
    };
    window.addEventListener('litespeed:git-changed', changed); return () => window.removeEventListener('litespeed:git-changed', changed);
  }, [workspace]);
  useEffect(() => {
    const version = request.current, branch = branchRevision.current;
    let live = true;
    closedDuringRestore.current.clear();
    setRestored(false);
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      const paths = Array.isArray(saved.paths) ? saved.paths.filter((item: unknown): item is string => typeof item === 'string').slice(-12) : [];
      void Promise.allSettled(paths.map((file: string) => api<Preview>(`/file-preview?${query({ workspace, path: file })}`))).then(results => {
        if (!live) return;
        if (branch !== branchRevision.current) return;
        const unavailable: Record<string, string> = {};
        const opened = results.flatMap((result, index): Preview[] => {
          const path = paths[index]; if (closedDuringRestore.current.has(path)) return [];
          if (result.status === 'fulfilled') return [result.value];
          if (!previewVersions.current.has(path)) unavailable[path] = errorMessage(result.reason);
          return [{ path, kind: 'text', mimeType: 'text/plain', size: 0, content: '' }];
        });
        setFileErrors(current => ({ ...unavailable, ...current }));
        if (version !== request.current) {
          setFiles(current => [...new Map([...opened, ...current].map(file => [file.path, file])).values()].slice(-12));
          setRestored(true); return;
        }
        setFiles(opened); setActiveFile(opened.some(file => file.path === saved.activeFile) ? saved.activeFile : null);
        if (['files', 'changes', 'todos', 'browser', 'computer'].includes(saved.tab)) setTab(saved.tab);
        setRestored(true);
      });
    } catch { setRestored(true); }
    return () => { live = false; };
  }, [storageKey, workspace, restoreEpoch]);
  useEffect(() => {
    if (!restored) return;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}'), paths = files.map(file => file.path);
      const views = Object.fromEntries(paths.map(path => [path, documentViewState(saved.views?.[path])]));
      localStorage.setItem(storageKey, JSON.stringify({ paths, activeFile, tab, views }));
    } catch {}
  }, [files, activeFile, tab, storageKey, restored]);
  useEffect(() => { try { localStorage.setItem('litespeed.workspace-width', String(width)); } catch {} }, [width]);
  useEffect(() => {
    let live = true; setLoading(true); setError('');
    const load = async () => {
      if (tab === 'files') { const r = await api<{ entries: FileEntry[] }>(`/files?${query({ workspace, path })}`); if (live) setListing({ directory, entries: r.entries }); }

    };
    void load().catch(e => { if (live) setError(errorMessage(e)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [workspace, path, tab, sessionId, refreshKey, fileRefreshKey, fileRefreshEpoch, refresh]);
  const openFile = useCallback(async (file: string, line?: number) => {
    const version = ++request.current;
    previewVersions.current.set(file, (previewVersions.current.get(file) || 0) + 1);
    setRefreshingFiles(current => current.filter(value => value !== file));
    setPreviewLoading(file); setError(''); setTab('files');
    try {
      const result = await api<Preview>(`/file-preview?${query({ workspace, path: file })}`);
      if (!alive.current || version !== request.current) return;
      // Keep at most twelve tabs; stale reads cannot steal focus from a newer selection.
      setFiles(current => current.some(item => item.path === result.path) ? current.map(item => item.path === result.path ? result : item) : [...current, result].slice(-12));
      setFileErrors(current => { const next = { ...current }; delete next[file]; delete next[result.path]; return next; });
      setActiveFile(result.path); setActiveLine(line); setLineRevision(version);
    } catch (e) { if (alive.current && version === request.current) setError(errorMessage(e)); }
    finally { if (alive.current && version === request.current) setPreviewLoading(''); }
  }, [workspace]);
  const openFileLink = useCallback((link: FileLink) => { void openFile(link.path, link.line); }, [openFile]);
  useEffect(() => {
    if (target?.kind === 'file') void openFile(target.path, target.line);
    else if (target?.kind === 'browser' || target?.kind === 'computer') { request.current++; setTab(target.kind); }
    else if (target?.kind === 'review') { request.current++; setTab('changes'); }
  }, [target, openFile]);
  function focusFile(file: string | null) {
    const button = file ? fileButtons.current.get(file) : browseButton.current || panel.current?.querySelector<HTMLInputElement>('.file-filter input');
    button?.focus({ preventScroll: true }); (button?.closest('.document-tabs > div') || button)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  useLayoutEffect(() => {
    if (pendingFileFocus.current !== undefined) { focusFile(pendingFileFocus.current); pendingFileFocus.current = undefined; }
  }, [activeFile, files, tab]);
  useEffect(() => {
    if (tab === 'files' && activeFile) fileButtons.current.get(activeFile)?.parentElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab, activeFile, files.length]);
  function selectFile(file: string | null, focus = false) {
    request.current++; setPreviewLoading(''); setActiveFile(file); setActiveLine(undefined);
    if (focus) { if (file === activeFile) focusFile(file); else pendingFileFocus.current = file; }
  }
  function closeFile(file: string) {
    staleFiles.current.delete(file);
    previewVersions.current.set(file, (previewVersions.current.get(file) || 0) + 1);
    setRefreshingFiles(current => current.filter(value => value !== file));
    closedDuringRestore.current.add(file);
    request.current++; setPreviewLoading('');
    const index = files.findIndex(item => item.path === file), remaining = files.filter(item => item.path !== file);
    const next = activeFile === file ? remaining[Math.min(index, remaining.length - 1)]?.path ?? null : activeFile;
    setFiles(remaining);
    if (activeFile === file) { setActiveFile(next); setActiveLine(undefined); }
    pendingFileFocus.current = next;
  }
  function fileCommand(command: string): boolean {
    if (tab !== 'files') return false;
    if (command === 'close-tab' && activeFile) { closeFile(activeFile); return true; }
    if (command === 'reload' && preview) { void openFile(preview.path, activeLine); return true; }
    if ((command === 'next-tab' || command === 'previous-tab') && files.length) {
      const index = files.findIndex(file => file.path === activeFile), forward = command === 'next-tab';
      const next = index < 0 ? forward ? 0 : files.length - 1 : (index + (forward ? 1 : -1) + files.length) % files.length;
      selectFile(files[next].path, true); return true;
    }
    return false;
  }
  fileCommandRef.current = fileCommand;
  function fileShortcut(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || event.altKey || event.nativeEvent.isComposing || document.querySelector('[aria-modal="true"]')) return;
    const modifier = event.metaKey || event.ctrlKey, key = event.key.toLowerCase();
    const command = event.ctrlKey && key === 'tab' ? event.shiftKey ? 'previous-tab' : 'next-tab'
      : modifier && event.shiftKey && (key === ']' || key === '}') ? 'next-tab'
      : modifier && event.shiftKey && (key === '[' || key === '{') ? 'previous-tab'
      : modifier && !event.shiftKey && key === 'w' ? 'close-tab'
      : modifier && !event.shiftKey && key === 'r' ? 'reload' : '';
    if (command && fileCommand(command)) { event.preventDefault(); event.stopPropagation(); }
  }
  function resize(event: PointerEvent<HTMLDivElement>) {
    const start = event.clientX, initial = width;
    event.currentTarget.setPointerCapture(event.pointerId);
    const node = event.currentTarget;
    const move = (e: globalThis.PointerEvent) => setWidth(Math.min(Math.min(860, window.innerWidth * .6), Math.max(340, initial + start - e.clientX)));
    const stop = () => { node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', stop); node.removeEventListener('pointercancel', stop); };
    node.addEventListener('pointermove', move); node.addEventListener('pointerup', stop); node.addEventListener('pointercancel', stop);
  }
  const selectTab = (next: Tab) => { if (target?.kind === 'browser' && target.url && next !== 'browser') onTargetHandled?.(target.revision); if (next === 'changes') onFollowActivity?.(false); setTab(next); setError(''); };
  return <aside ref={panel} onKeyDown={fileShortcut} className="workspace-panel" aria-label="Workspace" style={{ '--workspace-width': `${width}px` } as CSSProperties}>
    <div className="workspace-resizer" role="separator" aria-label="Resize workspace" aria-orientation="vertical" aria-valuemin={340} aria-valuemax={860} aria-valuenow={width} tabIndex={0} onPointerDown={resize} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setWidth(w => Math.min(860, Math.max(340, w + (e.key === 'ArrowLeft' ? 24 : -24)))); } }} />
    <div className="panel-header"><div className="panel-tabs" role="tablist" aria-label="Workspace views" onKeyDown={navigateTabs}>{([{ id: 'files', name: 'Files', Icon: FileCode2 }, { id: 'changes', name: 'Changes', Icon: GitCompareArrows }, { id: 'browser', name: 'Browser', Icon: Globe2 }, { id: 'computer', name: 'Computer', Icon: Monitor }, { id: 'todos', name: 'Plan', Icon: ListTodo }] as const).map(({ id, name, Icon }) => <button key={id} role="tab" tabIndex={tab === id ? 0 : -1} aria-selected={tab === id} aria-controls={`workspace-${id}`} id={`workspace-tab-${id}`} onClick={() => selectTab(id)} title={name}><Icon size={14} /><span>{name}</span>{id === 'todos' && todos.length > 0 && <em>{todos.filter(t => t.status === 'completed').length}/{todos.length}</em>}</button>)}</div><button className={`icon-button ${followActivity ? 'selected' : ''}`} aria-label="Follow agent activity" aria-pressed={followActivity} title={followActivity ? 'Following agent activity' : 'Follow agent activity'} onClick={() => onFollowActivity?.(!followActivity)}><ScanLine size={15} /></button><button className="icon-button" aria-label="Close workspace" title="Close panel" onClick={onClose}><PanelRightClose size={16} /></button></div>
    {tab !== 'browser' && tab !== 'computer' && tab !== 'changes' && !(tab === 'files' && preview) && <div className="workspace-toolbar"><span title={workspace}><Folder size={13} />{workspace.split('/').filter(Boolean).at(-1) || workspace}</span><div><button className="icon-button" aria-label="Refresh workspace" title="Refresh" onClick={() => { setRefresh(v => v + 1); if (tab === 'files' && preview) void openFile(preview.path); }} disabled={loading}><RefreshCw size={14} className={loading ? 'spinning' : ''} /></button></div></div>}
    <div className={`panel-body ${preview && tab === 'files' ? 'has-file-preview' : ''} ${tab === 'browser' || tab === 'computer' ? 'has-browser' : ''}`} role="tabpanel" id={`workspace-${tab}`} aria-labelledby={`workspace-tab-${tab}`}>
      {error && <div className="inline-alert" role="alert">{error}<button className="icon-button" aria-label="Dismiss file error" onClick={() => setError('')}><X size={14} /></button></div>}
      {tab === 'files' && <>
        {files.length > 0 && <div className="document-tabs" role="tablist" aria-label="Open files" onKeyDown={navigateTabs}><button ref={browseButton} className={`file-explorer-tab ${!preview ? 'active' : ''}`} aria-label="Browse files" title="Browse files" onClick={() => selectFile(null)}><Folder size={15} /></button>{files.map(file => <div className={activeFile === file.path ? 'active' : ''} key={file.path}><button ref={node => { if (node) fileButtons.current.set(file.path, node); else fileButtons.current.delete(file.path); }} role="tab" tabIndex={activeFile === file.path ? 0 : -1} aria-selected={activeFile === file.path} onClick={() => selectFile(file.path)} title={file.path}><FileCode2 size={13} /><span>{file.path.split('/').at(-1)}</span></button><button className="close-file" aria-label={`Close ${file.path}`} onClick={() => closeFile(file.path)}><X size={12} /></button></div>)}</div>}
        {preview && refreshingFiles.includes(preview.path) ? <div className="panel-loading">Updating file for this branch…</div> : preview && fileErrors[preview.path] ? <div className="file-unavailable"><FileCode2 size={24} /><strong>This file is unavailable</strong><p>{fileErrors[preview.path]}</p><button className="button" disabled={Boolean(previewLoading)} onClick={() => void openFile(preview.path)}>Try again</button></div> : preview ? <Suspense fallback={<div className="panel-loading">Opening file…</div>}><DocumentViewer key={preview.path} file={preview} workspace={workspace} line={activeLine} lineRevision={lineRevision} storageKey={storageKey} refreshing={Boolean(previewLoading)} onRefresh={() => { setRefresh(value => value + 1); void openFile(preview.path); }} onOpenFile={openFileLink} /></Suspense> : <div className="file-explorer"><div className="file-breadcrumb"><button onClick={() => setPath('')} aria-label="Workspace root"><Folder size={12} /></button>{path.split('/').filter(Boolean).map((part, i, parts) => <span key={i}><ChevronRight size={11} /><button onClick={() => setPath(parts.slice(0, i + 1).join('/'))}>{part}</button></span>)}</div><label className="file-filter"><Search size={13} /><input aria-label="Filter files" placeholder="Filter files" value={filter} onChange={e => setFilter(e.target.value)} /></label>{loading && listing?.directory !== directory ? <div className="panel-loading"><LiteSpeed compact active /><span>Loading files…</span></div> : <div className="file-list">{[...entries].filter(e => e.name.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name)).map(entry => <button key={entry.path} onClick={() => { if (entry.type === 'directory') { setPath(entry.path); setFilter(''); } else void openFile(entry.path); }} disabled={previewLoading === entry.path} title={entry.path}>{entry.type === 'directory' ? <Folder size={15} className="folder-icon" /> : <File size={15} />}<span>{entry.name}</span>{entry.type === 'directory' ? <ChevronRight size={12} /> : previewLoading === entry.path ? <span className="working-dot" /> : null}</button>)}</div>}{!loading && !entries.filter(e => e.name.toLowerCase().includes(filter.toLowerCase())).length && !error && <EmptyState icon={<Folder size={24} />} title={filter ? 'No matching files' : 'This folder is empty'} />}</div>}
      </>}
      {tab === 'changes' && <Suspense fallback={<div className="panel-loading">Opening review…</div>}><ReviewPanel workspace={workspace} sessionId={sessionId} refreshKey={refreshKey + refresh} target={target} running={running} onRefresh={() => setRefresh(value => value + 1)} onOpenFile={file => void openFile(file)} onComment={onComment} onUndo={onUndo} undoLabel={undoLabel} /></Suspense>}
      {tab === 'todos' && (todos.length ? <div className="todo-list">{todos.map(t => <div className={`todo ${t.status}`} key={t.id}>{t.status === 'completed' ? <Check size={15} /> : t.status === 'in_progress' ? <span className="working-dot" /> : <Circle size={14} />}<span>{t.content}</span><span className="sr-only">{t.status.replace('_', ' ')}</span></div>)}</div> : <EmptyState icon={<ListTodo size={25} />} title="No plan yet">Follow the agent’s plan here as it works.</EmptyState>)}
      {tab === 'browser' && <BrowserPanel key={sessionId} sessionId={sessionId} running={running} openRequest={target?.kind === 'browser' && target.url ? { url: target.url, revision: target.revision } : undefined} onOpenRequestHandled={onTargetHandled} onComment={onBrowserComment} />}
      {tab === 'computer' && <ComputerPanel key={sessionId} sessionId={sessionId} running={running} />}
    </div>
  </aside>;
}
