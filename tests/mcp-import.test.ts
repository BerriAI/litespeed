import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store.js';
import { mcpImportDiscover, mcpImportPlan, mcpImportApply } from '../server/mcp-import.js';

describe('MCP import', () => {
  let dir: string, oldHome: string | undefined, oldCodex: string | undefined;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'litespeed-mcp-import-')); oldHome = process.env.HOME; oldCodex = process.env.CODEX_HOME; process.env.HOME = join(dir, 'home'); process.env.CODEX_HOME = join(dir, 'codex'); await mkdir(process.env.HOME, { recursive: true }); });
  afterEach(async () => { if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome; if (oldCodex === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = oldCodex; await rm(dir, { recursive: true, force: true }); });
  async function workspace() { const value = join(dir, 'work'); await mkdir(value); return realpath(value); }

  it('imports an explicitly selected subset without exposing values or mutating sources', async () => {
    const root = await workspace(); const source = join(root, '.mcp.json'); const text = JSON.stringify({ mcpServers: { safe: { command: 'secret-command', args: ['secret-argument'], env: { API_KEY: 'secret-value' } }, other: { command: 'other' } } }); await writeFile(source, text);
    const found = await mcpImportDiscover(root, {}); expect(JSON.stringify(found)).not.toContain('secret-value'); const safe = found.candidates.find(value => value.name === 'safe')!;
    const plan = await mcpImportPlan(root, {}, [safe.id]); expect(plan.candidates).toHaveLength(1); expect(JSON.stringify(plan)).not.toContain('secret-command');
    const store = new Store(join(dir, 'state')); store.saveSettings({ workspace: root, providers: [], defaultProvider: '', defaultModel: '' }); const result = await mcpImportApply(root, store, [safe.id], plan.sourceHash, plan.sourceHash, () => plan.sourceHash);
    expect(result.imported).toEqual(['safe']); expect(store.settings().mcpServers.other).toBeUndefined(); expect(await (await import('node:fs/promises')).readFile(source, 'utf8')).toBe(text); store.close();
  });

  it('marks unsupported arguments, cwd, headers, and timeout fields incompatible', async () => {
    const root = await workspace(); await writeFile(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { args: { command: 'x', args: ['${TOKEN}'] }, cwd: { command: 'x', cwd: '/tmp' }, headers: { url: 'https://example.test/mcp', type: 'http', headers: { Authorization: 'secret' } }, timeout: { command: 'x', timeout: 1000 } } }));
    const found = await mcpImportDiscover(root, {}); expect(found.candidates).toHaveLength(4); expect(found.candidates.every(value => !value.compatible)).toBe(true);
  });

  it('keeps another root discoverable when a project source is malformed or symlinked', async () => {
    const root = await workspace(); await writeFile(join(process.env.HOME!, '.claude.json'), JSON.stringify({ mcpServers: { user: { command: 'x' } } })); await writeFile(join(root, '.mcp.json'), '{ bad');
    const malformed = await mcpImportDiscover(root, {}); expect(malformed.candidates.some(value => value.name === 'user')).toBe(true); expect(malformed.issues?.length).toBeGreaterThan(0);
    await rm(join(root, '.mcp.json')); await writeFile(join(root, 'outside.json'), '{}'); await symlink(join(root, 'outside.json'), join(root, '.mcp.json'));
    const linked = await mcpImportDiscover(root, {}); expect(linked.candidates.some(value => value.name === 'user')).toBe(true); expect(linked.issues?.length).toBeGreaterThan(0);
  });

  it('supports Claude local/project and Codex home TOML with disabled persisted static environment', async () => {
    const root = await workspace(); await writeFile(join(process.env.HOME!, '.claude.json'), JSON.stringify({ projects: { [root]: { mcpServers: { local: { command: 'local', env: { LOCAL_TOKEN: 'one' } } } } } })); await writeFile(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { project: { command: 'project' } } })); await mkdir(process.env.CODEX_HOME!, { recursive: true }); await writeFile(join(process.env.CODEX_HOME!, 'config.toml'), '[mcp_servers.codex]\ncommand = "codex"\n[mcp_servers.codex.env]\nTOKEN = "two"\n');
    const found = await mcpImportDiscover(root, {}), ids = found.candidates.filter(value => ['local', 'project', 'codex'].includes(value.name)).map(value => value.id); const plan = await mcpImportPlan(root, {}, [...ids].reverse()); const store = new Store(join(dir, 'state')); store.saveSettings({ workspace: root, providers: [], defaultProvider: '', defaultModel: '' }); await mcpImportApply(root, store, ids, plan.sourceHash, plan.sourceHash, () => plan.sourceHash);
    expect(store.settings().mcpServers.local).toMatchObject({ enabled: false, advertise: false, env: { LOCAL_TOKEN: 'one' } }); expect(store.settings().mcpServers.codex).toMatchObject({ enabled: false, advertise: false, env: { TOKEN: 'two' } }); store.close();
  });

  it('has no false issues for ordinary empty Claude and Codex configuration', async () => { const root = await workspace(); await writeFile(join(process.env.HOME!, '.claude.json'), JSON.stringify({ version: 1 })); await mkdir(process.env.CODEX_HOME!, { recursive: true }); await writeFile(join(process.env.CODEX_HOME!, 'config.toml'), 'model = "gpt"\n'); const found = await mcpImportDiscover(root, {}); expect(found.issues).toEqual([]); expect(found.candidates).toEqual([]); });

  it('uses unique safe ids for invalid/prototype names', async () => { const root = await workspace(); await writeFile(join(root, '.mcp.json'), '{"mcpServers":{"__proto__":{"command":"x"},"constructor":{"command":"x"},"bad.name":{"command":"x"}}}'); const found = await mcpImportDiscover(root, {}); expect(new Set(found.candidates.map(value => value.id)).size).toBe(found.candidates.length); expect(found.candidates.every(value => !value.compatible)).toBe(true); });

  it('rejects empty commands, oversized args, and invalid environment values', async () => { const root = await workspace(); await writeFile(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { empty: { command: '' }, args: { command: 'x', args: ['x'.repeat(4001)] }, env: { command: 'x', env: { BAD: 1 } } } })); const found = await mcpImportDiscover(root, {}); expect(found.candidates.every(value => !value.compatible)).toBe(true); });

  it('isolates an oversized project source while keeping a user candidate', async () => { const root = await workspace(); await writeFile(join(process.env.HOME!, '.claude.json'), JSON.stringify({ mcpServers: { user: { command: 'x' } } })); await writeFile(join(root, '.mcp.json'), 'x'.repeat(1024 * 1024 + 1)); const found = await mcpImportDiscover(root, {}); expect(found.candidates.some(value => value.name === 'user')).toBe(true); expect(found.issues.length).toBeGreaterThan(0); });

  it('plans duplicate selected names deterministically as one import and one skip', async () => { const root = await workspace(); await writeFile(join(process.env.HOME!, '.claude.json'), JSON.stringify({ mcpServers: { same: { command: 'user' } }, projects: { [root]: { mcpServers: { same: { command: 'local' } } } } })); const found = await mcpImportDiscover(root, {}); const ids = found.candidates.filter(value => value.name === 'same').map(value => value.id); const plan = await mcpImportPlan(root, {}, [...ids].reverse()); expect(plan.candidates).toHaveLength(2); expect(plan.candidates.filter(value => value.conflict)).toHaveLength(1); });

  it('previews capacity skips and never persists more than 30 servers', async () => {
    const root = await workspace();
    const existing = Object.fromEntries(Array.from({ length: 29 }, (_, i) => [`saved${i}`, { command: 'existing' }]));
    await writeFile(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { first: { command: 'x' }, second: { command: 'y' } } }));
    const found = await mcpImportDiscover(root, existing), ids = found.candidates.map(value => value.id);
    const plan = await mcpImportPlan(root, existing, ids);
    expect(plan.candidates.map(value => value.conflict)).toEqual([false, true]);
    expect(plan.candidates[1].reason).toContain('30-server limit');
    const store = new Store(join(dir, 'state'));
    try {
      store.saveSettings({ mcpServers: existing });
      const result = await mcpImportApply(root, store, ids, plan.sourceHash, 'revision', () => 'revision');
      expect(result.imported).toEqual(['first']); expect(result.skipped).toEqual(['second']);
      expect(Object.keys(store.settings().mcpServers)).toHaveLength(30);
      expect(store.settings().mcpServers.saved0).toEqual({ command: 'existing' });
    } finally { store.close(); }
  });

  it('rejects revision changes both before apply and across the asynchronous source read', async () => {
    const root = await workspace();
    await writeFile(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { fresh: { command: 'x' } } }));
    const ids = (await mcpImportDiscover(root, {})).candidates.map(value => value.id);
    const plan = await mcpImportPlan(root, {}, ids), store = new Store(join(dir, 'state'));
    try {
      await expect(mcpImportApply(root, store, ids, plan.sourceHash, 'old', () => 'new')).rejects.toMatchObject({ status: 409 });
      let reads = 0;
      await expect(mcpImportApply(root, store, ids, plan.sourceHash, 'old', () => ++reads === 1 ? 'old' : 'new')).rejects.toMatchObject({ status: 409 });
      expect(reads).toBe(2); expect(store.settings().mcpServers).toEqual({});
    } finally { store.close(); }
  });

  it('blocks an existing collision and detects a changed reviewed source', async () => {
    const root = await workspace(); await writeFile(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { taken: { command: 'x' }, fresh: { command: 'y' } } })); const found = await mcpImportDiscover(root, { taken: { command: 'old' } }); expect(found.candidates.find(value => value.name === 'taken')?.conflict).toBe(true);
    const id = found.candidates.find(value => value.name === 'fresh')!.id, plan = await mcpImportPlan(root, { taken: { command: 'old' } }, [id]); await writeFile(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { fresh: { command: 'changed' } } })); const store = new Store(join(dir, 'state')); store.saveSettings({ workspace: root, providers: [], defaultProvider: '', defaultModel: '' }); await expect(mcpImportApply(root, store, [id], plan.sourceHash, plan.sourceHash, () => plan.sourceHash)).rejects.toThrow(/changed since/); store.close();
  });
});
