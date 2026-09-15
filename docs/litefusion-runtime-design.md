# LiteFusion architecture runtime

LiteFusion remains one selectable architecture alongside Single Model, Sidekick, Team, and Expert. Selecting it loads a complete, versioned policy, including its Opus/high lead. Each architecture retains its own configuration when the user switches. The conversation, workspace, permissions, and project instructions remain session-owned.

## Configuration

- The LiteFusion policy owns the lead route and reasoning. The session model is its compatibility projection, never a second independently selected driver.
- New LiteFusion selections use the research preset. Existing configurations are preserved and clearly identified as custom until the user restores the preset.
- Architecture configurations remember the lead, specialist configuration, reasoning overrides, optional legacy planner/Shunt, and output style. Planner and Shunt are absent from LiteFusion; its task catalog provides planning assistance, reading, and generation.
- Configuration requested during execution is queued and applied only after the active response and its children settle. No worker is silently cancelled or rerouted. A stale request cannot overwrite a newer configuration.
- Normal UI shows the actual lead, policy identity, gateway readiness, and task inspection. Custom routes/handoffs and execution experiments live inside explicit customization/advanced views.

## Task execution

- Task identity, attempts, and worker conversation identity are distinct. Task records persist across root turns, repairs, escalation, and process restarts.
- The lead submits coherent work with a stable workstream, dependencies, acceptance checks, and evidence. The scheduler returns a submission receipt immediately. Results arrive as separate events at valid provider transcript boundaries; submission receipts are immutable.
- Ready tasks run independently. Completed work can unblock dependencies without waiting for unrelated workers. The lead uses an event wait when there is nothing useful to do; token-generating status polling is unnecessary.
- Writers use private source copies. Integration is serialized at root execution boundaries and checks source versions. Failed, cancelled, superseded, or conflicting work is retained for review rather than silently applied.
- Compatible contexts and task workspaces can be reused. Changed policy/tool scope/model/native effort or incompatible workspace state starts a fresh context with portable evidence.
- Only the lead authorizes new scope, helpers, and handoffs. Workers can yield requests; they cannot create recursive worker trees or change budgets/permissions.
- There is no default assignment-count cutoff. Optional experiment limits remain explicit. Automatic concurrency is a resource-admission policy, not a benchmark optimum; the UI reports its source and permits an advanced override.
- Existing no-progress detection, cancellation, permission checks, and request accounting remain in force. An interrupted process never replays model or tool requests automatically.

## Recovery and observability

Explicit provider rejection can use one task-scoped fallback to the configured escalation destination. The availability reason is distinct from task difficulty. Requests on a failed route are avoided for the remainder of the turn. Ambiguous disconnections and lead failures preserve evidence for explicit recovery. The host never invents an unconfigured third route.

The export retains every attempt and records lead wait milliseconds and lead requests made while work is pending. A lead `resolve_task` judgment can unblock prerequisites, but never creates an external evaluation label. The scheduler has no model calls and can be replaced independently of task contracts and UI.

## Validation

Use scripted local providers to verify complete preset selection, architecture round trips, stale/deferred switching, fast-task dependency progress while a slow sibling runs, immutable tool receipts, cancellation, steering/version conflicts, context continuation, restart recovery, and inspection in both clients. Preserve old architecture behavior. Run the full checks and both-architecture release workflow before publication. Live model/Harbor evaluation is left to Devin; this change does not claim measured cost or quality improvement.
