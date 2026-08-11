/**
 * GET /templates/{procedureId} — a surgery's ordered note-field template.
 * Seeds DEFAULT_FIELDS on first read for the two default procedures
 * (today's identical 14-field schema); a custom procedure with no saved
 * template yet returns an empty field list rather than silently
 * inheriting the default schema.
 */
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb"
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda"

import { ddb, keys, TABLE_NAME } from "./shared/ddb"
import { DEFAULT_FIELDS, DEFAULT_PROCEDURES } from "./shared/defaultTemplates"
import { json, surgeonIdFromEvent } from "./shared/http"
import type { GetTemplateResponse, ProcedureTemplate } from "../../app/types/scribe"

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  try {
    const surgeonId = surgeonIdFromEvent(event)
    const procedureId = event.pathParameters?.procedureId
    if (!procedureId) return json(400, { error: "Missing procedureId" })

    const PK = keys.surgeon(surgeonId)
    const existing = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { PK, SK: keys.template(procedureId) } }),
    )

    if (existing.Item) {
      const response: GetTemplateResponse = { template: existing.Item as ProcedureTemplate }
      return json(200, response)
    }

    const isDefaultProcedure = DEFAULT_PROCEDURES.some((p) => p.procedureId === procedureId)
    if (!isDefaultProcedure) {
      const response: GetTemplateResponse = {
        template: { procedureId, fields: [], updatedAt: new Date().toISOString() },
      }
      return json(200, response)
    }

    const template: ProcedureTemplate = {
      procedureId,
      fields: DEFAULT_FIELDS,
      updatedAt: new Date().toISOString(),
    }
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: { PK, SK: keys.template(procedureId), ...template },
      }),
    )
    const response: GetTemplateResponse = { template }
    return json(200, response)
  } catch (err) {
    console.error(err)
    return json(500, { error: (err as Error).message })
  }
}
