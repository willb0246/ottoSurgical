/**
 * Pipeline step 4 — structured, evidence-gated note generation (PRD §3.3,
 * §5.2), now scoped to fields that can actually change from dictation
 * (docs/templates.md §4/§6: a template "cannot promote a finding to a
 * default"). A unified template field's behavior comes from its
 * `defaultText`:
 *   - empty: pure spoken field, sent to the model for extraction exactly
 *     like the old "spoken_slot".
 *   - non-empty with {{placeholder}} token(s): hybrid — sent to the model,
 *     which fills ONLY the placeholders from dictation and returns the
 *     complete merged text, preserving the rest of the boilerplate as-is.
 *   - non-empty with no placeholders: pure default — never sent to the
 *     model, materialized directly by computeProvenance.ts from the
 *     field's own defaultText.
 * Calls Anthropic's API directly (not Bedrock — see project memory
 * "decision_llm_provider": the account already has a direct Anthropic BAA,
 * so Bedrock's main advantage — one AWS BAA covering all model providers —
 * is redundant here, and direct API access avoids Bedrock's account-level
 * model-access gating). Tool-use forced to the NoteField[] schema. The
 * model must quote the exact supporting substring for every populated
 * field so computeProvenance can locate it by string match rather than
 * trusting model-reported character offsets (models are unreliable at
 * literal character counting).
 *
 * The field schema is no longer a single global constant — it's resolved
 * per invocation from the surgeon's saved template for this procedureType
 * (SURGEON#<surgeonId>/TEMPLATE#<procedureType>), falling back to
 * DEFAULT_FIELDS when the surgeon hasn't customized this procedure yet.
 * This keeps every existing TKA/THA case byte-identical to before this
 * feature shipped.
 */
import Anthropic from "@anthropic-ai/sdk"
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager"
import { GetCommand } from "@aws-sdk/lib-dynamodb"

import type { TemplateField } from "../../../app/types/scribe"
import { ddb, keys, TABLE_NAME } from "../shared/ddb"
import { DEFAULT_FIELDS } from "../shared/defaultTemplates"

const secretsManager = new SecretsManagerClient({})
const MODEL_ID = "claude-opus-4-8"
const PLACEHOLDER_RE = /\{\{.*?\}\}/

interface Input {
  sessionId: string
  surgeonId: string
  procedureType: string
  transcript: string
  segmentBoundaries: Array<{ segmentId: string; startChar: number; endChar: number }>
}

export interface RawGeneratedField {
  key: string
  status: "populated" | "not_stated"
  value: string
  /** Verbatim substring of the transcript supporting `value`; empty if not_stated. */
  quote: string
}

async function resolveFields(
  surgeonId: string,
  procedureType: string,
): Promise<TemplateField[]> {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: keys.surgeon(surgeonId), SK: keys.template(procedureType) },
    }),
  )

  const fields = result.Item?.fields as TemplateField[] | undefined
  if (fields && fields.length > 0) {
    return [...fields].sort((a, b) => a.order - b.order)
  }
  return DEFAULT_FIELDS
}

function buildTool(extractable: TemplateField[]): Anthropic.Tool {
  return {
    name: "emit_note_fields",
    description:
      "Emit the operative note as exactly one entry per required field key, evidence-gated against the transcript.",
    input_schema: {
      type: "object",
      properties: {
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string", enum: extractable.map((f) => f.fieldId) },
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
  }
}

function buildPrompt(
  procedureType: string,
  extractable: TemplateField[],
  transcript: string,
): string {
  const fieldList = extractable
    .map((f) => {
      if (f.defaultText === "") return `- ${f.fieldId}: ${f.label}`
      return `- ${f.fieldId}: ${f.label} (Boilerplate: "${f.defaultText}" — fill ONLY the {{...}} placeholder(s) with content drawn from the transcript and return the complete sentence with the rest preserved verbatim; if no transcript evidence supports a placeholder, return the boilerplate exactly as written, placeholders intact, and set status="not_stated")`
    })
    .join("\n")
  return `You are generating a structured operative note from a raw ASR transcript of a ${procedureType} case dictated intraoperatively.

Required fields (emit exactly one entry per key, in any order):
${fieldList}

Rules (hard evidence gate — no exceptions):
1. Populate a field ONLY when the transcript explicitly supports it. Otherwise set status="not_stated", value="", quote="".
2. When status="populated", "quote" MUST be an exact, verbatim, contiguous substring copied character-for-character from the transcript below — not a paraphrase. It is used for automated string matching, so it must appear exactly as written in the transcript.
3. "value" is a concise clinical summary of that field (may lightly normalize wording), but never invent facts absent from the transcript. For a field with boilerplate, "value" is the complete boilerplate text with placeholders substituted — not just the substituted fragment.
4. Do not infer boilerplate or "typical" values — every populated field must trace to something actually said.

Transcript:
"""
${transcript}
"""`
}

let cachedClient: Anthropic | null = null

async function getClient(): Promise<Anthropic> {
  if (cachedClient) return cachedClient
  const secretId = process.env.ANTHROPIC_API_KEY_SECRET_ARN as string
  const result = await secretsManager.send(new GetSecretValueCommand({ SecretId: secretId }))
  cachedClient = new Anthropic({ apiKey: result.SecretString })
  return cachedClient
}

export async function handler(input: Input) {
  const fields = await resolveFields(input.surgeonId, input.procedureType)
  const spokenFields = fields.filter((f) => f.defaultText === "")
  const hybridFields = fields.filter(
    (f) => f.defaultText !== "" && PLACEHOLDER_RE.test(f.defaultText),
  )
  const pureDefaultFields = fields.filter(
    (f) => f.defaultText !== "" && !PLACEHOLDER_RE.test(f.defaultText),
  )
  const extractable = [...spokenFields, ...hybridFields]

  const client = await getClient()

  const response = await client.messages.create({
    model: MODEL_ID,
    max_tokens: 4096,
    output_config: { effort: "high" },
    messages: [
      { role: "user", content: buildPrompt(input.procedureType, extractable, input.transcript) },
    ],
    tools: [buildTool(extractable)],
    tool_choice: { type: "tool", name: "emit_note_fields" },
  })

  if (response.stop_reason === "refusal") {
    throw new Error("Anthropic API refused the request (stop_reason=refusal)")
  }

  const toolBlock = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
  if (!toolBlock) {
    throw new Error(
      `Anthropic API did not return a tool_use block (stop_reason=${response.stop_reason})`,
    )
  }

  const rawFields = (toolBlock.input as { fields: RawGeneratedField[] }).fields ?? []

  // Defense in depth: guarantee exactly one entry per required key even if
  // the model dropped one — treat a missing key as not_stated.
  const byKey = new Map(rawFields.map((f) => [f.key, f]))
  const generatedFields: RawGeneratedField[] = extractable.map(
    (f) => byKey.get(f.fieldId) ?? { key: f.fieldId, status: "not_stated", value: "", quote: "" },
  )

  return {
    sessionId: input.sessionId,
    surgeonId: input.surgeonId,
    procedureType: input.procedureType,
    transcript: input.transcript,
    segmentBoundaries: input.segmentBoundaries,
    generatedFields,
    spokenFields: spokenFields.map((f) => ({ fieldId: f.fieldId, label: f.label })),
    hybridFields: hybridFields.map((f) => ({
      fieldId: f.fieldId,
      label: f.label,
      defaultText: f.defaultText,
    })),
    pureDefaultFields,
  }
}
