export interface ConfigBaseProps {
  persistNavigation: "always" | "dev" | "prod" | "never"
  catchErrors: "always" | "dev" | "prod" | "never"
  exitRoutes: string[]
  /** Base URL of the api-stack HTTP API (Cognito JWT authorizer). */
  API_URL: string
  /** Cognito User Pool ID from auth-stack outputs. */
  USER_POOL_ID: string
  /** Cognito User Pool App Client ID from auth-stack outputs. */
  USER_POOL_CLIENT_ID: string
  /** AWS region the auth-stack/api-stack are deployed to. */
  REGION: string
}

export type PersistNavigationConfig = ConfigBaseProps["persistNavigation"]

const BaseConfig: ConfigBaseProps = {
  // This feature is particularly useful in development mode, but
  // can be used in production as well if you prefer.
  persistNavigation: "dev",

  /**
   * Only enable if we're catching errors in the right environment
   */
  catchErrors: "always",

  /**
   * This is a list of all the route names that will exit the app if the back button
   * is pressed while in that screen. Only affects Android.
   */
  exitRoutes: ["ScribeQueue", "SurgeryList"],

  // Overridden per-environment in config.dev.ts / config.prod.ts once the
  // auth-stack / api-stack CDK outputs exist (see infra/ — Phase 4+).
  API_URL: "",
  USER_POOL_ID: "",
  USER_POOL_CLIENT_ID: "",
  REGION: "",
}

export default BaseConfig
