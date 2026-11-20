// Copyright 2026 Awesome-OS Authors
// SPDX-License-Identifier: BSD-3-Clause
//
// @file sections/chromium-build/ipcz-fastpath/b8g_ipcz_spsc_ring.h
// @description Zero-copy, 64-byte cache-line-aligned B8G_ARENA_V1 SPSC Shared-Memory Ring
// fast-path designed to sit directly underneath Chromium's `third_party/ipcz/src/api.cc`
// (`IpczAPIImpl::Put` / `BeginPut` / `EndPut` / `Get` / `BeginGet` / `EndGet`)
// for handle-free (`num_handles == 0`) high-frequency local portals (e.g., Viz quads, InputEvents).
//
// 100% `.mojom` and `IpczAPI` ABI-compatible: portals with handles or oversized payloads
// transparently fall back to standard `ipcz::NodeLinkMemory` / `DriverTransport`.

#ifndef AWESOME_OS_B8G_IPCZ_SPSC_RING_H_
#define AWESOME_OS_B8G_IPCZ_SPSC_RING_H_

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstring>

#if defined(__clang__)
#pragma clang unsafe_buffer_usage begin
#endif

namespace b8g::ipcz_fastpath {

static constexpr uint32_t kArenaMagicV1 = 0x31413842u;  // "B8A1" (B8G_ARENA_V1)
static constexpr size_t kCacheLineBytes = 64;

enum class RingStatus : uint32_t {
  kOk = 0,
  kUnavailable = 1,   // Ring empty (Get) or full (Put) -> fallback or retry
  kTooLarge = 2,      // Payload exceeds SlotBytes -> fallback to standard ipcz parcel
  kInvalidArg = 3,
};

struct alignas(kCacheLineBytes) RingHeader {
  uint32_t magic;
  uint32_t slot_count;     // Must be power of 2
  uint32_t slot_mask;      // slot_count - 1
  uint32_t slot_payload_bytes;
  uint32_t capability_epoch;
  uint32_t flags;
  uint8_t _pad_meta[40];

  // Producer-owned cache line (no false sharing with consumer tail)
  alignas(kCacheLineBytes) std::atomic<uint64_t> head;
  uint8_t _pad_head[kCacheLineBytes - sizeof(std::atomic<uint64_t>)];

  // Consumer-owned cache line (no false sharing with producer head)
  alignas(kCacheLineBytes) std::atomic<uint64_t> tail;
  uint8_t _pad_tail[kCacheLineBytes - sizeof(std::atomic<uint64_t>)];
};

static_assert(sizeof(RingHeader) == 3 * kCacheLineBytes,
              "RingHeader must occupy exactly 3 cache lines (192 bytes)");

struct alignas(kCacheLineBytes) ParcelSlotHeader {
  uint64_t sequence;
  uint32_t num_bytes;
  uint32_t flags;
  // Payload bytes immediately follow at offset 16 (aligned to 16B).
};

/**
 * Lock-free SPSC zero-copy parcel ring over shared memory (`NodeLinkMemory` / `SharedArrayBuffer`).
 *
 * Maps 1:1 onto Chromium's `IpczAPI` two-phase zero-copy transaction API:
 *   - `IpczAPIImpl::BeginPut` -> `TryBeginPut()`
 *   - `IpczAPIImpl::EndPut`   -> `CommitPut()`
 *   - `IpczAPIImpl::BeginGet` -> `TryBeginGet()`
 *   - `IpczAPIImpl::EndGet`   -> `CommitGet()`
 */
template <uint32_t kSlotCountPow2 = 1024, uint32_t kSlotPayloadBytes = 4096>
class SpscParcelRing {
  static_assert((kSlotCountPow2 & (kSlotCountPow2 - 1)) == 0 && kSlotCountPow2 >= 2,
                "kSlotCountPow2 must be a power of 2 >= 2");
  static_assert((kSlotPayloadBytes % 64) == 0,
                "kSlotPayloadBytes must be 64-byte aligned");

 public:
  static constexpr size_t kSlotStride =
      ((sizeof(ParcelSlotHeader) + kSlotPayloadBytes + kCacheLineBytes - 1) / kCacheLineBytes) *
      kCacheLineBytes;
  static constexpr size_t kTotalSharedBytes =
      sizeof(RingHeader) + static_cast<size_t>(kSlotCountPow2) * kSlotStride;

  explicit SpscParcelRing(void* shared_mem_base) noexcept
      : base_(static_cast<uint8_t*>(shared_mem_base)),
        header_(reinterpret_cast<RingHeader*>(shared_mem_base)) {}

  void Initialize(uint32_t capability_epoch = 1) noexcept {
    header_->magic = kArenaMagicV1;
    header_->slot_count = kSlotCountPow2;
    header_->slot_mask = kSlotCountPow2 - 1;
    header_->slot_payload_bytes = kSlotPayloadBytes;
    header_->capability_epoch = capability_epoch;
    header_->flags = 0;
    header_->head.store(0, std::memory_order_relaxed);
    header_->tail.store(0, std::memory_order_relaxed);
  }

  // Zero-copy IpczAPIImpl::BeginPut fast-path (num_handles == 0)
  RingStatus TryBeginPut(size_t requested_bytes,
                         volatile void** out_data,
                         uint64_t* out_tx_seq) noexcept {
    if (!out_data || !out_tx_seq) return RingStatus::kInvalidArg;
    if (requested_bytes > kSlotPayloadBytes) return RingStatus::kTooLarge;

    const uint64_t h = header_->head.load(std::memory_order_relaxed);
    const uint64_t t = header_->tail.load(std::memory_order_acquire);
    if ((h - t) >= kSlotCountPow2) {
      return RingStatus::kUnavailable;
    }

    ParcelSlotHeader* slot = SlotAt(h & (kSlotCountPow2 - 1));
    slot->sequence = h;
    *out_data = reinterpret_cast<volatile void*>(reinterpret_cast<uint8_t*>(slot) + 16);
    *out_tx_seq = h;
    return RingStatus::kOk;
  }

  // Zero-copy IpczAPIImpl::EndPut fast-path
  RingStatus CommitPut(uint64_t tx_seq, size_t num_bytes_produced, uint32_t flags = 0) noexcept {
    if (num_bytes_produced > kSlotPayloadBytes) return RingStatus::kTooLarge;
    ParcelSlotHeader* slot = SlotAt(tx_seq & (kSlotCountPow2 - 1));
    slot->num_bytes = static_cast<uint32_t>(num_bytes_produced);
    slot->flags = flags;
    header_->head.store(tx_seq + 1, std::memory_order_release);
    return RingStatus::kOk;
  }

  // Single-call IpczAPIImpl::Put fast-path (num_handles == 0)
  RingStatus TryPut(const void* data, size_t num_bytes, uint32_t flags = 0) noexcept {
    volatile void* dst = nullptr;
    uint64_t tx = 0;
    const RingStatus st = TryBeginPut(num_bytes, &dst, &tx);
    if (st != RingStatus::kOk) return st;
    if (num_bytes > 0 && data != nullptr) {
      std::memcpy(const_cast<void*>(dst), data, num_bytes);
    }
    return CommitPut(tx, num_bytes, flags);
  }

  // Zero-copy IpczAPIImpl::BeginGet fast-path
  RingStatus TryBeginGet(const volatile void** out_data,
                         size_t* out_num_bytes,
                         uint64_t* out_tx_seq) noexcept {
    if (!out_data || !out_num_bytes || !out_tx_seq) return RingStatus::kInvalidArg;

    const uint64_t t = header_->tail.load(std::memory_order_relaxed);
    const uint64_t h = header_->head.load(std::memory_order_acquire);
    if (t == h) {
      return RingStatus::kUnavailable;
    }

    const ParcelSlotHeader* slot = SlotAt(t & (kSlotCountPow2 - 1));
    *out_data = reinterpret_cast<const volatile void*>(
        reinterpret_cast<const uint8_t*>(slot) + 16);
    *out_num_bytes = slot->num_bytes;
    *out_tx_seq = t;
    return RingStatus::kOk;
  }

  // Zero-copy IpczAPIImpl::EndGet fast-path
  void CommitGet(uint64_t tx_seq) noexcept {
    header_->tail.store(tx_seq + 1, std::memory_order_release);
  }

 private:
  ParcelSlotHeader* SlotAt(uint64_t index) noexcept {
    return reinterpret_cast<ParcelSlotHeader*>(
        base_ + sizeof(RingHeader) + static_cast<size_t>(index) * kSlotStride);
  }

  uint8_t* base_;
  RingHeader* header_;
};

}  // namespace b8g::ipcz_fastpath

#if defined(__clang__)
#pragma clang unsafe_buffer_usage end
#endif

#endif  // AWESOME_OS_B8G_IPCZ_SPSC_RING_H_
