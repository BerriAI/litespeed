# MCP connections and tool snapshots

## Import Claude Code or Codex configuration

**Settings → Integrations → Import Claude/Codex MCP servers** explicitly scans only Claude Code user/local entries in `~/.claude.json`, project entries in `<workspace>/.mcp.json`, and Codex user (`$CODEX_HOME/config.toml` or `~/.codex/config.toml`) and project (`<workspace>/.codex/config.toml`) entries.

Choose one or more compatible servers; none are selected by default. Preview returns names, source/scope, transport, environment-variable *names*, compatibility, and collision status only: never commands, arguments, paths, URL credentials/query values, or environment values. The selection is source-hash revalidated at import and guarded by the saved MCP configuration revision. Imports go to **global Litespeed settings**, skip existing names, and are forced to `enabled: false` and `advertise: false`; nothing connects automatically.

Supported imports are stdio `command`/`args`/static `env`, plus HTTP/Streamable HTTP URLs. Static environment values are copied server-side only after confirmation because they may include API keys, and remain masked in Settings. Entries needing headers, bearer/env-header forwarding, `env_vars`, `cwd`, tool filtering, explicit SSE, WebSocket, interpolation, URL credentials/query values/fragments, or other client-specific behavior are rejected rather than changed silently. OAuth login caches, registrations, callback metadata, and cached tokens are never read or copied. Remote servers that require OAuth use a separate browser sign-in in Litespeed.

The picker is available in both the terminal (`/settings` → Integrations) and browser Settings. It supports up to 30 selected servers and 30 saved servers total; duplicate names and capacity limits are shown in the review and skipped. Malformed or unavailable sources are reported independently, so other sources can still be imported. This imports **Claude Code**, not Claude Desktop, and never changes the originals. Review any project-relative commands and paths before enabling an imported server.

MCP connects Litespeed to tools supplied by another process or service. These tools may read or change data outside your project. Configure only commands and endpoints you trust. Tool approval is not a sandbox, and cancellation cannot prove that a remote side effect did not happen.

## Configure, then connect

Type **`/mcp`** in the terminal or browser chat to open Integrations directly, or open **Settings → Integrations**, and edit **MCP servers**. Configuration is a JSON object keyed by a server name:

```json
{
  "local-tools": {
    "command": "/absolute/path/to/mcp-server",
    "args": ["--stdio"],
    "enabled": true
  },
  "remote-tools": {
    "url": "https://your-server.example/mcp",
    "enabled": true
  }
}
```

Use the actual command and arguments from your tool provider. Saving configuration does not start a process, open a network connection, or discover tools. Status reads and model requests do not connect implicitly either.

After saving and reviewing the configuration, choose **Connect** for the server. A successful connection loads its tool catalog. Local servers use stdio; remote servers use Streamable HTTP, with legacy SSE negotiation only when the initial endpoint responds with HTTP 404 or 405. Authentication failures, redirects, and network errors do not trigger fallback. Connecting can itself start trusted executable code or send network requests, before any model tool call.

Changes made in another Settings window cannot be adopted by a status refresh alone. Review the saved configuration explicitly before acting on it. Unsaved MCP JSON must be saved or deliberately discarded before lifecycle actions; status updates do not overwrite the editor or unrelated provider credentials.

## Tool search and TypeScript execution

Connected servers use tool search by default. Their individual schemas stay out of the model's tool array; the agent sees the fixed `capability` interface. No additional switch is needed after connecting a server. A server with `"advertise": true` explicitly opts its tools back into direct advertisement. Plan mode, named profiles, and delegated workers retain their existing MCP restrictions.

TypeScript execution is available in unrestricted Build-mode lead sessions, including LiteFusion. LiteFusion specialists can discover and call tools in their scoped MCP catalog; script execution remains unavailable to delegated workers.

The normal workflow is **search → inspect when needed → execute**:

- `{"operation":"search","query":"drive spreadsheet","limit":5}` searches tool and server names and descriptions in the accepted turn's catalog. It returns only matching names, short descriptions, and TypeScript signatures. Search is local, deterministic, and makes no model or server requests. Use `offset` / `nextOffset` to page through matches; the maximum page size is 10.
- `{"operation":"inspect","name":"<exact name from search>"}` returns the input schema and a TypeScript declaration for one tool. Declarations are hints, not runtime validation: unsupported or recursive schema shapes become `unknown`, and the MCP server validates its inputs.
- `{"operation":"execute","code":"<TypeScript async function body>"}` runs code with `tools["<exact name>"](arguments)`. Only the script's return value and `console.log` / `console.error` output reach the model. The script must await all calls.
- `list` and `call` remain available for browsing and simple single-tool operations. Search and execution are also able to use directly advertised tools when the gateway is present.

For example, after discovering a sheet-reading tool, the body of `code` could be:

```typescript
// Replace the name and arguments with the values returned by search/inspect.
const response = await tools["<exact sheet tool name>"]({ sheetId: "abc123" });
const data = response.structuredContent ?? JSON.parse(response.content[0].text);
const rows = data.rows as { id: string; status: string }[];
const pending = rows.filter(row => row.status === "pending");
return { count: pending.length, firstFive: pending.slice(0, 5) };
```

Tool functions return `{ content: [{ type: "text", text: string }], structuredContent?: object }`. Structured content and full text stay available inside the script up to the 2 MiB response limit. Media and resource bodies remain omitted, and configured credentials and control characters are removed as on the direct path. Unlike model-facing text previews, oversized code responses fail rather than silently truncating data that a later tool might write.

Each invocation gets a fresh QuickJS WebAssembly runtime in a disposable worker. TypeScript is transpiled before running; imports, Node APIs, filesystem access, environment variables, network APIs, and timers are unavailable in the guest. Its only external operations are the connected MCP tool functions. It supports loops, conditionals, filtering, joins, and `Promise.all`, with at most four calls dispatched concurrently.

Limits per script are 64 KiB of source, 50 MCP calls, 1 MiB of arguments per call, 64 MiB of guest memory, a two-second JavaScript execution budget checked cooperatively at QuickJS interrupt points, and 120 seconds of wall time (including worker startup, tool and approval waits). Native built-ins can run between interrupt checks; the wall deadline also terminates the worker if execution does not yield. Returned/logged output is capped at 16 KiB with an explicit truncation notice. For longer tasks, return a small checkpoint and continue in another invocation; the sandbox does not retain state.

Each inner call uses the same frozen tool identity, permission scope, remembered grant, and pre-dispatch catalog checks as a direct MCP call. The user approves the actual tool name and its arguments, never a blanket permission for the script. PreToolUse and PostToolUse hooks run for inner calls as well as the outer capability operation. A denial, failed tool request, stale catalog, or cancellation stops the whole script and cancels outstanding calls. Effects already sent to servers may have completed: scripts are not transactions, and nothing is automatically rolled back or retried.

The tool detail view records each inner tool's name, status, timestamps, and input/output byte counts. Bulk arguments and intermediate results are not copied into model history or these audit records. Explicitly configured hooks can still see call arguments and bounded results. Search reduces schema overhead; code reduces intermediate-data and orchestration overhead. Actual token savings depend on the workflow and are not a fixed percentage.

Run `npm run test:mcp:code` for the built-runtime smoke check. It uses a real local stdio MCP server and a local provider stub, discovers two tools, approves each call, and transfers a 520 KB document while verifying that no intermediate document content enters the model requests. It needs no provider credentials and does not measure provider token costs.

## Browser sign-in

For a remote server that requires OAuth, choose **Sign in** in its integration controls, then **Continue sign-in in your browser** (or **Open sign-in in browser** in the terminal). Complete the provider’s consent screen, return to Litespeed, and choose **Reconnect** to load tools. Importing another client’s configuration never imports its login.

Litespeed discovers the authorization server, registers a public client, and uses an authorization code with PKCE and a state-checked loopback callback. Pending sign-ins expire after 10 minutes and can be cancelled. Configuration changes cancel pending sign-ins; signing into a different account invalidates the previous tool catalog and remembered tool approvals. Servers requiring a pre-registered client rather than dynamic registration are not supported by this flow.

Credentials are stored separately from settings in `mcp-auth.json` in Litespeed’s data directory, with owner-only file permissions. Expiring access tokens are refreshed before requests. **Sign out** removes local credentials and disconnects tools; it does not revoke the provider’s consent grant. A rejected MCP tool call is never replayed after authentication. If authorization has expired or been revoked, sign in again and reconnect.

Connection errors distinguish sign-in required, access denied, DNS failures, refused connections, certificate failures, timeouts, HTTP status failures, and endpoint redirects. Messages omit remote response bodies, credentials, and subprocess output. The terminal’s integration review shows the full message even when the list truncates it.

## Status and explicit actions

- **Disconnected:** configured but not connected, or the connection closed. Use Connect or Reconnect deliberately.
- **Connecting / refreshing:** a lifecycle operation is in progress. It does not make partially discovered tools available.
- **Connected:** the current catalog is available to a new eligible turn.
- **Stale:** the server announced a changed tool list. Use **Refresh tools** to review and adopt the new catalog for future turns. Notifications do not automatically refresh it.
- **Sign-in required:** the server rejected authorization. Choose Sign in, then reconnect after completing browser consent.
- **Error:** discovery or connection failed. Inspect the safe error and retry explicitly after addressing the cause.
- **Disabled:** no tools are available. Enable and save the server configuration before connecting.

**Refresh status** only observes local cached state. **Refresh tools** requests a complete catalog from the existing connection. **Reconnect** closes the previous connection, creates a new one, and discovers its catalog. Neither action replays an earlier model request or tool call. Disable or remove a server in saved configuration to close it.

## A turn keeps the tool identity it saw

At acceptance, a Build-mode turn captures a read-only snapshot of available MCP definitions and their original connections. Plan mode and named project profiles do not capture or advertise MCP tools. Selecting instruction skills alone retains ordinary Build-mode tool policy.

A tool call cannot be redirected to a replacement server merely because it has the same name. Changing configuration, disconnecting, reconnecting, starting a refresh, or receiving a tool-list-change notification invalidates the old snapshot. Litespeed checks it before approval and immediately before dispatch. Stale calls fail without using a replacement connection; review the change and start a new turn when ready.

Remembered approvals bind the workspace, server configuration, and advertised catalog identity. Changing those invalidates the approval. Reconnecting with identical configuration and catalog can retain the remembered permission, but never revives an old turn's connection snapshot. Auto approval does not bypass stale-snapshot checks.

A call already sent may have changed remote data even if its response is lost, cancelled, or interrupted by a connection change. Litespeed does not automatically repeat such calls. Undo/redo restores recorded conversation state, not external effects, and does not call the server again.

## Bounds and lifecycle

Catalog discovery is bounded: up to 20 pages, 1,000 tools, and 1 MiB of validated tool catalog data per server. Duplicate names, malformed schemas, repeated cursors, or exceeded limits reject the catalog rather than silently truncating it. A connection/catalog operation has a total deadline of 30 seconds and individual discovery requests are limited to 15 seconds. Tool calls have a 60-second deadline. Direct calls return at most 100,000 bytes of text; code execution retains up to 2 MiB of sanitized data in its sandbox before the smaller final-output cap. Non-text resource/media bodies are omitted. Individual protocol frames are limited to 2 MiB before parsing. At most eight lifecycle operations run concurrently, with one per server and at most 30 configured servers.

A disconnected lifecycle HTTP request or app shutdown cancels its preparation. A late result cannot publish a catalog after cancellation or replace a newer configuration. Shutdown closes connections and waits for tracked lifecycle cleanup. New server processes require an explicit connection after restarting Litespeed.

## Current scope

Supported workflows are explicit stdio/Streamable HTTP/legacy SSE tool connection, discovery, tool search, TypeScript execution, approval, dispatch, cancellation, status, refresh, and reconnect. Browser OAuth login, PKCE, dynamic public-client registration, and token refresh are supported for remote servers. Resources, prompts, and automatic reconnection are not part of this version. Provider API keys are not forwarded to local MCP subprocesses by the app; configure only the environment entries the tool needs and never place secrets in prompts or share unreviewed configuration exports.

## Approval improvements in 0.1.20

Import can connect selected servers in the same reviewed action. Read-tool grants are explicit and connection-scoped; mutable/unknown tool grants bind exact arguments. Rules can target exact connected tool names. Script execution time excludes approval review. See [permissions](permissions.md).
