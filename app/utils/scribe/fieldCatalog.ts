/**
 * Common note fields a surgeon can pick from when building a template
 * (docs/templates.md §3 "Select fields"). Drawn from the two worked
 * examples in docs/templates.md §4a and the existing 14-field default
 * schema (infra/lambda/shared/defaultTemplates.ts) — a single shared list
 * regardless of specialty. Not exhaustive: the field-selection screen also
 * lets a surgeon add a custom field with any label.
 */
export interface CatalogField {
  label: string
  hint?: string
}

export const COMMON_FIELDS: CatalogField[] = [
  { label: "Patient Identifiers" },
  { label: "Procedure & Laterality", hint: "The operative side and what was done" },
  { label: "Preoperative Diagnosis" },
  { label: "Postoperative Diagnosis" },
  { label: "Indication" },
  { label: "Surgeons / Assistants" },
  { label: "Anesthesia" },
  { label: "Positioning & Prep" },
  { label: "Exposure & Dissection" },
  { label: "Findings" },
  {
    label: "Description of Procedure",
    hint: "The core narrative — positioning, exposure, technique, key steps",
  },
  { label: "Implants / Devices Used" },
  { label: "Estimated Blood Loss" },
  { label: "Specimens" },
  { label: "Complications" },
  { label: "Closure" },
  { label: "Counts" },
  { label: "Disposition" },
]
