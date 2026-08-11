/**
 * GET /drafts/{sessionId}/fields/{fieldKey}/record?jobName= — poll a
 * record-in-progress job started by startFieldRecord.ts. On completion,
 * applies the same post-correction lexicon as the main pipeline
 * (shared/postCorrection.ts), appends the new text to the draft's stored
 * transcript (preserving the span-rendering convention every other
 * provenance quote relies on), and flips the field to "spoken" — the same
 * trust tier as an intraop finding (docs/templates.md §5-6).
 */
import { GetTranscriptionJobCommand, TranscribeClient } from "@aws-sdk/client-transcribe"
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda"

import { ddb, keys, TABLE_NAME } from "./shared/ddb"
import { json, surgeonIdFromEvent } from "./shared/http"
import { applyCorrections, fetchJson } from "./shared/postCorrection"
import type {
  DraftNote,
  NoteField,
  PollFieldRecordResponse,
  TranscriptSpan,
} from "../../app/types/scribe"

const transcribe = new TranscribeClient({})

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  try {
    const surgeonId = surgeonIdFromEvent(event)
    const sessionId = event.pathParameters?.sessionId
    const fieldKey = event.pathParameters?.fieldKey
    const jobName = event.queryStringParameters?.jobName
    if (!sessionId || !fieldKey || !jobName) {
      return json(400, { error: "Missing sessionId, fieldKey, or jobName" })
    }

    const PK = keys.session(sessionId)
    const meta = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { PK, SK: keys.meta() } }),
    )
    if (!meta.Item) return json(404, { error: "Session not found" })
    if (meta.Item.surgeonId !== surgeonId) return json(403, { error: "Not your session" })

    const job = await transcribe.send(
      new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }),
    )
    const jobStatus = job.TranscriptionJob?.TranscriptionJobStatus

    if (jobStatus === "FAILED") {
      const response: PollFieldRecordResponse = { status: "failed" }
      return json(200, response)
    }
    if (jobStatus !== "COMPLETED") {
      const response: PollFieldRecordResponse = { status: "in_progress" }
      return json(200, response)
    }

    const transcriptUri = job.TranscriptionJob?.Transcript?.TranscriptFileUri
    if (!transcriptUri) {
      const response: PollFieldRecordResponse = { status: "failed" }
      return json(200, response)
    }

    const draft = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { PK, SK: keys.draft() } }),
    )
    if (!draft.Item) return json(404, { error: "Draft not ready yet" })

    const draftNote = draft.Item as DraftNote
    const fieldIndex = draftNote.fields.findIndex((f) => f.key === fieldKey)
    if (fieldIndex === -1) return json(404, { error: "Field not found on this draft" })

    const rawJson = await fetchJson(transcriptUri)
    const raw = rawJson?.results?.transcripts?.[0]?.transcript ?? ""
    const corrected = applyCorrections(raw)

    // Recover the segmentId embedded by startFieldRecord.ts's jobName.
    const segmentId = jobName.split("-record-")[1] ?? "unknown"

    const priorTranscript = draftNote.transcript
    const separator = priorTranscript.length > 0 ? " " : ""
    const startChar = priorTranscript.length + separator.length
    const newTranscript = priorTranscript + separator + corrected
    const span: TranscriptSpan = {
      segmentId,
      startChar,
      endChar: newTranscript.length,
      text: corrected,
    }

    const updatedField: NoteField = {
      ...draftNote.fields[fieldIndex],
      status: "spoken",
      value: corrected,
      provenance: [span],
      edited: false,
    }
    const updatedFields = draftNote.fields.map((f, i) => (i === fieldIndex ? updatedField : f))

    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK, SK: keys.draft() },
        UpdateExpression: "SET #transcript = :transcript, #fields = :fields",
        ExpressionAttributeNames: { "#transcript": "transcript", "#fields": "fields" },
        ExpressionAttributeValues: { ":transcript": newTranscript, ":fields": updatedFields },
      }),
    )

    const response: PollFieldRecordResponse = { status: "completed", field: updatedField }
    return json(200, response)
  } catch (err) {
    console.error(err)
    return json(500, { error: (err as Error).message })
  }
}
