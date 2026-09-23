import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Download, File, History, LoaderCircle, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { api, errorMessage, query } from './api';
import { EmptyState, Modal } from './ui';
import type { DiscardBackup, DiscardPlan, DiscardResult } from '../../shared/git-discard';

type View = { kind: 'history' } | { kind: 'plan'; plan: DiscardPlan; backup?: DiscardBackup } | { kind: 'remove'; backup: DiscardBackup };
const bytes = (value: number) => value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MiB` : value >= 1024 ? `${Math.round(value / 1024)} KiB` : `${value} B`;
const date = (value: number) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(value);
export function GitDiscardControls({ workspace, paths, activePath, canDiscard, disabled, onRefresh, onResult, onError, onBusyChange }: {
  workspace: string; paths: string[]; activePath: string | null; canDiscard: boolean; disabled: boolean; onRefresh: () => void; onResult: (message: string) => void; onError: (message: string) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [view, setView] = useState<View | null>(null), [backups, setBackups] = useState<DiscardBackup[]>([]), [allProjects, setAllProjects] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [stale, setStale] = useState(false);
  const content = useRef<HTMLDivElement>(null), alive = useRef(true), trigger = useRef<HTMLButtonElement | null>(null), historyButton = useRef<HTMLButtonElement>(null), opened = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  useEffect(() => { if (view) { opened.current = true; return; } if (opened.current && !busy) { opened.current = false; const target = trigger.current?.isConnected && !trigger.current.disabled ? trigger.current : historyButton.current; target?.focus(); } }, [view, busy]);
  useEffect(() => { if (view) content.current?.focus(); }, [view?.kind]);
  async function history(all = allProjects) { const result = await api<{ backups: DiscardBackup[] }>(`/git/discards?${query({ workspace, ...(all ? { all: 'true' } : {}) })}`); if (alive.current) setBackups(result.backups); }
  async function openHistory() {
    setView({ kind: 'history' }); setError(''); setBusy(true);
    try { await history(); } catch (error) { if (alive.current) setError(errorMessage(error)); } finally { if (alive.current) setBusy(false); }
  }
  async function prepare(backup?: DiscardBackup, selected?: string[]) {
    if (busy || disabled) return;
    setBusy(true); setError(''); setStale(false); onError(''); onResult('');
    try {
      const plan = await api<DiscardPlan>(backup ? `/git/discards/${backup.id}/restore` : '/git/discards/prepare', { method: 'POST', body: JSON.stringify({ workspace: backup?.workspace || workspace, paths: selected || (backup ? undefined : activePath ? [activePath] : paths) }) });
      if (alive.current) setView({ kind: 'plan', plan, backup });
    } catch (error) { if (alive.current) { if (view) setError(errorMessage(error)); else onError(errorMessage(error)); } }
    finally { if (alive.current) setBusy(false); }
  }
  async function confirm() {
    if (view?.kind !== 'plan' || busy || disabled) return;
    setBusy(true); setError('');
    try {
      const result = await api<DiscardResult>('/git/discards/apply', { method: 'POST', body: JSON.stringify({ workspace: view.backup?.workspace || workspace, id: view.plan.id }) });
      if (!alive.current) return;
      onResult(result.backup.workspace === workspace ? result.message : `${result.message} in ${result.backup.workspace.split('/').at(-1)}`); if (result.backup.workspace === workspace) onRefresh();
      if (view.backup) { await history(); setView({ kind: 'history' }); } else setView(null);
    } catch (error) { if (alive.current) { setError(errorMessage(error)); setStale(true); onRefresh(); } }
    finally { if (alive.current) setBusy(false); }
  }
  async function remove() {
    if (view?.kind !== 'remove' || busy || disabled) return;
    setBusy(true); setError('');
    try { await api(`/git/discards/${view.backup.id}`, { method: 'DELETE', body: JSON.stringify({ workspace: view.backup.workspace, confirm: true }) }); await history(); if (alive.current) setView({ kind: 'history' }); }
    catch (error) { if (alive.current) setError(errorMessage(error)); }
    finally { if (alive.current) setBusy(false); }
  }
  const title = view?.kind === 'plan' ? view.plan.action === 'discard' ? 'Discard changes?' : 'Restore discarded changes?' : view?.kind === 'remove' ? 'Delete saved backup?' : 'Discarded changes';
  return <>
    {canDiscard && <button className="button git-discard-trigger" disabled={disabled || busy || !paths.length} onClick={event => { trigger.current = event.currentTarget; event.currentTarget.focus(); void prepare(); }}><Trash2 size={13} />Discard…</button>}
    <button ref={historyButton} className="icon-button git-discard-history-trigger" aria-label="Discarded changes" title="Discarded changes" disabled={busy} onClick={event => { trigger.current = event.currentTarget; event.currentTarget.focus(); void openHistory(); }}><History size={15} /></button>
    {view && createPortal(<Modal title={title} onClose={() => { if (!busy) { setView(null); setError(''); } }}><div ref={content} tabIndex={-1} className="git-discard-dialog">
      {view.kind === 'plan' ? <>
        <p className="git-discard-intro">{view.plan.action === 'discard' ? view.plan.files.every(file => file.kind === 'new') ? 'Remove these new files from your project.' : view.plan.files.some(file => file.kind === 'new') ? 'Return changed files to their staged version and remove the new files below.' : 'Return these files to their staged version.' : 'Bring back the original file contents and permissions. Your staged changes stay as they are.'}</p>
        {view.backup && view.backup.workspace !== workspace && <p className="git-discard-project">Restore to<code>{view.backup.workspace}</code></p>}
        <div className="git-plan-heading"><strong>{view.plan.files.length} {view.plan.files.length === 1 ? 'file' : 'files'}</strong><span title={view.plan.branch}>{view.plan.branch}</span></div>
        <ul className="git-plan-files git-discard-plan" aria-label={view.plan.action === 'discard' ? 'Files to discard' : 'Files to restore'}>{view.plan.files.map(file => <li key={file.path}><span title={file.path}>{file.path}</span>{view.plan.action === 'discard' && file.kind === 'new' && <small>New file</small>}{file.kind === 'deleted' && <small>{view.plan.action === 'discard' ? 'Deleted' : 'Remove file'}</small>}</li>)}</ul>
        {view.plan.action === 'discard' && <div className="git-discard-assurance"><ShieldCheck size={17} /><span><strong>Original copies will be saved</strong>Restore them from Discarded changes, even after restarting.<small>{bytes(view.plan.bytes)} · Uses your Git attributes and filters.</small></span></div>}
        {error && <p className="git-action-error" role="alert">{error}</p>}
        <footer><button className="button" disabled={busy} onClick={() => { setError(''); setView(view.backup ? { kind: 'history' } : null); }}>Cancel</button>{stale ? <button className="button primary" disabled={busy || disabled} onClick={() => void prepare(view.backup, view.plan.files.map(file => file.path))}>Refresh review</button> : <button className={`button ${view.plan.action === 'discard' ? 'danger' : 'primary'}`} disabled={busy || disabled} onClick={() => void confirm()}>{busy ? 'Working…' : view.plan.action === 'discard' ? 'Discard changes' : 'Restore files'}</button>}</footer>
        {stale && <button className="git-discard-open-history" disabled={busy} onClick={() => void openHistory()}><History size={13} />Open saved backups</button>}
      </> : view.kind === 'remove' ? <>
        <p className="git-discard-intro">Delete the saved originals for these {view.backup.files.length} {view.backup.files.length === 1 ? 'file' : 'files'}? Your project files stay as they are.</p>
        {view.backup.workspace !== workspace && <p className="git-discard-project">Project<code>{view.backup.workspace}</code></p>}
        <ul className="git-plan-files" aria-label="Backup to delete">{view.backup.files.map(file => <li key={file.path}>{file.path}</li>)}</ul>
        <p className="git-plan-note">This backup cannot be recovered after deletion.</p>
        {error && <p className="git-action-error" role="alert">{error}</p>}
        <footer><button className="button" disabled={busy} onClick={() => { setError(''); setView({ kind: 'history' }); }}>Keep backup</button><button className="button danger" disabled={busy || disabled} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Delete backup'}</button></footer>
      </> : <>
        <div className="git-discard-history-scope"><p>Restore a file, or save its original copy.</p><select aria-label="Backup project filter" disabled={busy} value={allProjects ? 'all' : 'current'} onChange={async event => { const all = event.target.value === 'all'; setAllProjects(all); setBusy(true); setError(''); try { await history(all); } catch (error) { if (alive.current) setError(errorMessage(error)); } finally { if (alive.current) setBusy(false); } }}><option value="current">This project</option><option value="all">All projects</option></select></div>
        {error && <p className="git-action-error" role="alert">{error}</p>}
        {busy && <div className="git-discard-loading" role="status"><LoaderCircle size={15} className="spinning" />Loading backups…</div>}
        {!backups.length && !busy && !error && <EmptyState icon={<History size={25} />} title="No discarded changes">Files you discard here can be restored from this view.</EmptyState>}
        <div className="git-discard-history">{backups.map(backup => <section key={backup.id} aria-label={`Backup from ${date(backup.createdAt)}`}><header><span><strong>{date(backup.createdAt)}</strong><small title={`${backup.workspace} · ${backup.branch}`}>{allProjects ? `${backup.workspace.split('/').at(-1)} · ` : ''}{backup.branch} · {bytes(backup.bytes)}</small></span>{backup.status === 'restored' ? <span className="git-backup-restored"><Check size={12} />Restored</span> : <button className="button" disabled={busy || disabled} onClick={() => void prepare(backup)}><RotateCcw size={12} />Restore all</button>}<button className="icon-button" aria-label={`Delete backup from ${date(backup.createdAt)}`} title="Delete saved backup" disabled={busy || disabled} onClick={() => { setError(''); setView({ kind: 'remove', backup }); }}><Trash2 size={13} /></button></header>
          {backup.status === 'interrupted' && <p className="git-backup-interrupted">The operation was interrupted. Original copies are still saved.</p>}
          <ul>{backup.files.map(file => <li key={file.path}><File size={13} /><span title={file.path}>{file.path}</span>{file.state === 'restored' ? <Check size={12} className="git-backup-check" aria-label="Restored" /> : <button className="icon-button" aria-label={`Restore ${file.path}`} title="Restore file" disabled={busy || disabled} onClick={() => void prepare(backup, [file.path])}><RotateCcw size={13} /></button>}{file.hasOriginal && <a className="icon-button" href={`/api/git/discards/${backup.id}/original?${query({ workspace: backup.workspace, path: file.path })}`} download={file.path.split('/').at(-1)} aria-label={`Save original ${file.path}`} title="Save original copy"><Download size={13} /></a>}</li>)}</ul>
        </section>)}</div>
        <p className="git-discard-retention">Backups stay until you delete them. Up to 20 backups and 64 MiB across your projects.</p>
      </>}
    </div></Modal>, document.body)}
  </>;
}
