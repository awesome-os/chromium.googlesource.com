/**
 * B8G-NW.js — Mixed-Context NW.js Shell on ONE Shared Sovereign Chromium Core.
 *
 * Implements the NW.js principle:
 *   - Manifest-first (`package.json` with `"main": "index.html"` + `"window": { ... }`)
 *   - Direct Node.js + `nw.*` APIs right inside the DOM window context
 *     (`window.nw`, `window.process`, `window.require('os' | 'fs' | 'path' | 'nw.gui')`)
 *   - Built directly on top of our shared Chromium `BrowserWindow` + `ipcMain`
 *     (`0 MB` duplicated Chromium, `0` C++ patches inside Chromium).
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { arch, cpus, freemem, homedir, hostname, platform, release, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { app, BrowserWindow, ipcMain, shell } from '../b8g-electron/index.mts';

export interface NwManifest {
  name?: string;
  version?: string;
  main: string;
  window?: {
    title?: string;
    width?: number;
    height?: number;
    show?: boolean;
  };
}

let nwHandlersRegistered = false;

function registerNwHostHandlers(manifest: NwManifest, appDir: string): void {
  if (nwHandlersRegistered) return;
  nwHandlersRegistered = true;

  ipcMain.handle('b8g-nw:call', async (_evt, mod: string, method: string, args: any[]) => {
    if (mod === 'os') {
      switch (method) {
        case 'hostname':
          return hostname();
        case 'platform':
          return platform();
        case 'release':
          return release();
        case 'arch':
          return arch();
        case 'cpus':
          return cpus();
        case 'totalmem':
          return totalmem();
        case 'freemem':
          return freemem();
        case 'homedir':
          return homedir();
      }
    }

    if (mod === 'fs') {
      const target = resolve(appDir, String(args[0] ?? ''));
      switch (method) {
        case 'existsSync':
          return existsSync(target);
        case 'readFileSync':
          return readFileSync(target, (args[1] as BufferEncoding) || 'utf8');
        case 'readdirSync':
          return readdirSync(target);
        case 'statSync': {
          const st = statSync(target);
          return { size: st.size, isFile: st.isFile(), isDirectory: st.isDirectory(), mtimeMs: st.mtimeMs };
        }
        case 'writeFileSync':
          writeFileSync(target, String(args[1] ?? ''), 'utf8');
          return true;
      }
    }

    if (mod === 'nw.Shell' && method === 'openExternal') {
      await shell.openExternal(String(args[0] ?? ''));
      return true;
    }

    if (mod === 'nw.App' && method === 'manifest') {
      return manifest;
    }

    throw new Error(`[b8g-nwjs] Unsupported host call: ${mod}.${method}`);
  });
}

function buildNwPreloadSource(manifest: NwManifest, appDir: string): string {
  const staticSnapshot = {
    manifest,
    appDir,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    versions: {
      node: process.versions.node,
      v8: process.versions.v8,
      nw: 'b8g-nwjs-0.1.0',
      chromium: 'b8g-shared-core',
    },
    hostname: hostname(),
    homedir: homedir(),
    cpus: cpus().length,
    cpuModel: cpus()[0]?.model || 'CPU',
    totalmem: totalmem(),
    freemem: freemem(),
  };

  return `
const { ipcRenderer } = require('electron');
const SNAP = ${JSON.stringify(staticSnapshot)};

const nwCall = (mod, method, ...args) => ipcRenderer.invoke('b8g-nw:call', mod, method, args);

const nwWindowApi = {
  get() {
    return {
      title: document.title,
      setTitle(t) { document.title = String(t); },
      close() { window.close(); },
      reload() { location.reload(); },
      window,
    };
  },
};

const nwApi = {
  App: {
    manifest: SNAP.manifest,
    dataPath: SNAP.appDir,
    argv: [],
    quit() { window.close(); },
  },
  Window: nwWindowApi,
  Shell: {
    openExternal(url) { return nwCall('nw.Shell', 'openExternal', url); },
  },
  Clipboard: {
    get() {
      return {
        get() { return navigator.clipboard?.readText?.() ?? ''; },
        set(text) { return navigator.clipboard?.writeText?.(String(text)); },
      };
    },
  },
};

const nodeModules = {
  'nw.gui': nwApi,
  os: {
    hostname: () => SNAP.hostname,
    platform: () => SNAP.platform,
    arch: () => SNAP.arch,
    homedir: () => SNAP.homedir,
    totalmem: () => SNAP.totalmem,
    freemem: () => SNAP.freemem,
    cpus: () => Array.from({ length: SNAP.cpus }, () => ({ model: SNAP.cpuModel })),
    async: {
      cpus: () => nwCall('os', 'cpus'),
      freemem: () => nwCall('os', 'freemem'),
      hostname: () => nwCall('os', 'hostname'),
    },
  },
  path: {
    sep: SNAP.platform === 'win32' ? '\\\\' : '/',
    join: (...parts) => parts.filter(Boolean).join('/').replace(/\\/+/g, '/'),
    basename: (p) => String(p).split(/[\\\\/]/).pop() || '',
    dirname: (p) => {
      const s = String(p).replace(/[\\\\/]+$/, '');
      const idx = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\\\'));
      return idx <= 0 ? '.' : s.slice(0, idx);
    },
  },
  fs: {
    promises: {
      readFile: (p, enc = 'utf8') => nwCall('fs', 'readFileSync', p, enc),
      readdir: (p = '.') => nwCall('fs', 'readdirSync', p),
      stat: (p) => nwCall('fs', 'statSync', p),
      exists: (p) => nwCall('fs', 'existsSync', p),
      writeFile: (p, data) => nwCall('fs', 'writeFileSync', p, data),
    },
  },
};

window.nw = nwApi;
window.process = {
  platform: SNAP.platform,
  arch: SNAP.arch,
  version: SNAP.nodeVersion,
  versions: SNAP.versions,
  cwd: () => SNAP.appDir,
};
window.require = (id) => {
  const clean = String(id).replace(/^node:/, '');
  if (nodeModules[clean]) return nodeModules[clean];
  throw new Error('[b8g-nwjs] Module not bridged in DOM context: ' + id);
};
`;
}

export async function launchNwApp(
  appDirOrHtml: string,
  options: { headless?: boolean; show?: boolean } = {},
): Promise<BrowserWindow> {
  await app.whenReady();

  const abs = resolve(appDirOrHtml);
  let appDir = abs;
  let manifest: NwManifest = { main: 'index.html' };

  if (statSync(abs).isDirectory()) {
    const pkgPath = join(abs, 'package.json');
    if (existsSync(pkgPath)) {
      manifest = JSON.parse(readFileSync(pkgPath, 'utf8'));
    }
  } else {
    appDir = dirname(abs);
    manifest = { main: abs };
  }

  registerNwHostHandlers(manifest, appDir);

  // Write ephemeral preload script into temp dir so BrowserWindow loads it cleanly
  const preloadFile = join(app.getPath('temp'), `b8g-nw-preload-${process.pid}-${Date.now()}.js`);
  writeFileSync(preloadFile, buildNwPreloadSource(manifest, appDir), 'utf8');

  const win = new BrowserWindow({
    width: manifest.window?.width ?? 980,
    height: manifest.window?.height ?? 640,
    title: manifest.window?.title ?? manifest.name ?? 'B8G-NW.js App',
    show: options.show ?? manifest.window?.show ?? true,
    headless: options.headless,
    webPreferences: {
      preload: preloadFile,
    },
  });

  const entry = /^https?:/i.test(manifest.main) ? manifest.main : resolve(appDir, manifest.main);
  if (/^https?:/i.test(entry)) {
    await win.loadURL(entry);
  } else {
    await win.loadFile(entry);
  }

  return win;
}
