// Copyright 2026 Awesome-OS Authors
// SPDX-License-Identifier: BSD-3-Clause
//
// Zero-header C11/C++20 B8G-ABI export unit for the ipcz SPSC shared-memory
// parcel ring fast-path. Compiles with zero absl, zero ipcz/router.h, and zero
// Chromium //base dependencies so `shared_library("b8g_ipcz_abi")` links in <1s.

#include "b8g_chromium_abi_table.h"
#include "b8g_ipcz_spsc_ring.h"

#include <cstddef>
#include <cstdint>
#include <cstring>

#if defined(__clang__)
#pragma clang unsafe_buffer_usage begin
#endif

namespace {

using B8gIpczRing = b8g::ipcz_fastpath::SpscParcelRing<1024, 4096>;
using b8g::ipcz_fastpath::RingStatus;

}  // namespace

extern "C" {

static size_t B8gIpczRequiredRingBytes(void) {
  return B8gIpczRing::kTotalSharedBytes;
}

static void B8gIpczRingInit(void* shared_arena, uint32_t capability_epoch) {
  if (!shared_arena) {
    return;
  }
  B8gIpczRing ring(shared_arena);
  ring.Initialize(capability_epoch);
}

static uint32_t B8gIpczTryPut(void* shared_arena,
                              const void* data,
                              size_t num_bytes,
                              uint32_t flags) {
  if (!shared_arena || (num_bytes > 0 && !data)) {
    return static_cast<uint32_t>(RingStatus::kInvalidArg);
  }
  B8gIpczRing ring(shared_arena);
  return static_cast<uint32_t>(ring.TryPut(data, num_bytes, flags));
}

static uint32_t B8gIpczTryGet(void* shared_arena,
                              void* out_buf,
                              size_t cap_bytes,
                              size_t* out_bytes) {
  if (!shared_arena || !out_bytes) {
    return static_cast<uint32_t>(RingStatus::kInvalidArg);
  }
  B8gIpczRing ring(shared_arena);
  const volatile void* src = nullptr;
  size_t num_bytes = 0;
  uint64_t tx_seq = 0;
  const RingStatus status = ring.TryBeginGet(&src, &num_bytes, &tx_seq);
  if (status != RingStatus::kOk) {
    return static_cast<uint32_t>(status);
  }
  if (num_bytes > cap_bytes) {
    *out_bytes = num_bytes;
    return static_cast<uint32_t>(RingStatus::kTooLarge);
  }
  if (num_bytes > 0 && !out_buf) {
    *out_bytes = num_bytes;
    return static_cast<uint32_t>(RingStatus::kInvalidArg);
  }
  if (num_bytes > 0) {
    std::memcpy(out_buf, const_cast<const void*>(src), num_bytes);
  }
  *out_bytes = num_bytes;
  ring.CommitGet(tx_seq);
  return static_cast<uint32_t>(RingStatus::kOk);
}

static constexpr B8gIpczDispatchTable kB8gIpczDispatchTable = {
    &B8gIpczRequiredRingBytes,
    &B8gIpczRingInit,
    &B8gIpczTryPut,
    &B8gIpczTryGet,
};

B8G_ABI_EXPORT const B8gIpczDispatchTable* b8g_get_ipcz_table(void);

B8G_ABI_EXPORT const B8gIpczDispatchTable* b8g_get_ipcz_table(void) {
  return &kB8gIpczDispatchTable;
}

}  // extern "C"

#if defined(__clang__)
#pragma clang unsafe_buffer_usage end
#endif
