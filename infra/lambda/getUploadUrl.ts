/**
 * POST /uploads/presign — the "out-of-band" S3 upload step the parent PRD
 * assumes exists (PRD §3.4). Returns a presigned PUT URL + the audioKey the
 * client then passes to /ingest.
 */
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda"

import { json, parseBody, surgeonIdFromEvent } from "./shared/http"

const s3 = new S3Client({})
const AUDIO_BUCKET_NAME = process.env.AUDIO_BUCKET_NAME as string

interface GetUploadUrlBody {
  sessionId: string
  segmentId: string
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  try {
    const surgeonId = surgeonIdFromEvent(event)
    const { sessionId, segmentId } = parseBody<GetUploadUrlBody>(event)
    if (!sessionId || !segmentId) return json(400, { error: "sessionId and segmentId required" })

    const audioKey = `sessions/${surgeonId}/${sessionId}/${segmentId}.wav`

    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: AUDIO_BUCKET_NAME,
        Key: audioKey,
        ContentType: "audio/wav",
      }),
      { expiresIn: 900 },
    )

    return json(200, { uploadUrl, audioKey })
  } catch (err) {
    console.error(err)
    return json(500, { error: (err as Error).message })
  }
}
