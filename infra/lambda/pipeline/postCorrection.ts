/**
 * Pipeline step 3 — fetches each segment's Transcribe output (a
 * pre-authenticated HTTPS URL, no AWS creds needed), concatenates in
 * capture order, and runs a domain post-correction pass against a small
 * surgical lexicon (PRD §3.3 — "domain post-correction... for anything
 * Transcribe still gets wrong"). Tracks each segment's [start,end) char
 * range in the concatenated transcript so provenance can attribute a
 * generated field back to the segment it came from.
 */
import * as https from "node:https"

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

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = ""
        res.on("data", (chunk) => (data += chunk))
        res.on("end", () => {
          try {
            resolve(JSON.parse(data))
          } catch (err) {
            reject(err)
          }
        })
      })
      .on("error", reject)
  })
}

// Prototype-scale lexicon — laterality, common ortho implant brands/lines,
// and common perioperative drugs. Replace with a real implant catalog +
// drug list once one exists (PRD §6 open question).
const CORRECTIONS: Array<[RegExp, string]> = [
  [/\bzimmer by (a )?met\b/gi, "Zimmer Biomet"],
  [/\bstryker\b/gi, "Stryker"],
  [/\bdepew synthes\b/gi, "DePuy Synthes"],
  [/\bsmith and nephew\b/gi, "Smith & Nephew"],
  [/\bpersona\b/gi, "Persona"],
  [/\bvanguard\b/gi, "Vanguard"],
  [/\btriathlon\b/gi, "Triathlon"],
  [/\bnex ?gen\b/gi, "NexGen"],
  [/\bcorail\b/gi, "Corail"],
  [/\baccolade\b/gi, "Accolade"],
  [/\btaper ?loc\b/gi, "Taperloc"],
  [/\btranexamic acid\b/gi, "tranexamic acid"],
  [/\bcephalosporin\b/gi, "cefazolin"],
  [/\bvancomicin\b/gi, "vancomycin"],
  [/\bbupivicaine\b/gi, "bupivacaine"],
]

function applyCorrections(text: string): string {
  return CORRECTIONS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text)
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
