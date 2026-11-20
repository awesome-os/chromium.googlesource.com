/**
 * Zero-dependency Chrome DevTools Protocol (CDP) controller for our sovereign
 * real Chromium build (`E:\b8g-chromium-real\src\out\B8gRelease\chrome.exe`).
 *
 * Uses built-in Node 22+ `fetch` + `WebSocket` — zero Puppeteer, zero Playwright,
 * zero C++ patches inside Chromium.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ChromeSessionOptions {
  chromePath?: string;
  width: number;
  height: number;
  deviceScaleFactor?: number;
  initialUrl?: string;
}

const DEFAULT_CHROME_CANDIDATES = [
  'E:\\b8g-chromium-real\\src\\out\\B8gRelease\\chrome.exe',
  'E:\\b8g-chromium-real\\src\\out\\B8gRelease\\b8g_chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

export function resolveChromeBinary(explicit?: string): string {
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`Specified Chrome binary not found: ${explicit}`);
    }
    return explicit;
  }
  for (const candidate of DEFAULT_CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `No Chromium binary found. Checked:\n${DEFAULT_CHROME_CANDIDATES.map((c) => `  - ${c}`).join('\n')}`,
  );
}

interface PendingRpc {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
}

export class CdpChromeSession {
  readonly chromePath: string;
  private proc: ChildProcess;
  private userDataDir: string;
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, PendingRpc>();
  private closed = false;

  private constructor(
    chromePath: string,
    proc: ChildProcess,
    userDataDir: string,
    ws: WebSocket,
  ) {
    this.chromePath = chromePath;
    this.proc = proc;
    this.userDataDir = userDataDir;
    this.ws = ws;

    this.ws.addEventListener('message', (ev) => {
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
      }
    });
  }

  static async launch(opts: ChromeSessionOptions): Promise<CdpChromeSession> {
    const chromePath = resolveChromeBinary(opts.chromePath);
    const userDataDir = mkdtempSync(join(tmpdir(), 'b8g-term-chrome-'));
    const port = 19222 + Math.floor(Math.random() * 10000);

    const args = [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      `--window-size=${opts.width},${opts.height}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-extensions',
      '--mute-audio',
      '--hide-scrollbars',
      opts.initialUrl ?? 'about:blank',
    ];

    const proc = spawn(chromePath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });

    // Wait for DevTools HTTP endpoint to come up
    const endpoint = `http://127.0.0.1:${port}/json/list`;
    let pageWsUrl = '';
    const deadline = Date.now() + 20_000;

    while (Date.now() < deadline) {
      if (proc.exitCode !== null) {
        throw new Error(`Chrome exited prematurely with code ${proc.exitCode}`);
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
        // Still starting
      }
      await new Promise((r) => setTimeout(r, 120));
    }

    if (!pageWsUrl) {
      try {
        proc.kill();
      } catch {
        // ignore
      }
      throw new Error(`Timed out waiting for Chrome CDP on port ${port}`);
    }

    const ws = new WebSocket(pageWsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', (e) => reject(new Error(`CDP WebSocket error: ${String(e)}`)), {
        once: true,
      });
    });

    const session = new CdpChromeSession(chromePath, proc, userDataDir, ws);
    await session.send('Page.enable');
    await session.setViewport(opts.width, opts.height, opts.deviceScaleFactor ?? 1);
    return session;
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error('CDP session closed'));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async setViewport(width: number, height: number, deviceScaleFactor = 1): Promise<void> {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: Math.max(160, Math.floor(width)),
      height: Math.max(120, Math.floor(height)),
      deviceScaleFactor,
      mobile: false,
    });
  }

  async navigate(url: string, settleMs = 600): Promise<void> {
    await this.send('Page.navigate', { url });
    // Wait for document readyState === 'complete' up to 8s
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      try {
        const res = await this.send<{ result?: { value?: string } }>('Runtime.evaluate', {
          expression: 'document.readyState',
          returnByValue: true,
        });
        if (res?.result?.value === 'complete') break;
      } catch {
        // Navigating
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (settleMs > 0) {
      await new Promise((r) => setTimeout(r, settleMs));
    }
  }

  async capturePng(): Promise<Uint8Array> {
    const res = await this.send<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    });
    return new Uint8Array(Buffer.from(res.data, 'base64'));
  }

  /**
   * True Carbonyl hybrid technique: extract visible DOM text nodes with their
   * viewport bounding boxes and computed RGB colors so the terminal renders
   * razor-sharp real text over 24-bit Truecolor background pixel blocks.
   */
  async extractTextOverlay(
    cols: number,
    rows: number,
  ): Promise<Array<{ col: number; row: number; text: string; r: number; g: number; b: number }>> {
    const expr = `(() => {
      const cols = ${Math.floor(cols)};
      const rows = ${Math.floor(rows)};
      const vw = window.innerWidth || 960;
      const vh = window.innerHeight || 540;
      const out = [];
      if (!document.body) return out;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let node;
      while ((node = walker.nextNode())) {
        const raw = node.nodeValue;
        if (!raw || !raw.trim()) continue;
        const el = node.parentElement;
        if (!el) continue;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) < 0.15) continue;
        const m = style.color && style.color.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
        const r = m ? +m[1] : 230;
        const g = m ? +m[2] : 230;
        const b = m ? +m[3] : 230;
        range.selectNodeContents(node);
        const rects = range.getClientRects();
        if (!rects || rects.length === 0) continue;
        const rect = rects[0];
        if (rect.width <= 1 || rect.height <= 1) continue;
        if (rect.bottom < 0 || rect.top >= vh || rect.right < 0 || rect.left >= vw) continue;
        const col = Math.max(0, Math.min(cols - 1, Math.floor((rect.left / vw) * cols)));
        const row = Math.max(0, Math.min(rows - 1, Math.floor(((rect.top + rect.height * 0.5) / vh) * rows)));
        const text = raw.replace(/\\s+/g, ' ').trim();
        if (text.length > 0) {
          out.push({ col, row, text: text.slice(0, cols - col), r, g, b });
        }
      }
      return out;
    })()`;
    try {
      const res = await this.send<{ result?: { value?: any } }>('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
      });
      return Array.isArray(res?.result?.value) ? res.result.value : [];
    } catch {
      return [];
    }
  }

  async scroll(deltaY: number, x = 200, y = 200): Promise<void> {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x,
      y,
      deltaX: 0,
      deltaY,
    });
  }

  async reload(): Promise<void> {
    await this.send('Page.reload', { ignoreCache: false });
  }

  async goBack(): Promise<void> {
    const hist = await this.send<{ currentIndex: number; entries: Array<{ id: number }> }>(
      'Page.getNavigationHistory',
    );
    if (hist.currentIndex > 0) {
      await this.send('Page.navigateToHistoryEntry', {
        entryId: hist.entries[hist.currentIndex - 1].id,
      });
    }
  }

  async goForward(): Promise<void> {
    const hist = await this.send<{ currentIndex: number; entries: Array<{ id: number }> }>(
      'Page.getNavigationHistory',
    );
    if (hist.currentIndex + 1 < hist.entries.length) {
      await this.send('Page.navigateToHistoryEntry', {
        entryId: hist.entries[hist.currentIndex + 1].id,
      });
    }
  }

  async getPageInfo(): Promise<{ title: string; url: string }> {
    try {
      const res = await this.send<{ result?: { value?: { title: string; url: string } } }>(
        'Runtime.evaluate',
        {
          expression: '({ title: document.title || "", url: location.href || "" })',
          returnByValue: true,
        },
      );
      if (res?.result?.value) return res.result.value;
    } catch {
      // ignore during navigation
    }
    return { title: '', url: '' };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws.close();
    } catch {
      // ignore
    }
    try {
      this.proc.kill();
    } catch {
      // ignore
    }
    // Brief delay on Windows so Chrome releases profile locks before cleanup
    await new Promise((r) => setTimeout(r, 150));
    try {
      rmSync(this.userDataDir, { recursive: true, force: true });
    } catch {
      // ignore locked temp files
    }
  }
}
