import { createHash } from 'node:crypto';
import { captureProjectPermissions, captureProjectHooksFile } from './tools.js';
import { validateRuleSet } from './permissions.js';
import type { PermissionRule } from '../shared/permissions.js';

export const sourceHash = (text:string|null) => createHash('sha256').update(text ?? '').digest('hex');
export function permissionReview(workspace:string) {
  const source = captureProjectPermissions(workspace);
  let rules:PermissionRule[] = [], advisory=source.advisory;
  if (source.text !== null) {
    try { rules=validateRuleSet(JSON.parse(source.text.replace(/^\uFEFF/,''))).rules; }
    catch { advisory='Project permission rules are invalid. Fix the file before trusting it.'; }
  }
  return { rules, sourceHash:sourceHash(source.text), advisory, source:source.text ?? '' };
}
export function hookReview(workspace:string) {
  const source=captureProjectHooksFile(workspace);
  return { source:source.text ?? '', sourceHash:sourceHash(source.text), advisory:source.advisory };
}
