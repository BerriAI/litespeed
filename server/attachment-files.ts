import { extname } from 'node:path';
import type { Attachment } from '../shared/types.js';
import { readPreviewAsset } from './file-preview.js';
import { readFile } from './tools.js';

/** Capture file references at acceptance, so later edits cannot rewrite a message. */
export async function snapshotFileAttachment(workspace: string, attachment: Attachment): Promise<Attachment> {
  if (!attachment.path) return attachment;
  if (/^\.(png|jpe?g|gif|webp)$/i.test(extname(attachment.path))) {
    const file = await readPreviewAsset(workspace, attachment.path);
    if (file.data.length > 4 * 1024 * 1024) throw new Error('Workspace images can be up to 4 MiB. Resize this image before attaching it.');
    return { name: attachment.name, path: file.path, mimeType: file.mimeType, dataUrl: `data:${file.mimeType};base64,${file.data.toString('base64')}` };
  }
  const file = await readFile(workspace, attachment.path), shortened = file.truncated || file.content.length > 50_000;
  return { name: attachment.name, path: file.path, mimeType: 'text/plain', content: file.content.slice(0, 50_000) + (shortened ? '\n[Attachment truncated]' : '') };
}
