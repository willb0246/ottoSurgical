/**
 * Plain `fetch()` + Cognito ID-token bearer header — deliberately NOT
 * Amplify's SigV4 `get()`/`post()`, since api-stack's routes are behind a
 * Cognito User Pool JWT authorizer, not IAM (same reasoning as OpBuddy's
 * beaconFetch.ts, which this mirrors).
 */
import { fetchAuthSession } from "aws-amplify/auth"

async function idToken(): Promise<string> {
  const session = await fetchAuthSession()
  const token = session.tokens?.idToken?.toString()
  if (!token) throw new Error("Not authenticated — no Cognito token")
  return token
}

export async function beaconFetch<T = unknown>(
  baseUrl: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (!baseUrl) {
    throw new Error(`Beacon API base URL not configured for ${path}`)
  }
  const token = await idToken()
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Beacon API ${res.status}: ${text}`)
  }
  const body = await res.text()
  return (body ? JSON.parse(body) : undefined) as T
}
