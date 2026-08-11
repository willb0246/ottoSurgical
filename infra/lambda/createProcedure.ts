/**
 * POST /procedures — create a custom surgery. procedureId is
 * client-generated (same makeId convention already used for
 * sessionId/segmentId), so the surgeon never types a raw id.
 */
import { PutCommand } from "@aws-sdk/lib-dynamodb"
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda"

import type { CreateProcedureBody, CreateProcedureResponse, Specialty } from "../../app/types/scribe"
import { ddb, keys, TABLE_NAME } from "./shared/ddb"
import { json, parseBody, surgeonIdFromEvent } from "./shared/http"

const VALID_SPECIALTIES: Specialty[] = ["ortho", "endovascular"]

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  try {
    const surgeonId = surgeonIdFromEvent(event)
    const body = parseBody<CreateProcedureBody>(event)

    if (!body.procedureId || !body.label?.trim()) {
      return json(400, { error: "procedureId and label are required" })
    }
    if (!VALID_SPECIALTIES.includes(body.specialty)) {
      return json(400, { error: `specialty must be one of: ${VALID_SPECIALTIES.join(", ")}` })
    }

    const now = new Date().toISOString()
    const item = {
      PK: keys.surgeon(surgeonId),
      SK: keys.procedure(body.procedureId),
      procedureId: body.procedureId,
      label: body.label.trim(),
      description: body.description ?? "",
      specialty: body.specialty,
      createdAt: now,
      updatedAt: now,
    }
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }))

    const response: CreateProcedureResponse = {
      procedure: {
        type: item.procedureId,
        label: item.label,
        description: item.description,
        specialty: item.specialty,
      },
    }
    return json(200, response)
  } catch (err) {
    console.error(err)
    return json(500, { error: (err as Error).message })
  }
}
