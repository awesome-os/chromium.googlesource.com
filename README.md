# awesome-os / chromium.googlesource.com (Modular Worktree-Composable Chromium)

Split out of the 2 GB Chromium monolith into independent orphan subsystem branches composable via git worktree:
- main                  (topology manifest, b8g_all_abi_stubs.gni, verified format-patch)
- layer/ipcz-spsc       (lock-free B8G_ARENA_V1 SPSC fast-path + b8g_ipcz_abi)
- layer/viz-quad48      (48-byte WGSL GPU quad slab + b8g_viz_abi)
- layer/mojo-core       (zero-header flat capability router + b8g_mojo_abi)
- layer/inmem-linker    (W^X RW->RX origin-scoped in-memory linker + O(1) VirtualFree)
- layer/win11-toolchain (Win11 24H2 SDK 10.0.26100.0 + German icacls CP850 fixes)

