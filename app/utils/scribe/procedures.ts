/**
 * Procedure templates the prototype supports (PRD §6 — start with ortho).
 * Closed set; adding one means adding a server-side note template too.
 */
import type { ProcedureOption } from "@/types/scribe"

export const PROCEDURES: ProcedureOption[] = [
  {
    type: "TKA",
    label: "Total Knee Arthroplasty",
    description: "Knee replacement — right or left",
  },
  {
    type: "THA",
    label: "Total Hip Arthroplasty",
    description: "Hip replacement — right or left",
  },
]

/** Prototype id generator (no uuid dep; sufficient for local sessions). */
export function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
