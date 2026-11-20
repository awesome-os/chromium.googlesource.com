/**
 * Zero-CLR .NET Base Class Library (BCL) Static Projection.
 *
 * Implements the most-used `[System.*]::Method(...)` and `[math]::Method(...)`
 * calls directly on Node/V8 with 0 MB .NET Framework / CLR overhead.
 */
import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { cpus, hostname, platform, release } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';

export function invokeDotNetStatic(typeNameRaw: string, memberRaw: string, args: unknown[]): unknown {
  const type = typeNameRaw.trim().toLowerCase().replace(/^system\./, '');
  const member = memberRaw.trim().toLowerCase();

  if (type === 'io.file') {
    switch (member) {
      case 'readalltext':
        return readFileSync(String(args[0]), 'utf8');
      case 'writealltext':
        writeFileSync(String(args[0]), String(args[1] ?? ''), 'utf8');
        return undefined;
      case 'exists':
        return existsSync(String(args[0]));
      case 'delete':
        rmSync(String(args[0]), { force: true });
        return undefined;
      case 'copy':
        copyFileSync(String(args[0]), String(args[1]));
        return undefined;
    }
  }

  if (type === 'io.directory') {
    switch (member) {
      case 'exists':
        return existsSync(String(args[0]));
      case 'createdirectory':
        mkdirSync(String(args[0]), { recursive: true });
        return { FullName: resolve(String(args[0])) };
      case 'getfiles':
        return readdirSync(String(args[0]), { withFileTypes: true })
          .filter((e) => e.isFile())
          .map((e) => join(String(args[0]), e.name));
      case 'getdirectories':
        return readdirSync(String(args[0]), { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => join(String(args[0]), e.name));
    }
  }

  if (type === 'io.path') {
    switch (member) {
      case 'combine':
        return join(...args.map(String));
      case 'getfilename':
        return basename(String(args[0]));
      case 'getdirectoryname':
        return dirname(String(args[0]));
      case 'getextension':
        return extname(String(args[0]));
      case 'getfullpath':
        return resolve(String(args[0]));
    }
  }

  if (type === 'math') {
    const a = Number(args[0]);
    const b = Number(args[1]);
    switch (member) {
      case 'round': {
        const digits = Number.isFinite(b) ? Math.max(0, Math.floor(b)) : 0;
        const factor = 10 ** digits;
        return Math.round(a * factor) / factor;
      }
      case 'floor':
        return Math.floor(a);
      case 'ceiling':
        return Math.ceil(a);
      case 'abs':
        return Math.abs(a);
      case 'max':
        return Math.max(a, b);
      case 'min':
        return Math.min(a, b);
      case 'sqrt':
        return Math.sqrt(a);
      case 'pow':
        return Math.pow(a, b);
    }
  }

  if (type === 'environment') {
    switch (member) {
      case 'machinename':
        return hostname();
      case 'processorcount':
        return cpus().length;
      case 'osversion':
        return `${platform()} ${release()}`;
      case 'currentdirectory':
        return process.cwd();
      case 'getenvironmentvariable':
        return process.env[String(args[0])] ?? null;
    }
  }

  if (type === 'text.encoding') {
    if (member === 'utf8') return { WebName: 'utf-8', CodePage: 65001 };
    if (member === 'ascii') return { WebName: 'us-ascii', CodePage: 20127 };
  }

  if (type === 'guid' && member === 'newguid') {
    return randomUUID();
  }

  if (type === 'datetime') {
    if (member === 'now' || member === 'utcnow') {
      return new Date().toISOString();
    }
  }

  throw new Error(`[b8g-ps-compat] Unsupported .NET BCL call: [${typeNameRaw}]::${memberRaw}`);
}
