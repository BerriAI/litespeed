# Litespeed for Mac — desktop preview

[Download for Apple silicon Macs](https://github.com/BerriAI/litespeed/releases/download/desktop-v0.1.23-preview.1/Litespeed-0.1.23-darwin-arm64.zip) · **macOS 14 or later**

Unzip the download, move **Litespeed.app** to Applications, and open it. Node and the task browser are included.

This preview is locally signed and **not notarized by Apple**. If macOS blocks the first launch, use **System Settings → Privacy & Security → Open Anyway** for Litespeed. See the [installation guide](https://github.com/BerriAI/litespeed/blob/desktop-v0.1.23-preview.1/docs/desktop-macos.md#download-and-install).

## Included

- Projects and tasks on the left, a focused conversation, and files, browser, review, and computer views alongside it.
- Persistent file tabs with code, Markdown, image, HTML, and PDF previews; retained reading positions, search, and PDF page/zoom controls.
- A task browser with live previews, tabs, history, downloads, file selection, page comments, inspection, and Find on page.
- Git review, branches, working copies, local scheduled tasks, plugins, and searchable settings.
- Conversation drafts and reading positions that survive task switches, plus compact long messages with Show more.

On first launch, an existing Litespeed setup can be copied into the desktop app's separate data directory. Prompts go to your configured model provider. This desktop preview does not replace the stable terminal release or its updater.

## Preview limits

The initial download supports Apple silicon. Computer control requires the separately installed Cua Driver and working macOS permissions; actual desktop capture remains experimental. The task browser has its own profile and uses a live preview surface. Schedules require the local server to be running. When updating the preview, wait for tasks to finish, replace the app, and restart your Mac to restart its background server too. See the [workflow guide and limits](https://github.com/BerriAI/litespeed/blob/desktop-v0.1.23-preview.1/docs/desktop-status.md).

The release includes `desktop-manifest-darwin-arm64.json` with the ZIP's SHA-256 checksum and byte size. No user tasks, provider keys, or browser sign-ins are included in the download.
