/**
 * Pipeline step 5 — locates each generated field's supporting quote in the
 * transcript by exact string match (never trusting model-reported
 * offsets), and attributes it to the segment whose [start,end) range
 * contains it. A quote that can't be found downgrades the field to
 * not_stated — the evidence gate is enforced here, not just in the prompt.
 */
import type { NoteField, TranscriptSpan } from "../../../app/types/scribe"
import { FIELD_LABELS } from "./generateNote"
import type { RawGeneratedField } from "./generateNote"
import type { SegmentBoundary } from "./postCorrection"

interface Input {
  sessionId: string
  surgeonId: string
  procedureType: string
  transcript: string
  segmentBoundaries: SegmentBoundary[]
  generatedFields: RawGeneratedField[]
}

function segmentForChar(boundaries: SegmentBoundary[], charIndex: number): string {
  const match = boundaries.find((b) => charIndex >= b.startChar && charIndex < b.endChar)
  return match?.segmentId ?? boundaries[boundaries.length - 1]?.segmentId ?? "unknown"
}

export async function handler(input: Input) {
  const fields: NoteField[] = input.generatedFields.map((raw) => {
    const label = FIELD_LABELS[raw.key]

    if (raw.status !== "populated" || !raw.quote) {
      return { key: raw.key, label, status: "not_stated", value: "", provenance: [], edited: false }
    }

    const startChar = input.transcript.indexOf(raw.quote)
    if (startChar === -1) {
      // Model didn't produce a literal substring — evidence gate fails closed.
      return { key: raw.key, label, status: "not_stated", value: "", provenance: [], edited: false }
    }

    const endChar = startChar + raw.quote.length
    const span: TranscriptSpan = {
      segmentId: segmentForChar(input.segmentBoundaries, startChar),
      startChar,
      endChar,
      text: raw.quote,
    }

    return { key: raw.key, label, status: "populated", value: raw.value, provenance: [span], edited: false }
  })

  return {
    sessionId: input.sessionId,
    surgeonId: input.surgeonId,
    procedureType: input.procedureType,
    transcript: input.transcript,
    fields,
  }
}
