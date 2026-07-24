/**
 * Intraoperative Ambient Scribe — shared type contract.
 *
 * This is the single source of truth wired through every layer:
 *   - native audio module (capture events / session lifecycle)
 *   - app data layer (scribeApi / useScribeQuery)
 *   - screens (procedure select → capture → review → export)
 *   - backend Lambdas (ingest → generate → drafts/approve)
 *
 * See prds/intra-op-scribe.md — §6 (schema), §5 (functional reqs), §7 (safety).
 *
 * Plain TypeScript, no zod — mirrors app/types/survey.ts. Unions are CLOSED
 * SETS: do not extend without a PRD change.
 */

/* ------------------------------------------------------------------ */
/* Procedures & templates                                             */
/* ------------------------------------------------------------------ */

/**
 * Procedure types the prototype supports. PRD §6 starts with ortho
 * (TKA/THA). Closed set — each drives a note template on the server.
 */
export type ProcedureType = "TKA" | "THA"

export interface ProcedureOption {
  type: ProcedureType
  /** Human label, e.g. "Total Knee Arthroplasty". */
  label: string
  /** Short subtitle for the picker, e.g. "Right / Left knee replacement". */
  description: string
}

/* ------------------------------------------------------------------ */
/* Operative-note schema (PRD §6)                                     */
/* ------------------------------------------------------------------ */

/**
 * Every note field is INDEPENDENTLY populated or marked "not stated".
 * `NoteFieldKey` is the closed set of §6 fields.
 */
export type NoteFieldKey =
  | "patientIdentifiers"
  | "procedureAndLaterality"
  | "preoperativeDiagnosis"
  | "postoperativeDiagnosis"
  | "surgeons"
  | "findings"
  | "implants"
  | "estimatedBloodLoss"
  | "specimens"
  | "complications"
  | "counts"
  | "closureTechnique"
  | "disposition"

/**
 * A span of the raw transcript that supports a generated field. Char
 * offsets index into `DraftNote.transcript`. `segmentId` ties the span
 * back to the capture segment it came from (PRD §5.2 provenance).
 */
export interface TranscriptSpan {
  segmentId: string
  startChar: number
  endChar: number
  /** The literal text, denormalized so the UI needn't re-slice. */
  text: string
}

/**
 * One field of the operative note. `status` is the evidence gate: the
 * server emits "populated" ONLY when transcript evidence exists, else
 * "not_stated" (PRD §5.2 — no inferred boilerplate).
 */
export interface NoteField {
  key: NoteFieldKey
  /** Display label, e.g. "Estimated Blood Loss". */
  label: string
  status: "populated" | "not_stated"
  /** Model-generated value. Empty string when status is "not_stated". */
  value: string
  /** Transcript spans that produced `value`. Empty when "not_stated". */
  provenance: TranscriptSpan[]
  /** True once a human has edited this field in review. */
  edited: boolean
}

/* ------------------------------------------------------------------ */
/* Sessions & drafts                                                  */
/* ------------------------------------------------------------------ */

/**
 * Lifecycle of a case session, from capture through the hard approval
 * gate (PRD §4). "final" is reachable ONLY via human approval.
 */
export type SessionStatus =
  | "capturing" // case live, audio being captured/streamed
  | "processing" // capture ended, server transcribing + generating
  | "draft_ready" // draft in the review queue, awaiting human review
  | "final" // human approved — export unlocked

/**
 * A capture session. Created on the device at case start; the server
 * attaches the generated draft. `surgeonId` is the reviewer/owner.
 */
export interface CaseSession {
  sessionId: string
  surgeonId: string
  procedureType: ProcedureType
  status: SessionStatus
  /** ISO 8601. */
  startedAt: string
  /** ISO 8601, set when capture ends. */
  endedAt?: string
}

/**
 * The generated operative-note draft returned to the review queue
 * (PRD §5.2 "Return"). Carries the raw transcript for span rendering.
 */
export interface DraftNote {
  sessionId: string
  procedureType: ProcedureType
  status: SessionStatus
  /** Full raw transcript; provenance spans index into this string. */
  transcript: string
  /** All §6 fields, always present (populated or not_stated). */
  fields: NoteField[]
  /** ISO 8601 — when generation completed. */
  generatedAt: string
}

/**
 * An immutable entry in the medicolegal edit log (PRD §5.3). One record
 * per field change from draft to final, plus the approval event.
 */
export interface EditLogEntry {
  sessionId: string
  /** null for the approval event itself. */
  fieldKey: NoteFieldKey | null
  action: "edit" | "approve"
  previousValue?: string
  newValue?: string
  /** Who acted. */
  actorId: string
  /** ISO 8601. */
  at: string
}

/* ------------------------------------------------------------------ */
/* Export (PRD §5.4)                                                  */
/* ------------------------------------------------------------------ */

export type ExportFormat = "plaintext" | "pdf"

/**
 * Mandatory safety label on every draft and export (PRD §5.4 / §7).
 * Centralized so screen and export share the exact wording.
 */
export const SAFETY_LABEL =
  "AI-generated draft, human-reviewed. Prototype — not for clinical use." as const

/* ------------------------------------------------------------------ */
/* Wire contract (REST — matches backend Lambdas)                     */
/* ------------------------------------------------------------------ */

/** POST /ingest — register a capture segment (audio uploaded to S3 out-of-band). */
export interface IngestSegmentBody {
  sessionId: string
  surgeonId: string
  procedureType: ProcedureType
  segmentId: string
  /** S3 key of the uploaded audio for this segment. */
  audioKey: string
  /** Section cue the surgeon spoke, if any (PRD §4 step 2). */
  sectionCue?: NoteFieldKey | null
  /** True on the final segment — triggers generation. */
  endOfCase: boolean
}

export interface IngestSegmentResponse {
  success: boolean
  sessionId: string
  status: SessionStatus
}

/** GET /drafts?surgeonId= — the review queue. */
export interface GetDraftsResponse {
  sessions: CaseSession[]
}

/** GET /draft?sessionId= — one draft with transcript + provenance. */
export interface GetDraftResponse {
  draft: DraftNote
}

/** POST /approve — the hard approval gate. Carries the full edit set. */
export interface ApproveNoteBody {
  sessionId: string
  surgeonId: string
  /** Final field values as reviewed/edited by the human. */
  fields: Array<Pick<NoteField, "key" | "value" | "edited">>
  /** Edit-log entries accumulated during review. */
  edits: EditLogEntry[]
}

export interface ApproveNoteResponse {
  success: boolean
  sessionId: string
  status: "final"
  approvedAt: string
}
