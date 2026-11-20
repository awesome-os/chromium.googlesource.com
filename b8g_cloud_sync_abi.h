// Copyright 2026 Awesome-OS Authors
// SPDX-License-Identifier: BSD-3-Clause
//
// Track 18.1 — Zero-Header 1:1 Pluggable Cloud-Sync ABI Intersection
// Allows users & enterprises to hot-swap Chrome's proprietary cloud stack 1:1
// between Open-Source E2EE SUBSTRATE CAS+KV, Google Cloud, or Airgapped Local.

#ifndef AWESOME_OS_B8G_CLOUD_SYNC_ABI_H_
#define AWESOME_OS_B8G_CLOUD_SYNC_ABI_H_

#include <stddef.h>
#include <stdint.h>

#if defined(_WIN32)
#define B8G_SYNC_EXPORT __declspec(dllexport)
#else
#define B8G_SYNC_EXPORT __attribute__((visibility("default")))
#endif

#ifdef __cplusplus
extern "C" {
#endif

#define B8G_CLOUD_SYNC_ABI_VERSION 1u

typedef enum B8gCloudProviderKind {
  B8G_CLOUD_OSS_SUBSTRATE_E2EE = 1,
  B8G_CLOUD_GOOGLE_1TO1 = 2,
  B8G_CLOUD_AIRGAPPED_LOCAL = 3
} B8gCloudProviderKind;

typedef enum B8gSyncNamespace {
  B8G_SYNC_BOOKMARKS = 1,
  B8G_SYNC_OPEN_TABS = 2,
  B8G_SYNC_VAULT_E2EE = 3,
  B8G_SYNC_EXTENSIONS = 4,
  B8G_SYNC_PREFS = 5
} B8gSyncNamespace;

typedef struct B8gCloudSyncDispatchTable {
  uint32_t abi_version;
  uint32_t provider_kind;
  const char* (*provider_name)(void);
  uint32_t (*allows_network)(void);
  int32_t (*sync_put)(uint32_t ns, const char* key, const void* data, size_t len, uint64_t* out_cas_hash);
  int32_t (*sync_get)(uint32_t ns, const char* key, void* out_buf, size_t cap, size_t* out_len);
  uint32_t (*safe_browsing_check)(const char* url, size_t len); // 0=SAFE, 1=WARN, 2=BLOCK
  void (*dispose)(void);
} B8gCloudSyncDispatchTable;

typedef const B8gCloudSyncDispatchTable* (*B8gGetCloudSyncTableFn)(void);

#ifdef __cplusplus
}  // extern "C"
#endif

#endif  // AWESOME_OS_B8G_CLOUD_SYNC_ABI_H_
