/**
 * ScribeReviewScreen — post-case review (PRD §4 step 5 / §5.3).
 *
 * NOTE: field-by-field draft + transcript-span pairing + the hard approval
 * gate depend on the server pipeline (ASR + note generation), which is
 * deferred for the audio-first build. For now this shows the captured
 * utterances so audio quality can be verified end-of-case.
 */
import { FC, useCallback, useState } from "react"
import { ScrollView, TextStyle, View, ViewStyle } from "react-native"
import { useFocusEffect } from "@react-navigation/native"

import { Button } from "@/components/Button"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import type { AppStackScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import { getSession, type StoredSession } from "@/utils/scribe/sessionStore"
import { SAFETY_LABEL } from "@/types/scribe"

interface ScribeReviewScreenProps extends AppStackScreenProps<"ScribeReview"> {}

export const ScribeReviewScreen: FC<ScribeReviewScreenProps> = function ScribeReviewScreen({
  navigation,
  route,
}) {
  const { theme } = useAppTheme()
  const { sessionId } = route.params
  const [session, setSession] = useState<StoredSession | undefined>()

  useFocusEffect(
    useCallback(() => {
      setSession(getSession(sessionId))
    }, [sessionId]),
  )

  if (!session) {
    return (
      <Screen preset="fixed" contentContainerStyle={$center}>
        <Text preset="heading" text="Case not found" />
      </Screen>
    )
  }

  return (
    <Screen preset="fixed" safeAreaEdges={["bottom"]}>
      <ScrollView contentContainerStyle={$content}>
        <Text preset="heading" text={`${session.procedureType} case`} style={$title} />

        <View style={[$banner, { backgroundColor: theme.colors.palette.neutral200 }]}>
          <Text preset="formHelper" text={SAFETY_LABEL} style={{ color: theme.colors.textDim }} />
        </View>

        {session.route && (
          <Text
            preset="default"
            text={`Captured at ${(session.route.sampleRate / 1000).toFixed(1)} kHz${
              session.route.highQuality ? " (HQ link)" : ""
            }`}
            style={[$meta, { color: theme.colors.textDim }]}
          />
        )}

        <Text
          preset="formLabel"
          text={`CAPTURED UTTERANCES (${session.segments.length})`}
          style={$sectionLabel}
        />
        {session.segments.length === 0 ? (
          <Text
            preset="default"
            text="No dictation was captured for this case."
            style={{ color: theme.colors.textDim }}
          />
        ) : (
          session.segments.map((s, i) => (
            <View key={s.segmentId} style={[$segCard, { borderColor: theme.colors.border }]}>
              <Text preset="bold" text={`Utterance ${i + 1}`} style={{ marginBottom: 4 }} />
              <Text
                preset="default"
                text={`${(s.durationMs / 1000).toFixed(1)}s · ${(s.sampleRate / 1000).toFixed(0)}kHz · ended: ${s.endReason}`}
                style={{ color: theme.colors.textDim }}
              />
            </View>
          ))
        )}

        <View style={[$nextCard, { borderColor: theme.colors.border }]}>
          <Text preset="bold" text="Next: transcription & draft note" style={{ marginBottom: 6 }} />
          <Text
            preset="default"
            text="Server-side ASR + evidence-gated note generation lands here — field-by-field draft with transcript provenance and a hard approval gate."
            style={{ color: theme.colors.textDim }}
          />
        </View>

        <Button
          preset="reversed"
          text="Export"
          onPress={() => navigation.navigate("ScribeExport", { sessionId })}
          style={$button}
        />
      </ScrollView>
    </Screen>
  )
}

const $content: ViewStyle = { padding: 20, paddingBottom: 40 }
const $center: ViewStyle = { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }
const $title: TextStyle = { marginBottom: 12 }
const $banner: ViewStyle = { borderRadius: 10, padding: 12, marginBottom: 16 }
const $meta: TextStyle = { marginBottom: 16 }
const $sectionLabel: TextStyle = { marginBottom: 10, letterSpacing: 1 }
const $segCard: ViewStyle = { borderRadius: 12, borderWidth: 2, padding: 14, marginBottom: 10 }
const $nextCard: ViewStyle = { borderRadius: 14, borderWidth: 2, padding: 18, marginTop: 8, marginBottom: 20 }
const $button: ViewStyle = { marginTop: 4 }
