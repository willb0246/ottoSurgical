import AVFoundation
import AudioToolbox
import Speech

enum ScribeAudioError: Error, LocalizedError {
  case permissionDenied(String)
  case sessionConfigFailed(String)
  case engineStartFailed(String)
  case wakeWordUnavailable(String)
  case notCapturing

  var errorDescription: String? {
    switch self {
    case .permissionDenied(let m): return "Microphone/speech permission denied: \(m)"
    case .sessionConfigFailed(let m): return "Audio session config failed: \(m)"
    case .engineStartFailed(let m): return "Audio engine failed to start: \(m)"
    case .wakeWordUnavailable(let m): return "Wake word unavailable: \(m)"
    case .notCapturing: return "No capture is in progress"
    }
  }
}

/// Capture status, surfaced to JS.
///   idle      — engine stopped
///   listening — engine running, wake-word armed, NOT recording an utterance
///   capturing — actively recording an utterance to a segment file
enum CaptureStatus: String {
  case idle
  case listening
  case capturing
}

/// Owns the single AVAudioEngine and the AVAudioSession. One input tap fans
/// out to: (1) the pre-trigger ring buffer, (2) the wake-word detector,
/// (3) level metering, (4) the active segment file when capturing.
final class AudioCaptureEngine {

  // Event callbacks (set by the Expo module; all invoked on the main queue).
  var onStatusChange: ((String) -> Void)?
  var onWakeWord: (([String: Any]) -> Void)?
  var onTranscript: (([String: Any]) -> Void)?
  var onLevel: (([String: Any]) -> Void)?
  var onSegment: (([String: Any]) -> Void)?
  var onRouteChange: (([String: Any]) -> Void)?
  var onError: (([String: Any]) -> Void)?

  private let engine = AVAudioEngine()
  private var detector: WakeWordDetector?
  private var ringBuffer: RingBuffer?

  private var sessionId: String = ""
  private var wakePhrases: [String] = ["hey beacon"]
  private var stopPhrases: [String] = ["stop recording"]
  private var preRollSeconds: Double = 6.0
  private var recordFormat: AVAudioFormat?

  private var status: CaptureStatus = .idle {
    didSet {
      if status != oldValue {
        DispatchQueue.main.async { [weak self] in self?.onStatusChange?(self?.status.rawValue ?? "idle") }
      }
    }
  }

  // Active segment state
  private var segmentFile: AVAudioFile?
  private var segmentId: String = ""
  private var segmentStartedAt: Date?
  private var segmentFrameCount: AVAudioFramePosition = 0

  // Silence-based auto-end is now a long safety net (the stop word is the
  // primary way to end a segment). A forgotten stop word won't record forever,
  // but normal dictation pauses won't cut you off.
  private var lastVoiceAt: Date = .distantPast
  private let silenceThreshold: Float = 0.012 // RMS
  private var silenceTimeout: TimeInterval = 30.0
  private let maxSegmentSeconds: TimeInterval = 240
  private var levelThrottle: Date = .distantPast

  // MARK: - Permissions

  static func requestPermissions(completion: @escaping (Bool, Bool) -> Void) {
    let afterMic: (Bool) -> Void = { micGranted in
      SFSpeechRecognizerRequestAuthorizationShim.request { speechGranted in
        completion(micGranted, speechGranted)
      }
    }
    if #available(iOS 17.0, *) {
      AVAudioApplication.requestRecordPermission(completionHandler: afterMic)
    } else {
      AVAudioSession.sharedInstance().requestRecordPermission(afterMic)
    }
  }

  // MARK: - Session lifecycle

  /// Configure the session (opting into HQ Bluetooth recording when available),
  /// start the engine + wake-word listening, and return route telemetry.
  func startSession(
    sessionId: String,
    wakePhrases: [String],
    stopPhrases: [String],
    preRollSeconds: Double,
    endSilenceSeconds: Double
  ) throws -> [String: Any] {
    self.sessionId = sessionId
    self.wakePhrases = wakePhrases.isEmpty ? ["hey beacon"] : wakePhrases
    self.stopPhrases = stopPhrases.isEmpty ? ["stop recording"] : stopPhrases
    self.preRollSeconds = preRollSeconds
    if endSilenceSeconds > 0 { self.silenceTimeout = endSilenceSeconds }

    let (route, hqRequested) = try configureSession()
    registerObservers()

    let input = engine.inputNode
    let inputFormat = input.inputFormat(forBus: 0)
    self.recordFormat = inputFormat

    // Ring buffer sized to the pre-roll window at the negotiated sample rate.
    let cap = Int(inputFormat.sampleRate * preRollSeconds)
    ringBuffer = RingBuffer(capacity: max(cap, 1))

    // Phrase spotter on the same audio (on-device).
    let det = AudioCaptureEngine.makeDetector(
      wakePhrases: self.wakePhrases,
      stopPhrases: self.stopPhrases
    )
    det.onMatch = { [weak self] phrase, isStop in
      self?.handleMatch(phrase: phrase, isStop: isStop)
    }
    det.onPartial = { [weak self] text in
      self?.onTranscript?(["text": text])
    }
    det.onError = { [weak self] msg in
      self?.emitError(code: "wake_word", message: msg)
    }
    try det.start(recordingFormat: inputFormat)
    self.detector = det

    input.removeTap(onBus: 0)
    input.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] buffer, _ in
      self?.process(buffer: buffer)
    }

    engine.prepare()
    do {
      try engine.start()
    } catch {
      throw ScribeAudioError.engineStartFailed(error.localizedDescription)
    }

    status = .listening
    var payload = route
    payload["hqOptionRequested"] = hqRequested
    return payload
  }

  func stopSession() {
    if status == .capturing { finishSegment(reason: "session_stopped") }
    engine.inputNode.removeTap(onBus: 0)
    if engine.isRunning { engine.stop() }
    detector?.stop()
    detector = nil
    ringBuffer?.clear()
    ringBuffer = nil
    NotificationCenter.default.removeObserver(self)
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    status = .idle
  }

  /// Manual trigger — AirPods stem press or on-screen button (PRD §11 sterile
  /// control). Arms capture without the wake word.
  func armCapture() throws {
    guard status == .listening else { throw ScribeAudioError.notCapturing }
    beginSegment(triggeredBy: "manual")
  }

  /// Manual end of the current utterance.
  func endCapture() throws {
    guard status == .capturing else { throw ScribeAudioError.notCapturing }
    finishSegment(reason: "manual")
  }

  // MARK: - Session configuration

  private func configureSession() throws -> (route: [String: Any], hqRequested: Bool) {
    let session = AVAudioSession.sharedInstance()
    var options: AVAudioSession.CategoryOptions = [.allowBluetoothA2DP, .duckOthers]
    var hqRequested = false

    if #available(iOS 26.0, *) {
      // The iOS 26 high-sample-rate AirPods link (WWDC25). Falls back to HFP
      // automatically when the route can't support it.
      options.insert(.bluetoothHighQualityRecording)
      options.insert(.allowBluetoothHFP)
      hqRequested = true
    } else {
      options.insert(.allowBluetoothHFP) // legacy HFP link (8–16 kHz)
    }

    do {
      try session.setCategory(.playAndRecord, mode: .default, options: options)
      // Do NOT force a sample rate — let the HQ link negotiate and report what
      // we actually got (this telemetry is the whole point of the spike).
      try session.setActive(true, options: .notifyOthersOnDeactivation)
    } catch {
      throw ScribeAudioError.sessionConfigFailed(error.localizedDescription)
    }

    return (currentRouteInfo(), hqRequested)
  }

  /// Public snapshot of the current input route (for getRouteAsync).
  func currentRouteSnapshot() -> [String: Any] {
    return currentRouteInfo()
  }

  private func currentRouteInfo() -> [String: Any] {
    let session = AVAudioSession.sharedInstance()
    let input = session.currentRoute.inputs.first
    let portType = input?.portType.rawValue ?? "unknown"
    let isBluetooth =
      portType == AVAudioSession.Port.bluetoothHFP.rawValue ||
      portType == AVAudioSession.Port.bluetoothLE.rawValue ||
      portType == AVAudioSession.Port.bluetoothA2DP.rawValue
    let sampleRate = engine.inputNode.inputFormat(forBus: 0).sampleRate > 0
      ? engine.inputNode.inputFormat(forBus: 0).sampleRate
      : session.sampleRate
    let channelCount = Int(engine.inputNode.inputFormat(forBus: 0).channelCount)

    return [
      "portName": input?.portName ?? "unknown",
      "portType": portType,
      "sampleRate": sampleRate,
      "channelCount": channelCount,
      "isBluetooth": isBluetooth,
      // Heuristic: a Bluetooth route above narrowband implies the HQ link
      // engaged rather than falling back to 8–16 kHz HFP. Confirm empirically.
      "highQuality": isBluetooth && sampleRate > 16_000,
    ]
  }

  private static func makeDetector(wakePhrases: [String], stopPhrases: [String]) -> WakeWordDetector {
    // Production: return PorcupineWakeWordDetector(...) here instead.
    return SpeechWakeWordDetector(wakePhrases: wakePhrases, stopPhrases: stopPhrases)
  }

  // MARK: - Audio processing (realtime thread)

  private func process(buffer: AVAudioPCMBuffer) {
    guard let channel = buffer.floatChannelData?[0] else { return }
    let frames = Int(buffer.frameLength)
    let samples = UnsafeBufferPointer(start: channel, count: frames)

    // 1) Pre-trigger buffer.
    ringBuffer?.append(samples)

    // 2) Wake-word engine.
    detector?.append(buffer: buffer)

    // 3) Level metering (throttled to ~10 Hz).
    let rms = Self.rms(samples)
    let now = Date()
    if now.timeIntervalSince(levelThrottle) > 0.1 {
      levelThrottle = now
      let peak = Self.peak(samples)
      DispatchQueue.main.async { [weak self] in
        self?.onLevel?(["rms": rms, "peak": peak])
      }
    }

    // 4) Active segment write + silence/length auto-end.
    if status == .capturing, let file = segmentFile {
      do {
        try file.write(from: buffer)
        segmentFrameCount += AVAudioFramePosition(frames)
      } catch {
        emitError(code: "segment_write", message: error.localizedDescription)
      }

      if rms > silenceThreshold { lastVoiceAt = now }
      let elapsed = segmentStartedAt.map { now.timeIntervalSince($0) } ?? 0
      let silentFor = now.timeIntervalSince(lastVoiceAt)
      if (silentFor > silenceTimeout && elapsed > 1.0) || elapsed > maxSegmentSeconds {
        DispatchQueue.main.async { [weak self] in
          guard let self, self.status == .capturing else { return }
          self.finishSegment(reason: silentFor > self.silenceTimeout ? "silence" : "max_length")
        }
      }
    }
  }

  // MARK: - Segment recording

  private func handleMatch(phrase: String, isStop: Bool) {
    if isStop {
      // Stop word only acts while capturing.
      guard status == .capturing else { return }
      finishSegment(reason: "stop_word")
      return
    }
    // Wake word only acts while listening — a fresh segment each time.
    onWakeWord?(["at": Self.iso(Date()), "confidence": 0.9, "matchedText": phrase])
    guard status == .listening else { return }
    beginSegment(triggeredBy: "wake_word")
  }

  private func beginSegment(triggeredBy: String) {
    guard let recordFormat else { return }
    AudioServicesPlaySystemSound(1113) // begin_record tone (PRD §5.1 audio confirmation)

    segmentId = UUID().uuidString
    segmentStartedAt = Date()
    lastVoiceAt = Date()
    segmentFrameCount = 0

    let url = segmentURL(segmentId: segmentId)
    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVSampleRateKey: recordFormat.sampleRate,
      AVNumberOfChannelsKey: 1,
      AVLinearPCMBitDepthKey: 16,
      AVLinearPCMIsFloatKey: false,
      AVLinearPCMIsBigEndianKey: false,
    ]
    do {
      let file = try AVAudioFile(forWriting: url, settings: settings)
      segmentFile = file
      // Flush the pre-trigger buffer first so the start of the utterance
      // (spoken before the wake word finished) is preserved.
      if let preRoll = makePreRollBuffer(format: file.processingFormat) {
        try? file.write(from: preRoll)
        segmentFrameCount += AVAudioFramePosition(preRoll.frameLength)
      }
      status = .capturing
    } catch {
      emitError(code: "segment_open", message: error.localizedDescription)
    }
  }

  private func finishSegment(reason: String) {
    guard let file = segmentFile, let startedAt = segmentStartedAt else { return }
    let url = file.url
    let sampleRate = file.fileFormat.sampleRate
    let durationMs = Double(segmentFrameCount) / sampleRate * 1000.0
    segmentFile = nil // closes/flushes the file
    segmentStartedAt = nil

    AudioServicesPlaySystemSound(1114) // end_record tone
    status = engine.isRunning ? .listening : .idle

    // Clear the recognizer's accumulated transcript so the NEXT "hey beacon" is
    // spotted cleanly (fixes second-trigger misses).
    detector?.reset()

    let payload: [String: Any] = [
      "segmentId": segmentId,
      "uri": url.absoluteString,
      "durationMs": durationMs,
      "sampleRate": sampleRate,
      "startedAt": Self.iso(startedAt),
      "endReason": reason,
    ]
    DispatchQueue.main.async { [weak self] in self?.onSegment?(payload) }
  }

  private func makePreRollBuffer(format: AVAudioFormat) -> AVAudioPCMBuffer? {
    guard let samples = ringBuffer?.snapshot(), !samples.isEmpty else { return nil }
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)),
          let dst = buffer.floatChannelData?[0] else { return nil }
    samples.withUnsafeBufferPointer { src in
      dst.update(from: src.baseAddress!, count: samples.count)
    }
    buffer.frameLength = AVAudioFrameCount(samples.count)
    return buffer
  }

  private func segmentURL(segmentId: String) -> URL {
    let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("scribe/\(sessionId)", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent("\(segmentId).wav")
  }

  // MARK: - Route / interruption resilience (PRD §7 Bluetooth dropout)

  private func registerObservers() {
    let nc = NotificationCenter.default
    nc.addObserver(self, selector: #selector(handleRouteChange(_:)),
                   name: AVAudioSession.routeChangeNotification, object: nil)
    nc.addObserver(self, selector: #selector(handleInterruption(_:)),
                   name: AVAudioSession.interruptionNotification, object: nil)
    nc.addObserver(self, selector: #selector(handleMediaReset(_:)),
                   name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
  }

  @objc private func handleRouteChange(_ note: Notification) {
    let info = currentRouteInfo()
    DispatchQueue.main.async { [weak self] in self?.onRouteChange?(info) }
  }

  @objc private func handleInterruption(_ note: Notification) {
    guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
    switch type {
    case .began:
      if status == .capturing { finishSegment(reason: "interrupted") }
    case .ended:
      // Reactivate and resume listening; the case must survive the blip.
      try? AVAudioSession.sharedInstance().setActive(true)
      if !engine.isRunning { try? engine.start() }
    @unknown default:
      break
    }
  }

  @objc private func handleMediaReset(_ note: Notification) {
    emitError(code: "media_services_reset", message: "Audio stack reset — restart session")
  }

  // MARK: - Helpers

  private func emitError(code: String, message: String) {
    DispatchQueue.main.async { [weak self] in
      self?.onError?(["code": code, "message": message])
    }
  }

  private static func rms(_ s: UnsafeBufferPointer<Float>) -> Float {
    guard !s.isEmpty else { return 0 }
    var sum: Float = 0
    for v in s { sum += v * v }
    return (sum / Float(s.count)).squareRoot()
  }

  private static func peak(_ s: UnsafeBufferPointer<Float>) -> Float {
    var p: Float = 0
    for v in s { p = max(p, abs(v)) }
    return p
  }

  private static let isoFormatter: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
  }()
  private static func iso(_ date: Date) -> String { isoFormatter.string(from: date) }
}

/// Small shim wrapping the Speech authorization callback.
enum SFSpeechRecognizerRequestAuthorizationShim {
  static func request(_ completion: @escaping (Bool) -> Void) {
    SFSpeechRecognizer.requestAuthorization { authStatus in
      completion(authStatus == .authorized)
    }
  }
}
