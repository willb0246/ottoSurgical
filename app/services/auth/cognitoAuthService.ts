/**
 * Thin wrapper over aws-amplify/auth's Cognito client, returning a uniform
 * { success, ... } shape rather than throwing — same pattern as OpBuddy's
 * cognitoAuthService.ts. One user = one surgeon (parent PRD §3); no sign-up
 * flow here since accounts are provisioned out-of-band via the User Pool.
 */
import { fetchAuthSession, signIn, signOut } from "aws-amplify/auth"

export interface CognitoSignInResult {
  success: boolean
  idToken?: string
  userId?: string
  error?: string
}

export async function cognitoSignIn(
  email: string,
  password: string,
): Promise<CognitoSignInResult> {
  try {
    const result = await signIn({ username: email, password })

    if (!result.isSignedIn) {
      return { success: false, error: "Sign in incomplete. Additional steps required." }
    }

    const session = await fetchAuthSession()
    const idToken = session.tokens?.idToken?.toString()
    const userId = session.tokens?.idToken?.payload.sub as string | undefined

    if (!idToken) {
      return { success: false, error: "Signed in, but no Cognito token was issued." }
    }

    return { success: true, idToken, userId }
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "NotAuthorizedException") {
        return { success: false, error: "Incorrect email or password." }
      }
      if (error.name === "UserNotFoundException") {
        return { success: false, error: "No account found with this email." }
      }
      return { success: false, error: error.message }
    }
    return { success: false, error: "An unexpected error occurred." }
  }
}

export async function cognitoSignOut(): Promise<void> {
  await signOut()
}
