import type { Model } from './types.js';

type Family = 'astra' | 'fable' | 'opus' | 'sol';
type Candidate = { id: string; family: Family; version: number[]; snapshot: number; rank: number };
export const SETUP_MODEL_PRIORITIES = {
  driver: ['astra', 'fable', 'opus', 'sol'],
  sidekick: ['sol', 'opus', 'fable', 'astra'],
} as const;

/** Recognize full model families, never arbitrary display names or mini/batch variants. */
function identity(id: string): Omit<Candidate, 'id' | 'rank'> | undefined {
  const name = id.toLowerCase().split('/').at(-1)!.replace(/^(?:(?:global|us|eu|au|jp|us-gov)\.)?anthropic\./, '');
  let match = /^gpt-(\d+(?:[.-]\d{1,2})*)-(astra|sol)(?:-(\d{4}-\d{2}-\d{2}|\d{8}))?$/.exec(name);
  if (match) return { family: match[2] as Family, version: match[1].split(/[.-]/).map(Number), snapshot: Number(match[3]?.replaceAll('-', '') ?? 0) };
  match = /^claude-(fable|opus)-(\d+(?:[.-]\d{1,2})*)(?:[-@](\d{8}|latest|default))?(?::\d+|-v\d+:\d+)?$/.exec(name);
  if (match) return { family: match[1] as Family, version: match[2].split(/[.-]/).map(Number), snapshot: /^\d{8}$/.test(match[3] ?? '') ? Number(match[3]) : 0 };
  match = /^claude-(\d+(?:[.-]\d{1,2})*)-(fable|opus)(?:-(\d{8}))?(?::\d+|-v\d+:\d+)?$/.exec(name);
  if (match) return { family: match[2] as Family, version: match[1].split(/[.-]/).map(Number), snapshot: Number(match[3] ?? 0) };
}

export function setupModelIdentity(model: Pick<Model, 'id' | 'canonicalId'>) {
  if (/(?:^|[/._-])batch(?:$|[/._-])/i.test(model.id)) return;
  return identity(model.id) ?? (model.canonicalId ? identity(model.canonicalId) : undefined);
}

export function defaultSetupModel(models: readonly Pick<Model, 'id' | 'canonicalId'>[], role: keyof typeof SETUP_MODEL_PRIORITIES): string {
  const candidates: Candidate[] = models.flatMap(model => {
    const parsed = setupModelIdentity(model);
    if (!parsed) return [];
    // Prefer native gateway routes, then direct IDs, then other deployments/aliases.
    const native = /^(?:openai\/gpt-|anthropic\/claude-)/i.test(model.id);
    return [{ ...parsed, id: model.id, rank: native ? 0 : /^(gpt-|claude-)/i.test(model.id) ? 1 : 2 }];
  });
  for (const family of SETUP_MODEL_PRIORITIES[role]) {
    const matches = candidates.filter(candidate => candidate.family === family).sort((a, b) => {
      for (let i = 0; i < Math.max(a.version.length, b.version.length); i++) {
        const difference = (b.version[i] ?? 0) - (a.version[i] ?? 0);
        if (difference) return difference;
      }
      // The unsuffixed version follows the current snapshot; otherwise prefer the newest dated snapshot.
      return Number(a.snapshot !== 0) - Number(b.snapshot !== 0) || b.snapshot - a.snapshot || a.rank - b.rank || a.id.localeCompare(b.id);
    });
    if (matches[0]) return matches[0].id;
  }
  return '';
}
