/**
 * POST /ingest — matches IngestSegmentBody/IngestSegmentResponse exactly
 * (PRD §3.4). Writes the segment row; on `endOfCase: true`, flips the
 * session to "processing" and starts the pipeline Step Functions execution.
 */
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn"
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb"
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda"

import type { IngestSegmentBody, IngestSegmentResponse } from "../../app/types/scribe"
import { ddb, keys, TABLE_NAME } from "./shared/ddb"
import { json, parseBody, surgeonIdFromEvent } from "./shared/http"

const sfn = new SFNClient({})
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN as string

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  try {
    const authSurgeonId = surgeonIdFromEvent(event)
    const body = parseBody<IngestSegmentBody>(event)

    if (body.surgeonId !== authSurgeonId) {
      return json(403, { error: "surgeonId does not match authenticated user" })
    }
    if (!body.sessionId || !body.segmentId || !body.audioKey) {
      return json(400, { error: "sessionId, segmentId, and audioKey are required" })
    }

    const PK = keys.session(body.sessionId)
    const now = new Date().toISOString()

    // Idempotent on segmentId — safe for the client's local-queue retries (PRD §7).
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK,
          SK: keys.segment(body.segmentId),
          segmentId: body.segmentId,
          audioKey: body.audioKey,
          sectionCue: body.sectionCue ?? null,
          ingestedAt: now,
        },
      }),
    )

    const existingMeta = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { PK, SK: keys.meta() } }),
    )

    const status: IngestSegmentResponse["status"] = body.endOfCase ? "processing" : "capturing"

    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK,
          SK: keys.meta(),
          sessionId: body.sessionId,
          surgeonId: body.surgeonId,
          procedureType: body.procedureType,
          status,
          startedAt: existingMeta.Item?.startedAt ?? now,
          endedAt: body.endOfCase ? now : (existingMeta.Item?.endedAt ?? undefined),
        },
      }),
    )

    if (body.endOfCase) {
      await sfn.send(
        new StartExecutionCommand({
          stateMachineArn: STATE_MACHINE_ARN,
          name: `${body.sessionId}`.slice(0, 80),
          input: JSON.stringify({
            sessionId: body.sessionId,
            surgeonId: body.surgeonId,
            procedureType: body.procedureType,
          }),
        }),
      )
    }

    const response: IngestSegmentResponse = { success: true, sessionId: body.sessionId, status }
    return json(200, response)
  } catch (err) {
    console.error(err)
    return json(500, { error: (err as Error).message })
  }
}
