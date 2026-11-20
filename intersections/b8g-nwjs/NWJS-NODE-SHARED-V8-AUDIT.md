# NW.js Shell & Node.js Shared-V8 Audit (`E:\b8g-nwjs` + `E:\b8g-node-src`)

## 1. Empirical Sparse-Clone Audit (Near-Zero Storage)

| Repo | Sparse Checkout Scope | Disk Footprint | Files | Eliminated Bloat |
| :--- | :--- | :---: | :---: | :--- |
| **`E:\b8g-nwjs`** (`nwjs/nw.js`) | `src/{api,browser,renderer}` | **`1.66 MB`** | `246` | Full Chromium fork patches, test fixtures, CI, prebuilts |
| **`E:\b8g-node-src`** (`nodejs/node`) | `src/` + `lib/` ONLY | **`14.24 MB`** | `497` C++ + `438` JS lib | **~1.18 GB** of duplicate `deps/v8`, `deps/icu`, `deps/openssl`, `test/` |

## 2. Why Node.js Needs Zero Duplicate V8 in Our Stack

Our sovereign Chromium build (`E:\b8g-chromium-real\src\out\B8gRelease\`) **already built and exports**:
- `v8.dll` (`88.69 MB`), `v8_libbase.dll`, `v8_libplatform.dll`
- `icui18n.dll`, `icuuc.dll`
- `zlib.dll`, `boringssl`

Node.js (`src/` + `lib/`) is literally **`14.24 MB` of thin C++/JS wrapper** on top of that exact V8 + ICU + crypto substrate.

## 3. NW.js 1:1 Shell Principle (`intersections/b8g-nwjs/`)

Audited from `E:\b8g-nwjs\src\api\` (`nw_app`, `nw_window`, `nw_shell`, `nw_clipboard`, `nw_menu`, `nw_screen`, `nw_shortcut`, `nw_tray`):
- **Manifest-first launch:** Reads standard NW.js `package.json` (`"main": "index.html"`, `"window": { title, width, height }`).
- **Mixed-Context DOM + Node:** Injects `window.nw`, `window.process`, and `window.require('os' | 'fs' | 'path' | 'nw.gui')` directly into the DOM window on our **ONE shared `chrome.exe`** (`0 MB` duplicated Chromium, zero Chromium C++ patches).
- **Next native step (`libnode` C-ABI):** Compile `E:\b8g-node-src\src\` directly against `E:\b8g-chromium-real\src\out\B8gRelease\v8.dll.lib` + `libuv` as our 19th zero-header `B8G-ABI` DLL (`b8g_libnode_abi.dll`) so native `node::CreateEnvironment(isolate, context)` binds directly into Blink's V8 `v8::Context` with zero IPC serialization overhead.
