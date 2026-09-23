import { useEffect, useRef, useState } from 'react';
import { File, LoaderCircle, Upload, X } from 'lucide-react';
import { browserUploadLimit, type BrowserUploadAction, type BrowserUploadFile, type BrowserUploadRequest } from '../../shared/browser';
import { errorMessage } from './api';
import './browser-upload.css';

const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
function recipient(url: string) { try { const value = new URL(url); return /^https?:$/.test(value.protocol) ? value.host : 'This embedded page'; } catch { return 'This page'; } }
function payload(file: File): Promise<BrowserUploadFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve({ name: file.name, mimeType: file.type, data: String(reader.result).split(',')[1] || '' });
    reader.onerror = () => reject(new Error(`${file.name} could not be read. Choose it again.`)); reader.onabort = () => reject(new Error('File selection canceled.')); reader.readAsDataURL(file);
  });
}

export function BrowserUpload({ request, disabled, onAction, onDone }: { request: BrowserUploadRequest; disabled: boolean; onAction: (action: BrowserUploadAction) => Promise<boolean>; onDone: () => void }) {
  const [files, setFiles] = useState<File[]>([]), [error, setError] = useState(''), [sending, setSending] = useState(false);
  const picker = useRef<HTMLInputElement>(null), choose = useRef<HTMLButtonElement>(null), send = useRef<HTMLButtonElement>(null), alive = useRef(true), focused = useRef(false), working = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (!disabled && !focused.current) { focused.current = true; if (document.activeElement?.closest('.browser-viewport')) choose.current?.focus(); } }, [disabled]);
  function select(selected: FileList | null) {
    if (!selected?.length) return;
    const next = Array.from(selected); setError('');
    if (next.length > 10 || next.reduce((sum, file) => sum + file.size, 0) > browserUploadLimit) { setError('Choose up to 10 files totaling 8 MB or less.'); return; }
    if (!request.multiple && next.length > 1) { setError('This page accepts one file at a time.'); return; }
    setFiles(next); requestAnimationFrame(() => send.current?.focus());
  }
  async function submit() {
    if (disabled || working.current || !files.length) return;
    working.current = true; setSending(true); setError('');
    try {
      const selected = await Promise.all(files.map(payload));
      if (alive.current && await onAction({ action: 'upload', requestId: request.id, tabId: request.tabId, files: selected })) onDone();
    } catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { working.current = false; if (alive.current) setSending(false); }
  }
  async function cancel() {
    if (disabled || working.current) return; working.current = true;
    try { if (await onAction({ action: 'cancel', requestId: request.id, tabId: request.tabId })) onDone(); }
    finally { working.current = false; }
  }
  return <section className="browser-upload" aria-label="Files for website" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void cancel(); } }}>
    <div className="browser-upload-heading"><Upload size={16} /><div><strong>{request.directory ? 'Folder requested' : 'Share files with this page'}</strong><span title={request.url}>{recipient(request.url)}</span></div><button className="icon-button" aria-label="Cancel file upload" title="Cancel" aria-disabled={disabled || sending} onClick={() => void cancel()}><X size={15} /></button></div>
    <div className="browser-upload-content"><p>{request.directory ? 'Folder uploads aren’t available here yet. Use a file upload field on this page instead.' : 'Choose files, then send them to the website.'}</p>
    {files.length > 0 && <ul className="browser-upload-files">{files.map((file, index) => <li key={`${file.name}-${index}`}><File size={14} /><span title={file.name}>{file.name}</span><small>{size(file.size)}</small><button className="icon-button" aria-label={`Remove selected file ${file.name}`} aria-disabled={disabled || sending} onClick={() => { if (!disabled && !working.current) setFiles(current => current.filter((_, at) => index !== at)); }}><X size={13} /></button></li>)}</ul>}
    {error && <div className="browser-upload-error" role="alert">{error}</div>}</div>
    {!request.directory && <div className="browser-upload-actions"><button ref={choose} className="button secondary" aria-disabled={disabled || sending} onClick={() => { if (!disabled && !working.current) picker.current?.click(); }}>{files.length ? 'Change selection' : request.multiple ? 'Choose files' : 'Choose file'}</button>{files.length ? <button ref={send} className="button primary" aria-disabled={disabled || sending} onClick={() => void submit()}>{sending ? <LoaderCircle size={13} className="spinning" /> : <Upload size={13} />}{sending ? 'Sending…' : `Send ${files.length === 1 ? 'file' : `${files.length} files`}`}</button> : <span>8 MB maximum</span>}</div>}
    <input ref={picker} type="file" hidden aria-label="Choose files for website" accept={request.accept || undefined} multiple={request.multiple} disabled={disabled || sending || request.directory} onChange={event => { select(event.currentTarget.files); event.currentTarget.value = ''; }} />
  </section>;
}
