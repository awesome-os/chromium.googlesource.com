import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createShContext, OSC_133, runShScript } from './sh-engine.mts';

function makeTinyPng(): Uint8Array {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (b: Uint8Array) => {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length, false);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, 2, false);
  dv.setUint32(4, 2, false);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = new Uint8Array([
    0, 255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 0, 255, 255, 255, 255, 0, 255,
  ]);
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

test('b8g-sh executes POSIX variables, ${VAR:-def}, $(cmd), pipes, grep, sort, uniq, wc, if/for', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b8g-sh-'));
  try {
    const ctx = createShContext({ cwd: dir });
    const res = runShScript(
      `
      NAME="sovereign"
      echo "$NAME \${MISSING:-fallback}"
      mkdir -p sub
      printf "b\\na\\nb\\nc\\n" > sub/list.txt
      cat sub/list.txt | sort | uniq | grep -i "[a-b]" | wc -l
      if [ -f sub/list.txt ]; then echo "FILE_OK"; else echo "NO"; fi
      for x in one two; do echo "item=$x"; done
      `,
      ctx,
    );
    assert.equal(res.exitCode, 0);
    assert.ok(res.stdout.includes('sovereign fallback'));
    assert.ok(res.stdout.includes('2\n'));
    assert.ok(res.stdout.includes('FILE_OK'));
    assert.ok(res.stdout.includes('item=one') && res.stdout.includes('item=two'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b8g-sh modern terminal builtins: Kitty Graphics icat + Truecolor ANSI fallback + OSC 133/7', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b8g-sh-icat-'));
  try {
    const pngFile = join(dir, 'pixel.png');
    writeFileSync(pngFile, makeTinyPng());

    const kittyCtx = createShContext({ cwd: dir, forceKitty: true });
    const kittyOut = runShScript('icat pixel.png', kittyCtx);
    assert.equal(kittyOut.exitCode, 0);
    assert.ok(kittyOut.stdout.includes('\x1b_Ga=T,f=100'), 'Kitty mode must emit Kitty APC PNG sequence');

    const ansiCtx = createShContext({ cwd: dir, forceKitty: false });
    const ansiOut = runShScript('icat pixel.png', ansiCtx);
    assert.equal(ansiOut.exitCode, 0);
    assert.ok(ansiOut.stdout.includes('\x1b[48;2;'), 'Non-Kitty fallback must emit 24-bit Truecolor ANSI');
    assert.ok(OSC_133.promptStart.includes('\x1b]133;A'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
