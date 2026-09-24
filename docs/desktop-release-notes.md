# Litespeed for Mac — desktop preview 3

[Download for Apple silicon Macs](https://github.com/BerriAI/litespeed/releases/download/desktop-v0.1.23-preview.3/Litespeed-0.1.23-darwin-arm64.dmg) · **Version 0.1.23 · Build 3 · macOS 14 or later**

Open the downloaded disk image, drag **Litespeed** onto **Applications**, then open Litespeed from Applications. Node and the task browser are included.

This preview is locally signed and **not notarized by Apple**. If macOS blocks the first launch, use **System Settings → Privacy & Security → Open Anyway** for Litespeed. See the [installation guide](https://github.com/BerriAI/litespeed/blob/desktop-v0.1.23-preview.3/docs/desktop-macos.md#download-and-install).

## New in this preview

- **Thinking stays where it starts.** Thought process appears in the actual response sequence, whether it begins before the answer, after an initial observation, or between passages of text.
- **Streaming and saved conversations agree.** New responses retain text/thinking transitions through reloads, undo/redo, and export/import. Each thinking section expands independently.
- **Consistent terminal presentation.** The bundled terminal interface uses the same recorded sequence.

Older conversations did not record ordering within each response. They use thinking-before-text within that response; later thinking is not moved above earlier responses or tool calls.

## Update from preview 2

Choose **Help & updates → Check for updates**, then **Update and restart** in the Mac app. The app and its local web server update together to **Build 3**, retaining settings, tasks, and drafts. If work is active, choose **Update when idle**. Browser users can reload their Litespeed page after the Mac app finishes restarting.

Preview 1 users install this DMG once to gain the updater. New installations are ready for subsequent in-app updates.

## Included

- Projects and tasks on the left, a focused conversation, and files, browser, review, and computer views alongside it.
- Persistent file tabs with code, Markdown, image, HTML, and PDF previews; retained reading positions, search, and PDF page/zoom controls.
- A task browser with live previews, tabs, history, downloads, file selection, page comments, inspection, and Find on page.
- Git review, branches, working copies, local scheduled tasks, plugins, and searchable settings.
- Conversation drafts and reading positions that survive task switches, plus compact long messages with Show more.

On first launch, an existing Litespeed setup can be copied into the desktop app's separate data directory. Prompts go to your configured model provider. This desktop preview does not replace the stable terminal release or its updater.

## Preview limits

The download supports Apple silicon. Computer control requires the separately installed Cua Driver and working macOS permissions; actual desktop capture remains experimental. The task browser has its own profile and uses a live preview surface. Schedules require the local server to be running. If you already ran preview 1, finish work and restart your Mac once after installing this DMG. Future updates come through the sidebar and restart only Litespeed. See the [workflow guide and limits](https://github.com/BerriAI/litespeed/blob/desktop-v0.1.23-preview.3/docs/desktop-status.md).

The release includes the DMG installer, an update ZIP, and `desktop-manifest-darwin-arm64.json` with both SHA-256 checksums and byte sizes. No user tasks, provider keys, or browser sign-ins are included in the download.
