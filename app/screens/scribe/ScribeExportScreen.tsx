/**
 * ScribeExportScreen — export the (future) approved note (PRD §5.4).
 *
 * The hard approval gate and note export land with the server pipeline. For
 * the audio-first build this screen carries the mandatory safety labeling and
 * the export stub so the flow is complete end-to-end.
 */
import { FC } from "react"
import { TextStyle, View, ViewStyle } from "react-native"

import { Button } from "@/components/Button"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import type { HomeStackScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import { SAFETY_LABEL } from "@/types/scribe"

interface ScribeExportScreenProps extends HomeStackScreenProps<"ScribeExport"> {}

export const ScribeExportScreen: FC<ScribeExportScreenProps> = function ScribeExportScreen({
  navigation,
}) {
  const { theme } = useAppTheme()

  return (
    <Screen preset="fixed" contentContainerStyle={$content} safeAreaEdges={["bottom"]}>
      <Text preset="heading" text="Export" style={$title} />

      <View style={[$banner, { backgroundColor: theme.colors.palette.neutral200 }]}>
        <Text preset="formHelper" text={SAFETY_LABEL} style={{ color: theme.colors.textDim }} />
      </View>

      <Text
        preset="default"
        text="Copy / share / save of the approved note lands here once the review-and-approval gate is wired to the generated draft. Nothing exports without human sign-off (PRD §5.3)."
        style={[$body, { color: theme.colors.textDim }]}
      />

      <View style={$spacer} />

      <Button preset="reversed" text="Done" onPress={() => navigation.popToTop()} />
    </Screen>
  )
}

const $content: ViewStyle = { padding: 20, justifyContent: "flex-start" }
const $title: TextStyle = { marginBottom: 16 }
const $banner: ViewStyle = { borderRadius: 10, padding: 12, marginBottom: 16 }
const $body: TextStyle = { fontSize: 16, lineHeight: 22 }
const $spacer: ViewStyle = { flex: 1 }
