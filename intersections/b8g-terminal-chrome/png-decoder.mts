/**
 * Zero-dependency pure Node.js PNG decoder + box/area downscaler.
 * Supports 8-bit PNGs with color types 0 (Gray), 2 (RGB), 3 (Indexed/PLTE),
 * 4 (Gray+Alpha), 6 (RGBA) and all 5 PNG scanline filters (None, Sub, Up, Avg, Paeth).
 */
import { inflateSync } from 'node:zlib';

export interface RgbaImage {
  width: number;
  height: number;
  /** Tightly packed RGBA8888 pixels: length === width * height * 4 */
  data: Uint8Array;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(png: Uint8Array): RgbaImage {
  if (png.length < 33) {
    throw new Error(`Invalid PNG: buffer too short (${png.length} bytes)`);
  }
  for (let i = 0; i < 8; i++) {
    if (png[i] !== PNG_SIG[i]) {
      throw new Error('Invalid PNG signature');
    }
  }

  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idatChunks: Uint8Array[] = [];

  while (offset + 12 <= png.length) {
    const length = view.getUint32(offset, false);
    const type =
      String.fromCharCode(
        png[offset + 4],
        png[offset + 5],
        png[offset + 6],
        png[offset + 7],
      );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > png.length) {
      throw new Error(`Truncated PNG chunk: ${type}`);
    }

    if (type === 'IHDR') {
      width = view.getUint32(dataStart, false);
      height = view.getUint32(dataStart + 4, false);
      bitDepth = png[dataStart + 8];
      colorType = png[dataStart + 9];
      interlace = png[dataStart + 12];
    } else if (type === 'PLTE') {
      palette = png.subarray(dataStart, dataEnd);
    } else if (type === 'tRNS') {
      trns = png.subarray(dataStart, dataEnd);
    } else if (type === 'IDAT') {
      idatChunks.push(png.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4; // skip CRC
  }

  if (width === 0 || height === 0) {
    throw new Error('PNG missing IHDR chunk');
  }
  if (bitDepth !== 8) {
    throw new Error(`Unsupported PNG bit depth: ${bitDepth} (only 8-bit supported)`);
  }
  if (interlace !== 0) {
    throw new Error('Interlaced Adam7 PNG not supported');
  }

  let channels: number;
  switch (colorType) {
    case 0:
      channels = 1;
      break;
    case 2:
      channels = 3;
      break;
    case 3:
      channels = 1;
      break;
    case 4:
      channels = 2;
      break;
    case 6:
      channels = 4;
      break;
    default:
      throw new Error(`Unsupported PNG color type: ${colorType}`);
  }

  // Concatenate IDAT chunks
  let totalIdat = 0;
  for (const c of idatChunks) totalIdat += c.length;
  const compressed = new Uint8Array(totalIdat);
  let pos = 0;
  for (const c of idatChunks) {
    compressed.set(c, pos);
    pos += c.length;
  }

  const raw = inflateSync(compressed);
  const stride = width * channels;
  const expected = height * (stride + 1);
  if (raw.length < expected) {
    throw new Error(`Inflated PNG too short: got ${raw.length}, expected ${expected}`);
  }

  const recon = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filterType = raw[y * (stride + 1)];
    const rowIn = y * (stride + 1) + 1;
    const rowOut = y * stride;
    const prevOut = (y - 1) * stride;

    for (let x = 0; x < stride; x++) {
      const val = raw[rowIn + x];
      const a = x >= channels ? recon[rowOut + x - channels] : 0;
      const b = y > 0 ? recon[prevOut + x] : 0;
      const c = y > 0 && x >= channels ? recon[prevOut + x - channels] : 0;

      let out: number;
      switch (filterType) {
        case 0:
          out = val;
          break;
        case 1:
          out = (val + a) & 0xff;
          break;
        case 2:
          out = (val + b) & 0xff;
          break;
        case 3:
          out = (val + ((a + b) >> 1)) & 0xff;
          break;
        case 4:
          out = (val + paethPredictor(a, b, c)) & 0xff;
          break;
        default:
          throw new Error(`Unknown PNG filter type: ${filterType}`);
      }
      recon[rowOut + x] = out;
    }
  }

  // Convert to RGBA8888
  const rgba = new Uint8Array(width * height * 4);
  if (colorType === 6) {
    rgba.set(recon);
  } else if (colorType === 2) {
    for (let i = 0, j = 0; i < recon.length; i += 3, j += 4) {
      rgba[j] = recon[i];
      rgba[j + 1] = recon[i + 1];
      rgba[j + 2] = recon[i + 2];
      rgba[j + 3] = 255;
    }
  } else if (colorType === 0) {
    for (let i = 0, j = 0; i < recon.length; i++, j += 4) {
      const g = recon[i];
      rgba[j] = g;
      rgba[j + 1] = g;
      rgba[j + 2] = g;
      rgba[j + 3] = 255;
    }
  } else if (colorType === 4) {
    for (let i = 0, j = 0; i < recon.length; i += 2, j += 4) {
      const g = recon[i];
      rgba[j] = g;
      rgba[j + 1] = g;
      rgba[j + 2] = g;
      rgba[j + 3] = recon[i + 1];
    }
  } else if (colorType === 3) {
    if (!palette) throw new Error('Indexed PNG missing PLTE chunk');
    for (let i = 0, j = 0; i < recon.length; i++, j += 4) {
      const idx = recon[i];
      rgba[j] = palette[idx * 3] ?? 0;
      rgba[j + 1] = palette[idx * 3 + 1] ?? 0;
      rgba[j + 2] = palette[idx * 3 + 2] ?? 0;
      rgba[j + 3] = trns && idx < trns.length ? trns[idx] : 255;
    }
  }

  return { width, height, data: rgba };
}

/**
 * Area/box downscaler (or nearest upscaler) from source RGBA image to target (dstW, dstH).
 */
export function resizeRgba(src: RgbaImage, dstW: number, dstH: number): RgbaImage {
  const w = Math.max(1, Math.floor(dstW));
  const h = Math.max(1, Math.floor(dstH));
  if (src.width === w && src.height === h) {
    return src;
  }

  const out = new Uint8Array(w * h * 4);
  const scaleX = src.width / w;
  const scaleY = src.height / h;

  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.min(src.height, Math.max(y0 + 1, Math.floor((y + 1) * scaleY)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.min(src.width, Math.max(x0 + 1, Math.floor((x + 1) * scaleX)));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;

      for (let sy = y0; sy < y1; sy++) {
        const rowOff = sy * src.width * 4;
        for (let sx = x0; sx < x1; sx++) {
          const idx = rowOff + sx * 4;
          r += src.data[idx];
          g += src.data[idx + 1];
          b += src.data[idx + 2];
          a += src.data[idx + 3];
          count++;
        }
      }

      const dstIdx = (y * w + x) * 4;
      out[dstIdx] = Math.round(r / count);
      out[dstIdx + 1] = Math.round(g / count);
      out[dstIdx + 2] = Math.round(b / count);
      out[dstIdx + 3] = Math.round(a / count);
    }
  }

  return { width: w, height: h, data: out };
}
