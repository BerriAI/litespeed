import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpCircle, Check, CircleHelp, Download, LoaderCircle, RefreshCw } from 'lucide-react';
import type { UpdateStatus } from '../../shared/updates';
import { api, post } from './api';
import { nativeDesktop } from './desktop';
import { Modal } from './ui';
import './updates.css';

export function Updates({ compact = false, onHelp }: { compact?: boolean; onHelp?: () => void }) {
  const [status, setStatus] = useState<UpdateStatus>(), [open, setOpen] = useState(false), [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [waiting, setWaiting] = useState(false);
  const restarting = useRef(false), alive = useRef(true), serial = useRef(0), wrapper = useRef<HTMLDivElement>(null);
  async function check(force = false) {
    const request = ++serial.current;
    try { const next = await api<UpdateStatus>(`/updates${force ? '?check=true' : ''}`); if (alive.current && request === serial.current) { setStatus(next); if (force) setError(next.error || ''); } }
    catch (error) { if (force && alive.current) setError(error instanceof Error ? error.message : 'Could not check for updates.'); }
  }
  useEffect(() => {
    alive.current = true;
    const refresh = () => void check();
    const command = (event: Event) => { if ((event as CustomEvent).detail === 'updates') { setOpen(true); void check(true); } };
    refresh(); const timer = setInterval(refresh, 3600000); window.addEventListener('focus', refresh); window.addEventListener('litespeed:desktop-command', command);
    return () => { alive.current = false; clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('litespeed:desktop-command', command); };
  }, []);
  useEffect(() => { if (!open && !waiting && !busy) return; const timer = setInterval(() => void check(), 2000); return () => clearInterval(timer); }, [open, waiting, busy]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: MouseEvent) => { if (!wrapper.current?.contains(event.target as Node)) setMenu(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(false); wrapper.current?.querySelector<HTMLButtonElement>('button')?.focus(); } };
    document.addEventListener('mousedown', dismiss); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', key); };
  }, [menu]);
  async function restart() {
    if (restarting.current) return;
    restarting.current = true; setBusy('restart'); setError('');
    try {
      if (status?.kind === 'desktop') {
        const native = nativeDesktop(); if (!native?.restartUpdate) throw new Error('Open the Litespeed Mac app to finish this update.');
        await native.restartUpdate(); return;
      }
      const target = await post<{ version: string }>('/updates/restart', {});
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        await new Promise(done => setTimeout(done, 500));
        try { if ((await api<{ version: string }>('/health')).version === target.version) { window.location.reload(); return; } } catch { /* The server is restarting. */ }
      }
      throw new Error('The server is taking longer to restart. Reload this page to reconnect.');
    } catch (error) {
      if (alive.current) { setError(error instanceof Error ? error.message : 'The update could not restart.'); setWaiting(false); setBusy(''); }
      restarting.current = false;
    }
  }
  useEffect(() => { if (waiting && status?.restartRequired && !status.blockers?.length && !busy) void restart(); }, [waiting, status, busy]);
  async function install() {
    setBusy('install'); setError(''); ++serial.current;
    try {
      const next = await post<UpdateStatus>('/updates/install', {});
      if (alive.current) { ++serial.current; setStatus(next); if (next.kind === 'desktop' && next.restartRequired) setWaiting(true); }
    } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : 'The update could not finish.'); }
    finally { if (alive.current) setBusy(''); }
  }
  const desktop = status?.kind === 'desktop', available = status?.available || status?.restartRequired;
  const label = waiting ? 'Update waiting for your work' : status?.restartRequired ? 'Restart to update' : available ? `Update to ${status?.latestVersion}` : onHelp ? 'Help & updates' : 'Updates';
  const blockers = status?.blockers || [], progress = status?.progress;
  const percent = progress ? Math.min(100, Math.round(progress.received / progress.total * 100)) : undefined;
  const native = nativeDesktop();
  return <div ref={wrapper} className={`updates ${compact ? 'compact' : ''}`}>
    <button aria-label={label} title={label} aria-expanded={menu || open} className={compact ? 'icon-button' : 'sidebar-footer-button'} onClick={() => { if (available || !onHelp) { setOpen(true); void check(); } else setMenu(value => !value); }}>
      {available ? <ArrowUpCircle size={17} /> : <CircleHelp size={17} />}{!compact && <span>{label}</span>}{available && <span className="update-dot" />}
    </button>
    {menu && <div className="help-update-menu"><button onClick={() => { setMenu(false); onHelp?.(); }}><CircleHelp size={15} />Help & commands<kbd>⌘ K</kbd></button><button onClick={() => { setMenu(false); setOpen(true); void check(true); }}><RefreshCw size={15} />Check for updates</button>{status && <small>Litespeed {status.currentVersion}</small>}</div>}
    {open && createPortal(<Modal title={status?.restartRequired ? 'Restart Litespeed?' : available ? 'Update Litespeed' : 'Litespeed updates'} onClose={() => setOpen(false)}>
      <div className="desktop-update-content" role="region" aria-label="Litespeed updates">
        <div className="desktop-update-intro"><span className="desktop-update-symbol">{busy || waiting ? <LoaderCircle className="update-spinning" size={23} /> : available ? <Download size={23} /> : <Check size={23} />}</span><div><strong>{waiting ? 'Waiting for your work to finish' : busy === 'restart' ? 'Restarting Litespeed…' : busy === 'install' ? 'Downloading the update…' : available ? `${status?.installedVersion || status?.latestVersion} is ready${status?.restartRequired ? ' to install' : ' to download'}` : 'Litespeed ' + (status?.currentVersion || '')}</strong><p>{desktop ? `Version ${status?.currentVersion} · Build ${status?.currentBuild}` : `Litespeed ${status?.currentVersion || ''}`}</p></div></div>
        {available ? <p>{desktop ? 'Litespeed will restart to install this update. Your conversations, settings, and drafts are kept.' : status?.restartRequired ? `${status.installedVersion} is installed. Restart when your tasks and workspace terminals are finished.` : `${status?.latestVersion} is available.`}</p> : <p>{status?.error && !status.latestVersion ? 'Could not check for updates. Keep working and try again later.' : status?.checkedAt ? 'You have the latest checked version.' : 'Checking for a newer version…'}</p>}
        {blockers.length > 0 && available && <div className="update-blockers"><strong>Your work is still active</strong><ul>{blockers.map(reason => <li key={reason}>{reason}</li>)}</ul><p>The update can download now. Litespeed will wait until this work finishes before restarting.</p></div>}
        {waiting && <p role="status">Keep Litespeed open. It will restart when tasks finish and workspace terminals are closed.</p>}
        {busy === 'install' && <div className="update-download" role="status"><progress max={100} value={percent} /><span>{percent === undefined ? 'Preparing download…' : percent === 100 ? 'Verifying the app…' : `${percent}% downloaded`}</span></div>}
        {(error || status?.error) && <p className="update-error" role="alert">{error || status?.error}</p>}
        {available && !status?.packaged && <p>{desktop ? status?.command : 'Install the macOS package for automatic updates, or update your source checkout and rebuild.'}</p>}
        {desktop && status?.packaged && !native?.restartUpdate && available && <p>Open the Litespeed Mac app to install and restart this update.</p>}
        <div className="desktop-update-footer"><a href={status?.releaseUrl || 'https://github.com/BerriAI/litespeed/releases'} target="_blank" rel="noreferrer">Release notes</a><div>
          {waiting && busy !== 'restart' ? <button className="button" onClick={() => setWaiting(false)}>Cancel restart</button> : <button className="button" disabled={Boolean(busy)} onClick={() => { setBusy('check'); void check(true).finally(() => setBusy('')); }}>Check again</button>}
          {status?.packaged && available && !waiting && <button className="button primary" disabled={Boolean(busy) || desktop && !native?.restartUpdate} onClick={() => { if (status.restartRequired) { if (desktop) setWaiting(true); else void restart(); } else void install(); }}>{busy === 'install' ? 'Downloading…' : desktop ? blockers.length ? status.restartRequired ? 'Restart when idle' : 'Update when idle' : status.restartRequired ? 'Restart now' : 'Update and restart' : status.restartRequired ? 'Restart' : 'Install update'}</button>}
        </div></div>
      </div>
    </Modal>, document.body)}
  </div>;
}
