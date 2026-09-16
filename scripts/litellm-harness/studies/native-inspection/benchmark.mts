import { executeTool } from '../../../../server/tools.ts';
import { snapshotWorkspace } from '../../../../server/workspace-snapshot.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
const exec=promisify(execFile);
const workspace=process.argv[2];
if(!workspace || !process.argv[3])throw new Error('Usage: node --import tsx benchmark.mts LITELLM_CHECKOUT OUTPUT_JSON');
const context={workspace,sessionId:'native-inspection-benchmark',signal:new AbortController().signal,onChange:()=>{throw new Error('Read-only benchmark');},onTodos:()=>{},getTodos:()=>[]};
const pattern='_get_all_deployments';
const rows=[];
let expectedMatches='';
for(let repetition=1;repetition<=5;repetition++){
  for(const arm of repetition%2?['native','shell-with-history']:['shell-with-history','native']){
    const start=performance.now();let output='',snapshotMs=0,snapshotFiles=0;
    if(arm==='native')output=await executeTool('grep',{pattern,path:'litellm/router.py',literal:true,max_results:10},context);
    else{
      const beforeStart=performance.now();const before=await snapshotWorkspace(workspace);snapshotMs+=performance.now()-beforeStart;
      const result=await exec('rg',['-n','--with-filename','--fixed-strings','--max-count','10',pattern,'litellm/router.py'],{cwd:workspace});output=result.stdout;
      const afterStart=performance.now();await snapshotWorkspace(workspace,[],[...Object.keys(before.files),...(before.absent??[])]);snapshotMs+=performance.now()-afterStart;snapshotFiles=Object.keys(before.files).length;
    }
    if(!output.includes(pattern))throw new Error('Missing expected match');
    const matches=output.split('\n').filter(line=>/^litellm\/router\.py:\d+:/.test(line)).join('\n');
    if(!expectedMatches)expectedMatches=matches;
    if(matches!==expectedMatches)throw new Error('Search matches differ');
    const row={arm,repetition,elapsedMs:performance.now()-start,snapshotMs,snapshotFiles,matchingLines:matches.split('\n').length};rows.push(row);console.log(JSON.stringify(row));
  }
}
await writeFile(process.argv[3],JSON.stringify({createdAt:new Date().toISOString(),commit:(await exec('git',['rev-parse','HEAD'],{cwd:new URL('../../../..',import.meta.url)})).stdout.trim(),pattern,file:'litellm/router.py',rows,limitations:'Read-only observational microbenchmark on one shared desktop; shell arm includes two bounded snapshots but omits history persistence, hooks and actual model latency. Tools can differ in search semantics and limits. No solver-quality inference.'},null,2));
