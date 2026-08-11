/**
 * Specialty -> Transcribe custom vocabulary resolution. Shared by
 * startTranscriptionJobs.ts (main pipeline) and the record-at-review
 * lambdas (startFieldRecord.ts), both of which start a Transcribe batch
 * job for a surgeon's procedure and need the same vocabulary lookup.
 *
 * Legacy procedure rows (created before Specialty existed) fall back to
 * "ortho" — the vocabulary every procedure was transcribed against before
 * that mapping was introduced.
 */
import { GetCommand } from "@aws-sdk/lib-dynamodb"

import { ddb, keys, TABLE_NAME } from "./ddb"
import type { Specialty } from "../../../app/types/scribe"

const VOCABULARY_NAME_BY_SPECIALTY: Record<Specialty, string> = {
  ortho: process.env.VOCABULARY_NAME_ORTHO as string,
  endovascular: process.env.VOCABULARY_NAME_ENDOVASCULAR as string,
}

export async function resolveVocabularyName(
  surgeonId: string,
  procedureType: string,
): Promise<string> {
  const procedureResult = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: keys.surgeon(surgeonId), SK: keys.procedure(procedureType) },
    }),
  )
  const specialty = (procedureResult.Item?.specialty as Specialty | undefined) ?? "ortho"
  return VOCABULARY_NAME_BY_SPECIALTY[specialty]
}
