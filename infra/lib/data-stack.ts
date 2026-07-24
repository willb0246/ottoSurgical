import * as cdk from "aws-cdk-lib"
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"
import * as kms from "aws-cdk-lib/aws-kms"
import * as s3 from "aws-cdk-lib/aws-s3"
import { Construct } from "constructs"

export interface DataStackProps extends cdk.StackProps {
  envName: string
}

/**
 * Single on-demand DynamoDB table (PRD §3.2 — SESSION#/SURGEON# item shapes)
 * plus the raw-audio S3 bucket, both encrypted with one customer-managed KMS
 * key. PHI-adjacent data, so: no public access, HTTPS-only bucket policy,
 * short audio retention (default 30 days — confirm with founder per PRD §6).
 */
export class DataStack extends cdk.Stack {
  public readonly encryptionKey: kms.Key
  public readonly table: dynamodb.Table
  public readonly audioBucket: s3.Bucket

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props)

    const isProd = props.envName === "prod"

    this.encryptionKey = new kms.Key(this, "EncryptionKey", {
      alias: `ottosurgical-${props.envName}`,
      description: `OttoSurgical (${props.envName}) — DynamoDB + S3 audio encryption`,
      enableKeyRotation: true,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    })

    // Logical model from PRD §3.2:
    //   SESSION#<sessionId> / META                  -> CaseSession
    //   SESSION#<sessionId> / SEGMENT#<segmentId>    -> segment metadata
    //   SESSION#<sessionId> / DRAFT                  -> DraftNote
    //   SESSION#<sessionId> / EDIT#<isoTimestamp>     -> EditLogEntry (append-only)
    // bySurgeon GSI (PK surgeonId, SK startedAt) makes `GET /drafts?surgeonId=` a Query.
    this.table = new dynamodb.Table(this, "Table", {
      tableName: `ottosurgical-${props.envName}`,
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.encryptionKey,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: isProd },
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    })

    this.table.addGlobalSecondaryIndex({
      indexName: "bySurgeon",
      partitionKey: { name: "surgeonId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "startedAt", type: dynamodb.AttributeType.STRING },
    })

    this.audioBucket = new s3.Bucket(this, "AudioBucket", {
      bucketName: `ottosurgical-audio-${props.envName}-${cdk.Aws.ACCOUNT_ID}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.encryptionKey,
      bucketKeyEnabled: true,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      lifecycleRules: [
        {
          // Parent PRD §7: "don't persist raw audio longer than needed to
          // generate + let the user verify" — placeholder default, confirm
          // with founder (PRD §6 open question).
          id: "expire-audio-after-30-days",
          enabled: true,
          expiration: cdk.Duration.days(30),
        },
      ],
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    })

    new cdk.CfnOutput(this, "TableName", { value: this.table.tableName })
    new cdk.CfnOutput(this, "AudioBucketName", { value: this.audioBucket.bucketName })
    new cdk.CfnOutput(this, "EncryptionKeyArn", { value: this.encryptionKey.keyArn })
  }
}
