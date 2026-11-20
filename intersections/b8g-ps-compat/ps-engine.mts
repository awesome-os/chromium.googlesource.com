/**
 * B8G Zero-CLR PowerShell (.ps1) Compatibility Engine (`b8g-ps-compat`).
 *
 * Runs standard PowerShell scripts, object pipelines (`|`), core cmdlets,
 * `$var` / `$env:VAR` expansion, external invocations (`& ...`), and inline
 * `[System.*]::Method(...)` .NET BCL calls directly on V8 (~15 ms cold start,
 * 0 MB .NET Framework / CLR).
 */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { invokeDotNetStatic } from './dotnet-bcl.mts';

export interface PsExecutionContext {
  cwd: string;
  scriptRoot: string;
  vars: Map<string, unknown>;
  env: Record<string, string | undefined>;
  lastExitCode: number;
  stdout: string[];
}

export function createPsContext(opts: { cwd?: string; scriptRoot?: string; args?: string[] } = {}): PsExecutionContext {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const scriptRoot = resolve(opts.scriptRoot ?? cwd);
  const vars = new Map<string, unknown>([
    ['psscriptroot', scriptRoot],
    ['pwd', cwd],
    ['true', true],
    ['false', false],
    ['null', null],
    ['args', opts.args ?? []],
    ['lastexitcode', 0],
  ]);
  return {
    cwd,
    scriptRoot,
    vars,
    env: { ...process.env },
    lastExitCode: 0,
    stdout: [],
  };
}

function splitTopLevel(input: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  let depthParen = 0;
  let depthBrace = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle && input[i - 1] !== '`') inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === '(') depthParen++;
      else if (ch === ')') depthParen = Math.max(0, depthParen - 1);
      else if (ch === '{') depthBrace++;
      else if (ch === '}') depthBrace = Math.max(0, depthBrace - 1);
      else if (ch === sep && depthParen === 0 && depthBrace === 0) {
        out.push(cur.trim());
        cur = '';
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function tokenizeCommand(segment: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  let depthParen = 0;
  let depthBrace = 0;

  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (ch === "'" && !inDouble && depthBrace === 0 && depthParen === 0) {
      inSingle = !inSingle;
      cur += ch;
    } else if (ch === '"' && !inSingle && depthBrace === 0 && depthParen === 0 && segment[i - 1] !== '`') {
      inDouble = !inDouble;
      cur += ch;
    } else if (!inSingle && !inDouble) {
      if (ch === '(') {
        depthParen++;
        cur += ch;
      } else if (ch === ')') {
        depthParen = Math.max(0, depthParen - 1);
        cur += ch;
      } else if (ch === '{') {
        depthBrace++;
        cur += ch;
      } else if (ch === '}') {
        depthBrace = Math.max(0, depthBrace - 1);
        cur += ch;
      } else if (/\s/.test(ch) && depthParen === 0 && depthBrace === 0) {
        if (cur.length > 0) {
          tokens.push(cur);
          cur = '';
        }
      } else {
        cur += ch;
      }
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) tokens.push(cur);
  return tokens;
}

function getVar(ctx: PsExecutionContext, rawName: string): unknown {
  const name = rawName.startsWith('$') ? rawName.slice(1) : rawName;
  if (/^env:/i.test(name)) {
    const key = name.slice(4);
    return ctx.env[key] ?? ctx.env[key.toUpperCase()] ?? '';
  }
  if (name.toLowerCase() === 'lastexitcode') return ctx.lastExitCode;
  if (name.toLowerCase() === 'pwd') return ctx.cwd;
  return ctx.vars.get(name.toLowerCase());
}

function expandDoubleQuoted(str: string, ctx: PsExecutionContext): string {
  return str.replace(/\$([a-zA-Z_][a-zA-Z0-9_:]*)/g, (_m, name) => {
    const val = getVar(ctx, name);
    return val === undefined || val === null ? '' : String(val);
  });
}

export function evalExpr(raw: string, ctx: PsExecutionContext): unknown {
  const s = raw.trim();
  if (!s) return undefined;

  // Parenthesized sub-expression
  if (s.startsWith('(') && s.endsWith(')')) {
    return evalPipeline(s.slice(1, -1), ctx);
  }

  // .NET static method or property: [System.IO.File]::ReadAllText('a.txt') or [System.Environment]::MachineName
  const dnCall = s.match(/^\[([^\]]+)\]::([A-Za-z0-9_]+)\((.*)\)$/s);
  if (dnCall) {
    const [, typeName, methodName, rawArgs] = dnCall;
    const args = rawArgs.trim() ? splitTopLevel(rawArgs, ',').map((a) => evalExpr(a, ctx)) : [];
    return invokeDotNetStatic(typeName, methodName, args);
  }
  const dnProp = s.match(/^\[([^\]]+)\]::([A-Za-z0-9_]+)$/);
  if (dnProp) {
    return invokeDotNetStatic(dnProp[1], dnProp[2], []);
  }

  // Single-quoted literal
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    return s.slice(1, -1).replace(/''/g, "'");
  }

  // Double-quoted interpolated string
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return expandDoubleQuoted(s.slice(1, -1), ctx);
  }

  // Number literal
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    return Number(s);
  }

  // Variable or member access ($var.Prop)
  if (s.startsWith('$')) {
    const parts = s.slice(1).split('.');
    let cur: any = getVar(ctx, parts[0]);
    for (let i = 1; i < parts.length && cur != null; i++) {
      const prop = parts[i];
      const matchKey = Object.keys(cur).find((k) => k.toLowerCase() === prop.toLowerCase());
      cur = matchKey ? cur[matchKey] : cur[prop];
    }
    return cur;
  }

  return s;
}

function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function evalWhereBlock(blockRaw: string, item: any, ctx: PsExecutionContext): boolean {
  const inner = blockRaw.trim().replace(/^\{/, '').replace(/\}$/, '').trim();
  const m = inner.match(/^\$_(?:\.([A-Za-z0-9_]+))?\s+(-eq|-ne|-gt|-ge|-lt|-le|-like|-notlike|-match)\s+(.+)$/i);
  if (!m) return Boolean(item);
  const [, prop, op, rhsRaw] = m;
  let lhs: any = item;
  if (prop && item && typeof item === 'object') {
    const key = Object.keys(item).find((k) => k.toLowerCase() === prop.toLowerCase());
    lhs = key ? item[key] : item[prop];
  }
  const rhs: any = evalExpr(rhsRaw, ctx);
  switch (op.toLowerCase()) {
    case '-eq':
      return String(lhs).toLowerCase() === String(rhs).toLowerCase();
    case '-ne':
      return String(lhs).toLowerCase() !== String(rhs).toLowerCase();
    case '-gt':
      return Number(lhs) > Number(rhs);
    case '-ge':
      return Number(lhs) >= Number(rhs);
    case '-lt':
      return Number(lhs) < Number(rhs);
    case '-le':
      return Number(lhs) <= Number(rhs);
    case '-like':
      return wildcardToRegex(String(rhs)).test(String(lhs ?? ''));
    case '-notlike':
      return !wildcardToRegex(String(rhs)).test(String(lhs ?? ''));
    case '-match':
      return new RegExp(String(rhs), 'i').test(String(lhs ?? ''));
    default:
      return false;
  }
}

function walkFiles(dir: string, recurse: boolean, out: any[] = []): any[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    let size = 0;
    try {
      size = e.isFile() ? statSync(full).size : 0;
    } catch {
      // ignore
    }
    out.push({
      Name: e.name,
      FullName: full,
      Length: size,
      PSIsContainer: e.isDirectory(),
    });
    if (recurse && e.isDirectory()) {
      walkFiles(full, true, out);
    }
  }
  return out;
}

function runCmdlet(cmdRaw: string, rawArgs: string[], input: unknown, ctx: PsExecutionContext): unknown {
  const cmd = cmdRaw.toLowerCase();
  const positional: unknown[] = [];
  const flags = new Map<string, unknown>();

  for (let i = 0; i < rawArgs.length; i++) {
    const tok = rawArgs[i];
    if (tok.startsWith('-') && tok.length > 1 && !/^-\d/.test(tok)) {
      const flagName = tok.slice(1).toLowerCase();
      const next = rawArgs[i + 1];
      if (
        next &&
        !next.startsWith('-') &&
        !['recurse', 'force', 'file', 'directory', 'raw', 'parent', 'leaf', 'sum', 'average', 'descending'].includes(
          flagName,
        )
      ) {
        flags.set(flagName, evalExpr(next, ctx));
        i++;
      } else {
        flags.set(flagName, true);
      }
    } else if (tok.startsWith('{') && tok.endsWith('}')) {
      positional.push(tok);
    } else {
      positional.push(evalExpr(tok, ctx));
    }
  }

  // Cmdlet dispatch
  if (cmd === 'write-output' || cmd === 'echo' || cmd === 'write' || cmd === 'write-host') {
    const val = positional.length === 1 ? positional[0] : positional.join(' ');
    if (cmd === 'write-host') {
      ctx.stdout.push(String(val));
      return undefined;
    }
    return val;
  }

  if (cmd === 'get-location' || cmd === 'pwd') return ctx.cwd;

  if (cmd === 'set-location' || cmd === 'cd') {
    const target = resolve(ctx.cwd, String(positional[0] ?? ctx.cwd));
    ctx.cwd = target;
    ctx.vars.set('pwd', target);
    return undefined;
  }

  if (cmd === 'get-date') return new Date().toISOString();

  if (cmd === 'test-path') {
    const target = resolve(ctx.cwd, String(flags.get('path') ?? positional[0] ?? ''));
    return existsSync(target);
  }

  if (cmd === 'join-path') {
    const base = String(flags.get('path') ?? positional[0] ?? '');
    const child = String(flags.get('childpath') ?? positional[1] ?? '');
    return join(base, child);
  }

  if (cmd === 'split-path') {
    const target = String(flags.get('path') ?? positional[0] ?? '');
    if (flags.get('leaf')) return basename(target);
    return dirname(target);
  }

  if (cmd === 'get-item' || cmd === 'gi') {
    const target = resolve(ctx.cwd, String(flags.get('path') ?? positional[0] ?? ''));
    const st = statSync(target);
    return { Name: basename(target), FullName: target, Length: st.size, PSIsContainer: st.isDirectory() };
  }

  if (cmd === 'get-childitem' || cmd === 'ls' || cmd === 'dir' || cmd === 'gci') {
    const target = resolve(ctx.cwd, String(flags.get('path') ?? positional[0] ?? '.'));
    let items = walkFiles(target, Boolean(flags.get('recurse')));
    if (flags.get('file')) items = items.filter((x) => !x.PSIsContainer);
    if (flags.get('directory')) items = items.filter((x) => x.PSIsContainer);
    if (flags.get('filter')) {
      const rx = wildcardToRegex(String(flags.get('filter')));
      items = items.filter((x) => rx.test(x.Name));
    }
    return items;
  }

  if (cmd === 'get-content' || cmd === 'cat' || cmd === 'gc') {
    const target = resolve(ctx.cwd, String(flags.get('path') ?? positional[0] ?? ''));
    const txt = readFileSync(target, 'utf8');
    return flags.get('raw') ? txt : txt.split(/\r?\n/);
  }

  if (cmd === 'set-content' || cmd === 'sc') {
    const target = resolve(ctx.cwd, String(flags.get('path') ?? positional[0] ?? ''));
    const value = flags.get('value') ?? positional[1] ?? input ?? '';
    writeFileSync(target, Array.isArray(value) ? value.join('\n') : String(value), 'utf8');
    return undefined;
  }

  if (cmd === 'new-item' || cmd === 'ni') {
    const target = resolve(ctx.cwd, String(flags.get('path') ?? positional[0] ?? ''));
    const itemType = String(flags.get('itemtype') ?? 'File').toLowerCase();
    if (itemType === 'directory') {
      mkdirSync(target, { recursive: true });
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, String(flags.get('value') ?? ''), 'utf8');
    }
    return { Name: basename(target), FullName: target };
  }

  if (cmd === 'remove-item' || cmd === 'rm' || cmd === 'del' || cmd === 'ri') {
    for (const p of positional) {
      rmSync(resolve(ctx.cwd, String(p)), {
        recursive: Boolean(flags.get('recurse')),
        force: Boolean(flags.get('force')),
      });
    }
    return undefined;
  }

  if (cmd === 'copy-item' || cmd === 'cp' || cmd === 'copy') {
    const src = resolve(ctx.cwd, String(flags.get('path') ?? positional[0]));
    const dst = resolve(ctx.cwd, String(flags.get('destination') ?? positional[1]));
    copyFileSync(src, dst);
    return undefined;
  }

  if (cmd === 'where-object' || cmd === 'where' || cmd === '?') {
    const arr = Array.isArray(input) ? input : input !== undefined ? [input] : [];
    const block = String(positional[0] ?? '');
    return arr.filter((item) => evalWhereBlock(block, item, ctx));
  }

  if (cmd === 'select-object' || cmd === 'select') {
    let arr = Array.isArray(input) ? [...input] : input !== undefined ? [input] : [];
    if (flags.has('first')) arr = arr.slice(0, Number(flags.get('first')));
    if (flags.has('last')) arr = arr.slice(-Number(flags.get('last')));
    const propSpec = flags.get('property') ?? positional[0];
    if (propSpec) {
      const props = String(propSpec)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      arr = arr.map((obj) => {
        if (!obj || typeof obj !== 'object') return obj;
        const out: Record<string, unknown> = {};
        for (const p of props) {
          const key = Object.keys(obj).find((k) => k.toLowerCase() === p.toLowerCase());
          out[p] = key ? obj[key] : undefined;
        }
        return out;
      });
    }
    return arr;
  }

  if (cmd === 'sort-object' || cmd === 'sort') {
    const arr = Array.isArray(input) ? [...input] : input !== undefined ? [input] : [];
    const prop = String(flags.get('property') ?? positional[0] ?? '');
    const desc = Boolean(flags.get('descending'));
    arr.sort((a, b) => {
      const va = prop && a && typeof a === 'object' ? a[prop] : a;
      const vb = prop && b && typeof b === 'object' ? b[prop] : b;
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return desc ? -cmp : cmp;
    });
    return arr;
  }

  if (cmd === 'measure-object' || cmd === 'measure') {
    const arr = Array.isArray(input) ? input : input !== undefined ? [input] : [];
    const prop = String(flags.get('property') ?? positional[0] ?? '');
    const res: Record<string, unknown> = { Count: arr.length };
    if (flags.get('sum') || flags.get('average')) {
      const nums = arr.map((x) => Number(prop && x && typeof x === 'object' ? x[prop] : x)).filter(Number.isFinite);
      const sum = nums.reduce((a, b) => a + b, 0);
      if (flags.get('sum')) res.Sum = sum;
      if (flags.get('average')) res.Average = nums.length ? sum / nums.length : 0;
    }
    return res;
  }

  // Fallback: execute external command (`& exe args` or bare executable)
  const exe = cmdRaw === '&' ? String(evalExpr(rawArgs[0] ?? '', ctx)) : cmdRaw;
  const exeArgs = (cmdRaw === '&' ? rawArgs.slice(1) : rawArgs).map((a) => String(evalExpr(a, ctx)));
  const r = spawnSync(exe, exeArgs, { cwd: ctx.cwd, env: ctx.env, encoding: 'utf8', shell: true });
  ctx.lastExitCode = r.status ?? 0;
  ctx.vars.set('lastexitcode', ctx.lastExitCode);
  return r.stdout ? r.stdout.trimEnd() : undefined;
}

export function evalPipeline(pipelineRaw: string, ctx: PsExecutionContext): unknown {
  const s = pipelineRaw.trim();
  if (!s || s.startsWith('#')) return undefined;

  // Variable assignment: $x = ... or $env:FOO = ...
  const assign = s.match(/^\$([a-zA-Z_][a-zA-Z0-9_:]*)\s*=\s*(.+)$/);
  if (assign) {
    const [, name, rhs] = assign;
    const val = evalPipeline(rhs, ctx);
    if (/^env:/i.test(name)) {
      ctx.env[name.slice(4)] = String(val ?? '');
    } else {
      ctx.vars.set(name.toLowerCase(), val);
    }
    return undefined;
  }

  const stages = splitTopLevel(s, '|');
  let value: unknown = undefined;

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    // Direct .NET expression or literal/variable when first stage has no cmdlet args
    if (i === 0 && (/^\[[^\]]+\]::/.test(stage) || /^["']/.test(stage) || /^\$/.test(stage))) {
      value = evalExpr(stage, ctx);
      continue;
    }
    const tokens = tokenizeCommand(stage);
    if (tokens.length === 0) continue;
    value = runCmdlet(tokens[0], tokens.slice(1), value, ctx);
  }

  return value;
}

export function runPsScript(source: string, ctx: PsExecutionContext = createPsContext()): {
  results: unknown[];
  stdout: string[];
  exitCode: number;
} {
  const results: unknown[] = [];
  const lines = source.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // Handle `exit <code>`
    const exitMatch = line.match(/^exit(?:\s+(.+))?$/i);
    if (exitMatch) {
      const code = exitMatch[1] ? Number(evalExpr(exitMatch[1], ctx)) : ctx.lastExitCode;
      ctx.lastExitCode = Number.isFinite(code) ? code : 0;
      break;
    }

    for (const stmt of splitTopLevel(line, ';')) {
      const res = evalPipeline(stmt, ctx);
      if (res !== undefined) {
        results.push(res);
      }
    }
  }

  return { results, stdout: ctx.stdout, exitCode: ctx.lastExitCode };
}
