# Unified `workerd` + `wasmer` WASI Host Audit (`third_party/workerd` + `third_party/wasmer`)

## 1. Empirical Sparse-Clone Footprint (Zero Duplicate V8 / LLVM / Cranelift)

| Upstream Repo | Sparse Checkout Scope | Disk Footprint | Eliminated Duplicate Engines |
| :--- | :--- | :---: | :--- |
| **`third_party/workerd`** (`cloudflare/workerd`) | `src/workerd/{api,jsg,server}` | **`17.20 MB`** | Duplicate V8, BoringSSL, Cap'n Proto build graph, Bazel cache |
| **`third_party/wasmer`** (`wasmerio/wasmer`) | `lib/{wasix,wasi-types,virtual-fs}` | **`5.14 MB`** | Duplicate Cranelift/LLVM/Singlepass WASM JIT compilers |

## 2. Why Both Collapse Directly Into Our ONE Shared Chromium `v8.dll` (`88.69 MB`)

1. **`workerd` (Cloudflare Workers Runtime):**
   - `workerd` is a C++ host wrapping V8 (`src/workerd/jsg`) to expose Fetch (`Request`/`Response`), `ReadableStream`, `WebCrypto`, KV, and Durable Objects.
   - Our sovereign Chromium build **already has `v8.dll` (`88.69 MB`) + Fetch + Streams + WebCrypto**.
2. **`wasmer` (WASI / WASIX Runtime):**
   - `wasmer` ships heavyweight Rust/LLVM/Cranelift compilers just to JIT `.wasm` modules and bind WASI syscalls (`fd_write`, `clock_time_get`, `environ_get`, `proc_exit`).
   - **V8 ALREADY includes Liftoff (baseline) + TurboFan (optimizing) WebAssembly JIT directly inside `v8.dll`**, plus standard WASI Preview 1 host bindings.

## 3. Unified Runtime (`intersections/b8g-workerd-wasi/`)

`b8g-worker-wasi-host.mts` (`.\bin\b8g-workerd`) runs **both**:
- Standard Cloudflare Worker `export default { async fetch(request, env, ctx) }` handlers with in-memory `KV` bindings, AND
- Direct V8 WebAssembly + WASI Preview 1 (`wasi_snapshot_preview1`) module execution inside the exact same runtime — **zero external `workerd` binary, zero external `wasmer` binary**.
