import { createServer, type Server } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { auth, refreshAuthorization, selectResourceURL, type OAuthClientProvider, type OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import { OAuthClientInformationSchema, OAuthTokensSchema, type OAuthClientInformationMixed, type OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpLoginStart, McpLoginStatus } from '../shared/mcp.js';
import { McpConnectionError, connectionError } from './mcp-errors.js';

const LOGIN_MS = 10 * 60_000;
interface Credential {
  revision?: string;
  redirectUrl: string;
  resource?: string;
  client: OAuthClientInformationMixed;
  tokens: OAuthTokens;
  expiresAt?: number;
  discovery: OAuthDiscoveryState;
}
interface Pending {
  key: string; status: McpLoginStatus; expiresAt: number;
  controller: AbortController; server: Server; timer?: ReturnType<typeof setTimeout>;
  valid: () => boolean;
}
export interface McpAuthChallenge { resourceMetadataUrl?: URL; scope?: string }
const keyFor = (name: string, url: string) => createHash('sha256').update(JSON.stringify([name, url])).digest('hex');

function secureUrl(value: string | URL): URL {
  const url = new URL(value);
  if (url.username || url.password || !['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))) throw new McpConnectionError('oauth');
  return url;
}

/** Own logins only; credentials never enter settings, tool context, or API responses. */
export class McpAuth {
  private file: string;
  private credentials = new Map<string, Credential>();
  private logins = new Map<string, Pending>();
  private refreshes = new Map<string, Promise<string>>();
  private lifetime = new AbortController();

  constructor(directory: string) {
    mkdirSync(resolve(directory), { recursive: true, mode: 0o700 });
    this.file = join(resolve(directory), 'mcp-auth.json');
    if (!existsSync(this.file)) return;
    if (lstatSync(this.file).isSymbolicLink()) throw new Error('Refusing a symbolic-link MCP credential file.');
    chmodSync(this.file, 0o600);
    let data: unknown;
    try { data = JSON.parse(readFileSync(this.file, 'utf8')); } catch { throw new Error('The MCP credential file is unreadable.'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    for (const [key, value] of Object.entries(data)) {
      const entry = value as Partial<Credential> | null;
      if (/^[a-f0-9]{64}$/.test(key) && entry && typeof entry.redirectUrl === 'string' && OAuthClientInformationSchema.safeParse(entry.client).success && OAuthTokensSchema.safeParse(entry.tokens).success && entry.discovery?.authorizationServerUrl && (entry.expiresAt === undefined || Number.isFinite(entry.expiresAt))) this.credentials.set(key, entry as Credential);
    }
  }
  private persist() {
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(Object.fromEntries(this.credentials)), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, this.file);
  }
  private save(key: string, credential?: Credential) {
    const previous = this.credentials.get(key);
    if (credential) this.credentials.set(key, credential); else this.credentials.delete(key);
    try { this.persist(); }
    catch (error) { if (previous) this.credentials.set(key, previous); else this.credentials.delete(key); throw error; }
  }
  private fetcher(signal: AbortSignal): FetchLike {
    return async (input, init) => {
      const url = secureUrl(input instanceof Request ? input.url : String(input));
      const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(15_000)]) });
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new McpConnectionError('redirect'); }
      // Bound OAuth metadata and error bodies before the SDK buffers/parses them.
      const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
      if (reader) try {
        while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > 1024 * 1024) throw new McpConnectionError('oauth'); chunks.push(next.value); }
      } finally { await reader.cancel().catch(() => {}); }
      return new Response(bytes ? Buffer.concat(chunks) : null, { status: response.status, statusText: response.statusText, headers: response.headers });
    };
  }
  private stop(login: Pending) {
    clearTimeout(login.timer); login.controller.abort(); login.server.close(); login.server.closeIdleConnections();
  }
  private fail(login: Pending, message: string) {
    if (login.status.status !== 'pending') return;
    login.status = { status: 'error', error: message }; this.stop(login);
  }
  status(id: string): McpLoginStatus {
    const login = this.logins.get(id);
    if (!login) throw Object.assign(new Error('MCP sign-in not found or expired.'), { status: 404 });
    if (!login.valid() || this.lifetime.signal.aborted) this.fail(login, 'MCP configuration changed. Start sign-in again.');
    return { ...login.status };
  }
  cancel(id: string) { const login = this.logins.get(id); if (login) this.fail(login, 'Sign-in cancelled.'); }
  cancelServer(name: string, url: string) { for (const login of this.logins.values()) if (login.key === keyFor(name, url)) this.fail(login, 'MCP configuration changed. Start sign-in again.'); }

  async start(name: string, url: string, challenge: McpAuthChallenge, signal: AbortSignal, valid: () => boolean, onAuthorized: () => void = () => {}): Promise<McpLoginStart> {
    secureUrl(url);
    if (signal.aborted || this.lifetime.signal.aborted || !valid()) throw new McpConnectionError('oauth');
    const key = keyFor(name, url);
    for (const [id, previous] of this.logins) {
      if (previous.key === key) this.fail(previous, 'Replaced by a new sign-in.');
      if (previous.expiresAt <= Date.now()) { this.fail(previous, 'Sign-in expired. Start again.'); this.logins.delete(id); }
    }
    if (this.logins.size >= 100) throw new Error('Too many sign-in attempts. Wait before trying again.');
    const state = randomBytes(32).toString('base64url'), id = randomUUID();
    let verifier = '', authorizationUrl = '', handled = false;
    let client: OAuthClientInformationMixed | undefined, discovery: OAuthDiscoveryState | undefined, tokens: OAuthTokens | undefined;
    let redirectUrl = '';
    const server = createServer((req, res) => {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
      const callback = new URL(req.url || '/', redirectUrl);
      if (req.method !== 'GET' || callback.pathname !== '/callback' || req.headers.host !== new URL(redirectUrl).host) { res.writeHead(404).end('Not found.'); return; }
      if (callback.searchParams.get('state') !== state) { res.writeHead(400).end('Invalid sign-in state.'); return; }
      if (handled || login.status.status !== 'pending' || !valid()) { res.writeHead(409).end('Sign-in expired or configuration changed. Return to Litespeed.'); return; }
      if (callback.searchParams.has('error')) { res.writeHead(400).end('Sign-in declined. Return to Litespeed.'); this.fail(login, 'Sign-in was declined. Choose Sign in to try again.'); return; }
      const code = callback.searchParams.get('code');
      if (!code) { res.writeHead(400).end('Missing authorization code.'); return; }
      handled = true;
      void auth(provider, { serverUrl: url, authorizationCode: code, fetchFn: this.fetcher(login.controller.signal) }).then(async result => {
        if (result !== 'AUTHORIZED' || !tokens || !client || !discovery || login.controller.signal.aborted || !valid()) throw new McpConnectionError('oauth');
        const resource = await selectResourceURL(url, provider, discovery.resourceMetadata);
        if (login.controller.signal.aborted || !valid()) throw new McpConnectionError('oauth');
        if (tokens.token_type.toLowerCase() !== 'bearer') throw new McpConnectionError('oauth');
        onAuthorized();
        this.save(key, { revision: randomUUID(), redirectUrl, resource: resource?.href, client, tokens, discovery, ...(tokens.expires_in !== undefined ? { expiresAt: Date.now() + tokens.expires_in * 1000 } : {}) });
        login.status = { status: 'complete' };
        res.end('Signed in. Return to Litespeed and choose Reconnect to load tools.'); this.stop(login);
      }).catch(error => { res.writeHead(502).end('Sign-in could not be completed. Return to Litespeed.'); this.fail(login, this.loginError(error)); });
    });
    const login: Pending = { key, server, valid, controller: new AbortController(), expiresAt: Date.now() + LOGIN_MS, status: { status: 'pending' } };
    const provider: OAuthClientProvider = {
      get redirectUrl() { return redirectUrl; },
      get clientMetadata() { return { client_name: 'Litespeed', redirect_uris: [redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }; },
      state: () => state, clientInformation: () => client, saveClientInformation: value => { client = value; },
      tokens: () => undefined, saveTokens: value => { tokens = value; },
      saveCodeVerifier: value => { verifier = value; }, codeVerifier: () => verifier,
      redirectToAuthorization: value => { authorizationUrl = secureUrl(value).href; },
      discoveryState: () => discovery, saveDiscoveryState: value => { discovery = value; },
    };
    const abort = () => this.fail(login, 'Sign-in cancelled.'); signal.addEventListener('abort', abort, { once: true });
    this.logins.set(id, login);
    login.timer = setTimeout(() => this.fail(login, 'Sign-in expired. Choose Sign in to try again.'), LOGIN_MS); login.timer.unref();
    try {
      const port = await new Promise<number>((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', () => yes((server.address() as { port: number }).port)); });
      redirectUrl = `http://127.0.0.1:${port}/callback`;
      const result = await auth(provider, { serverUrl: url, ...challenge, fetchFn: this.fetcher(login.controller.signal) });
      if (result !== 'REDIRECT' || !authorizationUrl || login.controller.signal.aborted || !valid()) throw new McpConnectionError('oauth');
      return { loginId: id, url: authorizationUrl, expiresAt: login.expiresAt };
    } catch (error) { const message = this.loginError(error); this.fail(login, message); this.stop(login); throw Object.assign(new Error(message), { status: 502 }); }
    finally { signal.removeEventListener('abort', abort); }
  }
  private loginError(error: unknown): string {
    const safe = connectionError(error);
    return safe.code === 'unknown' ? new McpConnectionError('oauth').message : safe.message;
  }
  revision(name: string, url: string): string | undefined { const entry = this.credentials.get(keyFor(name, url)); return entry ? entry.revision ?? 'legacy' : undefined; }
  forget(name: string, url: string) { this.cancelServer(name, url); this.save(keyFor(name, url)); }
  async token(name: string, url: string): Promise<string | undefined> {
    const key = keyFor(name, url), stored = this.credentials.get(key);
    if (!stored) return;
    if (stored.expiresAt === undefined || stored.expiresAt > Date.now() + 30_000) return stored.tokens.access_token;
    const existing = this.refreshes.get(key); if (existing) return existing;
    const refresh = (async () => {
      if (!stored.tokens.refresh_token) throw new McpConnectionError('auth_required');
      try {
        const resource = stored.resource ? new URL(stored.resource) : undefined;
        const tokens = await refreshAuthorization(stored.discovery.authorizationServerUrl, {
          metadata: stored.discovery.authorizationServerMetadata, clientInformation: stored.client, refreshToken: stored.tokens.refresh_token,
          resource, fetchFn: this.fetcher(this.lifetime.signal),
        });
        if (this.lifetime.signal.aborted || this.credentials.get(key) !== stored) throw new McpConnectionError('auth_required');
        const next = { ...stored, tokens: { ...tokens, refresh_token: tokens.refresh_token ?? stored.tokens.refresh_token }, expiresAt: tokens.expires_in !== undefined ? Date.now() + tokens.expires_in * 1000 : undefined };
        this.save(key, next); return next.tokens.access_token;
      } catch (error) { const safe = connectionError(error); throw safe.code === 'unknown' ? new McpConnectionError('auth_required') : safe; }
    })();
    this.refreshes.set(key, refresh);
    try { return await refresh; } finally { if (this.refreshes.get(key) === refresh) this.refreshes.delete(key); }
  }
  async close() {
    this.lifetime.abort(); for (const login of this.logins.values()) this.fail(login, 'Litespeed closed. Start sign-in again.');
    await Promise.allSettled(this.refreshes.values());
  }
}
