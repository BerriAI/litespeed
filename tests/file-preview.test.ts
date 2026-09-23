import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm, symlink, link, truncate } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { filePreview, readPreviewAsset } from '../server/file-preview.js';
import { previousWorkspaces, workspaceAttachmentPath, workspaceFileLink } from '../client/src/file-links.js';
import type { Message } from '../shared/types.js';
import { highlightedLines } from '../client/src/syntax.js';

describe('workspace artifact previews', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'litespeed-preview-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  it('keeps source text and serves bounded media using the declared type', async () => {
    await writeFile(join(root, 'README.md'), '# Hello\n');
    expect(await filePreview(root, 'README.md')).toMatchObject({ kind: 'text', content: '# Hello\n', size: 8 });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV5kAAAAASUVORK5CYII=', 'base64');
    await writeFile(join(root, 'image.png'), png);
    expect(await filePreview(root, 'image.png')).toMatchObject({ kind: 'image', mimeType: 'image/png', content: '' });
    expect((await readPreviewAsset(root, 'image.png')).data).toEqual(png);
    await writeFile(join(root, 'document.pdf'), '%PDF-1.7\n');
    expect(await filePreview(root, 'document.pdf')).toMatchObject({ kind: 'pdf', mimeType: 'application/pdf' });
    await writeFile(join(root, 'shape.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(await filePreview(root, 'shape.svg')).toMatchObject({ kind: 'text' });
    expect((await readPreviewAsset(root, 'shape.svg')).mimeType).toBe('image/svg+xml');
  });
  it('rejects misleading media types and oversized files before returning bytes', async () => {
    await writeFile(join(root, 'fake.png'), '<script>danger()</script>');
    await expect(readPreviewAsset(root, 'fake.png')).rejects.toThrow('does not match');
    await truncate(join(root, 'fake.png'), 26 * 1024 * 1024);
    await expect(readPreviewAsset(root, 'fake.png')).rejects.toThrow('too large');
  });
  it('cannot expose credentials, hard links, external symlinks, or directory entries', async () => {
    await mkdir(join(root, 'workspace')); await writeFile(join(root, 'private.png'), 'secret');
    await writeFile(join(root, 'workspace', '.env'), 'secret');
    await symlink('../private.png', join(root, 'workspace', 'outside.png'));
    await symlink('.env', join(root, 'workspace', 'alias.png'));
    await link(join(root, 'workspace', '.env'), join(root, 'workspace', 'hard.png'));
    for (const file of ['../private.png', 'outside.png', 'alias.png', 'hard.png', '.env', '.']) {
      await expect(filePreview(join(root, 'workspace'), file)).rejects.toThrow();
      await expect(readPreviewAsset(join(root, 'workspace'), file)).rejects.toThrow();
    }
  });
});

describe('document link and source presentation', () => {
  it('maps historical paths only along recorded workspace moves ending at the current folder', () => {
    const move = (from: string, to: string, role: Message['role'] = 'system'): Message => ({ id: from + to, sessionId: 'task', role, content: '', createdAt: 1, workspaceMove: { from, to } });
    const messages = [move('/other', '/unrelated'), move('/project', '/copies/first'), move('/copies/first', '/project'), move('/project', '/copies/second')];
    expect(previousWorkspaces(messages, '/copies/second')).toEqual(['/project', '/copies/first']);
    expect(previousWorkspaces(messages, '/changed-directly')).toEqual([]);
    for (const from of ['/', '/invalid/../folder', '/invalid/./folder', '/invalid//folder', '/invalid\0folder', '/invalid\\folder']) expect(previousWorkspaces([move(from, '/project')], '/project')).toEqual([]);
    expect(previousWorkspaces([move('/outside', '/project', 'user')], '/project')).toEqual([]);
  });
  it('opens historical links and literal attachment paths in the current project without reaching the source folder', () => {
    const previous = ['/project', '/project/.copies/older'];
    expect(workspaceFileLink('/project/.copies/older/src/my%20file.ts:17', '/current', '', previous)).toEqual({ path: 'src/my file.ts', line: 17 });
    expect(workspaceAttachmentPath('/project/.copies/older/docs/a%20note#1.md', '/current', previous)).toBe('docs/a%20note#1.md');
    expect(workspaceFileLink('../src/main.ts#L3', '/current', 'docs/README.md', previous)).toEqual({ path: 'src/main.ts', line: 3 });
    for (const path of ['/project-other/secret', '/project/../secret', '/project/.copies/older/../../secret', '/outside/file']) {
      expect(workspaceFileLink(path, '/current', '', previous)).toBeNull(); expect(workspaceAttachmentPath(path, '/current', previous)).toBeNull();
    }
  });
  it('keeps literal attachment filenames intact and confines current-file links to the project', () => {
    expect(workspaceAttachmentPath('/project/docs/a%20note#1.md', '/project')).toBe('docs/a%20note#1.md');
    expect(workspaceAttachmentPath('./docs/../a:12.ts', '/project')).toBe('a:12.ts');
    expect(workspaceAttachmentPath('src/my file.ts', '/project/')).toBe('src/my file.ts');
    for (const path of ['../outside', '/project-other/file.txt', '/other/file.txt', 'bad\0file', 'folder\\file']) expect(workspaceAttachmentPath(path, '/project')).toBeNull();
    expect(workspaceAttachmentPath('file.txt', undefined)).toBeNull();
  });
  it('resolves relative and absolute file links with line references without leaving the project', () => {
    expect(workspaceFileLink('/project/src/main.ts:42', '/project')).toEqual({ path: 'src/main.ts', line: 42 });
    expect(workspaceFileLink('../src/main.ts#L4-L9', '/project', 'docs/README.md')).toEqual({ path: 'src/main.ts', line: 4 });
    expect(workspaceFileLink('./my%20file.md', '/project')).toEqual({ path: 'my file.md' });
    expect(workspaceFileLink('README.md:150', '/project')).toEqual({ path: 'README.md', line: 150 });
    for (const href of ['../../secret', '/project-other/.env', 'https://example.com/file.ts', 'http://localhost:3000', 'https://example.com:8443', '//example.com', 'javascript:alert(1)', 'javascript:123', 'data:123', '#section', 'bad%ZZ', '%00secret']) expect(workspaceFileLink(href, '/project')).toBeNull();
  });
  it('escapes HTML and balances multiline syntax tokens on each numbered line', () => {
    const lines = highlightedLines('/* first\n second */\nconst html = "<script>";', 'index.ts');
    expect(lines).toHaveLength(3);
    for (const line of lines) expect((line.match(/<span /g) || []).length).toBe((line.match(/<\/span>/g) || []).length);
    expect(lines[2]).toContain('&lt;script&gt;');
    expect(highlightedLines('<img src=x onerror=alert(1)>', 'plain.txt')).toEqual(['&lt;img src=x onerror=alert(1)&gt;']);
  });
});
