import { test, expect } from './fixtures';
const state = { currentVersion: '0.1.0', latestVersion: '0.2.0', available: true, packaged: true, restartRequired: false, releaseUrl: 'https://github.com/BerriAI/litespeed/releases/tag/v0.2.0', command: 'litespeed update' };
test('updates are visible, staged explicitly, and preserve work when restart is blocked', async ({ page }) => {
  let installed = false;
  await page.route('**/api/updates**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/restart')) return route.fulfill({ status: 409, json: { error: 'Finish active tasks and background jobs before restarting.' } });
    if (path.endsWith('/install')) installed = true;
    return route.fulfill({ json: { ...state, restartRequired: installed, ...(installed ? { installedVersion: '0.2.0' } : {}) } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Update to 0.2.0' }).click();
  await expect(page.getByRole('region', { name: 'Litespeed updates' })).toContainText('Litespeed 0.1.0');
  await page.getByRole('button', { name: 'Install update', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Litespeed updates' })).toContainText('0.2.0 is installed');
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Litespeed updates' }).getByRole('alert')).toContainText('Finish active tasks');
});
test('source checkouts get an honest update path and offline checks can be retried', async ({ page }) => {
  await page.route('**/api/updates**', route => route.fulfill({ json: { ...state, packaged: false, error: 'Update check failed (offline).' } }));
  await page.goto('/'); await page.getByRole('button', { name: 'Update to 0.2.0' }).click();
  const panel = page.getByRole('region', { name: 'Litespeed updates' });
  await expect(panel).toContainText('update your source checkout');
  await expect(page.getByRole('button', { name: 'Install update', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Check again', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('offline');
});

test('desktop updates replace the help icon, wait for active work, and restart through the native bridge', async ({ page }) => {
  let available = false, installed = false, active = true, restarted = 0;
  await page.exposeFunction('nativeUpdateTest', () => { restarted++; });
  await page.addInitScript(() => { Object.defineProperty(window, 'litespeedDesktop', {value:{platform:'darwin',chooseFolder:async()=>null,restartUpdate:async()=>{await (window as any).nativeUpdateTest();}}}); });
  await page.route('**/api/updates**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/install')) installed = true;
    return route.fulfill({json:{...state,kind:'desktop',currentBuild:1,latestBuild:2,available,restartRequired:installed,installedVersion:installed?'0.2.0':undefined,blockers:active?['A task is still running.','Close workspace terminals before restarting.']:[]}});
  });
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Help & updates'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Update to 0.2.0'})).toHaveCount(0);
  available = true; await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.getByRole('button',{name:'Update to 0.2.0'}).click();
  await expect(page.getByRole('button',{name:'Help & updates'})).toHaveCount(0);
  const dialog=page.getByRole('dialog',{name:'Update Litespeed',exact:true});
  await expect(dialog).toContainText('Your work is still active');
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.screenshot({path:'.ui-audit/update-dialog-dark.png',animations:'disabled'});
  await page.getByRole('button',{name:'Update when idle',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Keep Litespeed open');
  expect(restarted).toBe(0);
  await page.getByRole('button',{name:'Cancel restart',exact:true}).click();
  active=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button',{name:'Restart now',exact:true})).toBeVisible();
  expect(restarted).toBe(0);
  await page.getByRole('button',{name:'Restart now',exact:true}).click();
  await expect.poll(()=>restarted).toBe(1);
});

test('desktop updates keep drafts and an actionable error when the native restart fails', async ({page}) => {
  await page.addInitScript(()=>{Object.defineProperty(window,'litespeedDesktop',{value:{platform:'darwin',chooseFolder:async()=>null,restartUpdate:async()=>{throw new Error('A task started before restart. Your app is still open.');}}});});
  await page.route('**/api/updates**',route=>route.fulfill({json:{...state,kind:'desktop',currentBuild:1,latestBuild:2,restartRequired:true,installedVersion:'0.2.0',blockers:[]}}));
  await page.goto('/');await page.getByRole('textbox',{name:'Message Litespeed'}).fill('Keep this unfinished thought.');
  await page.getByRole('button',{name:'Restart to update'}).click();
  await page.getByRole('button',{name:'Restart now',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('A task started before restart');
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Message Litespeed'})).toHaveValue('Keep this unfinished thought.');
});

test('desktop update dialog fits narrow screens and supports keyboard dismissal', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/updates**',route=>route.fulfill({json:{...state,kind:'desktop',currentBuild:1,latestBuild:2,packaged:false,command:'Drag Litespeed into Applications before updating.',blockers:[]}}));
  await page.goto('/');await page.getByRole('button',{name:'Open navigation'}).click();
  await page.getByRole('button',{name:'Update to 0.2.0'}).click();
  await expect(page.getByRole('dialog')).toContainText('Drag Litespeed into Applications');
  await expect(page.getByRole('button',{name:'Update and restart',exact:true})).toHaveCount(0);
  await expect(page.locator('html')).toHaveJSProperty('scrollWidth',390);
  await page.screenshot({path:'.ui-audit/update-dialog-390.png',animations:'disabled'});
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
});
