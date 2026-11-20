// Copyright 2026 Awesome-OS Authors
// SPDX-License-Identifier: BSD-3-Clause
//
// Zero-header C11/C++20 B8G-ABI export unit for Mojo Core in-memory lock-free
// message pipes. Compiles with zero //base, zero absl, and zero //mojo/public
// dependencies so `shared_library("b8g_mojo_abi")` links in <1s.

#if defined(__clang__)
#pragma clang unsafe_buffer_usage begin
#endif

#include "third_party/ipcz/src/ipcz/b8g_chromium_abi_table.h"

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace {

constexpr uint32_t kMojoOk = 0u;
constexpr uint32_t kMojoInvalidArg = 1u;
constexpr uint32_t kMojoShouldWait = 2u;
constexpr uint32_t kMojoResourceExhausted = 3u;
constexpr uint32_t kMojoFailedPrecondition = 4u;
constexpr uint32_t kMojoTooLarge = 5u;

constexpr size_t kMaxPipes = 64u;
constexpr uint32_t kRingCapacity = 16u;
constexpr uint32_t kRingMask = kRingCapacity - 1u;
constexpr size_t kMaxMessageBytes = 4096u;

static_assert((kRingCapacity & (kRingCapacity - 1u)) == 0u,
              "kRingCapacity must be a power of two");

struct MessageSlot {
  uint32_t size;
  uint8_t payload[kMaxMessageBytes];
};

struct SpscMessageRing {
  alignas(64) std::atomic<uint32_t> head{0u};
  alignas(64) std::atomic<uint32_t> tail{0u};
  MessageSlot slots[kRingCapacity];

  void Reset() {
    head.store(0u, std::memory_order_relaxed);
    tail.store(0u, std::memory_order_relaxed);
  }

  uint32_t TryPush(const void* data, size_t num_bytes) {
    if (num_bytes > kMaxMessageBytes) {
      return kMojoTooLarge;
    }
    const uint32_t h = head.load(std::memory_order_relaxed);
    const uint32_t t = tail.load(std::memory_order_acquire);
    if ((h - t) >= kRingCapacity) {
      return kMojoResourceExhausted;
    }
    MessageSlot& slot = slots[h & kRingMask];
    slot.size = static_cast<uint32_t>(num_bytes);
    if (num_bytes > 0u) {
      std::memcpy(slot.payload, data, num_bytes);
    }
    head.store(h + 1u, std::memory_order_release);
    return kMojoOk;
  }

  uint32_t TryPop(void* out_buf, size_t cap, size_t* out_bytes) {
    const uint32_t t = tail.load(std::memory_order_relaxed);
    const uint32_t h = head.load(std::memory_order_acquire);
    if (h == t) {
      return kMojoShouldWait;
    }
    const MessageSlot& slot = slots[t & kRingMask];
    const size_t msg_size = slot.size;
    if (msg_size > cap) {
      if (out_bytes) {
        *out_bytes = msg_size;
      }
      return kMojoTooLarge;
    }
    if (msg_size > 0u && !out_buf) {
      if (out_bytes) {
        *out_bytes = msg_size;
      }
      return kMojoInvalidArg;
    }
    if (msg_size > 0u) {
      std::memcpy(out_buf, slot.payload, msg_size);
    }
    if (out_bytes) {
      *out_bytes = msg_size;
    }
    tail.store(t + 1u, std::memory_order_release);
    return kMojoOk;
  }
};

struct PipeSlot {
  // 0 = free, 1 = initializing, 2 = active
  std::atomic<uint32_t> state{0u};
  std::atomic<uint32_t> open_mask{0u};
  std::atomic<uint64_t> generation{0u};
  // rings[0]: endpoint A -> endpoint B
  // rings[1]: endpoint B -> endpoint A
  SpscMessageRing rings[2];
};

PipeSlot g_pipes[kMaxPipes];
std::atomic<uint64_t> g_next_generation{1u};
std::atomic<uint32_t> g_alloc_cursor{0u};

constexpr uint64_t kGenMask = 0x0000FFFFFFFFFFFFull;

inline uint64_t MakeHandle(uint64_t gen, size_t index, uint32_t side) {
  return ((gen & kGenMask) << 16u) |
         ((static_cast<uint64_t>(index) & 0x7FFFull) << 1u) |
         static_cast<uint64_t>(side & 1u);
}

struct DecodedHandle {
  uint64_t gen;
  size_t index;
  uint32_t side;
};

inline bool DecodeHandle(uint64_t handle, DecodedHandle* out) {
  if (handle == 0u || !out) {
    return false;
  }
  const uint64_t gen = (handle >> 16u) & kGenMask;
  const size_t index = static_cast<size_t>((handle >> 1u) & 0x7FFFull);
  const uint32_t side = static_cast<uint32_t>(handle & 1u);
  if (gen == 0u || index >= kMaxPipes) {
    return false;
  }
  out->gen = gen;
  out->index = index;
  out->side = side;
  return true;
}

inline PipeSlot* ResolveActivePipe(uint64_t handle, DecodedHandle* decoded) {
  if (!DecodeHandle(handle, decoded)) {
    return nullptr;
  }
  PipeSlot& slot = g_pipes[decoded->index];
  if (slot.state.load(std::memory_order_acquire) != 2u) {
    return nullptr;
  }
  if (slot.generation.load(std::memory_order_relaxed) != decoded->gen) {
    return nullptr;
  }
  return &slot;
}

}  // namespace

extern "C" {

static uint32_t B8gMojoCreatePipe(uint64_t* out_handle_a,
                                  uint64_t* out_handle_b) {
  if (!out_handle_a || !out_handle_b) {
    return kMojoInvalidArg;
  }
  const uint32_t start =
      g_alloc_cursor.fetch_add(1u, std::memory_order_relaxed) %
      static_cast<uint32_t>(kMaxPipes);
  for (size_t offset = 0u; offset < kMaxPipes; ++offset) {
    const size_t idx = (static_cast<size_t>(start) + offset) % kMaxPipes;
    PipeSlot& slot = g_pipes[idx];
    uint32_t expected = 0u;
    if (slot.state.compare_exchange_strong(expected, 1u,
                                           std::memory_order_acq_rel)) {
      uint64_t gen =
          g_next_generation.fetch_add(1u, std::memory_order_relaxed) & kGenMask;
      if (gen == 0u) {
        gen = g_next_generation.fetch_add(1u, std::memory_order_relaxed) &
              kGenMask;
        if (gen == 0u) {
          gen = 1u;
        }
      }
      slot.rings[0].Reset();
      slot.rings[1].Reset();
      slot.generation.store(gen, std::memory_order_relaxed);
      slot.open_mask.store(0x3u, std::memory_order_relaxed);
      slot.state.store(2u, std::memory_order_release);
      *out_handle_a = MakeHandle(gen, idx, 0u);
      *out_handle_b = MakeHandle(gen, idx, 1u);
      return kMojoOk;
    }
  }
  *out_handle_a = 0u;
  *out_handle_b = 0u;
  return kMojoResourceExhausted;
}

static uint32_t B8gMojoWriteMessage(uint64_t handle,
                                    const void* data,
                                    size_t num_bytes) {
  if (num_bytes > 0u && !data) {
    return kMojoInvalidArg;
  }
  DecodedHandle decoded{};
  PipeSlot* slot = ResolveActivePipe(handle, &decoded);
  if (!slot) {
    return kMojoInvalidArg;
  }
  const uint32_t mask = slot->open_mask.load(std::memory_order_acquire);
  const uint32_t self_bit = 1u << decoded.side;
  const uint32_t peer_bit = 1u << (decoded.side ^ 1u);
  if ((mask & self_bit) == 0u) {
    return kMojoInvalidArg;
  }
  if ((mask & peer_bit) == 0u) {
    return kMojoFailedPrecondition;
  }
  return slot->rings[decoded.side].TryPush(data, num_bytes);
}

static uint32_t B8gMojoReadMessage(uint64_t handle,
                                   void* out_buf,
                                   size_t cap,
                                   size_t* out_bytes) {
  DecodedHandle decoded{};
  PipeSlot* slot = ResolveActivePipe(handle, &decoded);
  if (!slot) {
    return kMojoInvalidArg;
  }
  const uint32_t mask = slot->open_mask.load(std::memory_order_acquire);
  const uint32_t self_bit = 1u << decoded.side;
  const uint32_t peer_bit = 1u << (decoded.side ^ 1u);
  if ((mask & self_bit) == 0u) {
    return kMojoInvalidArg;
  }
  const uint32_t status =
      slot->rings[decoded.side ^ 1u].TryPop(out_buf, cap, out_bytes);
  if (status == kMojoShouldWait && (mask & peer_bit) == 0u) {
    return kMojoFailedPrecondition;
  }
  return status;
}

static uint32_t B8gMojoCloseHandle(uint64_t handle) {
  DecodedHandle decoded{};
  PipeSlot* slot = ResolveActivePipe(handle, &decoded);
  if (!slot) {
    return kMojoInvalidArg;
  }
  const uint32_t self_bit = 1u << decoded.side;
  const uint32_t prev =
      slot->open_mask.fetch_and(~self_bit, std::memory_order_acq_rel);
  if ((prev & self_bit) == 0u) {
    return kMojoInvalidArg;
  }
  if ((prev & ~self_bit) == 0u) {
    slot->generation.store(0u, std::memory_order_relaxed);
    slot->state.store(0u, std::memory_order_release);
  }
  return kMojoOk;
}

static constexpr B8gMojoDispatchTable kB8gMojoDispatchTable = {
    &B8gMojoCreatePipe,
    &B8gMojoWriteMessage,
    &B8gMojoReadMessage,
    &B8gMojoCloseHandle,
};

B8G_ABI_EXPORT const B8gMojoDispatchTable* b8g_get_mojo_table(void);

B8G_ABI_EXPORT const B8gMojoDispatchTable* b8g_get_mojo_table(void) {
  return &kB8gMojoDispatchTable;
}

}  // extern "C"

#if defined(__clang__)
#pragma clang unsafe_buffer_usage end
#endif
