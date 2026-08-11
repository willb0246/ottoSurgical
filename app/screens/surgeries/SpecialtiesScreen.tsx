/**
 * SpecialtiesScreen — a surgeon's own specialties, set once and applied to
 * every surgery they create (no longer asked per-surgery). Multi-select:
 * a surgeon can practice more than one specialty. Today the app only uses
 * the first selected specialty for transcription vocabulary — combining
 * multiple vocabularies per case is future work.
 */
import { FC } from "react"
import { ScrollView, TextStyle, ViewStyle } from "react-native"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { Checkbox } from "@/components/Toggle/Checkbox"
import { useAuth } from "@/context/AuthContext"
import type { SurgeriesStackScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import type { Specialty } from "@/types/scribe"
import { useHeader } from "@/utils/useHeader"

const SPECIALTY_OPTIONS: Array<{ value: Specialty; label: string }> = [
  { value: "ortho", label: "Orthopedic" },
  { value: "endovascular", label: "Endovascular" },
]

interface SpecialtiesScreenProps extends SurgeriesStackScreenProps<"Specialties"> {}

export const SpecialtiesScreen: FC<SpecialtiesScreenProps> = function SpecialtiesScreen({
  navigation,
}) {
  const { theme } = useAppTheme()
  const { specialties, setSpecialties } = useAuth()

  useHeader({ title: "My specialties", leftIcon: "back", onLeftPress: () => navigation.goBack() })

  function toggle(value: Specialty) {
    setSpecialties(
      specialties.includes(value)
        ? specialties.filter((s) => s !== value)
        : [...specialties, value],
    )
  }

  return (
    <Screen preset="fixed" safeAreaEdges={["bottom"]}>
      <ScrollView contentContainerStyle={$content}>
        <Text
          preset="default"
          text="Select every specialty you practice. This is set once here and applied to every surgery you create — it selects which set of surgical terms the transcriber listens for."
          style={[$subtitle, { color: theme.colors.textDim }]}
        />

        {SPECIALTY_OPTIONS.map((opt) => (
          <Checkbox
            key={opt.value}
            label={opt.label}
            value={specialties.includes(opt.value)}
            onValueChange={() => toggle(opt.value)}
            containerStyle={$option}
          />
        ))}

        {specialties.length > 1 && (
          <Text
            preset="formHelper"
            text="Multiple specialties selected — for now, case transcription uses your first selected specialty. Support for combining vocabularies is coming soon."
            style={{ color: theme.colors.textDim, marginTop: 8 }}
          />
        )}
      </ScrollView>
    </Screen>
  )
}

const $content: ViewStyle = { padding: 20, paddingBottom: 40 }
const $subtitle: TextStyle = { marginBottom: 20, fontSize: 16, lineHeight: 22 }
const $option: ViewStyle = { marginBottom: 14 }
