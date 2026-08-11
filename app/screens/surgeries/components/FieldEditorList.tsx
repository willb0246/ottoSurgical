/**
 * Steps 4 ("Reorder") and 5 ("Draft defaults") of the surgery-creation
 * wizard, and the field list in edit mode — all the same draggable list,
 * just with the default-text editor collapsed (step 4) or expanded (step 5
 * + edit mode). One `react-native-draggable-flatlist` instance rather than
 * a separate reorder-only list and defaults-only list, so it's never
 * nested inside a ScrollView or duplicated against itself. Callers hand in
 * `header`/`footer` (form fields, Save/Delete buttons, etc.) instead of
 * wrapping this in their own ScrollView — they render as the list's
 * header/footer so nothing double-scrolls.
 */
import { ComponentType, ReactElement } from "react"
import { TextStyle, View, ViewStyle } from "react-native"
import DraggableFlatList, { RenderItemParams } from "react-native-draggable-flatlist"

import { PressableIcon } from "@/components/Icon"
import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import { useAppTheme } from "@/theme/context"
import type { TemplateField } from "@/types/scribe"

interface FieldEditorListProps {
  fields: TemplateField[]
  onChange: (fields: TemplateField[]) => void
  /** Show the editable label + default-text box per field (step 5 / edit mode). When false, rows are drag-to-reorder + remove only (step 4). */
  showDefaults?: boolean
  header?: ReactElement | ComponentType<any> | null
  footer?: ReactElement | ComponentType<any> | null
}

export function FieldEditorList({
  fields,
  onChange,
  showDefaults = false,
  header,
  footer,
}: FieldEditorListProps) {
  const { theme } = useAppTheme()

  function updateField(fieldId: string, patch: Partial<TemplateField>) {
    onChange(fields.map((f) => (f.fieldId === fieldId ? { ...f, ...patch } : f)))
  }

  function removeField(fieldId: string) {
    onChange(fields.filter((f) => f.fieldId !== fieldId))
  }

  return (
    <DraggableFlatList
      data={fields}
      keyExtractor={(item) => item.fieldId}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={$listContent}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={
        <Text
          preset="default"
          text="No fields selected yet — go back and pick a few."
          style={{ color: theme.colors.textDim, marginBottom: 12 }}
        />
      }
      onDragEnd={({ data }) => onChange(data.map((f, i) => ({ ...f, order: i })))}
      renderItem={({ item, drag, isActive }: RenderItemParams<TemplateField>) => (
        <View
          style={[
            $card,
            {
              borderColor: theme.colors.border,
              backgroundColor: isActive ? theme.colors.palette.neutral200 : "transparent",
            },
          ]}
        >
          <View style={$cardHeader}>
            <PressableIcon
              icon="menu"
              size={18}
              disabled={isActive}
              onLongPress={drag}
              accessibilityLabel="Drag to reorder"
            />
            {showDefaults ? (
              <TextField
                placeholder="Field name"
                value={item.label}
                onChangeText={(text) => updateField(item.fieldId, { label: text })}
                containerStyle={$labelField}
              />
            ) : (
              <Text preset="default" text={item.label} style={$label} />
            )}
            <PressableIcon
              icon="x"
              size={18}
              onPress={() => removeField(item.fieldId)}
              accessibilityLabel={`Remove ${item.label}`}
            />
          </View>

          {showDefaults && (
            <>
              <TextField
                placeholder="Leave blank to always dictate this field"
                value={item.defaultText}
                onChangeText={(text) => updateField(item.fieldId, { defaultText: text })}
                multiline
                containerStyle={$defaultTextField}
              />
              <Text
                preset="formHelper"
                text="Wrap anything the transcription should fill in with double curly braces, e.g. {{finding}}."
                style={{ color: theme.colors.textDim }}
              />
            </>
          )}
        </View>
      )}
    />
  )
}

const $listContent: ViewStyle = { padding: 20, paddingBottom: 40 }
const $card: ViewStyle = {
  borderRadius: 12,
  borderWidth: 2,
  paddingVertical: 12,
  paddingHorizontal: 12,
  marginBottom: 10,
}
const $cardHeader: ViewStyle = { flexDirection: "row", alignItems: "center", gap: 10 }
const $label: TextStyle = { flex: 1 }
const $labelField: ViewStyle = { flex: 1, marginBottom: 0 }
const $defaultTextField: ViewStyle = { marginTop: 10, marginBottom: 4 }
