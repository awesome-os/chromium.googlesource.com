// Copyright 2026 Awesome-OS Authors
// SPDX-License-Identifier: BSD-3-Clause
// Pure C11 zero-header B8G-ABI v3 contract ("Nunquam ante, numquam iterum")

#ifndef THIRD_PARTY_IPCZ_SRC_IPCZ_B8G_ABI_V3_B8G_DEP_V3_ABI_H_
#define THIRD_PARTY_IPCZ_SRC_IPCZ_B8G_ABI_V3_B8G_DEP_V3_ABI_H_

#include <stddef.h>
#include <stdint.h>

#if defined(_WIN32)
#define B8G_LINKER_EXPORT __declspec(dllexport)
#else
#define B8G_LINKER_EXPORT __attribute__((visibility("default")))
#endif

#ifdef __cplusplus
extern "C" {
#endif

#define B8G_DEP_ABI_VERSION 3u

typedef enum B8gDepId {
  B8G_DEP_IPCZ = 0,
  B8G_DEP_VIZ = 1,
  B8G_DEP_MOJO = 2,
  B8G_DEP_BLINK_FLEX = 3,
  B8G_DEP_BORINGSSL = 4,
  B8G_DEP_FFMPEG = 5,
  B8G_DEP_DAV1D = 6,
  B8G_DEP_LIBWEBP = 7,
  B8G_DEP_LIBJPEG_TURBO = 8,
  B8G_DEP_WEBRTC = 9,
  B8G_DEP_PDFIUM = 10,
  B8G_DEP_DAWN = 11,
  B8G_DEP_SKIA = 12,
  B8G_DEP_ICU = 13,
  B8G_DEP_HARFBUZZ = 14,
  B8G_DEP_FREETYPE = 15,
  B8G_DEP_SQLITE = 16,
  B8G_DEP_ZSTD = 17,
  B8G_DEP_BROTLI = 18,
  B8G_DEP_MAX = 32
} B8gDepId;

typedef struct B8gOriginAllocator {
  void* (*alloc)(void* origin_arena, size_t bytes, size_t align);
  void* (*realloc)(void* origin_arena, void* ptr, size_t bytes);
  void  (*free)(void* origin_arena, void* ptr);
} B8gOriginAllocator;

typedef struct B8gDepModuleV3 {
  uint32_t abi_version;
  uint32_t dep_id;
  const char* name;
  const char* cas_sha256;
  void* (*init_origin)(void* origin_arena, const B8gOriginAllocator* alloc);
  void  (*dispose_origin)(void* module_state);
  const void* dispatch_table;
} B8gDepModuleV3;

#ifdef __cplusplus
}  // extern "C"
#endif

#endif  // THIRD_PARTY_IPCZ_SRC_IPCZ_B8G_ABI_V3_B8G_DEP_V3_ABI_H_
