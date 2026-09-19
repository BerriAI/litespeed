import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createApp } from '../server/app.js';
import { Store } from '../server/store.js';
import { McpAuth } from '../server/mcp-auth.js';
import { McpManager } from '../server/mcp.js';
import { connectionError } from '../server/mcp-errors.js';
import type { McpServerConfig } from '../shared/types.js';

const cleanup: (() => Promise<unknown>)[] = [];
const signal = () => new AbortController().signal;
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(options: { expires?: number; rejectRefresh?: boolean; rejectCall?: boolean; echoToken?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'litespeed-mcp-auth-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const rpcs: string[] = [];
  const requests: string[] = [], grants: string[] = [], authorizations: URL[] = [];
  const sessions = new Map<string, StreamableHTTPServerTransport>(), servers: Server[] = [];
  let base = '', registrations = 0, calls = 0, listings = 0;
  const http = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, base); requests.push(`${req.method} ${url.pathname}`);
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString();
      const json = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data)); };
      if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) return json(200, { resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ['read'] });
      if (url.pathname === '/.well-known/oauth-authorization-server') return json(200, { issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] });
      if (url.pathname === '/register') { registrations++; return json(201, { ...JSON.parse(raw), client_id: 'fixture-client' }); }
      if (url.pathname === '/authorize') {
        authorizations.push(url);
        const redirect = new URL(url.searchParams.get('redirect_uri')!); redirect.searchParams.set('state', url.searchParams.get('state')!); redirect.searchParams.set('code', 'fixture-code');
        res.writeHead(302, { Location: redirect.href }).end(); return;
      }
      if (url.pathname === '/token') {
        const params = new URLSearchParams(raw), grant = params.get('grant_type')!; grants.push(grant);
        if (grant === 'authorization_code') {
          const challenge = createHash('sha256').update(params.get('code_verifier')!).digest('base64url');
          if (params.get('code') !== 'fixture-code' || challenge !== authorizations.at(-1)?.searchParams.get('code_challenge')) return json(400, { error: 'invalid_grant' });
        }
        if (grant === 'refresh_token' && options.rejectRefresh) return json(400, { error: 'invalid_grant', error_description: 'DO_NOT_EXPOSE_refresh-secret' });
        return json(200, { access_token: grant === 'refresh_token' ? 'refreshed-secret' : 'access-secret', token_type: 'Bearer', refresh_token: 'refresh-secret', expires_in: grant === 'refresh_token' ? 3600 : options.expires ?? 3600 });
      }
      if (url.pathname === '/mcp') {
        const body = raw ? JSON.parse(raw) : undefined; if (body?.method) rpcs.push(body.method);
        if (!['Bearer access-secret', 'Bearer refreshed-secret'].includes(String(req.headers.authorization)) || (options.rejectCall && body?.method === 'tools/call')) {
          res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`); return json(401, { error: 'DO_NOT_EXPOSE_access-secret' });
        }
        const id = String(req.headers['mcp-session-id'] || ''); let transport = sessions.get(id);
        if (!transport && isInitializeRequest(body)) {
          const created = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: id => { sessions.set(id, created); } }); transport = created;
          const sdk = new Server({ name: 'oauth-fixture', version: '1.0' }, { capabilities: { tools: {} } }); servers.push(sdk);
          sdk.setRequestHandler(ListToolsRequestSchema, () => { listings++; return { tools: [{ name: 'read', description: 'Read a value', inputSchema: { type: 'object' } }] }; });
          sdk.setRequestHandler(CallToolRequestSchema, () => { calls++; return { content: [{ type: 'text', text: options.echoToken ? 'access-secret' : 'read value' }] }; });
          await sdk.connect(created);
        }
        if (!transport) return json(404, {});
        await transport.handleRequest(req, res, body); return;
      }
      json(404, {});
    } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  cleanup.push(async () => { await Promise.all(servers.map(server => server.close())); http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); });
  const config: Record<string, McpServerConfig> = { remote: { url: `${base}/mcp`, enabled: true } };
  function client() { const auth = new McpAuth(directory), manager = new McpManager(() => config, auth); cleanup.push(() => manager.close()); return { auth, manager }; }
  const { auth, manager } = client();
  const connect = () => manager.reconnect('remote', manager.status()[0].revision, signal());
  const login = () => manager.login('remote', manager.status()[0].revision, signal());
  return { directory, config, auth, manager, client, connect, login, requests, rpcs, grants, authorizations, registrations: () => registrations, calls: () => calls, listings: () => listings };
}

describe('remote MCP OAuth with real discovery, PKCE, callback, and SDK transports', () => {
  it('requires explicit sign-in, validates state, persists private credentials, and reconnects after restart', async () => {
    const f = await fixture();
    await expect(f.connect()).rejects.toThrow('Sign-in required');
    expect(f.manager.status()[0]).toMatchObject({ status: 'auth_required', errorCode: 'auth_required', tools: [] });
    expect(f.registrations()).toBe(0);
    const login = await f.login(), authorize = new URL(login.url);
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('scope')).toBe('read');
    expect(authorize.searchParams.get('resource')).toBe(f.config.remote.url);
    const invalid = new URL(authorize.searchParams.get('redirect_uri')!); invalid.searchParams.set('state', 'incorrect'); invalid.searchParams.set('code', 'fixture-code');
    expect((await fetch(invalid)).status).toBe(400); expect(f.grants).toEqual([]);
    expect(await (await fetch(login.url)).text()).toContain('Signed in');
    expect(f.manager.loginStatus(login.loginId)).toEqual({ status: 'complete' });
    expect(f.listings()).toBe(0); expect(f.calls()).toBe(0);
    const file = join(f.directory, 'mcp-auth.json'); expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readFile(file, 'utf8')).toContain('refresh-secret');
    expect(JSON.stringify(f.manager.status())).not.toContain('access-secret');
    await f.connect(); expect(f.manager.status()[0].status).toBe('connected');
    await f.manager.close();
    const resumed = f.client(); await resumed.manager.reconnect('remote', resumed.manager.status()[0].revision, signal());
    expect(resumed.manager.status()[0].tools).toHaveLength(1); expect(f.registrations()).toBe(1);
  });
  it('coalesces expired-token refresh and never replays a rejected tool request', async () => {
    const f = await fixture({ expires: 0, rejectCall: true }), login = await f.login();
    await fetch(login.url);
    expect(await Promise.all([f.auth.token('remote', f.config.remote.url!), f.auth.token('remote', f.config.remote.url!)])).toEqual(['refreshed-secret', 'refreshed-secret']);
    expect(f.grants).toEqual(['authorization_code', 'refresh_token']);
    await f.connect(); const lease = f.manager.capture(signal());
    await expect(lease.execute(lease.definitions[0].function.name, {}, signal())).rejects.toThrow();
    expect(f.calls()).toBe(0); expect(f.grants).toHaveLength(2); expect(f.rpcs.filter(method => method === 'tools/call')).toHaveLength(1);
    expect(f.manager.status()[0].status).toBe('auth_required');
  });
  it('reports expired authorization without exposing token endpoint errors', async () => {
    const f = await fixture({ expires: 0, rejectRefresh: true }), login = await f.login(); await fetch(login.url);
    await expect(f.connect()).rejects.toThrow('Sign-in required');
    expect(f.manager.status()[0].status).toBe('auth_required');
    expect(JSON.stringify(f.manager.status())).not.toMatch(/secret|DO_NOT_EXPOSE/);
  });
  it('rejects callbacks after configuration changes and cancels pending logins', async () => {
    const f = await fixture(), login = await f.login();
    f.config.remote.enabled = false;
    expect((await fetch(login.url)).status).toBe(409); expect(f.grants).toEqual([]);
    expect(f.manager.loginStatus(login.loginId).status).toBe('error');
    f.config.remote.enabled = true;
    const second = await f.login(); f.manager.cancelLogin(second.loginId);
    expect(f.manager.loginStatus(second.loginId)).toMatchObject({ status: 'error', error: 'Sign-in cancelled.' });
    expect(f.grants).toEqual([]);
  });
  it('invalidates accepted tools and remembered approvals when signing into another account', async () => {
    const f = await fixture({ echoToken: true }), first = await f.login(); await fetch(first.url); await f.connect();
    const lease = f.manager.capture(signal()), tool = lease.definitions[0].function.name, scope = lease.scope(tool);
    expect(await lease.execute(tool, {}, signal())).toBe('[redacted]');
    const second = await f.login(); await fetch(second.url);
    expect(() => lease.assertCurrent(tool)).toThrow();
    await f.connect(); const fresh = f.manager.capture(signal()); expect(fresh.scope(tool)).not.toBe(scope);
    await f.manager.logout('remote', f.manager.status()[0].revision, signal());
    expect(() => fresh.assertCurrent(tool)).toThrow();
    expect(await f.auth.token('remote', f.config.remote.url!)).toBeUndefined();
    const resumed = f.client(); expect(await resumed.auth.token('remote', f.config.remote.url!)).toBeUndefined();
  });
  it('keeps authorization bound to the configured server identity', async () => {
    const f = await fixture(), login = await f.login(); await fetch(login.url);
    expect(await f.auth.token('different-name', f.config.remote.url!)).toBeUndefined();
    expect(await f.auth.token('remote', f.config.remote.url! + '/different')).toBeUndefined();
    expect(() => f.manager.login('remote', 'stale', signal())).toThrow();
  });
});

describe('safe connection diagnostics', () => {
  it.each([['ENOTFOUND', 'dns'], ['ECONNREFUSED', 'refused'], ['CERT_HAS_EXPIRED', 'tls'], ['UND_ERR_CONNECT_TIMEOUT', 'timeout']] as const)('classifies %s without echoing secrets', (code, expected) => {
    const error = new Error('https://secret@example.invalid?token=secret', { cause: Object.assign(new Error('Authorization: secret'), { code }) });
    const result = connectionError(error); expect(result.code).toBe(expected); expect(result.message).not.toContain('secret');
  });
});


describe('MCP OAuth API integration', () => {
  it('requires current reviews and returns only public login state through the complete API flow', async () => {
    const f = await fixture(), store = new Store(f.directory); store.saveSettings({ mcpServers: f.config });
    const { app, runner } = createApp({ store, external: f.manager }); const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
    cleanup.push(async () => { runner.stopAll(); await runner.whenIdle(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); });
    async function api(path: string, body?: unknown, method = body ? 'POST' : 'GET') {
      const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() };
    }
    const review = async () => { const { body } = await api('/mcp'); return { expectedRevision: body.servers[0].revision, expectedConfigRevision: body.configRevision }; };
    expect((await api('/mcp/remote/login', { ...await review(), expectedConfigRevision: 'stale' })).status).toBe(409);
    expect(f.registrations()).toBe(0);
    const failed = await api('/mcp/remote/reconnect', await review()); expect(failed.status).toBe(401); expect(failed.body.error).toContain('Sign-in required');
    const started = await api('/mcp/remote/login', await review()); expect(started.status).toBe(200);
    const login = started.body; expect(Object.keys(login).sort()).toEqual(['expiresAt', 'loginId', 'url']);
    expect((await api(`/mcp/login/${login.loginId}`)).body.status).toBe('pending');
    await fetch(login.url);
    expect((await api(`/mcp/login/${login.loginId}`)).body).toEqual({ status: 'complete' });
    expect((await api('/mcp/remote/reconnect', await review())).body.servers[0]).toMatchObject({ status: 'connected', signedIn: true });
    expect(JSON.stringify((await api('/settings')).body)).not.toMatch(/access-secret|refresh-secret|fixture-client/);
    expect((await api('/mcp/remote/logout', await review())).body.servers[0]).toMatchObject({ status: 'disconnected' });
    expect(await f.auth.token('remote', f.config.remote.url!)).toBeUndefined();
  });
});
