// Track 18.2 — Airgapped Local-Only Provider (0 Network Calls)
#include "b8g_cloud_sync_abi.h"
#include <cstring>
#include <string>
#include <unordered_map>

namespace {

std::unordered_map<std::string, std::string> g_local;

const char* provider_name() { return "awesome-os:airgapped-local-only"; }
uint32_t allows_network() { return 0u; }

int32_t sync_put(uint32_t ns, const char* key, const void* data, size_t len, uint64_t* out_cas_hash) {
  if (!key || !data) return -1;
  g_local[std::to_string(ns) + ":" + key] = std::string(static_cast<const char*>(data), len);
  if (out_cas_hash) *out_cas_hash = 0ULL;
  return 0;
}

int32_t sync_get(uint32_t ns, const char* key, void* out_buf, size_t cap, size_t* out_len) {
  if (!key || !out_buf || !out_len) return -1;
  auto it = g_local.find(std::to_string(ns) + ":" + key);
  if (it == g_local.end()) return -2;
  size_t n = it->second.size();
  if (n > cap) return -3;
  std::memcpy(out_buf, it->second.data(), n);
  *out_len = n;
  return 0;
}

uint32_t safe_browsing_check(const char*, size_t) { return 0u; }
void dispose() { g_local.clear(); }

constexpr B8gCloudSyncDispatchTable kTable = {
    B8G_CLOUD_SYNC_ABI_VERSION,
    B8G_CLOUD_AIRGAPPED_LOCAL,
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
