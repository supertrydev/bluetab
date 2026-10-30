#!/usr/bin/env node
/**
 * Post-build guard: content scripts (manifest content_scripts and files
 * injected with chrome.scripting.executeScript) run as classic scripts.
 * A top-level `import`/`export` there is a SyntaxError at runtime, which
 * silently broke the Brain Dump shortcut (Alt+Q). Fail the build instead.
 */
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, '../../dist/src/content');
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith('.js')) : [];
if (files.length === 0) {
  console.error('CONTENT-SCRIPTS: no built content scripts found in dist/src/content');
  process.exit(1);
}

const MODULE_SYNTAX = /(^|[;\s}])(import\s*[\w{*$]|import\s*["']|export\s*[{*]|export\s+(default|const|function|class|let|var)\b)/;
const offenders = files.filter((name) => {
  const head = fs.readFileSync(path.join(dir, name), 'utf8').slice(0, 4000);
  return MODULE_SYNTAX.test(head);
});

if (offenders.length > 0) {
  console.error(`CONTENT-SCRIPTS: ES module syntax in classic content scripts: ${offenders.join(', ')}`);
  process.exit(1);
}
console.log(`CONTENT-SCRIPTS OK: ${files.length} classic scripts without module syntax.`);
