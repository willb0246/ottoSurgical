import AVFoundation

/// Fixed-capacity rolling buffer of mono Float samples.
///
/// Holds the last `capacity` samples so the utterance already underway at
/// wake-word time is captured (PRD §5.1 "rolling pre-trigger buffer", ~5–8s).
/// Single-writer (the audio tap thread) / single-reader (arm time) — guarded
/// by a lock because arm happens on a different thread than the tap.
final class RingBuffer {
  private var storage: [Float]
  private var writeIndex = 0
  private var filled = 0
  private let capacity: Int
  private let lock = NSLock()

  init(capacity: Int) {
    self.capacity = max(1, capacity)
    self.storage = [Float](repeating: 0, count: self.capacity)
  }

  /// Append mono samples, overwriting the oldest when full.
  func append(_ samples: UnsafeBufferPointer<Float>) {
    lock.lock()
    defer { lock.unlock() }
    for sample in samples {
      storage[writeIndex] = sample
      writeIndex = (writeIndex + 1) % capacity
      if filled < capacity { filled += 1 }
    }
  }

  /// Snapshot the buffered samples in chronological (oldest→newest) order.
  func snapshot() -> [Float] {
    lock.lock()
    defer { lock.unlock() }
    guard filled > 0 else { return [] }
    if filled < capacity {
      // Not wrapped yet: valid data is [0, writeIndex).
      return Array(storage[0..<writeIndex])
    }
    // Wrapped: oldest sample is at writeIndex.
    var out = [Float]()
    out.reserveCapacity(capacity)
    out.append(contentsOf: storage[writeIndex..<capacity])
    out.append(contentsOf: storage[0..<writeIndex])
    return out
  }

  func clear() {
    lock.lock()
    defer { lock.unlock() }
    writeIndex = 0
    filled = 0
  }
}
