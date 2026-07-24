/**
 * ScribeQueueScreen — entry point for the intraoperative scribe.
 * Lists local capture sessions (the review queue, PRD §4 step 5) and starts
 * a new case. For the audio-capture prototype, sessions live on-device.
 */
import { FC, useCallback, useState } from "react"
import { Pressable, ScrollView, TextStyle, View, ViewStyle } from "react-native"
import { useFocusEffect } from "@react-navigation/native"

import { Button } from "@/components/Button"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import type { AppStackScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import { listSessions, type StoredSession } from "@/utils/scribe/sessionStore"

interface ScribeQueueScreenProps extends AppStackScreenProps<"ScribeQueue"> {}

function segmentSummary(s: StoredSession): string {
  const n = s.segments.length
  const secs = Math.round(s.segments.reduce((acc, seg) => acc + seg.durationMs, 0) / 1000)
  if (n === 0) return "No dictation captured"
  return `${n} utterance${n === 1 ? "" : "s"} · ${secs}s`
}

export const ScribeQueueScreen: FC<ScribeQueueScreenProps> = function ScribeQueueScreen({
  navigation,
}) {
  const { theme } = useAppTheme()
  const [sessions, setSessions] = useState<StoredSession[]>([])

  // Refresh the list whenever we return to this screen.
  useFocusEffect(
    useCallback(() => {
      setSessions(listSessions())
    }, []),
  )

  return (
    <Screen preset="fixed" safeAreaEdges={["bottom"]}>
      <ScrollView contentContainerStyle={$content}>
        <Text preset="heading" text="Operative notes" style={$title} />
        <Text
          preset="default"
          text="Start a case to dictate hands-free with your AirPods. Recordings stay on this device."
          style={[$subtitle, { color: theme.colors.textDim }]}
        />

        <Button
          preset="reversed"
          text="Start new case"
          onPress={() => navigation.navigate("ScribeProcedureSelect")}
          style={$startButton}
        />

        {sessions.length === 0 ? (
          <View style={[$emptyCard, { borderColor: theme.colors.border }]}>
            <Text preset="bold" text="No cases yet" style={{ marginBottom: 6 }} />
            <Text
              preset="default"
              text="Your recorded cases will appear here for review."
              style={{ color: theme.colors.textDim }}
            />
          </View>
        ) : (
          sessions.map((s) => (
            <Pressable
              key={s.sessionId}
              style={[$row, { borderColor: theme.colors.border }]}
              onPress={() => navigation.navigate("ScribeReview", { sessionId: s.sessionId })}
              accessibilityRole="button"
              accessibilityLabel={`${s.procedureType} case. ${segmentSummary(s)}.`}
            >
              <View style={$rowMain}>
                <Text preset="bold" text={s.procedureType} style={$rowTitle} />
                <Text
                  preset="default"
                  text={segmentSummary(s)}
                  style={{ color: theme.colors.textDim }}
                />
              </View>
              {s.route ? (
                <View
                  style={[
                    $chip,
                    s.route.highQuality
                      ? { backgroundColor: theme.colors.palette.primary100 }
                      : { backgroundColor: theme.colors.palette.neutral200 },
                  ]}
                >
                  <Text
                    preset="formHelper"
                    text={`${Math.round(s.route.sampleRate / 1000)}kHz`}
                    style={$chipText}
                  />
                </View>
              ) : null}
            </Pressable>
          ))
        )}
      </ScrollView>
    </Screen>
  )
}

const $content: ViewStyle = { padding: 20, paddingBottom: 40 }
const $title: TextStyle = { marginBottom: 8 }
const $subtitle: TextStyle = { marginBottom: 20, fontSize: 16, lineHeight: 22 }
const $startButton: ViewStyle = { marginBottom: 24 }
const $row: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  paddingVertical: 18,
  paddingHorizontal: 18,
  borderRadius: 14,
  borderWidth: 2,
  marginBottom: 12,
  minHeight: 68,
}
const $rowMain: ViewStyle = { flex: 1, marginRight: 12 }
const $rowTitle: TextStyle = { fontSize: 18, marginBottom: 4 }
const $chip: ViewStyle = { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999 }
const $chipText: TextStyle = { fontSize: 13 }
const $emptyCard: ViewStyle = { borderRadius: 14, borderWidth: 2, padding: 24, marginTop: 4 }
