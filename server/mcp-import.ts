/** Opt-in, copy-only MCP config import. Fixed sources are resolved server-side;
 * discovery contains metadata; explicit plans show commands/endpoints without environment values.
 * Applying re-reads the selected sources; connecting requires the explicit reviewed option.
 */
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import toml from 'toml';
import type { McpServerConfig } from '../shared/types.js';
import {
  MCP_IMPORT_LIMITS,
  type McpImportCandidate, type McpImportPlan, type McpImportResult,
  type McpImportRootId, type McpImportRootSummary,
} from '../shared/mcp-import.js';
import type { Store } from './store.js';

const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const own = (value: object, key: string) => Object.hasOwn(value, key);
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
  && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const nameOK = (name: string) => /^[a-zA-Z0-9_-]{1,64}$/.test(name)
  && !['__proto__', 'prototype', 'constructor'].includes(name);
const safeString = (value: unknown, max: number): value is string => typeof value === 'string'
  && value.length <= max && !value.includes('\0');

// Iterative traversal avoids a stack overflow on deeply nested, untrusted JSON.
function interpolation(value: unknown): boolean {
  const pending = [value];
  while (pending.length) {
    const next = pending.pop();
    if (typeof next === 'string' && /\$\{[^}]+\}/.test(next)) return true;
    if (Array.isArray(next)) pending.push(...next);
    else if (plain(next)) pending.push(...Object.values(next));
  }
  return false;
}

type Root = { rootId: McpImportRootId; source: 'claude' | 'codex'; scope: 'user' | 'local' | 'project' };
type Item = { candidate: McpImportCandidate; config?: McpServerConfig; identity: unknown };
const ROOTS: Root[] = [
  { rootId: 'claude:user', source: 'claude', scope: 'user' },
  { rootId: 'claude:local', source: 'claude', scope: 'local' },
  { rootId: 'claude:project', source: 'claude', scope: 'project' },
  { rootId: 'codex:home', source: 'codex', scope: 'user' },
  { rootId: 'codex:project', source: 'codex', scope: 'project' },
];

async function canonicalBase(value: string): Promise<string | null> {
  try { return await fs.realpath(value); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw fail('MCP import source is unavailable.');
  }
}

/** Canonical bases accommodate OS aliases (e.g. macOS /var). Every component
 * below the base must be a real directory/file. Identity is rechecked around the
 * bounded read. No file is written and no imported command is executed here. */
async function readUnder(base: string, parts: string[]): Promise<string | null> {
  let current = base;
  const baseStat = await fs.lstat(base);
  const chain = [{ path: base, dev: baseStat.dev, ino: baseStat.ino }];
  try {
    for (const [index, part] of parts.entries()) {
      current = join(current, part);
      const st = await fs.lstat(current);
      if (st.isSymbolicLink() || (index < parts.length - 1 ? !st.isDirectory() : !st.isFile())) {
        throw fail('MCP import source is unavailable.');
      }
      chain.push({ path: current, dev: st.dev, ino: st.ino });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw fail('MCP import source is unavailable.');
  }
  const expected = chain.at(-1)!;
  const verify = async () => {
    for (const item of chain) {
      const st = await fs.lstat(item.path);
      if (st.isSymbolicLink() || st.dev !== item.dev || st.ino !== item.ino) {
        throw fail('MCP import source changed while read.');
      }
    }
    if (await fs.realpath(current) !== current) throw fail('MCP import source is unavailable.');
  };
  await verify();
  const handle = await fs.open(current, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== expected.dev || opened.ino !== expected.ino
      || opened.size > MCP_IMPORT_LIMITS.fileBytes) throw fail('MCP import source is unavailable.');
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, null);
      if (!bytesRead) throw fail('MCP import source changed while read.');
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
      || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      throw fail('MCP import source changed while read.');
    }
    await verify();
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally { await handle.close(); }
}

async function sourceText(root: Root, workspace: string): Promise<string | null> {
  if (root.rootId === 'claude:project') return readUnder(workspace, ['.mcp.json']);
  if (root.rootId === 'codex:project') return readUnder(workspace, ['.codex', 'config.toml']);
  if (root.rootId === 'codex:home' && process.env.CODEX_HOME) {
    const base = await canonicalBase(process.env.CODEX_HOME);
    return base ? readUnder(base, ['config.toml']) : null;
  }
  const home = await canonicalBase(homedir());
  return home ? readUnder(home, root.rootId === 'codex:home' ? ['.codex', 'config.toml'] : ['.claude.json']) : null;
}

function incompatible(root: Root, name: string, reason: string, envKeys: string[] = []): Item {
  return {
    candidate: {
      // Hash the original name so invalid names still have unique UI identities.
      id: sha([root.rootId, name]).slice(0, 32), rootId: root.rootId,
      source: root.source, scope: root.scope, name: nameOK(name) ? name : 'unnamed',
      transport: 'incompatible', envKeys: envKeys.filter(nameOK).sort(),
      compatible: false, reason, conflict: false,
    },
    identity: [root.rootId, name, reason],
  };
}

function normalize(root: Root, name: string, raw: unknown, existing: Record<string, McpServerConfig>): Item {
  if (!nameOK(name) || !plain(raw)) return incompatible(root, name, 'Unsupported server name or entry.');
  const envKeys = plain(raw.env) ? Object.keys(raw.env) : [];
  const reject = (reason: string) => incompatible(root, name, reason, envKeys);
  const isStdio = typeof raw.command === 'string';
  const isRemote = typeof raw.url === 'string';
  // Unknown fields must not silently lose auth, tool policy, cwd, or timeout semantics.
  const allowed = [
    ...(root.source === 'claude' ? ['type'] : []),
    ...(isStdio ? ['command', 'args', 'env', 'enabled'] : ['url', 'enabled']),
  ];
  if (!Object.keys(raw).every(key => allowed.includes(key))) return reject('Uses unsupported MCP configuration fields.');
  if (interpolation(raw)) return reject('Uses environment interpolation, which is not imported.');
  if (isStdio === isRemote || (raw.enabled !== undefined && typeof raw.enabled !== 'boolean')) {
    return reject('Unsupported MCP transport configuration.');
  }
  let config: McpServerConfig;
  if (isStdio) {
    const validArgs = raw.args === undefined || (Array.isArray(raw.args)
      && raw.args.length <= MCP_IMPORT_LIMITS.args
      && raw.args.every(arg => safeString(arg, MCP_IMPORT_LIMITS.argBytes)));
    const validEnv = raw.env === undefined || (plain(raw.env)
      && Object.entries(raw.env).every(([key, value]) => nameOK(key) && safeString(value, MCP_IMPORT_LIMITS.envValueBytes)));
    if ((raw.type !== undefined && raw.type !== 'stdio') || !safeString(raw.command, 1000)
      || !raw.command.trim() || !validArgs || !validEnv) return reject('Invalid stdio MCP configuration.');
    config = {
      command: raw.command,
      ...(raw.args !== undefined ? { args: raw.args as string[] } : {}),
      ...(raw.env !== undefined ? { env: raw.env as Record<string, string> } : {}),
      enabled: false, advertise: false,
    };
  } else {
    // URL-only Claude configurations are equivalent to HTTP. Explicit SSE is
    // not: the runtime only attempts SSE on certain HTTP negotiation failures.
    if (raw.type !== undefined && !['http', 'streamable-http'].includes(String(raw.type))) {
      return reject('This remote transport is not supported.');
    }
    if (!safeString(raw.url, 8192)) return reject('Invalid remote MCP URL.');
    try {
      const url = new URL(raw.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        return reject('Remote URLs with credentials, queries, or fragments require manual configuration.');
      }
    } catch { return reject('Invalid remote MCP URL.'); }
    config = { url: raw.url, enabled: false, advertise: false };
  }
  return {
    candidate: {
      id: sha([root.rootId, name]).slice(0, 32), rootId: root.rootId, source: root.source,
      scope: root.scope, name, transport: isStdio ? 'stdio' : 'http', envKeys: envKeys.sort(),
      compatible: true, conflict: own(existing, name),
      ...(own(existing, name) ? { reason: 'A server with this name is already configured.' } : {}),
    },
    config, identity: [root.rootId, name, raw],
  };
}

async function scan(workspace: string, existing: Record<string, McpServerConfig>) {
  const all: Item[] = [], roots: McpImportRootSummary[] = [], issues: string[] = [];
  for (const root of ROOTS) {
    let count = 0;
    try {
      const text = await sourceText(root, workspace);
      let entries: unknown = {};
      if (text !== null) {
        const doc: unknown = root.source === 'codex' ? toml.parse(text) : JSON.parse(text);
        if (!plain(doc)) throw fail('Invalid MCP configuration.');
        if (root.rootId === 'claude:local') {
          const project = plain(doc.projects) && own(doc.projects, workspace) ? doc.projects[workspace] : undefined;
          entries = plain(project) && own(project, 'mcpServers') ? project.mcpServers : {};
        } else {
          const field = root.source === 'codex' ? 'mcp_servers' : 'mcpServers';
          entries = own(doc, field) ? doc[field] : {};
        }
        if (!plain(entries)) throw fail('Invalid MCP server map.');
      }
      const list = Object.entries(entries as Record<string, unknown>);
      if (list.length > MCP_IMPORT_LIMITS.candidates) {
        issues.push(`${root.source} ${root.scope}: too many MCP servers; source is unavailable for import.`);
      } else {
        all.push(...list.map(([name, value]) => normalize(root, name, value, existing)));
        count = list.length;
      }
    } catch {
      // Never forward parser/OS messages: they may contain credentials or paths.
      issues.push(`${root.source} ${root.scope}: configuration could not be read.`);
    }
    roots.push({ rootId: root.rootId, source: root.source, scope: root.scope, count });
  }
  return { all, roots, issues };
}

function select(scanned: Awaited<ReturnType<typeof scan>>, ids: string[], existing: Record<string, McpServerConfig>) {
  if (!Array.isArray(ids) || !ids.length || ids.length > MCP_IMPORT_LIMITS.selected || new Set(ids).size !== ids.length) {
    throw fail('Select between 1 and 30 MCP servers.');
  }
  const wanted = new Set(ids);
  // Fixed root order makes duplicate resolution and hashes independent of UI order.
  const result = scanned.all.filter(value => wanted.has(value.candidate.id));
  if (result.length !== ids.length) throw fail('Selected MCP server is no longer available.', 409);
  const names = new Set(Object.keys(existing));
  return result.map(value => {
    if (!value.candidate.compatible || value.candidate.conflict) return value;
    let reason: string | undefined;
    if (names.has(value.candidate.name)) reason = 'Same server name was selected from another source.';
    else if (names.size >= MCP_IMPORT_LIMITS.selected) reason = 'Global settings already reach the 30-server limit with this selection.';
    if (reason) return { ...value, candidate: { ...value.candidate, conflict: true, reason } };
    names.add(value.candidate.name);
    return value;
  });
}

export async function mcpImportDiscover(workspace: string, existing: Record<string, McpServerConfig>) {
  const scanned = await scan(workspace, existing);
  return { roots: scanned.roots, candidates: scanned.all.map(value => value.candidate), issues: scanned.issues };
}

export async function mcpImportPlan(workspace: string, existing: Record<string, McpServerConfig>, ids: string[]): Promise<McpImportPlan> {
  const choices = select(await scan(workspace, existing), ids, existing);
  const candidates = choices.map(value => value.candidate);
  return {
    connections:choices.filter(value=>value.config&&value.candidate.compatible&&!value.candidate.conflict).map(value=>({name:value.candidate.name,command:value.config!.command,args:value.config!.args,url:value.config!.url,envKeys:Object.keys(value.config!.env??{})})),
    candidates, sourceHash: sha(choices.map(value => value.identity)), destination: 'global-settings',
    warnings: [
      'Imported servers are saved globally, disabled, and disconnected. Static environment values may include API keys and are copied only on confirmation.',
      'OAuth logins are not transferred. Remote endpoints may require authentication that Litespeed does not support.',
      ...candidates.filter(value => !value.compatible || value.conflict).map(value => `${value.name} will be skipped.`),
    ],
  };
}

export async function mcpImportApply(
  workspace: string, store: Store, ids: string[], sourceHash: string,
  expectedRevision: string, revision: () => string, connect=false,
): Promise<McpImportResult> {
  const guardRevision = () => {
    if (revision() !== expectedRevision) throw fail('Saved MCP configuration changed. Review and retry.', 409);
  };
  guardRevision();
  const settings = store.settings();
  const choices = select(await scan(workspace, settings.mcpServers), ids, settings.mcpServers);
  if (sha(choices.map(value => value.identity)) !== sourceHash) throw fail('MCP import source changed since you reviewed it.', 409);
  guardRevision();
  // No await between this guard and synchronous save: concurrent settings writes
  // cannot interleave with the merge on this backend's event loop.
  const servers = { ...settings.mcpServers }, imported: string[] = [], skipped: string[] = [];
  for (const value of choices) {
    if (!value.candidate.compatible || value.candidate.conflict || !value.config) {
      skipped.push(value.candidate.name);
      continue;
    }
    servers[value.candidate.name] = {...value.config,enabled:connect};
    imported.push(value.candidate.name);
  }
  if (imported.length) store.saveSettings({ mcpServers: servers });
  return { imported, skipped, configRevision: revision() };
}
