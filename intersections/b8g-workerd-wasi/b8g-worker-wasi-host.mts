#!/usr/bin/env node
/**
 * B8G Unified `workerd` + `wasmer` WASI Host (`.\bin\b8g-workerd`).
 *
 * Unifies:
 *   1. Cloudflare Workers Fetch API (`export default { async fetch(req, env, ctx) }`) + KV bindings
 *   2. Direct V8 WebAssembly + WASI Preview 1 (`wasi_snapshot_preview1`) host execution
 * on ONE shared V8 engine — zero separate `workerd` or `wasmer` binaries.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export interface KvNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<{ keys: Array<{ name: string }> }>;
}

export function createMemoryKv(): KvNamespace {
  const store = new Map<string, string>();
  return {
    async get(key) {
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key, value) {
      store.set(key, String(value));
    },
    async delete(key) {
      store.delete(key);
    },
    async list() {
      return { keys: [...store.keys()].map((name) => ({ name })) };
    },
  };
}

export interface WasiRunResult {
  exitCode: number;
  stdout: string;
  exports: Record<string, unknown>;
}

/**
 * Minimal zero-dependency WASI Preview 1 (`wasi_snapshot_preview1`) host
 * executing `.wasm` directly on V8's built-in Liftoff + TurboFan JIT.
 */
export async function runWasiModule(
  wasmBytes: Uint8Array,
  extraImports: WebAssembly.Imports = {},
): Promise<WasiRunResult> {
  let memory: WebAssembly.Memory | null = null;
  let exitCode = 0;
  const stdoutChunks: string[] = [];
  const decoder = new TextDecoder();

  const wasiSnapshotPreview1 = {
    fd_write(fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number): number {
      if (!memory) return 8; // EBADF
      const view = new DataView(memory.buffer);
      const u8 = new Uint8Array(memory.buffer);
      let total = 0;
      for (let i = 0; i < iovsLen; i++) {
        const ptr = view.getUint32(iovsPtr + i * 8, true);
        const len = view.getUint32(iovsPtr + i * 8 + 4, true);
        if (fd === 1 || fd === 2) {
          stdoutChunks.push(decoder.decode(u8.subarray(ptr, ptr + len)));
        }
        total += len;
      }
      view.setUint32(nwrittenPtr, total, true);
      return 0;
    },
    proc_exit(code: number): void {
      exitCode = code;
      throw { __wasiExit: true, code };
    },
    clock_time_get(_id: number, _precision: bigint, timePtr: number): number {
      if (!memory) return 0;
      const view = new DataView(memory.buffer);
      view.setBigUint64(timePtr, BigInt(Date.now()) * 1_000_000n, true);
      return 0;
    },
    environ_sizes_get(countPtr: number, bufSizePtr: number): number {
      if (!memory) return 0;
      const view = new DataView(memory.buffer);
      view.setUint32(countPtr, 0, true);
      view.setUint32(bufSizePtr, 0, true);
      return 0;
    },
    environ_get(): number {
      return 0;
    },
    args_sizes_get(argcPtr: number, argvBufSizePtr: number): number {
      if (!memory) return 0;
      const view = new DataView(memory.buffer);
      view.setUint32(argcPtr, 0, true);
      view.setUint32(argvBufSizePtr, 0, true);
      return 0;
    },
    args_get(): number {
      return 0;
    },
  };

  const { instance } = await WebAssembly.instantiate(wasmBytes, {
    wasi_snapshot_preview1: wasiSnapshotPreview1,
    ...extraImports,
  });

  if (instance.exports.memory instanceof WebAssembly.Memory) {
    memory = instance.exports.memory;
  }

  if (typeof instance.exports._start === 'function') {
    try {
      (instance.exports._start as () => void)();
    } catch (e: any) {
      if (!e?.__wasiExit) throw e;
    }
  }

  return {
    exitCode,
    stdout: stdoutChunks.join(''),
    exports: instance.exports as Record<string, unknown>,
  };
}

export interface WorkerHandler {
  fetch(
    request: Request,
    env: Record<string, unknown>,
    ctx: { waitUntil(p: Promise<unknown>): void },
  ): Response | Promise<Response>;
}

export class B8gWorkerdHost {
  private server: Server;
  private handler: WorkerHandler;
  private env: Record<string, unknown>;
  private host: string;
  private port: number;

  constructor(handler: WorkerHandler, opts: { host?: string; port?: number; env?: Record<string, unknown> } = {}) {
    this.handler = handler;
    this.host = opts.host ?? '127.0.0.1';
    this.port = opts.port ?? 8787;
    this.env = opts.env ?? { KV: createMemoryKv() };
    this.server = createServer((req, res) => void this.onReq(req, res));
  }

  get url(): string {
    const addr = this.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : this.port;
    return `http://${this.host}:${port}`;
  }

  async start(): Promise<string> {
    await new Promise<void>((res, rej) => {
      this.server.once('error', rej);
      this.server.listen(this.port, this.host, () => res());
    });
    return this.url;
  }

  async stop(): Promise<void> {
    await new Promise<void>((res) => this.server.close(() => res()));
  }

  private async onReq(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const fullUrl = new URL(req.url || '/', this.url).href;
      const chunks: Buffer[] = [];
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        for await (const c of req) chunks.push(Buffer.from(c));
      }
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(', '));
      }

      const webReq = new Request(fullUrl, {
        method: req.method || 'GET',
        headers,
        body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
      });

      const pending: Promise<unknown>[] = [];
      const webRes = await this.handler.fetch(webReq, this.env, {
        waitUntil(p) {
          pending.push(p);
        },
      });

      const outHeaders: Record<string, string> = {};
      webRes.headers.forEach((v, k) => {
        outHeaders[k] = v;
      });
      res.writeHead(webRes.status, outHeaders);
      const bodyBuf = Buffer.from(await webRes.arrayBuffer());
      res.end(bodyBuf);
      if (pending.length > 0) await Promise.allSettled(pending);
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`[b8g-workerd] Worker error: ${err?.message || String(err)}`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  if (args[0] === 'wasi' && args[1]) {
    const bytes = new Uint8Array(readFileSync(resolve(args[1])));
    const res = await runWasiModule(bytes);
    if (res.stdout) process.stdout.write(res.stdout);
    process.exit(res.exitCode);
  } else if (args[0] === 'serve' && args[1]) {
    const portIdx = args.indexOf('--port');
    const port = portIdx >= 0 && args[portIdx + 1] ? Number(args[portIdx + 1]) : 8787;
    const mod = await import(pathToFileURL(resolve(args[1])).href);
    const worker: WorkerHandler = mod.default || mod;
    const host = new B8gWorkerdHost(worker, { port });
    const url = await host.start();
    console.log(`[b8g-workerd] Worker serving at ${url}`);
  } else {
    console.log('Usage:\n  b8g-workerd serve <worker.mts> [--port 8787]\n  b8g-workerd wasi  <module.wasm>');
  }
}
