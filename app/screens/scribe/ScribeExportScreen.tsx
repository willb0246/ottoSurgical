/**
 * ScribeExportScreen — export the approved note (PRD §5.4, parent PRD §12.5
 * Rung 1: clipboard / share sheet / PDF file only, no EMR write-back).
 * Gated on status === "final" — nothing exports without the hard approval
 * gate having already passed (PRD §5.3).
 */
import { FC, useCallback, useState } from "react"
import { ScrollView, Share, TextStyle, View, ViewStyle } from "react-native"
import * as Clipboard from "expo-clipboard"
import * as Print from "expo-print"
import { useFocusEffect } from "@react-navigation/native"

import { Button } from "@/components/Button"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import type { ScribeStackScreenProps } from "@/navigators/navigationTypes"
import { getDraft } from "@/services/api/scribeApi"
import { useAppTheme } from "@/theme/context"
import { SAFETY_LABEL, type DraftNote } from "@/types/scribe"
import { useHeader } from "@/utils/useHeader"

interface ScribeExportScreenProps extends ScribeStackScreenProps<"ScribeExport"> {}

type LoadState = "loading" | "not_final" | "ready" | "error"

function buildPlaintextNote(draft: DraftNote): string {
  const lines = [
    `${draft.procedureType} — Operative Note`,
    `Generated: ${draft.generatedAt}`,
    "",
    ...draft.fields.map((f) => `${f.label}: ${f.value || "Not stated"}`),
    "",
    SAFETY_LABEL,
  ]
  return lines.join("\n")
}

function buildNoteHtml(draft: DraftNote): string {
  const rows = draft.fields
    .map(
      (f) =>
        `<tr><td style="padding:6px 12px;font-weight:600;vertical-align:top;">${f.label}</td><td style="padding:6px 12px;">${f.value || "<em>Not stated</em>"}</td></tr>`,
    )
    .join("")
  return `
    <html>
      <body style="font-family:-apple-system,Helvetica,Arial,sans-serif;padding:24px;">
        <h2>${draft.procedureType} — Operative Note</h2>
        <p style="color:#666;">Generated: ${draft.generatedAt}</p>
        <table style="border-collapse:collapse;width:100%;">${rows}</table>
        <p style="margin-top:24px;font-size:12px;color:#999;">${SAFETY_LABEL}</p>
      </body>
    </html>
  `
}

export const ScribeExportScreen: FC<ScribeExportScreenProps> = function ScribeExportScreen({
  navigation,
  route,
}) {
  const { theme } = useAppTheme()
  const { sessionId } = route.params

  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [draft, setDraft] = useState<DraftNote | undefined>()
  const [copied, setCopied] = useState(false)
  const [actionError, setActionError] = useState("")

  useHeader({ title: "Export", leftIcon: "back", onLeftPress: () => navigation.goBack() })

  useFocusEffect(
    useCallback(() => {
      setLoadState("loading")
      getDraft(sessionId)
        .then(({ draft: fetched }) => {
          setDraft(fetched)
          setLoadState(fetched.status === "final" ? "ready" : "not_final")
        })
        .catch(() => setLoadState("error"))
    }, [sessionId]),
  )

  async function copyToClipboard() {
    if (!draft) return
    await Clipboard.setStringAsync(buildPlaintextNote(draft))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function shareText() {
    if (!draft) return
    try {
      await Share.share({ message: buildPlaintextNote(draft) })
    } catch (err) {
      setActionError((err as Error).message)
    }
  }

  async function exportPdf() {
    if (!draft) return
    try {
      const { uri } = await Print.printToFileAsync({ html: buildNoteHtml(draft) })
      await Share.share({ url: uri, title: `${draft.procedureType} Operative Note` })
    } catch (err) {
      setActionError((err as Error).message)
    }
  }

  return (
    <Screen preset="fixed" contentContainerStyle={$content} safeAreaEdges={["bottom"]}>
      <ScrollView contentContainerStyle={$scrollContent}>
        <View style={[$banner, { backgroundColor: theme.colors.palette.neutral200 }]}>
          <Text preset="formHelper" text={SAFETY_LABEL} style={{ color: theme.colors.textDim }} />
        </View>

        {loadState === "loading" && (
          <Text preset="default" text="Loading…" style={{ color: theme.colors.textDim }} />
        )}

        {loadState === "error" && (
          <Text
            preset="default"
            text="Could not load this case."
            style={{ color: theme.colors.error }}
          />
        )}

        {loadState === "not_final" && (
          <>
            <Text
              preset="default"
              text="This note hasn't been approved yet. Nothing exports until the review-and-approval gate has been completed."
              style={[$body, { color: theme.colors.textDim }]}
            />
            <Button
              preset="reversed"
              text="Go to review"
              onPress={() => navigation.navigate("ScribeReview", { sessionId })}
              style={$button}
            />
          </>
        )}

        {loadState === "ready" && draft && (
          <>
            {draft.fields.map((field) => (
              <View key={field.key} style={$fieldRow}>
                <Text preset="bold" text={field.label} />
                <Text
                  preset="default"
                  text={field.value || "Not stated"}
                  style={{ color: field.value ? theme.colors.text : theme.colors.textDim }}
                />
              </View>
            ))}

            {actionError.length > 0 && (
              <Text
                preset="default"
                text={actionError}
                style={[$actionError, { color: theme.colors.error }]}
              />
            )}

            <View style={$actions}>
              <Button
                preset="default"
                text={copied ? "Copied!" : "Copy to clipboard"}
                onPress={copyToClipboard}
                style={$button}
              />
              <Button preset="default" text="Share as text" onPress={shareText} style={$button} />
              <Button preset="default" text="Export as PDF" onPress={exportPdf} style={$button} />
            </View>
          </>
        )}

        <Button
          preset="reversed"
          text="Done"
          onPress={() => navigation.popToTop()}
          style={$doneButton}
        />
      </ScrollView>
    </Screen>
  )
}

const $content: ViewStyle = { flex: 1 }
const $scrollContent: ViewStyle = { padding: 20, paddingBottom: 40 }
const $banner: ViewStyle = { borderRadius: 10, padding: 12, marginBottom: 16 }
const $body: TextStyle = { fontSize: 16, lineHeight: 22, marginBottom: 16 }
const $fieldRow: ViewStyle = { marginBottom: 12 }
const $actionError: TextStyle = { marginTop: 12 }
const $actions: ViewStyle = { marginTop: 16 }
const $button: ViewStyle = { marginBottom: 12 }
const $doneButton: ViewStyle = { marginTop: 8 }
