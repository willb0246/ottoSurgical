/**
 * These are configuration settings for the production environment.
 *
 * Do not include API secrets in this file or anywhere in your JS.
 *
 * https://reactnative.dev/docs/security#storing-sensitive-info
 */
export default {
  API_URL: process.env.EXPO_PUBLIC_API_URL || "",
  USER_POOL_ID: process.env.EXPO_PUBLIC_USER_POOL_ID || "",
  USER_POOL_CLIENT_ID: process.env.EXPO_PUBLIC_USER_POOL_CLIENT_ID || "",
  REGION: process.env.EXPO_PUBLIC_REGION || "us-west-2",
}
