import {expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {snapshotWorkspace,snapshotChanges,SNAPSHOT_LIMITS} from '../server/workspace-snapshot';
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
it('prioritizes source within the byte budget and retains that coverage when other files grow',async()=>{
  const root=await mkdtemp(join(tmpdir(),'snapshot-priority-')),limit=SNAPSHOT_LIMITS.bytes;
  try{
    SNAPSHOT_LIMITS.bytes=10;
    await mkdir(join(root,'z-source'));await writeFile(join(root,'a-docs'),'a'.repeat(10));await writeFile(join(root,'z-source/file'),'one');
    expect((await snapshotWorkspace(root)).files['z-source/file']).toBeUndefined();
    const before=await snapshotWorkspace(root,[],['z-source/file']);
    await writeFile(join(root,'a-docs'),'a'.repeat(20));await writeFile(join(root,'z-source/file'),'two');
    const after=await snapshotWorkspace(root,[],Object.keys(before.files));
    expect(snapshotChanges(before,after)).toEqual({changes:[{path:'z-source/file',before:'one',after:'two'}],incomplete:true});
    expect(Object.values(after.files).reduce((sum,text)=>sum+Buffer.byteLength(text),0)).toBeLessThanOrEqual(10);
  }finally{SNAPSHOT_LIMITS.bytes=limit;await rm(root,{recursive:true,force:true});}
});
it('does not infer creation or deletion from entry truncation, but recognizes checked missing paths',async()=>{
  const root=await mkdtemp(join(tmpdir(),'snapshot-absence-')),limit=SNAPSHOT_LIMITS.files;
  try{
    SNAPSHOT_LIMITS.files=2;
    for(const path of ['a','b','z'])await writeFile(join(root,path),path);
    const before=await snapshotWorkspace(root,[],['z']);
    const differentCoverage=await snapshotWorkspace(root);
    expect(snapshotChanges(before,differentCoverage)).toEqual({changes:[],incomplete:true});
    await rm(join(root,'z'));
    const after=await snapshotWorkspace(root,[],Object.keys(before.files));
    expect(after.truncated).toBe(true);expect(after.absent).toContain('z');
    expect(snapshotChanges(before,after).changes).toEqual([{path:'z',before:'z',after:null}]);
    expect(snapshotChanges(after,before).changes).toEqual([{path:'z',before:null,after:'z'}]);
  }finally{SNAPSHOT_LIMITS.files=limit;await rm(root,{recursive:true,force:true});}
});
it('never lets priority paths bypass symlink, generated-directory, external-path or explicit exclusions',async()=>{
  const root=await mkdtemp(join(tmpdir(),'snapshot-safety-')),outside=await mkdtemp(join(tmpdir(),'snapshot-outside-'));
  try{
    await writeFile(join(outside,'secret'),'secret');await symlink(outside,join(root,'alias'));
    for(const dir of ['node_modules','private']){await mkdir(join(root,dir));await writeFile(join(root,dir,'file'),'ignored');}
    const snapshot=await snapshotWorkspace(root,[join(root,'private')],['alias/secret','node_modules/file','private/file','../secret',join(outside,'secret')]);
    expect(snapshot.files).toEqual({});expect(snapshot.absent??[]).not.toContain('alias/secret');
    const before={files:{'alias/secret':'before'},omitted:{},truncated:false};
    expect(snapshotChanges(before,snapshot)).toEqual({changes:[],incomplete:true});
  }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});
