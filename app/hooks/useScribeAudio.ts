/**
 * useScribeAudio — React binding for the beacon-scribe-audio native module.
 *
 * Owns the capture lifecycle and surfaces live state (status, input route,
 * level meter, wake-word hits, recorded segments, errors) for the capture
 * screen. iOS-only; on unsupported platforms `available` is false.
 */
import { useCallback, useEffect, useRef, useState } from "react"

import * as ScribeAudio from "beacon-scribe-audio"
import type {
  CaptureRoute,
  CaptureStatus,
  LevelEvent,
  ScribeAudioErrorEvent,
  SegmentEvent,
  WakeWordEvent,
} from "beacon-scribe-audio"

export interface UseScribeAudioResult {
  available: boolean
  status: CaptureStatus
  route: CaptureRoute | null
  level: LevelEvent
  /** Live partial transcript from the wake-word recognizer (debug aid). */
  transcript: string
  wakeEvents: WakeWordEvent[]
  segments: SegmentEvent[]
  error: ScribeAudioErrorEvent | null
  permission: { microphone: boolean; speechRecognition: boolean } | null
  requestPermission: () => Promise<void>
  start: (
    sessionId: string,
    wakePhrases: string[],
    stopPhrases: string[],
  ) => Promise<CaptureRoute | null>
  stop: () => Promise<void>
  /** Manual trigger — on-screen button / AirPods stem. */
  arm: () => Promise<void>
  end: () => Promise<void>
  onSegment: (cb: (s: SegmentEvent) => void) => void
}

const PRE_ROLL_SECONDS = 6

export function useScribeAudio(): UseScribeAudioResult {
  const available = ScribeAudio.isAvailable

  const [status, setStatus] = useState<CaptureStatus>("idle")
  const [route, setRoute] = useState<CaptureRoute | null>(null)
  const [level, setLevel] = useState<LevelEvent>({ rms: 0, peak: 0 })
  const [transcript, setTranscript] = useState<string>("")
  const [wakeEvents, setWakeEvents] = useState<WakeWordEvent[]>([])
  const [segments, setSegments] = useState<SegmentEvent[]>([])
  const [error, setError] = useState<ScribeAudioErrorEvent | null>(null)
  const [permission, setPermission] = useState<UseScribeAudioResult["permission"]>(null)

  // Let a caller (the screen) react to each new segment without re-subscribing.
  const segmentCb = useRef<((s: SegmentEvent) => void) | null>(null)
  const onSegment = useCallback((cb: (s: SegmentEvent) => void) => {
    segmentCb.current = cb
  }, [])

  useEffect(() => {
    if (!available) return

    const subs = [
      ScribeAudio.addListener("onStatusChange", (e) => setStatus(e.status)),
      ScribeAudio.addListener("onRouteChange", (e) => setRoute(e)),
      ScribeAudio.addListener("onLevel", (e) => setLevel(e)),
      ScribeAudio.addListener("onTranscript", (e) => setTranscript(e.text)),
      ScribeAudio.addListener("onWakeWord", (e) => setWakeEvents((prev) => [e, ...prev].slice(0, 50))),
      ScribeAudio.addListener("onSegment", (e) => {
        setSegments((prev) => [e, ...prev])
        segmentCb.current?.(e)
      }),
      ScribeAudio.addListener("onError", (e) => setError(e)),
    ]
    return () => {
      subs.forEach((s) => s.remove())
      // Ensure the engine is torn down if the screen unmounts mid-capture.
      ScribeAudio.stopSessionAsync().catch(() => {})
    }
  }, [available])

  const requestPermission = useCallback(async () => {
    if (!available) return
    const result = await ScribeAudio.requestPermissionsAsync()
    setPermission(result)
  }, [available])

  const start = useCallback(
    async (sessionId: string, wakePhrases: string[], stopPhrases: string[]) => {
      if (!available) return null
      setError(null)
      setSegments([])
      setWakeEvents([])
      setTranscript("")
      const r = await ScribeAudio.startSessionAsync({
        sessionId,
        wakePhrases,
        stopPhrases,
        preRollSeconds: PRE_ROLL_SECONDS,
      })
      setRoute(r)
      return r
    },
    [available],
  )

  const stop = useCallback(async () => {
    if (!available) return
    await ScribeAudio.stopSessionAsync()
  }, [available])

  const arm = useCallback(async () => {
    if (!available) return
    await ScribeAudio.armCaptureAsync()
  }, [available])

  const end = useCallback(async () => {
    if (!available) return
    await ScribeAudio.endCaptureAsync()
  }, [available])

  return {
    available,
    status,
    route,
    level,
    transcript,
    wakeEvents,
    segments,
    error,
    permission,
    requestPermission,
    start,
    stop,
    arm,
    end,
    onSegment,
  }
}
