/**
 * Domain post-correction lexicon (PRD §3.3 — "domain post-correction...
 * for anything Transcribe still gets wrong"), plus the Transcribe-output
 * fetch helper. Shared by the main pipeline (pipeline/postCorrection.ts)
 * and the record-at-review lambdas (startFieldRecord.ts/pollFieldRecord.ts)
 * so a "No — record" replacement gets the same corrections as intraop
 * dictation.
 */
import * as https from "node:https"

export function fetchJson(url: string): Promise<any> {
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

export function applyCorrections(text: string): string {
  return CORRECTIONS.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    text,
  )
}
