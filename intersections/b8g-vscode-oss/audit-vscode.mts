#!/usr/bin/env node
/**
 * Empirical architecture & Electron-surface audit of `third_party/vscode-oss`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VSCODE_ROOT = resolve(__dirname, '..', '..', 'third_party', 'vscode-oss');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const pkg = JSON.parse(readFileSync(join(VSCODE_ROOT, 'package.json'), 'utf8'));
const prod = JSON.parse(readFileSync(join(VSCODE_ROOT, 'product.json'), 'utf8'));
const layers = ['base', 'platform', 'editor', 'workbench', 'code', 'server'];

const stats: Record<string, { files: number; mb: number; electronFiles: number }> = {};
const electronSymbols = new Map<string, number>();
let totalFiles = 0;
let totalElectronFiles = 0;

for (const layer of layers) {
  const dir = join(VSCODE_ROOT, 'src', 'vs', layer);
  const files = walk(dir).filter(
    (f) => /\.(ts|js|mjs|mts)$/.test(f) && !f.includes('\\test\\') && !f.includes('/test/'),
  );
  let bytes = 0;
  let elCount = 0;
  for (const f of files) {
    bytes += statSync(f).size;
    const txt = readFileSync(f, 'utf8');
    if (/from\s+['"]electron['"]|require\(['"]electron['"]\)/.test(txt)) {
      elCount++;
      totalElectronFiles++;
      for (const hit of txt.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]electron['"]/g)) {
        for (const raw of hit[1].split(',')) {
          const sym = raw.replace(/\btype\b/g, '').trim().split(/\s+as\s+/)[0].trim();
          if (sym) electronSymbols.set(sym, (electronSymbols.get(sym) || 0) + 1);
        }
      }
    }
  }
  totalFiles += files.length;
  stats[layer] = { files: files.length, mb: +(bytes / 1048576).toFixed(2), electronFiles: elCount };
}

console.log(
  JSON.stringify(
    {
      vscodeVersion: pkg.version,
      productName: prod.nameShort,
      totalSrcFiles: totalFiles,
      totalElectronImportingFiles: totalElectronFiles,
      electronCouplingPct: +((totalElectronFiles / totalFiles) * 100).toFixed(2),
      layers: stats,
      topElectronSymbols: [...electronSymbols.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20),
    },
    null,
    2,
  ),
);
