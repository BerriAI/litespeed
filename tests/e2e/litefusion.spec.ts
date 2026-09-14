import { test, expect } from './fixtures';

for(const width of [1440,390])test(`LiteFusion compact workers and one inspector at ${width}px`,async({page,request})=>{
  await page.setViewportSize({width,height:1000});
  const response=await request.post('/api/sessions',{data:{providerId:'fixture',model:'test-model',permissionMode:'auto',architecture:{kind:'litefusion',gatewayProviderId:'fixture',bindings:{glm:{providerId:'fixture',model:'test-fast'}}}}});
  expect(response.ok()).toBe(true);const session=await response.json();
  try{
    await page.goto(`/#session/${session.id}`);
    const composer=page.getByRole('textbox',{name:'Message Litespeed',exact:true});
    await composer.fill('LITEFUSION_BROWSER implement two files');await page.getByRole('button',{name:'Send message',exact:true}).click();
    await expect.poll(async()=>(await(await request.get('/fixture/delegations')).json()).pending).toBe(2);
    const cards=page.locator('.worker-task');await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText('Task 1');await expect(cards.nth(1)).toContainText('Task 2');
    await expect(cards.first()).toContainText('max');await expect(cards.first()).toContainText('Write file');
    await expect(page.locator('.research-transcript')).toHaveCount(0);
    expect(await cards.first().evaluate(el=>el.getBoundingClientRect().height)).toBeLessThan(width<600?140:110);
    await composer.fill('Keep this draft while I inspect');
    await cards.first().getByRole('button',{name:'Inspect worker',exact:true}).click();
    await expect(page.getByRole('complementary',{name:'Worker inspector'})).toBeVisible();
    await expect(page.locator('.research-transcript')).toHaveCount(1);
    await expect(page.getByRole('combobox',{name:'Worker attempt',exact:true})).toBeHidden();
    await page.locator('.worker-details > summary').click();
    await expect(page.getByRole('combobox',{name:'Worker attempt',exact:true})).toBeVisible();
    await page.locator('.worker-details > summary').click();
    await expect(page.locator('.worker-inspector')).toContainText('alpha worker report');
    await expect(page.locator('.worker-inspector')).not.toContainText('beta worker report');
    const detail=await(await request.get(`/api/sessions/${session.id}`)).json();
    await page.getByRole('combobox',{name:'Inspect worker',exact:true}).selectOption(detail.delegations.find((item:any)=>item.description==='Write beta').id);
    await expect(page.locator('.worker-inspector')).toContainText('beta worker report');
    await expect(page.locator('.research-transcript')).toHaveCount(1);
    await page.screenshot({path:`/tmp/litefusion-workers-${width}.png`,animations:'disabled'});
    await page.keyboard.press('Escape');await expect(page.locator('.worker-inspector')).toHaveCount(0);
    await expect(composer).toHaveValue('Keep this draft while I inspect');await expect(composer).toBeVisible();
    await request.post('/fixture/delegations/release');
    await expect(page.getByRole('article',{name:'Assistant message'}).last()).toContainText('LiteFusion fixture finished');
    const exported=await(await request.get(`/api/sessions/${session.id}/litefusion/export`)).json();
    expect(exported.assignments).toHaveLength(2);expect(exported.turns[0].evaluation.success).toBeNull();
    expect(exported.assignments.every((item:any)=>item.litefusion.integration==='integrated')).toBe(true);
  }finally{await request.post(`/api/sessions/${session.id}/cancel`);await request.post('/fixture/delegations/release');await request.delete(`/api/sessions/${session.id}`);}
});

test('LiteFusion settings expose all 63 cards, alias binding, and one shared escalation pair',async({page,request})=>{
  const session=await(await request.post('/api/sessions',{data:{architecture:null}})).json();
  try{
    await page.goto(`/#session/${session.id}`);await page.locator('.model-trigger').click();
    await page.getByRole('button',{name:'Architecture',exact:true}).click();
    await page.getByRole('option',{name:/^LiteFusionRecommended/}).click();
    await expect(page.getByRole('region',{name:'LiteFusion task routing'})).toBeVisible();
    await expect(page.getByLabel('LiteFusion task',{exact:true}).locator('option')).toHaveCount(63);
    await page.getByText('Inspect and customize all 63 tasks',{exact:true}).click();
    await page.getByLabel('Search LiteFusion tasks').fill('bounded_patch');
    await page.getByLabel('LiteFusion task',{exact:true}).selectOption('bounded_patch');
    await expect(page.getByLabel('default model',{exact:true})).toHaveValue('glm');
    await expect(page.getByLabel('escalation model',{exact:true})).toHaveValue('gemini');
    await expect(page.getByLabel('default reasoning',{exact:true})).toHaveValue('max');
    await page.getByText(/Advanced/,{exact:false}).click();
    await page.getByText(/Gateway identity bindings/).click();
    await page.getByLabel('GLM-5.3-Flash deployment',{exact:true}).fill('test-fast');
    await page.getByRole('button',{name:'Done',exact:true}).click();await page.reload();
    const saved=await(await request.get(`/api/sessions/${session.id}`)).json();expect(saved.session.architecture).toMatchObject({kind:'litefusion',bindings:{glm:{model:'test-fast'}}});
  }finally{await request.delete(`/api/sessions/${session.id}`);}
});
