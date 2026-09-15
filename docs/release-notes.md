# Litespeed 0.1.18

MCP integrations are easier to discover and safer to add from existing Claude Code and Codex configuration.

- Connected MCP servers now use tool search by default, keeping large tool catalogs out of the model’s initial context. Build-mode lead sessions can use TypeScript to process MCP results; direct tool advertisement remains an explicit per-server choice.
- In **Settings → Integrations**, the terminal and web picker can explicitly discover and review compatible MCP entries from fixed Claude Code and Codex configuration locations. Choose only the servers you want; imported servers are added to global settings disabled and disconnected, so nothing starts or connects automatically.
- Review and confirmation protect imports with source and saved-configuration validation. Existing names and capacity conflicts are reported and skipped. Commands, arguments, URLs, paths, and environment values stay out of discovery and review screens.
- Static environment values are copied only after confirmation. OAuth cached logins, registrations, callback data, and tokens are not transferred. Entries requiring unsupported authentication or configuration behavior are flagged instead of being changed silently; MCP OAuth sign-in is not supported yet.

After Litespeed 0.1.18 is released, run `litespeed update`, then reopen Litespeed after active work finishes. No session reset is needed.

Includes the terminal runtime and web app for Apple silicon and Intel Macs. Tests use local fixtures and scripted providers; no live account migration or paid model benchmarks were run.
