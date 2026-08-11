/**
 * POST /drafts/{sessionId}/fields/{fieldKey}/record — start transcribing a
 * fresh dictation to replace one default-bearing field (docs/templates.md §5
 * "No — record"). Deliberately lightweight rather than a second Step
 * Functions execution: starts a single Transcribe batch job (same shape as
 * pipeline/startTranscriptionJobs.ts, same vocabulary resolution) and
 * returns immediately — pollFieldRecord.ts does the completion work. The
 * client already has `segmentId`/`audioKey` from the existing
 * getUploadUrl + S3 PUT flow (ScribeCaptureScreen.tsx's pattern, reused
 * as-is from the review screen).
 */
import { StartTranscriptionJobCommand, TranscribeClient } from "@aws-sdk/client-transcribe"
import { GetCommand } from "@aws-sdk/lib-dynamodb"
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda"

import { ddb, keys, TABLE_NAME } from "./shared/ddb"
import { json, parseBody, surgeonIdFromEvent } from "./shared/http"
import { resolveVocabularyName } from "./shared/vocabulary"
import type {
  DraftNote,
  StartFieldRecordBody,
  StartFieldRecordResponse,
} from "../../app/types/scribe"

const transcribe = new TranscribeClient({})
const AUDIO_BUCKET_NAME = process.env.AUDIO_BUCKET_NAME as string

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  try {
    const surgeonId = surgeonIdFromEvent(event)
    const sessionId = event.pathParameters?.sessionId
    const fieldKey = event.pathParameters?.fieldKey
    if (!sessionId || !fieldKey) return json(400, { error: "Missing sessionId or fieldKey" })

    const body = parseBody<StartFieldRecordBody>(event)
    if (!body.segmentId || !body.audioKey) {
      return json(400, { error: "segmentId and audioKey are required" })
    }

    const PK = keys.session(sessionId)
    const meta = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { PK, SK: keys.meta() } }),
    )
    if (!meta.Item) return json(404, { error: "Session not found" })
    if (meta.Item.surgeonId !== surgeonId) return json(403, { error: "Not your session" })

    const draft = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { PK, SK: keys.draft() } }),
    )
    if (!draft.Item) return json(404, { error: "Draft not ready yet" })

    const fields = (draft.Item as DraftNote).fields
    const field = fields.find((f) => f.key === fieldKey)
    if (!field) return json(404, { error: "Field not found on this draft" })
    if (!field.hasDefault) {
      return json(400, { error: "Only fields with a default can be re-recorded" })
    }

    const procedureType = draft.Item.procedureType as string
    const vocabularyName = await resolveVocabularyName(surgeonId, procedureType)

    // "-record-" is a distinctive separator pollFieldRecord.ts splits on to
    // recover segmentId — sessionId/fieldKey are both makeId()-generated
    // and never contain that substring.
    const jobName = `${sessionId}-${fieldKey}-record-${body.segmentId}`.slice(0, 200)

    await transcribe.send(
      new StartTranscriptionJobCommand({
        TranscriptionJobName: jobName,
        LanguageCode: "en-US",
        MediaFormat: "wav",
        Media: { MediaFileUri: `s3://${AUDIO_BUCKET_NAME}/${body.audioKey}` },
        Settings: { VocabularyName: vocabularyName },
      }),
    )

    const response: StartFieldRecordResponse = { jobName }
    return json(200, response)
  } catch (err) {
    console.error(err)
    return json(500, { error: (err as Error).message })
  }
}
