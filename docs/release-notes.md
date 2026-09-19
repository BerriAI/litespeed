# Litespeed 0.1.21

Sign in to remote MCP servers, see why a connection failed, and open Integrations with `/mcp`.

- Browser OAuth sign-in, token refresh, and sign-out for remote MCP servers that support dynamic client registration. Imported configurations use a separate Litespeed sign-in.
- Clear connection errors for sign-in requirements, access denied, DNS, refused connections, certificate failures, timeouts, HTTP errors, and redirects.
- `/mcp` opens Integrations directly in the terminal and browser without sending a chat message.
- Paste clipboard images into the terminal with Ctrl+V.

After updating, open `/mcp`, choose **Sign in** for a remote server, complete browser consent, and choose **Reconnect** to load its tools. Servers requiring a pre-registered OAuth client are not supported by this flow.

Includes bundled runtimes and the web/terminal apps for Apple silicon and Intel Macs. Run `litespeed update` and restart after active work finishes.
