/**
 * Shell 1: True Carbonyl-Style Terminal Browser Shell.
 *
 * Supports three live-switchable charsets (`c` hotkey in --live mode):
 *   - 'carbonyl' (DEFAULT): True Carbonyl hybrid renderer — 24-bit Truecolor
 *     Unicode Upper Half-Block (`▀`) color blocks emulating 1x2 pixels per cell
 *     PLUS razor-sharp real DOM text overlaid directly at exact (col, row)
 *     coordinates with computed RGB foreground over sampled framebuffer background!
 *   - 'halfblock': Pure 24-bit Truecolor Unicode Upper Half-Block (`▀`) pixel blocks.
 *   - 'ascii': Classic 10-level luminance ASCII ramp (` .:-=+*#%@`) with Truecolor tint.
 */
import { type RgbaImage, resizeRgba } from './png-decoder.mts';

export type AnsiCharset = 'carbonyl' | 'halfblock' | 'ascii';

export interface TextOverlayRun {
  col: number;
  row: number;
  text: string;
  r: number;
  g: number;
  b: number;
}

export interface AnsiRenderOptions {
  cols: number;
  rows: number;
  charset?: AnsiCharset;
  /** Visible DOM text runs for true Carbonyl hybrid text+pixel rendering. */
  textRuns?: TextOverlayRun[];
  /** Wrap frame in synchronized update markers (\x1b[?2026h ... \x1b[?2026l) + cursor home. */
  liveFrame?: boolean;
  /** Optional single-line status bar painted on the final row. */
  statusBar?: string;
}

const ASCII_RAMP = ' .:-=+*#%@';

interface TextCell {
  ch: string;
  r: number;
  g: number;
  b: number;
}

export function renderAnsiFrame(img: RgbaImage, opts: AnsiRenderOptions): string {
  const cols = Math.max(8, Math.floor(opts.cols));
  const totalRows = Math.max(4, Math.floor(opts.rows));
  const drawRows = opts.statusBar ? Math.max(2, totalRows - 1) : totalRows;
  const charset: AnsiCharset = opts.charset ?? 'carbonyl';

  // Build text overlay grid when in true Carbonyl hybrid mode
  let textGrid: (TextCell | null)[] | null = null;
  if (charset === 'carbonyl' && opts.textRuns && opts.textRuns.length > 0) {
    textGrid = new Array(cols * drawRows).fill(null);
    for (const run of opts.textRuns) {
      if (run.row < 0 || run.row >= drawRows) continue;
      for (let k = 0; k < run.text.length; k++) {
        const c = run.col + k;
        if (c < 0 || c >= cols) break;
        const ch = run.text[k];
        if (ch === ' ') continue; // Let pixel blocks show cleanly behind spaces
        textGrid[run.row * cols + c] = { ch, r: run.r, g: run.g, b: run.b };
      }
    }
  }

  const parts: string[] = [];
  if (opts.liveFrame) {
    parts.push('\x1b[?2026h\x1b[H');
  }

  if (charset === 'carbonyl' || charset === 'halfblock') {
    const scaled = resizeRgba(img, cols, drawRows * 2);
    const data = scaled.data;

    for (let row = 0; row < drawRows; row++) {
      let lastFg = -1;
      let lastBg = -1;
      const topY = row * 2;
      const botY = topY + 1;
      const topRowOff = topY * cols * 4;
      const botRowOff = botY * cols * 4;

      for (let x = 0; x < cols; x++) {
        const ti = topRowOff + x * 4;
        const bi = botRowOff + x * 4;

        const tr = data[ti];
        const tg = data[ti + 1];
        const tb = data[ti + 2];
        const br = data[bi];
        const bg = data[bi + 1];
        const bb = data[bi + 2];

        const tCell = textGrid ? textGrid[row * cols + x] : null;
        if (tCell) {
          // Crisp Carbonyl text character over averaged cell background
          const bgR = (tr + br) >> 1;
          const bgG = (tg + bg) >> 1;
          const bgB = (tb + bb) >> 1;
          const fgKey = (tCell.r << 16) | (tCell.g << 8) | tCell.b;
          const bgKey = (bgR << 16) | (bgG << 8) | bgB;
          if (fgKey !== lastFg) {
            parts.push(`\x1b[38;2;${tCell.r};${tCell.g};${tCell.b}m`);
            lastFg = fgKey;
          }
          if (bgKey !== lastBg) {
            parts.push(`\x1b[48;2;${bgR};${bgG};${bgB}m`);
            lastBg = bgKey;
          }
          parts.push(tCell.ch);
          continue;
        }

        const fgKey = (tr << 16) | (tg << 8) | tb;
        const bgKey = (br << 16) | (bg << 8) | bb;

        if (fgKey === bgKey) {
          // Solid cell: space with background color only
          if (bgKey !== lastBg) {
            parts.push(`\x1b[48;2;${br};${bg};${bb}m`);
            lastBg = bgKey;
          }
          parts.push(' ');
        } else {
          if (fgKey !== lastFg) {
            parts.push(`\x1b[38;2;${tr};${tg};${tb}m`);
            lastFg = fgKey;
          }
          if (bgKey !== lastBg) {
            parts.push(`\x1b[48;2;${br};${bg};${bb}m`);
            lastBg = bgKey;
          }
          parts.push('▀');
        }
      }

      parts.push('\x1b[0m');
      if (row < drawRows - 1 || opts.statusBar) {
        parts.push('\n');
      }
    }
  } else {
    // Pure ASCII luminance + Truecolor foreground
    const scaled = resizeRgba(img, cols, drawRows);
    const data = scaled.data;
    const rampMax = ASCII_RAMP.length - 1;

    for (let row = 0; row < drawRows; row++) {
      let lastFg = -1;
      const rowOff = row * cols * 4;
      for (let x = 0; x < cols; x++) {
        const i = rowOff + x * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const ch = ASCII_RAMP[Math.min(rampMax, Math.floor((lum / 255) * ASCII_RAMP.length))];
        const fgKey = (r << 16) | (g << 8) | b;
        if (fgKey !== lastFg) {
          parts.push(`\x1b[38;2;${r};${g};${b}m`);
          lastFg = fgKey;
        }
        parts.push(ch);
      }
      parts.push('\x1b[0m');
      if (row < drawRows - 1 || opts.statusBar) {
        parts.push('\n');
      }
    }
  }

  if (opts.statusBar) {
    const bar = opts.statusBar.slice(0, cols).padEnd(cols, ' ');
    parts.push(`\x1b[48;2;18;22;30m\x1b[38;2;160;220;255m${bar}\x1b[0m`);
  }

  if (opts.liveFrame) {
    parts.push('\x1b[?2026l');
  }

  return parts.join('');
}
