import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import type { ToolDefinition } from '../shared/types.js';

export const LITELLM_HARNESS_VERSION='2026-09-15.9';
export const litellmContextTool:ToolDefinition={type:'function',function:{name:'litellm_context',description:'Navigate the current LiteLLM checkout. Give a task query to find relevant definitions, inline conditions and existing tests. Give a source path to see its symbol outline and test partners; add a symbol name to read that definition with numbered lines. Reads only this workspace, never Git history or remote answers.',parameters:{type:'object',properties:{query:{type:'string',maxLength:1000},path:{type:'string',maxLength:500},symbol:{type:'string',maxLength:200}},additionalProperties:false}}};

export const litellmInstructions=`LiteLLM-specific harness ${LITELLM_HARNESS_VERSION}.
When available, use litellm_context to find the right source and existing tests before broad exploration. Pass path to inspect a symbol outline, path + query to filter a large outline, then path + symbol to read the definition. A plain read_file defaults to 160 lines in this architecture; choose a range around the relevant definition. Batch independent reads. Once the causal code path and a relevant test are clear, implement and test instead of continuing a broad survey. Apply a complete small edit rather than repeatedly revising comments or speculative helpers. When the cause is uncertain, use the smallest allowed executable probe to distinguish hypotheses; do not repeatedly reconsider the same code without new evidence. Solve the requested behavior instead of trying to reconstruct an imagined upstream patch. Shared helpers can be bypassed by cache-hit or fast paths: trace the actual entrypoint for the reported symptom.
Repository map: litellm/llms/<provider>/<endpoint>/transformation.py translates provider requests/responses; common_utils.py and handler.py handle shared protocol and transport. litellm/types/llms contains provider schemas. litellm/litellm_core_utils contains shared streaming, response conversion, prompt templates and routing helpers. litellm/proxy contains gateway/auth/spend/guardrails; enterprise contains paid features. tests/test_litellm mirrors the source tree. UI source is ui/litellm-dashboard, not litellm/proxy/_experimental/out (generated output). Model capabilities/prices live in model_prices_and_context_window.json.
Read CLAUDE.md when AGENTS.md references it. Prefer extending an existing mapped test. Test intended behavior and the relevant unaffected behavior; a bug fix may require changing an assertion that encoded the bug. Check sync/async and streaming/non-streaming counterparts when the changed behavior crosses them. Preserve caller-owned inputs and existing public interfaces.
Before finalizing a protocol change, check the representation at its boundary. For URLs, compose parsed path/query components rather than appending a path to an arbitrary base string; preserve existing query parameters and add streaming parameters correctly. For images/documents, preserve source kind and MIME metadata, and verify the downstream adapter's expected representation (raw base64 and a data URL are different). For shared parameters, distinguish absent, null and explicit false; preserve caller-owned inputs. These are review heuristics, not instructions to add unrelated behavior.\nUse installed dependencies and focused tests. Inspect pyproject.toml/Makefile or existing environment evidence before guessing a test command. Separate collection/import/infrastructure failures from an assertion failure. Start with your regression test and a small relevant existing selection. If a wider check fails, diagnose whether it is caused by this change before adding more code. Do not repeatedly rerun an unchanged failing setup. Do not run broad suites, generate dashboard bundles, or install packages unless the task needs them.
Keep the user informed with short, concrete progress messages. Finish with the behavior changed, focused checks actually run, and any unresolved limitation. An announced action is not an executed action; a test command that collected zero tests is not a successful verification.`;

export const litellmTestFocus='LiteLLM verification checkpoint: several check commands have completed. Decide what specific uncertainty remains before spending more time on tests. Many files under tests/test_litellm mix mocked unit tests with live provider or service tests; inspect the selected tests and use exact test nodes where possible. Do not repeatedly run a passing selection, repeatedly toggle the patch to investigate unrelated flakiness, or broaden a -k expression into live API tests. A pre-existing unrelated failure can be reported with evidence. Continue testing when a concrete change, failure, or user requirement calls for it. This notice does not require an extra test run.';
export const litellmExplorationFocus='LiteLLM exploration checkpoint: you have made several tool calls without a recorded edit. If this is an implementation task, state the current hypothesis briefly and use the smallest allowed regression or executable probe to distinguish it from alternatives before another broad search. A failing probe is useful evidence; repeated speculation about an imagined reference patch is not. Then make the scoped correction when the cause is demonstrated. Prefer litellm_context with path + query to locate a symbol in a large module instead of repeatedly surveying files. Existing tests may encode the bug the user asked to change. Continue reading when a concrete dependency or uncertainty requires it. If the user requested explanation or planning, finish that answer when the evidence is sufficient; this notice does not authorize edits.';

const ignored=['**/.*/**','**/node_modules/**','**/__pycache__/**','**/_experimental/out/**','**/dist/**','**/build/**','**/vendor/**'];

export function litellmReview(files:string[],checks:string[]):string {
  return `LiteLLM change review. Before your final answer, make one focused review of this turn's changes. Follow the user's scope and verification constraints. Re-read the requested behavior and check that every requested code path is covered, not only the last file edited. When the user requests a behavior change, an old test or comment documenting the previous behavior does not override that request; reconcile the difference explicitly. Use the diff or the source already read to identify a concrete counterexample to your implementation; a test you wrote to match your own implementation is not independent evidence. Check the surrounding adapter contract and existing callers, then run a small relevant regression if permitted. Fix only demonstrated problems. Do not launch a broad survey or repeat a failed environment setup. If the change already holds up, finish without inventing more work.\nFor URL composition, consider a base with a query string and streaming parameters; for multimodal content, check source type and MIME representation expected by the consumer; for routing/configuration, check shared-state mutation and missing versus explicit false. Apply only relevant checks.\nHost-recorded changed paths: ${JSON.stringify(files.slice(0,30))}\nHost-recorded check commands (execution is not proof of coverage): ${JSON.stringify(checks.slice(-5))}`;
}

export function isLitellmDefinitionRead(output:string,file:string):boolean {
  const first=output.slice(0,output.indexOf('\n'));
  return first.startsWith(file+':')&&/^\d+-\d+$/.test(first.slice(file.length+1))&&/^\d+\t/m.test(output);
}
const words=(value:string)=>[...new Set(value.toLowerCase().replace(/vertex[ -]ai/g,'vertex_ai').replace(/azure[ -]ai/g,'azure_ai').replace(/tool[ -]results?/g,'tool_result').match(/[a-z][a-z0-9_]{2,}/g)??[])].filter(word=>!['the','and','for','from','with','that','this','into','must','not','its','fix','preserve','existing','request','requests','response','responses','litellm','test','tests','support','make','when','should','path','content'].includes(word));

async function sourceFile(workspace:string,relative:string):Promise<string>{
  const root=await fs.realpath(workspace);
  if(path.isAbsolute(relative)||relative.split(/[\\/]/).some(p=>p==='..'||p.startsWith('.'))||relative.includes('\\'))throw new Error('Use a visible workspace-relative source path.');
  const target=path.resolve(root,relative);
  if(!target.startsWith(root+path.sep)||relative.includes('/_experimental/out/'))throw new Error('Generated or external paths are not part of LiteLLM navigation.');
  const stat=await fs.lstat(target);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>1024*1024||await fs.realpath(target)!==target)throw new Error('Choose a regular source file within this checkout (up to 1 MiB).');
  const handle=await fs.open(target,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const opened=await handle.stat();
    if(opened.dev!==stat.dev||opened.ino!==stat.ino)throw new Error('The file changed while opening it; retry.');
    const buffer=Buffer.alloc(1024*1024+1);
    let bytes=0;
    while(bytes<buffer.length){const read=await handle.read(buffer,bytes,buffer.length-bytes,bytes);if(!read.bytesRead)break;bytes+=read.bytesRead;}
    const after=await handle.stat();
    if(bytes>1024*1024||after.size!==opened.size||after.mtimeMs!==opened.mtimeMs)throw new Error('The file changed while reading it; retry.');
    const content=buffer.subarray(0,bytes).toString('utf8');
    const final=await fs.lstat(target);
    if(final.ino!==opened.ino||final.dev!==opened.dev||final.isSymbolicLink()||await fs.realpath(target)!==target)throw new Error('The file path changed while reading it; retry.');
    if(content.includes('\0'))throw new Error('Binary files are not supported.');
    return content;
  }finally{await handle.close();}
}

function partners(files:string[],source:string):string[]{
  const mirror=source.startsWith('litellm/')?'tests/test_'+source:'tests/'+source;
  const directory=path.posix.dirname(mirror),base=path.posix.basename(source,'.py');
  return files.filter(p=>p.startsWith(directory+'/')&&p.endsWith('.py')).sort((a,b)=>Number(b.includes(base))-Number(a.includes(base))||a.localeCompare(b)).slice(0,8);
}

function outline(text:string){
  return text.split('\n').flatMap((line,index)=>{const match=/^(\s*)(?:(?:async\s+)?def|class)\s+([A-Za-z_][\w]*)/.exec(line);return match?[{name:match[2],line:index+1,indent:match[1].length,signature:line.trim().slice(0,200)}]:[];});
}

async function matchingSymbols(workspace:string,files:string[],tokens:string[],signal:AbortSignal){
  const proxy=tokens.some(t=>/^(budget|auth|team|member|spend|redis|guardrail|proxy)/.test(t));
  const router=tokens.some(t=>/^(router|deployment|retry|fallback|routing|tags?)/.test(t));
  const providers=[...new Set(files.flatMap(p=>p.startsWith('litellm/llms/')?[p.split('/')[2]]:[]))].filter(provider=>tokens.some(t=>t===provider||provider.startsWith(t+'_')));
  const roots=providers.length?providers.map(p=>'litellm/llms/'+p+'/'):proxy?['litellm/proxy/','enterprise/']:router?['litellm/router.py','litellm/router_utils/','litellm/router_strategy/']:['litellm/litellm_core_utils/','litellm/utils.py'];
  const candidates=files.filter(p=>p.endsWith('.py')&&roots.some(root=>root.endsWith('/')?p.startsWith(root):p===root));
  const matches:{path:string;name:string;line:number;score:number}[]=[];
  const references:{path:string;line:number;preview:string;score:number}[]=[];
  let bytes=0,scanned=0;
  for(let offset=0;offset<Math.min(candidates.length,800)&&bytes<64*1024*1024;offset+=8){
    signal.throwIfAborted();
    await Promise.all(candidates.slice(offset,Math.min(offset+8,800)).map(async file=>{
      try{const text=await sourceFile(workspace,file);bytes+=Buffer.byteLength(text);scanned++;
        for(const symbol of outline(text)){const score=tokens.reduce((n,t)=>n+Number(symbol.name.toLowerCase().includes(t)),0);if(score)matches.push({path:file,name:symbol.name,line:symbol.line,score});}
        for(const [index,line] of text.split('\n').entries()){
          const trimmed=line.trim(),lower=line.toLowerCase();
          if(!trimmed||trimmed.startsWith('#')||/^(?:(?:async\s+)?def|class)\s/.test(trimmed))continue;
          const score=tokens.reduce((n,t)=>n+Number(lower.includes(t)),0);
          if(score>=Math.min(2,tokens.length)){
            references.push({path:file,line:index+1,preview:trimmed.slice(0,240),score:score+(/^(?:if|elif|assert)\b/.test(trimmed)?0.5:0)});
            references.sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path)||a.line-b.line);references.length=Math.min(references.length,12);
          }
        }
      }catch{signal.throwIfAborted();}
    }));
  }
  signal.throwIfAborted();
  return {matches:matches.sort((a,b)=>b.score-a.score||a.name.length-b.name.length||a.path.localeCompare(b.path)||a.line-b.line).slice(0,12),references:references.sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path)||a.line-b.line).slice(0,12),scanned,partial:scanned<candidates.length};
}
export async function litellmContext(workspace:string,args:Record<string,unknown>,signal:AbortSignal):Promise<string>{
  signal.throwIfAborted();
  if(Object.keys(args).some(k=>!['query','path','symbol'].includes(k)))throw new Error('Use query, path and/or symbol.');
  for(const [k,v] of Object.entries(args))if(typeof v!=='string'||v.length>(k==='query'?1000:k==='path'?500:200))throw new Error('Navigation arguments must be bounded strings.');
  const files=(await fg(['litellm/**/*.py','tests/**/*.py','enterprise/**/*.py','ui/litellm-dashboard/src/**/*.{ts,tsx}','model_prices_and_context_window.json','schema.prisma','litellm/proxy/schema.prisma','pyproject.toml','Makefile'],{cwd:workspace,onlyFiles:true,followSymbolicLinks:false,dot:false,ignore:ignored})).sort();
  signal.throwIfAborted();
  if(!files.includes('litellm/__init__.py'))return 'Open the LiteLLM repository root to use this navigator. Expected litellm/__init__.py and tests/test_litellm. Ordinary workspace tools remain available.';
  const file=typeof args.path==='string'?args.path:undefined;
  if(file){
    if(!files.includes(file))throw new Error('Path is not an indexed source file. Use query to find a workspace source path.');
    const text=await sourceFile(workspace,file),lines=text.split('\n');
    const symbols=outline(text);
    const tests=partners(files,file);
    if(args.symbol){
      const matches=symbols.filter(s=>s.name===args.symbol);
      if(matches.length!==1)return JSON.stringify({path:file,error:matches.length?'Several definitions match; use read_file at the desired line.':'Symbol not found.',symbols:symbols.filter(s=>s.name.includes(String(args.symbol))).slice(0,30),tests});
      const start=matches[0],next=symbols.find(s=>s.line>start.line&&s.indent<=start.indent)?.line??lines.length+1;
      const end=Math.min(next-1,start.line+239);
      return `${file}:${start.line}-${end}\n${lines.slice(start.line-1,end).map((line,i)=>`${start.line+i}\t${line}`).join('\n')}\n${end<next-1?`Definition continues; read_file offset ${end+1}.\n`:''}Existing test candidates: ${tests.join(', ')||'No exact mirror found; search tests.'}`;
    }
    const terms=words(String(args.query??''));
    const selected=terms.length?symbols.map(symbol=>({symbol,score:terms.reduce((n,term)=>n+Number(symbol.name.toLowerCase().includes(term)),0)})).filter(item=>item.score).sort((a,b)=>b.score-a.score||a.symbol.line-b.symbol.line).map(item=>item.symbol):symbols;
    return JSON.stringify({path:file,lines:lines.length,symbols:selected.slice(0,100),moreSymbols:selected.length>100,tests},null,2);
  }
  const aliases:Record<string,string>={conversion:'convert',translation:'transform',streaming:'stream',configuration:'config',authentication:'auth',authorization:'auth',parameters:'params',retries:'retry'};
  const tokens=[...new Set(words(String(args.query??'')).flatMap(word=>[word,...(aliases[word]?[aliases[word]]:[])]))].slice(0,24);
  const ui=/\b(ui|dashboard|frontend|react|component)\b/i.test(String(args.query??''));
  const ranked=files.filter(p=>!p.startsWith('tests/')&&(ui||!p.startsWith('ui/'))).map(p=>({path:p,score:tokens.reduce((score,word)=>score+(p.toLowerCase().includes(word)?(p.split('/').includes(word)?5:2):0),0)})).filter(p=>p.score>0).sort((a,b)=>b.score-a.score||a.path.length-b.path.length||a.path.localeCompare(b.path)).slice(0,8);
  const symbols=tokens.length&&!ui?await matchingSymbols(workspace,files,tokens,signal):undefined;
  return JSON.stringify({query:args.query??'',references:symbols?.references,symbols:symbols?.matches.map(s=>({...s,tests:partners(files,s.path).slice(0,2)})),symbolScan:symbols&&{files:symbols.scanned,partial:symbols.partial},matches:ranked.map(p=>({path:p.path,tests:partners(files,p.path).slice(0,3)})),hint:'Use path + symbol for a definition, path + query to filter a large outline, or grep within the relevant directory for an exact term. Ranked paths and symbols are navigation hints, not proof of the cause.'},null,2);
}
