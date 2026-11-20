// Copyright 2026 Awesome-OS Authors
// SPDX-License-Identifier: BSD-3-Clause
//
// Zero-header, zero-Skia, zero-raw_ptr C-ABI export for B8G Viz 48-byte GPU
// quad slabs (`b8g::viz_fastpath::B8gVizQuad48`).

#include "third_party/ipcz/src/ipcz/b8g_chromium_abi_table.h"

#include <cstddef>

static_assert(sizeof(B8gVizQuad48C) == 48,
              "B8gVizQuad48C must be exactly 48 bytes (3 x 16B SIMD/WGSL vec4 lanes)");

namespace {

size_t quad_bytes(void) {
  return sizeof(B8gVizQuad48C);
}

#if defined(__clang__)
#pragma clang unsafe_buffer_usage begin
#endif
double compute_coverage_sum(const B8gVizQuad48C* quads, size_t count) {
  if (!quads || count == 0) {
    return 0.0;
  }
  double acc = 0.0;
  for (size_t i = 0; i < count; ++i) {
    acc += static_cast<double>(quads[i].w * quads[i].h * quads[i].a);
  }
  return acc;
}
#if defined(__clang__)
#pragma clang unsafe_buffer_usage end
#endif

constexpr B8gVizDispatchTable kVizDispatchTable = {
    &quad_bytes,
    &compute_coverage_sum,
};

}  // namespace

extern "C" B8G_ABI_EXPORT const B8gVizDispatchTable* b8g_get_viz_table(void) {
  return &kVizDispatchTable;
}
