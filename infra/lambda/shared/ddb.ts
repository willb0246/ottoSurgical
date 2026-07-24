/**
 * Single-table key helpers (PRD §3.2 logical model):
 *   SESSION#<sessionId> / META               -> CaseSession
 *   SESSION#<sessionId> / SEGMENT#<segmentId> -> segment metadata
 *   SESSION#<sessionId> / DRAFT               -> DraftNote
 *   SESSION#<sessionId> / EDIT#<isoTimestamp>  -> EditLogEntry (append-only)
 * bySurgeon GSI (surgeonId, startedAt) only has surgeonId/startedAt set on
 * META items, so it naturally returns one row per session.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))

export const TABLE_NAME = process.env.TABLE_NAME as string

export const keys = {
  session: (sessionId: string) => `SESSION#${sessionId}`,
  meta: () => "META",
  segment: (segmentId: string) => `SEGMENT#${segmentId}`,
  draft: () => "DRAFT",
  edit: (isoTimestamp: string) => `EDIT#${isoTimestamp}`,
}
