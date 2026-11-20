/*
 * b8g_libnode_probe.cc — Live hardware probe for our 19th B8G-ABI DLL
 * (`b8g_libnode_abi.dll`) binding directly to real Chromium `v8.dll` (88.69 MB).
 */
#include "b8g_libnode_abi.h"

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>

int main(void) {
  const char* out_dir = "E:\\b8g-chromium-real\\src\\out\\B8gRelease";
  const char* dll_path = "E:\\b8g-chromium-real\\src\\out\\B8gRelease\\b8g_libnode_abi.dll";

  HMODULE h = LoadLibraryA(dll_path);
  if (!h) {
    printf("[FAIL] LoadLibraryA(%s) err=%lu\n", dll_path, GetLastError());
    return 1;
  }

  auto getter = (B8gGetLibNodeAbiFn)GetProcAddress(h, "b8g_get_libnode_abi");
  if (!getter) {
    printf("[FAIL] Missing export b8g_get_libnode_abi\n");
    FreeLibrary(h);
    return 2;
  }

  const B8gLibNodeAbi* abi = getter();
  B8gLibNodeV8Binding bind;
  int rc = abi->bind_shared_v8(out_dir, &bind);
  if (rc != 0 || !bind.v8_dll_loaded) {
    printf("[FAIL] bind_shared_v8 rc=%d\n", rc);
    FreeLibrary(h);
    return 3;
  }

  abi->attach_dom_context(1001, "app://b8g-nwjs-demo");
  abi->attach_dom_context(1002, "app://b8g-electron-demo");
  B8gLibNodeContextStats st;
  abi->get_stats(&st);

  printf(
    "[PASS] b8g_libnode_abi v%u provider=%s src=%s\n"
    "       shared_v8=%s size=%.2f MB base=0x%llX dup_v8=%u B bind_us=%llu\n"
    "       active_contexts=%u total_evals=%llu\n",
    abi->abi_version,
    abi->provider_name(),
    abi->node_src_root(),
    bind.v8_dll_path,
    (double)bind.v8_dll_size_bytes / (1024.0 * 1024.0),
    (unsigned long long)bind.v8_dll_base_addr,
    bind.duplicated_v8_bytes,
    (unsigned long long)st.last_bind_us,
    st.active_contexts,
    (unsigned long long)st.total_eval_calls);

  abi->detach_dom_context(1002);
  abi->detach_dom_context(1001);
  abi->shutdown();
  FreeLibrary(h);
  return 0;
}
