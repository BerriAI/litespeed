import { test, expect } from './fixtures';

test('setup explains roles, saves a workspace default, and keeps advanced controls out of the first run', async ({ page, request }, testInfo) => {
  const settings = await (await request.get('/api/settings')).json();
  const original = await (await request.get(`/api/workspace-preferences?workspace=${encodeURIComponent(settings.workspace)}`)).json();
  try {
    await request.post('/api/workspace-preferences', { data: { ...original, workspace:settings.workspace, providerId:'fixture', model:'test-model', setupComplete:false } });
    await page.goto('/');
    await page.getByRole('button',{name:'Set up Litespeed',exact:true}).click();
    const dialog = page.getByRole('dialog', { name:'Set up Litespeed', exact:true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Review your setup', {exact:true})).toBeVisible();
    await dialog.getByRole('combobox', { name:'Setup architecture' }).selectOption('team-fusion');
    await page.screenshot({ path:testInfo.outputPath('setup-architecture.png') });
    await dialog.getByRole('button', { name:'Worker model', exact:true }).click();
    await dialog.getByRole('option', { name:'test-fast', exact:true }).click();
    await expect(dialog.getByRole('combobox', { name:/reasoning/i })).toHaveCount(0);
    await dialog.getByRole('combobox', { name:'Setup permissions' }).selectOption('auto');
    await page.screenshot({ path:testInfo.outputPath('setup-models.png') });
    await page.setViewportSize({ width:390,height:844 });
    await page.screenshot({ path:testInfo.outputPath('setup-mobile.png') });
    await expect(dialog.getByRole('button', {name:'Start with this setup'})).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await dialog.getByRole('button', {name:'Start with this setup'}).click();
    await expect(dialog).toHaveCount(0);
    const preferences=await (await request.get(`/api/workspace-preferences?workspace=${encodeURIComponent(settings.workspace)}`)).json();
    expect(preferences).toMatchObject({setupComplete:true,permissionMode:'auto',architecture:{kind:'team-fusion',worker:{providerId:'fixture',model:'test-fast'}}});
    const session=await (await request.post('/api/sessions',{data:{workspace:settings.workspace}})).json();
    expect(session.architecture).toEqual(preferences.architecture);expect(session.permissionMode).toBe('auto');
    await page.reload();await expect(page.getByRole('textbox',{name:'Message Litespeed',exact:true})).toBeVisible();await expect(dialog).toHaveCount(0);
  } finally { await request.post('/api/workspace-preferences',{data:{...original,workspace:settings.workspace,providerId:'fixture',model:'test-model',architecture:original.architecture??null,permissionMode:original.permissionMode??'ask',setupComplete:true}}); }
});

test('Allow all tools resolves a live prompt and updates the visible session mode', async ({page,request}) => {
  const session=await (await request.post('/api/sessions',{data:{providerId:'fixture',model:'test-model',permissionMode:'ask',architecture:null}})).json();
  await page.goto(`/#session/${session.id}`);
  await page.getByRole('textbox',{name:'Message Litespeed',exact:true}).fill('create fixture with new permissions');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.getByRole('region',{name:'Permission requested'}).getByRole('button',{name:'Allow all tools',exact:true}).click();
  await expect.poll(async()=>(await (await request.get(`/api/sessions/${session.id}`)).json()).session.status).toBe('idle');
  await expect(page.locator('.permission-select summary')).toContainText('Allow all tools');
  await expect(page.getByRole('region',{name:'Permission requested'})).toHaveCount(0);
  await page.getByRole('textbox',{name:'Message Litespeed',exact:true}).fill('slow response');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect.poll(async()=>(await (await request.get(`/api/sessions/${session.id}`)).json()).session.status).toBe('running');
  await page.locator('.permission-select summary').click();
  await page.getByRole('button',{name:/Ask before changes/}).click();
  await expect.poll(async()=>(await (await request.get(`/api/sessions/${session.id}`)).json()).session.permissionMode).toBe('ask');
  await request.post(`/api/sessions/${session.id}/cancel`,{data:{}});
});


test('gateway setup asks for the URL and key, handles failure inline, and then selects available models', async ({page,request},testInfo) => {
  const settings=await (await request.get('/api/settings')).json();
  const original=await (await request.get(`/api/workspace-preferences?workspace=${encodeURIComponent(settings.workspace)}`)).json();
  try {
    await request.post('/api/workspace-preferences',{data:{...original,workspace:settings.workspace,providerId:'fixture',model:'test-model',setupComplete:false}});
    await request.patch('/api/settings',{data:{providers:[],defaultModel:''}});
    await page.goto('/');
    const dialog=page.getByRole('dialog',{name:'Set up Litespeed',exact:true});
    const url=dialog.getByLabel('Gateway base URL'),key=dialog.getByLabel('API key',{exact:false});
    await expect(url).toHaveValue('');await expect(key).toHaveAttribute('type','password');
    await expect(dialog.getByRole('button',{name:'Connect & continue'})).toBeDisabled();
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:testInfo.outputPath('gateway-mobile.png'),animations:'disabled'});
    await expect(dialog.getByRole('button',{name:'Connect & continue'})).toBeInViewport();
    await url.fill(settings.providers[0].baseUrl+'/setup-auth');await key.click();await key.pressSequentially('wrong-key',{delay:70});await expect(key).toHaveValue('wrong-key');
    await dialog.getByRole('button',{name:'Connect & continue'}).click();
    await expect(dialog.getByRole('alert')).toContainText('API key');
    expect((await (await request.get('/api/settings')).json()).providers).toEqual([]);
    await key.fill('fixture-key');await dialog.getByRole('button',{name:'Connect & continue'}).click();
    await expect(dialog.getByRole('group',{name:'Architecture'})).toHaveCount(0);
    await expect(dialog.getByRole('combobox',{name:'Setup permissions'})).toBeVisible();
    await dialog.getByRole('combobox',{name:'Setup permissions'}).selectOption('auto');
    await expect(dialog.getByRole('combobox',{name:'Setup architecture'})).toHaveValue('sidekick-fusion');
    await expect(dialog.getByRole('combobox',{name:'Setup architecture'}).getByRole('option',{name:'Sidekick Fusion · Recommended',exact:true})).toHaveCount(1);
    await expect(dialog.getByRole('combobox',{name:'Setup architecture'}).getByRole('option',{name:'LiteFusion (Experimental)',exact:true})).toHaveCount(1);
    await dialog.getByRole('button',{name:'Driver model',exact:true}).click();
    await dialog.getByRole('option',{name:'test-model',exact:true}).click();
    await dialog.getByRole('button',{name:'Sidekick model',exact:true}).click();
    await dialog.getByRole('option',{name:'test-fast',exact:true}).click();
    await page.screenshot({path:testInfo.outputPath('recommended-setup-mobile.png')});
    await expect(dialog.getByRole('button',{name:'Start chatting'})).toBeInViewport();
    await dialog.getByRole('button',{name:'Start chatting'}).click();
    const preferences=await (await request.get(`/api/workspace-preferences?workspace=${encodeURIComponent(settings.workspace)}`)).json();
    expect(preferences.architecture).toMatchObject({kind:'sidekick-fusion',sidekick:{model:'test-fast'}});
    expect(preferences.permissionMode).toBe('auto');
    const sameProject=await (await request.post('/api/sessions',{data:{workspace:settings.workspace}})).json();
    expect(sameProject.permissionMode).toBe('auto');
    await expect(dialog).toHaveCount(0);
    const saved=await (await request.get('/api/settings')).json();
    expect(saved.providers[0].baseUrl).toBe(settings.providers[0].baseUrl+'/setup-auth');expect(JSON.stringify(saved)).not.toContain('fixture-key');
    expect(saved.defaultModel).toBe('test-model');
    const next=await (await request.post('/api/sessions',{data:{workspace:settings.workspace+'/src'}})).json();expect(next.model).toBe('test-model');
    await page.reload();await expect(dialog).toHaveCount(0);
  } finally {
    await request.patch('/api/settings',{data:{providers:settings.providers,defaultProvider:settings.defaultProvider,defaultModel:settings.defaultModel}});
    await request.post('/api/workspace-preferences',{data:{...original,workspace:settings.workspace,providerId:'fixture',model:'test-model',setupComplete:true}});
  }
});


test('a configured install opens straight into chat even without a workspace setup flag',async({page,request})=>{
  const settings=await(await request.get('/api/settings')).json();
  await request.post('/api/workspace-preferences',{data:{workspace:settings.workspace,providerId:'fixture',model:'test-model',architecture:null,setupComplete:false}});
  await page.goto('/');
  await page.getByRole('textbox',{name:'Message Litespeed',exact:true}).fill('Hello from the configured startup check');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(page.getByRole('article',{name:'Assistant message'})).toContainText('Hello from Litespeed.');
  await expect(page.getByRole('dialog',{name:'Set up Litespeed',exact:true})).toHaveCount(0);
});

for (const scenario of [
  {path:'setup-defaults',driver:'openai/gpt-6-astra',sidekick:'openai/gpt-6-sol'},
  {path:'setup-fallbacks',driver:'anthropic/claude-fable-5-1',sidekick:'anthropic/claude-opus-5-5'},
  {path:'setup-sonnet',driver:'openai/gpt-6-astra',sidekick:'anthropic/claude-sonnet-5'},
  {path:'setup-unknown',driver:'',sidekick:''},
]) test(`setup automatically reviews ${scenario.path} and keeps choices editable`, async ({page,request},testInfo)=>{
  const settings=await(await request.get('/api/settings')).json();
  const original=await(await request.get(`/api/workspace-preferences?workspace=${encodeURIComponent(settings.workspace)}`)).json();
  try {
    await request.patch('/api/settings',{data:{providers:[{...settings.providers[0],id:'setup-fixture',baseUrl:settings.providers[0].baseUrl+'/'+scenario.path}],defaultProvider:'setup-fixture',defaultModel:''}});
    await request.post('/api/workspace-preferences',{data:{workspace:settings.workspace,providerId:'setup-fixture',model:'',architecture:null,shunt:{enabled:false},setupComplete:false}});
    await page.goto('/');
    const dialog=page.getByRole('dialog',{name:'Set up Litespeed',exact:true});
    await expect(dialog.getByText('Review your setup',{exact:true})).toBeVisible();
    await expect(dialog.getByRole('combobox',{name:'Setup architecture'})).toHaveValue('sidekick-fusion');
    const driver=dialog.getByRole('button',{name:'Driver model',exact:true});
    const sidekick=dialog.getByRole('button',{name:'Sidekick model',exact:true});
    const save=dialog.getByRole('button',{name:'Start chatting',exact:true});
    if(scenario.driver){
      await expect(driver).toContainText(scenario.driver.split('/').at(-1)!);
      await expect(sidekick).toContainText(scenario.sidekick.split('/').at(-1)!);
      await expect(save).toBeEnabled();
    }else{
      await expect(dialog.getByRole('status')).toContainText('Choose a model for your driver and sidekick');
      await expect(save).toBeDisabled();
      await driver.click();await dialog.getByRole('option',{name:'test-model',exact:true}).click();
      await expect(save).toBeDisabled();
      await sidekick.click();await dialog.getByRole('option',{name:'test-fast',exact:true}).click();
      await expect(save).toBeEnabled();
    }
    if(scenario.path==='setup-defaults'){
      await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:testInfo.outputPath('automatic-defaults-mobile.png'),animations:'disabled'});
      await expect(save).toBeInViewport();
      await sidekick.click();await dialog.getByRole('option',{name:'test-fast',exact:true}).click();
      await expect(driver).toContainText(scenario.driver.split('/').at(-1)!);
      await save.click();await expect(dialog).toHaveCount(0);
      const preferences=await(await request.get(`/api/workspace-preferences?workspace=${encodeURIComponent(settings.workspace)}`)).json();
      expect(preferences).toMatchObject({model:scenario.driver,architecture:{kind:'sidekick-fusion',sidekick:{model:'test-fast'}},shunt:{enabled:false}});
      await page.reload();
      await page.setViewportSize({width:1440,height:1000});
      await page.getByRole('button',{name:'Set up Litespeed',exact:true}).click();
      await expect(dialog.getByRole('button',{name:'Sidekick model',exact:true})).toContainText('test-fast');
    }
  }finally{
    await request.patch('/api/settings',{data:{providers:settings.providers,defaultProvider:settings.defaultProvider,defaultModel:settings.defaultModel}});
    await request.post('/api/workspace-preferences',{data:{...original,workspace:settings.workspace,architecture:original.architecture??null,shunt:original.shunt??null,setupComplete:true}});
  }
});
