/**
 * ScribeCaptureScreen — live intraop capture + on-device audio test harness.
 *
 * Drives the beacon-scribe-audio native module and surfaces exactly the
 * telemetry the AirPods spike needs (prds/airpods-capture-spike.md §4):
 * negotiated route, sample rate, HQ-vs-HFP, wake-word hits, and each recorded
 * utterance. Wake word ("hey beacon") arms capture hands-free; the on-screen
 * button is the manual / stem-press fallback (PRD §5.1, §11).
 */
import { FC, useEffect, useRef } from "react"
import { Pressable, ScrollView, TextStyle, View, ViewStyle } from "react-native"

import { Button } from "@/components/Button"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { useAuth } from "@/context/AuthContext"
import { useScribeAudio } from "@/hooks/useScribeAudio"
import type { ScribeStackScreenProps } from "@/navigators/navigationTypes"
import { getUploadUrl, ingestSegment } from "@/services/api/scribeApi"
import { useAppTheme } from "@/theme/context"
import { addSegment, updateSession } from "@/utils/scribe/sessionStore"
import { useHeader } from "@/utils/useHeader"

interface ScribeCaptureScreenProps extends ScribeStackScreenProps<"ScribeCapture"> {}

// "Beacon" is an uncommon word the recognizer easily mishears, so we accept
// close variants too. contextualStrings (native side) biases toward these.
const WAKE_PHRASES = [
  "hey beacon",
  "beacon note",
  "beacon",
  "hey bacon",
  "hey beckon",
  "beckon",
]

// Say one of these to end the current recording. Kept specific so they don't
// false-trigger inside normal dictation (avoid a bare "stop").
const STOP_PHRASES = ["stop recording", "end recording", "beacon stop", "beacon done"]

export const ScribeCaptureScreen: FC<ScribeCaptureScreenProps> = function ScribeCaptureScreen({
  navigation,
  route,
}) {
  const { theme } = useAppTheme()
  const { sessionId, procedureType } = route.params
  const { surgeonId } = useAuth()
  const audio = useScribeAudio()
  const startedRef = useRef(false)
  // Last successfully-ingested segment — resent with endOfCase:true to
  // trigger the pipeline, since the wire contract has no separate
  // "just end the case" call (PRD §3.4).
  const lastIngestedRef = useRef<{ segmentId: string; audioKey: string } | null>(null)
  // Flipped just before the intentional `endCase` replace() so the
  // beforeRemove guard below lets that one navigation through.
  const allowLeaveRef = useRef(false)

  useHeader({ title: "Capture" })

  // Block back navigation (gesture + Android hardware back — there's no
  // header back button to begin with) for the entire time this screen is
  // mounted, regardless of audio.status. A live session exists as soon as
  // this screen is reached (ScribeProcedureSelectScreen already created it),
  // so idle/listening states need the same protection as capturing — the
  // only supported way off this screen is the explicit "End case" button.
  // Do not gate this on audio.status === "capturing"; that would reopen the
  // gap during idle/listening.
  useEffect(() => {
    return navigation.addListener("beforeRemove", (e) => {
      if (allowLeaveRef.current) return
      e.preventDefault()
    })
  }, [navigation])

  // Persist each recorded utterance to the session as it lands, then upload
  // + ingest it against the real backend (PRD §5 step 4).
  audio.onSegment((seg) => {
    addSegment(sessionId, {
      segmentId: seg.segmentId,
      uri: seg.uri,
      durationMs: seg.durationMs,
      sampleRate: seg.sampleRate,
      startedAt: seg.startedAt,
      endReason: seg.endReason,
    })

    if (!surgeonId) return
    ;(async () => {
      try {
        const { uploadUrl, audioKey } = await getUploadUrl(sessionId, seg.segmentId)
        const audioBlob = await (await fetch(seg.uri)).blob()
        await fetch(uploadUrl, {
          method: "PUT",
          body: audioBlob,
          headers: { "Content-Type": "audio/wav" },
        })
        await ingestSegment({
          sessionId,
          surgeonId,
          procedureType,
          segmentId: seg.segmentId,
          audioKey,
          endOfCase: false,
        })
        lastIngestedRef.current = { segmentId: seg.segmentId, audioKey }
      } catch (err) {
        // The local sessionStore copy above already has this segment; the
        // client's local-queue retry story (PRD §7) covers re-sending
        // failed ingests, not yet built here — surfacing for now.
        console.warn("Segment upload/ingest failed", err)
      }
    })()
  })

  // Request permission and start the session once, on mount.
  useEffect(() => {
    if (!audio.available || startedRef.current) return
    startedRef.current = true
    ;(async () => {
      await audio.requestPermission()
      try {
        const r = await audio.start(sessionId, WAKE_PHRASES, STOP_PHRASES)
        if (r) {
          updateSession(sessionId, {
            route: {
              portType: r.portType,
              sampleRate: r.sampleRate,
              highQuality: r.highQuality,
              isBluetooth: r.isBluetooth,
            },
          })
        }
      } catch {
        // Error surfaced via audio.error below.
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio.available])

  async function endCase() {
    await audio.stop()
    updateSession(sessionId, { endedAt: new Date().toISOString() })

    if (surgeonId && lastIngestedRef.current) {
      try {
        await ingestSegment({
          sessionId,
          surgeonId,
          procedureType,
          ...lastIngestedRef.current,
          endOfCase: true,
        })
      } catch (err) {
        console.warn("Failed to signal end-of-case to backend", err)
      }
    }

    allowLeaveRef.current = true
    navigation.replace("ScribeReview", { sessionId })
  }

  if (!audio.available) {
    return (
      <Screen preset="fixed" contentContainerStyle={$center} safeAreaEdges={["bottom"]}>
        <Text preset="heading" text="Device build required" />
        <Text
          preset="default"
          text="Audio capture needs the native iOS dev build on a physical device (not Expo Go / Simulator)."
          style={[$centerText, { color: theme.colors.textDim }]}
        />
      </Screen>
    )
  }

  const isCapturing = audio.status === "capturing"
  const levelPct = Math.min(100, Math.round(audio.level.rms * 400))
  const r = audio.route

  return (
    <Screen preset="fixed" safeAreaEdges={["bottom"]}>
      <ScrollView contentContainerStyle={$content}>
        {/* Big glanceable status (surgeon can't study the screen). */}
        <View
          style={[
            $statusCard,
            {
              backgroundColor: isCapturing
                ? theme.colors.palette.primary100
                : theme.colors.palette.neutral200,
              borderColor: isCapturing ? theme.colors.tint : theme.colors.border,
            },
          ]}
        >
          <View
            style={[
              $dot,
              { backgroundColor: isCapturing ? theme.colors.tint : theme.colors.textDim },
            ]}
          />
          <Text
            preset="heading"
            text={
              audio.status === "capturing"
                ? "Recording — say “stop recording”"
                : audio.status === "listening"
                  ? "Listening for “Hey Beacon”"
                  : "Idle"
            }
            style={$statusText}
          />
        </View>

        {/* Live input level. */}
        <View style={[$meterTrack, { backgroundColor: theme.colors.palette.neutral200 }]}>
          <View
            style={[$meterFill, { width: `${levelPct}%`, backgroundColor: theme.colors.tint }]}
          />
        </View>

        {/* Route telemetry — the spike deliverable. */}
        <View style={[$panel, { borderColor: theme.colors.border }]}>
          <Text preset="formLabel" text="INPUT ROUTE" style={$panelLabel} />
          {r ? (
            <>
              <Row label="Device" value={r.portName} theme={theme} />
              <Row label="Port type" value={r.portType} theme={theme} />
              <Row label="Sample rate" value={`${(r.sampleRate / 1000).toFixed(1)} kHz`} theme={theme} />
              <Row label="Channels" value={String(r.channelCount)} theme={theme} />
              <Row
                label="Link"
                value={
                  r.highQuality
                    ? "High-quality (iOS 26)"
                    : r.isBluetooth
                      ? "Bluetooth HFP (narrowband)"
                      : "Wired / built-in"
                }
                emphasize={r.highQuality}
                theme={theme}
              />
            </>
          ) : (
            <Text preset="default" text="Negotiating…" style={{ color: theme.colors.textDim }} />
          )}
        </View>

        {/* Manual trigger (stem-press fallback). */}
        <Pressable
          onPressIn={() => audio.arm().catch(() => {})}
          onPressOut={() => audio.end().catch(() => {})}
          style={[
            $holdButton,
            {
              backgroundColor: isCapturing ? theme.colors.tint : theme.colors.palette.neutral100,
              borderColor: theme.colors.tint,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Hold to dictate"
        >
          <Text
            preset="bold"
            text={isCapturing ? "Recording — release to stop" : "Hold to dictate"}
            style={{ color: isCapturing ? theme.colors.palette.neutral100 : theme.colors.text }}
          />
        </Pressable>

        {/* Wake-word: live transcript + hits (debug the recognizer). */}
        <View style={[$panel, { borderColor: theme.colors.border }]}>
          <Text preset="formLabel" text="WAKE WORD" style={$panelLabel} />
          <Text
            preset="default"
            text={audio.transcript ? `Heard: “${audio.transcript}”` : "Listening… (say “Hey Beacon”)"}
            style={{ color: theme.colors.textDim, marginBottom: audio.wakeEvents.length ? 10 : 0 }}
          />
          {audio.wakeEvents.slice(0, 5).map((w, i) => (
            <Text
              key={`${w.at}-${i}`}
              preset="bold"
              text={`✓ “${w.matchedText}” · ${new Date(w.at).toLocaleTimeString()}`}
              style={{ color: theme.colors.tint, marginBottom: 2 }}
            />
          ))}
        </View>

        {/* Recorded utterances. */}
        <View style={[$panel, { borderColor: theme.colors.border }]}>
          <Text
            preset="formLabel"
            text={`RECORDED UTTERANCES (${audio.segments.length})`}
            style={$panelLabel}
          />
          {audio.segments.length === 0 ? (
            <Text
              preset="default"
              text="Say the wake word or hold the button to record."
              style={{ color: theme.colors.textDim }}
            />
          ) : (
            audio.segments.map((s) => (
              <View key={s.segmentId} style={$segmentRow}>
                <Text
                  preset="default"
                  text={`${(s.durationMs / 1000).toFixed(1)}s`}
                  style={$segmentDuration}
                />
                <Text
                  preset="default"
                  text={`${(s.sampleRate / 1000).toFixed(0)}kHz · ${s.endReason}`}
                  style={{ color: theme.colors.textDim }}
                />
              </View>
            ))
          )}
        </View>

        {audio.error && (
          <Text
            preset="default"
            text={`⚠ ${audio.error.code}: ${audio.error.message}`}
            style={[$error, { color: theme.colors.error }]}
          />
        )}

        <Button preset="reversed" text="End case" onPress={endCase} style={$endButton} />
      </ScrollView>
    </Screen>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Row({ label, value, emphasize, theme }: { label: string; value: string; emphasize?: boolean; theme: any }) {
  return (
    <View style={$row}>
      <Text preset="default" text={label} style={{ color: theme.colors.textDim }} />
      <Text
        preset={emphasize ? "bold" : "default"}
        text={value}
        style={{ color: emphasize ? theme.colors.tint : theme.colors.text }}
      />
    </View>
  )
}

const $content: ViewStyle = { padding: 20, paddingBottom: 40 }
const $center: ViewStyle = { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }
const $centerText: TextStyle = { textAlign: "center", marginTop: 8 }
const $statusCard: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  borderRadius: 16,
  borderWidth: 2,
  padding: 20,
  marginBottom: 16,
}
const $dot: ViewStyle = { width: 14, height: 14, borderRadius: 7, marginRight: 12 }
const $statusText: TextStyle = { fontSize: 20, flex: 1 }
const $meterTrack: ViewStyle = { height: 10, borderRadius: 5, overflow: "hidden", marginBottom: 20 }
const $meterFill: ViewStyle = { height: 10, borderRadius: 5 }
const $panel: ViewStyle = { borderRadius: 14, borderWidth: 2, padding: 16, marginBottom: 16 }
const $panelLabel: TextStyle = { marginBottom: 10, letterSpacing: 1 }
const $row: ViewStyle = {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 8,
}
const $holdButton: ViewStyle = {
  minHeight: 72,
  borderRadius: 16,
  borderWidth: 2,
  justifyContent: "center",
  alignItems: "center",
  marginBottom: 16,
}
const $segmentRow: ViewStyle = {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingVertical: 8,
}
const $segmentDuration: TextStyle = { fontSize: 16, fontWeight: "600" }
const $error: TextStyle = { marginBottom: 16 }
const $endButton: ViewStyle = { marginTop: 8 }
