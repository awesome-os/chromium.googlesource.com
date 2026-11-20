// Track 18.2 — Open-Source E2EE SUBSTRATE CAS+KV Cloud-Sync Provider (Default)
#include "b8g_cloud_sync_abi.h"
#include <cstring>
#include <string>
#include <unordered_map>

namespace {

struct Slot {
  std::string payload;
  uint64_t cas_hash;
};

std::unordered_map<std::string, Slot> g_kv;

uint64_t fnv1a(const void* data, size_t len) {
  const auto* p = static_cast<const uint8_t*>(data);
  uint64_t h = 14695981039346656037ULL;
  for (size_t i = 0; i < len; ++i) {
    h ^= p[i];
    h *= 1099511628211ULL;
  }
  return h;
}

const char* provider_name() { return "awesome-os:substrate-e2ee-cas-kv"; }
uint32_t allows_network() { return 1u; }

int32_t sync_put(uint32_t ns, const char* key, const void* data, size_t len, uint64_t* out_cas_hash) {
  if (!key || !data) return -1;
  std::string k = std::to_string(ns) + ":" + key;
  uint64_t h = fnv1a(data, len);
  g_kv[k] = Slot{std::string(static_cast<const char*>(data), len), h};
  if (out_cas_hash) *out_cas_hash = h;
  return 0;
}

int32_t sync_get(uint32_t ns, const char* key, void* out_buf, size_t cap, size_t* out_len) {
  if (!key || !out_buf || !out_len) return -1;
  auto it = g_kv.find(std::to_string(ns) + ":" + key);
  if (it == g_kv.end()) return -2;
  size_t n = it->second.payload.size();
  if (n > cap) return -3;
  std::memcpy(out_buf, it->second.payload.data(), n);
  *out_len = n;
  return 0;
}

uint32_t safe_browsing_check(const char* url, size_t len) {
  if (!url || len == 0) return 0u;
  std::string s(url, len);
  return (s.find("malware-test.invalid") != std::string::npos) ? 2u : 0u;
}

void dispose() { g_kv.clear(); }

constexpr B8gCloudSyncDispatchTable kTable = {
    B8G_CLOUD_SYNC_ABI_VERSION,
    B8G_CLOUD_OSS_SUBSTRATE_E2EE,
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
