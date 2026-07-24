import * as path from "node:path"

import * as cdk from "aws-cdk-lib"
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2"
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers"
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations"
import * as cognito from "aws-cdk-lib/aws-cognito"
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"
import * as lambda from "aws-cdk-lib/aws-lambda"
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as sfn from "aws-cdk-lib/aws-stepfunctions"
import { Construct } from "constructs"

export interface ApiStackProps extends cdk.StackProps {
  envName: string
  userPool: cognito.UserPool
  userPoolClient: cognito.UserPoolClient
  table: dynamodb.Table
  audioBucket: s3.Bucket
  stateMachine: sfn.StateMachine
}

/**
 * HTTP API + Cognito JWT authorizer + REST Lambdas (PRD §3.4). Every route
 * authorizes against the JWT's `sub` inside its own handler — a surgeon can
 * only read/write their own sessions. No admin/founder bypass in v1.
 */
export class ApiStack extends cdk.Stack {
  public readonly httpApi: apigwv2.HttpApi

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props)

    const authorizer = new HttpJwtAuthorizer("JwtAuthorizer", props.userPool.userPoolProviderUrl, {
      jwtAudience: [props.userPoolClient.userPoolClientId],
    })

    this.httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      apiName: `ottosurgical-${props.envName}`,
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST],
        allowHeaders: ["Content-Type", "Authorization"],
      },
      defaultAuthorizer: authorizer,
    })

    const lambdaDir = path.join(__dirname, "..", "lambda")
    const bundling = { externalModules: ["@aws-sdk/*"] }
    const runtime = lambda.Runtime.NODEJS_22_X
    const commonEnv = { TABLE_NAME: props.table.tableName }

    const getUploadUrlFn = new NodejsFunction(this, "GetUploadUrl", {
      entry: path.join(lambdaDir, "getUploadUrl.ts"),
      environment: { AUDIO_BUCKET_NAME: props.audioBucket.bucketName },
      bundling,
      runtime,
    })
    props.audioBucket.grantPut(getUploadUrlFn)

    const ingestFn = new NodejsFunction(this, "Ingest", {
      entry: path.join(lambdaDir, "ingest.ts"),
      environment: { ...commonEnv, STATE_MACHINE_ARN: props.stateMachine.stateMachineArn },
      bundling,
      runtime,
    })
    props.table.grantReadWriteData(ingestFn)
    props.stateMachine.grantStartExecution(ingestFn)

    const getDraftsFn = new NodejsFunction(this, "GetDrafts", {
      entry: path.join(lambdaDir, "getDrafts.ts"),
      environment: commonEnv,
      bundling,
      runtime,
    })
    props.table.grantReadData(getDraftsFn)

    const getDraftFn = new NodejsFunction(this, "GetDraft", {
      entry: path.join(lambdaDir, "getDraft.ts"),
      environment: commonEnv,
      bundling,
      runtime,
    })
    props.table.grantReadData(getDraftFn)

    const approveFn = new NodejsFunction(this, "Approve", {
      entry: path.join(lambdaDir, "approve.ts"),
      environment: commonEnv,
      bundling,
      runtime,
    })
    props.table.grantReadWriteData(approveFn)

    this.httpApi.addRoutes({
      path: "/uploads/presign",
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("GetUploadUrlIntegration", getUploadUrlFn),
    })
    this.httpApi.addRoutes({
      path: "/ingest",
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("IngestIntegration", ingestFn),
    })
    this.httpApi.addRoutes({
      path: "/drafts",
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("GetDraftsIntegration", getDraftsFn),
    })
    this.httpApi.addRoutes({
      path: "/draft",
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("GetDraftIntegration", getDraftFn),
    })
    this.httpApi.addRoutes({
      path: "/approve",
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("ApproveIntegration", approveFn),
    })

    new cdk.CfnOutput(this, "ApiUrl", { value: this.httpApi.apiEndpoint, description: "EXPO_PUBLIC_API_URL" })
  }
}
