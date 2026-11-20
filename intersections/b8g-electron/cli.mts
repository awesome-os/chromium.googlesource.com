#!/usr/bin/env node
/**
 * B8G-Electron CLI Runner (`.\bin\b8g-electron <app-dir|entry.mts>`).
 * Launches an Electron-API app directly on ONE shared sovereign Chromium build.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function printUsage(): void {
  console.log(`
B8G-Electron — Zero-Copy Shared-Chromium Electron Shell (0 MB Duplicate Chromium per App)

Usage:
  b8g-electron <app-dir | main.mts> [--headless]

Examples:
  b8g-electron intersections/b8g-electron/demo-app
  b8g-electron intersections/b8g-electron/demo-app --headless
`.trim());
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
  printUsage();
  process.exit(0);
}

let target = '';
for (const a of args) {
  if (a === '--headless') {
    process.env.B8G_ELECTRON_HEADLESS = '1';
  } else if (!a.startsWith('-') && !target) {
    target = a;
  }
}

if (!target) {
  printUsage();
  process.exit(1);
}

const absTarget = resolve(target);
if (!existsSync(absTarget)) {
  console.error(`[b8g-electron] Entry path not found: ${absTarget}`);
  process.exit(1);
}

let entryFile = absTarget;
if (statSync(absTarget).isDirectory()) {
  const pkgPath = join(absTarget, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    entryFile = resolve(absTarget, pkg.main || 'main.mts');
  } else if (existsSync(join(absTarget, 'main.mts'))) {
    entryFile = join(absTarget, 'main.mts');
  } else {
    entryFile = join(absTarget, 'index.mts');
  }
}

if (!existsSync(entryFile)) {
  console.error(`[b8g-electron] Main script not found: ${entryFile}`);
  process.exit(1);
}

await import(pathToFileURL(entryFile).href);
