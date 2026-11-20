/*
 * Track 30 — Zero-Header Cross-Platform `chrome.dll` / `libchrome.so` Strangler-Fig Facade.
 *
 * Exports the exact `ChromeMain` entry point that `chrome.exe` calls inside `chrome.dll`
 * (166.41 MB). Intercepts `ChromeMain` before line 1 of Chromium runs:
 *   1. Boots hot-swappable `B8gCloudSyncAbi` (oss | google | local via B8G_CLOUD_SYNC_PROVIDER)
 *   2. Boots `b8g_libnode_abi` (shared-V8 Node embedder)
 *   3. Forwards `ChromeMain` transparently to `chrome_real.dll` (or `B8G_CHROME_REAL_DLL`)
 *
 * Compiles natively for Win64 (`clang++`) AND cross-compiles for Linux x86_64 ELF
 * right on Windows 11 via `zig c++ -target x86_64-linux-gnu -shared -fPIC -O2`.
 */
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
  #define WIN32_LEAN_AND_MEAN
  #include <windows.h>
  #define B8G_FACADE_EXPORT __declspec(dllexport)
  typedef int (__cdecl *ChromeMainWinFn)(HINSTANCE, void*, int64_t);
#else
  #include <dlfcn.h>
  #include <time.h>
  #define B8G_FACADE_EXPORT __attribute__((visibility("default")))
  typedef int (*ChromeMainPosixFn)(int, const char**);
#endif

typedef struct B8gChromeFacadeTelemetry {
  uint32_t facade_version;
  uint32_t cloud_sync_loaded;
  uint32_t libnode_loaded;
  uint32_t real_chrome_loaded;
  uint64_t intercept_us;
  char     cloud_sync_provider[64];
} B8gChromeFacadeTelemetry;

static B8gChromeFacadeTelemetry g_telemetry = {1u, 0u, 0u, 0u, 0ULL, "oss"};

static uint64_t now_us(void) {
#ifdef _WIN32
  LARGE_INTEGER freq, counter;
  QueryPerformanceFrequency(&freq);
  QueryPerformanceCounter(&counter);
  return (uint64_t)((counter.QuadPart * 1000000ULL) / (uint64_t)freq.QuadPart);
#else
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (uint64_t)ts.tv_sec * 1000000ULL + (uint64_t)(ts.tv_nsec / 1000ULL);
#endif
}

static void get_module_dir(char* out, size_t cap) {
#ifdef _WIN32
  HMODULE self = nullptr;
  GetModuleHandleExA(
    GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
    (LPCSTR)&get_module_dir,
    &self);
  DWORD n = GetModuleFileNameA(self, out, (DWORD)cap);
  if (n == 0 || n >= cap) {
    snprintf(out, cap, ".");
    return;
  }
  for (int i = (int)n - 1; i >= 0; --i) {
    if (out[i] == '\\' || out[i] == '/') {
      out[i] = '\0';
      return;
    }
  }
  snprintf(out, cap, ".");
#else
  Dl_info info;
  if (dladdr((const void*)&get_module_dir, &info) && info.dli_fname) {
    snprintf(out, cap, "%s", info.dli_fname);
    char* slash = strrchr(out, '/');
    if (slash) *slash = '\0';
    else snprintf(out, cap, ".");
  } else {
    snprintf(out, cap, ".");
  }
#endif
}

static void boot_b8g_intersections(const char* dir) {
  const char* prov = getenv("B8G_CLOUD_SYNC_PROVIDER");
  if (!prov || prov[0] == '\0') prov = "oss";
  snprintf(g_telemetry.cloud_sync_provider, sizeof(g_telemetry.cloud_sync_provider), "%s", prov);

  char sync_path[512];
  char node_path[512];

#ifdef _WIN32
  snprintf(sync_path, sizeof(sync_path), "%s\\b8g_cloud_sync_%s_abi.dll", dir, prov);
  snprintf(node_path, sizeof(node_path), "%s\\b8g_libnode_abi.dll", dir);
  if (LoadLibraryA(sync_path)) g_telemetry.cloud_sync_loaded = 1u;
  if (LoadLibraryA(node_path)) g_telemetry.libnode_loaded = 1u;
#else
  snprintf(sync_path, sizeof(sync_path), "%s/libb8g_cloud_sync_%s_abi.so", dir, prov);
  snprintf(node_path, sizeof(node_path), "%s/libb8g_libnode_abi.so", dir);
  if (dlopen(sync_path, RTLD_LAZY | RTLD_LOCAL)) g_telemetry.cloud_sync_loaded = 1u;
  if (dlopen(node_path, RTLD_LAZY | RTLD_LOCAL)) g_telemetry.libnode_loaded = 1u;
#endif
}

extern "C" B8G_FACADE_EXPORT const B8gChromeFacadeTelemetry* b8g_chrome_facade_telemetry(void) {
  return &g_telemetry;
}

#ifdef _WIN32
extern "C" B8G_FACADE_EXPORT int __cdecl ChromeMain(
    HINSTANCE instance,
    void* sandbox_info,
    int64_t exe_entry_point_ticks) {
  uint64_t t0 = now_us();
  char dir[512];
  get_module_dir(dir, sizeof(dir));
  boot_b8g_intersections(dir);

  char real_path[512];
  const char* override_dll = getenv("B8G_CHROME_REAL_DLL");
  if (override_dll && override_dll[0] != '\0') {
    snprintf(real_path, sizeof(real_path), "%s", override_dll);
  } else {
    snprintf(real_path, sizeof(real_path), "%s\\chrome_real.dll", dir);
  }

  HMODULE real_mod = LoadLibraryExA(real_path, nullptr, LOAD_WITH_ALTERED_SEARCH_PATH);
  if (!real_mod) {
    g_telemetry.intercept_us = now_us() - t0;
    fprintf(stderr, "[b8g_chrome_facade] Failed to load %s (err=%lu)\n", real_path, GetLastError());
    return -1001;
  }
  g_telemetry.real_chrome_loaded = 1u;

  auto real_main = (ChromeMainWinFn)GetProcAddress(real_mod, "ChromeMain");
  g_telemetry.intercept_us = now_us() - t0;
  if (!real_main) {
    fprintf(stderr, "[b8g_chrome_facade] Missing ChromeMain export in %s\n", real_path);
    return -1002;
  }

  return real_main(instance, sandbox_info, exe_entry_point_ticks);
}
#else
extern "C" B8G_FACADE_EXPORT int ChromeMain(int argc, const char** argv) {
  uint64_t t0 = now_us();
  char dir[512];
  get_module_dir(dir, sizeof(dir));
  boot_b8g_intersections(dir);

  char real_path[512];
  const char* override_so = getenv("B8G_CHROME_REAL_DLL");
  if (override_so && override_so[0] != '\0') {
    snprintf(real_path, sizeof(real_path), "%s", override_so);
  } else {
    snprintf(real_path, sizeof(real_path), "%s/libchrome_real.so", dir);
  }

  void* real_mod = dlopen(real_path, RTLD_NOW | RTLD_LOCAL);
  if (!real_mod) {
    g_telemetry.intercept_us = now_us() - t0;
    fprintf(stderr, "[b8g_chrome_facade] Failed to dlopen %s: %s\n", real_path, dlerror());
    return -1001;
  }
  g_telemetry.real_chrome_loaded = 1u;

  auto real_main = (ChromeMainPosixFn)dlsym(real_mod, "ChromeMain");
  g_telemetry.intercept_us = now_us() - t0;
  if (!real_main) {
    fprintf(stderr, "[b8g_chrome_facade] Missing ChromeMain in %s\n", real_path);
    return -1002;
  }

  return real_main(argc, argv);
}
#endif
