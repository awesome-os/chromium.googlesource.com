#!/usr/bin/env node
/**
 * B8G Terminal Chrome — Two First-Class Terminal Browser Shells powered by our
 * sovereign real Chromium (`E:\b8g-chromium-real\src\out\B8gRelease\chrome.exe`):
 *
 *   1. `ansi`  — True Carbonyl Hybrid (24-bit Truecolor Half-Block `▀` pixel blocks
 *                + razor-sharp DOM text overlay) / pure halfblock / ASCII
 *   2. `kitty` — Pixel-Perfect Kitty Graphics Protocol (`a=T,f=100` / `f=32`)
 *
 * Layered with a real interactive Unicode Browser UI Frame (Tab Strip, Nav Bar,
 * live-editable Omnibox URL bar, Viewport Frame Rails, Status & Hotkey Footer).
 */
import { writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { decodePng, type RgbaImage } from './png-decoder.mts';
import { renderAnsiFrame, type AnsiCharset } from './ansi-shell.mts';
import {
  renderKittyPng,
  renderKittyRgba,
  clearKittyImages,
  type KittyFormat,
} from './kitty-shell.mts';
import {
  renderTopChrome,
  renderBottomChrome,
  wrapViewportWithUiFrame,
  UI_CHROME_TOP_ROWS,
  UI_CHROME_BOTTOM_ROWS,
  UI_CHROME_SIDE_COLS,
  type BrowserUiFrameState,
} from './ui-frame.mts';
import { CdpChromeSession } from './cdp-chrome.mts';

type ShellMode = 'ansi' | 'kitty';

interface CliOptions {
  mode: ShellMode | 'self-test';
  url: string;
  cols: number;
  rows: number;
  width: number;
  height: number;
  fps: number;
  live: boolean;
  chromeUi: boolean;
  charset: AnsiCharset;
  kittyFormat: KittyFormat;
  settleMs: number;
  chromePath?: string;
  outFile?: string;
}

function printUsage(): void {
  console.log(`
B8G Terminal Chrome — Sovereign Chromium in Your Terminal (ANSI + Kitty Shells + Browser UI Frame)

Usage:
  b8g-terminal-chrome ansi  <url|file> [options]   # Shell 1: True Carbonyl Hybrid (DOM text + 24-bit blocks)
  b8g-terminal-chrome kitty <url|file> [options]   # Shell 2: Pixel-Perfect Kitty Graphics Protocol
  b8g-terminal-chrome self-test                    # Offline verification of UI frame + both encoders

Options:
  --live                    Interactive live browser (g: URL bar, b/f: back/fwd, j/k/arrows: scroll, c: mode, m: ansi<->kitty, r: reload, q: quit)
  --once                    Render a single frame and exit
  --no-chrome-ui            Hide the browser UI frame (frameless raw viewport)
  --fps <n>                 Target capture FPS in --live mode (default: 4)
  --cols <n>                Terminal columns (default: stdout.columns or 120)
  --rows <n>                Terminal rows (default: stdout.rows or 36)
  --width <px>              Chromium viewport width in px (default: 960)
  --height <px>             Chromium viewport height in px (default: 540)
  --charset <mode>          ANSI shell charset: carbonyl (default, hybrid text+blocks) | halfblock | ascii
  --format <fmt>            Kitty shell pixel format: png (default, f=100) | rgba (f=32)
  --settle <ms>             Wait after page load before first capture (default: 600)
  --chrome <path>           Override Chromium executable path
  --out <file>              Write rendered escape stream to file instead of stdout
`.trim());
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (/^(https?|file|about|data):/i.test(trimmed)) {
    return trimmed;
  }
  const abs = resolve(trimmed);
  if (existsSync(abs)) {
    return pathToFileURL(abs).href;
  }
  return `https://${trimmed}`;
}

function parseArgs(argv: string[]): CliOptions {
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  const first = argv[0];
  if (first !== 'ansi' && first !== 'kitty' && first !== 'self-test') {
    throw new Error(`Unknown shell mode "${first}". Expected "ansi", "kitty", or "self-test".`);
  }

  const opts: CliOptions = {
    mode: first,
    url: 'https://example.com',
    cols: process.stdout.columns || 120,
    rows: process.stdout.rows || 36,
    width: 960,
    height: 540,
    fps: 4,
    live: false,
    chromeUi: true,
    charset: 'carbonyl',
    kittyFormat: 'png',
    settleMs: 600,
  };

  let positionalSet = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--live') {
      opts.live = true;
    } else if (a === '--once') {
      opts.live = false;
    } else if (a === '--no-chrome-ui') {
      opts.chromeUi = false;
    } else if (a === '--fps' && argv[i + 1]) {
      opts.fps = Math.max(1, Math.min(30, Number(argv[++i])));
    } else if (a === '--cols' && argv[i + 1]) {
      opts.cols = Math.max(40, Number(argv[++i]));
    } else if (a === '--rows' && argv[i + 1]) {
      opts.rows = Math.max(10, Number(argv[++i]));
    } else if (a === '--width' && argv[i + 1]) {
      opts.width = Math.max(160, Number(argv[++i]));
    } else if (a === '--height' && argv[i + 1]) {
      opts.height = Math.max(120, Number(argv[++i]));
    } else if (a === '--charset' && argv[i + 1]) {
      const val = argv[++i];
      if (val !== 'carbonyl' && val !== 'halfblock' && val !== 'ascii') {
        throw new Error(`Invalid --charset "${val}". Use "carbonyl", "halfblock", or "ascii".`);
      }
      opts.charset = val;
    } else if (a === '--format' && argv[i + 1]) {
      const val = argv[++i];
      if (val !== 'png' && val !== 'rgba') {
        throw new Error(`Invalid --format "${val}". Use "png" or "rgba".`);
      }
      opts.kittyFormat = val;
    } else if (a === '--settle' && argv[i + 1]) {
      opts.settleMs = Math.max(0, Number(argv[++i]));
    } else if (a === '--chrome' && argv[i + 1]) {
      opts.chromePath = argv[++i];
    } else if (a === '--out' && argv[i + 1]) {
      opts.outFile = argv[++i];
    } else if (!a.startsWith('-') && !positionalSet) {
      opts.url = normalizeUrl(a);
      positionalSet = true;
    } else {
      throw new Error(`Unrecognized argument: ${a}`);
    }
  }

  return opts;
}

function makeTestGradient(width: number, height: number): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = Math.round((x / (width - 1)) * 255);
      data[i + 1] = Math.round((y / (height - 1)) * 255);
      data[i + 2] = Math.round(((x + y) / (width + height)) * 255);
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function runSelfTest(): void {
  const img = makeTestGradient(64, 32);
  const cols = 72;
  const rows = 14;
  const body = renderAnsiFrame(img, {
    cols: cols - UI_CHROME_SIDE_COLS,
    rows: rows - UI_CHROME_TOP_ROWS - UI_CHROME_BOTTOM_ROWS,
    charset: 'carbonyl',
    textRuns: [{ col: 2, row: 2, text: 'B8G Sovereign Terminal Chrome — UI Frame OK', r: 255, g: 255, b: 255 }],
  });
  const framed = wrapViewportWithUiFrame(
    body,
    {
      cols,
      rows,
      title: 'Self-Test Demo',
      url: 'https://b8g.local/self-test',
      modeLabel: 'ANSI:CARBONYL',
      frameCount: 1,
      captureMs: '1.0',
      omniboxFocused: false,
      omniboxBuffer: '',
    },
    false,
  );
  const kitty = renderKittyRgba(img, { cols: 40, rows: 10 });
  console.log(framed);
  console.log(
    `\n[self-test] Framed ANSI bytes=${framed.length} | Kitty RGBA APC bytes=${kitty.length} (chunked=${kitty.includes('m=1;')})`,
  );
}

async function runBrowserShell(opts: CliOptions): Promise<void> {
  const session = await CdpChromeSession.launch({
    chromePath: opts.chromePath,
    width: opts.width,
    height: opts.height,
    initialUrl: 'about:blank',
  });

  let activeMode: ShellMode = opts.mode as ShellMode;
  let activeCharset: AnsiCharset = opts.charset;
  let currentUrl = opts.url;
  let currentTitle = 'Loading…';
  let omniboxFocused = false;
  let omniboxBuffer = '';
  let running = true;
  let frameCount = 0;
  let cleanedUp = false;

  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    running = false;
    if (opts.live && process.stdout.isTTY) {
      if (activeMode === 'kitty') {
        process.stdout.write(clearKittyImages());
      }
      process.stdout.write('\x1b[?25h\x1b[?1049l\x1b[0m');
    }
    if (opts.live && process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
        process.stdin.pause();
      } catch {
        // ignore
      }
    }
    await session.close();
  };

  process.on('SIGINT', () => {
    void cleanup().then(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void cleanup().then(() => process.exit(0));
  });

  try {
    await session.navigate(currentUrl, opts.settleMs);
    const info0 = await session.getPageInfo();
    if (info0.title) currentTitle = info0.title;
    if (info0.url && info0.url !== 'about:blank') currentUrl = info0.url;

    const isKittyTerminal = Boolean(
      process.env.KITTY_WINDOW_ID ||
      process.env.GHOSTTY_RESOURCES_DIR ||
      process.env.WEZTERM_PANE ||
      (process.env.TERM && /kitty|ghostty|wezterm|rio/i.test(process.env.TERM)),
    );

    const renderCurrentFrame = async (liveFrame: boolean): Promise<string> => {
      const t0 = performance.now();
      const [png, pageInfo] = await Promise.all([
        session.capturePng(),
        frameCount % 4 === 0 ? session.getPageInfo() : Promise.resolve(null),
      ]);
      if (pageInfo) {
        if (pageInfo.title) currentTitle = pageInfo.title;
        if (pageInfo.url && pageInfo.url !== 'about:blank') currentUrl = pageInfo.url;
      }

      frameCount++;
      const cols = opts.live && process.stdout.isTTY ? process.stdout.columns || opts.cols : opts.cols;
      const rows = opts.live && process.stdout.isTTY ? process.stdout.rows || opts.rows : opts.rows;
      const captureMs = (performance.now() - t0).toFixed(1);

      const modeLabel =
        activeMode === 'ansi'
          ? `ANSI:${activeCharset.toUpperCase()}`
          : `KITTY:${opts.kittyFormat.toUpperCase()}`;

      const warning =
        activeMode === 'kitty' && process.stdout.isTTY && !isKittyTerminal
          ? `NO KITTY APC IN ${process.env.TERM_PROGRAM || 'THIS TERM'} — press [m] for Carbonyl!`
          : undefined;

      const frameState: BrowserUiFrameState = {
        cols,
        rows,
        title: currentTitle,
        url: currentUrl,
        modeLabel,
        frameCount,
        captureMs,
        omniboxFocused,
        omniboxBuffer,
        warning,
      };

      const vpCols = opts.chromeUi ? Math.max(16, cols - UI_CHROME_SIDE_COLS) : cols;
      const vpRows = opts.chromeUi
        ? Math.max(4, rows - UI_CHROME_TOP_ROWS - UI_CHROME_BOTTOM_ROWS)
        : Math.max(4, rows - 1);

      if (activeMode === 'ansi') {
        const rgba = decodePng(png);
        const textRuns =
          activeCharset === 'carbonyl'
            ? await session.extractTextOverlay(vpCols, vpRows)
            : undefined;

        if (opts.chromeUi) {
          const body = renderAnsiFrame(rgba, {
            cols: vpCols,
            rows: vpRows,
            charset: activeCharset,
            textRuns,
            liveFrame: false,
          });
          return wrapViewportWithUiFrame(body, frameState, liveFrame);
        }

        return renderAnsiFrame(rgba, {
          cols,
          rows,
          charset: activeCharset,
          textRuns,
          liveFrame,
          statusBar: ` B8G-CHROME [${modeLabel}] | ${currentUrl} | #${frameCount} ${captureMs}ms `,
        });
      } else {
        // Kitty Graphics Protocol with optional Browser UI Frame layered around the image rect
        const kittyPayload =
          opts.kittyFormat === 'png'
            ? renderKittyPng(png, { cols: vpCols, rows: vpRows, liveFrame: false })
            : renderKittyRgba(decodePng(png), { cols: vpCols, rows: vpRows, liveFrame: false });

        if (!opts.chromeUi) {
          return liveFrame ? `\x1b[?2026h\x1b[H${kittyPayload}\x1b[?2026l` : kittyPayload;
        }

        const top = renderTopChrome(frameState).join('\n');
        const bottom = renderBottomChrome(frameState);
        if (liveFrame) {
          return (
            `\x1b[?2026h\x1b[H${top}` +
            `\x1b[${UI_CHROME_TOP_ROWS + 1};2H${kittyPayload}` +
            `\x1b[${rows};1H${bottom}\x1b[?2026l`
          );
        }
        return `${top}\n${kittyPayload}\n${bottom}`;
      }
    };

    if (!opts.live) {
      const frame = await renderCurrentFrame(false);
      if (opts.outFile) {
        writeFileSync(opts.outFile, frame, 'utf8');
        console.error(
          `[b8g-terminal-chrome] Wrote ${frame.length} bytes (${activeMode}, ui=${opts.chromeUi}) from ${session.chromePath} -> ${opts.outFile}`,
        );
      } else {
        process.stdout.write(frame + '\n');
      }
      return;
    }

    // Interactive --live mode
    if (process.stdout.isTTY) {
      process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H');
    }
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', (buf: Buffer) => {
        const s = buf.toString('utf8');
        if (s === '\x03') {
          void cleanup().then(() => process.exit(0));
          return;
        }

        // Interactive Omnibox typing mode
        if (omniboxFocused) {
          if (s === '\x1b') {
            omniboxFocused = false;
            omniboxBuffer = '';
          } else if (s === '\r' || s === '\n') {
            const target = omniboxBuffer.trim();
            omniboxFocused = false;
            omniboxBuffer = '';
            if (target.length > 0) {
              currentUrl = normalizeUrl(target);
              currentTitle = 'Loading…';
              void session.navigate(currentUrl, 250).then(async () => {
                const info = await session.getPageInfo();
                if (info.title) currentTitle = info.title;
                if (info.url) currentUrl = info.url;
              });
            }
          } else if (s === '\x7f' || s === '\b') {
            omniboxBuffer = omniboxBuffer.slice(0, -1);
          } else if (s.length === 1 && s >= ' ' && s <= '~') {
            omniboxBuffer += s;
          }
          return;
        }

        if (s === 'q') {
          void cleanup().then(() => process.exit(0));
        } else if (s === 'g' || s === '/' || s === '\x0c') {
          omniboxFocused = true;
          omniboxBuffer = currentUrl;
        } else if (s === 'j' || s === '\x1b[B') {
          void session.scroll(180);
        } else if (s === 'k' || s === '\x1b[A') {
          void session.scroll(-180);
        } else if (s === ' ' || s === '\x1b[6~') {
          void session.scroll(480);
        } else if (s === '\x1b[5~') {
          void session.scroll(-480);
        } else if (s === 'r') {
          void session.reload();
        } else if (s === 'b') {
          void session.goBack();
        } else if (s === 'f') {
          void session.goForward();
        } else if (s === 'm') {
          if (activeMode === 'kitty' && process.stdout.isTTY) {
            process.stdout.write(clearKittyImages());
          }
          activeMode = activeMode === 'ansi' ? 'kitty' : 'ansi';
          if (process.stdout.isTTY) {
            process.stdout.write('\x1b[2J\x1b[H');
          }
        } else if (s === 'c') {
          activeCharset =
            activeCharset === 'carbonyl'
              ? 'halfblock'
              : activeCharset === 'halfblock'
                ? 'ascii'
                : 'carbonyl';
        }
      });
    }

    const frameIntervalMs = Math.max(33, Math.round(1000 / opts.fps));
    while (running) {
      const start = performance.now();
      try {
        const frame = await renderCurrentFrame(true);
        if (!running) break;
        process.stdout.write(frame);
      } catch (err) {
        if (!running) break;
        process.stderr.write(`[b8g-terminal-chrome] frame error: ${String(err)}\n`);
      }
      const elapsed = performance.now() - start;
      const wait = Math.max(10, frameIntervalMs - elapsed);
      await new Promise((r) => setTimeout(r, wait));
    }
  } finally {
    await cleanup();
  }
}

const opts = parseArgs(process.argv.slice(2));
if (opts.mode === 'self-test') {
  runSelfTest();
} else {
  await runBrowserShell(opts);
}
