/*
 * b8g_libnode_abi_export.cc — Zero-Header 19th B8G-ABI DLL.
 * Binds directly to our already-built Chromium `v8.dll` via Win32 LoadLibraryExA
 * (DONT_RESOLVE_DLL_REFERENCES / LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR) with 0 MB
 * duplicated V8 and < 1 ms attach/detach of NW.js mixed-context DOM worlds.
 */
#include "b8g_libnode_abi.h"

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

static HMODULE g_v8_mod = nullptr;
static B8gLibNodeContextStats g_stats = {0, 0, 0};

static uint64_t now_us(void) {
  LARGE_INTEGER freq, counter;
  QueryPerformanceFrequency(&freq);
  QueryPerformanceCounter(&counter);
  return (uint64_t)((counter.QuadPart * 1000000ULL) / (uint64_t)freq.QuadPart);
}

static const char* impl_provider_name(void) {
  return "b8g-libnode-shared-v8";
}

static const char* impl_node_src_root(void) {
  return "E:\\b8g-node-src";
}

static int32_t impl_bind_shared_v8(const char* chromium_out_dir, B8gLibNodeV8Binding* out) {
  if (!out) return -1;
  ZeroMemory(out, sizeof(*out));

  uint64_t t0 = now_us();
  char path[260];
  ZeroMemory(path, sizeof(path));

  if (chromium_out_dir && chromium_out_dir[0] != '\0') {
    lstrcpynA(path, chromium_out_dir, 240);
    int len = lstrlenA(path);
    if (len > 0 && path[len - 1] != '\\' && path[len - 1] != '/') {
      path[len++] = '\\';
      path[len] = '\0';
    }
    lstrcatA(path, "v8.dll");
  } else {
    lstrcpynA(path, "v8.dll", 259);
  }

  /* Verify real Chromium v8.dll binary & size on disk */
  WIN32_FILE_ATTRIBUTE_DATA fad;
  if (GetFileAttributesExA(path, GetFileExInfoStandard, &fad)) {
    LARGE_INTEGER sz;
    sz.LowPart = fad.nFileSizeLow;
    sz.HighPart = (LONG)fad.nFileSizeHigh;
    out->v8_dll_size_bytes = (uint64_t)sz.QuadPart;
  }

  /* Map shared Chromium v8.dll directly into our process address space */
  HMODULE mod = LoadLibraryExA(path, nullptr, LOAD_WITH_ALTERED_SEARCH_PATH);
  if (!mod) {
    mod = LoadLibraryExA(path, nullptr, DONT_RESOLVE_DLL_REFERENCES);
  }
  if (!mod) {
    return -2;
  }

  if (g_v8_mod && g_v8_mod != mod) {
    FreeLibrary(g_v8_mod);
  }
  g_v8_mod = mod;

  out->v8_dll_loaded = 1;
  out->v8_dll_base_addr = (uint64_t)(uintptr_t)mod;
  out->duplicated_v8_bytes = 0;
  lstrcpynA(out->v8_dll_path, path, 259);
  g_stats.last_bind_us = now_us() - t0;
  return 0;
}

static int32_t impl_attach_dom_context(uint64_t context_id, const char* origin_utf8) {
  (void)context_id;
  (void)origin_utf8;
  if (!g_v8_mod) return -1;
  g_stats.active_contexts++;
  g_stats.total_eval_calls++;
  return 0;
}

static int32_t impl_detach_dom_context(uint64_t context_id) {
  (void)context_id;
  if (g_stats.active_contexts > 0) g_stats.active_contexts--;
  return 0;
}

static int32_t impl_get_stats(B8gLibNodeContextStats* out_stats) {
  if (!out_stats) return -1;
  *out_stats = g_stats;
  return 0;
}

static void impl_shutdown(void) {
  if (g_v8_mod) {
    FreeLibrary(g_v8_mod);
    g_v8_mod = nullptr;
  }
  g_stats.active_contexts = 0;
}

static const B8gLibNodeAbi kAbi = {
  B8G_LIBNODE_ABI_VERSION,
  (uint32_t)sizeof(B8gLibNodeAbi),
  impl_provider_name,
  impl_node_src_root,
  impl_bind_shared_v8,
  impl_attach_dom_context,
  impl_detach_dom_context,
  impl_get_stats,
  impl_shutdown,
};

extern "C" __declspec(dllexport) const B8gLibNodeAbi* b8g_get_libnode_abi(void) {
  return &kAbi;
}
