import { useState } from 'react';
import { ArrowLeft, ArrowUpRight, Monitor, Search, X } from 'lucide-react';
import type { ComputerApp, ComputerWindow } from '../../shared/computer';

export function ComputerPicker({ windows, apps, windowId, mode, busy, onClose, onMode, onSelect, onLaunch }: {
  windows: ComputerWindow[]; apps: ComputerApp[]; windowId: string | null; mode: 'windows' | 'apps'; busy: boolean;
  onClose: () => void; onMode: (mode: 'windows' | 'apps') => void; onSelect: (id: string) => void; onLaunch: (bundleId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const matches = (value: string) => value.toLowerCase().includes(search.toLowerCase());
  const selectedWindows = windows.filter(window => matches(window.app + ' ' + window.title)), selectedApps = apps.filter(app => matches(app.name));
  return <div className="computer-picker-body" onKeyDown={event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || ['Home', 'End'].includes(event.key) && event.target instanceof HTMLInputElement) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-computer-option]:not([disabled])')); if (!items.length) return;
    event.preventDefault(); const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : index < 0 ? event.key === 'ArrowUp' ? items.length - 1 : 0 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }}>
    <div className="computer-window-menu-heading"><span>{mode === 'apps' ? 'Open an app' : 'Open windows'}</span><button className="icon-button" aria-label="Close window picker" onClick={onClose}><X size={14} /></button></div>
    <label className="computer-picker-search"><Search size={14} /><input autoFocus aria-label={mode === 'apps' ? 'Search installed apps' : 'Search open windows'} placeholder={mode === 'apps' ? 'Search apps' : 'Search windows'} value={search} onChange={event => setSearch(event.target.value)} /></label>
    <div className="computer-picker-options">{busy ? <span className="computer-picker-empty">{mode === 'apps' ? 'Opening app list…' : 'Finding windows…'}</span> : mode === 'apps' ? selectedApps.length ? selectedApps.map(app => <button key={app.bundleId} data-computer-option title={app.name} onClick={() => onLaunch(app.bundleId)}><Monitor size={16} /><span><strong>{app.name}</strong><small>{app.running ? 'Running' : 'Installed'}</small></span><ArrowUpRight size={13} /></button>) : <span className="computer-picker-empty">{search ? 'No matching apps' : 'No supported apps found.'}</span> : selectedWindows.length ? selectedWindows.map(window => <button data-computer-option className={window.id === windowId ? 'selected' : ''} key={window.id} onClick={() => onSelect(window.id)}><Monitor size={15} /><span><strong>{window.app}</strong><small>{window.title}</small></span></button>) : <span className="computer-picker-empty">{search ? 'No matching windows' : 'Open an app to get started.'}</span>}</div>
    <button className="computer-picker-switch" disabled={busy} onClick={() => { setSearch(''); onMode(mode === 'apps' ? 'windows' : 'apps'); }}>{mode === 'apps' ? <><ArrowLeft size={14} />Open windows</> : <><Monitor size={14} />Open an app…</>}</button>
  </div>;
}
