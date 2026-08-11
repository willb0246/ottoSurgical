/** PUT /procedures/{procedureId} — edit a custom surgery's label/description. */
import { UpdateCommand } from "@aws-sdk/lib-dynamodb"
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda"

import type { Specialty, UpdateProcedureBody, UpdateProcedureResponse } from "../../app/types/scribe"
import { ddb, keys, TABLE_NAME } from "./shared/ddb"
import { json, parseBody, surgeonIdFromEvent } from "./shared/http"

const VALID_SPECIALTIES: Specialty[] = ["ortho", "endovascular"]

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  try {
    const surgeonId = surgeonIdFromEvent(event)
    const procedureId = event.pathParameters?.procedureId
    if (!procedureId) return json(400, { error: "Missing procedureId" })

    const body = parseBody<UpdateProcedureBody>(event)
    if (body.label !== undefined && !body.label.trim()) {
      return json(400, { error: "label cannot be empty" })
    }
    if (body.specialty !== undefined && !VALID_SPECIALTIES.includes(body.specialty)) {
      return json(400, { error: `specialty must be one of: ${VALID_SPECIALTIES.join(", ")}` })
    }

    const names: Record<string, string> = { "#updatedAt": "updatedAt" }
    const values: Record<string, unknown> = { ":updatedAt": new Date().toISOString() }
    const sets = ["#updatedAt = :updatedAt"]

    if (body.label !== undefined) {
      names["#label"] = "label"
      values[":label"] = body.label.trim()
      sets.push("#label = :label")
    }
    if (body.description !== undefined) {
      names["#description"] = "description"
      values[":description"] = body.description
      sets.push("#description = :description")
    }
    if (body.specialty !== undefined) {
      names["#specialty"] = "specialty"
      values[":specialty"] = body.specialty
      sets.push("#specialty = :specialty")
    }

    const result = await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: keys.surgeon(surgeonId), SK: keys.procedure(procedureId) },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: "attribute_exists(PK)",
        ReturnValues: "ALL_NEW",
      }),
    )

    const item = result.Attributes as {
      procedureId: string
      label: string
      description?: string
      specialty?: Specialty
    }
    const response: UpdateProcedureResponse = {
      procedure: {
        type: item.procedureId,
        label: item.label,
        description: item.description ?? "",
        specialty: item.specialty ?? "ortho",
      },
    }
    return json(200, response)
  } catch (err) {
    if ((err as Error).name === "ConditionalCheckFailedException") {
      return json(404, { error: "Procedure not found" })
    }
    console.error(err)
    return json(500, { error: (err as Error).message })
  }
}
