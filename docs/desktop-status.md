# Litespeed desktop

A Mac app with a quiet conversation, projects and tasks on the left, Settings at the bottom left, and a persistent workspace on the right. See the workflow coverage and preview limits below.

## Open it

[Download the desktop preview](https://github.com/BerriAI/litespeed/releases/download/desktop-v0.1.23-preview.2/Litespeed-0.1.23-darwin-arm64.dmg), open the disk image, and drag **Litespeed** onto **Applications**. See [first-launch instructions](desktop-macos.md#download-and-install). It includes Node and its task browser, so those do not need separate installation. This build requires Apple silicon and macOS 14 or newer. It is signed locally and is not notarized.

On first launch, the app copies existing Litespeed settings and tasks into its own saved data. The original installation stays independent. If no connection is configured, setup guides you through a provider and model. See [Mac app details](desktop-macos.md) for migration and packaging details.

Settings opens on General, with appearance, notifications and new-task defaults in compact rows. Manage providers from the model picker opens the connection page directly. Settings search jumps to the matching control and keeps unsaved changes as you browse.

## Available workflows

| Area | What works |
| --- | --- |
| Conversation | Streaming responses, approvals and questions, persistent drafts and reading positions, expandable long prompts, attachments, queued messages, steering, stop, fork, archive, import/export, task search, and jumping to matching messages. |
| Projects | Folder selection, grouped tasks, branches, isolated working copies, reviewed copies of local edits/setup files, task continuation into a worktree or back into a local branch, and worktree removal/restoration. |
| Files | Persistent tabs, source highlighting, line links, wrapping, find in file, retained reading positions, automatic refresh after file activity or returning to the app, Markdown/HTML/image/PDF previews, and snapshot attachments. File views are read only. |
| Browser | Task-owned tabs, live previews, direct interaction, find on page, navigation, history, saved tabs, downloads, reviewed file selection, page comments, element/style inspection, console/network details, and opening conversation links beside the task. |
| Review | Working/staged/branch/task diffs, line feedback, stage/unstage, commit, reviewed push, recoverable discard, protected undo/redo, and pull-request review in a separate working copy. |
| Setup | Provider/model setup, full-page searchable Settings, permissions, project profiles and skills, plugins, connected tools, and local scheduled tasks. |
| Desktop | Mac menus, native folder/file pickers, downloads, window restoration, a drag-to-Applications installer, in-app updates with idle checks and rollback, a bundled runtime, and independent saved data. |

Use **⌘K** for commands, **⌘⇧F** to search tasks, **⌘⇧B** to open Browser, and **⌘F** in Files or Browser to find text. Browser and file activity can open the appropriate workspace view automatically; the Follow agent activity control lets you manage that behavior.

With focus in Files or Browser, **⌘W** closes the current tab and **⌘R** refreshes it. **Control Tab** and **Control Shift Tab** move between open tabs; **⌘⇧]** and **⌘⇧[** do the same. The Mac View menu also offers Next Tab and Previous Tab. File tabs retain their reading positions as you switch.

Open files refresh as file-changing tools finish and when you return to the app or workspace panel. This also works with Follow agent activity off. Background refresh keeps your draft, focus, file search and reading position; other open files refresh when selected. Unchanged images and PDFs keep their loaded preview.

Browser search highlights page text, shows match counts and supports case matching. Enter and Shift Enter move between matches; Escape closes search and returns focus to the page. Each live browser tab keeps its own result. Search excludes form values and stays within the current task’s browser.

PDFs have a compact page selector, previous/next controls, zoom and Fit to width. Their text is selectable. Each document retains its page, reading position and zoom through tab changes, reloads, workspace resizing and file updates.

## Remaining limits

- Real computer control needs a separately installed Cua Driver and working OS capture. Actual OS capture has not been verified for this preview. Controlled computer-view tests do not prove actual desktop capture.
- The task browser is a live screenshot surface. It uses its own profile; full CDP/performance tools and a regular-browser extension are not included.
- Moving tasks between folders copies work onto a fresh branch. Exact same-branch handoff and automatic worktree cleanup are not implemented.
- Native launches and app-owned WebKit rendering have dedicated package checks. Actual OS dialogs, window chrome and native shortcut dispatch still need direct verification.
- The old desktop preview 1 needs one manual install and Mac restart to gain in-app updates. Later sidebar updates restart the app and server automatically.
- Scheduled work requires the local server to remain running. Search is bounded to 50 task results and the first 16 KiB of each indexed message part. Find in file highlights up to 1,000 matches in the loaded preview. Find on page searches up to 1,000 matches across 50 frames, with 50,000 nodes and 2 million characters per frame; partial searches are marked.

The [release verification record](desktop-delivery.md) describes the checked workflows and remaining limits.

Browser, file, task-switching and setup workflows have been checked in Chrome and WebKit. Package checks launch the app from a relocated folder and exercise its included browser and native rendering. The verification guide lists the checked workflows and the boundaries of those checks.
