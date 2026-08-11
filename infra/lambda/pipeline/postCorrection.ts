/**
 * Pipeline step 3 — fetches each segment's Transcribe output (a
 * pre-authenticated HTTPS URL, no AWS creds needed), concatenates in
 * capture order, and runs a domain post-correction pass against a small
 * surgical lexicon (see shared/postCorrection.ts). Tracks each segment's
 * [start,end) char range in the concatenated transcript so provenance can
 * attribute a generated field back to the segment it came from.
 */
import { applyCorrections, fetchJson } from "../shared/postCorrection"

interface TranscriptRef {
  segmentId: string
  uri: string
}

interface Input {
  sessionId: string
  surgeonId: string
  procedureType: string
  transcriptUris: TranscriptRef[]
}

export interface SegmentBoundary {
  segmentId: string
  startChar: number
  endChar: number
}

export async function handler(input: Input) {
  const boundaries: SegmentBoundary[] = []
  const pieces: string[] = []
  let cursor = 0

  for (const ref of input.transcriptUris) {
    const json = await fetchJson(ref.uri)
    const raw = json?.results?.transcripts?.[0]?.transcript ?? ""
    const corrected = applyCorrections(raw)

    const startChar = cursor
    pieces.push(corrected)
    cursor += corrected.length
    boundaries.push({ segmentId: ref.segmentId, startChar, endChar: cursor })
    // Single space between segments; account for it in the next segment's cursor.
    pieces.push(" ")
    cursor += 1
  }

  const transcript = pieces.join("").trimEnd()

  return {
    sessionId: input.sessionId,
    surgeonId: input.surgeonId,
    procedureType: input.procedureType,
    transcript,
    segmentBoundaries: boundaries,
  }
}
