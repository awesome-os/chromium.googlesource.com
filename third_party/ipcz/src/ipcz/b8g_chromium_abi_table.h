// Copyright 2026 Awesome-OS Authors
// SPDX-License-Identifier: BSD-3-Clause
//
// @file sections/chromium-build/b8g_chromium_abi_table.h
// @description Zero-Header C11/C++20 `B8G-ABI` Static Dispatch Table for Google Chromium
// subsystem boundaries (ipcz, Blink Flex, Viz Quads, V8, Base).
//
// Includes ONLY `<stddef.h>` and `<stdint.h>` — ZERO STL, ZERO `v8.h`, ZERO `absl`,
// ZERO `Oilpan`, ZERO `skia`. Downstream callers compile & link in milliseconds and can
// hot-swap subsystem DLLs/WASM cells at runtime with zero re-linking.

#ifndef AWESOME_OS_B8G_CHROMIUM_ABI_TABLE_H_
#define AWESOME_OS_B8G_CHROMIUM_ABI_TABLE_H_

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define B8G_CHROMIUM_ABI_MAGIC 0x41473842u  /* "B8GA" */
#define B8G_CHROMIUM_ABI_VERSION 0x00020000u

typedef struct B8gFlatFlexItem32C {
  float base_size;
  float flex_grow;
  float flex_shrink;
  float min_size;
  float max_size;
  float margin_border_pad;
  float solved_size;
  uint32_t frozen;
} B8gFlatFlexItem32C;

typedef struct B8gVizQuad48C {
  float x, y, w, h;
  float r, g, b, a;
  float corner_radius;
  float z_index;
  uint32_t resource_id;
  uint32_t flags;
} B8gVizQuad48C;

typedef struct B8gIpczDispatchTable {
  size_t (*required_ring_bytes)(void);
  void (*ring_init)(void* shared_arena, uint32_t capability_epoch);
  uint32_t (*try_put)(void* shared_arena, const void* data, size_t num_bytes, uint32_t flags);
  uint32_t (*try_get)(void* shared_arena, void* out_buf, size_t cap_bytes, size_t* out_bytes);
} B8gIpczDispatchTable;

typedef struct B8gBlinkFlexDispatchTable {
  size_t (*item_bytes)(void);
  void (*solve_line)(B8gFlatFlexItem32C* items,
                     size_t count,
                     float available_main_size,
                     float gap);
} B8gBlinkFlexDispatchTable;

typedef struct B8gVizDispatchTable {
  size_t (*quad_bytes)(void);
  double (*compute_coverage_sum)(const B8gVizQuad48C* quads, size_t count);
} B8gVizDispatchTable;

typedef struct B8gV8DispatchTable {
  uint32_t (*abi_version)(void);
  int32_t (*eval_utf8)(const char* code, size_t len, char* out_buf, size_t out_cap);
} B8gV8DispatchTable;

typedef struct B8gBaseDispatchTable {
  uint64_t (*now_ns)(void);
  void* (*alloc_aligned64)(size_t bytes);
  void (*free_aligned64)(void* ptr);
} B8gBaseDispatchTable;

/* ---- Wave 2 Layers: Mojo Core, Net/QUIC, GPU/Dawn, Content/UI Shell ---- */

typedef struct B8gMojoDispatchTable {
  uint32_t (*create_pipe)(uint64_t* out_handle_a, uint64_t* out_handle_b);
  uint32_t (*write_message)(uint64_t handle, const void* data, size_t num_bytes);
  uint32_t (*read_message)(uint64_t handle, void* out_buf, size_t cap, size_t* out_bytes);
  uint32_t (*close_handle)(uint64_t handle);
} B8gMojoDispatchTable;

typedef struct B8gNetDispatchTable {
  uint32_t (*protocol_mask)(void); /* bit0=HTTP2, bit1=HTTP3/QUIC, bit2=TLS1.3 */
  int32_t (*parse_url_host)(const char* url, size_t len, char* host_out, size_t host_cap);
  uint64_t (*cache_key_fnv1a)(const char* url, size_t len);
} B8gNetDispatchTable;

typedef struct B8gGpuDispatchTable {
  uint32_t (*backend_id)(void); /* 1=DX12, 2=Vulkan, 3=Metal, 4=WebGPU */
  uint32_t (*create_surface)(uint32_t width, uint32_t height, uint32_t mode);
  uint32_t (*submit_quads_48)(uint32_t surface_id, const B8gVizQuad48C* quads, size_t count);
  uint32_t (*present)(uint32_t surface_id);
} B8gGpuDispatchTable;

typedef struct B8gShellDispatchTable {
  uint32_t (*create_tab)(const char* initial_url, size_t url_len);
  uint32_t (*navigate_tab)(uint32_t tab_id, const char* url, size_t url_len);
  uint32_t (*dispatch_key)(uint32_t tab_id, uint32_t key_code, uint32_t unicode_cp);
  uint32_t (*active_tab_count)(void);
} B8gShellDispatchTable;

typedef struct B8gChromiumAbiTable {
  uint32_t magic;
  uint32_t abi_version;
  const B8gIpczDispatchTable* ipcz;
  const B8gBlinkFlexDispatchTable* blink_flex;
  const B8gVizDispatchTable* viz;
  const B8gV8DispatchTable* v8;
  const B8gBaseDispatchTable* base;
  const B8gMojoDispatchTable* mojo;
  const B8gNetDispatchTable* net;
  const B8gGpuDispatchTable* gpu;
  const B8gShellDispatchTable* shell;
} B8gChromiumAbiTable;

#if defined(_WIN32)
#define B8G_ABI_EXPORT __declspec(dllexport)
#else
#define B8G_ABI_EXPORT __attribute__((visibility("default")))
#endif

typedef const B8gChromiumAbiTable* (*B8gGetAbiTableFn)(void);

#ifdef __cplusplus
}
#endif

#endif  // AWESOME_OS_B8G_CHROMIUM_ABI_TABLE_H_
