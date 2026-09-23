import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chromium, type Page } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { SessionBrowsers } from '../server/browser.js';
import { browserUploadSchema } from '../server/browser-uploads.js';
import { browserUploadLimit, type BrowserUploadFile } from '../shared/browser.js';

const file = (name = 'notes.txt', text = 'A few thoughtful notes.'): BrowserUploadFile => ({ name, mimeType: 'text/plain', data: Buffer.from(text).toString('base64') });
describe('task browser file selection', () => {
  let root: string, browsers: SessionBrowsers, server: Server, url: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'litespeed-browser-upload-')); browsers = new SessionBrowsers(root);
    server = createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html');
      if (req.url === '/next') { res.end('<title>Next page</title><h1>Another page</h1>'); return; }
      if (req.url === '/embedded-host') { res.end('<title>Embedded uploader</title><iframe src="/embedded-input"></iframe>'); return; }
      res.end(`<title>File selection</title><input id="single" type="file" accept=".txt,text/plain" hidden><input id="many" type="file" multiple hidden><input id="folder" type="file" webkitdirectory hidden><button onclick="single.click()">One file</button><button onclick="many.click()">Several files</button><button onclick="single.replaceWith(single.cloneNode())">Replace input</button><button onclick="folder.click()">Folder</button><output>Nothing shared.</output><script>document.querySelectorAll('input').forEach(input=>input.onchange=async()=>{document.querySelector('output').textContent=JSON.stringify(await Promise.all([...input.files].map(async file=>({name:file.name,size:file.size,text:await file.text()}))));});</script>`);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterEach(async () => { vi.restoreAllMocks(); await browsers.close(); await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }); await rm(root, { recursive: true, force: true }); });
  async function choose(ref = 'e1') {
    if (!(await browsers.state('one')).activeId) await browsers.execute('one', { action: 'open', url });
    await browsers.execute('one', { action: 'click', ref });
    await expect.poll(async () => Boolean((await browsers.state('one')).upload)).toBe(true);
    const request = (await browsers.state('one')).upload!;
    return { action: 'upload' as const, requestId: request.id, tabId: request.tabId, files: [file()] };
  }
  it('delivers selected bytes to the exact file input and consumes the request once', async () => {
    const input = await choose(), pending = (await browsers.state('one')).upload!;
    expect(pending).toMatchObject({ multiple: false, accept: '.txt,text/plain', directory: false, url: url + '/', pageUrl: url + '/' });
    expect((await browsers.execute('one', { action: 'snapshot' })).snapshot).toContain('user can choose and review files');
    expect((await browsers.upload('one', input)).upload).toBeUndefined();
    expect((await browsers.execute('one', { action: 'snapshot' })).snapshot).toContain('A few thoughtful notes.');
    await expect(browsers.upload('one', input)).rejects.toThrow('changed or expired');
  });
  it('supports several files and empty files while enforcing the site’s single-file request', async () => {
    const single = await choose(); await expect(browsers.upload('one', { ...single, files: [file(), file('empty.txt', '')] })).rejects.toThrow('one file');
    expect((await browsers.state('one')).upload?.id).toBe(single.requestId);
    const multiple = await choose('e2'); expect((await browsers.state('one')).upload?.multiple).toBe(true);
    await browsers.upload('one', { ...multiple, files: [file('résumé.txt', 'Résumé\n'), file('empty.txt', '')] });
    const result = await browsers.execute('one', { action: 'snapshot' }); expect(result.snapshot).toContain('résumé.txt'); expect(result.snapshot).toContain('empty.txt'); expect(result.snapshot).toContain('"size":0');
  });
  it('cancels without clearing a previously selected file or sharing the new selection', async () => {
    await browsers.upload('one', await choose()); const input = await choose();
    await browsers.upload('one', { action: 'cancel', requestId: input.requestId, tabId: input.tabId });
    expect((await browsers.state('one')).upload).toBeUndefined(); expect((await browsers.execute('one', { action: 'snapshot' })).snapshot).toContain('A few thoughtful notes.');
    await expect(browsers.upload('one', input)).rejects.toThrow('changed or expired');
  });
  it('rejects other tasks and inactive tabs without selecting or resuming them', async () => {
    const input = await choose(); await expect(browsers.upload('other', input)).rejects.toThrow('original live browser tab');
    await browsers.execute('one', { action: 'open', url: url + '/next' }); const active = (await browsers.state('one')).activeId;
    await expect(browsers.upload('one', input)).rejects.toThrow('original live browser tab'); expect((await browsers.state('one')).activeId).toBe(active);
    await browsers.execute('one', { action: 'select', tabId: input.tabId }); await browsers.upload('one', input);
    expect((await browsers.execute('one', { action: 'snapshot' })).snapshot).toContain('A few thoughtful notes.');
    const saved = await choose(); await browsers.close(); browsers = new SessionBrowsers(root);
    await expect(browsers.upload('one', saved)).rejects.toThrow('original live browser tab'); expect((await browsers.state('one')).tabs.every(tab => tab.suspended)).toBe(true);
  });
  it('rejects a reloaded document, a replaced field and superseded requests', async () => {
    const first = await choose(), second = await choose(); await expect(browsers.upload('one', first)).rejects.toThrow('changed or expired');
    await browsers.execute('one', { action: 'click', ref: 'e3' }); await expect(browsers.upload('one', second)).rejects.toThrow('changed or expired');
    const third = await choose(); await browsers.execute('one', { action: 'reload' }); expect((await browsers.state('one')).upload).toBeUndefined(); await expect(browsers.upload('one', third)).rejects.toThrow('changed or expired');
  });
  it('bounds payloads and rejects local paths, invalid data and unsupported folder requests', async () => {
    const input = await choose();
    for (const name of ['/private/notes.txt', '../notes.txt', 'folder\\notes.txt', '.', 'bad\0name']) expect(() => browserUploadSchema.parse({ ...input, files: [file(name)] })).toThrow();
    for (const data of ['%%%', 'eA=', 'eA==\n', 'data:text/plain;base64,eA==']) expect(() => browserUploadSchema.parse({ ...input, files: [{ ...file(), data }] })).toThrow();
    expect(() => browserUploadSchema.parse({ ...input, files: [{ path: '/private/notes.txt' }] })).toThrow();
    const many = await choose('e2'), large = file('large.txt', 'x'.repeat(browserUploadLimit / 2 + 1));
    await expect(browsers.upload('one', { ...many, files: [large, large] })).rejects.toThrow('8 MB');
    expect((await browsers.state('one')).upload?.id).toBe(many.requestId);
    const folder = await choose('e4'); expect((await browsers.state('one')).upload?.directory).toBe(true); await expect(browsers.upload('one', folder)).rejects.toThrow('Folder uploads');
  });
  it('honors cancellation before sharing files and releases browser ownership', async () => {
    const input = await choose(), controller = new AbortController(); controller.abort(new Error('Request canceled'));
    await expect(browsers.upload('one', input, controller.signal)).rejects.toThrow('Request canceled');
    expect((await browsers.state('one')).busy).toBe(false); expect((await browsers.state('one')).upload?.id).toBe(input.requestId);
    expect((await browsers.execute('one', { action: 'snapshot' })).snapshot).toContain('Nothing shared.');
  });
  it('uses the requesting iframe and discards its chooser when that frame navigates', async () => {
    const launched = vi.spyOn(chromium, 'launchPersistentContext'); await browsers.execute('one', { action: 'open', url: url + '/embedded-host' });
    const page: Page = (await launched.mock.results.find(result => result.type === 'return')!.value).pages()[0];
    await page.frameLocator('iframe').getByRole('button', { name: 'One file', exact: true }).click();
    await expect.poll(async () => (await browsers.state('one')).upload?.url).toBe(url + '/embedded-input');
    const first = (await browsers.state('one')).upload!; await browsers.upload('one', { action: 'upload', tabId: first.tabId, requestId: first.id, files: [file()] });
    expect(await page.frameLocator('iframe').locator('output').innerText()).toContain('A few thoughtful notes.');
    await page.frameLocator('iframe').getByRole('button', { name: 'One file', exact: true }).click(); await expect.poll(async () => Boolean((await browsers.state('one')).upload)).toBe(true);
    const second = (await browsers.state('one')).upload!; await page.frames().find(frame => frame !== page.mainFrame())!.goto(url + '/next');
    await expect(browsers.upload('one', { action: 'upload', tabId: second.tabId, requestId: second.id, files: [file()] })).rejects.toThrow('changed or expired');
  });
  it('requires the original field settings and expires an unused chooser without sending anything', async () => {
    const launched = vi.spyOn(chromium, 'launchPersistentContext'); let input = await choose();
    const page: Page = (await launched.mock.results.find(result => result.type === 'return')!.value).pages()[0];
    for (const attribute of ['disabled', 'multiple', 'accept']) {
      await page.locator('#single').evaluate((element, attribute) => element.setAttribute(attribute, attribute === 'accept' ? '.pdf' : ''), attribute);
      await expect(browsers.upload('one', input)).rejects.toThrow('changed or expired');
      await page.locator('#single').evaluate((element, attribute) => { element.removeAttribute(attribute); element.setAttribute('accept', '.txt,text/plain'); }, attribute);
      input = await choose();
    }
    const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 10 * 60_000 + 1);
    expect((await browsers.state('one')).upload).toBeUndefined(); await expect(browsers.upload('one', input)).rejects.toThrow('changed or expired');
    expect(await page.locator('output').innerText()).toBe('Nothing shared.');
  });
});
