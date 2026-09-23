import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { snapshotFileAttachment } from '../server/attachment-files.js';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV5kAAAAASUVORK5CYII=', 'base64');
describe('workspace attachment snapshots', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'litespeed-attachment-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  it('captures text and marks the attachment limit even below the general file-read limit', async () => {
    await writeFile(join(root, 'notes.txt'), 'a'.repeat(50_001));
    const snapshot = await snapshotFileAttachment(root, { name: 'notes.txt', path: 'notes.txt', content: 'stale', dataUrl: 'data:image/png;base64,ZmFrZQ==' });
    expect(snapshot.content).toBe('a'.repeat(50_000) + '\n[Attachment truncated]'); expect(snapshot.dataUrl).toBeUndefined(); expect(snapshot.mimeType).toBe('text/plain');
    await writeFile(join(root, 'notes.txt'), 'later'); expect(snapshot.content).not.toBe(await readFile(join(root, 'notes.txt'), 'utf8'));
  });
  it('captures supported image bytes and drops stale client-supplied content', async () => {
    await writeFile(join(root, 'image.PNG'), png); const image = await snapshotFileAttachment(root, { name: 'image.PNG', path: './image.PNG', content: 'stale notes', mimeType: 'text/plain' });
    expect(image).toEqual({ name: 'image.PNG', path: 'image.PNG', mimeType: 'image/png', dataUrl: `data:image/png;base64,${png.toString('base64')}` });
  });
  it('rejects oversized/misleading images and file references outside the readable project boundary', async () => {
    await writeFile(join(root, 'large.png'), png); await truncate(join(root, 'large.png'), 4 * 1024 * 1024 + 1); await expect(snapshotFileAttachment(root, { name: 'large.png', path: 'large.png' })).rejects.toThrow('4 MiB');
    await writeFile(join(root, 'wrong.png'), '<script>invalid</script>'); await expect(snapshotFileAttachment(root, { name: 'wrong.png', path: 'wrong.png' })).rejects.toThrow('does not match');
    await mkdir(join(root, 'project')); await symlink('../wrong.png', join(root, 'project/alias.png')); await writeFile(join(root, 'project/.env'), 'private');
    for (const path of ['alias.png', '../wrong.png', '.env']) await expect(snapshotFileAttachment(join(root, 'project'), { name: path, path })).rejects.toThrow();
  });
  it('keeps ordinary uploaded attachments unchanged and preserves empty files', async () => {
    const uploaded = { name: 'upload.txt', content: 'original' }; expect(await snapshotFileAttachment(root, uploaded)).toBe(uploaded);
    await writeFile(join(root, 'empty.txt'), ''); expect((await snapshotFileAttachment(root, { name: 'empty.txt', path: 'empty.txt' })).content).toBe('');
  });
});
