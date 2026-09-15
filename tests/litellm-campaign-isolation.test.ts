import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { replaySandboxProfile } from '../scripts/litellm-harness/isolation.js';

it.skipIf(process.platform!=='darwin')('blocks live source and reference data, including symlinks and subprocesses',()=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'litellm-isolation-')));
  try{
    const dirs={home:join(root,'users/me'),campaignRoot:join(root,'campaign'),sourceRepo:join(root,'source'),runtimeRoot:join(root,'runtime'),pythonEnvironment:join(root,'source/.venv'),nodeRoot:join(root,'node'),runDirectory:join(root,'campaign/runs/one')};
    for(const dir of Object.values(dirs))mkdirSync(dir,{recursive:true});
    const outside=join(dirs.sourceRepo,'future.py'),answer=join(dirs.campaignRoot,'reference.patch'),inside=join(dirs.runDirectory,'source.py'),dependency=join(dirs.pythonEnvironment,'dependency');
    for(const file of [outside,answer,inside,dependency])writeFileSync(file,'fixture');
    symlinkSync(outside,join(dirs.runDirectory,'link.py'));
    const profile=join(root,'profile.sb');writeFileSync(profile,replaySandboxProfile(dirs));
    for(const file of [outside,answer,join(dirs.runDirectory,'link.py')]){
      expect(spawnSync('/usr/bin/sandbox-exec',['-f',profile,'/bin/cat',file],{encoding:'utf8'}).status).not.toBe(0);
      expect(spawnSync('/usr/bin/sandbox-exec',['-f',profile,'/bin/sh','-c','cat "$1"','shell',file],{encoding:'utf8'}).status).not.toBe(0);
    }
    for(const file of [inside,dependency])expect(execFileSync('/usr/bin/sandbox-exec',['-f',profile,'/bin/cat',file],{encoding:'utf8'})).toBe('fixture');
    expect(spawnSync('/usr/bin/sandbox-exec',['-f',profile,'/bin/sh','-c','echo changed > "$1"','shell',outside]).status).not.toBe(0);
    expect(spawnSync('/usr/bin/sandbox-exec',['-f',profile,'/bin/sh','-c','echo changed > "$1"','shell',inside]).status).toBe(0);
  }finally{rmSync(root,{recursive:true,force:true});}
});
