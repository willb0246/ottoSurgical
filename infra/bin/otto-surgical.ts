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

const authStack = new AuthStack(app, `ottosurgical-${envName}-auth`, { ...stackProps, envName })
const dataStack = new DataStack(app, `ottosurgical-${envName}-data`, { ...stackProps, envName })

const pipelineStack = new PipelineStack(app, `ottosurgical-${envName}-pipeline`, {
  ...stackProps,
  envName,
  table: dataStack.table,
  audioBucket: dataStack.audioBucket,
})

const apiStack = new ApiStack(app, `ottosurgical-${envName}-api`, {
  ...stackProps,
  envName,
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
  table: dataStack.table,
  audioBucket: dataStack.audioBucket,
  stateMachine: pipelineStack.stateMachine,
})

new ObservabilityStack(app, `ottosurgical-${envName}-observability`, {
  ...stackProps,
  envName,
  stateMachine: pipelineStack.stateMachine,
  httpApi: apiStack.httpApi,
  functions: [...pipelineStack.functions, ...apiStack.functions],
})
