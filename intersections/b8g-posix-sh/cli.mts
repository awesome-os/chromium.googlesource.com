#!/usr/bin/env node
/**
 * B8G Modern POSIX Shell CLI (`.\bin\b8g-sh`).
 *
 * Supports:
 *   - `b8g-sh -c "<posix command>"`
 *   - `b8g-sh <script.sh>`
 *   - `b8g-sh` (interactive Truecolor REPL with OSC 133 + OSC 7 + Kitty `icat` builtin)
 */
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { createShContext, OSC_133, runShScript } from './sh-engine.mts';

const args = process.argv.slice(2);

if (args.includes('-h') || args.includes('--help')) {
  console.log(`
B8G Modern POSIX Shell (b8g-sh) — Zero-MSYS2 POSIX sh + Kitty/OSC133/OSC7

Usage:
  b8g-sh                     # Interactive Truecolor REPL (OSC 133 + OSC 7 + icat)
  b8g-sh -c "<command>"      # Execute POSIX shell command
  b8g-sh <script.sh>         # Execute POSIX shell script

Modern Builtins:
  icat <file.png>            # Inline Kitty Graphics Protocol (or 24-bit ANSI fallback)
`.trim());
  process.exit(0);
}

const ctx = createShContext({ cwd: process.cwd() });

if (args[0] === '-c') {
  const res = runShScript(args.slice(1).join(' '), ctx);
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  process.exit(res.exitCode);
}

if (args.length > 0 && !args[0].startsWith('-')) {
  const script = readFileSync(resolve(args[0]), 'utf8');
  const res = runShScript(script, ctx);
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  process.exit(res.exitCode);
}

// Interactive modern REPL with OSC 133 + OSC 7 for Kitty / Ghostty / WezTerm / Windows Terminal
const rl = createInterface({ input: process.stdin, output: process.stdout });
const prompt = () => {
  const osc = `${OSC_133.osc7Cwd(ctx.cwd)}${OSC_133.promptStart}`;
  rl.setPrompt(`${osc}\x1b[38;2;110;215;255mb8g-sh\x1b[0m \x1b[38;2;120;245;175m${ctx.cwd}\x1b[0m $ ${OSC_133.commandStart}`);
  rl.prompt();
};

prompt();
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (trimmed === 'exit' || trimmed === 'quit') {
    rl.close();
    process.exit(ctx.lastExit);
  }
  ctx.stdout.length = 0;
  ctx.stderr.length = 0;
  if (trimmed) {
    process.stdout.write(OSC_133.outputStart);
    const res = runShScript(trimmed, ctx);
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    process.stdout.write(OSC_133.commandDone(res.exitCode));
  }
  prompt();
});
