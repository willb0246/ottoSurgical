/**
 * ScribeReviewScreen — field-by-field review + transcript-span provenance +
 * the hard approval gate (PRD §4 step 5 / §5.3). Pulls the real DraftNote
 * from the backend once the pipeline reaches draft_ready; while the
 * session is still processing, shows the captured utterances instead.
 */
import { FC, useCallback, useState } from "react"
import { ScrollView, TextStyle, View, ViewStyle } from "react-native"
import { useFocusEffect } from "@react-navigation/native"

import { Button } from "@/components/Button"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import { useAuth } from "@/context/AuthContext"
import type { AppStackScreenProps } from "@/navigators/navigationTypes"
import { approveNote, getDraft } from "@/services/api/scribeApi"
import { useAppTheme } from "@/theme/context"
import { SAFETY_LABEL, type DraftNote, type EditLogEntry, type NoteFieldKey } from "@/types/scribe"
import { getSession, type StoredSession } from "@/utils/scribe/sessionStore"

interface ScribeReviewScreenProps extends AppStackScreenProps<"ScribeReview"> {}

type LoadState = "loading" | "processing" | "ready" | "error"

export const ScribeReviewScreen: FC<ScribeReviewScreenProps> = function ScribeReviewScreen({
  navigation,
  route,
}) {
  const { theme } = useAppTheme()
  const { sessionId } = route.params
  const { surgeonId } = useAuth()

  const [session, setSession] = useState<StoredSession | undefined>()
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [draft, setDraft] = useState<DraftNote | undefined>()
  const [values, setValues] = useState<Record<string, string>>({})
  const [editedKeys, setEditedKeys] = useState<Set<NoteFieldKey>>(new Set())
  const [isApproving, setIsApproving] = useState(false)
  const [approveError, setApproveError] = useState("")

  const load = useCallback(async () => {
    setSession(getSession(sessionId))
    setLoadState("loading")
    try {
      const { draft: fetched } = await getDraft(sessionId)
      setDraft(fetched)
      setValues(Object.fromEntries(fetched.fields.map((f) => [f.key, f.value])))
      setEditedKeys(new Set())
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

  async function approve() {
    if (!draft || !surgeonId) return
    setIsApproving(true)
    setApproveError("")

    const now = new Date().toISOString()
    const edits: EditLogEntry[] = draft.fields
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
        fields: draft.fields.map((f) => ({
          key: f.key,
          value: values[f.key],
          edited: editedKeys.has(f.key),
        })),
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
      <Screen preset="fixed" contentContainerStyle={$center}>
        <Text preset="heading" text="Case not found" />
      </Screen>
    )
  }

  const isFinal = draft?.status === "final"

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
              <Text preset="bold" text="Transcribing & generating draft…" style={{ marginBottom: 6 }} />
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
            {draft.fields.map((field) => (
              <View key={field.key} style={[$fieldCard, { borderColor: theme.colors.border }]}>
                <View style={$fieldHeader}>
                  <Text preset="bold" text={field.label} />
                  <Text
                    preset="default"
                    text={field.status === "populated" ? "Populated" : "Not stated"}
                    style={{
                      color:
                        field.status === "populated" ? theme.colors.tint : theme.colors.textDim,
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

            {approveError.length > 0 && (
              <Text preset="default" text={approveError} style={{ color: theme.colors.error, marginBottom: 12 }} />
            )}

            {isFinal ? (
              <Button
                preset="reversed"
                text="Export"
                onPress={() => navigation.navigate("ScribeExport", { sessionId })}
                style={$button}
              />
            ) : (
              <Button
                preset="reversed"
                text={isApproving ? "Approving…" : "Approve"}
                disabled={isApproving}
                onPress={approve}
                style={$button}
              />
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
const $sectionLabel: TextStyle = { marginBottom: 10, letterSpacing: 1 }
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
