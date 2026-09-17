export type McpImportRootId = 'claude:user' | 'claude:local' | 'claude:project' | 'codex:home' | 'codex:project';
export type McpImportSource = 'claude' | 'codex';
export type McpImportScope = 'user' | 'local' | 'project';

/** Import metadata only: raw configuration values, paths, commands, arguments,
 * URLs, and credentials never cross the discovery API boundary. Explicit connection plans show commands and endpoints. */
export interface McpImportCandidate {
  id: string;
  rootId: McpImportRootId;
  source: McpImportSource;
  scope: McpImportScope;
  name: string;
  transport: 'stdio' | 'http' | 'incompatible';
  envKeys: string[];
  compatible: boolean;
  reason?: string;
  conflict: boolean;
}
export interface McpImportRootSummary { rootId: McpImportRootId; source: McpImportSource; scope: McpImportScope; count: number; }
export interface McpImportConnection {name:string;command?:string;args?:string[];url?:string;envKeys:string[];}
export interface McpImportPlan { connections?:McpImportConnection[]; candidates: McpImportCandidate[]; sourceHash: string; warnings: string[]; destination: 'global-settings'; }
export interface McpImportResult { connected?:string[]; connectionErrors?:string[]; imported: string[]; skipped: string[]; configRevision: string; }
export const MCP_IMPORT_LIMITS = { roots: 5, candidates: 100, fileBytes: 1024 * 1024, selected: 30, args: 100, argBytes: 4000, envValueBytes: 8192 } as const;
