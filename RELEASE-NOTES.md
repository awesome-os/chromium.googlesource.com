# Awesome-OS Sovereign Chrome Stack (v2026.11.20-b8g-sovereign)

> *„Nunquam ante, numquam iterum“* — **One Shared Chromium + V8 Core. Nine Unified Ecosystems. Zero CI. Verified on Real Hardware.**

---

## Which Download Should I Pick?

- **Want to double-click and run the browser immediately on Windows 11?** → Download **`b8g-chromium-full-win64.zip`**, unzip, and launch **`b8g_chrome.exe`**.
- **Want the Linux x86_64 ELF `.so` Binary Strangler Fig & ABI Pack?** → Download **`b8g-chrome-abi-linux-x64.tar.gz`** (cross-compiled natively on Windows via Zig `0.14.1` — zero WSL/Docker).
- **Want all 10 zero-patch shells (Terminal Chrome, Electron, NW.js, Code-OSS, Workerd/WASI, Git Forge, Zero-CLR PowerShell, Modern POSIX `b8g-sh`)?** → Download **`b8g-shells-suite-win64.zip`**.

---

## Architectural Highlights (Measured on Real Silicon)

| Breakthrough | Metric / Proof |
| :--- | :--- |
| **11.8 KB Binary Strangler Fig (`ChromeMain` Facade)** | `149 KB` Win64 DLL / `11.8 KB` Linux x86_64 ELF `.so` intercepts `ChromeMain` in **`1.996 ms`**, pre-booting `B8gCloudSyncAbi` + `b8g_libnode_abi` before line 1 of `chrome_real.dll` |
| **Zero-Header Sovereign Launcher (`b8g_chrome.exe`)** | **`156 KB`** (vs. `2,553 KB` stock), `1` header, zero STL, boots 18/18 real Chromium DLLs in **`4.03 ms`** |
| **Zero-Q Local Fast-Build (Zero CI)** | **`3.83 ms`** warm all-18 DLL rebuild / **`130 ms`** single-file edit / **`2.32 s`** cold (`0 siso / 0 gn / 0 python`) |
| **1:1 Hot-Swappable Cloud Sync (`B8gCloudSyncAbi`)** | Swap `oss` (E2EE SUBSTRATE) ↔ `google` ↔ `local` in **`~350 µs`** live at runtime |
| **Shared-V8 Node.js (`b8g_node.exe` + `b8g_libnode_abi`)** | **`150.5 KB`** CLI binary binding to shared **`88.69 MB` `v8.dll`** in **`1.83 ms`** (**`0 B`** duplicated V8) |
| **Zero-Patch Multi-Shell Suite** | `b8g-terminal-chrome` (True Carbonyl Hybrid `▀` + DOM text + UI frame + Kitty APC), `b8g-electron` (`0 MB` dup Chromium), `b8g-nwjs`, `b8g-vscode` (`Code-OSS v1.148.0`, **`99.29%`** zero-Electron), `b8g-workerd` (Workers + V8 WASI), `b8g-git-server`, `b8g-pwsh` (`0 MB` .NET CLR), `b8g-sh` (Zero-MSYS2 POSIX + Kitty `icat` + OSC 133/7) |
| **Governance & Parity** | **`116/116`** atomic `(posix, cmd+UTF8, ps1)` bin triplets (`0` violations) + **`8/8`** live upstream tracker & HTTP Inference Point (`b8g-maintain`) |

---

## Quick Start

```powershell
# Launch Sovereign Chromium (from b8g-chromium-full-win64.zip)
.\b8g_chrome.exe

# Run Sovereign Chromium inside Windows Terminal / cmd.exe (True Carbonyl Hybrid + UI Frame)
.\bin\b8g-terminal-chrome ansi https://example.com --live --fps 5

# Run Electron / NW.js / Code-OSS on ONE shared Chromium core (0 MB duplicate Chromium)
.\bin\b8g-electron intersections/b8g-electron/demo-app
.\bin\b8g-nwjs     intersections/b8g-nwjs/demo-app
.\bin\b8g-vscode

# Run Zero-CLR PowerShell (.ps1) & Zero-MSYS2 Modern POSIX Shell
.\bin\b8g-pwsh -Command "[System.Environment]::MachineName; [math]::Round(3.14159, 2)"
.\bin\b8g-sh   -c "ls intersections | wc -l"

# Verify 8/8 live upstreams & 100% bin parity
.\bin\b8g-maintain status --remote
```

---

## Provenance
- **Awesome-OS:** `unknown` @ `unknown`
- **Upstream Chromium Core:** `unknown` @ `unknown` (modular 12-branch mirror: `awesome-os/chromium.googlesource.com`)
- **Zero-Header ABI Binaries Included:** `26` Win64 + `5` Linux x86_64 ELF `.so`

---

## Release Artifacts & SHA-256 Checksums

| Artifact | Size | Description | SHA-256 |
| :--- | :---: | :--- | :--- |
| `b8g-chrome-abi-win64.zip` | **`1.4 MB`** | Windows x64 Zero-Header ABI Overlay (`b8g_chrome.exe` 156 KB, `b8g_chrome_facade.dll` 149 KB, `b8g_node.exe` 150.5 KB, 19 `B8G-ABI` DLLs, 3 hot-swappable `B8gCloudSyncAbi` DLLs) | `1f08a7a981d1f990336ce0dadddb10cb9cc678cecc816678d46b22925afd8ff0` |
| `b8g-chrome-abi-linux-x64.tar.gz` | **`1.6 MB`** | Linux x86_64 ELF `.so` ABI Pack (`libb8g_chrome_facade.so` 11.8 KB, `libb8g_libnode_abi.so`, 3 `libb8g_cloud_sync_*_abi.so`) — **cross-compiled on Windows 11 via Zig 0.14.1 (zero WSL/Docker)** | `8da4eb1da60b8219ab47b34920e933d2f2a81705d5ff480da2d7250815a63d2d` |
| `b8g-shells-suite-win64.zip` | **`90.0 KB`** | All 10 Zero-Patch Projections (`b8g-terminal-chrome` [ANSI Carbonyl Hybrid + Kitty + UI Frame], `b8g-electron`, `b8g-nwjs`, `b8g-vscode`, `b8g-workerd`, `b8g-git-server`, `b8g-pwsh`, `b8g-sh`, `b8g-maintain`, `b8g-bin-parity`) | `ee82c570038a48e5125f07f9bd89515671d524203c8a5c96cfec46980f1e0a7b` |
| `b8g-white-dragon-and-demos.zip` | **`40.0 KB`** | *The White Dragon Book* (Articles 1 & 2), `SOVEREIGN-CHROME-STACK-ARCHITECTURE.md`, and 60 FPS zero-dependency showcase demos | `401404345cf605007cf529bba77eceb770523b4198b3c4ccf3205f8ca902b0cb` |
| `b8g-chromium-full-win64.zip` | **`584.5 MB`** | **Complete Standalone Runnable Windows x64 Browser** (`b8g_chrome.exe`, `chrome.exe`, `b8g_node.exe`, `b8g_chrome_facade.dll`, `v8.dll`, `chrome.dll`, all 551 runtime DLLs, `.pak`, `locales/`) | `b85fa847988a4f5dd66605cdd7455093602e4deecc5ff204050f74c070095300` |
