# B8G Terminal Chrome (`ansi` + `kitty` Shells)

Two zero-dependency terminal browser shells powered directly by our sovereign real Chromium build (`E:\b8g-chromium-real\src\out\B8gRelease\chrome.exe`) via Chrome DevTools Protocol (`--headless=new`).

## Why `niutech/carbonyl-terminal` & `fathyb/carbonyl` Were Debloated

We cloned and audited `https://github.com/niutech/carbonyl-terminal` into `E:\b8g-carbonyl-terminal`:

- **`6.29 MB` → `4.8 KB` (`99.92%` bloat deleted):**
  - Deleted `docker/tmux` (`6.28 MB` static Linux binary)
  - Deleted hardcoded OpenSSH private keys (`carbonyl_rsa`, `carbonyl_rsa.ppk`, plus keys embedded inside `carbonyl.bat` and `carbonyl.sh`) pointing at `carbonyl@app.kodus.pl`
  - Deleted `docker/Dockerfile` and `docker/docker-compose.yml` wrapping the abandoned `fathyb/carbonyl:latest` container
- **Why `fathyb/carbonyl` became unmaintainable:** It patched Chromium's internal C++ `headless/` and `viz/` layers directly, breaking on every Chromium milestone upgrade.
- **Our sovereign replacement:** **Zero** C++ patches inside Chromium. We drive our live `chrome.exe` via built-in Node 22+ `fetch` + `WebSocket` CDP (`Page.captureScreenshot` + `Input.dispatchMouseEvent`) and expose **two** clean terminal shells:

| Shell | Protocol | Target Terminals | Highlights |
| :--- | :--- | :--- | :--- |
| **`ansi`** | 24-bit Truecolor Unicode Half-Block (`▀`) + ASCII ramp | Windows Terminal, PowerShell, xterm, tmux, SSH | 2× vertical resolution, ANSI RGB run-length elision, synchronized updates (`\x1b[?2026h`), zero npm deps (pure `node:zlib` PNG decoder) |
| **`kitty`** | Kitty Graphics Protocol (`\x1b_Ga=T,f=100` / `f=32`) | Kitty, Ghostty, WezTerm, Rio | Native pixel-perfect PNG pass-through (`f=100`) or raw RGBA32 (`f=32`), 4096-byte RFC chunking, live `m` hotkey switch `ansi ↔ kitty` |

## Usage (PowerShell)

```powershell
# Shell 1 — Debloated Carbonyl-style Truecolor Half-Block ANSI (single frame)
.\bin\b8g-terminal-chrome.ps1 ansi https://example.com

# Shell 1 — Live interactive browsing in Windows Terminal
.\bin\b8g-terminal-chrome.ps1 ansi docs/media/b8g-living-frame-studio.html --live --fps 5

# Shell 1 — Retro ASCII luminance mode
.\bin\b8g-terminal-chrome.ps1 ansi https://example.com --charset ascii

# Shell 2 — Pixel-Perfect Kitty Graphics Protocol (Kitty / Ghostty / WezTerm / Rio)
.\bin\b8g-terminal-chrome.ps1 kitty docs/media/b8g-living-frame-studio.html --live --fps 6

# Unit tests
.\bin\node.ps1 --test intersections/b8g-terminal-chrome/b8g-terminal-chrome.test.mts
```
