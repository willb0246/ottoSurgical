import * as cdk from "aws-cdk-lib"
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2"
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as sfn from "aws-cdk-lib/aws-stepfunctions"
import { Construct } from "constructs"

export interface ObservabilityStackProps extends cdk.StackProps {
  envName: string
  stateMachine: sfn.StateMachine
  httpApi: apigwv2.HttpApi
  functions: lambda.IFunction[]
}

/**
 * CloudWatch dashboard (Step Functions success/failure, Lambda errors, API
 * Gateway 4xx/5xx) + one alarm on Step Functions execution failures (PRD
 * §3.5). Enough to know when a demo case silently failed to generate — full
 * production-grade observability is explicitly deferred.
 */
export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props)

    const succeeded = props.stateMachine.metricSucceeded({ label: "Succeeded" })
    const failed = props.stateMachine.metricFailed({ label: "Failed" })

    const lambdaErrorMetrics = props.functions.map((fn) =>
      fn.metricErrors({ label: fn.node.id }),
    )

    new cloudwatch.Dashboard(this, "Dashboard", {
      dashboardName: `ottosurgical-${props.envName}`,
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: "Pipeline executions",
            left: [succeeded, failed],
            width: 12,
          }),
          new cloudwatch.GraphWidget({
            title: "API Gateway errors",
            left: [props.httpApi.metricClientError({ label: "4xx" })],
            right: [props.httpApi.metricServerError({ label: "5xx" })],
            width: 12,
          }),
        ],
        [
          new cloudwatch.GraphWidget({
            title: "Lambda errors",
            left: lambdaErrorMetrics,
            width: 24,
          }),
        ],
      ],
    })

    // A failed demo case should be noticed, not discovered later — this is
    // the one alarm this prototype needs (PRD §3.5).
    new cloudwatch.Alarm(this, "PipelineFailedAlarm", {
      alarmName: `ottosurgical-${props.envName}-pipeline-failed`,
      alarmDescription: "A Step Functions pipeline execution failed.",
      metric: failed,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
  }
}
