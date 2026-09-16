import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

/** Catch a common frozen-worktree setup error before allocating a trial.
 * This checks the dependency root; the sandbox still enforces every file read.
 */
export function assertReplayDependencyRoot(runtimeRoot:string):void {
  const runtime=realpathSync(runtimeRoot);
  let dependencies:string;
  try{dependencies=realpathSync(join(runtime,'node_modules'));}
  catch{throw new Error('Install dependencies inside the frozen runtime before allocating a replay.');}
  if(!dependencies.startsWith(runtime+'/'))throw new Error('Replay node_modules resolves outside the frozen runtime. Copy or install dependencies inside it; external links are blocked by isolation.');
}

/** Evaluation-only filesystem boundary. Production Litespeed is unchanged.
 * Runtime/dependency trees are readable; only this run can read campaign data.
 * Seatbelt also applies to subprocesses, including Python and shell commands.
 */
export function replaySandboxProfile(options:{runDirectory:string;runtimeRoot:string;pythonEnvironment:string;nodeRoot:string;home:string;campaignRoot:string;sourceRepo:string}):string {
  const canonical=(value:string)=>{
    if(!isAbsolute(value)||/[\0\n\r]/.test(value))throw new Error('Sandbox paths must be absolute regular paths.');
    return realpathSync(value);
  };
  const run=canonical(options.runDirectory),runtime=canonical(options.runtimeRoot);
  const python=canonical(options.pythonEnvironment),node=canonical(options.nodeRoot);
  const home=canonical(options.home),campaign=canonical(options.campaignRoot),source=canonical(options.sourceRepo);
  const within=(file:string,root:string)=>file===root||file.startsWith(root+'/');
  if(!within(run,campaign)||run===campaign||[runtime,node].some(root=>within(root,campaign)||within(campaign,root)||within(root,source)||within(source,root))||within(python,campaign))throw new Error('Runtime/dependency paths must not expose the campaign or source repository.');
  if(within(source,python)||within(campaign,python))throw new Error('The Python environment cannot contain source or campaign data.');
  const quote=(value:string)=>JSON.stringify(value);
  const protectedRoots=[...new Set([dirname(home),home,campaign,source])];
  return ['(version 1)','(allow default)',
    ...protectedRoots.map(root=>`(deny file-read* file-write* (subpath ${quote(root)}))`),
    // A shared /tmp can contain another solver's probes or candidate code.
    // TMPDIR points into the current run; explicit shared-temp paths fail closed.
    ...['/tmp','/private/tmp','/var/folders','/private/var/folders'].map(root=>`(deny file-read* file-write* (subpath ${quote(root)}))`),
    // Parent metadata is needed for realpath/getcwd; it does not expose contents.
    '(allow file-read-metadata)',
    ...[runtime,python,node].map(root=>`(allow file-read* (subpath ${quote(root)}))`),
    // A development checkout also contains published benchmark probes, plans,
    // scores and reference diagnoses. These are not executable solver context.
    // Keep only the two workbench modules imported by the isolated launcher.
    ...['docs','tests','scripts'].map(dir=>`(deny file-read* (subpath ${quote(runtime+'/'+dir)}))`),
    ...['solve.ts','budget.ts'].map(file=>`(allow file-read* (literal ${quote(runtime+'/scripts/litellm-harness/'+file)}))`),
    `(deny file-read* (literal ${quote(runtime+'/.git')}))`,
    `(allow file-read* file-write* (subpath ${quote(run)}))`,
    // Host-owned records retain hidden test selection and frozen source hashes.
    `(deny file-read* file-write* (literal ${quote(run+'/task.json')}))`,
    ...['harness-source.json','launch.json','isolation.sb','prompt.txt','solver-task.json','runner-connection.json','repair.json'].map(file=>`(deny file-write* (literal ${quote(run+'/'+file)}))`),
  ].join('\n')+'\n';
}

/** Git must not read the user's blocked global configuration in a replay. */
export function replayGitEnvironment():NodeJS.ProcessEnv {
  return {GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'};
}
