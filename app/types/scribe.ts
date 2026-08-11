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
 * Plain TypeScript, no zod — mirrors app/types/survey.ts. Remaining unions
 * (SessionStatus, ExportFormat, etc.) are CLOSED SETS: do not extend
 * without a PRD change. ProcedureType and NoteFieldKey are the exception —
 * surgeons now define their own surgeries and note sections (see
 * ProcedureTemplate below), so both widened from closed unions to plain
 * `string` identifiers, same as sessionId/segmentId/surgeonId already are.
 */

/* ------------------------------------------------------------------ */
/* Procedures & templates                                             */
/* ------------------------------------------------------------------ */

/**
 * A procedure/surgery id. Surgeon-defined (private per-surgeon) — no
 * longer a closed set. "TKA"/"THA" remain as the seeded defaults every
 * surgeon starts with, but any string a surgeon creates is valid.
 */
export type ProcedureType = string

/**
 * Surgical specialty a procedure belongs to. Unlike ProcedureType, this
 * IS a closed set — each specialty maps to a real Amazon Transcribe custom
 * vocabulary provisioned in infra/lib/pipeline-stack.ts, so adding one
 * means provisioning its vocabulary, not just adding a string.
 */
export type Specialty = "ortho" | "endovascular"

export interface ProcedureOption {
  type: ProcedureType
  /** Human label, e.g. "Total Knee Arthroplasty". */
  label: string
  /** Short subtitle for the picker, e.g. "Right / Left knee replacement". */
  description: string
  /** Selects which Transcribe custom vocabulary the pipeline uses. */
  specialty: Specialty
}

/**
 * How a default section resolves at review (docs/templates.md §4-5):
 * the full trio (confirm the default / record fresh dictation / remove it),
 * or confirm-only for protected events (e.g. counts) that can't be dropped.
 */
export type ConfirmPolicy = "confirm_record_remove" | "confirm_only"

/**
 * One section of a surgeon's note template for a given procedure.
 * `sectionId` is always machine-generated (never surgeon-typed) since it's
 * used as a correlation key across the AI tool schema, the AI's response,
 * and the review screen's field lookups — a duplicate would silently drop
 * or collide a field on a real note.
 *
 * A template holds two kinds of section (docs/templates.md §4), never
 * interchangeable: a `default_event` pre-fills its own boilerplate and is
 * confirmed/recorded/removed at review; a `spoken_slot` is never defaulted
 * and is filled only by dictation. The template "cannot promote a finding
 * to a default" — this union is how that's enforced in the type system.
 */
export interface DefaultEventSection {
  kind: "default_event"
  sectionId: string
  /** Display label, e.g. "Positioning & prep". */
  label: string
  /** The surgeon's own standard wording, pre-filled pending confirmation. */
  defaultText: string
  confirmPolicy: ConfirmPolicy
  order: number
}

export interface SpokenSlotSection {
  kind: "spoken_slot"
  sectionId: string
  /** Display label, e.g. "Implants Used". */
  label: string
  /** Optional free-text guidance to the AI on what to listen for/extract. */
  instructions?: string
  order: number
}

export type TemplateSection = DefaultEventSection | SpokenSlotSection

/** A surgeon's full note template for one procedure. */
export interface ProcedureTemplate {
  procedureId: string
  sections: TemplateSection[]
  /** ISO 8601. */
  updatedAt: string
}

/* ------------------------------------------------------------------ */
/* Operative-note schema (PRD §6)                                     */
/* ------------------------------------------------------------------ */

/**
 * Every note field is INDEPENDENTLY populated or marked "not stated".
 * `NoteFieldKey` matches a template's `TemplateSection.sectionId` — no
 * longer a closed set, since sections are surgeon-defined. The 14 §6
 * fields (patientIdentifiers, procedureAndLaterality, ...) remain as the
 * seeded default template's section ids.
 */
export type NoteFieldKey = string

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
 * The trust model (docs/templates.md §6, extends PRD §5.2's evidence gate)
 * — three provenance states, now template-driven:
 *   - "spoken" / "not_stated": a spoken_slot field, evidence-gated exactly
 *     as before. "spoken" also covers a default_event field replaced via
 *     "No — record" — same trust tier as an intraop finding.
 *   - "default_unconfirmed" / "default_confirmed" / "default_removed":
 *     a default_event field's state through the review confirm/record/
 *     remove flow. "default_unconfirmed" is the hard gate — it blocks
 *     signing (enforced both client-side and server-side in approve.ts).
 */
export type NoteFieldStatus =
  "spoken" | "not_stated" | "default_unconfirmed" | "default_confirmed" | "default_removed"

/**
 * One field of the operative note. `status` is the evidence gate: the
 * server emits "spoken" ONLY when transcript evidence exists, else
 * "not_stated" for spoken_slot fields (PRD §5.2 — no inferred boilerplate);
 * default_event fields start "default_unconfirmed" and are never
 * AI-derived.
 */
export interface NoteField {
  key: NoteFieldKey
  /** Display label, e.g. "Estimated Blood Loss". */
  label: string
  /** Which template section this field came from — drives review-screen rendering. */
  kind: "default_event" | "spoken_slot"
  status: NoteFieldStatus
  /** Model-generated or template-default value. Empty when "not_stated". */
  value: string
  /** Transcript spans that produced `value`. Empty for unconfirmed/removed defaults. */
  provenance: TranscriptSpan[]
  /** True once a human has edited this field in review. */
  edited: boolean
  /** Denormalized from the template's DefaultEventSection — kind === "default_event" only. Governs which review actions the surgeon sees. */
  confirmPolicy?: ConfirmPolicy
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

/**
 * POST /approve — the hard approval gate. Carries the full edit set.
 * `status` is required per field so the server can enforce docs/templates.md
 * §5's gate — reject if any default_event field is still
 * "default_unconfirmed" — and so confirmed/removed state persists.
 */
export interface ApproveNoteBody {
  sessionId: string
  surgeonId: string
  /** Final field values/state as reviewed/resolved by the human. */
  fields: Array<Pick<NoteField, "key" | "value" | "edited" | "status">>
  /** Edit-log entries accumulated during review. */
  edits: EditLogEntry[]
}

export interface ApproveNoteResponse {
  success: boolean
  sessionId: string
  status: "final"
  approvedAt: string
}

/** GET /procedures — a surgeon's common surgeries. */
export interface ListProceduresResponse {
  procedures: ProcedureOption[]
}

/** POST /procedures — create a custom surgery. */
export interface CreateProcedureBody {
  procedureId: string
  label: string
  description?: string
  specialty: Specialty
}
export interface CreateProcedureResponse {
  procedure: ProcedureOption
}

/** PUT /procedures/{procedureId} */
export interface UpdateProcedureBody {
  label?: string
  description?: string
  specialty?: Specialty
}
export interface UpdateProcedureResponse {
  procedure: ProcedureOption
}

/** DELETE /procedures/{procedureId} — cascades to its template. */
export interface DeleteProcedureResponse {
  success: boolean
}

/** GET /templates/{procedureId} */
export interface GetTemplateResponse {
  template: ProcedureTemplate
}

/**
 * PUT /templates/{procedureId} — replace-all semantics. `order` is omitted;
 * the server assigns it from array position, same as today.
 */
export type PutTemplateSection =
  Omit<DefaultEventSection, "order"> | Omit<SpokenSlotSection, "order">

export interface PutTemplateBody {
  sections: PutTemplateSection[]
}
export interface PutTemplateResponse {
  template: ProcedureTemplate
}

/* ------------------------------------------------------------------ */
/* Record-at-review (docs/templates.md §5 "No — record")              */
/* ------------------------------------------------------------------ */

/**
 * POST /drafts/{sessionId}/fields/{fieldKey}/record — start transcribing a
 * fresh dictation to replace a default_event field. Returns immediately;
 * the Transcribe batch job runs async (see startFieldRecord.ts).
 */
export interface StartFieldRecordBody {
  segmentId: string
  /** S3 key of the uploaded replacement audio. */
  audioKey: string
}
export interface StartFieldRecordResponse {
  jobName: string
}

/**
 * GET /drafts/{sessionId}/fields/{fieldKey}/record?jobName= — poll a
 * record-in-progress job. `field` is present only once "completed" — the
 * field has already transitioned to status "spoken" with real provenance.
 */
export interface PollFieldRecordResponse {
  status: "in_progress" | "completed" | "failed"
  field?: NoteField
}
