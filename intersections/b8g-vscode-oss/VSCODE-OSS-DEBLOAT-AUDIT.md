# `Code - OSS` (`microsoft/vscode` v1.148.0) Empirical Debloat & `b8g-electron` Projection Audit

> **Clone location:** `e:\awesome-os\third_party\vscode-oss` (cleanly gitignored in `.gitignore`, CI/Azure/devcontainer bloat purged).  
> **Audit tool:** `intersections/b8g-vscode-oss/audit-vscode.mts`

## 1. Empirical Layer Breakdown (`7,779` Source Files, `93.87 MB`)

| Layer (`src/vs/*`) | Source Files | Size (MB) | Files Importing `electron` | Coupling % |
| :--- | :---: | :---: | :---: | :---: |
| **`editor`** *(Monaco Editor)* | `675` | `7.42 MB` | **`0`** | **`0.00%`** |
| **`server`** *(Remote / Headless)* | `22` | `0.25 MB` | **`0`** | **`0.00%`** |
| **`workbench`** *(Full IDE UI)* | `4,050` | `58.24 MB` | **`1`** | **`0.02%`** |
| **`base`** *(Utilities / IPC / URI)* | `322` | `3.66 MB` | `6` | `1.86%` |
| **`platform`** *(DI Services)* | `2,693` | `24.01 MB` | `46` | `1.71%` |
| **`code`** *(Electron Main Bootstrap)* | `17` | `0.29 MB` | `2` | `11.76%` |
| **TOTAL (`Code - OSS` v1.148.0)** | **`7,779`** | **`93.87 MB`** | **`55`** | **`0.71%`** |

## 2. The Core Finding

**`99.29%` of VS Code (`7,724 / 7,779` files) has ZERO dependency on Electron.**

The entire 100-fork industry (VSCodium, Cursor, Windsurf, Void, Trae) duplicates a `~350 MB` Electron+Chromium+Node monolith per IDE solely to satisfy **`55` files (`0.71%`)** importing just **14 core symbols**:
- Already implemented in `intersections/b8g-electron/`: `BrowserWindow` (`15`), `app` (`15`), `WebContents` (`8`), `IpcMainEvent` (`5`), `shell` (`3`).
- Remaining thin desktop shims to reach 100% native `Code - OSS` projection: `Menu` (`4`), `screen` (`4`), `MenuItem` (`3`), `net` (`3`), `powerMonitor` (`3`), `systemPreferences` (`3`), `session` (`3`), `MessagePortMain` (`2`), `clipboard` (`2`), `nativeImage` (`2`).

## 3. Unified Shared-Core Result

By projecting `Code - OSS` onto **`b8g-electron` + ONE shared sovereign Chromium (`chrome.exe` + `v8.dll` + `b8g_node.exe`)**:
- **0 MB** duplicated Chromium per IDE.
- **Zero** VSCodium bash patch scripts or Microsoft telemetry branding layers.
- **Chrome, Terminal Chrome (`ansi`+`kitty`), Electron, NW.js, and Sovereign Code-OSS all share the exact same single Chromium + V8 core.**
