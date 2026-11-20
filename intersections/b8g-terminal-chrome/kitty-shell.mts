/**
 * Shell 2: Pixel-Perfect Kitty Graphics Protocol Terminal Shell.
 *
 * Implements the Kitty Terminal Graphics Protocol (APC `\x1b_G...\x1b\\`)
 * for Kitty, Ghostty, WezTerm, Rio, and compatible terminal emulators:
 *   - `format: 'png'` (default): Direct zero-reencode PNG pass-through (`f=100`).
 *   - `format: 'rgba'`: Raw RGBA32 (`f=32,s=<w>,v=<h>`) frame upload.
 *
 * Chunks base64 payloads strictly at <= 4096 bytes per APC escape per spec.
 */
import type { RgbaImage } from './png-decoder.mts';

export type KittyFormat = 'png' | 'rgba';

export interface KittyRenderOptions {
  /** Target terminal columns to occupy (optional; lets terminal scale cleanly). */
  cols?: number;
  /** Target terminal rows to occupy (optional; leaves room for status bar). */
  rows?: number;
  /** Placement image ID for flicker-free replacement in live mode (default 1). */
  imageId?: number;
  /** Quiet level: 2 suppresses terminal OK/ERR responses (default 2). */
  quiet?: 0 | 1 | 2;
  /** Wrap with cursor home + synchronized output for live streaming. */
  liveFrame?: boolean;
  /** Optional status line printed below the image. */
  statusBar?: string;
}

const MAX_CHUNK_SIZE = 4096;

function emitKittyChunked(headerParams: string, payloadBase64: string, opts: KittyRenderOptions): string {
  const parts: string[] = [];

  if (opts.liveFrame) {
    parts.push('\x1b[?2026h\x1b[H');
  }

  const totalLen = payloadBase64.length;
  if (totalLen <= MAX_CHUNK_SIZE) {
    parts.push(`\x1b_G${headerParams},m=0;${payloadBase64}\x1b\\`);
  } else {
    let offset = 0;
    let first = true;
    while (offset < totalLen) {
      const end = Math.min(offset + MAX_CHUNK_SIZE, totalLen);
      const more = end < totalLen ? 1 : 0;
      const chunk = payloadBase64.slice(offset, end);
      if (first) {
        parts.push(`\x1b_G${headerParams},m=${more};${chunk}\x1b\\`);
        first = false;
      } else {
        parts.push(`\x1b_Gm=${more};${chunk}\x1b\\`);
      }
      offset = end;
    }
  }

  if (opts.statusBar) {
    const cols = opts.cols ?? 100;
    const bar = opts.statusBar.slice(0, cols).padEnd(cols, ' ');
    if (opts.rows && opts.liveFrame) {
      // Position cursor on the row immediately beneath the image
      parts.push(`\x1b[${opts.rows + 1};1H`);
    } else {
      parts.push('\n');
    }
    parts.push(`\x1b[48;2;18;22;30m\x1b[38;2;120;255;180m${bar}\x1b[0m`);
  }

  if (opts.liveFrame) {
    parts.push('\x1b[?2026l');
  }

  return parts.join('');
}

/**
 * Emits a Kitty Graphics Protocol frame directly from a PNG buffer (`f=100`).
 */
export function renderKittyPng(pngBytes: Uint8Array, opts: KittyRenderOptions = {}): string {
  const q = opts.quiet ?? 2;
  const id = opts.imageId ?? 1;
  const params = [`a=T`, `f=100`, `i=${id}`, `q=${q}`];
  if (opts.cols) params.push(`c=${Math.floor(opts.cols)}`);
  if (opts.rows) params.push(`r=${Math.floor(opts.rows)}`);
  const b64 = Buffer.from(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength).toString('base64');
  return emitKittyChunked(params.join(','), b64, opts);
}

/**
 * Emits a Kitty Graphics Protocol frame from a raw RGBA8888 image (`f=32`).
 */
export function renderKittyRgba(img: RgbaImage, opts: KittyRenderOptions = {}): string {
  const q = opts.quiet ?? 2;
  const id = opts.imageId ?? 1;
  const params = [`a=T`, `f=32`, `s=${img.width}`, `v=${img.height}`, `i=${id}`, `q=${q}`];
  if (opts.cols) params.push(`c=${Math.floor(opts.cols)}`);
  if (opts.rows) params.push(`r=${Math.floor(opts.rows)}`);
  const b64 = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength).toString('base64');
  return emitKittyChunked(params.join(','), b64, opts);
}

/**
 * Clears all Kitty Graphics Protocol images currently displayed in the terminal.
 */
export function clearKittyImages(): string {
  return '\x1b_Ga=d,d=A,q=2\x1b\\';
}
