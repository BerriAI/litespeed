import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Clock3, Download, File, FileCode2, FileImage, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { Attachment } from '../../shared/types';
import { Modal } from './ui';
import { workspaceAttachmentPath } from './file-links';

function isImage(attachment: Attachment) { return /^data:image\/(?:png|jpeg|gif|webp);base64,/.test(attachment.dataUrl || ''); }
function canPreview(attachment: Attachment) { return isImage(attachment) || typeof attachment.content === 'string'; }

export function Attachments({ attachments, onRemove, disabled, workspace, previousWorkspaces, onOpenFile }: { attachments: Attachment[]; onRemove?: (index: number) => void; disabled?: boolean; workspace?: string; previousWorkspaces?: readonly string[]; onOpenFile?: (path: string) => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  const selectedAttachment = selected === null ? undefined : attachments[selected];
  const selectedPath = workspaceAttachmentPath(selectedAttachment?.path, workspace, previousWorkspaces);
  const previewable = attachments.flatMap((attachment, index) => canPreview(attachment) ? [index] : []);
  const position = selected === null ? -1 : previewable.indexOf(selected);
  const previous = previewable[position - 1], next = previewable[position + 1];
  function move(direction: number) { const index = previewable[position + direction]; if (index !== undefined) setSelected(index); }
  useEffect(() => { if (!selectedAttachment) setSelected(null); }, [selectedAttachment]);
  return <>
    <div className={onRemove ? 'attachments' : 'message-attachments'}>{attachments.map((attachment, index) => {
      const image = isImage(attachment), preview = canPreview(attachment), path = workspaceAttachmentPath(attachment.path, workspace, previousWorkspaces);
      const label = <><span className="attachment-thumbnail">{image ? <img src={attachment.dataUrl} alt="" /> : attachment.path ? <FileCode2 size={18} /> : <File size={18} />}</span><span className="attachment-label"><strong>{attachment.name || attachment.path?.split('/').at(-1)}</strong><small>{image ? 'Image' : attachment.path ? preview ? 'Attached snapshot' : 'Workspace file' : 'Text file'}</small></span></>;
      return <div className={`attachment-chip ${image ? 'has-image' : ''}`} key={`${attachment.name}-${index}`} title={attachment.path || attachment.name}>
        {preview ? <button className="attachment-open" aria-label={`Preview ${attachment.name}`} onClick={event => { event.currentTarget.focus(); setSelected(index); }}>{label}</button> : path && onOpenFile ? <button className="attachment-open" aria-label={`Open ${attachment.name}`} onClick={() => onOpenFile(path)}>{label}</button> : <span className="attachment-static">{label}</span>}
        {onRemove && <button className="attachment-remove" aria-label={`Remove ${attachment.name}`} disabled={disabled} onClick={() => onRemove(index)}><X size={13} /></button>}
      </div>;
    })}</div>
    {selectedAttachment && canPreview(selectedAttachment) && createPortal(<Modal title={selectedAttachment.name} onClose={() => setSelected(null)} wide onKeyDown={event => {
        if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !(event.target as HTMLElement).closest('.attachment-image-scroll,.attachment-text-preview')) { event.preventDefault(); event.stopPropagation(); move(event.key === 'ArrowLeft' ? -1 : 1); }
      }}>
      <div className="attachment-viewer">
        <AttachmentPreview key={selected} attachment={selectedAttachment} onOpenCurrent={selectedPath && onOpenFile ? () => { setSelected(null); onOpenFile(selectedPath); } : undefined} />
        {previewable.length > 1 && <div className="attachment-gallery"><button className="icon-button" aria-label="Previous attachment" disabled={previous === undefined} onClick={() => move(-1)}><ChevronLeft size={17} /></button><span aria-live="polite">{position + 1} of {previewable.length}</span><button className="icon-button" aria-label="Next attachment" disabled={next === undefined} onClick={() => move(1)}><ChevronRight size={17} /></button></div>}
      </div>
    </Modal>, document.body)}
  </>;
}

function AttachmentPreview({ attachment, onOpenCurrent }: { attachment: Attachment; onOpenCurrent?: () => void }) {
  const image = isImage(attachment), scroll = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState<number | null>(null), [failed, setFailed] = useState(false), [download, setDownload] = useState('');
  useEffect(() => {
    let disposed = false, url = '';
    const create = async () => {
      const blob = image ? await (await fetch(attachment.dataUrl!)).blob() : new Blob([attachment.content || ''], { type: 'text/plain;charset=utf-8' });
      if (!disposed) { url = URL.createObjectURL(blob); setDownload(url); }
    };
    void create().catch(() => {});
    return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
  }, [attachment.dataUrl, attachment.content, image]);
  function changeZoom(value: number | null) { setZoom(value); scroll.current?.scrollTo({ top: 0, left: 0 }); }
  function scaleBy(factor: number) {
    const displayed = scroll.current?.querySelector('img');
    const current = zoom ?? (displayed && size ? displayed.clientWidth / size.width : 1);
    changeZoom(Math.max(0.1, Math.min(4, current * factor)));
  }
  return <>
    {attachment.path && <div className="attachment-snapshot-info"><Clock3 size={14} /><span>This is the content attached to the message.</span></div>}
    {image ? <div ref={scroll} className={`attachment-image-scroll ${zoom === null ? 'fit' : 'zoomed'}`} tabIndex={0} role="region" aria-label="Image preview">
      {failed ? <div className="attachment-preview-error" role="status"><FileImage size={30} /><strong>This image could not be displayed.</strong><span>You can still save the original file.</span></div> : <img src={attachment.dataUrl} alt={attachment.name} draggable={false} onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setFailed(true)} style={zoom !== null && size ? { width: size.width * zoom, height: size.height * zoom } : undefined} />}
    </div> : <pre className="attachment-text-preview" tabIndex={0} aria-label={`Contents of ${attachment.name}`}>{attachment.content || 'This file is empty.'}</pre>}
    <div className="attachment-preview-toolbar">
      <span className="attachment-dimensions">{image ? size ? `${size.width.toLocaleString()} × ${size.height.toLocaleString()}` : 'Image' : `${(attachment.content || '').length.toLocaleString()} characters`}</span>
      {image && !failed && <div className="attachment-zoom"><button className={`icon-button ${zoom === null ? 'selected' : ''}`} aria-label="Fit image" title="Fit image" onClick={() => changeZoom(null)}><Maximize2 size={15} /></button><button className="icon-button" aria-label="Zoom out" title="Zoom out" disabled={!size || zoom !== null && zoom <= 0.1} onClick={() => scaleBy(0.5)}><ZoomOut size={16} /></button><button className="attachment-actual-size" aria-label="Actual image size" title="Actual size" onClick={() => changeZoom(1)}>{zoom === null ? 'Fit' : `${Math.round(zoom * 100)}%`}</button><button className="icon-button" aria-label="Zoom in" title="Zoom in" disabled={!size || zoom !== null && zoom >= 4} onClick={() => scaleBy(2)}><ZoomIn size={16} /></button></div>}
      {onOpenCurrent && <button className="text-button attachment-current-file" onClick={onOpenCurrent}><FileCode2 size={14} />Open current file</button>}
      <a className={`text-button attachment-save ${!download ? 'unavailable' : ''}`} href={download || undefined} download={attachment.name} aria-disabled={!download} onClick={event => { if (!download) event.preventDefault(); }}><Download size={15} />Save copy</a>
    </div>
  </>;
}
