/** A workstream outlives its worker attempts and provider conversations. */
export type LiteFusionTaskStatus='queued'|'running'|'blocked'|'completed'|'failed'|'cancelled'|'interrupted';
export interface LiteFusionTask {
  id:string;
  parentSessionId:string;
  turnId:string;
  workstream:string;
  roleId:string;
  description:string;
  status:LiteFusionTaskStatus;
  dependencies:string[];
  attemptIds:string[];
  workspace?:string;
  createdAt:number;
  updatedAt:number;
  revision:number;
  policyHash:string;
  error?:string;
  resolution?:{kind:'lead';evidence:string;at:number};
}
