# Changelog

All notable changes to Bluetab. Versions are the same in the Chrome Web Store
and Firefox Add-ons.

## 1.0.4

Security update, and the first release for Firefox. Same version in both stores.

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
