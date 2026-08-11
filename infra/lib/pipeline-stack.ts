import * as cdk from "aws-cdk-lib"
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"
import * as iam from "aws-cdk-lib/aws-iam"
import * as lambda from "aws-cdk-lib/aws-lambda"
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs"
import * as logs from "aws-cdk-lib/aws-logs"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment"
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager"
import * as sqs from "aws-cdk-lib/aws-sqs"
import * as sfn from "aws-cdk-lib/aws-stepfunctions"
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks"
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources"
import { Construct } from "constructs"
import * as path from "node:path"

export interface PipelineStackProps extends cdk.StackProps {
  envName: string
  table: dynamodb.Table
  audioBucket: s3.Bucket
}

/**
 * One Transcribe custom vocabulary per Specialty (app/types/scribe.ts).
 * Each `file` is a table-format vocabulary (Phrase/SoundsLike/IPA/DisplayAs,
 * TAB-delimited — see infra/lib/vocabularies/) deployed to a dedicated
 * bucket and referenced via VocabularyFileUri, not the (AWS-deprecated)
 * inline Phrases list. Adding a specialty means adding both a vocab file
 * here and a case in startTranscriptionJobs.ts's specialty->vocabulary
 * mapping.
 */
const SPECIALTIES = [
  { key: "ortho", file: "OR-ortho-vocab.txt" },
  { key: "endovascular", file: "OR-endovascular-vocab.txt" },
] as const

/**
 * Step Functions Standard workflow (PRD §3.3): Transcribe (per segment) ->
 * wait/poll for completion -> post-correction -> Bedrock structured
 * generation -> provenance -> write DraftNote. Triggered by ingest's
 * StartExecution call on `endOfCase`, not a bucket/EventBridge trigger.
 */
export class PipelineStack extends cdk.Stack {
  public readonly stateMachine: sfn.StateMachine
  public readonly functions: lambda.IFunction[] = []
  /** Specialty -> Transcribe vocabulary name, exposed for ApiStack's record-at-review lambdas (shared/vocabulary.ts). */
  public readonly vocabularyNameBySpecialty: Record<string, string> = {}

  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props)

    // Amazon Transcribe custom vocabularies have no native CloudFormation
    // resource type — AwsCustomResource drives the CreateVocabulary API
    // directly. Vocabulary state goes PENDING -> READY asynchronously after
    // this returns; startTranscriptionJobs' Settings.VocabularyName won't
    // resolve until it reaches READY (check with `aws transcribe
    // get-vocabulary` after a fresh deploy, before the first real run).
    //
    // The vocab files are deployed to a bucket THIS stack owns, not the
    // shared CDK bootstrap assets bucket (via `Asset`) — Asset.bucket is an
    // imported reference with a token bucket name, and CDK's grantRead()
    // silently no-ops on it for a bare ServicePrincipal grantee (can't
    // prove same-account, and there's no IAM identity to attach a
    // principal-side policy to instead), so Transcribe never actually got
    // read access there.
    //
    // Even on a stack-owned bucket, a bare bucket-policy grant to the
    // transcribe.amazonaws.com service principal still failed ("S3 URI
    // can't be accessed") — so instead of relying on the bucket policy,
    // Transcribe assumes a dedicated role (DataAccessRoleArn), the
    // documented mechanism for exactly this (same pattern HealthScribe
    // requires outright).
    const vocabularyBucket = new s3.Bucket(this, "VocabularyBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })
    const vocabularyDeployment = new s3deploy.BucketDeployment(this, "VocabularyDeployment", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "vocabularies"))],
      destinationBucket: vocabularyBucket,
    })
    const vocabularyDataAccessRole = new iam.Role(this, "VocabularyDataAccessRole", {
      assumedBy: new iam.ServicePrincipal("transcribe.amazonaws.com", {
        conditions: { StringEquals: { "aws:SourceAccount": this.account } },
      }),
    })
    const vocabularyReadGrant = vocabularyBucket.grantRead(vocabularyDataAccessRole)

    const vocabularyResources: AwsCustomResource[] = []

    for (const specialty of SPECIALTIES) {
      const vocabularyName = `ottosurgical-${props.envName}-${specialty.key}`
      this.vocabularyNameBySpecialty[specialty.key] = vocabularyName

      const vocabularyParams = {
        VocabularyName: vocabularyName,
        LanguageCode: "en-US",
        VocabularyFileUri: `s3://${vocabularyBucket.bucketName}/${specialty.file}`,
        DataAccessRoleArn: vocabularyDataAccessRole.roleArn,
      }
      const vocabulary = new AwsCustomResource(this, `${specialty.key}Vocabulary`, {
        onCreate: {
          service: "Transcribe",
          action: "createVocabulary",
          parameters: vocabularyParams,
          physicalResourceId: PhysicalResourceId.of(vocabularyName),
        },
        onUpdate: {
          service: "Transcribe",
          action: "updateVocabulary",
          parameters: vocabularyParams,
          physicalResourceId: PhysicalResourceId.of(vocabularyName),
        },
        onDelete: {
          service: "Transcribe",
          action: "deleteVocabulary",
          parameters: { VocabularyName: vocabularyName },
        },
        policy: AwsCustomResourcePolicy.fromSdkCalls({
          resources: AwsCustomResourcePolicy.ANY_RESOURCE,
        }),
      })
      // This custom resource's own Lambda role needs iam:PassRole to hand
      // DataAccessRoleArn to Transcribe — CreateVocabulary/UpdateVocabulary
      // fail on that before ever getting to the S3 read otherwise.
      vocabularyDataAccessRole.grantPassRole(vocabulary.grantPrincipal)
      // Explicit ordering: the file must be deployed and the role's read
      // grant must be in effect before Transcribe is asked to assume it.
      vocabulary.node.addDependency(vocabularyDeployment)
      vocabularyReadGrant.applyBefore(vocabulary)
      vocabularyResources.push(vocabulary)
    }

    // Transcribe reads segment audio and (implicitly, via the calling
    // Lambda's own credentials) needs KMS access to the bucket's
    // customer-managed key — same-account S3 access needs no bucket-policy
    // grant, but the CMK's resource policy must explicitly allow the
    // service (KMS default-denies unless listed, even same-account).
    props.audioBucket.encryptionKey?.grantDecrypt(
      new iam.ServicePrincipal("transcribe.amazonaws.com"),
    )

    const dlq = new sqs.Queue(this, "PipelineDLQ", {
      queueName: `ottosurgical-${props.envName}-pipeline-dlq`,
    })

    const lambdaDir = path.join(__dirname, "..", "lambda")
    const commonEnv = { TABLE_NAME: props.table.tableName }
    const bundling = { externalModules: ["@aws-sdk/*"] }
    const runtime = lambda.Runtime.NODEJS_22_X

    const startTranscriptionJobs = new NodejsFunction(this, "StartTranscriptionJobs", {
      entry: path.join(lambdaDir, "pipeline", "startTranscriptionJobs.ts"),
      timeout: cdk.Duration.seconds(60),
      environment: {
        ...commonEnv,
        AUDIO_BUCKET_NAME: props.audioBucket.bucketName,
        VOCABULARY_NAME_ORTHO: this.vocabularyNameBySpecialty.ortho,
        VOCABULARY_NAME_ENDOVASCULAR: this.vocabularyNameBySpecialty.endovascular,
      },
      bundling,
      runtime,
    })
    for (const vocabulary of vocabularyResources) {
      startTranscriptionJobs.node.addDependency(vocabulary)
    }
    // Reads the surgeon's procedure record to resolve its specialty ->
    // vocabulary (also used further down the pipeline for the template).
    props.table.grantReadData(startTranscriptionJobs)
    startTranscriptionJobs.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["transcribe:StartTranscriptionJob"],
        resources: ["*"],
      }),
    )
    props.audioBucket.grantRead(startTranscriptionJobs)

    const checkTranscriptionStatus = new NodejsFunction(this, "CheckTranscriptionStatus", {
      entry: path.join(lambdaDir, "pipeline", "checkTranscriptionStatus.ts"),
      timeout: cdk.Duration.seconds(30),
      bundling,
      runtime,
    })
    checkTranscriptionStatus.addToRolePolicy(
      new iam.PolicyStatement({ actions: ["transcribe:GetTranscriptionJob"], resources: ["*"] }),
    )

    const postCorrection = new NodejsFunction(this, "PostCorrection", {
      entry: path.join(lambdaDir, "pipeline", "postCorrection.ts"),
      timeout: cdk.Duration.seconds(60),
      bundling,
      runtime,
    })

    // Anthropic API key — this Lambda calls Anthropic directly, not Bedrock
    // (see project memory "decision_llm_provider"). Reuses the existing
    // beacon/anthropic_api_key secret (plaintext string value) rather than
    // provisioning a new one.
    const anthropicApiKeySecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "AnthropicApiKey",
      "beacon/anthropic_api_key",
    )

    const generateNote = new NodejsFunction(this, "GenerateNote", {
      entry: path.join(lambdaDir, "pipeline", "generateNote.ts"),
      timeout: cdk.Duration.seconds(120),
      memorySize: 512,
      environment: {
        ...commonEnv,
        ANTHROPIC_API_KEY_SECRET_ARN: anthropicApiKeySecret.secretArn,
      },
      bundling,
      runtime,
    })
    anthropicApiKeySecret.grantRead(generateNote)
    props.table.grantReadData(generateNote) // reads the surgeon's saved template, if any

    const computeProvenance = new NodejsFunction(this, "ComputeProvenance", {
      entry: path.join(lambdaDir, "pipeline", "computeProvenance.ts"),
      timeout: cdk.Duration.seconds(30),
      bundling,
      runtime,
    })

    const writeDraft = new NodejsFunction(this, "WriteDraft", {
      entry: path.join(lambdaDir, "pipeline", "writeDraft.ts"),
      timeout: cdk.Duration.seconds(30),
      environment: commonEnv,
      bundling,
      runtime,
    })
    props.table.grantWriteData(writeDraft)

    this.functions.push(
      startTranscriptionJobs,
      checkTranscriptionStatus,
      postCorrection,
      generateNote,
      computeProvenance,
      writeDraft,
    )

    const logGroup = new logs.LogGroup(this, "StateMachineLogs", {
      logGroupName: `/aws/vendedlogs/states/ottosurgical-${props.envName}-pipeline`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    const notifyFailure = new tasks.SqsSendMessage(this, "NotifyFailure", {
      queue: dlq,
      messageBody: sfn.TaskInput.fromJsonPathAt("$"),
    }).next(new sfn.Fail(this, "PipelineFailed"))

    const startJobsTask = new tasks.LambdaInvoke(this, "StartTranscriptionJobsTask", {
      lambdaFunction: startTranscriptionJobs,
      outputPath: "$.Payload",
    })

    const checkStatusTask = new tasks.LambdaInvoke(this, "CheckTranscriptionStatusTask", {
      lambdaFunction: checkTranscriptionStatus,
      outputPath: "$.Payload",
    })

    const waitForTranscription = new sfn.Wait(this, "WaitForTranscription", {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(20)),
    })

    const postCorrectionTask = new tasks.LambdaInvoke(this, "PostCorrectionTask", {
      lambdaFunction: postCorrection,
      outputPath: "$.Payload",
    })

    const generateNoteTask = new tasks.LambdaInvoke(this, "GenerateNoteTask", {
      lambdaFunction: generateNote,
      outputPath: "$.Payload",
    })

    const computeProvenanceTask = new tasks.LambdaInvoke(this, "ComputeProvenanceTask", {
      lambdaFunction: computeProvenance,
      outputPath: "$.Payload",
    })

    const writeDraftTask = new tasks.LambdaInvoke(this, "WriteDraftTask", {
      lambdaFunction: writeDraft,
      outputPath: "$.Payload",
    })

    const afterTranscription = postCorrectionTask
      .next(generateNoteTask)
      .next(computeProvenanceTask)
      .next(writeDraftTask)

    const transcriptionPollLoop = waitForTranscription
      .next(checkStatusTask)
      .next(
        new sfn.Choice(this, "IsTranscriptionDone")
          .when(sfn.Condition.stringEquals("$.status", "COMPLETED"), afterTranscription)
          .when(sfn.Condition.stringEquals("$.status", "FAILED"), notifyFailure)
          .otherwise(waitForTranscription),
      )

    const definition = startJobsTask.next(transcriptionPollLoop)

    // DLQ on the Transcribe-completion wait and on both generation Lambdas
    // (PRD §3.3) — any unhandled failure in the chain routes here instead of
    // leaving the execution to fail invisibly.
    for (const task of [
      startJobsTask,
      checkStatusTask,
      postCorrectionTask,
      generateNoteTask,
      computeProvenanceTask,
      writeDraftTask,
    ]) {
      task.addCatch(notifyFailure, { resultPath: "$.error" })
    }

    this.stateMachine = new sfn.StateMachine(this, "StateMachine", {
      stateMachineName: `ottosurgical-${props.envName}-pipeline`,
      stateMachineType: sfn.StateMachineType.STANDARD,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.minutes(30),
      logs: { destination: logGroup, level: sfn.LogLevel.ALL },
    })
  }
}
