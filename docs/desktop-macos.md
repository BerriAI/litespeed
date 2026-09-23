# Litespeed for macOS

The desktop shell uses AppKit and WebKit and shares the same local application as the browser interface. It requires macOS 14 or later. The current builds are signed locally; they are not notarized public releases.

## Download and install

1. [Download Litespeed for Apple silicon Macs](https://github.com/BerriAI/litespeed/releases/download/desktop-v0.1.23-preview.1/Litespeed-0.1.23-darwin-arm64.zip). The preview requires macOS 14 or later.
2. Unzip the download and move **Litespeed.app** into Applications.
3. Open Litespeed. Connect your provider, or let it import an existing Litespeed setup.

The preview is locally signed and is **not notarized by Apple**. If macOS prevents the first launch, open **System Settings → Privacy & Security**, find the notice for Litespeed, and choose **Open Anyway**, then confirm opening the app. This applies to this app; no system-wide security change is needed. On managed Macs, your organization's installation policy may apply.

The [release page](https://github.com/BerriAI/litespeed/releases/tag/desktop-v0.1.23-preview.1) includes the ZIP and its SHA-256 manifest. The current downloadable desktop preview is for Apple silicon; the terminal packages also support Intel. Desktop builds for both architectures are part of the release workflow, but an Intel desktop preview is not included in this initial download.

For updates, wait for tasks to finish, quit Litespeed, and replace it with the newer app. Then restart your Mac before reopening Litespeed so its background server also uses the new version. Saved data stays in Application Support. The terminal installation remains separate.

## Portable Mac app

`npm run desktop:package` produces `release-artifacts/portable/Litespeed.app` and a versioned zip archive. The app includes its own Node runtime, production dependencies and Chromium headless shell. It can be moved to another folder without retaining this checkout or installing Node or Chrome. Build on the target Mac architecture; the current verified package is for Apple silicon.

Open the app directly, or copy it to Applications. Saved work lives outside the app bundle, in Application Support. The original terminal installation remains separate. Updating this locally built desktop package means replacing the app; the terminal package updater does not modify a signed desktop bundle.

The zip contains no user configuration, sign-ins or task data. Node is pinned and checked against its published checksum; package dependencies use the lockfile, and browser versions follow the pinned Playwright package. Bundled licenses are retained alongside the runtime and dependencies.

## Build and open

Run `npm run desktop:build` once, then open `release-artifacts/Litespeed.app`. `npm run desktop` rebuilds the development wrapper and opens it. Building requires Apple's Command Line Tools. The development app points at this checkout and its Node runtime; keep the checkout in place.

The app opens its local server at `http://127.0.0.1:3215`. On first launch, it copies a consistent snapshot of existing Litespeed settings, task history, and saved sign-ins into `~/Library/Application Support/Litespeed`. The source is the current checkout's `.litespeed` directory when present, otherwise the packaged installation's `~/.local/share/litespeed-data`. An existing desktop database is never replaced. `LITESPEED_IMPORT_FROM` selects another source when launching from the command line.

The original server and saved data remain independent. Imported tasks are a snapshot, not a live link to another running server. Copied scheduled tasks start paused so both servers cannot launch the same scheduled work automatically. Resume them from Scheduled after switching. Browser tabs and the task browser's signed-in profile are currently separate from the old interface. Before reusing a running server, desktop startup checks the identity of its saved-data directory and refuses a mismatch.

The server stays available after the app window closes or the app quits, so tasks and schedules can continue. Startup failures are shown in the app and recorded in the desktop data directory. `LITESPEED_DATA_DIR` selects another desktop store; the build script's `--data-directory` embeds a specific location into a development wrapper.

## Native integration

- Standard Mac menus, New Task, Settings, task search, project selection, workspace toggle, zoom, fullscreen, and window restoration.
- Native folder selection for projects and file selection for attachments.
- Save dialogs for downloads. Conversation website links open in the task's Browser panel; explicit external-link actions open in the default browser.
- The app exposes a narrow folder-selection bridge only to its own local main frame. External pages cannot use it or replace the app view.

When Files or Browser has focus, Close and Reload apply to the current tab. The View menu offers Previous Tab and Next Tab. Outside these panels, Close and Reload retain their normal window/application behavior.

The right-side task browser remains a live Playwright screenshot surface, with persistent task tabs, retained downloads, find on page and visual page comments. Saved tabs reopen only on request. The portable package uses its bundled Chromium runtime.

Computer control uses a separately installed Cua Driver with Accessibility and Screen Recording permission. It shows one selected window, routes grounded input through normal approvals, and keeps failed captures explicit. Cua Driver is not included in the portable package. Actual OS capture has not been verified for this preview; controlled computer UI tests do not establish that it works on a user’s Mac.

## Verification

`npm run test:desktop` builds the frontend/server and exercises a real isolated launch: importing saved settings/history, serving the UI, and reusing the existing process. Import unit cases cover live SQLite backup, paused copied schedules, file permissions, repeat launches, and unsafe credential-file links.

`npm run test:desktop-package` verifies the zip checksum, moves the signed app to a temporary path containing spaces, and runs its bundled server and browser against disposable data. It checks live browser interaction, page search, a saved download, process reuse and rejection of a different saved-data directory. `LITESPEED_NATIVE_PACKAGE_SMOKE=1 npm run test:desktop-package` also opens the relocated native app, verifies that it starts its bundled server, and records an app-owned WebKit snapshot. It closes only its owned test app/server and removes its temporary data.

`npx playwright test --config playwright.webkit.config.ts` runs browser tests with the WebKit engine. The native wrapper can attach to a disposable fixture with `node scripts/desktop/build.mjs --url http://127.0.0.1:3213`. An attach-only wrapper accepts `--audit-dir /absolute/path` and optional `--audit-command settings` to save its own DOM state and WebKit snapshot for development. These snapshots exclude native title-bar and save/open dialog chrome.

`LITESPEED_DESKTOP_URL` can override the local server address for isolated testing. `LITESPEED_DESKTOP_AUDIT=1` explicitly enables the app-owned audit in a packaged build. Both still restrict the shell to a local HTTP application origin.

Direct OS shortcut dispatch, native dialogs, and window chrome still need verification. App-owned snapshots cover the WebKit content only; DOM readback by itself does not confirm that a backgrounded window has repainted.
