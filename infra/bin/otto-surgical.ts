#!/usr/bin/env node
import "source-map-support/register"
import * as cdk from "aws-cdk-lib"

import { ApiStack } from "../lib/api-stack"
import { AuthStack } from "../lib/auth-stack"
import { DataStack } from "../lib/data-stack"
import { ObservabilityStack } from "../lib/observability-stack"
import { PipelineStack } from "../lib/pipeline-stack"

const app = new cdk.App()

// One CDK app, one environment per synth/deploy: `cdk deploy -c env=dev` (default: dev).
// This account also hosts many unrelated client projects — every stack/resource name
// below is prefixed `ottosurgical-{env}` so it's unambiguous in the shared account.
const envName = (app.node.tryGetContext("env") as string) ?? "dev"

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-west-2",
}

const tags = {
  Project: "OttoSurgical",
  Environment: envName,
}

const stackProps = { env, tags }

new AuthStack(app, `ottosurgical-${envName}-auth`, { ...stackProps, envName })
new DataStack(app, `ottosurgical-${envName}-data`, { ...stackProps, envName })

// Empty for now — filled in as the build sequence reaches them (PRD §5 steps 4/5/8).
new ApiStack(app, `ottosurgical-${envName}-api`, { ...stackProps, envName })
new PipelineStack(app, `ottosurgical-${envName}-pipeline`, { ...stackProps, envName })
new ObservabilityStack(app, `ottosurgical-${envName}-observability`, { ...stackProps, envName })
