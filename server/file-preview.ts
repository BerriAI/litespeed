import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { assertReadablePath, readFile } from './tools.js';
import type { FilePreview } from '../shared/file-preview.js';

const MEDIA_LIMIT = 25 * 1024 * 1024;
const media: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.pdf': 'application/pdf' };

/** Uses the same credential, symlink, and workspace boundaries as file tools. */
export async function readPreviewAsset(workspace: string, file: string) {
  const absolute = await assertReadablePath(workspace, file);
  const mimeType = media[path.extname(absolute).toLowerCase()];
  if (!mimeType) throw new Error('This file does not have a supported media preview.');
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink > 1) throw new Error('Select a regular file without hard links.');
    if (stat.size > MEDIA_LIMIT) throw new Error('This file is too large to preview. The limit is 25 MB.');
    const buffer = Buffer.alloc(Math.min(stat.size + 1, MEDIA_LIMIT + 1));
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > stat.size || length > MEDIA_LIMIT) throw new Error('The file changed while opening. Try again.');
    const data = buffer.subarray(0, length);
    const signature = data.subarray(0, 1024).toString('utf8');
    const valid = mimeType === 'image/png' ? data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : mimeType === 'image/jpeg' ? data[0] === 255 && data[1] === 216 && data[2] === 255
      : mimeType === 'image/gif' ? /^GIF8[79]a/.test(signature)
      : mimeType === 'image/webp' ? signature.startsWith('RIFF') && signature.slice(8, 12) === 'WEBP'
      : mimeType === 'image/avif' ? signature.slice(4, 8) === 'ftyp' && /avif|avis/.test(signature.slice(8, 40))
      : mimeType === 'application/pdf' ? signature.startsWith('%PDF-')
      : /<svg[\s>]/i.test(signature);
    if (!valid) throw new Error('The file content does not match its media type.');
    return { data, mimeType, path: path.relative(await realpath(workspace), absolute).split(path.sep).join('/') };
  } finally { await handle.close(); }
}

export async function filePreview(workspace: string, file: string): Promise<FilePreview> {
  if (media[path.extname(file).toLowerCase()] && path.extname(file).toLowerCase() !== '.svg') {
    const asset = await readPreviewAsset(workspace, file);
    return { path: asset.path, mimeType: asset.mimeType, kind: asset.mimeType === 'application/pdf' ? 'pdf' : 'image', size: asset.data.length, content: '', revision: createHash('sha256').update(asset.data).digest('hex') };
  }
  const result = await readFile(workspace, file);
  return { ...result, kind: 'text', mimeType: 'text/plain', size: Buffer.byteLength(result.content) };
}
