# Side panel memory measurement

Build with `npm run build`. Supply an existing `playwright-core` installation and
an unpacked-extension-capable Chromium executable; this script installs nothing:

```bash
PLAYWRIGHT_CORE=/absolute/path/to/node_modules/playwright-core \
CHROMIUM_PATH=/absolute/path/to/chromium \
node scripts/perf/measure-sidepanel-memory.mjs
```

An optional first argument selects a different Chrome build directory. Use a
Chromium distribution that supports `--load-extension` (some branded Chrome
releases disable it). The default is headed Chromium and needs a display, such
as Xvfb on Linux. `HEADLESS=1` requires a Chromium build with extension support
in its full headless mode. Do not point this at your normal browser profile: the
script always creates and removes its own temporary profile.

The fixed fixture is 100 saved tabs in ten expanded groups, with stable IDs,
URLs and timestamps. It opens the extension's side panel HTML as a 400×900 page,
selects Groups, waits for all 100 rows, fonts and animations, forces GC through
CDP, and prints `Runtime.getHeapUsage` as JSON. It closes the browser and removes
the profile even on failure. No account, feeds or remote pages are used. Page
HTTP requests are blocked; Playwright routes do not cover worker requests.

The number is the side panel renderer's JS heap, not total extension/browser
RAM, DOM memory, or the service worker's heap. Opening the HTML directly does
not measure the native side-panel container. Compare the same Chromium and
Playwright versions, OS, build mode, locale and viewport; take the median of at
least five fresh runs. Keep the JSON output with the build revision.

This script was syntax-checked and reviewed but not browser-run in the offline
implementation environment. No memory result is claimed.

## Build size and permissions

Both production builds run `scripts/ci/check-bundle-budget.cjs`. The checked-in
`scripts/ci/bundle-budget.json` records uncompressed total/file sizes and
mandatory/optional permission lists independently for Chrome and Firefox.
Changing a content hash does not reset an asset's budget. Growth over 5%, new
assets, or added permissions fail the build. To accept an intentional change,
review the failed build output and update that target explicitly:

```bash
node scripts/ci/check-bundle-budget.cjs dist --target chrome --update
node scripts/ci/check-bundle-budget.cjs dist-firefox --target firefox --update
```

Review the baseline diff, especially permissions, then rerun both builds. An
update replaces the baseline for that browser only; it does not bypass future
checks. The guard never grants browser permissions.

## Batch C build measurements

Uncompressed bytes from clean production Chrome builds, before/after this
change (same dependencies and build mode):

| Build output | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Shared JS chunk containing i18n (`storage-*.js`) | 939,452 | 179,768 | 80.86% |
| Injected Brain Dump script | 1,240,427 | 13,334 | 98.93% |
| AI-related chunk loaded by worker | 261,529 | 148,495 | 43.22% |
| Worker plus recursively imported static JS chunks | 1,577,107 | 706,663 | 55.19% |
| All `dist/` files | 5,560,766 | 4,367,383 | 21.46% |

The shared chunks include other code, so their sizes are not dictionary-only
or naming-function-only measurements. The full AI service now lives in a
113,407-byte UI chunk absent from the worker graph. Five on-demand locale JSON
files total 790,882 bytes on disk; English remains bundled. These are build
sizes, not runtime heap measurements. The memory harness above remains unrun.
