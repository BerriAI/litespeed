import { sourceFileByteLimit } from '../shared/source-file-limits.js';
import { LEGACY_NAMES } from '../bin/legacy.mjs';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, readlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { FileChange } from '../shared/types.js';

export const SNAPSHOT_LIMITS = { files: 10000, bytes: 12 * 1024 * 1024, fileBytes: 2 * 1024 * 1024 };
export const SNAPSHOT_IGNORES = new Set(['.git','.litespeed',...LEGACY_NAMES.map(name => `.${name}`),'node_modules','dist','build','coverage','.next','.venv','venv','__pycache__','target','test-results','test-results-tui','playwright-report']);
export interface WorkspaceSnapshot { files: Record<string,string>; omitted: Record<string,string>; truncated: boolean; absent?: string[] }

/** Bounded source-file observation. Does not follow symlinks, read outside the
 * workspace, or touch generated dependency/cache directories. */
export async function snapshotWorkspace(workspace: string, excluded: string[] = [], priorityPaths: string[] = []): Promise<WorkspaceSnapshot> {
  workspace=resolve(workspace);
  const snapshot: WorkspaceSnapshot = {files:Object.create(null),omitted:Object.create(null),truncated:false};
  const exclusions = excluded.map(path => resolve(path)).filter(path=>!resolve(workspace).startsWith(path+sep));
  const visited=new Set<string>();
  let count = 0, bytes = 0;
  const excludedPath=(path:string)=>exclusions.some(excluded=>path===excluded||path.startsWith(excluded+sep));
  const visit=(path:string):boolean=>{
    if(visited.has(path))return true;
    if(++count>SNAPSHOT_LIMITS.files){snapshot.truncated=true;return false;}
    visited.add(path);return true;
  };
  async function capture(path:string,key:string,stat:Awaited<ReturnType<typeof lstat>>):Promise<void>{
    const fileLimit=sourceFileByteLimit(key,SNAPSHOT_LIMITS.fileBytes);
    if(stat.isSymbolicLink()){snapshot.omitted[key]=`symlink:${await readlink(path)}`;return;}
    if(!stat.isFile()||stat.size>fileLimit) {snapshot.omitted[key]=`${stat.mode}:${stat.size}:${stat.mtimeMs}`;return;}
    const data=await readFile(path,{flag:constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK}), text=data.toString('utf8');
    if(data.length>fileLimit||data.includes(0)||!Buffer.from(text).equals(data)||bytes+data.length>SNAPSHOT_LIMITS.bytes) {
      snapshot.omitted[key]=createHash('sha256').update(data).digest('hex');return;
    }
    bytes+=data.length;snapshot.files[key]=text;
  }
  // Observe files already owned by history first, under the same limits. Walk
  // their parents explicitly so a priority path cannot bypass ignored paths or
  // traverse a directory symlink. Missing paths are evidence, unlike an area
  // that the bounded scan never reached.
  async function prioritize(directory:string,paths:string[]):Promise<void>{
    const children=new Map<string,string[]>();
    for(const path of paths){const [name,...parts]=path.split('/');children.set(name,[...(children.get(name)??[]),parts.join('/')]);}
    for(const [name,tails] of children){
      const path=join(directory,name),key=relative(workspace,path).split(sep).join('/');
      const targets=tails.map(tail=>tail?`${key}/${tail}`:key);
      if(excludedPath(path)||SNAPSHOT_IGNORES.has(name)){for(const target of targets)snapshot.omitted[target]='excluded';continue;}
      if(!visit(path))return;
      let stat:Awaited<ReturnType<typeof lstat>>;
      try{stat=await lstat(path);}catch(error){
        if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
        (snapshot.absent??=[]).push(...targets);continue;
      }
      if(stat.isDirectory()){
        if(tails.includes(''))snapshot.omitted[key]='directory';
        await prioritize(path,tails.filter(Boolean));
      }else{
        if(tails.includes(''))await capture(path,key,stat);
        for(const target of targets.filter(target=>target!==key))snapshot.omitted[target]='non-directory ancestor';
      }
      if(snapshot.truncated)return;
    }
  }
  async function walk(directory: string): Promise<void> {
    for (const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      const path=join(directory,entry.name), key=relative(workspace,path).split(sep).join('/');
      if (excludedPath(path) || SNAPSHOT_IGNORES.has(entry.name)) continue;
      if (!visit(path)) return;
      if(entry.isDirectory()) {await walk(path);if(snapshot.truncated)return;continue;}
      if(Object.hasOwn(snapshot.files,key)||Object.hasOwn(snapshot.omitted,key))continue;
      const stat=await lstat(path);
      await capture(path,key,stat);
    }
  }
  await prioritize(workspace,[...new Set(priorityPaths)].filter(path=>path&&!isAbsolute(path)&&!path.includes('\\')&&!path.split('/').some(part=>!part||part==='.'||part==='..')));
  if(!snapshot.truncated)await walk(workspace);
  return snapshot;
}

export function snapshotChanges(before: WorkspaceSnapshot, after: WorkspaceSnapshot): {changes:FileChange[]; incomplete:boolean} {
  const paths=new Set([...Object.keys(before.files),...Object.keys(after.files)]), changes:FileChange[]=[];
  let incomplete=before.truncated||after.truncated;
  for(const path of new Set([...Object.keys(before.omitted),...Object.keys(after.omitted)])) {
    if(path.split('/').some(part=>SNAPSHOT_IGNORES.has(part)))continue;
    if(before.omitted[path]!==after.omitted[path]||Object.hasOwn(before.files,path)||Object.hasOwn(after.files,path))incomplete=true;
  }
  for(const path of paths) {
    // Old persisted command snapshots may predate a generated-directory exclusion.
    if(path.split('/').some(part=>SNAPSHOT_IGNORES.has(part)))continue;
    if(Object.hasOwn(before.omitted,path)||Object.hasOwn(after.omitted,path))continue;
    // Exhausting the entry limit does not prove an unobserved file was created
    // or deleted. Explicitly checked priority paths can still establish absence.
    if(!Object.hasOwn(before.files,path)&&before.truncated&&!before.absent?.includes(path))continue;
    if(!Object.hasOwn(after.files,path)&&after.truncated&&!after.absent?.includes(path))continue;
    const old=Object.hasOwn(before.files,path)?before.files[path]:null,next=Object.hasOwn(after.files,path)?after.files[path]:null;
    if(old!==next)changes.push({path,before:old,after:next});
  }
  return {changes,incomplete};
}
