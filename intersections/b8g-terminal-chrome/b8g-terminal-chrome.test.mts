import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { decodePng, resizeRgba, type RgbaImage } from './png-decoder.mts';
import { renderAnsiFrame } from './ansi-shell.mts';
import { renderKittyPng, renderKittyRgba, clearKittyImages } from './kitty-shell.mts';
import { wrapViewportWithUiFrame } from './ui-frame.mts';

/** Minimal PNG encoder for unit-testing our zero-dep PNG decoder across filter modes. */
function encodeTestPng(width: number, height: number, rgba: Uint8Array, filterType = 0): Uint8Array {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf: Uint8Array): number => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length, false);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
    return out;
  };

  const ihdr = new Uint8Array(13);
  const idv = new DataView(ihdr.buffer);
  idv.setUint32(0, width, false);
  idv.setUint32(4, height, false);
  ihdr[8] = 8; // 8-bit
  ihdr[9] = 6; // RGBA

  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = filterType;
    for (let x = 0; x < stride; x++) {
      const cur = rgba[y * stride + x];
      const a = x >= 4 ? rgba[y * stride + x - 4] : 0;
      const b = y > 0 ? rgba[(y - 1) * stride + x] : 0;
      const c = y > 0 && x >= 4 ? rgba[(y - 1) * stride + x - 4] : 0;
      let enc = cur;
      if (filterType === 1) enc = (cur - a) & 0xff;
      else if (filterType === 2) enc = (cur - b) & 0xff;
      else if (filterType === 3) enc = (cur - ((a + b) >> 1)) & 0xff;
      else if (filterType === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        enc = (cur - pr) & 0xff;
      }
      raw[y * (stride + 1) + 1 + x] = enc;
    }
  }

  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const c1 = chunk('IHDR', ihdr);
  const c2 = chunk('IDAT', deflateSync(raw));
  const c3 = chunk('IEND', new Uint8Array(0));
  const full = new Uint8Array(sig.length + c1.length + c2.length + c3.length);
  full.set(sig, 0);
  full.set(c1, sig.length);
  full.set(c2, sig.length + c1.length);
  full.set(c3, sig.length + c1.length + c2.length);
  return full;
}

test('PNG decoder roundtrips all 5 PNG filter modes accurately', () => {
  const w = 8;
  const h = 6;
  const pixels = new Uint8Array(w * h * 4);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = (i * 37 + 13) & 0xff;
  }

  for (const filter of [0, 1, 2, 3, 4]) {
    const png = encodeTestPng(w, h, pixels, filter);
    const decoded = decodePng(png);
    assert.equal(decoded.width, w);
    assert.equal(decoded.height, h);
    assert.deepEqual(decoded.data, pixels, `Filter ${filter} mismatch`);
  }
});

test('resizeRgba averages solid quadrants cleanly', () => {
  const src: RgbaImage = {
    width: 4,
    height: 4,
    data: new Uint8Array(4 * 4 * 4),
  };
  // Fill all pixels with (100, 150, 200, 255)
  for (let i = 0; i < src.data.length; i += 4) {
    src.data[i] = 100;
    src.data[i + 1] = 150;
    src.data[i + 2] = 200;
    src.data[i + 3] = 255;
  }
  const dst = resizeRgba(src, 2, 2);
  assert.equal(dst.width, 2);
  assert.equal(dst.height, 2);
  assert.equal(dst.data[0], 100);
  assert.equal(dst.data[1], 150);
  assert.equal(dst.data[2], 200);
  assert.equal(dst.data[3], 255);
});

test('Shell 1 (ANSI): halfblock renders ▀ with 24-bit RGB and RLE elision', () => {
  // 8x4 image: top half red, bottom half blue
  const img: RgbaImage = { width: 8, height: 4, data: new Uint8Array(8 * 4 * 4) };
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 8; x++) {
      const i = (y * 8 + x) * 4;
      img.data[i] = y % 2 === 0 ? 255 : 0;
      img.data[i + 1] = 0;
      img.data[i + 2] = y % 2 === 0 ? 0 : 255;
      img.data[i + 3] = 255;
    }
  }
  const out = renderAnsiFrame(img, {
    cols: 8,
    rows: 4,
    charset: 'halfblock',
    liveFrame: true,
    statusBar: 'STATUS',
  });
  assert.ok(out.includes('\x1b[?2026h'), 'missing synchronized output start');
  assert.ok(out.includes('\x1b[?2026l'), 'missing synchronized output end');
  assert.ok(out.includes('▀'), 'missing half-block character');
  assert.ok(out.includes('38;2;255;0;0m'), 'missing top RGB fg');
  assert.ok(out.includes('48;2;0;0;255m'), 'missing bottom RGB bg');
  assert.ok(out.includes('STATUS'), 'missing status bar');
});

test('Shell 1 (ANSI): ascii mode renders luminance ramp without half-blocks', () => {
  const img: RgbaImage = { width: 8, height: 4, data: new Uint8Array(8 * 4 * 4).fill(255) };
  const out = renderAnsiFrame(img, { cols: 8, rows: 4, charset: 'ascii' });
  assert.ok(out.includes('@'), 'white pixels should map to brightest ASCII glyph');
  assert.ok(!out.includes('▀'), 'ascii mode should not emit half-block glyphs');
});

test('Shell 1 (ANSI): carbonyl hybrid overlays crisp DOM text on 24-bit color blocks', () => {
  const img: RgbaImage = { width: 12, height: 8, data: new Uint8Array(12 * 8 * 4) };
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 12; x++) {
      const i = (y * 12 + x) * 4;
      img.data[i] = 20;
      img.data[i + 1] = 40;
      img.data[i + 2] = y % 2 === 0 ? 80 : 120;
      img.data[i + 3] = 255;
    }
  }
  const out = renderAnsiFrame(img, {
    cols: 12,
    rows: 4,
    charset: 'carbonyl',
    textRuns: [{ col: 1, row: 1, text: 'B8G-OK', r: 255, g: 240, b: 10 }],
  });
  assert.ok(out.includes('▀'), 'background pixel cells should use 24-bit half-blocks');
  assert.ok(out.includes('38;2;255;240;10m'), 'text run should use computed DOM RGB color');
  assert.ok(out.includes('B') && out.includes('8') && out.includes('G'), 'text glyphs must appear verbatim');
});

test('Shell 2 (Kitty): emits compliant PNG (f=100) and chunked RGBA (f=32) APC frames', () => {
  const smallPng = encodeTestPng(2, 2, new Uint8Array(16).fill(128));
  const kPng = renderKittyPng(smallPng, { cols: 40, rows: 12, imageId: 7 });
  assert.ok(kPng.startsWith('\x1b_Ga=T,f=100,i=7,q=2,c=40,r=12,m=0;'));
  assert.ok(kPng.endsWith('\x1b\\'));

  // Large RGBA frame forces 4096-byte base64 chunking (m=1 ... m=0)
  const bigImg: RgbaImage = { width: 64, height: 64, data: new Uint8Array(64 * 64 * 4).fill(200) };
  const kRgba = renderKittyRgba(bigImg, { cols: 80, rows: 24, liveFrame: true });
  assert.ok(kRgba.includes('\x1b_Ga=T,f=32,s=64,v=64,i=1,q=2,c=80,r=24,m=1;'));
  assert.ok(kRgba.includes('\x1b_Gm=0;'));
  assert.equal(clearKittyImages(), '\x1b_Ga=d,d=A,q=2\x1b\\');
});

test('Browser UI Frame wraps viewport with tab strip, omnibox, rails, and footer', () => {
  const framed = wrapViewportWithUiFrame(
    'LINE1\nLINE2',
    {
      cols: 80,
      rows: 6,
      title: 'Awesome-OS Demo',
      url: 'https://example.com',
      modeLabel: 'ANSI:CARBONYL',
      frameCount: 7,
      captureMs: '12.3',
      omniboxFocused: true,
      omniboxBuffer: 'https://awesome-os.dev',
    },
    true,
  );
  assert.ok(framed.includes('B8G-CHROME'), 'missing browser brand');
  assert.ok(framed.includes('Awesome-OS Demo'), 'missing page title tab');
  assert.ok(framed.includes('https://awesome-os.dev█'), 'missing focused omnibox cursor');
  assert.ok(framed.includes('LINE1') && framed.includes('LINE2'), 'missing viewport body');
  assert.ok(framed.includes('#7 12.3ms'), 'missing telemetry footer');
});
