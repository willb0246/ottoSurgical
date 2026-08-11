/**
 * DELETE /procedures/{procedureId} — remove a custom surgery and cascade
 * to its template row. Safe: past sessions' DraftNote items are
 * session-scoped, not template-scoped, so already-generated notes are
 * unaffected — only future case-starts against this procedureId are.
 */
import { DeleteCommand } from "@aws-sdk/lib-dynamodb"
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda"

import type { DeleteProcedureResponse } from "../../app/types/scribe"
import { ddb, keys, TABLE_NAME } from "./shared/ddb"
import { json, surgeonIdFromEvent } from "./shared/http"

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  try {
    const surgeonId = surgeonIdFromEvent(event)
    const procedureId = event.pathParameters?.procedureId
    if (!procedureId) return json(400, { error: "Missing procedureId" })

    const PK = keys.surgeon(surgeonId)
    await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK, SK: keys.procedure(procedureId) } }))
    await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK, SK: keys.template(procedureId) } }))

    const response: DeleteProcedureResponse = { success: true }
    return json(200, response)
  } catch (err) {
    console.error(err)
    return json(500, { error: (err as Error).message })
  }
}
