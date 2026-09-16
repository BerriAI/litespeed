import {litellmContext,LITELLM_HARNESS_VERSION} from '../../../../server/litellm-harness.ts';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=process.argv[2];
if(!root||!process.argv[3])throw new Error('Usage: node --import tsx audit.mts CAMPAIGN OUTPUT_JSON');
type Input={dataset:string;case:string;query:string;expectedSourcePaths:string[];expectedTestPaths:string[]};
type Match={path:string;tests?:string[]};
const inputs:Input[]=JSON.parse(await readFile(new URL('./inputs.json',import.meta.url),'utf8'));
const rows=[];
for(const input of inputs){
 const start=performance.now();
 const result:{matches?:Match[];symbols?:Match[];references?:Match[];playbooks?:{paths?:string[]}[];symbolScan?:unknown}=JSON.parse(await litellmContext(resolve(root,input.dataset,'cases',input.case,'base'),{query:input.query},new AbortController().signal));
 const pathMatches=result.matches??[],symbols=result.symbols??[],references=result.references??[],playbooks=result.playbooks??[];
 const evidencePaths=[...new Set([...pathMatches,...symbols,...references].map(x=>x.path))];
 const guidePaths=[...new Set(playbooks.flatMap(x=>x.paths??[]))];
 const testPaths=[...new Set([...pathMatches,...symbols].flatMap(x=>x.tests??[]))];
 const row={dataset:input.dataset,case:input.case,harnessVersion:LITELLM_HARNESS_VERSION,elapsedMs:performance.now()-start,expectedSourcePaths:input.expectedSourcePaths,sourcePathsShown:evidencePaths,sourceHits:input.expectedSourcePaths.filter(p=>evidencePaths.includes(p)),sourceHitsIncludingGuides:input.expectedSourcePaths.filter(p=>evidencePaths.includes(p)||guidePaths.includes(p)),expectedTestPaths:input.expectedTestPaths,testPathsShown:testPaths,testHits:input.expectedTestPaths.filter(p=>testPaths.includes(p)),symbolScan:result.symbolScan,outputCharacters:JSON.stringify(result).length};
 rows.push(row);console.log(JSON.stringify({case:row.case,sourceHits:row.sourceHits.length,expectedSources:row.expectedSourcePaths.length,withGuides:row.sourceHitsIncludingGuides.length,testHits:row.testHits.length,expectedTests:row.expectedTestPaths.length,elapsedMs:row.elapsedMs}));
 await writeFile(process.argv[3],JSON.stringify({createdAt:new Date().toISOString(),scope:'Read-only descriptive training retrieval audit against human-reference changed source and selected test paths. These are not exhaustive required files; alternative fixes can be correct. Task prompts and reference paths were already available during development. No solver quality conclusion.',rows},null,2));
}
