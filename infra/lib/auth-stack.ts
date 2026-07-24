import * as cdk from "aws-cdk-lib"
import * as cognito from "aws-cdk-lib/aws-cognito"
import { Construct } from "constructs"

export interface AuthStackProps extends cdk.StackProps {
  envName: string
}

/**
 * Cognito User Pool + one App Client. No Identity Pool — the app never
 * calls AWS directly; every request goes through api-stack's HTTP API,
 * which authorizes on the User Pool JWT (PRD §3.1). One user = one surgeon
 * for the prototype; `surgeonId` throughout the wire contract is the
 * Cognito `sub`. Users are provisioned out-of-band (admin-create-user),
 * not via self sign-up.
 */
export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool
  public readonly userPoolClient: cognito.UserPoolClient

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props)

    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `ottosurgical-${props.envName}`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: false },
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy:
        props.envName === "prod" ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    })

    this.userPoolClient = this.userPool.addClient("AppClient", {
      userPoolClientName: `ottosurgical-${props.envName}-app`,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false, // public client — mobile app, no client secret
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    })

    new cdk.CfnOutput(this, "UserPoolId", {
      value: this.userPool.userPoolId,
      description: "EXPO_PUBLIC_USER_POOL_ID",
    })
    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: this.userPoolClient.userPoolClientId,
      description: "EXPO_PUBLIC_USER_POOL_CLIENT_ID",
    })
  }
}
