import { useEffect, useRef, useState } from 'react';
import { Check, Download, File, LoaderCircle, RotateCcw, Trash2, X } from 'lucide-react';
import type { BrowserDownload } from '../../shared/browser';
import { api, errorMessage, post } from './api';

function size(bytes: number) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
function savedLabel(item: BrowserDownload) { const parts = item.savedPath?.split(/[\\/]/) ?? [], filename = parts.at(-1); return filename !== item.name ? `Saved as ${filename}` : `Saved to ${parts.at(-2) || 'your download folder'}`; }
function domain(url: string) { try { return new URL(url).hostname; } catch { return ''; } }

export function BrowserDownloads({ sessionId, downloads, running, onClose, onChange }: { sessionId: string; downloads: BrowserDownload[]; running: boolean; onClose: (restoreFocus?: boolean) => void; onChange: () => void }) {
  const panel = useRef<HTMLElement>(null), [removing, setRemoving] = useState(''), [saving, setSaving] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('button')?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(true); } };
    const outside = (event: PointerEvent) => { const target = event.target as Element; if (!panel.current?.contains(target) && !target.closest('.browser-downloads-trigger')) onClose(false); };
    document.addEventListener('keydown', key, true); document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', outside); };
  }, [onClose]);
  async function remove(id: string) {
    setRemoving(id); setError('');
    try { await api(`/sessions/${sessionId}/browser/downloads/${id}`, { method: 'DELETE' }); onChange(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setRemoving(''); }
  }
  async function retry(id: string) {
    if (saving) return; setSaving(id); setError('');
    try { await post(`/sessions/${sessionId}/browser/downloads/${id}/save`); onChange(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setSaving(''); }
  }
  return <section ref={panel} className="browser-downloads" aria-label="Browser downloads">
    <div className="browser-downloads-heading"><span><Download size={15} />Downloads</span><button className="icon-button" aria-label="Close downloads" onClick={() => onClose(true)}><X size={15} /></button></div>
    {error && <div className="inline-alert" role="alert">{error}</div>}
    {downloads.length ? <div className="browser-download-list">{downloads.map(item => <div className="browser-download" key={item.id}>
      {item.status === 'receiving' ? <LoaderCircle size={17} className="spinning" /> : item.savedPath ? <Check size={17} className="download-saved-icon" /> : <File size={17} />}
      <div><strong title={item.name}>{item.name}</strong><small title={item.url}>{item.status === 'receiving' ? 'Downloading…' : item.status === 'failed' ? item.error || 'Download did not finish' : `${size(item.size)}${domain(item.url) ? ` · ${domain(item.url)}` : ''}`}</small>{item.savedPath && <small className="download-saved-location" title={item.savedPath}>{savedLabel(item)}</small>}{item.saveError && <small className="download-save-error">{item.saveError}</small>}</div>
      {item.saveError && <button className="icon-button" disabled={running || Boolean(saving)} aria-label={`Retry saving ${item.name}`} title="Retry saving to your download folder" onClick={() => void retry(item.id)}>{saving === item.id ? <LoaderCircle size={15} className="spinning" /> : <RotateCcw size={15} />}</button>}
      {item.status === 'ready' && <a className="icon-button" href={`/api/sessions/${sessionId}/browser/downloads/${item.id}`} download={item.name} aria-label={`Save ${item.name}`} title="Save a copy"><Download size={15} /></a>}
      <button className="icon-button" disabled={running || Boolean(removing) || Boolean(saving)} onClick={() => void remove(item.id)} aria-label={`${item.status === 'receiving' ? 'Cancel' : 'Remove'} download ${item.name}`} title={item.status === 'receiving' ? 'Cancel download' : 'Remove from this task'}>{removing === item.id ? <LoaderCircle size={14} className="spinning" /> : item.status === 'receiving' ? <X size={14} /> : <Trash2 size={14} />}</button>
    </div>)}</div> : <div className="browser-downloads-empty"><Download size={25} /><strong>No downloads yet</strong><span>Files you download appear here.</span></div>}
    {downloads.length > 0 && <p className="browser-downloads-note">Removing a download here keeps copies saved to your computer.</p>}
  </section>;
}
