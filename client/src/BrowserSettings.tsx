import { useEffect, useRef, useState } from 'react';
import { Clock3, Download, FolderOpen, Globe2, RotateCcw } from 'lucide-react';
import type { BrowserHistoryResult, BrowserPreferences } from '../../shared/browser';
import { api, errorMessage, post } from './api';
import { nativeDesktop } from './desktop';

export function BrowserSettings({ preferences, onChange, disabled }: { preferences: BrowserPreferences; onChange: (value: BrowserPreferences) => void; disabled: boolean }) {
  const [count, setCount] = useState<number | null>(null), [confirm, setConfirm] = useState<'history' | 'profile' | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [defaultDirectory, setDefaultDirectory] = useState(''), [choosing, setChoosing] = useState(false);
  const latestPreferences = useRef(preferences); latestPreferences.current = preferences;
  const confirmation = useRef<HTMLElement>(null), trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (confirm) { confirmation.current?.querySelector('button')?.focus(); confirmation.current?.scrollIntoView({ block: 'nearest' }); } }, [confirm]);
  function dismiss() { setConfirm(null); requestAnimationFrame(() => trigger.current?.focus()); }
  useEffect(() => {
    let alive = true;
    void api<{ defaultDirectory: string }>('/browser/download-directory').then(value => { if (alive) setDefaultDirectory(value.defaultDirectory); }).catch(() => {});
    void api<BrowserHistoryResult>('/browser/history?limit=1').then(value => { if (alive) { setCount(value.total); setError(value.error || ''); } }).catch(error => { if (alive) setError(errorMessage(error)); });
    return () => { alive = false; };
  }, []);
  async function clear() {
    if (!confirm || busy) return; setBusy(true); setError(''); setNotice('');
    try {
      if (confirm === 'history') { await api('/browser/history', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }) }); setCount(0); setNotice('Browsing history cleared.'); }
      else { await post('/browser/reset', { confirm: true }); setNotice('Website data cleared. Reopen a saved tab to browse again.'); }
      dismiss();
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <div className="form-stack browser-settings">
    <div className="section-heading"><div><h3>Browser</h3><p>A separate browser for your work.</p></div></div>
    <section className="browser-settings-group" aria-label="Browsing preferences">
      <label data-setting="browser-search" className="browser-settings-row"><span><strong>Search engine</strong><small>Search from the browser’s address bar.</small></span><select aria-label="Browser search engine" value={preferences.searchEngine} disabled={disabled || busy} onChange={event => onChange({ ...preferences, searchEngine: event.target.value as BrowserPreferences['searchEngine'] })}><option value="google">Google</option><option value="duckduckgo">DuckDuckGo</option><option value="bing">Bing</option></select></label>
      <label data-setting="browser-history" className="browser-settings-row"><span><strong>Remember browsing history</strong><small>Keep up to 500 recent pages on this computer for 30 days.</small></span><input type="checkbox" role="switch" aria-label="Remember browsing history" checked={preferences.rememberHistory} disabled={disabled || busy} onChange={event => onChange({ ...preferences, rememberHistory: event.target.checked })} /></label>
    </section>
    <section className="browser-settings-group" aria-label="Download preferences">
      <label data-setting="browser-auto-downloads" className="browser-settings-row"><span><strong><Download size={14} />Save downloads automatically</strong><small>Keep a copy in your download folder when a file finishes.</small></span><input type="checkbox" role="switch" aria-label="Save downloads automatically" checked={preferences.autoSaveDownloads ?? false} disabled={disabled || busy} onChange={event => onChange({ ...preferences, autoSaveDownloads: event.target.checked })} /></label>
      <div data-setting="browser-download-folder" className="browser-download-directory"><div className="browser-settings-row"><span><strong>Download location</strong><small>Files with the same name get a number.</small></span>{preferences.downloadDirectory && preferences.downloadDirectory !== defaultDirectory && <button className="text-button" disabled={disabled || busy || choosing} onClick={() => onChange({ ...preferences, downloadDirectory: '' })}>Use default</button>}</div><div className="browser-download-folder-input"><input aria-label="Browser download folder" placeholder={defaultDirectory || 'System Downloads folder'} value={preferences.downloadDirectory || ''} disabled={disabled || busy || choosing} onChange={event => onChange({ ...preferences, downloadDirectory: event.target.value })} />{nativeDesktop() && <button className="icon-button" aria-label="Choose download folder" title="Choose folder" disabled={disabled || busy || choosing} onClick={async () => { setChoosing(true); setError(''); try { const path = await nativeDesktop()!.chooseFolder(); if (path) onChange({ ...latestPreferences.current, downloadDirectory: path }); } catch (error) { setError(errorMessage(error)); } finally { setChoosing(false); } }}><FolderOpen size={16} /></button>}</div><p>Downloads also stay with the task until you remove them.</p></div>
    </section>
    <section className="browser-settings-group" aria-label="Browser data">
      <div data-setting="browser-clear-history" className="browser-settings-row"><span><strong><Clock3 size={14} />Browsing history</strong><small>{count === null ? 'Recent page titles and addresses.' : `${count} saved page${count === 1 ? '' : 's'}. Clearing history also removes address suggestions.`}</small></span><button className="button secondary" disabled={disabled || busy || count === 0} onClick={event => { trigger.current = event.currentTarget; setConfirm('history'); setNotice(''); }}>Clear history</button></div>
      <div data-setting="browser-data" className="browser-settings-row"><span><strong><Globe2 size={14} />Website data</strong><small>Sign-ins, cookies and website storage are separate from your everyday browser.</small></span><button className="button secondary" disabled={disabled || busy} onClick={event => { trigger.current = event.currentTarget; setConfirm('profile'); setNotice(''); }}>Reset browser</button></div>
    </section>
    {confirm && <section ref={confirmation} className="browser-data-confirm" aria-label={confirm === 'history' ? 'Clear browsing history' : 'Reset browser profile'}>
      <strong>{confirm === 'history' ? 'Clear your browsing history?' : 'Reset this browser’s website data?'}</strong>
      <p>{confirm === 'history' ? 'Saved titles and addresses will be removed from history. Your open tabs and website sign-ins stay available.' : 'This closes browser pages in all tasks and signs you out of websites in Litespeed. Tab addresses, browsing history and retained downloads stay saved. Finish active tasks before resetting.'}</p>
      <div><button className="button secondary" disabled={busy} onClick={dismiss}>Cancel</button><button className="button danger" disabled={busy || disabled} onClick={() => void clear()}>{busy ? 'Clearing…' : confirm === 'history' ? 'Clear browsing history' : 'Reset website data'}</button></div>
    </section>}
    {notice && <p className="browser-settings-notice" role="status">{notice}</p>}
    {error && <div className="inline-alert" role="alert">{error}</div>}
    <div className="browser-profile-note"><RotateCcw size={17} /><p>Tabs are saved with each task. After restarting Litespeed, reopen a saved tab when you’re ready to use it.</p></div>
  </div>;
}
