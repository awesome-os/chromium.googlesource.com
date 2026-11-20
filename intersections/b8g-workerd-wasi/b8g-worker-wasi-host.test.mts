import test from 'node:test';
import assert from 'node:assert/strict';
import { B8gWorkerdHost, createMemoryKv, runWasiModule, type KvNamespace } from './b8g-worker-wasi-host.mts';

/**
 * Valid minimal WebAssembly module:
 *   (module
 *     (func (export "add") (param i32 i32) (result i32)
 *       local.get 0
 *       local.get 1
 *       i32.add))
 */
const ADD_WASM = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00,
  0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b,
]);

test('B8gWorkerdHost executes Cloudflare Worker fetch() + KV + V8 WebAssembly/WASI natively', async () => {
  const kv = createMemoryKv();
  await kv.put('motto', 'Nunquam ante, numquam iterum');

  const wasiRes = await runWasiModule(ADD_WASM);
  const addFn = wasiRes.exports.add as (a: number, b: number) => number;
  assert.equal(addFn(19, 23), 42);

  const host = new B8gWorkerdHost(
    {
      async fetch(req, env) {
        const store = env.KV as KvNamespace;
        const motto = await store.get('motto');
        const url = new URL(req.url);
        const sum = addFn(Number(url.searchParams.get('a') || 0), Number(url.searchParams.get('b') || 0));
        return new Response(JSON.stringify({ motto, sum }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
    { port: 0, env: { KV: kv } },
  );

  try {
    const url = await host.start();
    const res = await fetch(`${url}/?a=20&b=22`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { motto: string; sum: number };
    assert.equal(body.motto, 'Nunquam ante, numquam iterum');
    assert.equal(body.sum, 42);
  } finally {
    await host.stop();
  }
});
