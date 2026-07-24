/**
 * beacon-scribe-audio — native AirPods HQ capture + on-device wake word (iOS).
 *
 * See prds/intra-op-scribe.md §5.1 and prds/airpods-capture-spike.md.
 * iOS only. On other platforms `isAvailable` is false and calls throw.
 */
import { requireNativeModule, EventSubscription } from "expo-modules-core"
import { Platform } from "react-native"

import type {
  BeaconScribeAudioEvents,
  CaptureRoute,
  PermissionResult,
  StartSessionOptions,
} from "./src/BeaconScribeAudio.types"

export * from "./src/BeaconScribeAudio.types"

interface NativeBeaconScribeAudio {
  requestPermissionsAsync(): Promise<PermissionResult>
  startSessionAsync(options: StartSessionOptions): Promise<CaptureRoute>
  stopSessionAsync(): Promise<void>
  armCaptureAsync(): Promise<void>
  endCaptureAsync(): Promise<void>
  getRouteAsync(): Promise<CaptureRoute>
  addListener<T extends keyof BeaconScribeAudioEvents>(
    event: T,
    listener: BeaconScribeAudioEvents[T],
  ): EventSubscription
}

/** True only where the native module is linked (iOS dev build / device). */
export const isAvailable: boolean = Platform.OS === "ios"

let native: NativeBeaconScribeAudio | null = null
function getNative(): NativeBeaconScribeAudio {
  if (!isAvailable) {
    throw new Error("beacon-scribe-audio is iOS-only and requires a dev build (not Expo Go / Simulator-limited).")
  }
  if (!native) {
    native = requireNativeModule<NativeBeaconScribeAudio>("BeaconScribeAudio")
  }
  return native
}

/**
 * Request microphone + speech-recognition permission. Both are needed:
 * mic for capture, speech for the on-device wake word.
 */
export function requestPermissionsAsync(): Promise<PermissionResult> {
  return getNative().requestPermissionsAsync()
}

/**
 * Configure the audio session (opting into iOS 26 HQ Bluetooth recording),
 * start the engine, and begin wake-word listening. Resolves with the
 * negotiated route telemetry — inspect it to confirm HQ vs HFP.
 */
export function startSessionAsync(options: StartSessionOptions): Promise<CaptureRoute> {
  return getNative().startSessionAsync(options)
}

/** Stop the engine and deactivate the audio session. */
export function stopSessionAsync(): Promise<void> {
  return getNative().stopSessionAsync()
}

/** Manually arm capture (AirPods stem press / on-screen button). */
export function armCaptureAsync(): Promise<void> {
  return getNative().armCaptureAsync()
}

/** Manually end the current utterance. */
export function endCaptureAsync(): Promise<void> {
  return getNative().endCaptureAsync()
}

/** Snapshot the current input route without changing state. */
export function getRouteAsync(): Promise<CaptureRoute> {
  return getNative().getRouteAsync()
}

/** Subscribe to a native event. Remember to `.remove()` the subscription. */
export function addListener<T extends keyof BeaconScribeAudioEvents>(
  event: T,
  listener: BeaconScribeAudioEvents[T],
): EventSubscription {
  return getNative().addListener(event, listener)
}
