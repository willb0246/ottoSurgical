import * as cdk from "aws-cdk-lib"
import { Construct } from "constructs"

export interface PipelineStackProps extends cdk.StackProps {
  envName: string
}

/**
 * Step Functions Standard workflow: Transcribe -> post-correction ->
 * Bedrock generation -> provenance -> DraftNote write (PRD §3.3).
 * Empty for now — filled in at PRD §5 build-sequence step 5.
 */
export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props)
  }
}
