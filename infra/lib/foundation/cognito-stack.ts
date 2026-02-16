import { Stack, StackProps, CfnOutput, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs/lib/construct";
import {
  AccountRecovery,
  UserPool,
  UserPoolClient,
} from "aws-cdk-lib/aws-cognito";

export class CognitoStack extends Stack {
  public readonly userPool: UserPool;
  public readonly userPoolClient: UserPoolClient;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    this.userPool = new UserPool(this, "RecipeManagerUserPool", {
      userPoolName: "recipe-manager-users",
      selfSignUpEnabled: true, // Allow users to sign up themselves (disable to manage users manually)
      signInAliases: {
        email: true,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: false,
        },
        fullname: {
          required: false,
          mutable: true,
        },
        phoneNumber: {
          required: false,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.DESTROY, // will remove the user pool when the stack is deleted (Not good for production, but usefull for development and this project)
    });

    // Create app client (for frontend to communicate with Cognito)
    this.userPoolClient = this.userPool.addClient("WebClient", {
      authFlows: {
        userPassword: true, // Enable username/password authentication
        userSrp: true, // Secure Remote Password protocol (optional, but recommended)
      },
      generateSecret: false,
    });

    const domain = this.userPool.addDomain("CognitoDomain", {
      cognitoDomain: {
        domainPrefix: "sam-recipe-manager",
      },
    });

    // Outputs for frontend integration
    new CfnOutput(this, "UserPoolId", { value: this.userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", {
      value: this.userPoolClient.userPoolClientId,
    });
    new CfnOutput(this, "UserPoolRegion", { value: this.region });
    new CfnOutput(this, "UserPoolDomain", { value: domain.domainName });
  }
}
