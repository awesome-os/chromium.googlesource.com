// Copyright 2026 Awesome-OS Authors
// SPDX-License-Identifier: BSD-3-Clause
//
// @file sections/chromium-build/viz-fastpath/b8g_viz_quad_slab.h
// @description Zero-vtable, zero-raw_ptr 48-byte WGSL-native GPU Quad Slab fast-path
// anchored to Chromium `components/viz/common/quads/draw_quad.h` & `shared_quad_state.h`.
//
// Eliminates per-quad `virtual ~DrawQuad()` vtable pointers (+8B), `LargestDrawQuadSize()`
// union-style padding (~160-192B/quad), and `raw_ptr<const SharedQuadState>` heap indirections
// for opaque/solid/rounded UI & compositor quads.

#ifndef AWESOME_OS_B8G_VIZ_QUAD_SLAB_H_
#define AWESOME_OS_B8G_VIZ_QUAD_SLAB_H_

#include <cstddef>
#include <cstdint>
#include <vector>

namespace b8g::viz_fastpath {

struct alignas(16) B8gVizQuad48 {
  float x;
  float y;
  float w;
  float h;
  float r;
  float g;
  float b;
  float a;
  float corner_radius;
  float z_index;
  uint32_t resource_id;
  uint32_t flags;
};

static_assert(sizeof(B8gVizQuad48) == 48,
              "B8gVizQuad48 must be exactly 48 bytes (3 x 16B SIMD/WGSL vec4 lanes)");

class FlatQuadSlab {
 public:
  explicit FlatQuadSlab(size_t reserve_quads = 1024) {
    quads_.reserve(reserve_quads);
  }

  void Clear() noexcept { quads_.clear(); }

  void PushSolid(float x, float y, float w, float h,
                 float r, float g, float b, float a,
                 float radius = 0.0f, float z = 0.0f, uint32_t flags = 0) {
    quads_.push_back(B8gVizQuad48{x, y, w, h, r, g, b, a, radius, z, 0u, flags});
  }

  const B8gVizQuad48* data() const noexcept { return quads_.data(); }
  size_t size() const noexcept { return quads_.size(); }
  size_t byte_size() const noexcept { return quads_.size() * sizeof(B8gVizQuad48); }

 private:
  std::vector<B8gVizQuad48> quads_;
};

}  // namespace b8g::viz_fastpath

#endif  // AWESOME_OS_B8G_VIZ_QUAD_SLAB_H_
