/**
 * POST /approve — the hard approval gate (PRD §3.4, §5.3). Writes every
 * EditLogEntry in the body, then the approval entry, then flips status to
 * "final". This is the ONLY code path allowed to set status: "final".
 */
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda"

import { ddb, keys, TABLE_NAME } from "./shared/ddb"
import { json, parseBody, surgeonIdFromEvent } from "./shared/http"
import type { ApproveNoteBody, ApproveNoteResponse, NoteField } from "../../app/types/scribe"

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  try {
    const authSurgeonId = surgeonIdFromEvent(event)
    const body = parseBody<ApproveNoteBody>(event)

    if (body.surgeonId !== authSurgeonId) {
      return json(403, { error: "surgeonId does not match authenticated user" })
    }

    const PK = keys.session(body.sessionId)

    const meta = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { PK, SK: keys.meta() } }),
    )
    if (!meta.Item) return json(404, { error: "Session not found" })
    if (meta.Item.surgeonId !== authSurgeonId) return json(403, { error: "Not your session" })

    const draft = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { PK, SK: keys.draft() } }),
    )
    if (!draft.Item) return json(404, { error: "Draft not ready yet" })

    // Hard gate (docs/templates.md §5): a template default that's still
    // unconfirmed can never reach a signed note. Client-side this is a
    // disabled button; this is the server-side backstop — "a hard state
    // machine, not a dismissible nag."
    const statusById = new Map(body.fields.map((f) => [f.key, f.status]))
    const stillUnconfirmed = (draft.Item.fields as NoteField[]).some(
      (f) => (statusById.get(f.key) ?? f.status) === "default_unconfirmed",
    )
    if (stillUnconfirmed) {
      return json(400, { error: "All template defaults must be resolved before signing." })
    }

    const approvedAt = new Date().toISOString()

    // Append-only edit log — every field edit, then the approval event itself.
    // Index suffix guards against two entries sharing the same `at` timestamp.
    for (const [i, edit] of body.edits.entries()) {
      await ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: { PK, SK: keys.edit(`${edit.at}#${i}`), ...edit },
        }),
      )
    }
    const approvalEntry = {
      sessionId: body.sessionId,
      fieldKey: null,
      action: "approve" as const,
      actorId: authSurgeonId,
      at: approvedAt,
    }
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: { PK, SK: keys.edit(approvedAt), ...approvalEntry },
      }),
    )

    // Merge the surgeon's final field values/state into the draft's typed
    // fields — status carries through so a confirmed/removed default (or a
    // "No — record" replacement already applied via pollFieldRecord.ts)
    // persists correctly on the signed note.
    const finalById = new Map(body.fields.map((f) => [f.key, f]))
    const finalFields: NoteField[] = (draft.Item.fields as NoteField[]).map((f) => {
      const override = finalById.get(f.key)
      return override
        ? { ...f, value: override.value, edited: override.edited, status: override.status }
        : f
    })

    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK, SK: keys.draft() },
        UpdateExpression: "SET #status = :status, #fields = :fields",
        ExpressionAttributeNames: { "#status": "status", "#fields": "fields" },
        ExpressionAttributeValues: { ":status": "final", ":fields": finalFields },
      }),
    )
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK, SK: keys.meta() },
        UpdateExpression: "SET #status = :status",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":status": "final" },
      }),
    )

    const response: ApproveNoteResponse = {
      success: true,
      sessionId: body.sessionId,
      status: "final",
      approvedAt,
    }
    return json(200, response)
  } catch (err) {
    console.error(err)
    return json(500, { error: (err as Error).message })
  }
}
