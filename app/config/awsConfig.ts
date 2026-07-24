/**
 * Configures aws-amplify as a plain Cognito client SDK — no Amplify Gen 1
 * backend tooling, no Identity Pool, no SigV4 API calls. The auth-stack
 * User Pool is JWT-only (see infra/lib/auth-stack.ts); scribeApi.ts attaches
 * the ID token as a Bearer header itself via beaconFetch.ts.
 */
import { Amplify } from "aws-amplify"

import Config from "./index"

export function configureAmplify() {
  if (!Config.USER_POOL_ID || !Config.USER_POOL_CLIENT_ID) {
    // No auth-stack deployed yet (Phase 5) — skip rather than throw, so the
    // rest of the app is still usable against local/mock data.
    return
  }

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: Config.USER_POOL_ID,
        userPoolClientId: Config.USER_POOL_CLIENT_ID,
      },
    },
  })
}
