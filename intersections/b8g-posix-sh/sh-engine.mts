/**
 * B8G Modern POSIX Shell (`b8g-sh`) — Zero-MSYS2 POSIX `sh`/`bash` + Coreutils
 * + Modern Terminal Protocol Integration (Kitty Graphics `icat`, OSC 133, OSC 7).
 *
 * Runs identically on Windows, Linux, and macOS directly on our shared V8 core.
 */
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodePng } from '../b8g-terminal-chrome/png-decoder.mts';
import { renderAnsiFrame } from '../b8g-terminal-chrome/ansi-shell.mts';
import { renderKittyPng } from '../b8g-terminal-chrome/kitty-shell.mts';

export interface ShContext {
  cwd: string;
  env: Record<string, string | undefined>;
  vars: Map<string, string>;
  lastExit: number;
  stdout: string[];
  stderr: string[];
  /** Force Kitty graphics protocol in `icat` (auto-detected if omitted). */
  forceKitty?: boolean;
}

export function isKittyGraphicsCapable(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(
    env.KITTY_WINDOW_ID ||
      env.GHOSTTY_RESOURCES_DIR ||
      env.WEZTERM_PANE ||
      (env.TERM && /kitty|ghostty|wezterm|rio/i.test(env.TERM)),
  );
}

/** OSC 133 shell integration markers (Kitty, Ghostty, WezTerm, Windows Terminal, iTerm2). */
export const OSC_133 = {
  promptStart: '\x1b]133;A\x07',
  commandStart: '\x1b]133;B\x07',
  outputStart: '\x1b]133;C\x07',
  commandDone: (exitCode: number) => `\x1b]133;D;${exitCode}\x07`,
  osc7Cwd: (cwd: string) => `\x1b]7;${pathToFileURL(cwd).href}\x07`,
};

export function createShContext(opts: { cwd?: string; env?: Record<string, string | undefined>; forceKitty?: boolean } = {}): ShContext {
  const cwd = resolve(opts.cwd ?? process.cwd());
  return {
    cwd,
    env: { ...(opts.env ?? process.env), PWD: cwd },
    vars: new Map<string, string>(),
    lastExit: 0,
    stdout: [],
    stderr: [],
    forceKitty: opts.forceKitty,
  };
}

function getShVar(ctx: ShContext, name: string): string {
  if (name === '?') return String(ctx.lastExit);
  if (name === 'PWD') return ctx.cwd;
  if (ctx.vars.has(name)) return ctx.vars.get(name)!;
  return ctx.env[name] ?? '';
}

function expandString(input: string, ctx: ShContext): string {
  // Command substitution $(...)
  let s = input;
  while (s.includes('$(')) {
    const start = s.indexOf('$(');
    let depth = 0;
    let end = -1;
    for (let i = start + 2; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') {
        if (depth === 0) {
          end = i;
          break;
        }
        depth--;
      }
    }
    if (end === -1) break;
    const innerCmd = s.slice(start + 2, end);
    const subCtx = createShContext({ cwd: ctx.cwd, env: ctx.env, forceKitty: ctx.forceKitty });
    for (const [k, v] of ctx.vars) subCtx.vars.set(k, v);
    runShScript(innerCmd, subCtx);
    const replacement = subCtx.stdout.join('').replace(/\r?\n$/, '');
    s = s.slice(0, start) + replacement + s.slice(end + 1);
  }

  // ${VAR:-default} and ${VAR}
  s = s.replace(/\$\{([A-Za-z_?][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_m, name, defVal) => {
    const v = getShVar(ctx, name);
    return v !== '' ? v : (defVal ?? '');
  });

  // $VAR and $?
  s = s.replace(/\$([A-Za-z_][A-Za-z0-9_]*|\?)/g, (_m, name) => getShVar(ctx, name));
  return s;
}

function tokenizeSh(cmd: string, ctx: ShContext): string[] {
  const tokens: string[] = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  let hasToken = false;

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      hasToken = true;
    } else if (ch === '"' && !inSingle && cmd[i - 1] !== '\\') {
      inDouble = !inDouble;
      hasToken = true;
    } else if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (hasToken) {
        tokens.push(cur);
        cur = '';
        hasToken = false;
      }
    } else if (inSingle) {
      cur += ch;
      hasToken = true;
    } else {
      cur += ch;
      hasToken = true;
    }
  }
  if (hasToken) tokens.push(cur);

  // Expand variables/command-substitutions in unquoted/double-quoted tokens
  return tokens.map((tok) => expandString(tok, ctx));
}

function splitUnquoted(input: string, op: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  let paren = 0;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle && input[i - 1] !== '\\') inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === '(') paren++;
      else if (ch === ')') paren = Math.max(0, paren - 1);
      else if (paren === 0 && input.slice(i, i + op.length) === op) {
        // Avoid splitting `||` when looking for `|`
        if (op === '|' && (input[i + 1] === '|' || input[i - 1] === '|')) {
          cur += ch;
          continue;
        }
        out.push(cur.trim());
        cur = '';
        i += op.length - 1;
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function evalTestBuiltin(args: string[], ctx: ShContext): number {
  const cleaned = args[args.length - 1] === ']' ? args.slice(0, -1) : args;
  if (cleaned.length === 0) return 1;
  if (cleaned.length === 1) return cleaned[0].length > 0 ? 0 : 1;

  if (cleaned.length === 2) {
    const [op, val] = cleaned;
    const p = resolve(ctx.cwd, val);
    switch (op) {
      case '-f':
        return existsSync(p) && statSync(p).isFile() ? 0 : 1;
      case '-d':
        return existsSync(p) && statSync(p).isDirectory() ? 0 : 1;
      case '-e':
        return existsSync(p) ? 0 : 1;
      case '-z':
        return val.length === 0 ? 0 : 1;
      case '-n':
        return val.length > 0 ? 0 : 1;
      case '!':
        return evalTestBuiltin([val], ctx) === 0 ? 1 : 0;
    }
  }

  if (cleaned.length === 3) {
    const [a, op, b] = cleaned;
    switch (op) {
      case '=':
      case '==':
        return a === b ? 0 : 1;
      case '!=':
        return a !== b ? 0 : 1;
      case '-eq':
        return Number(a) === Number(b) ? 0 : 1;
      case '-ne':
        return Number(a) !== Number(b) ? 0 : 1;
      case '-gt':
        return Number(a) > Number(b) ? 0 : 1;
      case '-ge':
        return Number(a) >= Number(b) ? 0 : 1;
      case '-lt':
        return Number(a) < Number(b) ? 0 : 1;
      case '-le':
        return Number(a) <= Number(b) ? 0 : 1;
    }
  }
  return 1;
}

function execSingleCommand(
  rawStage: string,
  stdinText: string,
  ctx: ShContext,
): { stdout: string; stderr: string; exitCode: number } {
  // Handle output redirection (`>> file` or `> file`)
  let stage = rawStage.trim();
  let redirOut: { path: string; append: boolean } | null = null;
  const redirMatch = stage.match(/^(.*?)\s+(>>|>)\s+([^\s]+)$/);
  if (redirMatch) {
    stage = redirMatch[1].trim();
    redirOut = {
      append: redirMatch[2] === '>>',
      path: resolve(ctx.cwd, expandString(redirMatch[3].replace(/^['"]|['"]$/g, ''), ctx)),
    };
  }

  // Handle pure assignment: FOO=bar
  const assignOnly = stage.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (assignOnly) {
    const [, k, vRaw] = assignOnly;
    const unquoted = vRaw.replace(/^['"]|['"]$/g, '');
    ctx.vars.set(k, vRaw.startsWith("'") ? unquoted : expandString(unquoted, ctx));
    return { stdout: '', stderr: '', exitCode: 0 };
  }

  const tokens = tokenizeSh(stage, ctx);
  if (tokens.length === 0) return { stdout: '', stderr: '', exitCode: 0 };

  const cmd = tokens[0];
  const args = tokens.slice(1);
  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  switch (cmd) {
    case 'true':
      exitCode = 0;
      break;
    case 'false':
      exitCode = 1;
      break;
    case 'export':
      for (const a of args) {
        const eq = a.indexOf('=');
        if (eq > 0) {
          const k = a.slice(0, eq);
          const v = a.slice(eq + 1);
          ctx.vars.set(k, v);
          ctx.env[k] = v;
        } else if (ctx.vars.has(a)) {
          ctx.env[a] = ctx.vars.get(a);
        }
      }
      break;
    case 'echo': {
      const noNewline = args[0] === '-n';
      const rest = noNewline ? args.slice(1) : args;
      stdout = rest.join(' ') + (noNewline ? '' : '\n');
      break;
    }
    case 'printf':
      stdout = (args[0] ?? '').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
      break;
    case 'pwd':
      stdout = ctx.cwd + '\n';
      break;
    case 'cd': {
      const target = resolve(ctx.cwd, args[0] || ctx.env.HOME || ctx.env.USERPROFILE || ctx.cwd);
      if (existsSync(target) && statSync(target).isDirectory()) {
        ctx.cwd = target;
        ctx.env.PWD = target;
      } else {
        stderr = `b8g-sh: cd: ${args[0]}: No such directory\n`;
        exitCode = 1;
      }
      break;
    }
    case 'ls': {
      const showAll = args.some((a) => a.startsWith('-') && a.includes('a'));
      const paths = args.filter((a) => !a.startsWith('-'));
      const target = resolve(ctx.cwd, paths[0] || '.');
      const items = readdirSync(target).filter((n) => showAll || !n.startsWith('.'));
      stdout = items.join('\n') + (items.length ? '\n' : '');
      break;
    }
    case 'cat': {
      if (args.length === 0) {
        stdout = stdinText;
      } else {
        stdout = args.map((p) => readFileSync(resolve(ctx.cwd, p), 'utf8')).join('');
      }
      break;
    }
    case 'mkdir': {
      const dirs = args.filter((a) => !a.startsWith('-'));
      for (const d of dirs) mkdirSync(resolve(ctx.cwd, d), { recursive: true });
      break;
    }
    case 'rm': {
      const targets = args.filter((a) => !a.startsWith('-'));
      const force = args.some((a) => a.startsWith('-') && a.includes('f'));
      const rec = args.some((a) => a.startsWith('-') && (a.includes('r') || a.includes('R')));
      for (const t of targets) rmSync(resolve(ctx.cwd, t), { recursive: rec, force });
      break;
    }
    case 'cp': {
      const paths = args.filter((a) => !a.startsWith('-'));
      copyFileSync(resolve(ctx.cwd, paths[0]), resolve(ctx.cwd, paths[1]));
      break;
    }
    case 'mv': {
      const paths = args.filter((a) => !a.startsWith('-'));
      renameSync(resolve(ctx.cwd, paths[0]), resolve(ctx.cwd, paths[1]));
      break;
    }
    case 'touch': {
      for (const f of args) {
        const p = resolve(ctx.cwd, f);
        if (!existsSync(p)) writeFileSync(p, '', 'utf8');
      }
      break;
    }
    case 'head': {
      let n = 10;
      const files: string[] = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '-n' && args[i + 1]) n = Number(args[++i]);
        else if (!args[i].startsWith('-')) files.push(args[i]);
      }
      const txt = files.length ? readFileSync(resolve(ctx.cwd, files[0]), 'utf8') : stdinText;
      stdout = txt.split(/\r?\n/).slice(0, n).join('\n') + '\n';
      break;
    }
    case 'tail': {
      let n = 10;
      const files: string[] = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '-n' && args[i + 1]) n = Number(args[++i]);
        else if (!args[i].startsWith('-')) files.push(args[i]);
      }
      const txt = files.length ? readFileSync(resolve(ctx.cwd, files[0]), 'utf8') : stdinText;
      const lines = txt.replace(/\r?\n$/, '').split(/\r?\n/);
      stdout = lines.slice(-n).join('\n') + '\n';
      break;
    }
    case 'grep': {
      const ignoreCase = args.includes('-i');
      const rest = args.filter((a) => !a.startsWith('-'));
      const pattern = new RegExp(rest[0] || '', ignoreCase ? 'i' : '');
      const txt = rest[1] ? readFileSync(resolve(ctx.cwd, rest[1]), 'utf8') : stdinText;
      const matched = txt.split(/\r?\n/).filter((l) => l.length > 0 && pattern.test(l));
      stdout = matched.length ? matched.join('\n') + '\n' : '';
      exitCode = matched.length > 0 ? 0 : 1;
      break;
    }
    case 'wc': {
      const linesOnly = args.includes('-l');
      const rest = args.filter((a) => !a.startsWith('-'));
      const txt = rest[0] ? readFileSync(resolve(ctx.cwd, rest[0]), 'utf8') : stdinText;
      const lineCount = txt ? txt.replace(/\r?\n$/, '').split(/\r?\n/).length : 0;
      const wordCount = txt.trim() ? txt.trim().split(/\s+/).length : 0;
      stdout = linesOnly ? `${lineCount}\n` : `${lineCount} ${wordCount} ${Buffer.byteLength(txt)}\n`;
      break;
    }
    case 'sort': {
      const reverse = args.includes('-r');
      const rest = args.filter((a) => !a.startsWith('-'));
      const txt = rest[0] ? readFileSync(resolve(ctx.cwd, rest[0]), 'utf8') : stdinText;
      const lines = txt.split(/\r?\n/).filter((l) => l.length > 0).sort();
      if (reverse) lines.reverse();
      stdout = lines.length ? lines.join('\n') + '\n' : '';
      break;
    }
    case 'uniq': {
      const txt = args[0] ? readFileSync(resolve(ctx.cwd, args[0]), 'utf8') : stdinText;
      const lines = txt.split(/\r?\n/).filter((l) => l.length > 0);
      const out = lines.filter((l, i) => i === 0 || l !== lines[i - 1]);
      stdout = out.length ? out.join('\n') + '\n' : '';
      break;
    }
    case 'dirname':
      stdout = dirname(args[0] || '.') + '\n';
      break;
    case 'basename':
      stdout = basename(args[0] || '') + '\n';
      break;
    case 'env':
      stdout = Object.entries(ctx.env)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n') + '\n';
      break;
    case 'test':
    case '[':
      exitCode = evalTestBuiltin(args, ctx);
      break;
    case 'icat': {
      // Modern Kitty Graphics Protocol + Truecolor ANSI image viewer builtin!
      const pngPath = resolve(ctx.cwd, args[0] || '');
      if (!existsSync(pngPath)) {
        stderr = `b8g-sh: icat: file not found: ${args[0]}\n`;
        exitCode = 1;
        break;
      }
      const pngBytes = new Uint8Array(readFileSync(pngPath));
      const useKitty = ctx.forceKitty ?? isKittyGraphicsCapable(ctx.env);
      if (useKitty) {
        stdout = renderKittyPng(pngBytes, { cols: 60, rows: 18 }) + '\n';
      } else {
        const rgba = decodePng(pngBytes);
        stdout = renderAnsiFrame(rgba, { cols: 60, rows: 18, charset: 'halfblock' }) + '\n';
      }
      break;
    }
    default: {
      // External host binary fallback
      const r = spawnSync(cmd, args, {
        cwd: ctx.cwd,
        env: ctx.env,
        input: stdinText || undefined,
        encoding: 'utf8',
        shell: true,
      });
      stdout = r.stdout || '';
      stderr = r.stderr || '';
      exitCode = r.status ?? 0;
      break;
    }
  }

  if (redirOut) {
    if (redirOut.append) appendFileSync(redirOut.path, stdout, 'utf8');
    else writeFileSync(redirOut.path, stdout, 'utf8');
    stdout = '';
  }

  ctx.lastExit = exitCode;
  return { stdout, stderr, exitCode };
}

function evalPipeline(pipeline: string, ctx: ShContext): number {
  const stages = splitUnquoted(pipeline, '|');
  let pipeData = '';
  let lastCode = 0;

  for (const stage of stages) {
    const res = execSingleCommand(stage, pipeData, ctx);
    pipeData = res.stdout;
    if (res.stderr) ctx.stderr.push(res.stderr);
    lastCode = res.exitCode;
  }

  if (pipeData) ctx.stdout.push(pipeData);
  ctx.lastExit = lastCode;
  return lastCode;
}

function evalCompoundLine(line: string, ctx: ShContext): number {
  // Handle single-line `for VAR in ...; do BODY; done`
  const forMatch = line.match(/^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(.+?);\s*do\s+(.+?);\s*done$/);
  if (forMatch) {
    const [, varName, itemsRaw, body] = forMatch;
    const items = tokenizeSh(itemsRaw, ctx);
    let rc = 0;
    for (const item of items) {
      ctx.vars.set(varName, item);
      rc = evalCompoundLine(body, ctx);
    }
    return rc;
  }

  // Handle single-line `if COND; then THEN_BODY [; else ELSE_BODY]; fi`
  const ifMatch = line.match(/^if\s+(.+?);\s*then\s+(.+?)(?:;\s*else\s+(.+?))?;\s*fi$/);
  if (ifMatch) {
    const [, cond, thenBody, elseBody] = ifMatch;
    const condRc = evalCompoundLine(cond, ctx);
    if (condRc === 0) return evalCompoundLine(thenBody, ctx);
    if (elseBody) return evalCompoundLine(elseBody, ctx);
    return 0;
  }

  // Handle `&&` and `||` chains
  let remaining = line.trim();
  let lastRc = 0;
  while (remaining.length > 0) {
    const m = remaining.match(/^(.*?)\s*(&&|\|\|)\s*(.*)$/);
    if (!m) {
      lastRc = evalPipeline(remaining, ctx);
      break;
    }
    const [, left, op, right] = m;
    lastRc = evalPipeline(left, ctx);
    if (op === '&&' && lastRc !== 0) break;
    if (op === '||' && lastRc === 0) break;
    remaining = right;
  }
  return lastRc;
}

export function runShScript(source: string, ctx: ShContext = createShContext()): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const exitMatch = line.match(/^exit(?:\s+(\d+))?$/);
    if (exitMatch) {
      ctx.lastExit = exitMatch[1] ? Number(exitMatch[1]) : ctx.lastExit;
      break;
    }

    // Keep single-line `for ...; do ...; done` and `if ...; then ...; fi` intact
    if (/^(for|if)\s+/.test(line)) {
      evalCompoundLine(line, ctx);
    } else {
      for (const stmt of splitUnquoted(line, ';')) {
        evalCompoundLine(stmt, ctx);
      }
    }
  }

  return {
    stdout: ctx.stdout.join(''),
    stderr: ctx.stderr.join(''),
    exitCode: ctx.lastExit,
  };
}
