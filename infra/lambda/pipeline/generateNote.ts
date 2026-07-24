/**
 * Pipeline step 4 — structured, evidence-gated note generation (PRD §3.3,
 * §5.2). Bedrock Claude, tool-use forced to the NoteField[] schema. The
 * model must quote the exact supporting substring for every populated
 * field so computeProvenance can locate it by string match rather than
 * trusting model-reported character offsets (models are unreliable at
 * literal character counting).
 */
import { BedrockRuntimeClient, ConverseCommand, type Tool } from "@aws-sdk/client-bedrock-runtime"

import type { NoteFieldKey } from "../../../app/types/scribe"

const bedrock = new BedrockRuntimeClient({ maxAttempts: 5, retryMode: "adaptive" })
const MODEL_ID = process.env.BEDROCK_MODEL_ID as string

interface Input {
  sessionId: string
  surgeonId: string
  procedureType: string
  transcript: string
  segmentBoundaries: Array<{ segmentId: string; startChar: number; endChar: number }>
}

export const FIELD_LABELS: Record<NoteFieldKey, string> = {
  patientIdentifiers: "Patient Identifiers",
  procedureAndLaterality: "Procedure & Laterality",
  preoperativeDiagnosis: "Preoperative Diagnosis",
  postoperativeDiagnosis: "Postoperative Diagnosis",
  surgeons: "Surgeons",
  findings: "Findings",
  implants: "Implants",
  estimatedBloodLoss: "Estimated Blood Loss",
  specimens: "Specimens",
  complications: "Complications",
  counts: "Counts",
  closureTechnique: "Closure Technique",
  disposition: "Disposition",
}

const FIELD_KEYS = Object.keys(FIELD_LABELS) as NoteFieldKey[]

export interface RawGeneratedField {
  key: NoteFieldKey
  status: "populated" | "not_stated"
  value: string
  /** Verbatim substring of the transcript supporting `value`; empty if not_stated. */
  quote: string
}

const emitTool: Tool = {
  toolSpec: {
    name: "emit_note_fields",
    description:
      "Emit the operative note as exactly one entry per required field key, evidence-gated against the transcript.",
    inputSchema: {
      json: {
        type: "object",
        properties: {
          fields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string", enum: FIELD_KEYS },
                status: { type: "string", enum: ["populated", "not_stated"] },
                value: { type: "string" },
                quote: {
                  type: "string",
                  description:
                    "Exact verbatim substring copied from the transcript that supports `value`. Empty string if status is not_stated.",
                },
              },
              required: ["key", "status", "value", "quote"],
            },
          },
        },
        required: ["fields"],
      },
    },
  },
}

function buildPrompt(procedureType: string, transcript: string): string {
  const fieldList = FIELD_KEYS.map((k) => `- ${k}: ${FIELD_LABELS[k]}`).join("\n")
  return `You are generating a structured operative note from a raw ASR transcript of a ${procedureType} case dictated intraoperatively.

Required fields (emit exactly one entry per key, in any order):
${fieldList}

Rules (hard evidence gate — no exceptions):
1. Populate a field ONLY when the transcript explicitly supports it. Otherwise set status="not_stated", value="", quote="".
2. When status="populated", "quote" MUST be an exact, verbatim, contiguous substring copied character-for-character from the transcript below — not a paraphrase. It is used for automated string matching, so it must appear exactly as written in the transcript.
3. "value" is a concise clinical summary of that field (may lightly normalize wording), but never invent facts absent from the transcript.
4. Do not infer boilerplate or "typical" values — every populated field must trace to something actually said.

Transcript:
"""
${transcript}
"""`
}

export async function handler(input: Input) {
  const response = await bedrock.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      messages: [{ role: "user", content: [{ text: buildPrompt(input.procedureType, input.transcript) }] }],
      inferenceConfig: { maxTokens: 4096, temperature: 0 },
      toolConfig: { tools: [emitTool], toolChoice: { tool: { name: "emit_note_fields" } } },
    }),
  )

  const toolBlock = response.output?.message?.content?.find((b) => b.toolUse)?.toolUse
  if (!toolBlock?.input) {
    throw new Error(`Bedrock did not return a tool_use block (stopReason=${response.stopReason})`)
  }

  const rawFields = (toolBlock.input as unknown as { fields: RawGeneratedField[] }).fields ?? []

  // Defense in depth: guarantee exactly one entry per required key even if
  // the model dropped one — treat a missing key as not_stated.
  const byKey = new Map(rawFields.map((f) => [f.key, f]))
  const generatedFields: RawGeneratedField[] = FIELD_KEYS.map(
    (key) => byKey.get(key) ?? { key, status: "not_stated", value: "", quote: "" },
  )

  return {
    sessionId: input.sessionId,
    surgeonId: input.surgeonId,
    procedureType: input.procedureType,
    transcript: input.transcript,
    segmentBoundaries: input.segmentBoundaries,
    generatedFields,
  }
}
