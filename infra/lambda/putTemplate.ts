/**
 * PUT /templates/{procedureId} — replace-all semantics: the client sends
 * the full ordered field array after any add/remove/reorder/edit.
 *
 * fieldId is a correlation key used across generateNote.ts's tool schema,
 * the AI's response, and the review screen's field lookups — a duplicate
 * would silently drop or collide a field on a real surgical note rather
 * than error, so this validates uniqueness and non-empty labels before
 * writing. The client never lets a surgeon type a raw id (it's generated
 * client-side), but this must still fail closed server-side rather than
 * relying on that.
 */
import { PutCommand } from "@aws-sdk/lib-dynamodb"
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda"

import { ddb, keys, TABLE_NAME } from "./shared/ddb"
import { json, parseBody, surgeonIdFromEvent } from "./shared/http"
import type {
  ProcedureTemplate,
  PutTemplateBody,
  PutTemplateResponse,
  TemplateField,
} from "../../app/types/scribe"

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  try {
    const surgeonId = surgeonIdFromEvent(event)
    const procedureId = event.pathParameters?.procedureId
    if (!procedureId) return json(400, { error: "Missing procedureId" })

    const body = parseBody<PutTemplateBody>(event)
    const rawFields = body.fields ?? []

    for (const f of rawFields) {
      if (!f.fieldId || !f.label?.trim()) {
        return json(400, { error: "Every field needs a fieldId and a non-empty label" })
      }
    }
    const ids = rawFields.map((f) => f.fieldId)
    if (new Set(ids).size !== ids.length) {
      return json(400, { error: "Duplicate fieldId in template" })
    }

    const template: ProcedureTemplate = {
      procedureId,
      fields: rawFields.map(
        (f, order): TemplateField => ({
          fieldId: f.fieldId,
          label: f.label.trim(),
          defaultText: f.defaultText ?? "",
          order,
        }),
      ),
      updatedAt: new Date().toISOString(),
    }

    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: { PK: keys.surgeon(surgeonId), SK: keys.template(procedureId), ...template },
      }),
    )

    const response: PutTemplateResponse = { template }
    return json(200, response)
  } catch (err) {
    console.error(err)
    return json(500, { error: (err as Error).message })
  }
}
