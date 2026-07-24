import * as cdk from "aws-cdk-lib"
import { Construct } from "constructs"

export interface ApiStackProps extends cdk.StackProps {
  envName: string
}

/**
 * HTTP API + Cognito JWT authorizer + REST Lambdas (PRD §3.4).
 * Empty for now — filled in at PRD §5 build-sequence step 4 (ingest path:
 * /uploads/presign, /ingest) and step 6 (review path: /drafts, /draft,
 * /approve).
 */
export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props)
  }
}
