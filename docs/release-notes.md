# Litespeed 0.1.20

Fewer interruptions, with clearer approval scopes across the browser, terminal, and CLI.

- Researcher, Sidekick, Team, Expert, and LiteFusion handoffs run automatically; worker actions retain the session's permissions and explicit rules.
- New Allow project edits mode, exact-command shell approvals, and opt-in persistent project grants. Saved modes are preserved; legacy broad grant hashes are retired.
- Approval cards show the actual action and scope. Full access moves out of the approval card shortcuts.
- Optional enforced workspace command confinement, shared by foreground commands, verification, and background jobs. No unrestricted fallback.
- Visible project-rule/hook trust and revocation. Plugin hooks install disabled until explicitly reviewed and enabled.
- Reviewed MCP import-and-connect, exact connected-tool rules, scoped MCP grants, and approval-aware script timeouts.
- Automatic stopping of owned jobs, consistent history confirmations, and direct user-requested context compaction.
- Sidekick Fusion remains recommended; LiteFusion remains experimental.

Includes bundled runtimes and the web/terminal apps for Apple silicon and Intel Macs. Run `litespeed update` and restart after active work finishes.
