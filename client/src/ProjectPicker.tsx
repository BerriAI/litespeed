import { useEffect, useRef, useState } from 'react';
import { Check, Folder, FolderPlus, Search } from 'lucide-react';
import { api, errorMessage, query } from './api';
import { Modal } from './ui';
import { nativeDesktop } from './desktop';

export function ProjectPicker({ current, projects, onChoose, onClose }: { current: string; projects: string[]; onChoose: (path: string) => void; onClose: () => void }) {
  const [search, setSearch] = useState(''), [adding, setAdding] = useState(false), [path, setPath] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function choose(value: string) {
    if (busy || !value.trim()) return; setBusy(true); setError('');
    try {
      const result = await api<{ path: string }>(`/workspaces/resolve?${query({ path: value.trim() })}`);
      if (alive.current) onChoose(result.path);
    } catch (e) { if (alive.current) setError(errorMessage(e)); }
    finally { if (alive.current) setBusy(false); }
  }
  async function openFolder() {
    const desktop = nativeDesktop();
    if (!desktop) { setAdding(true); return; }
    try { const folder = await desktop.chooseFolder(); if (folder && alive.current) await choose(folder); }
    catch (e) { if (alive.current) setError(errorMessage(e)); }
  }
  const filtered = projects.filter(project => project.toLowerCase().includes(search.toLowerCase()));
  return <Modal title="Choose a project" onClose={onClose}><div className="project-picker">
    <label className="project-picker-search"><Search size={16} /><input autoFocus aria-label="Search projects" placeholder="Search projects" value={search} onChange={e => setSearch(e.target.value)} /></label>
    <div className="project-picker-list">{filtered.map(project => <button key={project} disabled={busy} onClick={() => void choose(project)}><Folder size={18} /><span><strong>{project.split('/').filter(Boolean).at(-1) || project}</strong><small>{project}</small></span>{current === project && <Check size={15} />}</button>)}{!filtered.length && <p className="project-picker-empty">{search ? 'No matching projects' : 'Choose a folder to get started.'}</p>}</div>
    {adding ? <form className="project-folder-form" onSubmit={e => { e.preventDefault(); void choose(path); }}><label>Folder path<input autoFocus aria-label="Project folder path" placeholder="~/Projects/my-app" value={path} disabled={busy} onChange={e => setPath(e.target.value)} /></label><button className="button primary" disabled={busy || !path.trim()}>{busy ? 'Opening…' : 'Open project'}</button></form> : <button className="project-add-folder" disabled={busy} onClick={() => void openFolder()}><FolderPlus size={17} />Open a folder</button>}
    {error && <div className="inline-alert" role="alert">{error}</div>}
  </div></Modal>;
}
