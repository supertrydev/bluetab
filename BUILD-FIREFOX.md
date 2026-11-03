# Building Bluetab for Firefox

Notes for Firefox Add-ons (AMO) reviewers and for release builds.

## Requirements

- Linux or macOS (release builds are made on Fedora Linux 44)
- Node.js 22 (see `.nvmrc`; tested with 22.23.1) and npm 10 or later
- `zip` and `git` on the PATH (only for `npm run package:amo`)

## Build

```sh
npm ci
npm run build:firefox
```

The add-on is written to `dist-firefox/`. Its contents are identical to the
uploaded `bluetab-<version>-firefox.zip`.

To produce both upload files (add-on zip and this source zip):

```sh
npm run package:amo
```

## What the build does

- Vite (`vite.config.ts`) bundles and minifies TypeScript/React from `src/`.
  Minification only reduces size; nothing is obfuscated.
- `BLUETAB_BROWSER=firefox` selects the Firefox target. Browser-specific code
  lives in `src/platform/` and is chosen at build time.
- `src/platform/firefox-manifest.ts` turns the Chrome `manifest.json` into the
  Firefox manifest: background event page (`background.scripts`, module),
  `sidebar_action` instead of `side_panel`, `browser_specific_settings.gecko`
  (ID, minimum version 140, `data_collection_permissions`), and removes
  Chrome-only permissions.
- `src/content/brain-dump-modal.ts` is bundled separately by esbuild as a
  classic script (it is injected with `scripting.executeScript`).
- All third-party libraries come from npm at the versions in
  `package-lock.json`, unmodified. No remote code is loaded at runtime.

## Data collection

The free features (saving tabs, groups, Brain Dump, focus tools) work without
an account and send nothing. Signing in to a Supertry account (optional, for
Pro features: sync, sharing, AI) asks for Firefox's built-in data collection
consent first (`authenticationInfo`, `personallyIdentifyingInfo`,
`browsingActivity`, `websiteContent`). Privacy policy:
https://supertry.net/privacy

## Test account

Pro features need a Supertry account. Reviewer credentials are provided in the
AMO "Notes for reviewers" field, not in this file.
