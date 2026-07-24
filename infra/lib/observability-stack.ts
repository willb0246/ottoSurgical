import * as cdk from "aws-cdk-lib"
import { Construct } from "constructs"

export interface ObservabilityStackProps extends cdk.StackProps {
  envName: string
}

/**
 * CloudWatch dashboard + Step Functions failure alarm (PRD §3.5).
 * Empty for now — filled in at PRD §5 build-sequence step 8.
 */
export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props)
  }
}
