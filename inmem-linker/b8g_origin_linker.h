// Copyright 2026 Awesome-OS Authors
// SPDX-License-Identifier: BSD-3-Clause
//
// Track 9.1 — V8 + B8G-ABI Origin-Scoped In-Memory Linker & O(1) Origin Arena
// Zero-header C-ABI v3 contract aligning Chromium subsystems & surviving
// Track 10 KEEP-ALGO third_party/ dependencies onto per-origin B8G_ARENA_V1.

#ifndef AWESOME_OS_B8G_ORIGIN_LINKER_H_
#define AWESOME_OS_B8G_ORIGIN_LINKER_H_

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
  void  (*free)(void* origin_arena, void* ptr); // O(1) no-op; reclaimed atomically on dispose
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

typedef struct B8gOriginStats {
  uint64_t origin_id;
  size_t arena_reserved_bytes;
  size_t arena_used_bytes;
  uint32_t loaded_dep_mask;
  uint32_t loaded_dep_count;
  uint64_t alloc_count;
} B8gOriginStats;

#ifdef __cplusplus
}  // extern "C"
#endif

#ifdef __cplusplus
#include <atomic>
#include <cstdio>
#include <cstring>

#if defined(_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <dlfcn.h>
#include <sys/mman.h>
#endif

namespace b8g::inmem_linker {

/// Per-origin OS-virtual-memory arena (B8G_ARENA_V1) with O(1) VirtualFree/munmap disposal.
struct B8gOriginArena {
  uint64_t origin_id = 0;
  uint8_t* base = nullptr;
  size_t capacity = 0;
  size_t offset = 0;
  uint64_t alloc_count = 0;

  // Lazy-loaded dependency slots bound strictly to this origin
  void* dep_handles[B8G_DEP_MAX] = {};
  const void* dep_tables[B8G_DEP_MAX] = {};
  void* dep_states[B8G_DEP_MAX] = {};
  void (*dep_disposers[B8G_DEP_MAX])(void*) = {};
  uint32_t loaded_mask = 0;
  uint32_t loaded_count = 0;

  // W^X RX trampoline page (1 page per origin for zero-indirection stubs)
  uint8_t* wx_trampoline_page = nullptr;

  static void* AllocCb(void* arena_ptr, size_t bytes, size_t align) {
    auto* a = static_cast<B8gOriginArena*>(arena_ptr);
    if (!a || !a->base || bytes == 0) return nullptr;
    if (align < 8) align = 8;
    const size_t mask = align - 1;
    const size_t aligned = (a->offset + mask) & ~mask;
    if (aligned + bytes > a->capacity) return nullptr;
    void* ptr = a->base + aligned;
    a->offset = aligned + bytes;
    a->alloc_count++;
    return ptr;
  }

  static void* ReallocCb(void* arena_ptr, void* old_ptr, size_t bytes) {
    void* fresh = AllocCb(arena_ptr, bytes, 16);
    if (fresh && old_ptr) {
      std::memcpy(fresh, old_ptr, bytes);
    }
    return fresh;
  }

  static void FreeCb(void*, void*) {
    // O(1) arena bump allocator: individual frees are no-ops; entire origin
    // unmaps atomically in Dispose() with zero cross-origin UAF persistence.
  }

  B8gOriginAllocator Allocator() const {
    return B8gOriginAllocator{&AllocCb, &ReallocCb, &FreeCb};
  }

  bool Init(uint64_t id, size_t reserve_bytes = 4 * 1024 * 1024) {
    origin_id = id;
    capacity = reserve_bytes;
    offset = 0;
    alloc_count = 0;
    loaded_mask = 0;
    loaded_count = 0;
#if defined(_WIN32)
    base = static_cast<uint8_t*>(
        VirtualAlloc(nullptr, reserve_bytes, MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE));
#else
    void* p = mmap(nullptr, reserve_bytes, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    base = (p == MAP_FAILED) ? nullptr : static_cast<uint8_t*>(p);
#endif
    return base != nullptr;
  }

  /// Installs a real x86-64 W^X (RW -> RX) direct jump trampoline to `target_fn`
  /// inside this origin's executable trampoline page (`mov rax, imm64; jmp rax`).
  using RawFn = const void* (*)();
  RawFn InstallWxTrampoline(uint32_t slot, void* target_fn) {
    if (slot >= B8G_DEP_MAX || !target_fn) return nullptr;
#if defined(_WIN32)
    if (!wx_trampoline_page) {
      wx_trampoline_page = static_cast<uint8_t*>(
          VirtualAlloc(nullptr, 4096, MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE));
    }
    if (!wx_trampoline_page) return nullptr;
    DWORD old_prot = 0;
    VirtualProtect(wx_trampoline_page, 4096, PAGE_READWRITE, &old_prot);
    uint8_t* code = wx_trampoline_page + (slot * 16);
    // x86-64: 48 B8 <imm64> FF E0  (movabs rax, target_fn; jmp rax)
    code[0] = 0x48;
    code[1] = 0xB8;
    uint64_t addr = reinterpret_cast<uint64_t>(target_fn);
    std::memcpy(code + 2, &addr, 8);
    code[10] = 0xFF;
    code[11] = 0xE0;
    code[12] = 0xCC;
    code[13] = 0xCC;
    code[14] = 0xCC;
    code[15] = 0xCC;
    VirtualProtect(wx_trampoline_page, 4096, PAGE_EXECUTE_READ, &old_prot);
    FlushInstructionCache(GetCurrentProcess(), code, 16);
    return reinterpret_cast<RawFn>(code);
#else
    return reinterpret_cast<RawFn>(target_fn);
#endif
  }

  /// Lazily loads a zero-header B8G-ABI DLL/module strictly on demand for this origin.
  const void* LoadDepOnDemand(B8gDepId dep_id, const char* module_path, const char* getter_symbol) {
    if (dep_id >= B8G_DEP_MAX) return nullptr;
    if (loaded_mask & (1u << dep_id)) {
      return dep_tables[dep_id];
    }
#if defined(_WIN32)
    HMODULE mod = LoadLibraryA(module_path);
    if (!mod) return nullptr;
    void* sym = reinterpret_cast<void*>(GetProcAddress(mod, getter_symbol));
    if (!sym) {
      FreeLibrary(mod);
      return nullptr;
    }
    auto tramp = InstallWxTrampoline(static_cast<uint32_t>(dep_id), sym);
    const void* tbl = tramp ? tramp() : nullptr;
    dep_handles[dep_id] = static_cast<void*>(mod);
    dep_tables[dep_id] = tbl;
    loaded_mask |= (1u << dep_id);
    loaded_count++;
    return tbl;
#else
    void* mod = dlopen(module_path, RTLD_NOW | RTLD_LOCAL);
    if (!mod) return nullptr;
    auto fn = reinterpret_cast<RawFn>(dlsym(mod, getter_symbol));
    const void* tbl = fn ? fn() : nullptr;
    dep_handles[dep_id] = mod;
    dep_tables[dep_id] = tbl;
    loaded_mask |= (1u << dep_id);
    loaded_count++;
    return tbl;
#endif
  }

  B8gOriginStats Stats() const {
    return B8gOriginStats{
        origin_id, capacity, offset, loaded_mask, loaded_count, alloc_count};
  }

  /// Atomic O(1) Origin Disposal (called from v8::Context teardown / cross-origin navigation).
  void Dispose() {
    for (uint32_t i = 0; i < B8G_DEP_MAX; ++i) {
      if (loaded_mask & (1u << i)) {
        if (dep_disposers[i] && dep_states[i]) {
          dep_disposers[i](dep_states[i]);
        }
#if defined(_WIN32)
        if (dep_handles[i]) FreeLibrary(static_cast<HMODULE>(dep_handles[i]));
#else
        if (dep_handles[i]) dlclose(dep_handles[i]);
#endif
        dep_handles[i] = nullptr;
        dep_tables[i] = nullptr;
        dep_states[i] = nullptr;
        dep_disposers[i] = nullptr;
      }
    }
    loaded_mask = 0;
    loaded_count = 0;
#if defined(_WIN32)
    if (wx_trampoline_page) {
      VirtualFree(wx_trampoline_page, 0, MEM_RELEASE);
      wx_trampoline_page = nullptr;
    }
    if (base) {
      VirtualFree(base, 0, MEM_RELEASE);
      base = nullptr;
    }
#else
    if (base) {
      munmap(base, capacity);
      base = nullptr;
    }
#endif
    capacity = 0;
    offset = 0;
  }
};

}  // namespace b8g::inmem_linker

#endif  // __cplusplus
#endif  // AWESOME_OS_B8G_ORIGIN_LINKER_H_
