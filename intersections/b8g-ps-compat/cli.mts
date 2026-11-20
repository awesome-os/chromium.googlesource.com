#!/usr/bin/env node
/**
 * B8G Zero-CLR PowerShell CLI (`.\bin\b8g-pwsh`).
 * Drop-in compatibility runner for `.ps1` scripts and `-Command` expressions
 * directly on V8 with 0 MB .NET Framework / CLR.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createPsContext, runPsScript } from './ps-engine.mts';

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
  console.log(`
B8G Zero-CLR PowerShell + .NET BCL Compatibility Runtime (0 MB .NET Framework)

Usage:
  b8g-pwsh -Command "<ps1 expression>"
  b8g-pwsh -File <script.ps1> [args...]
  b8g-pwsh <script.ps1> [args...]
`.trim());
  process.exit(0);
}

let script = '';
let scriptRoot = process.cwd();
let scriptArgs: string[] = [];

if (args[0] === '-Command' || args[0] === '-c') {
  script = args.slice(1).join(' ');
} else if (args[0] === '-File' || args[0] === '-f') {
  const p = resolve(args[1]);
  script = readFileSync(p, 'utf8');
  scriptRoot = dirname(p);
  scriptArgs = args.slice(2);
} else {
  const p = resolve(args[0]);
  script = readFileSync(p, 'utf8');
  scriptRoot = dirname(p);
  scriptArgs = args.slice(1);
}

const ctx = createPsContext({ cwd: process.cwd(), scriptRoot, args: scriptArgs });
const out = runPsScript(script, ctx);

for (const line of out.stdout) console.log(line);
for (const val of out.results) {
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    console.log(val);
  } else {
    console.log(JSON.stringify(val, null, 2));
  }
}
process.exit(out.exitCode);
