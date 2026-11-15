#!/usr/bin/env node
/**
 * Post-build guard: Chrome extension service workers reject dynamic import()
 * ("import() is disallowed on ServiceWorkerGlobalScope"). Walk the worker's
 * static import graph and fail the build if any reachable chunk still calls
 * import(). Firefox builds use background scripts and are skipped.
 */
const fs = require('fs');
const path = require('path');

const outDir = path.resolve(__dirname, '../..', process.argv[2] || 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
const entry = manifest.background && manifest.background.service_worker;
if (!entry) {
  console.log('WORKER-IMPORTS: no service worker in this build, skipped.');
  process.exit(0);
}

const STATIC_IMPORT = /(?:import|export)\s*(?:[\w$*{}\s,]+from\s*)?["']([^"']+\.js)["']/g;
const DYNAMIC_IMPORT = /\bimport\(\s*["'`]([^"'`]*)/g;

const seen = new Set();
const offenders = [];
const queue = [path.join(outDir, entry)];
while (queue.length > 0) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  const code = fs.readFileSync(file, 'utf8');
  for (const match of code.matchAll(STATIC_IMPORT)) {
    if (match[1].startsWith('.') || match[1].startsWith('/')) {
      const target = match[1].startsWith('/') ? path.join(outDir, match[1]) : path.resolve(path.dirname(file), match[1]);
      if (fs.existsSync(target)) queue.push(target);
    }
  }
  const dynamic = [...code.matchAll(DYNAMIC_IMPORT)].map((match) => match[1] || '(expression)');
  if (dynamic.length > 0) offenders.push(`${path.relative(outDir, file)} -> ${[...new Set(dynamic)].join(', ')}`);
}

if (offenders.length > 0) {
  console.error('WORKER-IMPORTS: dynamic import() is reachable from the service worker:');
  for (const line of offenders) console.error(`  ${line}`);
  console.error('Use a static import in code the service worker loads.');
  process.exit(1);
}
console.log(`WORKER-IMPORTS OK: ${seen.size} files in the service worker graph, no dynamic import().`);
