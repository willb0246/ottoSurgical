import * as cdk from "aws-cdk-lib"
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2"
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers"
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations"
import * as cognito from "aws-cdk-lib/aws-cognito"
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"
import * as iam from "aws-cdk-lib/aws-iam"
import * as lambda from "aws-cdk-lib/aws-lambda"
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as sfn from "aws-cdk-lib/aws-stepfunctions"
import { Construct } from "constructs"
import * as path from "node:path"

export interface ApiStackProps extends cdk.StackProps {
  envName: string
  userPool: cognito.UserPool
  userPoolClient: cognito.UserPoolClient
  table: dynamodb.Table
  audioBucket: s3.Bucket
  stateMachine: sfn.StateMachine
  /** Specialty -> Transcribe vocabulary name, from PipelineStack — the record-at-review lambdas start their own Transcribe jobs. */
  vocabularyNameBySpecialty: Record<string, string>
}

/**
 * HTTP API + Cognito JWT authorizer + REST Lambdas (PRD §3.4). Every route
 * authorizes against the JWT's `sub` inside its own handler — a surgeon can
 * only read/write their own sessions. No admin/founder bypass in v1.
 */
export class ApiStack extends cdk.Stack {
  public readonly httpApi: apigwv2.HttpApi
  public readonly functions: lambda.IFunction[] = []

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props)

    const authorizer = new HttpJwtAuthorizer("JwtAuthorizer", props.userPool.userPoolProviderUrl, {
      jwtAudience: [props.userPoolClient.userPoolClientId],
    })

    this.httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      apiName: `ottosurgical-${props.envName}`,
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
        ],
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

    const listProceduresFn = new NodejsFunction(this, "ListProcedures", {
      entry: path.join(lambdaDir, "listProcedures.ts"),
      environment: commonEnv,
      bundling,
      runtime,
    })
    props.table.grantReadWriteData(listProceduresFn) // seeds defaults on first read

    const createProcedureFn = new NodejsFunction(this, "CreateProcedure", {
      entry: path.join(lambdaDir, "createProcedure.ts"),
      environment: commonEnv,
      bundling,
      runtime,
    })
    props.table.grantWriteData(createProcedureFn)

    const updateProcedureFn = new NodejsFunction(this, "UpdateProcedure", {
      entry: path.join(lambdaDir, "updateProcedure.ts"),
      environment: commonEnv,
      bundling,
      runtime,
    })
    props.table.grantReadWriteData(updateProcedureFn)

    const deleteProcedureFn = new NodejsFunction(this, "DeleteProcedure", {
      entry: path.join(lambdaDir, "deleteProcedure.ts"),
      environment: commonEnv,
      bundling,
      runtime,
    })
    props.table.grantWriteData(deleteProcedureFn)

    const getTemplateFn = new NodejsFunction(this, "GetTemplate", {
      entry: path.join(lambdaDir, "getTemplate.ts"),
      environment: commonEnv,
      bundling,
      runtime,
    })
    props.table.grantReadWriteData(getTemplateFn) // seeds defaults on first read

    const putTemplateFn = new NodejsFunction(this, "PutTemplate", {
      entry: path.join(lambdaDir, "putTemplate.ts"),
      environment: commonEnv,
      bundling,
      runtime,
    })
    props.table.grantWriteData(putTemplateFn)

    // Record-at-review (docs/templates.md §5 "No — record") — lightweight
    // start/poll pair, not a second Step Functions execution. Both need the
    // same specialty->vocabulary env vars and Transcribe IAM as
    // pipeline-stack.ts's startTranscriptionJobs.
    const recordEnv = {
      ...commonEnv,
      AUDIO_BUCKET_NAME: props.audioBucket.bucketName,
      VOCABULARY_NAME_ORTHO: props.vocabularyNameBySpecialty.ortho,
      VOCABULARY_NAME_ENDOVASCULAR: props.vocabularyNameBySpecialty.endovascular,
    }

    const startFieldRecordFn = new NodejsFunction(this, "StartFieldRecord", {
      entry: path.join(lambdaDir, "startFieldRecord.ts"),
      environment: recordEnv,
      bundling,
      runtime,
    })
    props.table.grantReadData(startFieldRecordFn)
    startFieldRecordFn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ["transcribe:StartTranscriptionJob"], resources: ["*"] }),
    )
    props.audioBucket.grantRead(startFieldRecordFn)

    const pollFieldRecordFn = new NodejsFunction(this, "PollFieldRecord", {
      entry: path.join(lambdaDir, "pollFieldRecord.ts"),
      environment: commonEnv,
      bundling,
      runtime,
    })
    props.table.grantReadWriteData(pollFieldRecordFn)
    pollFieldRecordFn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ["transcribe:GetTranscriptionJob"], resources: ["*"] }),
    )

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
    this.httpApi.addRoutes({
      path: "/procedures",
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("ListProceduresIntegration", listProceduresFn),
    })
    this.httpApi.addRoutes({
      path: "/procedures",
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("CreateProcedureIntegration", createProcedureFn),
    })
    this.httpApi.addRoutes({
      path: "/procedures/{procedureId}",
      methods: [apigwv2.HttpMethod.PUT],
      integration: new HttpLambdaIntegration("UpdateProcedureIntegration", updateProcedureFn),
    })
    this.httpApi.addRoutes({
      path: "/procedures/{procedureId}",
      methods: [apigwv2.HttpMethod.DELETE],
      integration: new HttpLambdaIntegration("DeleteProcedureIntegration", deleteProcedureFn),
    })
    this.httpApi.addRoutes({
      path: "/templates/{procedureId}",
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("GetTemplateIntegration", getTemplateFn),
    })
    this.httpApi.addRoutes({
      path: "/templates/{procedureId}",
      methods: [apigwv2.HttpMethod.PUT],
      integration: new HttpLambdaIntegration("PutTemplateIntegration", putTemplateFn),
    })
    this.httpApi.addRoutes({
      path: "/drafts/{sessionId}/fields/{fieldKey}/record",
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("StartFieldRecordIntegration", startFieldRecordFn),
    })
    this.httpApi.addRoutes({
      path: "/drafts/{sessionId}/fields/{fieldKey}/record",
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("PollFieldRecordIntegration", pollFieldRecordFn),
    })

    this.functions.push(
      getUploadUrlFn,
      ingestFn,
      getDraftsFn,
      getDraftFn,
      approveFn,
      listProceduresFn,
      createProcedureFn,
      updateProcedureFn,
      deleteProcedureFn,
      getTemplateFn,
      putTemplateFn,
      startFieldRecordFn,
      pollFieldRecordFn,
    )

    new cdk.CfnOutput(this, "ApiUrl", {
      value: this.httpApi.apiEndpoint,
      description: "EXPO_PUBLIC_API_URL",
    })
  }
}
