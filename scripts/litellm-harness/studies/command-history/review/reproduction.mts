if(!process.argv[2])throw new Error('Usage: node --import tsx reproduction.mts OUTPUT_JSON');
import {snapshotWorkspace,snapshotChanges,SNAPSHOT_LIMITS} from '../../../../../server/workspace-snapshot.ts';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const rows=[];
for(const name of ['creation','deletion']){
  const root=await mkdtemp(join(tmpdir(),'history-review-'));const limit=SNAPSHOT_LIMITS.files;
  try{
    SNAPSHOT_LIMITS.files=2;await writeFile(join(root,'a'),'A');
    if(name==='deletion')await writeFile(join(root,'z'),'Z');
    const before=await snapshotWorkspace(root,[],name==='creation'?['a']:['a','z']);
    if(name==='creation')await writeFile(join(root,'z'),'Z');else await rm(join(root,'z'));
    const after=await snapshotWorkspace(root,[],name==='creation'?Object.keys(before.files):['a','z']);
    rows.push({name,before,after,diff:snapshotChanges(before,after)});
  }finally{SNAPSHOT_LIMITS.files=limit;await rm(root,{recursive:true,force:true});}
}
await writeFile(process.argv[2],JSON.stringify(rows,null,2));
console.log(JSON.stringify(rows,null,2));
