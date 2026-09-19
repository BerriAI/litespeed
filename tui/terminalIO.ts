import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import type { CliRenderer } from '@opentui/core';
import type { Attachment } from '../shared/types.js';

const ATTACHMENT_LIMIT = 4_400_000;

export async function attachmentFromFile(filename: string, workspace: string): Promise<Attachment> {
  const path = resolve(workspace, filename), info = await stat(path), name = basename(path);
  if (!info.isFile()) throw new Error('Choose a file to attach.');
  if (info.size > ATTACHMENT_LIMIT) throw new Error('Attachments must be smaller than 4.4 MB.');
  const data = await readFile(path);
  const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' } as Record<string, string>)[extname(path).toLowerCase()];
  if (mime) return { name, mimeType: mime, dataUrl: `data:${mime};base64,${data.toString('base64')}` };
  let content: string;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { throw new Error('Attach UTF-8 text or a PNG, JPEG, GIF, or WebP image.'); }
  if (content.includes('\0')) throw new Error('This file contains binary data. Attach text or an image.');
  if (content.length > 200_000) throw new Error('Text attachments must be shorter than 200,000 characters. Use a file reference for larger files.');
  return { name, content, mimeType: 'text/plain' };
}

function capture(command: string, args: string[]): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    const subprocess = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = []; let size = 0, settled = false;
    const finish = (value?: Buffer) => { if (!settled) { settled = true; resolve(value); } };
    const fail = (error: Error) => { if (!settled) { settled = true; reject(error); } };
    subprocess.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > ATTACHMENT_LIMIT) { subprocess.kill(); fail(new Error('Clipboard images must be smaller than 4.4 MB.')); }
      else chunks.push(chunk);
    });
    subprocess.once('error', error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? finish() : fail(error));
    subprocess.once('close', code => finish(code === 0 ? Buffer.concat(chunks) : undefined));
  });
}

const MACOS_CLIPBOARD_IMAGE = "ObjC.import('AppKit'); const pasteboard = $.NSPasteboard.generalPasteboard; let data = pasteboard.dataForType('public.png'); if (!data) { const tiff = pasteboard.dataForType('public.tiff'); if (tiff) data = $.NSBitmapImageRep.alloc.initWithData(tiff).representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $()); } if (!data) $.exit(1); $.NSFileHandle.fileHandleWithStandardOutput.writeData(data);";

export async function attachmentFromClipboard(): Promise<Attachment | undefined> {
  let data: Buffer | undefined;
  if (process.platform === 'darwin') data = await capture('osascript', ['-l', 'JavaScript', '-e', MACOS_CLIPBOARD_IMAGE]);
  else if (process.platform === 'linux') data = await capture('wl-paste', ['--type', 'image/png']) ?? await capture('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']);
  if (!data?.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return undefined;
  return { name: 'clipboard-image.png', mimeType: 'image/png', dataUrl: `data:image/png;base64,${data.toString('base64')}` };
}

let handoff = false;
export async function withTerminal(renderer: CliRenderer, operation: () => Promise<void>) {
  if (handoff) throw new Error('The terminal is already in use.');
  handoff = true;
  const ignoreInterrupt = () => {};
  process.on('SIGINT', ignoreInterrupt);
  renderer.suspend();
  try { await operation(); }
  finally { process.off('SIGINT', ignoreInterrupt); handoff = false; renderer.resume(); }
}
function child(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', env: process.env });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? done() : reject(new Error(`Command exited with ${signal || code}.`)));
  });
}
export async function editDraft(renderer: CliRenderer, text: string, workspace: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'litespeed-draft-')), path = join(directory, 'message.md');
  await writeFile(path, text, { mode: 0o600 });
  let keep = false;
  try {
    const editor = process.env.VISUAL || process.env.EDITOR || 'vi';
    await withTerminal(renderer, () => child(process.env.SHELL || '/bin/sh', ['-c', `${editor} '${path.replace(/'/g, `'\\''`)}'`], workspace));
    const next = await readFile(path, 'utf8');
    if (next.length > 200_000) throw new Error('The edited message exceeds 200,000 characters.');
    return next;
  } catch (error) {
    keep = true;
    throw new Error(`${(error as Error).message} Your editor file is preserved at ${path}.`);
  } finally { if (!keep) await rm(directory, { recursive: true, force: true }); }
}
export async function openShell(renderer: CliRenderer, workspace: string) {
  await withTerminal(renderer, async () => { process.stdout.write('Litespeed shell · type exit to return to your session.\n'); await child(process.env.SHELL || '/bin/sh', ['-i'], workspace); });
}
export function suspendTerminal(renderer: CliRenderer) {
  renderer.suspend();
  process.once('SIGCONT', () => renderer.resume());
  // Stop the foreground job, including the Node launcher. Stopping only
  // Bun leaves the parent running and prevents the shell from regaining control.
  process.kill(0, 'SIGTSTP');
}
