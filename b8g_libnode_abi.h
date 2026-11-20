#ifndef B8G_LIBNODE_ABI_H_
#define B8G_LIBNODE_ABI_H_

/*
 * B8G-ABI v3: Zero-Header Shared-V8 libnode Embedder Contract (19th B8G-ABI DLL).
 *
 * Strictly <stddef.h> + <stdint.h> ONLY — zero C++ headers, zero V8 headers,
 * zero Node.js headers crossing the module boundary.
 *
 * Binds Node.js runtime embedding directly onto our ALREADY-BUILT sovereign
 * Chromium `v8.dll` (88.69 MB) — 0 MB duplicate V8, 0 MB duplicate ICU.
 */
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define B8G_LIBNODE_ABI_VERSION 1u

typedef struct B8gLibNodeV8Binding {
  int32_t  v8_dll_loaded;
  uint64_t v8_dll_base_addr;
  uint64_t v8_dll_size_bytes;
  uint32_t duplicated_v8_bytes; /* Always 0 — 100% shared Chromium v8.dll */
  char     v8_dll_path[260];
} B8gLibNodeV8Binding;

typedef struct B8gLibNodeContextStats {
  uint32_t active_contexts;
  uint64_t total_eval_calls;
  uint64_t last_bind_us;
} B8gLibNodeContextStats;

typedef struct B8gLibNodeAbi {
  uint32_t abi_version;
  uint32_t struct_size;
  const char* (*provider_name)(void);
  const char* (*node_src_root)(void);
  int32_t (*bind_shared_v8)(const char* chromium_out_dir, B8gLibNodeV8Binding* out_binding);
  int32_t (*attach_dom_context)(uint64_t context_id, const char* origin_utf8);
  int32_t (*detach_dom_context)(uint64_t context_id);
  int32_t (*get_stats)(B8gLibNodeContextStats* out_stats);
  void    (*shutdown)(void);
} B8gLibNodeAbi;

typedef const B8gLibNodeAbi* (*B8gGetLibNodeAbiFn)(void);

#ifdef __cplusplus
}
#endif

#endif /* B8G_LIBNODE_ABI_H_ */
