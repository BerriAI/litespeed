# Workspace command confinement

Implemented in 0.1.20; off by default. Enable per session in Settings → Permissions → Project access. It applies to model-initiated bash, verification, and background jobs. User terminals, configured hooks, sidecars, and MCP servers have separate authority.

macOS uses `/usr/bin/sandbox-exec` with a deny-by-default Seatbelt profile. Linux uses `/usr/bin/bwrap` with separate namespaces and only explicit filesystem mounts. Workspace files and a private temporary home are writable; system/runtime resources are read-only. Credentials, app state, and Git metadata writes are protected. Existing protected symlinks and ordinary hard-linked files are refused. Large workspaces beyond the validation bound are refused.

Network access to the host is unavailable. The environment contains a limited runtime PATH and private HOME/TMPDIR rather than inherited secrets. macOS reads standard system libraries and tools; Linux mounts standard runtime directories. Dependencies outside those locations or the workspace may require explicit unrestricted access.

The backend must actually start successfully. Missing binaries, denied namespaces, invalid profiles, or unavailable paths produce an error without running an unrestricted fallback. `sandbox:"off"` requests normal unrestricted approval and has a separate remembered scope. Full access remains a broad user opt-in.

This is filesystem/network confinement, not resource virtualization or a promise against OS vulnerabilities. Development servers needing network sockets, package downloads, and tools needing external caches can require a broader scope. Linux masks existing protected files; macOS also denies matching protected names created after launch. An untrusted local process already running outside Litespeed is outside this boundary.

Native macOS CI exercises workspace writes, denied outside reads/writes, protected files, and host-network denial. Release smoke additionally exercises the installed bundle's own Node runtime under confinement.
