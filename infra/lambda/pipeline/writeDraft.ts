/**
 * Pipeline step 6 (final) — writes the DraftNote and flips the session to
 * draft_ready, ready for the review queue (PRD §3.3).
 */
import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"

import type { NoteField } from "../../../app/types/scribe"
import { ddb, keys, TABLE_NAME } from "../shared/ddb"

interface Input {
  sessionId: string
  surgeonId: string
  procedureType: string
  transcript: string
  fields: NoteField[]
}

export async function handler(input: Input) {
  const PK = keys.session(input.sessionId)
  const generatedAt = new Date().toISOString()

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK,
        SK: keys.draft(),
        sessionId: input.sessionId,
        procedureType: input.procedureType,
        status: "draft_ready",
        transcript: input.transcript,
        fields: input.fields,
        generatedAt,
      },
    }),
  )

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK, SK: keys.meta() },
      UpdateExpression: "SET #status = :status",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":status": "draft_ready" },
    }),
  )

  return { sessionId: input.sessionId, status: "draft_ready" }
}
