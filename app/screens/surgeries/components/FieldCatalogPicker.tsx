/**
 * Step 3 ("Select fields") of the surgery-creation wizard, also reused as
 * the "+ add field" affordance in edit mode. A checklist of common note
 * fields (docs/templates.md examples) plus a free-text row for anything
 * not in the catalog — selecting/adding just decides membership; ordering
 * (step 4) and default text (step 5) come later.
 */
import { FC, useState } from "react"
import { View, ViewStyle } from "react-native"

import { Button } from "@/components/Button"
import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import { Checkbox } from "@/components/Toggle/Checkbox"
import { useAppTheme } from "@/theme/context"
import type { TemplateField } from "@/types/scribe"
import { makeId } from "@/utils/idGen"
import { COMMON_FIELDS } from "@/utils/scribe/fieldCatalog"

interface FieldCatalogPickerProps {
  fields: TemplateField[]
  onChange: (fields: TemplateField[]) => void
}

export const FieldCatalogPicker: FC<FieldCatalogPickerProps> = function FieldCatalogPicker({
  fields,
  onChange,
}) {
  const { theme } = useAppTheme()
  const [customLabel, setCustomLabel] = useState("")

  function toggleCatalogField(label: string) {
    const existing = fields.find((f) => f.label === label)
    if (existing) {
      onChange(fields.filter((f) => f.fieldId !== existing.fieldId))
    } else {
      onChange([
        ...fields,
        { fieldId: makeId("field"), label, defaultText: "", order: fields.length },
      ])
    }
  }

  function addCustomField() {
    const label = customLabel.trim()
    if (!label) return
    onChange([
      ...fields,
      { fieldId: makeId("field"), label, defaultText: "", order: fields.length },
    ])
    setCustomLabel("")
  }

  return (
    <View>
      {COMMON_FIELDS.map((f) => (
        <Checkbox
          key={f.label}
          label={f.label}
          helper={f.hint}
          value={fields.some((x) => x.label === f.label)}
          onValueChange={() => toggleCatalogField(f.label)}
          containerStyle={$option}
        />
      ))}

      <Text preset="formLabel" text="Not on the list?" style={$customHeading} />
      <View style={$customRow}>
        <TextField
          placeholder="Custom field name"
          value={customLabel}
          onChangeText={setCustomLabel}
          onSubmitEditing={addCustomField}
          containerStyle={$customField}
        />
        <Button preset="default" text="Add" onPress={addCustomField} style={$addButton} />
      </View>

      {fields.filter((f) => !COMMON_FIELDS.some((c) => c.label === f.label)).length > 0 && (
        <>
          <Text
            preset="formHelper"
            text="Custom fields added"
            style={{ color: theme.colors.textDim, marginTop: 12, marginBottom: 6 }}
          />
          {fields
            .filter((f) => !COMMON_FIELDS.some((c) => c.label === f.label))
            .map((f) => (
              <View key={f.fieldId} style={$customChipRow}>
                <Text preset="default" text={f.label} />
                <Text
                  preset="default"
                  text="Remove"
                  style={{ color: theme.colors.error }}
                  onPress={() => onChange(fields.filter((x) => x.fieldId !== f.fieldId))}
                />
              </View>
            ))}
        </>
      )}
    </View>
  )
}

const $option: ViewStyle = { marginBottom: 12 }
const $customHeading: ViewStyle = { marginTop: 12, marginBottom: 8 }
const $customRow: ViewStyle = { flexDirection: "row", alignItems: "flex-start", gap: 8 }
const $customField: ViewStyle = { flex: 1 }
const $addButton: ViewStyle = { marginTop: 4 }
const $customChipRow: ViewStyle = {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingVertical: 8,
}
