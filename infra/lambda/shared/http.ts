import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda"

export function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }
}

/** The Cognito `sub` claim — every wire-contract `surgeonId` is this value. */
export function surgeonIdFromEvent(event: APIGatewayProxyEventV2WithJWTAuthorizer): string {
  const sub = event.requestContext.authorizer.jwt.claims.sub
  if (typeof sub !== "string") throw new Error("Missing sub claim on authorized request")
  return sub
}

export function parseBody<T>(event: APIGatewayProxyEventV2WithJWTAuthorizer): T {
  if (!event.body) throw new Error("Missing request body")
  return JSON.parse(event.body) as T
}
