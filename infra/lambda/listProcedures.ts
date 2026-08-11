/**
 * GET /procedures — a surgeon's list of common surgeries. Seeds
 * DEFAULT_PROCEDURES on first read so every surgeon starts with today's
 * TKA/THA behavior with no manual setup required.
 */
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb"
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda"

import type { ListProceduresResponse, ProcedureOption } from "../../app/types/scribe"
import { ddb, keys, TABLE_NAME } from "./shared/ddb"
import { DEFAULT_PROCEDURES } from "./shared/defaultTemplates"
import { json, surgeonIdFromEvent } from "./shared/http"

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  try {
    const surgeonId = surgeonIdFromEvent(event)
    const PK = keys.surgeon(surgeonId)

    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: { ":pk": PK, ":prefix": "PROCEDURE#" },
      }),
    )

    // Rows created before the specialty field existed don't have one — default
    // to "ortho" (the vocabulary today's procedures were always transcribed
    // against) rather than dropping the field or failing to load.
    let procedures: ProcedureOption[] = (result.Items ?? []).map((item) => ({
      type: item.procedureId,
      label: item.label,
      description: item.description ?? "",
      specialty: item.specialty ?? "ortho",
    }))

    if (procedures.length === 0) {
      const now = new Date().toISOString()
      for (const p of DEFAULT_PROCEDURES) {
        await ddb.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: { PK, SK: keys.procedure(p.procedureId), ...p, createdAt: now, updatedAt: now },
          }),
        )
      }
      procedures = DEFAULT_PROCEDURES.map((p) => ({
        type: p.procedureId,
        label: p.label,
        description: p.description,
        specialty: p.specialty,
      }))
    }

    const response: ListProceduresResponse = { procedures }
    return json(200, response)
  } catch (err) {
    console.error(err)
    return json(500, { error: (err as Error).message })
  }
}
