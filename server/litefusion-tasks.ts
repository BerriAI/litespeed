import { randomUUID } from 'node:crypto';
import type { LiteFusionTask } from '../shared/litefusion-tasks.js';
import type { Message, ToolCall } from '../shared/types.js';
import type { LiteFusionInput } from './litefusion-handoffs.js';
import type { Store } from './store.js';

type RecordData={task:LiteFusionTask;input:LiteFusionInput;messageId:string;callId:string;availabilityFallback?:boolean};
const active=(task:LiteFusionTask)=>task.status==='queued'||task.status==='running';
const conflict=(message:string)=>Object.assign(new Error(message),{status:409});
/** Durable host state only. Restart recovery never replays paid work. */
export class LiteFusionTasks {
  constructor(readonly store:Store) {
    store.db.exec('CREATE TABLE IF NOT EXISTS litefusion_tasks (id TEXT PRIMARY KEY,parent_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS litefusion_tasks_parent ON litefusion_tasks(parent_id);');
    store.db.exec('CREATE TABLE IF NOT EXISTS litefusion_schedule_metrics (parent_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,turn_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(parent_id,turn_id));');
    for(const row of store.db.prepare('SELECT data FROM litefusion_tasks').all() as {data:string}[]) {
      const record=JSON.parse(row.data) as RecordData;
      if(active(record.task)){record.task={...record.task,status:'interrupted',error:'The process ended. Inspect retained work before explicitly continuing.',updatedAt:Date.now(),revision:record.task.revision+1};this.save(record);}
    }
  }
  metrics(parentId:string,turnId:string):{leadWaitMs:number;leadRequestsWithPendingTasks:number} {
    const row=this.store.db.prepare('SELECT data FROM litefusion_schedule_metrics WHERE parent_id=? AND turn_id=?').get(parentId,turnId) as {data:string}|undefined;
    return row?JSON.parse(row.data):{leadWaitMs:0,leadRequestsWithPendingTasks:0};
  }
  addMetric(parentId:string,turnId:string,key:'leadWaitMs'|'leadRequestsWithPendingTasks',value:number){
    const metrics=this.metrics(parentId,turnId);metrics[key]+=value;
    this.store.db.prepare('INSERT INTO litefusion_schedule_metrics(parent_id,turn_id,data) VALUES(?,?,?) ON CONFLICT(parent_id,turn_id) DO UPDATE SET data=excluded.data').run(parentId,turnId,JSON.stringify(metrics));
  }
  private save(record:RecordData) {
    this.store.db.prepare('INSERT INTO litefusion_tasks(id,parent_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(record.task.id,record.task.parentSessionId,JSON.stringify(record));
  }
  private visible(record:RecordData):boolean {
    return this.store.messages(record.task.parentSessionId).some(message=>message.id===record.messageId&&message.role==='assistant'&&message.toolCalls?.some(call=>call.id===record.callId&&call.name==='delegate'&&call.taskId===record.task.id));
  }
  records(parentId:string):RecordData[] {
    return (this.store.db.prepare('SELECT data FROM litefusion_tasks WHERE parent_id=? ORDER BY rowid').all(parentId) as {data:string}[]).map(row=>JSON.parse(row.data) as RecordData).filter(record=>this.visible(record));
  }
  list(parentId:string):LiteFusionTask[]{return this.records(parentId).map(record=>structuredClone(record.task));}
  get(parentId:string,id:string):RecordData {
    const record=this.records(parentId).find(record=>record.task.id===id);if(!record)throw conflict('Task not found in the current session history.');return record;
  }
  update(parentId:string,id:string,patch:Partial<LiteFusionTask>):LiteFusionTask {
    const record=this.get(parentId,id);record.task={...record.task,...patch,id,parentSessionId:parentId,updatedAt:Date.now(),revision:record.task.revision+1};this.save(record);return structuredClone(record.task);
  }
  fallback(parentId:string,id:string,attemptId:string,reason:string):LiteFusionTask {
    const record=this.get(parentId,id);
    record.input={...record.input,continueFrom:undefined,repairOf:attemptId,hard:false};
    record.availabilityFallback=true;this.save(record);
    return this.update(parentId,id,{status:'queued',error:`Switching to the configured fallback: ${reason}`});
  }
  submit(parentId:string,turnId:string,policyHash:string,message:Message,call:ToolCall,input:LiteFusionInput):LiteFusionTask {
    const records=this.records(parentId),prior=records.find(record=>record.task.workstream===input.workstream);
    if(prior&&active(prior.task))throw conflict('This workstream already has an active assignment. Wait for it or create a separate workstream.');
    if(prior?.task.status==='cancelled')throw conflict('The user cancelled this workstream. Do not automatically respawn it.');
    if(prior&&prior.task.roleId!==input.roleId)throw conflict('Continuation and escalation must retain the original role and workstream. Use a sibling task for different scope.');
    if(prior&&!input.continueFrom&&!input.repairOf)throw conflict('Continue a completed workstream explicitly with continueFrom, or escalate with repairOf.');
    const dependencies=(input.dependsOn??[]).map(ref=>{
      const item=records.find(record=>record.task.id===ref||record.task.workstream===ref)?.task;
      if(!item)throw conflict(`Dependency ${ref} is not registered. Submit prerequisites first, then dependent tasks.`);
      if(item.id===prior?.task.id)throw conflict('A task cannot depend on itself.');return item.id;
    });
    // Revision invalidation makes old dependency results explicit: a new attempt
    // cannot form a cycle through a queued dependent of the previous attempt.
    const reaches=(id:string,target:string,seen=new Set<string>()):boolean=>{if(id===target)return true;if(seen.has(id))return false;seen.add(id);return records.find(record=>record.task.id===id)?.task.dependencies.some(dep=>reaches(dep,target,seen))??false;};
    if(prior&&dependencies.some(dep=>reaches(dep,prior.task.id)))throw conflict('Task dependencies would form a cycle.');
    const now=Date.now(),task:LiteFusionTask={...prior?.task,id:prior?.task.id??randomUUID(),parentSessionId:parentId,turnId,workstream:input.workstream,roleId:input.roleId,description:input.description,status:'queued',dependencies,attemptIds:prior?.task.attemptIds??[],createdAt:prior?.task.createdAt??now,updatedAt:now,revision:(prior?.task.revision??0)+1,policyHash,error:undefined,resolution:undefined};
    this.store.db.exec('BEGIN IMMEDIATE');
    try {call.taskId=task.id;this.store.saveMessage(message);this.save({task,input:structuredClone(input),messageId:message.id,callId:call.id});this.store.db.exec('COMMIT');}
    catch(error){this.store.db.exec('ROLLBACK');throw error;}
    return structuredClone(task);
  }
}

/** Coordinates host work at explicit boundaries; it never calls a model to
 * poll status. Integration callbacks run only when the root drains this queue. */
export class LiteFusionScheduler {
  private operations=new Map<string,Promise<void>>();
  private actions:Array<()=>Promise<void>>=[];
  private waiters=new Set<()=>void>();
  private closed=false;
  constructor(readonly tasks:LiteFusionTasks,readonly parentId:string,readonly turnId:string,readonly capacity:number,readonly signal:AbortSignal,private prepare:(task:LiteFusionTask)=>Promise<()=>Promise<void>>,private publish:(task:LiteFusionTask)=>void) {}
  pending(){return this.tasks.list(this.parentId).some(task=>task.turnId===this.turnId&&active(task));}
  canProgress(){return this.operations.size>0||this.actions.length>0||this.tasks.list(this.parentId).some(task=>task.turnId===this.turnId&&task.status==='queued'&&task.dependencies.every(id=>this.tasks.get(this.parentId,id).task.status==='completed'));}
  private wake(){for(const resolve of this.waiters)resolve();this.waiters.clear();}
  async boundary(){
    while(this.actions.length)await this.actions.shift()!();
    if(this.closed||this.signal.aborted)return;
    for(const task of this.tasks.list(this.parentId).filter(task=>task.turnId===this.turnId&&task.status==='queued')) {
      const dependencies=task.dependencies.map(id=>this.tasks.get(this.parentId,id).task);
      if(dependencies.some(task=>!active(task)&&task.status!=='completed'&&task.status!=='blocked')){this.publish(this.tasks.update(this.parentId,task.id,{status:'failed',error:'A prerequisite did not complete. Inspect it before rescheduling.'}));continue;}
      if(dependencies.some(task=>task.status!=='completed')||this.operations.size>=this.capacity)continue;
      this.publish(this.tasks.update(this.parentId,task.id,{status:'running'}));
      let execute:()=>Promise<void>;
      try{execute=await this.prepare(task);}catch(error){this.publish(this.tasks.update(this.parentId,task.id,{status:this.signal.aborted||this.tasks.get(this.parentId,task.id).task.status==='cancelled'?'cancelled':'failed',error:error instanceof Error?error.message:String(error)}));continue;}
      const operation=execute().catch(error=>this.integrate(async()=>{this.publish(this.tasks.update(this.parentId,task.id,{status:this.signal.aborted||this.tasks.get(this.parentId,task.id).task.status==='cancelled'?'cancelled':'failed',error:error instanceof Error?error.message:String(error)}));})).finally(()=>{this.operations.delete(task.id);this.wake();});
      this.operations.set(task.id,operation);
    }
  }
  integrate<T>(operation:()=>Promise<T>):Promise<T>{
    return new Promise<T>((resolve,reject)=>{this.actions.push(async()=>{try{resolve(await operation());}catch(error){reject(error);}});this.wake();});
  }
  async wait(){
    const started=Date.now();
    try {
    await this.boundary();
    if(!this.pending()||!this.canProgress())return;
    await new Promise<void>(resolve=>{
      const wake=()=>{this.waiters.delete(wake);this.signal.removeEventListener('abort',wake);resolve();};
      this.waiters.add(wake);this.signal.addEventListener('abort',wake,{once:true});
      if(this.actions.length||this.signal.aborted||!this.pending())wake();
    });
    await this.boundary();
    } finally {this.tasks.addMetric(this.parentId,this.turnId,'leadWaitMs',Date.now()-started);}
  }
  async close(){
    this.closed=true;
    for(const task of this.tasks.list(this.parentId).filter(task=>task.turnId===this.turnId&&task.status==='queued'))this.publish(this.tasks.update(this.parentId,task.id,{status:'interrupted',error:'The response ended before this task started. Continue explicitly after resolving its prerequisites.'}));
    // Root cancellation aborts worker requests before this join. Drain even on
    // abort so retained-work reports can settle and release their waiters.
    while(this.operations.size||this.actions.length){await this.boundary();if(this.operations.size)await Promise.race([...this.operations.values(),new Promise<void>(resolve=>this.waiters.add(resolve))]);}
    this.wake();
  }
}
