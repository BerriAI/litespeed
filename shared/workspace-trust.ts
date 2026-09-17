export interface WorkspaceTrustReview {
  workspace:string;
  sandboxBackend:string|null;
  rules:{source:string;sourceHash:string;trusted:boolean;advisory?:string};
  hooks:{source:string;sourceHash:string;trusted:boolean;advisory?:string};
  grants:{tool:string;scope:string;description:string}[];
  appHooks:import('./hooks.js').HookConfig[];
  appHooksRevision:string;
  sidecars:unknown[];
}
