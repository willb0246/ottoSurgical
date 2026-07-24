/**
 * ScribeProcedureSelectScreen — pick the procedure at case start (PRD §4
 * step 1, done pre-scrub). Creates the local session and enters capture.
 */
import { FC } from "react"
import { Pressable, TextStyle, View, ViewStyle } from "react-native"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import type { AppStackScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import { makeId, PROCEDURES } from "@/utils/scribe/procedures"
import { createSession } from "@/utils/scribe/sessionStore"
import type { ProcedureType } from "@/types/scribe"

interface ScribeProcedureSelectScreenProps extends AppStackScreenProps<"ScribeProcedureSelect"> {}

export const ScribeProcedureSelectScreen: FC<ScribeProcedureSelectScreenProps> =
  function ScribeProcedureSelectScreen({ navigation }) {
    const { theme } = useAppTheme()

    function startCase(procedureType: ProcedureType) {
      const sessionId = makeId("case")
      createSession({
        sessionId,
        procedureType,
        startedAt: new Date().toISOString(),
        segments: [],
      })
      navigation.replace("ScribeCapture", { sessionId, procedureType })
    }

    return (
      <Screen preset="fixed" contentContainerStyle={$content} safeAreaEdges={["bottom"]}>
        <Text preset="heading" text="Select procedure" style={$title} />
        <Text
          preset="default"
          text="Choose the case type before you scrub in. This sets the operative-note template."
          style={[$subtitle, { color: theme.colors.textDim }]}
        />

        {PROCEDURES.map((p) => (
          <Pressable
            key={p.type}
            style={[$card, { borderColor: theme.colors.border }]}
            onPress={() => startCase(p.type)}
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
const $title: TextStyle = { marginBottom: 8 }
const $subtitle: TextStyle = { marginBottom: 24, fontSize: 16, lineHeight: 22 }
const $card: ViewStyle = {
  borderRadius: 14,
  borderWidth: 2,
  padding: 20,
  marginBottom: 14,
  minHeight: 84,
  justifyContent: "center",
}
const $cardTitle: TextStyle = { fontSize: 18, marginBottom: 4 }
const $spacer: ViewStyle = { flex: 1 }
