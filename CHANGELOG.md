# Changelog

All notable changes to Bluetab. Versions are the same in the Chrome Web Store
and Firefox Add-ons.

## 1.0.7

- Teams no longer reopens shared tabs that are still loading or have been
  redirected when a participant's browser tab group is missing.
- Smart Group Naming (Pro) names unnamed groups as soon as it is on, without
  waiting for the one-time AI notice. Its setting explains that tab titles
  and addresses are sent to Bluetab AI.
- Creating a GitHub issue in a repository outside your connected list always
  asks for confirmation, even with "Always allow" on or an empty connected list.
- Deleting groups in the manager, popup or side panel, including bulk deletion,
  offers Undo for 10 seconds. Undo restores their position, Group Memory and pins.
- Automatic backup is on by default and runs monthly; existing explicit choices
  are kept. Snapshots include saved groups, tags, projects, Brain Dump notes and
  archives. Password-protected archives stay encrypted. Of the ten snapshots
  kept, the newest three retain saved data; older snapshots keep windows only.
  Restoring merges saved data, preserving newer records absent from the backup,
  and older window-only backups still work. Settings show the last backup time.
- A one-time notice explains why a restored group leaves the saved list when
  Group Memory is on, and how saving its open tabs brings it back to the same
  group. The notice closes after 30 seconds or when dismissed.
- Bluetab bundles English as a fallback and loads your selected language from
  packaged locale files on demand, instead of loading all six languages.
- The Brain Dump shortcut script receives its translations from the worker,
  shrinking from about 1.24 MB to 13 KB. The worker uses a separate group-naming
  module, so it no longer loads the full AI service.
- Background alarms run only when their features need them, including the
  one-minute sync poll only after sync is set up. A fresh install keeps only
  monthly backup and kill-switch refresh alarms, avoiding minute-by-minute wakes.
- Both builds check bundle sizes and permissions against reviewed baselines,
  catching unexpected growth, new assets and added permissions.
- A repeatable memory measurement script uses a fixed 100-tab fixture. With
  that fixture in headless Chromium, side panel JavaScript heap fell from
  7.54 MiB in 1.0.6 to 6.23 MiB; this measures the panel heap, not total browser RAM.
- Help → Changelog shows only the latest version with four short notes and a
  link to previous releases. Full release notes remain here and on GitHub.

## 1.0.6

- The onboarding wizard opens the side panel as you reach its introduction.
- Creating browser tab groups can recover if the browser changes the group ID.
  Opera requires at least two tabs for a new browser group.
- The Help page opens the GitHub bug and feature request forms directly.
- The ChatGPT setup guide shows how to connect Bluetab from the ChatGPT directory.
- Chrome and Firefox add-on ZIPs use a stable file order and timestamps.
- Sync requires a sync password on every device. Devices using legacy sync
  can disconnect and start fresh from Sync settings while keeping local data.
- Pro integrations no longer fail when an expired token is refreshed from a
  background action (for example a right-click send). The service worker
  loads no code through dynamic import, and the build checks it.

## 1.0.5

The first release for Firefox, and the next Chrome Web Store update after
1.0.3. It includes everything in 1.0.4 (below), which was not published to the
stores.

**Security**
- Teams no longer puts your session token in the WebSocket URL
  (`/ws/teams/<code>?token=…`). The token travels as a WebSocket subprotocol
  (`bluetab.v1, bluetab.auth.<base64url>`); the server answers with
  `bluetab.v1` only. Needs the Teams server from supertry.net with
  subprotocol support (older servers reject 1.0.5 Teams connections).

**Fixes**
- Settings → About shows the installed version (it showed 1.0.3).
- The Help page changelog lists 1.0.3 and 1.0.5.

## 1.0.4

Security update (git tag `v1.0.4`, not published to the stores; shipped as part
of 1.0.5).

**Security**
- Sync no longer puts your session token in the event stream URL
  (`/api/sync/events?token=…`), where server and proxy logs could record it.
  The token now travels only in the `Authorization` header.
- Updated DOMPurify to 3.4.17, which fixes several sanitizer bypasses. Bluetab
  uses DOMPurify to clean page content before AI summaries.
- Updated Zod, the AI SDK, nanoid, PostCSS and other dependencies with
  published security advisories. `npm audit` reports no known
  vulnerabilities, in shipped code or in the build tools.
- Build tools: Vite 7 (was 4), ESLint 9 (was 8) with typescript-eslint 8.
  Removed the shadcn CLI from the project dependencies (run it with `npx`).

**Firefox (first release)**
- Firefox 140 or later (desktop). The side panel is a Firefox sidebar; the
  toolbar button opens and closes it.
- Signing in asks for Firefox's built-in data collection consent first.
- Notification sounds and page summaries run without Chrome's offscreen API.
- Permission prompts (sites, bookmarks, history) open reliably in Firefox.
- A link opened in a new tab is no longer mistaken for an empty new tab when
  the custom new tab page is on.

## 1.0.3

First public release of the source code (git tag `v1.0.3`). Matches the
Chrome Web Store package.

- Import keeps OneTab titles intact and reads Session Buddy JSON exports.
- Import reads workspace exports that contain collections of cards.
- Sync asks for a device name when a browser joins, and recognizes Brave,
  Edge, Opera and Vivaldi.
- Bluetab AI shows a one-time notice about what it sends before the first
  request.
- Bluetab AI can act in connected apps and always asks before an outward
  action.
- The Help page lists support@supertry.net.
- An optional one-question survey opens after uninstalling.
- The review prompt opens the current Chrome Web Store reviews page.
- Store builds no longer include debug logging.
- The product name is spelled "Bluetab" everywhere in the interface.
