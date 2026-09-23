export interface UpdateStatus {
  kind?: 'desktop';
  currentBuild?: number;
  latestBuild?: number;
  installedBuild?: number;
  progress?: { received: number; total: number };
  blockers?: string[];
  currentVersion: string;
  latestVersion?: string;
  available: boolean;
  packaged: boolean;
  installedVersion?: string;
  restartRequired: boolean;
  checkedAt?: number;
  error?: string;
  releaseUrl: string;
  command: string;
}
