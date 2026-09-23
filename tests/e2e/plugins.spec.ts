import { test, expect } from './fixtures';
import { mkdtemp, mkdir, realpath, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let root: string, workspace: string, plugin: string, session: { id: string };
test.beforeEach(async({request})=>{
  root=await realpath(await mkdtemp(join(tmpdir(),'litespeed-plugin-ui-')));workspace=join(root,'project');plugin=join(root,'plugin');
  await mkdir(workspace);await mkdir(join(plugin,'skills'),{recursive:true});
  await writeFile(join(plugin,'litespeed-plugin.json'),JSON.stringify({name:'review-kit',version:'1.0.0',description:'A focused checklist for thoughtful code reviews.',skills:[{id:'audit',path:'skills/audit.md'}]}));
  await writeFile(join(plugin,'skills/audit.md'),'---\nname: audit\ndescription: Check behavior, tests, and clarity.\n---\n# Audit\n\nCheck behavior, tests, and clarity.\n');
  session=await(await request.post('/api/sessions',{data:{title:'Plugin workspace',workspace,providerId:'fixture',model:'test-model',architecture:null}})).json();
});
test.afterEach(async({request})=>{await request.delete(`/api/plugins/review-kit?workspace=${encodeURIComponent(workspace)}`);await request.delete(`/api/sessions/${session.id}`);await rm(root,{recursive:true,force:true});});
test('installs a reviewed plugin, lists its skills, searches, and removes it without losing a conversation draft',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`/#session/${session.id}`);await page.getByRole('textbox',{name:'Message Litespeed'}).fill('A draft worth keeping');
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Plugins',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Plugins',exact:true})).toBeVisible();await page.getByRole('button',{name:'Add plugin',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('Plugin folder').fill(plugin);await dialog.getByRole('button',{name:'Review plugin'}).click();await expect(dialog).toContainText('audit');
  await expect(async()=>await readFile(join(workspace,'.litespeed/skills/audit/SKILL.md'))).rejects.toThrow();
  await dialog.getByRole('button',{name:'Install plugin'}).click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('heading',{name:'review-kit',exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'Search plugins'}).fill('missing');await expect(page.getByText('No matching plugins',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Clear plugin search'}).click();
  await page.getByRole('tab',{name:'Skills',exact:true}).click();await expect(page.locator('.skill-catalog-card')).toHaveCount(1);
  await page.getByRole('tab',{name:'Installed',exact:true}).click();await page.getByRole('button',{name:'Remove review-kit'}).click();await page.getByRole('dialog').getByRole('button',{name:'Remove plugin',exact:true}).click();await expect(page.getByRole('heading',{name:'review-kit',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Plugin workspace',exact:true}).click();await expect(page.getByRole('textbox',{name:'Message Litespeed'})).toHaveValue('A draft worth keeping');expect(errors).toEqual([]);
});
test('changed plugin sources require a fresh review before installation',async({page})=>{
  await page.goto(`/#session/${session.id}`);await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Plugins',exact:true}).click();await page.getByRole('button',{name:'Add plugin',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('Plugin folder').fill(plugin);await dialog.getByRole('button',{name:'Review plugin'}).click();await expect(dialog.getByRole('button',{name:'Install plugin'})).toBeVisible();
  await writeFile(join(plugin,'skills/audit.md'),'# Audit\n\nA changed checklist.\n');await dialog.getByRole('button',{name:'Install plugin'}).click();await expect(dialog.getByRole('alert')).toContainText('Review the installation again');await expect(dialog.getByLabel('Plugin folder')).toHaveValue(plugin);
  await dialog.getByRole('button',{name:'Review plugin'}).click();await dialog.getByRole('button',{name:'Install plugin'}).click();await expect(dialog).toHaveCount(0);
});
test('projects open directly without editing provider settings, persist, and fit mobile',async({page,request})=>{
  const before=await(await request.get('/api/settings')).json();await page.goto('/');await page.getByRole('button',{name:'Add project',exact:true}).click();
  const picker=page.getByRole('dialog',{name:'Choose a project'});await picker.getByRole('button',{name:'Open a folder'}).click();await picker.getByLabel('Project folder path').fill(workspace);await picker.getByRole('button',{name:'Open project',exact:true}).click();await expect(picker).toHaveCount(0);
  await expect(page.locator('.composer-project-strip')).toContainText('project');await page.reload();await expect(page.locator('.composer-project-strip')).toContainText('project');
  expect((await(await request.get('/api/settings')).json()).workspace).toBe(before.workspace);
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Open navigation'}).click();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Plugins',exact:true}).click();await expect(page.getByRole('heading',{name:'Plugins',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('plugin navigation survives reload and returns to the same task with browser history',async({page})=>{
  await page.goto(`/#session/${session.id}`);await page.getByRole('textbox',{name:'Message Litespeed'}).fill('Keep this task draft');
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Plugins',exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`#plugins/session/${session.id}$`));await page.reload();
  await expect(page.getByRole('heading',{name:'Plugins',exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Skills',exact:true}).click();await expect(page.getByText('Some project skills need attention')).toHaveCount(0);
  await page.goBack();await expect(page.getByRole('textbox',{name:'Message Litespeed'})).toHaveValue('Keep this task draft');
  await page.goForward();await expect(page.getByRole('heading',{name:'Plugins',exact:true})).toBeVisible();
});
