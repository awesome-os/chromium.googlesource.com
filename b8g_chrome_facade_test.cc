/*
 * Live Win64 test harness for `b8g_chrome_facade.dll`:
 * Proves transparent `ChromeMain` interception + pre-boot of `b8g_cloud_sync_oss_abi.dll`
 * and `b8g_libnode_abi.dll` + exact argument/return forwarding to a target `ChromeMain`.
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdio.h>

#ifdef BUILD_MOCK_REAL_DLL
extern "C" __declspec(dllexport) int __cdecl ChromeMain(
    HINSTANCE instance,
    void* sandbox_info,
    int64_t exe_entry_point_ticks) {
  (void)instance;
  (void)sandbox_info;
  return (int)(exe_entry_point_ticks + 0xB86);
}
#else
struct B8gChromeFacadeTelemetry {
  uint32_t facade_version;
  uint32_t cloud_sync_loaded;
  uint32_t libnode_loaded;
  uint32_t real_chrome_loaded;
  uint64_t intercept_us;
  char     cloud_sync_provider[64];
};

typedef int (__cdecl *ChromeMainFn)(HINSTANCE, void*, int64_t);
typedef const B8gChromeFacadeTelemetry* (*TelemetryFn)(void);

int main(void) {
  const char* facade_path = "E:\\b8g-chromium-real\\src\\out\\B8gRelease\\b8g_chrome_facade.dll";
  const char* mock_path   = "E:\\b8g-chromium-real\\src\\out\\B8gRelease\\b8g_chrome_real_mock.dll";

  SetEnvironmentVariableA("B8G_CHROME_REAL_DLL", mock_path);
  SetEnvironmentVariableA("B8G_CLOUD_SYNC_PROVIDER", "oss");

  HMODULE h = LoadLibraryA(facade_path);
  if (!h) {
    printf("[FAIL] LoadLibraryA(%s) err=%lu\n", facade_path, GetLastError());
    return 1;
  }

  auto entry = (ChromeMainFn)GetProcAddress(h, "ChromeMain");
  auto telem = (TelemetryFn)GetProcAddress(h, "b8g_chrome_facade_telemetry");
  if (!entry || !telem) {
    printf("[FAIL] Missing exports\n");
    return 2;
  }

  int rc = entry(GetModuleHandleA(nullptr), nullptr, 100);
  const B8gChromeFacadeTelemetry* t = telem();

  if (rc != (100 + 0xB86) || !t->cloud_sync_loaded || !t->libnode_loaded || !t->real_chrome_loaded) {
    printf("[FAIL] rc=%d sync=%u node=%u real=%u\n",
           rc, t->cloud_sync_loaded, t->libnode_loaded, t->real_chrome_loaded);
    return 3;
  }

  printf(
    "[PASS] b8g_chrome_facade.dll v%u intercepted ChromeMain in %llu us\n"
    "       cloud_sync=%u (%s) | libnode=%u | real_chrome=%u | forwarded_rc=0x%X\n",
    t->facade_version,
    (unsigned long long)t->intercept_us,
    t->cloud_sync_loaded,
    t->cloud_sync_provider,
    t->libnode_loaded,
    t->real_chrome_loaded,
    rc);

  FreeLibrary(h);
  return 0;
}
#endif
