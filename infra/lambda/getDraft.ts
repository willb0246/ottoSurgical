/**
 * GET /draft?sessionId= — one draft with transcript + provenance (PRD §3.4).
 */
import { GetCommand } from "@aws-sdk/lib-dynamodb"
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda"

import type { DraftNote, GetDraftResponse } from "../../app/types/scribe"
import { ddb, keys, TABLE_NAME } from "./shared/ddb"
import { json, surgeonIdFromEvent } from "./shared/http"

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  try {
    const surgeonId = surgeonIdFromEvent(event)
    const sessionId = event.queryStringParameters?.sessionId
    if (!sessionId) return json(400, { error: "sessionId is required" })

    const PK = keys.session(sessionId)

    const meta = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK, SK: keys.meta() } }))
    if (!meta.Item) return json(404, { error: "Session not found" })
    if (meta.Item.surgeonId !== surgeonId) return json(403, { error: "Not your session" })

    const draft = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK, SK: keys.draft() } }))
    if (!draft.Item) return json(404, { error: "Draft not ready yet" })

    const noteDraft: DraftNote = {
      sessionId: draft.Item.sessionId,
      procedureType: draft.Item.procedureType,
      status: draft.Item.status,
      transcript: draft.Item.transcript,
      fields: draft.Item.fields,
      generatedAt: draft.Item.generatedAt,
    }

    const response: GetDraftResponse = { draft: noteDraft }
    return json(200, response)
  } catch (err) {
    console.error(err)
    return json(500, { error: (err as Error).message })
  }
}
