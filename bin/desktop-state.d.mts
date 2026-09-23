export function findDesktopSource(candidates: (string | undefined)[], destination: string): Promise<string | null>;
export function importDesktopState(source: string, destination: string): Promise<{ imported: boolean; source?: string; importedAt?: number; sessions?: number; schedulesPaused?: number }>;
