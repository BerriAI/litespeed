# Litespeed 0.1.12

LiteFusion adds one persistent lead with task-specific specialist models and reasoning levels.

- Choose **LiteFusion** in Models or `/models`. It is recommended during new setup; existing architecture selections stay saved.
- Inspect and customize all 63 task cards, their default and shared hard/escalation routes, handoff instructions, and gateway deployment bindings. Compatible serial workers keep their own context; the lead owns assistance, handoffs and final acceptance.
- Parallel workers appear as compact progress rows in the terminal and web app. Open one worker history at a time, inspect earlier attempts, or stop one worker while the others continue. Closing the inspector restores your draft.
- Export reviewed routing policies and per-session evaluation records for Devin. Worker completion, integration, reported costs and external success labels remain separate.
- Mercury Edit 2 and Voyage Code 4 have explicit chat-model fallbacks for version-checked edit suggestions and repository search. Continuous autocomplete and vector indexing are unavailable.

The bundled model roster is an initial research policy. Quality and cost improvements require independent evaluation; this release does not claim measured ROI gains.

Run `litespeed update`, then reopen the terminal UI. Select **LiteFusion** in Models to use it in an existing session. Saved sessions, settings, and keys are preserved.

Packages include Node, Bun, native terminal dependencies, and the web app for Apple silicon and Intel Macs.
