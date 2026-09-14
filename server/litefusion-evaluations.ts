import type { Store } from './store.js';
import { z } from 'zod';

export const evaluationSchema=z.object({turnId:z.string().min(1).max(120),success:z.boolean().nullable(),source:z.string().min(1).max(500),notes:z.string().max(8000).optional()}).strict();
/** External labels are append-only observations; they never change host receipts. */
export class LiteFusionEvaluations {
  constructor(private store:Store){store.db.exec('CREATE TABLE IF NOT EXISTS litefusion_evaluations (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, turn_id TEXT NOT NULL, data TEXT NOT NULL)');}
  record(sessionId:string,value:z.infer<typeof evaluationSchema>){
    if(!this.store.messages(sessionId).some(message=>message.role==='user'&&message.id===value.turnId))throw Object.assign(new Error('Turn not found in this session.'),{status:404});
    const record={...value,recordedAt:Date.now()};
    this.store.db.prepare('INSERT INTO litefusion_evaluations(session_id,turn_id,data) VALUES(?,?,?)').run(sessionId,value.turnId,JSON.stringify(record));return record;
  }
  list(sessionId:string,turnId:string){return (this.store.db.prepare('SELECT data FROM litefusion_evaluations WHERE session_id=? AND turn_id=? ORDER BY id').all(sessionId,turnId) as {data:string}[]).map(row=>JSON.parse(row.data) as z.infer<typeof evaluationSchema>&{recordedAt:number});}
}
