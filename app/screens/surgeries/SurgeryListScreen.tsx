/**
 * SurgeryListScreen — a surgeon's own list of common surgeries. Entry
 * point of the Surgeries tab; tapping a surgery opens its template editor.
 */
import { FC, useCallback, useState } from "react"
import { Pressable, ScrollView, TextStyle, View, ViewStyle } from "react-native"
import { useFocusEffect } from "@react-navigation/native"

import { Button } from "@/components/Button"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import type { SurgeriesStackScreenProps } from "@/navigators/navigationTypes"
import { listProcedures } from "@/services/api/templatesApi"
import { useAppTheme } from "@/theme/context"
import type { ProcedureOption } from "@/types/scribe"
import { useHeader } from "@/utils/useHeader"

interface SurgeryListScreenProps extends SurgeriesStackScreenProps<"SurgeryList"> {}

type LoadState = "loading" | "error" | "ready"

export const SurgeryListScreen: FC<SurgeryListScreenProps> = function SurgeryListScreen({
  navigation,
}) {
  const { theme } = useAppTheme()
  const [procedures, setProcedures] = useState<ProcedureOption[]>([])
  const [loadState, setLoadState] = useState<LoadState>("loading")

  useHeader({ title: "My surgeries" })

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

  return (
    <Screen preset="fixed" safeAreaEdges={["bottom"]}>
      <ScrollView contentContainerStyle={$content}>
        <Text
          preset="default"
          text="Manage the surgeries you perform and the note sections each one should populate."
          style={[$subtitle, { color: theme.colors.textDim }]}
        />

        <Pressable onPress={() => navigation.navigate("Specialties")} style={$specialtiesLink}>
          <Text preset="default" text="My specialties →" style={{ color: theme.colors.tint }} />
        </Pressable>

        <Button
          preset="reversed"
          text="+ Add surgery"
          onPress={() => navigation.navigate("SurgeryTemplateEditor", { procedureId: undefined })}
          style={$addButton}
        />

        {loadState === "loading" && (
          <Text preset="default" text="Loading…" style={{ color: theme.colors.textDim }} />
        )}

        {loadState === "error" && (
          <View style={[$emptyCard, { borderColor: theme.colors.border }]}>
            <Text preset="bold" text="Couldn't load your surgeries" style={{ marginBottom: 6 }} />
            <Text
              preset="default"
              text="Check your connection and try again."
              style={{ color: theme.colors.textDim }}
            />
          </View>
        )}

        {loadState === "ready" && procedures.length === 0 && (
          <View style={[$emptyCard, { borderColor: theme.colors.border }]}>
            <Text preset="bold" text="No surgeries yet" style={{ marginBottom: 6 }} />
            <Text
              preset="default"
              text="Add your first surgery above."
              style={{ color: theme.colors.textDim }}
            />
          </View>
        )}

        {loadState === "ready" &&
          procedures.map((p) => (
            <Pressable
              key={p.type}
              style={[$card, { borderColor: theme.colors.border }]}
              onPress={() =>
                navigation.navigate("SurgeryTemplateEditor", {
                  procedureId: p.type,
                  procedureOption: { label: p.label, description: p.description },
                })
              }
              accessibilityRole="button"
              accessibilityLabel={`Edit ${p.label}`}
            >
              <Text preset="bold" text={p.label} style={$cardTitle} />
              <Text preset="default" text={p.description} style={{ color: theme.colors.textDim }} />
            </Pressable>
          ))}
      </ScrollView>
    </Screen>
  )
}

const $content: ViewStyle = { padding: 20, paddingBottom: 40 }
const $subtitle: TextStyle = { marginBottom: 20, fontSize: 16, lineHeight: 22 }
const $specialtiesLink: ViewStyle = { marginBottom: 20 }
const $addButton: ViewStyle = { marginBottom: 24 }
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
