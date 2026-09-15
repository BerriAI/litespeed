# Conversation-first web workspace

The conversation is the main reading surface. The composer stays anchored below it; files, tools, model configuration, and individual workers are accessible without competing with the answer.

## Reference patterns

Reviewed September 14, 2026:

- [Codex app features](https://learn.chatgpt.com/docs/features): a workspace for conversations and coding work, with supporting tools available around the task.
- [Claude Code Desktop](https://code.claude.com/docs/en/desktop): normal conversation view collapses tool calls, background tasks open into a dedicated pane, and model/permission controls sit near the composer.
- ChatGPT's familiar conversation layout informs the centered reading column and anchored composer. This is an independent implementation, not a pixel copy or a claim of identical behavior.

## Decisions

- Use neutral light/dark surfaces, 16px conversation text (15px on small screens), a restrained sidebar, and a rounded composer. Color mainly carries status, errors, and focus.
- Keep one row per logical worker task: task name, current/recent work, model, and reasoning. Clicking it opens one history pane. Stopping a worker is a separate button, never a side effect of selecting it.
- Put routing, context reuse, integration, lead review, and attempt selection under Task details. Activity remains the inspector's primary content. Lead review is separate from external evaluation success.
- At desktop sizes, the inspector sits beside chat. At compact sizes it replaces the visible conversation until Back/Escape; the draft remains mounted and is restored with focus.
- Start with the workspace panel closed. Explicit desktop choices persist across conversations/reloads. Mobile panels start closed and do not overwrite the desktop preference.
- Show LiteFusion by architecture name in the composer, with its lead model beside it. Its model picker offers Lead and specialist policy, not legacy Driver/Planner/Shunt controls.

## Verification

Scripted browser fixtures cover two live workers, one loaded transcript, task details, draft retention, narrow layouts, cancellation, settings, permissions, terminal access, and saved workspace visibility. Visual review includes desktop/mobile conversations and both themes. Local fixtures make no paid model calls.
