import { realpathSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

const roots = new Map<string, number>();
const workspaces = new Set<string>();
const inside = (root: string, target: string) => {
  const part = relative(root, target);
  return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`));
};

/** Store locations need protection even when their names are not .litespeed. */
export function protectStateDirectory(directory: string): () => void {
  const aliases = new Set([resolve(directory), realpathSync(directory)]);
  for (const alias of aliases) roots.set(alias, (roots.get(alias) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const alias of aliases) {
      const count = roots.get(alias)! - 1;
      if (count) roots.set(alias, count); else {
        roots.delete(alias);
        for (const workspace of workspaces) if (inside(alias, workspace)) workspaces.delete(workspace);
      }
    }
  };
}

/** Only the host's isolated-workspace lifecycle can grant this exception. */
export function allowStateWorkspace(directory: string): () => void {
  const canonical = realpathSync(directory);
  workspaces.add(canonical);
  return () => { workspaces.delete(canonical); };
}

export function applicationStatePath(absolute: string, projectInstructions = false, workspace?: string): boolean {
  const locations = new Set(roots.keys());
  if (process.env.LITESPEED_DATA_DIR) {
    const configured = resolve(process.env.LITESPEED_DATA_DIR);
    if (!locations.has(configured)) {
      locations.add(configured);
      try { locations.add(realpathSync(configured)); } catch { /* A not-yet-created state directory is still protected. */ }
    }
  }
  for (const root of locations) {
    if (!inside(root, absolute)) continue;
    if (workspace && [...workspaces].some(allowed => inside(allowed, resolve(workspace)) && inside(resolve(workspace), absolute))) continue;
    // Preserve the existing, explicit project-instructions exception. It does
    // not expose arbitrary files named instructions.md in a desktop store.
    if (projectInstructions && basename(root) === '.litespeed' && relative(root, absolute) === 'instructions.md') continue;
    return true;
  }
  return false;
}
