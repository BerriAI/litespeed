# Desktop release verification

The desktop preview is a portable Apple silicon macOS app. It bundles the local server, Node runtime, production dependencies, and Chromium. The application is locally signed, not Apple-notarized.

## Verified workflows

- Native startup and app-owned WebKit rendering, including the folder-selection bridge.
- Launch from a relocated path containing spaces, with system Node absent from PATH.
- Bundled browser interaction, page search, downloads, server reuse, and rejection of a different saved-data directory.
- Existing settings and task history preserved during desktop migration and package replacement.
- Chrome and WebKit interaction coverage for conversation streaming, drafts, task switching/search, file and PDF previews, browser navigation, and responsive layouts.
- Conversation reading positions through task switches/reloads, long-message disclosures, keyboard focus, and uninterrupted reading during live updates.

The implementation includes unit/API checks for task ownership, stale responses, persisted tabs, uploads/downloads, worktree operations, review actions, schedules, and saved data.

## Preview validation

For the initial September 23, 2026 Apple silicon preview:

- Full unit/API suite: **2,477 passed**, one skipped (165 passing test files).
- Final targeted interaction runs: **19 Chrome** and **21 WebKit** cases passed, covering conversation reading, long prompts, search, streaming, documents, and workspace behavior.
- Type checking and production build passed.
- Portable package and native launch checks passed, including a moved app path, bundled Node/Chromium, browser search/downloads, saved-data identity, and an app-owned WebKit snapshot.
- Dark desktop and narrow light conversation layouts were visually reviewed.

The full browser suites are available below; the counts above describe the final targeted runs, not a claim that every browser test ran for this preview.

## Installer and updater verification

The second desktop preview passed **2,488 unit/API tests** (one skipped), type checking, and the production build. It adds a DMG with a Retina background, aligned app/Applications icons, and persistent Finder window settings. The mounted image is read only; the app’s signature and the Applications shortcut are checked. The installer layout was reviewed from the mounted image’s background, icons, and Finder metadata; this does not claim a direct Finder screenshot.

The updater has focused checks for build ordering, concurrent staging, corrupt archives, unsafe paths/links, pending-state validation, startup locks, failed-launch rollback, and changed app identities. Five interaction cases pass in Chrome and WebKit, including icon replacement, waiting for active work, cancellation, retained drafts after failure, keyboard dismissal, and narrow layouts.

A native update smoke check uses a disposable installation and the real WebKit-to-native restart bridge. It verifies that queued work blocks restart, closes the old app/server, installs the new build, restarts both, keeps the same saved-data identity and settings/task, and produces an app-owned WebKit snapshot after relaunch. No model generation or existing user data is needed for the check.

## Reproduce the checks

```sh
npm ci
npx playwright install chrome webkit
npm run check
npx playwright test
npx playwright test --config playwright.webkit.config.ts
npm run desktop:package
npm run test:desktop-package
```

On a Mac with a desktop session, `LITESPEED_NATIVE_PACKAGE_SMOKE=1 npm run test:desktop-package` also launches the relocated native app and checks its own WebKit snapshot. `npm run test:desktop-update` runs the full native update check on a Mac desktop session. Package smoke uses disposable data and closes only its owned processes.

The release workflow builds terminal archives, desktop ZIPs, and DMG installers on Apple silicon and Intel runners and runs the corresponding package checks before publication. The initial downloadable desktop preview is Apple silicon only.

## Limits of the evidence

App-owned WebKit snapshots do not verify native window chrome, system dialogs, or actual OS shortcut dispatch. Controlled computer-view tests do not prove successful OS capture. Computer control remains dependent on the separately installed driver and working macOS permissions. The [desktop status guide](desktop-status.md#remaining-limits) lists the remaining product gaps; this preview is not a claim of full Codex feature parity.
