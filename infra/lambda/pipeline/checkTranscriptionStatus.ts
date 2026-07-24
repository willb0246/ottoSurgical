/**
 * Pipeline step 2 — polled from the state machine's Wait/Choice loop.
 * Checks every segment's Transcribe job and reports overall status.
 */
import { GetTranscriptionJobCommand, TranscribeClient } from "@aws-sdk/client-transcribe"

const transcribe = new TranscribeClient({})

interface SegmentRef {
  segmentId: string
  jobName: string
}

interface Input {
  sessionId: string
  surgeonId: string
  procedureType: string
  segments: SegmentRef[]
}

export async function handler(input: Input) {
  if (input.segments.length === 0) {
    return { ...input, status: "COMPLETED", transcriptUris: [] as { segmentId: string; uri: string }[] }
  }

  const jobs = await Promise.all(
    input.segments.map((s) =>
      transcribe.send(new GetTranscriptionJobCommand({ TranscriptionJobName: s.jobName })),
    ),
  )

  const statuses = jobs.map((j) => j.TranscriptionJob?.TranscriptionJobStatus)

  if (statuses.some((s) => s === "FAILED")) {
    return { ...input, status: "FAILED" }
  }
  if (statuses.every((s) => s === "COMPLETED")) {
    const transcriptUris = jobs.map((j, i) => ({
      segmentId: input.segments[i].segmentId,
      uri: j.TranscriptionJob!.Transcript!.TranscriptFileUri as string,
    }))
    return { ...input, status: "COMPLETED", transcriptUris }
  }
  return { ...input, status: "IN_PROGRESS" }
}
