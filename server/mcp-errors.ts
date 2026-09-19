import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';

export type McpErrorCode = 'auth_required' | 'forbidden' | 'dns' | 'refused' | 'tls' | 'timeout' | 'redirect' | 'http' | 'process' | 'protocol' | 'oauth' | 'unknown';
const messages: Record<McpErrorCode, string> = {
  auth_required: 'Sign-in required. Choose Sign in to authorize this MCP server.',
  forbidden: 'Access denied (HTTP 403). Check that your account has permission to use this server.',
  dns: 'Server address could not be found (DNS). Check the saved URL and your network or VPN.',
  refused: 'Connection refused. Check that the MCP server is running and the URL and port are correct.',
  tls: 'The server certificate could not be verified. Check the certificate or your network’s trusted certificates.',
  timeout: 'The MCP server did not respond in time. Check the server and your network, then reconnect.',
  redirect: 'The MCP endpoint redirected the request. Save the final endpoint URL, then reconnect.',
  http: 'The MCP server rejected the connection.',
  process: 'Unable to start the MCP command. Check that it is installed and its path and permissions are correct.',
  protocol: 'The server returned an invalid MCP response. Check that the URL or command points to an MCP server.',
  oauth: 'Sign-in could not be completed. The server must support MCP OAuth discovery and public client registration. Try again or check with its administrator.',
  unknown: 'Unable to connect to the MCP server. Check the saved configuration and server, then reconnect.',
};

/** Only fixed messages and numeric HTTP statuses cross the API boundary. Never
 * show SDK errors, response bodies, URLs, headers, or subprocess stderr. */
export class McpConnectionError extends Error {
  readonly status: number;
  constructor(readonly code: McpErrorCode, httpStatus?: number) {
    super(code === 'http' && httpStatus ? `The MCP server returned HTTP ${httpStatus}. Check the endpoint and server, then reconnect.` : messages[code]);
    this.status = code === 'auth_required' ? 401 : code === 'forbidden' ? 403 : 502;
  }
}

export function connectionError(error: unknown): McpConnectionError {
  if (error instanceof McpConnectionError) return error;
  if (error instanceof UnauthorizedError) return new McpConnectionError('auth_required');
  if (error instanceof StreamableHTTPError) return new McpConnectionError(error.code === 401 ? 'auth_required' : error.code === 403 ? 'forbidden' : 'http', error.code);
  let cause = error;
  for (let depth = 0; depth < 6 && cause && typeof cause === 'object'; depth++) {
    const value = cause as { code?: unknown; name?: unknown; cause?: unknown };
    const code = String(value.code ?? '');
    if (['SyntaxError', 'ZodError'].includes(String(value.name)) || ['-32700', '-32600'].includes(code)) return new McpConnectionError('protocol');
    if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return new McpConnectionError('dns');
    if (code === 'ECONNREFUSED') return new McpConnectionError('refused');
    if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', '-32001'].includes(code) || value.name === 'TimeoutError') return new McpConnectionError('timeout');
    if (/CERT|SSL|TLS|UNABLE_TO_VERIFY|SELF_SIGNED/.test(code)) return new McpConnectionError('tls');
    cause = value.cause;
  }
  return new McpConnectionError('unknown');
}
