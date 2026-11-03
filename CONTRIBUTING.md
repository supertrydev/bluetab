# Contributing to Bluetab

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Reporting bugs and ideas

- **Bug:** [open a bug report](https://github.com/supertrydev/bluetab/issues/new?template=bug.yml). Include the browser and its version, the Bluetab version (shown in `chrome://extensions` or `about:addons`) and the steps to reproduce.
- **Idea:** [suggest a feature](https://github.com/supertrydev/bluetab/issues/new?template=feature.yml).
- **Security problem:** do not open an issue. See [SECURITY.md](SECURITY.md).
- **Account, billing or Pro questions:** support@supertry.net.

## Development setup

Requires Node.js 22 (see `.nvmrc`) and npm 10 or later.

```sh
npm ci
npm run dev             # Chrome build in watch mode → dist/
npm run build           # Chrome  → dist/
npm run build:firefox   # Firefox → dist-firefox/
```

Load the build in Chrome (`chrome://extensions` → Developer mode → Load unpacked → `dist/`) or in Firefox (`about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `dist-firefox/manifest.json`). Use a separate browser profile so your own saved tabs stay untouched.

## Before you open a pull request

Run the same checks as CI:

```sh
npm run ci:turkish && npm run ci:forbidden-words
npm run lint && npm run type-check
npm test -- --runInBand
npm run build && npm run build:firefox && npm run lint:firefox
```

## Branches

- `main` is the version in the Chrome Web Store and Firefox Add-ons. Nobody pushes to it directly.
- `dev` is where work lands. **Open pull requests against `dev`.**
- Name your branch `feat/…`, `fix/…` or `docs/…`.

## Guidelines

- **One codebase, two browsers.** Code that differs between Chrome and Firefox goes in `src/platform/`; check `IS_FIREFOX` from `src/platform/browser-target.ts` instead of sniffing the user agent. If you use a new browser API, check that it exists in Firefox 140 or guard it.
- **User-facing text is English** and goes through i18n (`src/i18n/` for the app, `_locales/` for store texts). Do not hard-code strings in components.
- **Tests:** add or update Jest tests for behaviour you change. Contract tests (`*.contract.test.ts`) pin important behaviour; update them only when the behaviour is meant to change.
- **Privacy:** free features must keep working without an account and without sending data anywhere. Anything that sends data needs a clear user action and must be listed in the privacy policy.
- **No remote code.** Everything the extension runs must ship in the package (store rule for both browsers).
- **Wording:** no medical claims about ADHD; describe what a feature does. The product name is written "Bluetab".
- Keep pull requests small and focused, with a short description of what changed and how you tested it.

## Contributor License Agreement (CLA)

Before we can merge your first pull request, you sign the [Bluetab Contributor License Agreement](CLA.md) once. The CLA Assistant bot comments on your pull request with a link; signing takes one click with your GitHub account.

Why: Bluetab is licensed under the AGPL v3.0. The CLA lets Supertry LLC keep distributing Bluetab in the browser stores and, if needed, offer it under other license terms in the future. You keep the copyright to your contribution.

## License

By contributing, you agree that your contribution is licensed under the [GNU AGPL v3.0](LICENSE) and covered by the [CLA](CLA.md).
