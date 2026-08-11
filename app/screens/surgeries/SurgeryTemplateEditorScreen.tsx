/**
 * SurgeryTemplateEditorScreen — create/edit one surgery's label/description
 * plus its template (docs/templates.md §4): a single ordered list of
 * **fields**, each with optional default text that may contain
 * {{placeholder}} tokens marking where dictation should fill in data.
 * Undefined route.params.procedureId means create mode. Specialty is no
 * longer set here — it's a one-time per-user setting (Setup > My
 * specialties); create mode silently uses the surgeon's first selected
 * specialty (falling back to "ortho", same fallback the backend already
 * applies to legacy rows).
 *
 * Create mode is a 5-step wizard:
 *   1. start    — start from scratch, or fork one of the surgeon's own
 *                 existing surgeries (pre-populates steps 3-5, still
 *                 editable).
 *   2. details  — surgery name + optional description.
 *   3. fields   — multi-select common fields from a shared catalog, or add
 *                 a custom one.
 *   4. reorder  — drag-and-drop the selected fields into order.
 *   5. defaults — optionally pre-write default text (with {{placeholder}}
 *                 support) for any field, then save.
 * Edit mode (an existing procedureId) skips the wizard — it's a single
 * screen combining all of the above, since there's no first-run ordering
 * to walk through.
 */
import { FC, useCallback, useState } from "react"
import { Alert, Pressable, ScrollView, TextStyle, View, ViewStyle } from "react-native"
import { useFocusEffect } from "@react-navigation/native"

import { Button } from "@/components/Button"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import { useAuth } from "@/context/AuthContext"
import type { SurgeriesStackScreenProps } from "@/navigators/navigationTypes"
import {
  createProcedure,
  deleteProcedure,
  getTemplate,
  listProcedures,
  putTemplate,
  updateProcedure,
} from "@/services/api/templatesApi"
import { useAppTheme } from "@/theme/context"
import type { ProcedureOption, Specialty, TemplateField } from "@/types/scribe"
import { makeId } from "@/utils/idGen"
import { useHeader } from "@/utils/useHeader"

import { FieldCatalogPicker } from "./components/FieldCatalogPicker"
import { FieldEditorList } from "./components/FieldEditorList"

type WizardStep = "start" | "details" | "fields" | "reorder" | "defaults"
const WIZARD_STEPS: WizardStep[] = ["start", "details", "fields", "reorder", "defaults"]
const STEP_TITLES: Record<WizardStep, string> = {
  start: "Start",
  details: "Details",
  fields: "Select fields",
  reorder: "Reorder",
  defaults: "Draft defaults",
}

interface SurgeryTemplateEditorScreenProps extends SurgeriesStackScreenProps<"SurgeryTemplateEditor"> {}

export const SurgeryTemplateEditorScreen: FC<SurgeryTemplateEditorScreenProps> =
  function SurgeryTemplateEditorScreen({ navigation, route }) {
    const { theme } = useAppTheme()
    const { specialties } = useAuth()
    const { procedureId, procedureOption } = route.params ?? {}
    const isCreate = !procedureId

    const [label, setLabel] = useState(procedureOption?.label ?? "")
    const [description, setDescription] = useState(procedureOption?.description ?? "")
    const [fields, setFields] = useState<TemplateField[]>([])
    const [loadingTemplate, setLoadingTemplate] = useState(!isCreate)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const [step, setStep] = useState<WizardStep>("start")
    const [existingProcedures, setExistingProcedures] = useState<ProcedureOption[]>([])
    const [loadingExisting, setLoadingExisting] = useState(isCreate)

    useFocusEffect(
      useCallback(() => {
        if (!procedureId) return
        let cancelled = false
        setLoadingTemplate(true)
        getTemplate(procedureId)
          .then((res) => {
            if (cancelled) return
            setFields(res.template.fields)
          })
          .catch(() => {
            if (!cancelled) setError("Couldn't load this surgery's template.")
          })
          .finally(() => {
            if (!cancelled) setLoadingTemplate(false)
          })
        return () => {
          cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [procedureId]),
    )

    useFocusEffect(
      useCallback(() => {
        if (!isCreate) return
        let cancelled = false
        setLoadingExisting(true)
        listProcedures()
          .then((res) => {
            if (!cancelled) setExistingProcedures(res.procedures)
          })
          .catch(() => {
            if (!cancelled) setError("Couldn't load your existing surgeries.")
          })
          .finally(() => {
            if (!cancelled) setLoadingExisting(false)
          })
        return () => {
          cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []),
    )

    function goToStep(next: WizardStep) {
      setError(null)
      setStep(next)
    }

    function handleBack() {
      if (!isCreate) {
        navigation.goBack()
        return
      }
      const idx = WIZARD_STEPS.indexOf(step)
      if (idx <= 0) {
        navigation.goBack()
      } else {
        goToStep(WIZARD_STEPS[idx - 1])
      }
    }

    useHeader(
      {
        title: isCreate ? `New surgery — ${STEP_TITLES[step]}` : "Edit surgery",
        leftIcon: "back",
        onLeftPress: handleBack,
      },
      [step, isCreate],
    )

    function startFromScratch() {
      setFields([])
      goToStep("details")
    }

    async function forkFrom(source: ProcedureOption) {
      setLoadingExisting(true)
      setError(null)
      try {
        const res = await getTemplate(source.type)
        setFields(
          [...res.template.fields]
            .sort((a, b) => a.order - b.order)
            .map((f, i) => ({ ...f, fieldId: makeId("field"), order: i })),
        )
        goToStep("details")
      } catch {
        setError("Couldn't load that surgery's template.")
      } finally {
        setLoadingExisting(false)
      }
    }

    async function handleSave() {
      if (!label.trim()) {
        setError("Give this surgery a name.")
        return
      }
      if (fields.some((f) => !f.label.trim())) {
        setError("Every field needs a name.")
        return
      }

      setSaving(true)
      setError(null)
      try {
        const targetId = procedureId ?? makeId("proc")
        if (isCreate) {
          const specialty: Specialty = specialties[0] ?? "ortho"
          await createProcedure({
            procedureId: targetId,
            label: label.trim(),
            description,
            specialty,
          })
        } else {
          await updateProcedure(targetId, { label: label.trim(), description })
        }
        await putTemplate(targetId, {
          fields: fields.map((f) => ({
            fieldId: f.fieldId,
            label: f.label,
            defaultText: f.defaultText,
          })),
        })
        navigation.goBack()
      } catch {
        setError("Couldn't save — check your connection and try again.")
      } finally {
        setSaving(false)
      }
    }

    function handleDelete() {
      if (!procedureId) return
      Alert.alert("Delete surgery?", `"${label}" and its template will be removed.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setSaving(true)
            try {
              await deleteProcedure(procedureId)
              navigation.goBack()
            } catch {
              setSaving(false)
              setError("Couldn't delete — check your connection and try again.")
            }
          },
        },
      ])
    }

    /* ------------------------------------------------------------ */
    /* Create mode — 5-step wizard                                  */
    /* ------------------------------------------------------------ */

    if (isCreate && step === "start") {
      return (
        <Screen preset="fixed" safeAreaEdges={["bottom"]}>
          <ScrollView contentContainerStyle={$content}>
            <Text
              preset="default"
              text="Start from scratch, or fork one of your existing surgeries as a starting point — you'll still be able to adjust its fields, order, and defaults."
              style={[$subtitle, { color: theme.colors.textDim }]}
            />

            <Button
              preset="reversed"
              text="Start from scratch"
              onPress={startFromScratch}
              style={$primaryAction}
            />

            {loadingExisting && (
              <Text preset="default" text="Loading…" style={{ color: theme.colors.textDim }} />
            )}

            {!loadingExisting && existingProcedures.length > 0 && (
              <>
                <Text
                  preset="formLabel"
                  text="Or fork an existing surgery"
                  style={$sectionsHeading}
                />
                {existingProcedures.map((p) => (
                  <Pressable
                    key={p.type}
                    style={[$sectionCard, { borderColor: theme.colors.border }]}
                    onPress={() => forkFrom(p)}
                    accessibilityRole="button"
                    accessibilityLabel={`Fork ${p.label}`}
                  >
                    <Text preset="bold" text={p.label} style={$previewCardTitle} />
                    {!!p.description && (
                      <Text
                        preset="default"
                        text={p.description}
                        style={{ color: theme.colors.textDim }}
                      />
                    )}
                  </Pressable>
                ))}
              </>
            )}

            {error && (
              <Text
                preset="default"
                text={error}
                style={{ color: theme.colors.error, marginTop: 12 }}
              />
            )}
          </ScrollView>
        </Screen>
      )
    }

    if (isCreate && step === "details") {
      return (
        <Screen preset="fixed" safeAreaEdges={["bottom"]}>
          <ScrollView contentContainerStyle={$content}>
            <TextField
              label="Surgery name"
              placeholder="e.g. Total Shoulder Arthroplasty"
              value={label}
              onChangeText={setLabel}
              containerStyle={$field}
            />
            <TextField
              label="Description"
              placeholder="e.g. Shoulder replacement — right or left"
              value={description}
              onChangeText={setDescription}
              containerStyle={$field}
            />

            {error && (
              <Text
                preset="default"
                text={error}
                style={{ color: theme.colors.error, marginBottom: 12 }}
              />
            )}

            <Button
              preset="reversed"
              text="Next"
              onPress={() => {
                if (!label.trim()) {
                  setError("Give this surgery a name.")
                  return
                }
                goToStep("fields")
              }}
              style={$primaryAction}
            />
          </ScrollView>
        </Screen>
      )
    }

    if (isCreate && step === "fields") {
      return (
        <Screen preset="fixed" safeAreaEdges={["bottom"]}>
          <ScrollView contentContainerStyle={$content}>
            <Text
              preset="default"
              text="Select the fields that will exist in this note, regardless of how they'll be filled out — you'll set their order and defaults next."
              style={[$subtitle, { color: theme.colors.textDim }]}
            />

            <FieldCatalogPicker fields={fields} onChange={setFields} />

            {error && (
              <Text
                preset="default"
                text={error}
                style={{ color: theme.colors.error, marginTop: 12, marginBottom: 12 }}
              />
            )}

            <Button
              preset="reversed"
              text="Next"
              onPress={() => {
                if (fields.length === 0) {
                  setError("Select at least one field.")
                  return
                }
                goToStep("reorder")
              }}
              style={$primaryAction}
            />
          </ScrollView>
        </Screen>
      )
    }

    if (isCreate && step === "reorder") {
      return (
        <Screen preset="fixed" safeAreaEdges={["bottom"]} contentContainerStyle={$fillScreen}>
          <FieldEditorList
            fields={fields}
            onChange={setFields}
            header={
              <Text
                preset="default"
                text="Drag fields into the order you want them to appear in the note."
                style={[$subtitle, { color: theme.colors.textDim }]}
              />
            }
            footer={
              <>
                {error && (
                  <Text
                    preset="default"
                    text={error}
                    style={{ color: theme.colors.error, marginBottom: 12 }}
                  />
                )}
                <Button
                  preset="reversed"
                  text="Next"
                  onPress={() => goToStep("defaults")}
                  style={$primaryAction}
                />
              </>
            }
          />
        </Screen>
      )
    }

    // isCreate && step === "defaults", or edit mode.
    return (
      <Screen preset="fixed" safeAreaEdges={["bottom"]} contentContainerStyle={$fillScreen}>
        {loadingTemplate ? (
          <View style={$centerFill}>
            <Text preset="default" text="Loading…" style={{ color: theme.colors.textDim }} />
          </View>
        ) : (
          <FieldEditorList
            fields={fields}
            onChange={setFields}
            showDefaults
            header={
              isCreate ? (
                <Text
                  preset="default"
                  text="Optionally pre-write the default text for any field. Leave blank to always dictate it. Wrap anything the transcription should fill in with {{double curly braces}}."
                  style={[$subtitle, { color: theme.colors.textDim }]}
                />
              ) : (
                <>
                  <TextField
                    label="Surgery name"
                    placeholder="e.g. Total Shoulder Arthroplasty"
                    value={label}
                    onChangeText={setLabel}
                    containerStyle={$field}
                  />
                  <TextField
                    label="Description"
                    placeholder="e.g. Shoulder replacement — right or left"
                    value={description}
                    onChangeText={setDescription}
                    containerStyle={$field}
                  />

                  <Text preset="formLabel" text="Fields" style={$sectionsHeading} />
                  <FieldCatalogPicker fields={fields} onChange={setFields} />

                  <Text preset="formLabel" text="Order & defaults" style={$sectionsHeading} />
                  <Text
                    preset="default"
                    text="Drag to reorder. Leave default text blank to always dictate a field, or wrap anything the transcription should fill in with {{double curly braces}}."
                    style={[$subtitle, { color: theme.colors.textDim }]}
                  />
                </>
              )
            }
            footer={
              <>
                {error && (
                  <Text
                    preset="default"
                    text={error}
                    style={{ color: theme.colors.error, marginBottom: 12 }}
                  />
                )}
                <Button
                  preset="reversed"
                  text={saving ? "Saving…" : "Save template"}
                  onPress={handleSave}
                  disabled={saving}
                  style={$saveButton}
                />
                {!isCreate && (
                  <Pressable onPress={handleDelete} disabled={saving} style={$deleteRow}>
                    <Text
                      preset="default"
                      text="Delete surgery"
                      style={{ color: theme.colors.error }}
                    />
                  </Pressable>
                )}
              </>
            }
          />
        )}
      </Screen>
    )
  }

const $content: ViewStyle = { padding: 20, paddingBottom: 40 }
const $fillScreen: ViewStyle = { flex: 1, justifyContent: "flex-start" }
const $centerFill: ViewStyle = { flex: 1, justifyContent: "center", alignItems: "center" }
const $field: ViewStyle = { marginBottom: 16 }
const $subtitle: TextStyle = { marginBottom: 16, fontSize: 14, lineHeight: 20 }
const $sectionsHeading: TextStyle = { marginBottom: 4, marginTop: 8 }
const $sectionCard: ViewStyle = { borderRadius: 14, borderWidth: 2, padding: 14, marginBottom: 12 }
const $previewCardTitle: TextStyle = { marginBottom: 6 }
const $primaryAction: ViewStyle = { marginTop: 8, marginBottom: 24 }
const $saveButton: ViewStyle = { marginBottom: 16 }
const $deleteRow: ViewStyle = { alignItems: "center", paddingVertical: 12 }
