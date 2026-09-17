import { existsSync, realpathSync } from 'node:fs';
import { mkdtemp, mkdir, readdir, lstat, rm } from 'node:fs/promises';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';

export interface ShellLaunch { executable:string; args:string[]; env:NodeJS.ProcessEnv; cleanup:()=>Promise<void>; }
export const sandboxBackend = () => process.platform==='darwin' && existsSync('/usr/bin/sandbox-exec') ? 'macOS Seatbelt'
  : process.platform==='linux' && existsSync('/usr/bin/bwrap') ? 'Linux bubblewrap' : null;
const inside=(root:string,target:string)=>{const value=relative(root,target);return value===''||(!value.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&value!=='..'&&!isAbsolute(value));};
const protectedName=(name:string)=>['.git','.litespeed','.ssh','.netrc','.git-credentials','id_rsa','id_ed25519'].includes(name)||name==='.env'||name.startsWith('.env.')&&name!=='.env.example'||/\.(pem|p12|pfx|key)$/.test(name);

/** The launcher is host-owned. Never fall back to an unrestricted shell. */
export async function sandboxCommand(command:string,cwd:string,workspace:string,dataDirectory:string):Promise<ShellLaunch> {
  if(!sandboxBackend())throw new Error('Workspace command confinement is unavailable on this system. The command was not run. Request sandbox:"off" for explicit unrestricted approval.');
  const root=realpathSync(workspace), working=realpathSync(cwd), runtime=realpathSync(process.execPath), data=realpathSync(dataDirectory);
  if(root==='/'||!inside(root,working))throw new Error('Confined commands require a working directory inside a non-root workspace.');
  const scratch=realpathSync(await mkdtemp(join(tmpdir(),'litespeed-command-')));
  const cleanup=()=>rm(scratch,{recursive:true,force:true});
  const env:NodeJS.ProcessEnv={PATH:`${dirname(runtime)}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`,HOME:scratch,TMPDIR:scratch,TMP:scratch,TEMP:scratch,LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8',TERM:'dumb',CI:'1'};
  try {
    const protectedPaths:{target:string;directory:boolean;git:boolean}[]=[];
    let count=0;
    const inspect=async(directory:string):Promise<void>=>{
      for(const entry of await readdir(directory,{withFileTypes:true})){
        if(++count>300_000)throw new Error('Workspace is too large to validate command confinement. The command was not run.');
        const target=join(directory,entry.name);
        if(protectedName(entry.name)||target===data){
          if(entry.isSymbolicLink())throw new Error('Command confinement refuses symlinked protected files. The command was not run.');
          protectedPaths.push({target,directory:entry.isDirectory(),git:entry.name==='.git'});continue;
        }
        if(entry.isSymbolicLink())continue;
        if(entry.isDirectory())await inspect(target);
        else if(entry.isFile()&&(await lstat(target)).nlink>1)throw new Error('Command confinement refuses hard-linked files. The command was not run.');
      }
    };
    await inspect(root);
    if(process.platform==='darwin') {
      const quote=(value:string)=>JSON.stringify(value);
      const readable=['/usr','/bin','/sbin','/System','/Library','/opt/homebrew','/private/etc',root,scratch].filter(existsSync);
      const profile=[
        '(version 1)','(deny default)',
        '(allow process-exec process-fork sysctl-read)',
        '(allow signal (target self))',
        '(allow process-info* (target same-sandbox))',
        '(allow file-read-metadata file-test-existence)',
        // macOS requires executable mappings separately from file reads, even
        // to load /bin/bash and the system dynamic linker.
        `(allow file-map-executable ${readable.map(value=>`(subpath ${quote(value)})`).join(' ')} (literal ${quote(runtime)}))`,
        '(allow system-mac-syscall (mac-policy-name "vnguard"))',
        '(allow system-mac-syscall (require-all (mac-policy-name "Sandbox") (mac-syscall-number 67)))',
        '(allow mach-lookup (global-name "com.apple.system.opendirectoryd.libinfo"))',
        `(allow file-read* ${readable.map(value=>`(subpath ${quote(value)})`).join(' ')} (literal ${quote(runtime)}) (subpath "/dev"))`,
        `(allow file-write* (subpath ${quote(root)}) (subpath ${quote(scratch)}) (literal "/dev/null"))`,
        // Denies also cover symlink destinations and files created after launch.
        '(deny file-read* file-write* file-map-executable (regex #"(^|/)([.]env([.][^/]+)?|[.]ssh|[.]litespeed|[.]netrc|[.]git-credentials|id_rsa|id_ed25519)(/|$)"))',
        '(deny file-write* (regex #"(^|/)[.]git(/|$)"))',
        '(deny file-read* file-write* file-map-executable (regex #"[.](pem|p12|pfx|key)$"))',
        `(deny file-read* file-write* file-map-executable (subpath ${quote(data)}))`,
      ].join('\n');
      return {executable:'/usr/bin/sandbox-exec',args:['-p',profile,'/bin/bash','--noprofile','--norc','-o','pipefail','-c',command],env,cleanup};
    }
    const empty=join(scratch,'empty');await mkdir(empty);
    const args=['--unshare-all','--die-with-parent','--new-session'];
    for(const directory of ['/usr','/bin','/sbin','/lib','/lib64'])if(existsSync(directory))args.push('--ro-bind',directory,directory);
    args.push('--proc','/proc','--dev','/dev','--dir','/tmp','--dir','/etc');
    if(existsSync('/etc/ld.so.cache'))args.push('--ro-bind','/etc/ld.so.cache','/etc/ld.so.cache');
    args.push('--ro-bind',runtime,runtime,'--bind',root,root,'--bind',scratch,scratch);
    for(const item of protectedPaths)args.push('--ro-bind',item.git?item.target:item.directory?empty:'/dev/null',item.target);
    args.push('--chdir',working,'/bin/bash','--noprofile','--norc','-o','pipefail','-c',command);
    return {executable:'/usr/bin/bwrap',args,env,cleanup};
  } catch(error){await cleanup();throw error;}
}
