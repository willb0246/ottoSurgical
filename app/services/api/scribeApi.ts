/**
 * Real implementation of the wire contract frozen in @/types/scribe —
 * every field there is a requirement, not a suggestion (PRD §2.2). Talks to
 * api-stack's HTTP API (infra/lib/api-stack.ts) via beaconFetch.
 */
import Config from "@/config"
import type {
  ApproveNoteBody,
  ApproveNoteResponse,
  GetDraftResponse,
  GetDraftsResponse,
  IngestSegmentBody,
  IngestSegmentResponse,
} from "@/types/scribe"

import { beaconFetch } from "./beaconFetch"

const API = () => Config.API_URL

/** POST /uploads/presign — returns a presigned PUT URL + the audioKey to pass to ingest(). */
export interface GetUploadUrlResponse {
  uploadUrl: string
  audioKey: string
}

export async function getUploadUrl(sessionId: string, segmentId: string) {
  return beaconFetch<GetUploadUrlResponse>(API(), "/uploads/presign", {
    method: "POST",
    body: JSON.stringify({ sessionId, segmentId }),
  })
}

export async function ingestSegment(body: IngestSegmentBody) {
  return beaconFetch<IngestSegmentResponse>(API(), "/ingest", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export async function getDrafts(surgeonId: string) {
  return beaconFetch<GetDraftsResponse>(
    API(),
    `/drafts?surgeonId=${encodeURIComponent(surgeonId)}`,
  )
}

export async function getDraft(sessionId: string) {
  return beaconFetch<GetDraftResponse>(API(), `/draft?sessionId=${encodeURIComponent(sessionId)}`)
}

export async function approveNote(body: ApproveNoteBody) {
  return beaconFetch<ApproveNoteResponse>(API(), "/approve", {
    method: "POST",
    body: JSON.stringify(body),
  })
}
