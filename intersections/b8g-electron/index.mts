/**
 * B8G-Electron — Zero-Copy Shared-Chromium Electron Compatibility Shell.
 *
 * Runs Electron-API desktop apps (`app`, `BrowserWindow`, `ipcMain`, `ipcRenderer`,
 * `contextBridge`, `preload`, `shell`) directly on ONE shared sovereign Chromium
 * binary (`E:\b8g-chromium-real\src\out\B8gRelease\chrome.exe`):
 *   - 0 MB duplicated Chromium binary per app
 *   - Zero C++ patches inside Chromium
 *   - Sub-millisecond bi-directional IPC via CDP `Runtime.addBinding` + `Page.addScriptToEvaluateOnNewDocument`
 */
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_CHROME_CANDIDATES = [
  process.env.B8G_CHROME_PATH,
  'E:\\b8g-chromium-real\\src\\out\\B8gRelease\\chrome.exe',
  'E:\\b8g-chromium-real\\src\\out\\B8gRelease\\b8g_chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean) as string[];

export function resolveSharedChromeBinary(): string {
  for (const c of DEFAULT_CHROME_CANDIDATES) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    `[b8g-electron] No shared Chromium binary found. Checked:\n${DEFAULT_CHROME_CANDIDATES.join('\n')}`,
  );
}

// ---------------------------------------------------------------------------
// ipcMain
// ---------------------------------------------------------------------------

export interface IpcMainEvent {
  sender: WebContents;
  reply: (channel: string, ...args: unknown[]) => void;
}

export interface IpcMainInvokeEvent {
  sender: WebContents;
}

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: any[]) => any | Promise<any>;

class IpcMainImpl extends EventEmitter {
  private handlers = new Map<string, InvokeHandler>();

  handle(channel: string, listener: InvokeHandler): void {
    this.handlers.set(channel, listener);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  async _dispatchInvoke(sender: WebContents, channel: string, args: unknown[]): Promise<unknown> {
    const fn = this.handlers.get(channel);
    if (!fn) {
      throw new Error(`No handler registered for IPC channel '${channel}'`);
    }
    return await fn({ sender }, ...args);
  }

  _dispatchSend(sender: WebContents, channel: string, args: unknown[]): void {
    const event: IpcMainEvent = {
      sender,
      reply: (replyChannel: string, ...replyArgs: unknown[]) => {
        sender.send(replyChannel, ...replyArgs);
      },
    };
    this.emit(channel, event, ...args);
  }
}

export const ipcMain = new IpcMainImpl();

// ---------------------------------------------------------------------------
// app
// ---------------------------------------------------------------------------

class AppImpl extends EventEmitter {
  private ready = true;
  private appName = 'b8g-electron-app';
  private appVersion = '1.0.0';

  isReady(): boolean {
    return this.ready;
  }

  whenReady(): Promise<void> {
    return Promise.resolve();
  }

  getName(): string {
    return this.appName;
  }

  setName(name: string): void {
    this.appName = name;
  }

  getVersion(): string {
    return this.appVersion;
  }

  getPath(name: 'home' | 'appData' | 'userData' | 'temp' | 'desktop' | 'documents'): string {
    const home = homedir();
    switch (name) {
      case 'home':
        return home;
      case 'temp':
        return tmpdir();
      case 'desktop':
        return join(home, 'Desktop');
      case 'documents':
        return join(home, 'Documents');
      case 'appData':
        return process.env.APPDATA || join(home, '.config');
      case 'userData':
        return join(process.env.APPDATA || join(home, '.config'), this.appName);
      default:
        return home;
    }
  }

  quit(): void {
    for (const win of [...BrowserWindow.getAllWindows()]) {
      win.close();
    }
    this.emit('before-quit');
    this.emit('will-quit');
    this.emit('quit');
  }
}

export const app = new AppImpl();

// ---------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------

export const shell = {
  async openExternal(url: string): Promise<void> {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  },
};

// ---------------------------------------------------------------------------
// Renderer bootstrap script (injected via CDP Page.addScriptToEvaluateOnNewDocument)
// ---------------------------------------------------------------------------

function buildRendererBootstrap(preloadSource: string): string {
  return `
(() => {
  if (window.__b8gElectronBootstrapped) return;
  window.__b8gElectronBootstrapped = true;

  let nextInvokeId = 1;
  const pendingInvokes = new Map();
  const listeners = new Map();

  window.__b8gElectronResolve = (id, ok, payload) => {
    const p = pendingInvokes.get(id);
    if (!p) return;
    pendingInvokes.delete(id);
    if (ok) p.resolve(payload);
    else p.reject(new Error(String(payload)));
  };

  window.__b8gElectronEmit = (channel, args) => {
    const set = listeners.get(channel);
    if (!set) return;
    const evt = { sender: ipcRenderer };
    for (const fn of [...set]) {
      try { fn(evt, ...(Array.isArray(args) ? args : [])); } catch (e) { console.error(e); }
    }
  };

  const ipcRenderer = {
    invoke(channel, ...args) {
      const id = nextInvokeId++;
      return new Promise((resolve, reject) => {
        pendingInvokes.set(id, { resolve, reject });
        window.__b8gElectronSend(JSON.stringify({ type: 'invoke', id, channel, args }));
      });
    },
    send(channel, ...args) {
      window.__b8gElectronSend(JSON.stringify({ type: 'send', channel, args }));
    },
    on(channel, fn) {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(fn);
      return ipcRenderer;
    },
    once(channel, fn) {
      const wrapper = (evt, ...args) => {
        ipcRenderer.removeListener(channel, wrapper);
        fn(evt, ...args);
      };
      return ipcRenderer.on(channel, wrapper);
    },
    removeListener(channel, fn) {
      listeners.get(channel)?.delete(fn);
      return ipcRenderer;
    },
    removeAllListeners(channel) {
      if (channel) listeners.delete(channel);
      else listeners.clear();
      return ipcRenderer;
    },
  };

  const contextBridge = {
    exposeInMainWorld(apiKey, apiObj) {
      Object.defineProperty(window, apiKey, {
        value: apiObj,
        writable: false,
        configurable: false,
        enumerable: true,
      });
    },
  };

  const electronApi = { ipcRenderer, contextBridge };
  const preloadRequire = (id) => {
    if (id === 'electron' || id === 'b8g-electron') return electronApi;
    throw new Error('[b8g-electron preload] Unsupported require: ' + id);
  };

  window.__b8gElectron = electronApi;

  ${
    preloadSource
      ? `(function(require) {\n${preloadSource}\n})(preloadRequire);`
      : ''
  }
})();
`;
}

// ---------------------------------------------------------------------------
// WebContents & BrowserWindow
// ---------------------------------------------------------------------------

export interface BrowserWindowOptions {
  width?: number;
  height?: number;
  title?: string;
  show?: boolean;
  headless?: boolean;
  chromePath?: string;
  webPreferences?: {
    preload?: string;
    contextIsolation?: boolean;
    nodeIntegration?: boolean;
  };
}

interface PendingRpc {
  resolve: (val: any) => void;
  reject: (err: Error) => void;
}

export class WebContents extends EventEmitter {
  private win: BrowserWindow;
  constructor(win: BrowserWindow) {
    super();
    this.win = win;
  }

  send(channel: string, ...args: unknown[]): void {
    const js = `window.__b8gElectronEmit && window.__b8gElectronEmit(${JSON.stringify(channel)}, ${JSON.stringify(args)})`;
    void this.win._cdpSend('Runtime.evaluate', { expression: js }).catch(() => {});
  }

  async executeJavaScript<T = any>(code: string): Promise<T> {
    const res = await this.win._cdpSend<{
      result?: { value?: T };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    }>('Runtime.evaluate', {
      expression: code,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res?.exceptionDetails) {
      throw new Error(
        res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'JS evaluation error',
      );
    }
    return res?.result?.value as T;
  }
}

export class BrowserWindow extends EventEmitter {
  private static windows = new Set<BrowserWindow>();

  readonly webContents: WebContents;
  readonly chromePath: string;
  private opts: Required<Pick<BrowserWindowOptions, 'width' | 'height' | 'title' | 'show'>> & {
    headless: boolean;
    preloadPath?: string;
  };
  private proc: ChildProcess | null = null;
  private userDataDir: string | null = null;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRpc>();
  private loadResolvers: Array<() => void> = [];
  private readyPromise: Promise<void> | null = null;
  private destroyed = false;

  constructor(options: BrowserWindowOptions = {}) {
    super();
    this.chromePath = options.chromePath || resolveSharedChromeBinary();
    const forceHeadless = process.env.B8G_ELECTRON_HEADLESS === '1';
    const headless = options.headless ?? (options.show === false || forceHeadless);

    this.opts = {
      width: options.width ?? 1024,
      height: options.height ?? 680,
      title: options.title ?? 'B8G-Electron',
      show: options.show ?? true,
      headless,
      preloadPath: options.webPreferences?.preload,
    };

    this.webContents = new WebContents(this);
    BrowserWindow.windows.add(this);
  }

  static getAllWindows(): BrowserWindow[] {
    return [...BrowserWindow.windows];
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  private async ensureLaunched(initialUrl: string): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = this._launch(initialUrl);
    return this.readyPromise;
  }

  private async _launch(initialUrl: string): Promise<void> {
    const userDataDir = mkdtempSync(join(tmpdir(), 'b8g-electron-'));
    this.userDataDir = userDataDir;
    const port = 21222 + Math.floor(Math.random() * 10000);

    const args = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      `--window-size=${this.opts.width},${this.opts.height}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--disable-background-networking',
    ];

    if (this.opts.headless) {
      args.push('--headless=new', '--no-sandbox', '--disable-gpu', 'about:blank');
    } else {
      // Native app window mode (no browser chrome/tabs — pure desktop app window!)
      args.push(`--app=about:blank`);
    }

    const proc = spawn(this.chromePath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: this.opts.headless,
    });
    this.proc = proc;

    proc.once('exit', () => {
      if (!this.destroyed) {
        this._markDestroyed();
      }
    });

    const endpoint = `http://127.0.0.1:${port}/json/list`;
    let pageWsUrl = '';
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) {
        throw new Error(`[b8g-electron] Shared Chromium exited early (code=${proc.exitCode})`);
      }
      try {
        const res = await fetch(endpoint);
        if (res.ok) {
          const targets = (await res.json()) as Array<{ type: string; webSocketDebuggerUrl?: string }>;
          const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
          if (page?.webSocketDebuggerUrl) {
            pageWsUrl = page.webSocketDebuggerUrl;
            break;
          }
        }
      } catch {
        // waiting for DevTools port
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    if (!pageWsUrl) {
      this.close();
      throw new Error(`[b8g-electron] Timed out connecting to shared Chromium CDP on port ${port}`);
    }

    const ws = new WebSocket(pageWsUrl);
    this.ws = ws;
    await new Promise<void>((resolveWs, rejectWs) => {
      ws.addEventListener('open', () => resolveWs(), { once: true });
      ws.addEventListener('error', (e) => rejectWs(new Error(`CDP WebSocket error: ${String(e)}`)), {
        once: true,
      });
    });

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (typeof msg.id === 'number') {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) {
            p.reject(new Error(`CDP error ${msg.error.code}: ${msg.error.message}`));
          } else {
            p.resolve(msg.result ?? {});
          }
        }
        return;
      }

      // Live renderer -> main IPC binding callback
      if (msg.method === 'Runtime.bindingCalled' && msg.params?.name === '__b8gElectronSend') {
        void this._handleBindingMessage(String(msg.params.payload || ''));
      } else if (msg.method === 'Page.loadEventFired') {
        const waiters = this.loadResolvers.splice(0);
        for (const fn of waiters) fn();
      }
    });

    ws.addEventListener('close', () => {
      if (!this.destroyed) {
        this._markDestroyed();
      }
    });

    await this._cdpSend('Page.enable');
    await this._cdpSend('Runtime.enable');
    await this._cdpSend('Runtime.addBinding', { name: '__b8gElectronSend' });

    const preloadSource = this.opts.preloadPath ? readFileSync(this.opts.preloadPath, 'utf8') : '';
    const bootstrap = buildRendererBootstrap(preloadSource);
    await this._cdpSend('Page.addScriptToEvaluateOnNewDocument', { source: bootstrap });

    if (initialUrl && initialUrl !== 'about:blank') {
      await this._navigateAndWait(initialUrl);
    }
  }

  private async _handleBindingMessage(raw: string): Promise<void> {
    let parsed: { type: string; id?: number; channel: string; args?: unknown[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    const args = Array.isArray(parsed.args) ? parsed.args : [];
    if (parsed.type === 'send') {
      ipcMain._dispatchSend(this.webContents, parsed.channel, args);
    } else if (parsed.type === 'invoke' && typeof parsed.id === 'number') {
      try {
        const result = await ipcMain._dispatchInvoke(this.webContents, parsed.channel, args);
        const js = `window.__b8gElectronResolve(${parsed.id}, true, ${JSON.stringify(result === undefined ? null : result)})`;
        await this._cdpSend('Runtime.evaluate', { expression: js });
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        const js = `window.__b8gElectronResolve(${parsed.id}, false, ${JSON.stringify(errMsg)})`;
        await this._cdpSend('Runtime.evaluate', { expression: js }).catch(() => {});
      }
    }
  }

  private async _navigateAndWait(url: string): Promise<void> {
    const loadPromise = new Promise<void>((resolveLoad) => {
      const timer = setTimeout(() => resolveLoad(), 10_000);
      this.loadResolvers.push(() => {
        clearTimeout(timer);
        resolveLoad();
      });
    });
    await this._cdpSend('Page.navigate', { url });
    await loadPromise;
    this.webContents.emit('did-finish-load');
    this.emit('ready-to-show');
  }

  _cdpSend<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.destroyed || !this.ws) {
      return Promise.reject(new Error('BrowserWindow is destroyed'));
    }
    const id = this.nextId++;
    return new Promise<T>((resolveRpc, rejectRpc) => {
      this.pending.set(id, { resolve: resolveRpc, reject: rejectRpc });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  async loadURL(url: string): Promise<void> {
    if (!this.readyPromise) {
      await this.ensureLaunched(url);
    } else {
      await this.readyPromise;
      await this._navigateAndWait(url);
    }
  }

  async loadFile(filePath: string): Promise<void> {
    const abs = resolve(filePath);
    if (!existsSync(abs)) {
      throw new Error(`[b8g-electron] File not found: ${abs}`);
    }
    await this.loadURL(pathToFileURL(abs).href);
  }

  async setTitle(title: string): Promise<void> {
    this.opts.title = title;
    if (this.ws && !this.destroyed) {
      await this._cdpSend('Runtime.evaluate', {
        expression: `document.title = ${JSON.stringify(title)}`,
      }).catch(() => {});
    }
  }

  close(): void {
    if (this.destroyed) return;
    this._markDestroyed();
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    try {
      this.proc?.kill();
    } catch {
      // ignore
    }
    const dir = this.userDataDir;
    this.userDataDir = null;
    if (dir) {
      setTimeout(() => {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          // ignore locked temp files on Windows
        }
      }, 200).unref();
    }
  }

  private _markDestroyed(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    BrowserWindow.windows.delete(this);
    this.emit('closed');
    if (BrowserWindow.windows.size === 0) {
      app.emit('window-all-closed');
    }
  }
}
