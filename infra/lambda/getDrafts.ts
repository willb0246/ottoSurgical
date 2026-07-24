/**
 * GET /drafts?surgeonId= — the review queue (PRD §3.4). Single Query
 * against the bySurgeon GSI, which only has surgeonId/startedAt set on
 * META items, so this naturally returns one row per session.
 */
import { QueryCommand } from "@aws-sdk/lib-dynamodb"
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda"

import type { CaseSession, GetDraftsResponse } from "../../app/types/scribe"
import { ddb, TABLE_NAME } from "./shared/ddb"
import { json, surgeonIdFromEvent } from "./shared/http"

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  try {
    // Authenticated identity only — a surgeon can only list their own sessions,
    // regardless of what ?surgeonId= the client passed (PRD §3.4).
    const surgeonId = surgeonIdFromEvent(event)

    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "bySurgeon",
        KeyConditionExpression: "surgeonId = :sid",
        ExpressionAttributeValues: { ":sid": surgeonId },
        ScanIndexForward: false, // newest first
      }),
    )

    const sessions: CaseSession[] = (result.Items ?? []).map((item) => ({
      sessionId: item.sessionId,
      surgeonId: item.surgeonId,
      procedureType: item.procedureType,
      status: item.status,
      startedAt: item.startedAt,
      endedAt: item.endedAt,
    }))

    const response: GetDraftsResponse = { sessions }
    return json(200, response)
  } catch (err) {
    console.error(err)
    return json(500, { error: (err as Error).message })
  }
}
