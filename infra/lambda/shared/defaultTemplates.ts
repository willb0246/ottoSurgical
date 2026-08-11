/**
 * Default procedures + note template, used both to seed a surgeon's
 * PROCEDURE#/TEMPLATE# rows on first read and as generateNote.ts's
 * fallback when a surgeon hasn't customized a procedure's template yet.
 *
 * DEFAULT_FIELDS is today's 14-field schema (docs/templates.md §4): a
 * single unified list where a field's behavior comes from `defaultText`
 * rather than a separate kind/confirm-policy. `counts` keeps its
 * boilerplate default text — it is no longer "protected"; every
 * default-bearing field can be confirmed, re-recorded, or removed at
 * review, same as `closureTechnique`/`disposition`.
 *
 * descriptionOfProcedure has empty defaultText — it's the surgeon's own
 * narrative of what was done (positioning, exposure, dissection/technique,
 * key intraoperative steps), the single highest medicolegal-risk section
 * of an op note (docs/templates.md §4a Example B), so it can never be
 * boilerplate-defaulted.
 */
import type { TemplateField } from "../../../app/types/scribe"

export const DEFAULT_PROCEDURES = [
  {
    procedureId: "TKA",
    label: "Total Knee Arthroplasty",
    description: "Knee replacement — right or left",
    specialty: "ortho" as const,
  },
  {
    procedureId: "THA",
    label: "Total Hip Arthroplasty",
    description: "Hip replacement — right or left",
    specialty: "ortho" as const,
  },
]

export const DEFAULT_FIELDS: TemplateField[] = [
  { fieldId: "patientIdentifiers", label: "Patient Identifiers", defaultText: "", order: 0 },
  {
    fieldId: "procedureAndLaterality",
    label: "Procedure & Laterality",
    defaultText: "",
    order: 1,
  },
  {
    fieldId: "preoperativeDiagnosis",
    label: "Preoperative Diagnosis",
    defaultText: "",
    order: 2,
  },
  {
    fieldId: "postoperativeDiagnosis",
    label: "Postoperative Diagnosis",
    defaultText: "",
    order: 3,
  },
  { fieldId: "surgeons", label: "Surgeons", defaultText: "", order: 4 },
  { fieldId: "findings", label: "Findings", defaultText: "", order: 5 },
  { fieldId: "implants", label: "Implants", defaultText: "", order: 6 },
  { fieldId: "estimatedBloodLoss", label: "Estimated Blood Loss", defaultText: "", order: 7 },
  { fieldId: "specimens", label: "Specimens", defaultText: "", order: 8 },
  { fieldId: "complications", label: "Complications", defaultText: "", order: 9 },
  {
    fieldId: "descriptionOfProcedure",
    label: "Description of Procedure",
    defaultText: "",
    order: 10,
  },
  {
    fieldId: "counts",
    label: "Counts",
    defaultText: "Sponge, needle, and instrument counts correct x2.",
    order: 11,
  },
  {
    fieldId: "closureTechnique",
    label: "Closure Technique",
    defaultText:
      "Standard layered closure with absorbable suture; skin closed per surgeon preference.",
    order: 12,
  },
  {
    fieldId: "disposition",
    label: "Disposition",
    defaultText: "Patient extubated and transferred to PACU in stable condition.",
    order: 13,
  },
]
