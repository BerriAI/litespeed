/** Cache-only lifecycle observations; neither status nor saved config connects. */
export interface McpServerStatus {
  name: string;
  revision: string;
  status: 'disabled' | 'disconnected' | 'connecting' | 'connected' | 'refreshing' | 'stale' | 'auth_required' | 'error';
  tools: { name: string; remoteName: string; description: string }[];
  error?: string;
  errorCode?: string;
  signedIn?: boolean;
  reason?: string;
  updatedAt?: number;
}

/** Sanitized MCP data available to code, before the smaller model-output cap. */
export interface McpCodeResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
}

/** Audit metadata only: bulk arguments/results never enter model history. */
export interface McpCodeInvocation {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'error' | 'denied';
  argumentBytes: number;
  resultBytes?: number;
  startedAt: number;
  endedAt?: number;
}

export interface McpLoginStart { loginId: string; url: string; expiresAt: number }
export interface McpLoginStatus { status: 'pending' | 'complete' | 'error'; error?: string }
