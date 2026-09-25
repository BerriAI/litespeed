# Litespeed for macOS

The desktop shell uses AppKit and WebKit and shares the same local application as the browser interface. It requires macOS 14 or later. The current builds are signed locally; they are not notarized public releases.

## Download and install

1. [Download Litespeed for Apple silicon Macs](https://github.com/BerriAI/litespeed/releases/download/desktop-v0.1.23-preview.3/Litespeed-0.1.23-darwin-arm64.dmg). The preview requires macOS 14 or later.
2. Open the `.dmg` and drag **Litespeed** onto the **Applications** shortcut.
3. Open Litespeed from Applications, then eject the disk image.
4. Connect your provider, or let it import an existing Litespeed setup.

The preview is locally signed and is **not notarized by Apple**. If macOS prevents the first launch, open **System Settings → Privacy & Security**, find the notice for Litespeed, and choose **Open Anyway**, then confirm opening the app. This applies to this app; no system-wide security change is needed. On managed Macs, your organization's installation policy may apply.

The [release page](https://github.com/BerriAI/litespeed/releases/tag/desktop-v0.1.23-preview.3) includes the DMG installer, the update ZIP, and their SHA-256 manifest. The current downloadable desktop preview is for Apple silicon; the terminal packages also support Intel. Desktop builds for both architectures are part of the release workflow, but an Intel desktop preview is not included in this initial download.

If you already ran desktop preview 1, finish your work and restart your Mac once after installing this version. Preview 1 did not include the desktop updater, and its background server can outlive the old app. Later updates use the in-app flow below.

## In-app updates

Litespeed checks the official GitHub releases automatically at launch, hourly while open, and when returning to the app after the cached check expires. When a newer desktop build is available, an update icon replaces the question mark at the bottom of the sidebar. You can also choose **Litespeed → Check for Updates** or use **Help & updates**.

Choose **Update and restart** to download, verify, and install it. If work is active, **Update when idle** downloads first and waits. Running tasks, approvals, background commands, workspace operations, queued messages, and open terminals prevent restart. The dialog explains what remains; **Cancel restart** keeps the downloaded update for later. Keep the app open while waiting.

Restart closes both the Mac app and its local server, replaces the app, and reopens them with the same saved data. The updater checks the official archive checksum, bundle identity, build and local code signature, and restores the previous app if the replacement fails to start. Conversations, settings and drafts stay outside the bundle. Updates cannot replace an app on a read-only disk image or in a folder you cannot write to; drag it into Applications first, or use Applications in your home folder.

The first manual install from preview 1 needs the one-time Mac restart described above. Subsequent sidebar updates restart only Litespeed.

## Portable Mac app

`npm run desktop:package` produces `release-artifacts/portable/Litespeed.app` plus a DMG installer and a ZIP used by the updater. The app includes its own Node runtime, production dependencies and Chromium headless shell. It can be moved to another folder without retaining this checkout or installing Node or Chrome. DMG creation uses Python 3 and pinned `dmgbuild` dependencies in a temporary build environment. Build on the target Mac architecture; the current verified package is for Apple silicon.

Open the app directly, or copy it to Applications. Saved work lives outside the app bundle, in Application Support. The original terminal installation remains separate. Desktop updates replace the complete app bundle; the terminal updater remains independent.

The installer and update ZIP contain no user configuration, sign-ins or task data. Node is pinned and checked against its published checksum; package dependencies use the lockfile, and browser versions follow the pinned Playwright package. Bundled licenses are retained alongside the runtime and dependencies.

## Apple-verified downloads

The existing preview 2 download is not notarized. The warning “Apple could not verify Litespeed is free of malware” means Gatekeeper cannot verify this release through Apple. A local signature does not identify a verified publisher. Follow the first-launch instructions above only for a download you trust from this repository.

Warning-free distribution requires an Apple Developer Program membership, a **Developer ID Application** certificate with its private key, and access to Apple's notarization service. A development certificate or Mac App Store distribution certificate does not work for this download.

The packaging script supports Developer ID signing and notarization. It signs all bundled native code, including Node, Bun, Chromium and native modules, with a secure timestamp and hardened runtime, then signs the outer app. Generated-code entitlements apply only to bundled executable runtimes. It submits the app to Apple, attaches and validates its ticket, creates the update ZIP and DMG from that app, then signs and notarizes the DMG. The final hashes include the tickets. Gatekeeper assessment must pass before a notarized manifest is produced.

For a local release, import the certificate into Keychain Access and store notarization credentials in a `notarytool` Keychain profile. Set `LITESPEED_SIGNING_IDENTITY` to the certificate identity or fingerprint, `LITESPEED_NOTARY_PROFILE` to that profile name, and `APPLE_TEAM_ID` to the ten-character team ID. Set `LITESPEED_SIGNING_KEYCHAIN` if using a separate keychain, then run `npm run desktop:package`. Incomplete signing configuration fails instead of producing a local-signature fallback. Without signing configuration, development builds remain explicitly unnotarized.

For GitHub Actions, a repository administrator must add these **Actions secrets** under the repository's Settings → Secrets and variables → Actions. Do not put private keys or passwords in source control or chat.

| Secret | Value |
| --- | --- |
| `APPLE_DEVELOPER_ID_P12_BASE64` | Base64-encoded `.p12` export of the Developer ID Application certificate and private key |
| `APPLE_DEVELOPER_ID_PASSWORD` | Password protecting that `.p12` export |
| `APPLE_TEAM_ID` | Apple Developer team ID |
| `APPLE_NOTARY_KEY_ID` | App Store Connect team API key ID with access to notarization |
| `APPLE_NOTARY_ISSUER_ID` | Issuer ID for that API key |
| `APPLE_NOTARY_KEY_P8_BASE64` | Base64-encoded `.p8` private key |

Run the **macOS release** workflow manually with **notarize** enabled to produce verified artifacts for both architectures. This manual run does not publish a release. Credentials are imported into a temporary keychain and removed after packaging, including on failure. Pull request builds do not receive signing credentials. Tag-triggered public releases and `[release]` main commits require notarization and refuse to publish unnotarized desktop manifests.

Before publishing the first verified desktop download, increment `desktopBuild`, use a new release tag, and verify both the native app and its bundled browser from the signed package. Never replace the existing preview assets: the updater needs a newer build and matching final checksums. Update the README download link and release notes only once the new release is available. This setup alone does not remove the warning from the already published preview.

See Apple's [notarization requirements](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

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

`npm run test:desktop-package` verifies the zip checksum, checks the DMG and its Applications shortcut, moves the signed app to a temporary path containing spaces, and runs its bundled server and browser against disposable data. It checks live browser interaction, page search, a saved download, process reuse and rejection of a different saved-data directory. `LITESPEED_NATIVE_PACKAGE_SMOKE=1 npm run test:desktop-package` also opens the relocated native app, verifies that it starts its bundled server, and records an app-owned WebKit snapshot. It closes only its owned test app/server and removes its temporary data.

`npx playwright test --config playwright.webkit.config.ts` runs browser tests with the WebKit engine. The native wrapper can attach to a disposable fixture with `node scripts/desktop/build.mjs --url http://127.0.0.1:3213`. An attach-only wrapper accepts `--audit-dir /absolute/path` and optional `--audit-command settings` to save its own DOM state and WebKit snapshot for development. These snapshots exclude native title-bar and save/open dialog chrome.

`LITESPEED_DESKTOP_URL` can override the local server address for isolated testing. `LITESPEED_DESKTOP_AUDIT=1` explicitly enables the app-owned audit in a packaged build. Both still restrict the shell to a local HTTP application origin.

Direct OS shortcut dispatch, native dialogs, and window chrome still need verification. App-owned snapshots cover the WebKit content only; DOM readback by itself does not confirm that a backgrounded window has repainted.

`npm run test:desktop-update` verifies a real native upgrade using a disposable installed copy, queued-work blocking, app/server replacement, retained saved data, and an app-owned WebKit snapshot after relaunch. It never updates the user’s installed app.
