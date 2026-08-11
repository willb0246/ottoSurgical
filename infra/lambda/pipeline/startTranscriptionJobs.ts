/**
 * Pipeline step 1 — starts one Amazon Transcribe batch job per captured
 * segment (PRD §3.3). One job per segment (rather than concatenating audio
 * first) avoids needing an audio-mixing step; post-correction concatenates
 * the resulting transcripts in capture order.
 */
import { StartTranscriptionJobCommand, TranscribeClient } from "@aws-sdk/client-transcribe"
import { QueryCommand } from "@aws-sdk/lib-dynamodb"

import { ddb, keys, TABLE_NAME } from "../shared/ddb"
import { resolveVocabularyName } from "../shared/vocabulary"

const transcribe = new TranscribeClient({})
const AUDIO_BUCKET_NAME = process.env.AUDIO_BUCKET_NAME as string

interface PipelineInput {
  sessionId: string
  surgeonId: string
  procedureType: string
}

interface SegmentRef {
  segmentId: string
  jobName: string
}

export async function handler(input: PipelineInput) {
  const vocabularyName = await resolveVocabularyName(input.surgeonId, input.procedureType)

  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": keys.session(input.sessionId), ":prefix": "SEGMENT#" },
    }),
  )

  // segmentId embeds a Date.now().toString(36) component (see makeId in
  // app/utils/scribe/procedures.ts), so SK order == capture order.
  const items = (result.Items ?? []).sort((a, b) => (a.SK as string).localeCompare(b.SK as string))

  const segments: SegmentRef[] = []
  for (const item of items) {
    const segmentId = item.segmentId as string
    const audioKey = item.audioKey as string
    const jobName = `${input.sessionId}-${segmentId}`.slice(0, 200)

    await transcribe.send(
      new StartTranscriptionJobCommand({
        TranscriptionJobName: jobName,
        LanguageCode: "en-US",
        MediaFormat: "wav",
        Media: { MediaFileUri: `s3://${AUDIO_BUCKET_NAME}/${audioKey}` },
        Settings: { VocabularyName: vocabularyName },
      }),
    )
    segments.push({ segmentId, jobName })
  }

  return { ...input, segments }
}
