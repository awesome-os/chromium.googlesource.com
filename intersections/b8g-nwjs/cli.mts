#!/usr/bin/env node
/**
 * B8G-NW.js CLI Runner (`.\bin\b8g-nwjs <app-dir|index.html> [--headless]`).
 */
import { app } from '../b8g-electron/index.mts';
import { launchNwApp } from './index.mts';

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
  console.log(`
B8G-NW.js — Mixed-Context NW.js Shell on ONE Shared Sovereign Chromium Core

Usage:
  b8g-nwjs <app-dir | index.html> [--headless]

Example:
  b8g-nwjs intersections/b8g-nwjs/demo-app
`.trim());
  process.exit(0);
}

let target = '';
let headless = false;
for (const a of args) {
  if (a === '--headless') headless = true;
  else if (!a.startsWith('-') && !target) target = a;
}

await launchNwApp(target, { headless });
app.on('window-all-closed', () => process.exit(0));
