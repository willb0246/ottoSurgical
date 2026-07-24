import ExpoModulesCore

/// Expo bridge for the intraoperative scribe capture engine.
///
/// JS surface (see src/index.ts):
///   requestPermissionsAsync() -> { microphone, speechRecognition }
///   startSessionAsync(options) -> CaptureRoute      // engine on, wake-word armed
///   stopSessionAsync()
///   armCaptureAsync()                               // manual / stem trigger
///   endCaptureAsync()
///   getRouteAsync() -> CaptureRoute
///
/// Events: onStatusChange, onWakeWord, onLevel, onSegment, onRouteChange, onError
public class BeaconScribeAudioModule: Module {
  private let engine = AudioCaptureEngine()

  public func definition() -> ModuleDefinition {
    Name("BeaconScribeAudio")

    Events(
      "onStatusChange",
      "onWakeWord",
      "onTranscript",
      "onLevel",
      "onSegment",
      "onRouteChange",
      "onError"
    )

    OnCreate {
      self.wireEngineEvents()
    }

    AsyncFunction("requestPermissionsAsync") { (promise: Promise) in
      AudioCaptureEngine.requestPermissions { mic, speech in
        promise.resolve([
          "microphone": mic,
          "speechRecognition": speech,
        ])
      }
    }

    AsyncFunction("startSessionAsync") { (options: StartSessionOptions, promise: Promise) in
      do {
        let route = try self.engine.startSession(
          sessionId: options.sessionId,
          wakePhrases: options.wakePhrases,
          stopPhrases: options.stopPhrases,
          preRollSeconds: options.preRollSeconds,
          endSilenceSeconds: options.endSilenceSeconds
        )
        promise.resolve(route)
      } catch {
        promise.reject("E_START", error.localizedDescription)
      }
    }

    AsyncFunction("stopSessionAsync") { (promise: Promise) in
      self.engine.stopSession()
      promise.resolve(nil)
    }

    AsyncFunction("armCaptureAsync") { (promise: Promise) in
      do { try self.engine.armCapture(); promise.resolve(nil) }
      catch { promise.reject("E_ARM", error.localizedDescription) }
    }

    AsyncFunction("endCaptureAsync") { (promise: Promise) in
      do { try self.engine.endCapture(); promise.resolve(nil) }
      catch { promise.reject("E_END", error.localizedDescription) }
    }

    AsyncFunction("getRouteAsync") { () -> [String: Any] in
      // Reflects the currently negotiated input route.
      return self.engine.currentRouteSnapshot()
    }

    OnDestroy {
      self.engine.stopSession()
    }
  }

  private func wireEngineEvents() {
    engine.onStatusChange = { [weak self] status in self?.sendEvent("onStatusChange", ["status": status]) }
    engine.onWakeWord = { [weak self] payload in self?.sendEvent("onWakeWord", payload) }
    engine.onTranscript = { [weak self] payload in self?.sendEvent("onTranscript", payload) }
    engine.onLevel = { [weak self] payload in self?.sendEvent("onLevel", payload) }
    engine.onSegment = { [weak self] payload in self?.sendEvent("onSegment", payload) }
    engine.onRouteChange = { [weak self] payload in self?.sendEvent("onRouteChange", payload) }
    engine.onError = { [weak self] payload in self?.sendEvent("onError", payload) }
  }
}

/// Typed options record for startSessionAsync.
struct StartSessionOptions: Record {
  @Field var sessionId: String = ""
  @Field var wakePhrases: [String] = ["hey beacon"]
  @Field var stopPhrases: [String] = ["stop recording"]
  @Field var preRollSeconds: Double = 6.0
  /// Silence (seconds) that auto-ends a segment as a safety net. The stop word
  /// is the primary end trigger. 0 keeps the native default.
  @Field var endSilenceSeconds: Double = 0
}
