import { test, expect, type Page } from './fixtures';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrowserSessions } from '../../server/browser-state.js';

let workspace: string, session: { id: string };
function pdf() {
  const stream='BT /F1 24 Tf 40 120 Td (Litespeed document preview) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let value='%PDF-1.4\n';const offsets=[0];
  for(const [i,object] of objects.entries()){offsets.push(value.length);value+=`${i+1} 0 obj\n${object}\nendobj\n`;}
  const xref=value.length;value+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return value;
}
test.beforeEach(async({request})=>{
  workspace=await realpath(await mkdtemp(join(tmpdir(),'litespeed-desktop-ui-')));await mkdir(join(workspace,'src'));
  await writeFile(join(workspace,'src/hello.ts'),'/** A small example. */\nexport interface Task {\n  id: string;\n  title: string;\n}\n');
  await writeFile(join(workspace,'README.md'),'# Your workspace\n\nA focused place to build.\n\n[Read the source](src/hello.ts:4)\n');
  await writeFile(join(workspace,'demo.html'),'<style>body{font:24px system-ui;padding:30px}</style><h1>Interactive preview</h1><button onclick="this.textContent=\'Clicked\'">Try it</button><script>fetch("/api/settings").then(()=>document.body.dataset.escaped="yes").catch(()=>{});try{parent.document.body.dataset.escaped="yes"}catch{}</script>');
  await writeFile(join(workspace,'image.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV5kAAAAASUVORK5CYII=','base64'));
  await writeFile(join(workspace,'document.pdf'),pdf());
  session=await(await request.post('/api/sessions',{data:{workspace,title:'Desktop workspace',providerId:'fixture',model:'test-model',permissionMode:'auto',architecture:null}})).json();
});
test.afterEach(async({request})=>{await request.delete(`/api/sessions/${session.id}`);await rm(workspace,{recursive:true,force:true});});
async function open(page:Page){await page.goto(`/#session/${session.id}`);await expect(page.getByRole('textbox',{name:'Message Litespeed'})).toBeVisible();await page.getByRole('button',{name:'Show workspace panel'}).click();}
async function file(page:Page,name:string){const browse=page.getByRole('button',{name:'Browse files',exact:true});if(await browse.isVisible())await browse.click();await page.locator('.file-list').getByRole('button',{name,exact:true}).click();}

test('documents open in persistent tabs with source, line links, and restoration',async({page})=>{
  await open(page);await file(page,'README.md');await expect(page.locator('.document-markdown h1')).toHaveText('Your workspace');
  await page.getByRole('link',{name:'Read the source'}).click();await expect(page.locator('.code-line.highlighted-line')).toContainText('title: string');
  await expect(page.locator('.code-view .hljs-keyword').first()).toContainText('export');
  await expect(page.getByRole('tab',{name:'README.md'})).toBeVisible();await expect(page.getByRole('tab',{name:'hello.ts'})).toBeVisible();
  await page.getByRole('tab',{name:'README.md'}).click();await page.getByRole('button',{name:'Source',exact:true}).click();await expect(page.locator('.code-view')).toContainText('# Your workspace');
  await page.reload();await expect(page.getByRole('tab',{name:'README.md'})).toHaveAttribute('aria-selected','true');await expect(page.getByRole('tab',{name:'hello.ts'})).toBeVisible();
  await page.getByRole('button',{name:'Close README.md',exact:true}).click();await expect(page.getByRole('tab',{name:'hello.ts'})).toHaveAttribute('aria-selected','true');
  await page.getByRole('button',{name:'Close workspace'}).click();await page.getByRole('button',{name:'Show workspace panel'}).click();await expect(page.getByRole('tab',{name:'hello.ts'})).toHaveAttribute('aria-selected','true');
});
test('HTML is interactive in isolation, images decode, and PDF pages render',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await open(page);await file(page,'demo.html');
  const preview=page.frameLocator('.html-preview');await expect(preview.getByRole('heading')).toHaveText('Interactive preview');await preview.getByRole('button',{name:'Try it'}).click();await expect(preview.getByRole('button',{name:'Clicked'})).toBeVisible();
  expect(await page.locator('body').getAttribute('data-escaped')).toBeNull();
  await file(page,'image.png');await expect.poll(()=>page.locator('.image-preview img').evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBe(1);
  await file(page,'document.pdf');await expect(page.getByRole('img',{name:'Page 1: Litespeed document preview'})).toBeVisible();
  expect(errors).toEqual([]);
});
test('file links in the conversation open their document beside the task',async({page})=>{
  await page.goto(`/#session/${session.id}`);await page.getByRole('textbox',{name:'Message Litespeed'}).fill('DESKTOP_FILE_LINKS');await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.getByRole('link',{name:'the project overview'}).click();await expect(page.locator('.document-markdown h1')).toHaveText('Your workspace');
  await page.getByRole('link',{name:'the source',exact:true}).click();await expect(page.locator('.code-line.highlighted-line')).toContainText('title: string');
});
test('real browser tool opens the live panel, keeps its tabs, and permits manual navigation',async({page,request})=>{
  const settings=await(await request.get('/api/settings')).json();const url=settings.providers.find((p:{id:string})=>p.id==='fixture').baseUrl+'/browser-fixture';
  await page.goto(`/#session/${session.id}`);await page.getByRole('textbox',{name:'Message Litespeed'}).fill(`DESKTOP_BROWSER ${url}`);await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(page.getByRole('article',{name:'Assistant message'}).last()).toContainText('The browser is open');await expect(page.getByRole('tab',{name:'Browser',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('img',{name:'Browser preview of Workspace preview'})).toBeVisible();
  await page.getByRole('button',{name:'New browser tab'}).click();await expect(page.locator('.browser-tabs [role=tab]')).toHaveCount(2);
  await page.getByRole('combobox',{name:'Browser address'}).fill(url.replace('browser-fixture','browser-next'));await page.getByRole('button',{name:'Go to address'}).click();await expect(page.getByRole('tab',{name:'Next page',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('tab',{name:'Workspace preview',exact:true}).click();await expect(page.getByRole('combobox',{name:'Browser address'})).toHaveValue(url);
  await expect.poll(async()=>(await(await request.get(`/api/sessions/${session.id}/browser`)).json()).width).toBe(await page.getByLabel('Interactive browser page').evaluate(element=>element.clientWidth));
  await expect(page.getByRole('button',{name:'Reload page'})).toBeEnabled();
  expect((await request.post(`/api/sessions/${session.id}/browser`,{data:{action:'click',ref:'e1'}})).ok()).toBe(true);
  await page.getByLabel('Interactive browser page').focus();await page.keyboard.type('Ada Lovelace');
  await expect(page.getByRole('button',{name:'Reload page'})).toBeEnabled();
  expect((await request.post(`/api/sessions/${session.id}/browser`,{data:{action:'click',ref:'e2'}})).ok()).toBe(true);
  await expect(page.getByRole('tab',{name:'Hello, Ada Lovelace',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();await expect(page.locator('.browser-tabs [role=tab]')).toHaveCount(2);
});
test('saved browser tabs reopen explicitly and remain clean at narrow widths', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const settings = await (await request.get('/api/settings')).json();
  const url = settings.providers.find((provider: { id: string }) => provider.id === 'fixture').baseUrl + '/browser-fixture';
  const first = { id: randomUUID(), title: 'Workspace preview', url }, second = { id: randomUUID(), title: 'Next page', url: url.replace('browser-fixture', 'browser-next') };
  await new BrowserSessions(join(settings.workspace, 'state')).save(session.id, { tabs: [first, second], activeId: first.id, width: 640, height: 800 });
  const frames: string[] = []; page.on('request', request => { if (request.url().includes('/browser/frame')) frames.push(request.url()); });
  await open(page); await page.getByRole('tab', { name: 'Browser', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reopen tab', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Browser address' })).toHaveValue(url);
  await expect(page.getByRole('button', { name: 'Browser back' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Type into page', exact: true })).toBeDisabled();
  expect(frames).toEqual([]);
  await mkdir('.ui-audit', { recursive: true }); await page.screenshot({ path: '.ui-audit/browser-saved-desktop.png' });
  await page.getByRole('button', { name: 'Close browser tab Next page' }).click();
  await expect(page.getByRole('tab', { name: 'Workspace preview', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Reopen tab', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Browser preview of Workspace preview' })).toBeVisible();
  const current = await (await request.get(`/api/sessions/${session.id}/browser`)).json();
  expect(current.activeId).toBe(first.id); expect(current.tabs[0].suspended).toBeUndefined();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('combobox', { name: 'Browser address' })).toBeVisible();
  expect(await page.getByRole('complementary', { name: 'Session navigation' }).evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  const width = await page.getByLabel('Interactive browser page').evaluate(element => element.clientWidth);
  await expect.poll(async () => (await (await request.get(`/api/sessions/${session.id}/browser`)).json()).width).toBe(width);
  await expect.poll(async () => page.getByRole('img', { name: 'Browser preview of Workspace preview' }).evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.ui-audit/browser-restored-mobile.png' });
});
test('workspace fits mobile and keyboard resizing stays within its limits',async({page})=>{
  await open(page);const divider=page.getByRole('separator',{name:'Resize workspace'});await divider.focus();await page.keyboard.press('ArrowLeft');await expect(divider).toHaveAttribute('aria-valuenow','504');
  await page.setViewportSize({width:390,height:844});await expect(page.getByRole('button',{name:'Hide workspace panel'})).toBeVisible();await file(page,'README.md');await expect(page.locator('.document-markdown h1')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('a late browser action cannot replace the browser in another task', async ({ page, request }) => {
  const second = await (await request.post('/api/sessions', { data: { workspace, title: 'Another task', providerId: 'fixture', model: 'test-model', architecture: null } })).json();
  let release!: () => void, received!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), upstream = new Promise<void>(resolve => { received = resolve; });
  let fulfilled!: () => void; const delivered = new Promise<void>(resolve => { fulfilled = resolve; });
  await page.route(`**/api/sessions/${session.id}/browser`, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch(); received(); await gate;
    try { await route.fulfill({ response }); } catch { /* A task switch may cancel its old fetch. */ } finally { fulfilled(); }
  });
  try {
    await open(page); await page.getByRole('tab', { name: 'Browser', exact: true }).click();
    await page.getByRole('button', { name: 'New browser tab' }).click(); await upstream;
    await page.evaluate(id => { window.location.hash = `session/${id}`; }, second.id);
    await expect(page.locator('.topbar-title')).toHaveText('Another task');
    await page.getByRole('tab', { name: 'Browser', exact: true }).click();
    await expect(page.locator('.browser-tabs [role=tab]')).toHaveCount(0);
    release(); await delivered;
    await expect(page.locator('.browser-tabs [role=tab]')).toHaveCount(0);
    await page.getByRole('button', { name: 'New browser tab' }).click();
    await expect(page.locator('.browser-tabs [role=tab]')).toHaveCount(1);
    expect((await (await request.get(`/api/sessions/${session.id}/browser`)).json()).tabs).toHaveLength(1);
    expect((await (await request.get(`/api/sessions/${second.id}/browser`)).json()).tabs).toHaveLength(1);
  } finally { release(); await request.delete(`/api/sessions/${second.id}`); }
});
