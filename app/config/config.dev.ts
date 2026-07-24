/**
 * These are configuration settings for the dev environment.
 *
 * Do not include API secrets in this file or anywhere in your JS.
 *
 * https://reactnative.dev/docs/security#storing-sensitive-info
 */
export default {
  // Filled in by hand (or a post-`cdk deploy` script) from the dev
  // auth-stack/api-stack CDK outputs — see infra/ (Phase 4+).
  API_URL: process.env.EXPO_PUBLIC_API_URL || "",
  USER_POOL_ID: process.env.EXPO_PUBLIC_USER_POOL_ID || "",
  USER_POOL_CLIENT_ID: process.env.EXPO_PUBLIC_USER_POOL_CLIENT_ID || "",
  REGION: process.env.EXPO_PUBLIC_REGION || "us-west-2",
}
