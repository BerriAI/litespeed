import {expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {snapshotWorkspace,snapshotChanges} from '../server/workspace-snapshot';
it('excludes changing terminal test artifacts from new and persisted command snapshots without excluding source',async()=>{
  const root=await mkdtemp(join(tmpdir(),'snapshot-artifacts-'));
  try{
    await mkdir(join(root,'test-results-tui'));await writeFile(join(root,'source.ts'),'before');await writeFile(join(root,'test-results-tui/frames.jsonl'),'frame1');
    const before=await snapshotWorkspace(root);expect(before.files).toEqual({'source.ts':'before'});
    // A command started on an older bundle can carry this generated file.
    before.files['test-results-tui/frames.jsonl']='old frame';
    await writeFile(join(root,'test-results-tui/frames.jsonl'),'frame2');await writeFile(join(root,'source.ts'),'after');
    expect(snapshotChanges(before,await snapshotWorkspace(root)).changes).toEqual([{path:'source.ts',before:'before',after:'after'}]);
  }finally{await rm(root,{recursive:true,force:true});}
});
