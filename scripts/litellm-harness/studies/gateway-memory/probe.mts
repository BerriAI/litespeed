import {CampaignBudget} from '../../budget.ts';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const gc=(globalThis as typeof globalThis & {gc:()=>void}).gc;if(!gc)throw new Error('Need --expose-gc');
const dir=mkdtempSync(join(tmpdir(),'label-retention-'));const budget=new CampaignBudget(join(dir,'spend.json'),100);
try{gc();const before=process.memoryUsage().heapUsed;
 for(let i=0;i<96;i++){const source='x'.repeat(256*1024)+'/runs/example-run-'+i+'/workspace';const label=source.match(/\/runs\/([a-z0-9-]+)\/workspace/)![1];budget.reserve(label,.001);}
 gc();const after=process.memoryUsage().heapUsed;console.log(JSON.stringify({entries:budget.records.length,heapGrowthBytes:after-before,lastLabel:budget.records.at(-1)?.label}));
}finally{rmSync(dir,{recursive:true,force:true});}
