/**
 * Types for the beacon-scribe-audio native module.
 * Mirrors the payloads emitted by ios/AudioCaptureEngine.swift.
 */

/** Live capture state. */
export type CaptureStatus = "idle" | "listening" | "capturing"

/**
 * Negotiated input-route telemetry — the core output of the AirPods spike
 * (prds/airpods-capture-spike.md §4). Inspect `highQuality` / `sampleRate`
 * to confirm the iOS 26 HQ link engaged vs. falling back to 8–16 kHz HFP.
 */
export interface CaptureRoute {
  portName: string
  /** AVAudioSession port type, e.g. "BluetoothHFP". */
  portType: string
  sampleRate: number
  channelCount: number
  isBluetooth: boolean
  /** Heuristic: Bluetooth route above narrowband → HQ link engaged. */
  highQuality: boolean
  /** Whether the .bluetoothHighQualityRecording option was requested (iOS 26+). */
  hqOptionRequested?: boolean
}

export interface StartSessionOptions {
  sessionId: string
  /** Phrases that start a recording while listening. Lowercased match. */
  wakePhrases: string[]
  /** Phrases that end the current recording while capturing. */
  stopPhrases: string[]
  /** Rolling pre-trigger window retained locally (PRD §5.1, ~5–8s). */
  preRollSeconds: number
  /** Silence (s) that auto-ends a segment as a safety net; 0 = native default. */
  endSilenceSeconds?: number
}

export interface PermissionResult {
  microphone: boolean
  speechRecognition: boolean
}

/* ---- Event payloads ---- */

export interface StatusChangeEvent {
  status: CaptureStatus
}

export interface WakeWordEvent {
  /** ISO 8601. */
  at: string
  confidence: number
  matchedText: string
}

/** Live partial transcript from the wake-word recognizer (for debugging). */
export interface TranscriptEvent {
  text: string
}

export interface LevelEvent {
  rms: number
  peak: number
}

/** A captured utterance written to a local WAV file. */
export interface SegmentEvent {
  segmentId: string
  /** file:// URI of the recorded utterance. */
  uri: string
  durationMs: number
  sampleRate: number
  /** ISO 8601. */
  startedAt: string
  endReason:
    | "stop_word"
    | "manual"
    | "silence"
    | "max_length"
    | "interrupted"
    | "session_stopped"
}

export interface RouteChangeEvent extends CaptureRoute {}

export interface ScribeAudioErrorEvent {
  code: string
  message: string
}

export interface BeaconScribeAudioEvents {
  onStatusChange: (e: StatusChangeEvent) => void
  onWakeWord: (e: WakeWordEvent) => void
  onTranscript: (e: TranscriptEvent) => void
  onLevel: (e: LevelEvent) => void
  onSegment: (e: SegmentEvent) => void
  onRouteChange: (e: RouteChangeEvent) => void
  onError: (e: ScribeAudioErrorEvent) => void
}
