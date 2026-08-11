/**
 * ScribeProcedureSelectScreen — pick the procedure at case start (PRD §4
 * step 1, done pre-scrub). Creates the local session and enters capture.
 * Procedures are the surgeon's own list (managed in the Surgeries tab),
 * fetched from the API rather than a hardcoded constant.
 */
import { FC, useCallback, useState } from "react"
import { Pressable, TextStyle, View, ViewStyle } from "react-native"
import { useFocusEffect } from "@react-navigation/native"

import { Button } from "@/components/Button"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import type { ScribeStackScreenProps } from "@/navigators/navigationTypes"
import { listProcedures } from "@/services/api/templatesApi"
import { useAppTheme } from "@/theme/context"
import type { ProcedureOption } from "@/types/scribe"
import { makeId } from "@/utils/idGen"
import { createSession } from "@/utils/scribe/sessionStore"
import { useHeader } from "@/utils/useHeader"

interface ScribeProcedureSelectScreenProps extends ScribeStackScreenProps<"ScribeProcedureSelect"> {}

type LoadState = "loading" | "error" | "ready"

export const ScribeProcedureSelectScreen: FC<ScribeProcedureSelectScreenProps> =
  function ScribeProcedureSelectScreen({ navigation }) {
    const { theme } = useAppTheme()
    const [procedures, setProcedures] = useState<ProcedureOption[]>([])
    const [loadState, setLoadState] = useState<LoadState>("loading")
    const [title, setTitle] = useState("")

    useHeader({
      title: "Select procedure",
      leftIcon: "back",
      onLeftPress: () => navigation.goBack(),
    })

    useFocusEffect(
      useCallback(() => {
        let cancelled = false
        setLoadState("loading")
        listProcedures()
          .then((res) => {
            if (cancelled) return
            setProcedures(res.procedures)
            setLoadState("ready")
          })
          .catch(() => {
            if (!cancelled) setLoadState("error")
          })
        return () => {
          cancelled = true
        }
      }, []),
    )

    function startCase(procedure: ProcedureOption) {
      const sessionId = makeId("case")
      createSession({
        sessionId,
        procedureType: procedure.type,
        procedureLabel: procedure.label,
        title: title.trim() || undefined,
        startedAt: new Date().toISOString(),
        segments: [],
      })
      navigation.replace("ScribeCapture", { sessionId, procedureType: procedure.type })
    }

    return (
      <Screen preset="fixed" contentContainerStyle={$content} safeAreaEdges={["bottom"]}>
        <Text
          preset="default"
          text="Choose the case type before you scrub in. This sets the operative-note template."
          style={[$subtitle, { color: theme.colors.textDim }]}
        />

        <TextField
          label="Case title (optional)"
          placeholder="e.g. patient initials or room number"
          value={title}
          onChangeText={setTitle}
          containerStyle={$titleField}
        />

        {loadState === "loading" && (
          <Text
            preset="default"
            text="Loading your surgeries…"
            style={{ color: theme.colors.textDim }}
          />
        )}

        {loadState === "error" && (
          <View style={[$emptyCard, { borderColor: theme.colors.border }]}>
            <Text preset="bold" text="Couldn't load your surgeries" style={{ marginBottom: 6 }} />
            <Text
              preset="default"
              text="Check your connection and try again."
              style={{ color: theme.colors.textDim, marginBottom: 16 }}
            />
            <Button
              preset="default"
              text="Retry"
              onPress={() => navigation.replace("ScribeProcedureSelect")}
            />
          </View>
        )}

        {loadState === "ready" && procedures.length === 0 && (
          <View style={[$emptyCard, { borderColor: theme.colors.border }]}>
            <Text preset="bold" text="No surgeries yet" style={{ marginBottom: 6 }} />
            <Text
              preset="default"
              text="Add one from the Surgeries tab before starting a case."
              style={{ color: theme.colors.textDim }}
            />
          </View>
        )}

        {loadState === "ready" &&
          procedures.map((p) => (
            <Pressable
              key={p.type}
              style={[$card, { borderColor: theme.colors.border }]}
              onPress={() => startCase(p)}
              accessibilityRole="button"
              accessibilityLabel={`Start ${p.label}`}
            >
              <Text preset="bold" text={p.label} style={$cardTitle} />
              <Text preset="default" text={p.description} style={{ color: theme.colors.textDim }} />
            </Pressable>
          ))}

        <View style={$spacer} />
      </Screen>
    )
  }

const $content: ViewStyle = { padding: 20, justifyContent: "flex-start" }
const $subtitle: TextStyle = { marginBottom: 24, fontSize: 16, lineHeight: 22 }
const $titleField: ViewStyle = { marginBottom: 20 }
const $card: ViewStyle = {
  borderRadius: 14,
  borderWidth: 2,
  padding: 20,
  marginBottom: 14,
  minHeight: 84,
  justifyContent: "center",
}
const $cardTitle: TextStyle = { fontSize: 18, marginBottom: 4 }
const $emptyCard: ViewStyle = { borderRadius: 14, borderWidth: 2, padding: 24, marginTop: 4 }
const $spacer: ViewStyle = { flex: 1 }
