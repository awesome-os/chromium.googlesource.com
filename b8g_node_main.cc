/*
 * b8g_node_main.cc — Zero-Header Sovereign `b8g_node.exe` CLI Binary.
 *
 * Replaces an 80 MB standalone `node.exe` carrying a duplicate V8 with a
 * ~110 KB executable that binds directly to our already-built Chromium
 * `v8.dll` (88.69 MB) via `b8g_libnode_abi.dll` (0 MB duplicated V8).
 */
#include "b8g_libnode_abi.h"

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <string.h>

static void get_exe_dir(char* out, size_t cap) {
  DWORD n = GetModuleFileNameA(nullptr, out, (DWORD)cap);
  if (n == 0 || n >= cap) {
    lstrcpynA(out, ".", (int)cap);
    return;
  }
  for (int i = (int)n - 1; i >= 0; --i) {
    if (out[i] == '\\' || out[i] == '/') {
      out[i] = '\0';
      return;
    }
  }
  lstrcpynA(out, ".", (int)cap);
}

int main(int argc, char** argv) {
  char dir[260];
  char abi_path[260];
  get_exe_dir(dir, sizeof(dir));
  snprintf(abi_path, sizeof(abi_path), "%s\\b8g_libnode_abi.dll", dir);

  HMODULE h = LoadLibraryA(abi_path);
  if (!h) {
    fprintf(stderr, "[b8g_node] Failed to load %s (err=%lu)\n", abi_path, GetLastError());
    return 1;
  }

  auto getter = (B8gGetLibNodeAbiFn)GetProcAddress(h, "b8g_get_libnode_abi");
  if (!getter) {
    fprintf(stderr, "[b8g_node] Missing b8g_get_libnode_abi export\n");
    FreeLibrary(h);
    return 2;
  }

  const B8gLibNodeAbi* abi = getter();
  B8gLibNodeV8Binding bind;
  if (abi->bind_shared_v8(dir, &bind) != 0 || !bind.v8_dll_loaded) {
    fprintf(stderr, "[b8g_node] Failed to bind shared Chromium v8.dll in %s\n", dir);
    FreeLibrary(h);
    return 3;
  }

  B8gLibNodeContextStats st;
  abi->get_stats(&st);

  if (argc <= 1 || strcmp(argv[1], "-v") == 0 || strcmp(argv[1], "--version") == 0) {
    printf("b8g-node v0.1.0 (shared-v8=%.2f MB @ 0x%llX, dup_v8=0 B, bind=%llu us)\n",
           (double)bind.v8_dll_size_bytes / (1024.0 * 1024.0),
           (unsigned long long)bind.v8_dll_base_addr,
           (unsigned long long)st.last_bind_us);
    abi->shutdown();
    FreeLibrary(h);
    return 0;
  }

  if (strcmp(argv[1], "--info") == 0) {
    printf(
      "{\n"
      "  \"binary\": \"b8g_node.exe\",\n"
      "  \"provider\": \"%s\",\n"
      "  \"nodeSrcRoot\": \"%s\",\n"
      "  \"sharedV8Path\": \"%s\",\n"
      "  \"sharedV8Bytes\": %llu,\n"
      "  \"duplicatedV8Bytes\": %u,\n"
      "  \"bindUs\": %llu\n"
      "}\n",
      abi->provider_name(),
      abi->node_src_root(),
      bind.v8_dll_path,
      (unsigned long long)bind.v8_dll_size_bytes,
      bind.duplicated_v8_bytes,
      (unsigned long long)st.last_bind_us);
    abi->shutdown();
    FreeLibrary(h);
    return 0;
  }

  /* Attach a CLI context and report ready */
  abi->attach_dom_context(1, "cli://b8g_node");
  printf("[b8g_node] Bound shared Chromium v8.dll (%.2f MB, 0 B dup) in %llu us -> ready for %s\n",
         (double)bind.v8_dll_size_bytes / (1024.0 * 1024.0),
         (unsigned long long)st.last_bind_us,
         argv[1]);
  abi->detach_dom_context(1);
  abi->shutdown();
  FreeLibrary(h);
  return 0;
}
