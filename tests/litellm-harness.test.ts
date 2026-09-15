import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { litellmContext } from '../server/litellm-harness.js';
import { architectureProviders, architectureWorker, selectArchitecture } from '../shared/architectures.js';
import { modelRoles, nextAfterRole, saveEnabled } from '../shared/setupFlow.js';

describe('LiteLLM repository navigation',()=>{
  let root:string;
  const put=async(name:string,text='')=>{await mkdir(join(root,name,'..'),{recursive:true});await writeFile(join(root,name),text);};
  beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'litellm-navigation-'));await put('litellm/__init__.py');await put('litellm/llms/example/chat/transformation.py','class Config:\n    def transform_request(self, value):\n        return value\n\n    def other(self):\n        return 2\n');await put('tests/test_litellm/llms/example/chat/test_transformation.py','def test_mapping(): pass\n');});
  afterEach(async()=>{await rm(root,{recursive:true,force:true});});
  it('connects a provider task to source, existing tests and exact method boundaries',async()=>{
    const signal=new AbortController().signal;
    const found=JSON.parse(await litellmContext(root,{query:'example chat mapping'},signal));
    expect(found.matches[0]).toEqual({path:'litellm/llms/example/chat/transformation.py',tests:['tests/test_litellm/llms/example/chat/test_transformation.py']});
    const read=await litellmContext(root,{path:found.matches[0].path,symbol:'transform_request'},signal);
    expect(read).toContain('2\t    def transform_request');expect(read).toContain('3\t        return value');expect(read).not.toContain('def other');
  });
  it('does not expose external symlinks, hidden files or generated dashboard output',async()=>{
    await put('.env','secret');await put('litellm/proxy/_experimental/out/example.py','secret');await symlink(join(root,'.env'),join(root,'litellm','outside.py'));
    for(const path of ['../.env','.env','litellm/outside.py','litellm/proxy/_experimental/out/example.py'])await expect(litellmContext(root,{path},new AbortController().signal)).rejects.toThrow();
  });
  it('finds symbols beyond the first page of a large router outline',async()=>{
    await put('litellm/router.py',Array.from({length:130},(_,i)=>`def route_${i}():\n    pass\n`).join('')+'def resolve_team_strategy():\n    pass\n');
    const result=JSON.parse(await litellmContext(root,{path:'litellm/router.py',query:'team strategy'},new AbortController().signal));
    expect(result.symbols).toHaveLength(1);expect(result.symbols[0].name).toBe('resolve_team_strategy');
  });
  it('finds backend behavior in generically named modules before dashboard filenames',async()=>{
    await put('litellm/proxy/common_utils.py','def check_team_member_budget(spend):\n    return spend\n');
    await put('ui/litellm-dashboard/src/components/team_member_budget.tsx','export const Budget = 1;');
    const result=JSON.parse(await litellmContext(root,{query:'team member budget'},new AbortController().signal));
    expect(result.symbols[0]).toMatchObject({path:'litellm/proxy/common_utils.py',name:'check_team_member_budget'});
    expect(result.matches.some((m:{path:string})=>m.path.startsWith('ui/'))).toBe(false);
  });
  it('finds inline guards when their enclosing function name does not describe the behavior',async()=>{
    await put('litellm/proxy/auth.py','def authenticate():\n    if team_member_spend > team_member_budget:\n        raise ValueError()\n');
    const result=JSON.parse(await litellmContext(root,{query:'team member budget'},new AbortController().signal));
    expect(result.references[0]).toMatchObject({path:'litellm/proxy/auth.py',line:2,preview:'if team_member_spend > team_member_budget:'});
  });
  it('indexes legacy test directories and the proxy schema',async()=>{
    await put('tests/llm_translation/test_conversion.py','def test_empty_result(): pass\n');
    await put('litellm/proxy/schema.prisma','model TeamMembership {\n  id String @id\n}');
    const signal=new AbortController().signal;
    const result=await litellmContext(root,{path:'tests/llm_translation/test_conversion.py',symbol:'test_empty_result'},signal);
    expect(result).toContain('1\tdef test_empty_result');
    expect(JSON.parse(await litellmContext(root,{path:'litellm/proxy/schema.prisma'},signal)).lines).toBe(3);
  });
  it('returns relevant learned guidance only for source anchors present in the checkout',async()=>{
    const signal=new AbortController().signal;
    expect(JSON.parse(await litellmContext(root,{query:'team budget'},signal)).playbooks).toEqual([]);
    await put('litellm/proxy/auth/user_api_key_auth.py','def authenticate(): pass\n');
    const related=JSON.parse(await litellmContext(root,{query:'team budget'},signal));
    expect(related.playbooks).toHaveLength(1);
    expect(related.playbooks[0].paths).toEqual(['litellm/proxy/auth/user_api_key_auth.py']);
    expect(related.playbooks[0].provenance).toContain('Verify against this checkout');
    expect(JSON.parse(await litellmContext(root,{query:'openai schema pattern'},signal)).playbooks).toEqual([]);
  });
  it('searches every relevant area for mixed provider, proxy and router queries',async()=>{
    await put('litellm/router.py','def resolve_team_router_name():\n    pass\n');
    await put('litellm/proxy/auth.py','def resolve_team_auth():\n    pass\n');
    const result=JSON.parse(await litellmContext(root,{query:'example team router transformation'},new AbortController().signal));
    const paths=result.symbols.map((symbol:{path:string})=>symbol.path);
    expect(paths).toContain('litellm/router.py');expect(paths).toContain('litellm/proxy/auth.py');
    expect(result.symbolScan.roots).toContain('litellm/llms/example/');
    expect(result.symbolScan.roots).toContain('litellm/proxy/');
  });
  it('recognizes area names inside Python symbols',async()=>{
    await put('litellm/router.py','def get_available_deployment():\n    pass\n');
    const result=JSON.parse(await litellmContext(root,{query:'get_available_deployment'},new AbortController().signal));
    expect(result.symbols[0]).toMatchObject({path:'litellm/router.py',name:'get_available_deployment'});
  });
  it('keeps one model in both onboarding and architecture routing',()=>{
    const selection=selectArchitecture('litellm-specific',{providerId:'gateway',model:'flash'});
    expect(selection).toEqual({kind:'litellm-specific'});expect(architectureProviders(selection)).toEqual([]);expect(architectureWorker(selection)).toBeNull();
    expect(modelRoles('litellm-specific')).toEqual(['driver']);expect(nextAfterRole('litellm-specific','driver')).toBe('review');
    expect(saveEnabled({step:'review',kind:'litellm-specific',driver:{providerId:'g',model:'m'},worker:null,shuntOk:true,providerConfigured:()=>true})).toBe(true);
  });
});
