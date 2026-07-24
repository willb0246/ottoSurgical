import AVFoundation
import Speech

/// A pluggable phrase-spotter. The capture engine feeds it every audio buffer
/// from the single input tap; it reports when a wake phrase or a stop phrase is
/// recognized. The engine decides what to do based on capture state.
///
/// The prototype ships an on-device `SpeechWakeWordDetector` (zero licensing,
/// works today). For production noise-robustness, swap in a Porcupine-backed
/// implementation of this same protocol — see the note at the bottom of the
/// file. The capture engine only depends on this interface.
protocol WakeWordDetector: AnyObject {
  /// Called on the main queue when a phrase matches. Payload is
  /// (matchedPhrase, isStopWord).
  var onMatch: ((String, Bool) -> Void)? { get set }
  /// Live partial transcript — surfaced so behavior is debuggable (you can see
  /// what the recognizer actually heard).
  var onPartial: ((String) -> Void)? { get set }
  var onError: ((String) -> Void)? { get set }

  func start(recordingFormat: AVAudioFormat) throws
  func append(buffer: AVAudioPCMBuffer)
  /// Clear accumulated transcript and start a fresh recognition pass — called
  /// after a segment ends so the next wake word is spotted cleanly.
  func reset()
  func stop()
}

/// On-device keyword spotting via `SFSpeechRecognizer`. Detects both wake and
/// stop phrases, biased via `contextualStrings`. Fully on-device when the
/// device supports it (PRD §7 PHI); falls back to server recognition only
/// where on-device isn't provisioned (Simulator) so it stays testable there.
final class SpeechWakeWordDetector: NSObject, WakeWordDetector {
  var onMatch: ((String, Bool) -> Void)?
  var onPartial: ((String) -> Void)?
  var onError: ((String) -> Void)?

  private let recognizer: SFSpeechRecognizer?
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var recordingFormat: AVAudioFormat?
  private let wakePhrases: [String]
  private let stopPhrases: [String]
  private var running = false

  /// Debounce so one utterance doesn't fire repeatedly while it lingers in the
  /// rolling transcription.
  private var lastFireAt: Date = .distantPast
  private let refractory: TimeInterval = 1.2

  /// Monotonic token: the recognition-task completion handler ignores callbacks
  /// whose generation is stale, so a cancelled task's late error can't trigger
  /// a restart storm.
  private var generation = 0

  init(wakePhrases: [String], stopPhrases: [String], localeIdentifier: String = "en-US") {
    self.recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeIdentifier))
    self.wakePhrases = wakePhrases.map { $0.lowercased() }
    self.stopPhrases = stopPhrases.map { $0.lowercased() }
    super.init()
  }

  func start(recordingFormat: AVAudioFormat) throws {
    self.recordingFormat = recordingFormat
    guard let recognizer, recognizer.isAvailable else {
      throw ScribeAudioError.wakeWordUnavailable("Speech recognizer unavailable for locale")
    }
    running = true
    try beginTask()
  }

  private func beginTask() throws {
    guard let recognizer else { return }
    generation += 1
    let gen = generation

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    if recognizer.supportsOnDeviceRecognition {
      request.requiresOnDeviceRecognition = true
    } else {
      request.requiresOnDeviceRecognition = false
      onError?("on-device recognition unavailable — using server recognition (dev/simulator only)")
    }
    // Bias toward our phrases so uncommon words like "beacon" transcribe well.
    request.contextualStrings = wakePhrases + stopPhrases
    if #available(iOS 16.0, *) {
      request.addsPunctuation = false
    }
    self.request = request

    task = recognizer.recognitionTask(with: request) { [weak self] result, error in
      guard let self, gen == self.generation else { return } // ignore stale callbacks
      if let result {
        let text = result.bestTranscription.formattedString.lowercased()
        DispatchQueue.main.async { [weak self] in self?.onPartial?(text) }
        self.evaluate(text: text)
        if result.isFinal { self.restart() }
      }
      if error != nil, self.running {
        self.restart()
      }
    }
  }

  private func evaluate(text: String) {
    guard Date().timeIntervalSince(lastFireAt) > refractory else { return }
    // Stop phrases take priority (they only act while capturing anyway).
    if let stop = stopPhrases.first(where: { text.contains($0) }) {
      fire(phrase: stop, isStop: true)
      return
    }
    if let wake = wakePhrases.first(where: { text.contains($0) }) {
      fire(phrase: wake, isStop: false)
    }
  }

  private func fire(phrase: String, isStop: Bool) {
    lastFireAt = Date()
    DispatchQueue.main.async { [weak self] in self?.onMatch?(phrase, isStop) }
    // Clear the matched text so it can't re-fire.
    restart()
  }

  func reset() {
    guard running else { return }
    restart()
  }

  private func restart() {
    guard running else { return }
    request?.endAudio()
    task?.cancel()
    task = nil
    request = nil
    do {
      try beginTask() // bumps generation; stale handlers are now ignored
    } catch {
      onError?("recognition restart failed: \(error.localizedDescription)")
    }
  }

  func append(buffer: AVAudioPCMBuffer) {
    request?.append(buffer)
  }

  func stop() {
    running = false
    generation += 1 // invalidate any in-flight callbacks
    request?.endAudio()
    task?.cancel()
    task = nil
    request = nil
  }
}

// MARK: - Production seam (Porcupine)
//
// To replace the Speech-framework detector with a purpose-built, low-power,
// noise-robust wake engine:
//
//   1. Add the pod:  pod 'Porcupine-iOS'  (or the Swift package)
//   2. Ship trained `.ppn` keyword files (wake + stop) + a Picovoice AccessKey.
//   3. Implement `PorcupineWakeWordDetector: WakeWordDetector` that feeds
//      `append(buffer:)` PCM into Porcupine.process(...) and calls `onMatch`
//      with the matched phrase / isStop on a keyword index >= 0.
//   4. Swap the instantiation in AudioCaptureEngine.makeDetector().
//
// Nothing else in the capture pipeline changes — the ring buffer, session
// config, and segment writing are engine-agnostic.
