# B8G Chrome (v2026.11.20-b8g-sovereign)

A fast, sovereign Chromium browser for Windows 11 — with open-source E2EE sync by default (1:1 hot-swappable with Google Sync or Local-Only), zero telemetry lock-in, and an optional lightweight **Dev Bundle Addon** that unlocks Electron, NW.js, Node, WASM/WASI, Code-OSS, and terminal shells on top of the exact same browser engine.

## 1. Consumer Browser (Windows 64-bit)

1. Download **`B8G-Chrome-win64.zip`** (**`584.6 MB`**).
2. Right-click → **Extract All**.
3. Double-click **`B8G-Chrome.exe`**.

## 2. Optional: Dev Bundle Addon (Electron · NW.js · Node · WASM/WASI · Code-OSS · Shells)

1. Download **`B8G-Dev-Bundle-Addon-win64.zip`** (**`244.3 KB`** — **0 MB duplicated Chromium**).
2. Extract directly into your `B8G-Chrome` folder.
3. Run Electron apps, NW.js apps, `b8g_node.exe`, Cloudflare Workers / WASI `.wasm` modules, `b8g-vscode`, `b8g-terminal-chrome`, `b8g-git-server`, `b8g-pwsh`, and `b8g-sh` directly against `B8G-Chrome`'s shared engine.

## Verification (SHA-256)

| File | Size | Purpose | SHA-256 |
| :--- | :---: | :--- | :--- |
| `B8G-Chrome-win64.zip` | **`584.6 MB`** | Consumer Browser (unzip & click `B8G-Chrome.exe`) | `d6f1b4e1e54e36dbbe9cc2771ebf61684f3d004b128debe14965ddc302b46032` |
| `B8G-Dev-Bundle-Addon-win64.zip` | **`244.3 KB`** | Optional Dev Bundle Addon (Electron, NW.js, Node, WASM, Code-OSS, Shells) | `faa1d5751a3af6da5fca6ba3cbf9c007c6af9aa5a7d84d8df7407d46a6a36f9d` |