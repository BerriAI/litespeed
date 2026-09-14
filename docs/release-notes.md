# Litespeed 0.1.15

LiteFusion is now a complete architecture with an Opus/high lead, asynchronous specialists, and a quieter web workspace.

- Switch between LiteFusion, Single Model, Sidekick, Team, and Expert. Each architecture remembers its own model arrangement. LiteFusion has one Lead setting; unrelated Driver, Planner, and Shunt controls are removed from its setup.
- The lead can continue useful work while specialists run. The host schedules dependencies and waits for events without model polling. Task identities, attempts, and private workspaces survive continuation and escalation; interrupted work is never replayed automatically.
- Explicit provider failures can switch a worker once to its configured escalation route, preserving partial work and recording the availability reason. Lead failures remain visible and require recovery; there is no silent lead replacement.
- Web chat has larger text, neutral light/dark themes, a simpler composer, compact worker activity, and one history inspector. Task details and attempt history expand on demand. The file panel remembers your choice across conversations and reloads.
- Both clients keep all 63 task cards and per-task handoffs available for customization. Concurrency defaults to host capacity; there is no default assignment-count cutoff. Advanced experiment overrides remain available.
- Changes requested during a response apply after active work settles. Worker cancellation, version-checked integration, stale settings protection, retained reports, and export accounting remain explicit.
- `/new` is the visible new-session command. `/clear` and `/reset` remain compatible aliases without duplicate menu entries.

Run `litespeed update`, then reopen Litespeed. In Models, select **LiteFusion**. Existing custom LiteFusion sessions preserve their lead: choose **Restore preset** to load the recommended Opus/high setup. Check the model IDs available on your gateway.

The model roster remains a research policy awaiting independent evaluation. No measured cost or quality improvement is claimed. Devin exports include task attempts, reported costs, lead wait time, and external evaluation labels separately.

Packages include the terminal runtime and web app for Apple silicon and Intel Macs.
