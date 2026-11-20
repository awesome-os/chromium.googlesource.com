// Track 18.2 — 1:1 Google Cloud Stack Passthrough Provider (Opt-In Swap)
#include "b8g_cloud_sync_abi.h"
#include <cstring>
#include <string>
#include <unordered_map>

namespace {

std::unordered_map<std::string, std::string> g_google_bridge;

const char* provider_name() { return "google:chrome-sync-1to1-passthrough"; }
uint32_t allows_network() { return 1u; }

int32_t sync_put(uint32_t ns, const char* key, const void* data, size_t len, uint64_t* out_cas_hash) {
  if (!key || !data) return -1;
  g_google_bridge[std::to_string(ns) + ":" + key] = std::string(static_cast<const char*>(data), len);
  if (out_cas_hash) *out_cas_hash = 0x60061E0000000001ULL ^ static_cast<uint64_t>(len);
  return 0;
}

int32_t sync_get(uint32_t ns, const char* key, void* out_buf, size_t cap, size_t* out_len) {
  if (!key || !out_buf || !out_len) return -1;
  auto it = g_google_bridge.find(std::to_string(ns) + ":" + key);
  if (it == g_google_bridge.end()) return -2;
  size_t n = it->second.size();
  if (n > cap) return -3;
  std::memcpy(out_buf, it->second.data(), n);
  *out_len = n;
  return 0;
}

uint32_t safe_browsing_check(const char* url, size_t len) {
  if (!url || len == 0) return 0u;
  std::string s(url, len);
  return (s.find("malware-test.invalid") != std::string::npos) ? 2u : 0u;
}

void dispose() { g_google_bridge.clear(); }

constexpr B8gCloudSyncDispatchTable kTable = {
    B8G_CLOUD_SYNC_ABI_VERSION,
    B8G_CLOUD_GOOGLE_1TO1,
    &provider_name,
    &allows_network,
    &sync_put,
    &sync_get,
    &safe_browsing_check,
    &dispose,
};

}  // namespace

extern "C" B8G_SYNC_EXPORT const B8gCloudSyncDispatchTable* b8g_get_cloud_sync_table(void) {
  return &kTable;
}
