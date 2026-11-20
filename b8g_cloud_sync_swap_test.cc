// Track 18.2 Live Proof — 1:1 Runtime Hot-Swap Across OSS / Google / Airgapped Cloud-Sync DLLs
#include "b8g_cloud_sync_abi.h"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <chrono>
#include <cstdio>
#include <cstring>

using Clock = std::chrono::steady_clock;

int main() {
  const char* dlls[] = {
      "E:\\b8g-chromium-real\\src\\out\\B8gRelease\\b8g_cloud_sync_oss_abi.dll",
      "E:\\b8g-chromium-real\\src\\out\\B8gRelease\\b8g_cloud_sync_google_abi.dll",
      "E:\\b8g-chromium-real\\src\\out\\B8gRelease\\b8g_cloud_sync_local_abi.dll",
  };

  for (const char* path : dlls) {
    auto t0 = Clock::now();
    HMODULE h = ::LoadLibraryA(path);
    if (!h) { std::fprintf(stderr, "FAIL LoadLibraryA(%s)\n", path); return 1; }
    auto get_tbl = reinterpret_cast<B8gGetCloudSyncTableFn>(::GetProcAddress(h, "b8g_get_cloud_sync_table"));
    if (!get_tbl) return 2;
    const B8gCloudSyncDispatchTable* tbl = get_tbl();
    if (!tbl || tbl->abi_version != B8G_CLOUD_SYNC_ABI_VERSION) return 3;

    const char* bookmark = "{\"url\":\"https://awesome-os.dev\",\"title\":\"Awesome-OS\"}";
    uint64_t cas = 0;
    tbl->sync_put(B8G_SYNC_BOOKMARKS, "bm_1", bookmark, std::strlen(bookmark), &cas);
    char out[256] = {};
    size_t out_len = 0;
    tbl->sync_get(B8G_SYNC_BOOKMARKS, "bm_1", out, sizeof(out), &out_len);
    uint32_t sb_ok = tbl->safe_browsing_check("https://awesome-os.dev", 22);
    uint32_t sb_bad = tbl->safe_browsing_check("https://malware-test.invalid/x", 30);
    char pname[128] = {};
    std::strncpy(pname, tbl->provider_name(), sizeof(pname) - 1);
    uint32_t net = tbl->allows_network();
    tbl->dispose();
    ::FreeLibrary(h);
    auto t1 = Clock::now();
    double us = std::chrono::duration<double, std::micro>(t1 - t0).count();

    std::printf("[B8G-CLOUD-SYNC 1:1 SWAP] provider=%-35s net=%u cas=0x%llx rx=%zuB sb=(%u,%u) swap=%.1f us\n",
                pname, net,
                static_cast<unsigned long long>(cas), out_len, sb_ok, sb_bad, us);
  }
  return 0;
}
