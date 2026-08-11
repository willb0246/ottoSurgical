/**
 * ScribeReviewScreen — field-by-field review + transcript-span provenance +
 * the hard approval gate (PRD §4 step 5 / §5.3, extended by docs/templates.md
 * §5-6). Pulls the real DraftNote from the backend once the pipeline
 * reaches draft_ready; while the session is still processing, shows the
 * captured utterances instead.
 *
 * Fields split into two groups per docs/templates.md §4:
 *   - Findings (hasDefault: false) — unchanged from before this feature:
 *     editable, evidence-backed, populated/not-stated.
 *   - Template defaults (hasDefault: true) — start "default_unconfirmed"
 *     and must each be resolved (Confirm / No — record / No — remove)
 *     before Approve unlocks; every default-bearing field is removable,
 *     there's no more "protected" field. "No — record" reuses the same
 *     capture → upload → transcribe pipeline as intraop dictation, just
 *     pointed at startFieldRecord/pollFieldRecord instead of the full case
 *     pipeline.
 */
import { FC, useCallback, useEffect, useRef, useState } from "react"
import { Pressable, ScrollView, TextStyle, View, ViewStyle } from "react-native"
import { useFocusEffect } from "@react-navigation/native"

import { Button } from "@/components/Button"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import { useAuth } from "@/context/AuthContext"
import { useScribeAudio } from "@/hooks/useScribeAudio"
import type { ScribeStackScreenProps } from "@/navigators/navigationTypes"
import { approveNote, getDraft, getUploadUrl } from "@/services/api/scribeApi"
import { pollFieldRecord, startFieldRecord } from "@/services/api/templatesApi"
import { useAppTheme } from "@/theme/context"
import {
  SAFETY_LABEL,
  type DraftNote,
  type EditLogEntry,
  type NoteField,
  type NoteFieldKey,
  type NoteFieldStatus,
} from "@/types/scribe"
import { getSession, type StoredSession } from "@/utils/scribe/sessionStore"
import { useHeader } from "@/utils/useHeader"

interface ScribeReviewScreenProps extends ScribeStackScreenProps<"ScribeReview"> {}

type LoadState = "loading" | "processing" | "ready" | "error"
type RecordFlowStatus = "capturing" | "uploading" | "transcribing" | "failed"

function statusLabel(status: NoteFieldStatus): string {
  switch (status) {
    case "default_unconfirmed":
      return "Unconfirmed"
    case "default_confirmed":
      return "Confirmed"
    case "default_removed":
      return "Removed"
    case "spoken":
      return "Recorded"
    case "not_stated":
    default:
      return "Not stated"
  }
}

export const ScribeReviewScreen: FC<ScribeReviewScreenProps> = function ScribeReviewScreen({
  navigation,
  route,
}) {
  const { theme } = useAppTheme()
  const { sessionId } = route.params
  const { surgeonId } = useAuth()
  const audio = useScribeAudio()

  const [session, setSession] = useState<StoredSession | undefined>()
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [draft, setDraft] = useState<DraftNote | undefined>()
  const [values, setValues] = useState<Record<string, string>>({})
  const [editedKeys, setEditedKeys] = useState<Set<NoteFieldKey>>(new Set())
  const [defaultFields, setDefaultFields] = useState<Record<NoteFieldKey, NoteField>>({})
  const [isApproving, setIsApproving] = useState(false)
  const [approveError, setApproveError] = useState("")

  // "No — record" in-progress state, one field at a time.
  const [recordingKey, setRecordingKey] = useState<NoteFieldKey | null>(null)
  const [recordStatus, setRecordStatus] = useState<RecordFlowStatus>("capturing")
  const [recordError, setRecordError] = useState("")
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useHeader({ title: "Review", leftIcon: "back", onLeftPress: () => navigation.goBack() })

  useEffect(() => {
    return () => {
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current)
    }
  }, [])

  const load = useCallback(async () => {
    setSession(getSession(sessionId))
    setLoadState("loading")
    try {
      const { draft: fetched } = await getDraft(sessionId)
      setDraft(fetched)
      const spoken = fetched.fields.filter((f) => !f.hasDefault)
      const events = fetched.fields.filter((f) => f.hasDefault)
      setValues(Object.fromEntries(spoken.map((f) => [f.key, f.value])))
      setEditedKeys(new Set())
      setDefaultFields(Object.fromEntries(events.map((f) => [f.key, f])))
      setLoadState("ready")
    } catch {
      setLoadState("processing")
    }
  }, [sessionId])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  function editValue(key: NoteFieldKey, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }))
    setEditedKeys((prev) => new Set(prev).add(key))
  }

  function confirmDefault(key: NoteFieldKey) {
    setDefaultFields((prev) => ({ ...prev, [key]: { ...prev[key], status: "default_confirmed" } }))
  }

  function removeDefault(key: NoteFieldKey) {
    setDefaultFields((prev) => ({
      ...prev,
      [key]: { ...prev[key], status: "default_removed", value: "", provenance: [] },
    }))
  }

  async function cancelRecordFlow() {
    await audio.stop()
    if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current)
    setRecordingKey(null)
  }

  async function startRecordFlow(key: NoteFieldKey) {
    setRecordingKey(key)
    setRecordStatus("capturing")
    setRecordError("")
    await audio.requestPermission()
    try {
      // No wake/stop phrases — this is manual hold-to-record only, not a
      // hands-free session.
      await audio.start(sessionId, [], [])
    } catch {
      setRecordStatus("failed")
      setRecordError("Couldn't start the microphone. Try again.")
    }
  }

  function pollRecordJob(key: NoteFieldKey, jobName: string) {
    const poll = async () => {
      try {
        const res = await pollFieldRecord(sessionId, key, jobName)
        if (res.status === "in_progress") {
          pollTimeoutRef.current = setTimeout(poll, 2000)
          return
        }
        if (res.status === "completed" && res.field) {
          setDefaultFields((prev) => ({ ...prev, [key]: res.field as NoteField }))
          setRecordingKey(null)
          return
        }
        setRecordStatus("failed")
        setRecordError("Transcription failed. Try again.")
      } catch {
        setRecordStatus("failed")
        setRecordError("Transcription failed. Try again.")
      }
    }
    poll()
  }

  // Fires once per recorded utterance (registered fresh each render, same
  // pattern as ScribeCaptureScreen — segmentCb is just a ref reassignment).
  audio.onSegment((seg) => {
    if (!recordingKey || !surgeonId) return
    const key = recordingKey
    ;(async () => {
      await audio.stop()
      setRecordStatus("uploading")
      try {
        const { uploadUrl, audioKey } = await getUploadUrl(sessionId, seg.segmentId)
        const audioBlob = await (await fetch(seg.uri)).blob()
        await fetch(uploadUrl, {
          method: "PUT",
          body: audioBlob,
          headers: { "Content-Type": "audio/wav" },
        })
        const { jobName } = await startFieldRecord(sessionId, key, {
          segmentId: seg.segmentId,
          audioKey,
        })
        setRecordStatus("transcribing")
        pollRecordJob(key, jobName)
      } catch {
        setRecordStatus("failed")
        setRecordError("Couldn't process the recording. Try again.")
      }
    })()
  })

  async function approve() {
    if (!draft || !surgeonId) return
    setIsApproving(true)
    setApproveError("")

    const now = new Date().toISOString()
    const spokenFields = draft.fields.filter((f) => !f.hasDefault)
    const eventFields = draft.fields
      .filter((f) => f.hasDefault)
      .map((f) => defaultFields[f.key] ?? f)

    const edits: EditLogEntry[] = spokenFields
      .filter((f) => editedKeys.has(f.key))
      .map((f) => ({
        sessionId,
        fieldKey: f.key,
        action: "edit",
        previousValue: f.value,
        newValue: values[f.key],
        actorId: surgeonId,
        at: now,
      }))

    try {
      await approveNote({
        sessionId,
        surgeonId,
        fields: [
          ...spokenFields.map((f) => ({
            key: f.key,
            value: values[f.key],
            edited: editedKeys.has(f.key),
            status: f.status,
          })),
          ...eventFields.map((f) => ({
            key: f.key,
            value: f.value,
            edited: f.status === "spoken",
            status: f.status,
          })),
        ],
        edits,
      })
      navigation.navigate("ScribeExport", { sessionId })
    } catch (err) {
      setApproveError((err as Error).message || "Approval failed. Try again.")
    } finally {
      setIsApproving(false)
    }
  }

  if (!session) {
    return (
      <Screen preset="fixed" contentContainerStyle={$center} safeAreaEdges={["bottom"]}>
        <Text preset="heading" text="Case not found" />
      </Screen>
    )
  }

  const isFinal = draft?.status === "final"
  const spokenFields = draft?.fields.filter((f) => !f.hasDefault) ?? []
  const eventFields = draft?.fields.filter((f) => f.hasDefault) ?? []
  const unresolvedCount = eventFields.filter(
    (f) => (defaultFields[f.key]?.status ?? f.status) === "default_unconfirmed",
  ).length
  const canApprove = !isApproving && unresolvedCount === 0

  return (
    <Screen preset="fixed" safeAreaEdges={["bottom"]}>
      <ScrollView contentContainerStyle={$content}>
        <Text preset="heading" text={`${session.procedureType} case`} style={$title} />

        <View style={[$banner, { backgroundColor: theme.colors.palette.neutral200 }]}>
          <Text preset="formHelper" text={SAFETY_LABEL} style={{ color: theme.colors.textDim }} />
        </View>

        {loadState === "loading" && (
          <Text preset="default" text="Loading draft…" style={{ color: theme.colors.textDim }} />
        )}

        {loadState === "processing" && (
          <>
            <View style={[$nextCard, { borderColor: theme.colors.border }]}>
              <Text
                preset="bold"
                text="Transcribing & generating draft…"
                style={{ marginBottom: 6 }}
              />
              <Text
                preset="default"
                text="The server pipeline (Transcribe → post-correction → note generation) is still running. Pull to refresh, or come back in a minute."
                style={{ color: theme.colors.textDim }}
              />
            </View>
            <Text
              preset="formLabel"
              text={`CAPTURED UTTERANCES (${session.segments.length})`}
              style={$sectionLabel}
            />
            {session.segments.map((s, i) => (
              <View key={s.segmentId} style={[$segCard, { borderColor: theme.colors.border }]}>
                <Text preset="bold" text={`Utterance ${i + 1}`} style={{ marginBottom: 4 }} />
                <Text
                  preset="default"
                  text={`${(s.durationMs / 1000).toFixed(1)}s · ${(s.sampleRate / 1000).toFixed(0)}kHz · ended: ${s.endReason}`}
                  style={{ color: theme.colors.textDim }}
                />
              </View>
            ))}
            <Button preset="default" text="Refresh" onPress={load} style={$button} />
          </>
        )}

        {loadState === "ready" && draft && (
          <>
            <Text preset="formLabel" text="FINDINGS" style={$sectionLabel} />
            {spokenFields.map((field) => (
              <View key={field.key} style={[$fieldCard, { borderColor: theme.colors.border }]}>
                <View style={$fieldHeader}>
                  <Text preset="bold" text={field.label} />
                  <Text
                    preset="default"
                    text={field.status === "spoken" ? "Spoken" : "Not stated"}
                    style={{
                      color: field.status === "spoken" ? theme.colors.tint : theme.colors.textDim,
                    }}
                  />
                </View>

                <TextField
                  value={values[field.key] ?? ""}
                  onChangeText={(v) => editValue(field.key, v)}
                  multiline
                  editable={!isFinal}
                  placeholder="Not stated in transcript"
                  containerStyle={$fieldInput}
                />

                {field.provenance.length > 0 && (
                  <View style={[$provenance, { borderColor: theme.colors.border }]}>
                    <Text preset="formHelper" text="FROM TRANSCRIPT" style={{ marginBottom: 4 }} />
                    {field.provenance.map((span, i) => (
                      <Text
                        key={i}
                        preset="default"
                        text={`“${span.text}”`}
                        style={{ color: theme.colors.textDim, fontStyle: "italic" }}
                      />
                    ))}
                  </View>
                )}
              </View>
            ))}

            <Text preset="formLabel" text="TEMPLATE DEFAULTS" style={$sectionLabel} />
            {eventFields.map((original) => {
              const field = defaultFields[original.key] ?? original
              const isRecordingThis = recordingKey === field.key
              const resolved = field.status !== "default_unconfirmed"

              return (
                <View key={field.key} style={[$fieldCard, { borderColor: theme.colors.border }]}>
                  <View style={$fieldHeader}>
                    <Text preset="bold" text={field.label} />
                    <Text
                      preset="default"
                      text={statusLabel(field.status)}
                      style={{
                        color: resolved ? theme.colors.tint : theme.colors.error,
                      }}
                    />
                  </View>

                  <Text
                    preset="default"
                    text={field.value || "(removed — omitted from the note)"}
                    style={{ color: theme.colors.text, marginBottom: 10 }}
                  />

                  {field.provenance.length > 0 && (
                    <View style={[$provenance, { borderColor: theme.colors.border }]}>
                      <Text preset="formHelper" text="FROM DICTATION" style={{ marginBottom: 4 }} />
                      {field.provenance.map((span, i) => (
                        <Text
                          key={i}
                          preset="default"
                          text={`“${span.text}”`}
                          style={{ color: theme.colors.textDim, fontStyle: "italic" }}
                        />
                      ))}
                    </View>
                  )}

                  {!isFinal && !isRecordingThis && (
                    <View style={$actionRow}>
                      <Button
                        preset="default"
                        text="Confirm"
                        onPress={() => confirmDefault(field.key)}
                        style={$actionButton}
                      />
                      <Button
                        preset="default"
                        text="No — record"
                        onPress={() => startRecordFlow(field.key)}
                        style={$actionButton}
                      />
                      <Button
                        preset="default"
                        text="No — remove"
                        onPress={() => removeDefault(field.key)}
                        style={$actionButton}
                      />
                    </View>
                  )}

                  {isRecordingThis && (
                    <View style={[$recordPanel, { borderColor: theme.colors.border }]}>
                      {recordStatus === "capturing" && (
                        <>
                          <Pressable
                            onPressIn={() => audio.arm().catch(() => {})}
                            onPressOut={() => audio.end().catch(() => {})}
                            style={[$holdButton, { borderColor: theme.colors.tint }]}
                            accessibilityRole="button"
                            accessibilityLabel="Hold to record replacement"
                          >
                            <Text preset="bold" text="Hold to record" />
                          </Pressable>
                          <Button
                            preset="default"
                            text="Cancel"
                            onPress={cancelRecordFlow}
                            style={{ marginTop: 8 }}
                          />
                        </>
                      )}
                      {(recordStatus === "uploading" || recordStatus === "transcribing") && (
                        <Text
                          preset="default"
                          text={recordStatus === "uploading" ? "Uploading…" : "Transcribing…"}
                          style={{ color: theme.colors.textDim }}
                        />
                      )}
                      {recordStatus === "failed" && (
                        <>
                          <Text
                            preset="default"
                            text={recordError}
                            style={{ color: theme.colors.error, marginBottom: 8 }}
                          />
                          <Button
                            preset="default"
                            text="Try again"
                            onPress={() => startRecordFlow(field.key)}
                          />
                          <Button
                            preset="default"
                            text="Cancel"
                            onPress={cancelRecordFlow}
                            style={{ marginTop: 8 }}
                          />
                        </>
                      )}
                    </View>
                  )}
                </View>
              )
            })}

            {approveError.length > 0 && (
              <Text
                preset="default"
                text={approveError}
                style={{ color: theme.colors.error, marginBottom: 12 }}
              />
            )}

            {isFinal ? (
              <Button
                preset="reversed"
                text="Export"
                onPress={() => navigation.navigate("ScribeExport", { sessionId })}
                style={$button}
              />
            ) : (
              <>
                {unresolvedCount > 0 && (
                  <Text
                    preset="default"
                    text={`Resolve ${unresolvedCount} template default${unresolvedCount === 1 ? "" : "s"} before signing.`}
                    style={{ color: theme.colors.textDim, marginBottom: 8 }}
                  />
                )}
                <Button
                  preset="reversed"
                  text={isApproving ? "Approving…" : "Approve"}
                  disabled={!canApprove}
                  onPress={approve}
                  style={$button}
                />
              </>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  )
}

const $content: ViewStyle = { padding: 20, paddingBottom: 40 }
const $center: ViewStyle = { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }
const $title: TextStyle = { marginBottom: 12 }
const $banner: ViewStyle = { borderRadius: 10, padding: 12, marginBottom: 16 }
const $sectionLabel: TextStyle = { marginBottom: 10, marginTop: 4, letterSpacing: 1 }
const $segCard: ViewStyle = { borderRadius: 12, borderWidth: 2, padding: 14, marginBottom: 10 }
const $nextCard: ViewStyle = { borderRadius: 14, borderWidth: 2, padding: 18, marginBottom: 20 }
const $button: ViewStyle = { marginTop: 4 }
const $fieldCard: ViewStyle = { borderRadius: 12, borderWidth: 2, padding: 14, marginBottom: 12 }
const $fieldHeader: ViewStyle = {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 8,
}
const $fieldInput: ViewStyle = { marginBottom: 0 }
const $provenance: ViewStyle = { marginTop: 10, paddingTop: 10, borderTopWidth: 1 }
const $actionRow: ViewStyle = { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }
const $actionButton: ViewStyle = { flexGrow: 1, minWidth: 100 }
const $recordPanel: ViewStyle = {
  borderTopWidth: 1,
  marginTop: 10,
  paddingTop: 12,
  alignItems: "center",
}
const $holdButton: ViewStyle = {
  minHeight: 56,
  width: "100%",
  borderRadius: 14,
  borderWidth: 2,
  justifyContent: "center",
  alignItems: "center",
}
