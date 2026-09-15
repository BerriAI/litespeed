import type { SessionDetail } from './types.js';
import type { LiteFusionAssignment } from './litefusion.js';

export type DelegationStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out' | 'interrupted';
export type WorkerRole = 'sidekick' | 'worker' | 'expert';

/** An observation, never authority to create, resume, or access a child. Reads
 * must validate the private link and its originating parent transcript. */
export interface DelegationSummary {
  id: string;
  parentSessionId: string;
  parentTurnId: string;
  parentMessageId: string;
  toolCallId: string;
  childSessionId: string;
  description: string;
  status: DelegationStatus;
  createdAt: number;
  finishedAt?: number;
  error?: string;
  /** Completed execution can still need review; this is not an agent failure. */
  verificationNote?: string;
  /** The child session is the context identity; this record identifies one
   * immutable handoff. Multiple handoffs may share a Sidekick context. */
  role?: WorkerRole;
  isolated?: boolean;
  /** Runtime-owned phase while this invocation is running. */
  activity?: string;
  /** Small projection for concurrent cards; the full transcript remains separate. */
  recentActivity?: string[];
  model?: string;
  reasoningEffort?: string;
  litefusion?: LiteFusionAssignment;
  /** Host-owned task identity. Its submission receipt is already settled;
   * terminal reports are delivered as later task events, never a second result. */
  asyncTaskId?: string;
  /** Older stores retained only the latest origin of a reused Sidekick. */
  legacyContext?: boolean;
}

export type DelegationDetail = SessionDetail & {
  delegation: DelegationSummary;
  readOnly: true;
};
