/**
 * Pipeline step 5 — locates each generated field's supporting quote in the
 * transcript by exact string match (never trusting model-reported
 * offsets), and attributes it to the segment whose [start,end) range
 * contains it. A quote that can't be found downgrades the field: a pure
 * spoken field falls back to not_stated; a hybrid field falls back to its
 * own unfilled defaultText (placeholders visible) so the surgeon can see
 * exactly what's missing — the evidence gate is enforced here, not just
 * in the prompt.
 *
 * Pure-default fields never go through the model (generateNote.ts never
 * sends them) — they're materialized here directly from the template's
 * defaultText, starting "default_unconfirmed" (docs/templates.md §5-6).
 * All fields merge into one ordered fields[] for writeDraft.ts.
 */
import type { RawGeneratedField } from "./generateNote"
import type { SegmentBoundary } from "./postCorrection"
import type { NoteField, TemplateField, TranscriptSpan } from "../../../app/types/scribe"

interface Input {
  sessionId: string
  surgeonId: string
  procedureType: string
  transcript: string
  segmentBoundaries: SegmentBoundary[]
  generatedFields: RawGeneratedField[]
  /** The resolved pure-spoken fields generateNote.ts sent to the model. */
  spokenFields: Array<{ fieldId: string; label: string }>
  /** The resolved hybrid fields generateNote.ts sent to the model. */
  hybridFields: Array<{ fieldId: string; label: string; defaultText: string }>
  /** The resolved pure-default fields, passed through unmodified. */
  pureDefaultFields: TemplateField[]
}

function segmentForChar(boundaries: SegmentBoundary[], charIndex: number): string {
  const match = boundaries.find((b) => charIndex >= b.startChar && charIndex < b.endChar)
  return match?.segmentId ?? boundaries[boundaries.length - 1]?.segmentId ?? "unknown"
}

export async function handler(input: Input) {
  const spokenById = new Map(input.spokenFields.map((f) => [f.fieldId, f]))
  const hybridById = new Map(input.hybridFields.map((f) => [f.fieldId, f]))

  const extractedFields: NoteField[] = input.generatedFields.map((raw) => {
    const hybrid = hybridById.get(raw.key)
    const hasDefault = !!hybrid
    const label = hybrid?.label ?? spokenById.get(raw.key)?.label ?? raw.key

    if (raw.status !== "populated" || !raw.quote) {
      return hasDefault
        ? {
            key: raw.key,
            label,
            hasDefault: true,
            status: "default_unconfirmed",
            value: hybrid!.defaultText,
            provenance: [],
            edited: false,
          }
        : { key: raw.key, label, hasDefault: false, status: "not_stated", value: "", provenance: [], edited: false }
    }

    const startChar = input.transcript.indexOf(raw.quote)
    if (startChar === -1) {
      // Model didn't produce a literal substring — evidence gate fails closed.
      return hasDefault
        ? {
            key: raw.key,
            label,
            hasDefault: true,
            status: "default_unconfirmed",
            value: hybrid!.defaultText,
            provenance: [],
            edited: false,
          }
        : { key: raw.key, label, hasDefault: false, status: "not_stated", value: "", provenance: [], edited: false }
    }

    const endChar = startChar + raw.quote.length
    const span: TranscriptSpan = {
      segmentId: segmentForChar(input.segmentBoundaries, startChar),
      startChar,
      endChar,
      text: raw.quote,
    }

    return hasDefault
      ? {
          key: raw.key,
          label,
          hasDefault: true,
          status: "default_unconfirmed",
          value: raw.value,
          provenance: [span],
          edited: false,
        }
      : { key: raw.key, label, hasDefault: false, status: "spoken", value: raw.value, provenance: [span], edited: false }
  })

  const pureDefaultFields: NoteField[] = input.pureDefaultFields.map((f) => ({
    key: f.fieldId,
    label: f.label,
    hasDefault: true,
    status: "default_unconfirmed",
    value: f.defaultText,
    provenance: [],
    edited: false,
  }))

  return {
    sessionId: input.sessionId,
    surgeonId: input.surgeonId,
    procedureType: input.procedureType,
    transcript: input.transcript,
    fields: [...extractedFields, ...pureDefaultFields],
  }
}
