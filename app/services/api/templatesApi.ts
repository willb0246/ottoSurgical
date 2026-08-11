/**
 * Surgeon-managed procedures + note templates. Mirrors scribeApi.ts's
 * beaconFetch pattern. surgeonId is never passed explicitly — every route
 * derives it from the Cognito JWT authorizer server-side.
 */
import Config from "@/config"
import type {
  CreateProcedureBody,
  CreateProcedureResponse,
  DeleteProcedureResponse,
  GetTemplateResponse,
  ListProceduresResponse,
  PollFieldRecordResponse,
  PutTemplateBody,
  PutTemplateResponse,
  StartFieldRecordBody,
  StartFieldRecordResponse,
  UpdateProcedureBody,
  UpdateProcedureResponse,
} from "@/types/scribe"

import { beaconFetch } from "./beaconFetch"

const API = () => Config.API_URL

export async function listProcedures() {
  return beaconFetch<ListProceduresResponse>(API(), "/procedures")
}

export async function createProcedure(body: CreateProcedureBody) {
  return beaconFetch<CreateProcedureResponse>(API(), "/procedures", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export async function updateProcedure(procedureId: string, body: UpdateProcedureBody) {
  return beaconFetch<UpdateProcedureResponse>(
    API(),
    `/procedures/${encodeURIComponent(procedureId)}`,
    {
      method: "PUT",
      body: JSON.stringify(body),
    },
  )
}

export async function deleteProcedure(procedureId: string) {
  return beaconFetch<DeleteProcedureResponse>(
    API(),
    `/procedures/${encodeURIComponent(procedureId)}`,
    {
      method: "DELETE",
    },
  )
}

export async function getTemplate(procedureId: string) {
  return beaconFetch<GetTemplateResponse>(API(), `/templates/${encodeURIComponent(procedureId)}`)
}

export async function putTemplate(procedureId: string, body: PutTemplateBody) {
  return beaconFetch<PutTemplateResponse>(API(), `/templates/${encodeURIComponent(procedureId)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  })
}

/** POST /drafts/{sessionId}/fields/{fieldKey}/record — start a "No — record" replacement. */
export async function startFieldRecord(
  sessionId: string,
  fieldKey: string,
  body: StartFieldRecordBody,
) {
  return beaconFetch<StartFieldRecordResponse>(
    API(),
    `/drafts/${encodeURIComponent(sessionId)}/fields/${encodeURIComponent(fieldKey)}/record`,
    { method: "POST", body: JSON.stringify(body) },
  )
}

/** GET /drafts/{sessionId}/fields/{fieldKey}/record?jobName= — poll it. */
export async function pollFieldRecord(sessionId: string, fieldKey: string, jobName: string) {
  return beaconFetch<PollFieldRecordResponse>(
    API(),
    `/drafts/${encodeURIComponent(sessionId)}/fields/${encodeURIComponent(fieldKey)}/record?jobName=${encodeURIComponent(jobName)}`,
  )
}
