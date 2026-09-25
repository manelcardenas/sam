import {
  Stack,
  StackProps,
  CfnOutput,
  RemovalPolicy,
  SecretValue,
} from "aws-cdk-lib";
import { Construct } from "constructs/lib/construct";
import {
  AccountRecovery,
  CfnUserPoolGroup,
  OAuthScope,
  ProviderAttribute,
  UserPool,
  UserPoolClient,
  UserPoolClientIdentityProvider,
  UserPoolIdentityProviderGoogle,
} from "aws-cdk-lib/aws-cognito";
import * as ssm from "aws-cdk-lib/aws-ssm";

interface CognitoStackProps extends StackProps {
  amplifyDomain?: string; // Optional Amplify domain for OAuth callbacks
}

export class CognitoStack extends Stack {
  public readonly userPool: UserPool;
  public readonly userPoolClient: UserPoolClient;

  constructor(scope: Construct, id: string, props: CognitoStackProps = {}) {
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
          mutable: true, // Must be true for Google Social Login
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

    // Retrieve Google OAuth credentials from SSM Parameter Store
    const googleClientId = ssm.StringParameter.valueForStringParameter(
      this,
      "/recipe-manager/google-client-id",
    );

    const googleClientSecret = ssm.StringParameter.valueForStringParameter(
      this,
      "/recipe-manager/google-client-secret",
      1, // version
    );

    // Configure Google Identity Provider
    // Members may edit shared reference data — the grocery vocabulary, from the
    // profile's Admin tab. Membership rides in the ID token as `cognito:groups`,
    // which is what the API checks (`backend/src/infra/security/schemas.py`,
    // ADMIN_GROUP — the names must match). Nobody is added here: membership is
    // an AWS-side act, `aws cognito-idp admin-add-user-to-group`, so it can
    // never be granted through the app itself.
    new CfnUserPoolGroup(this, "AdminsGroup", {
      userPoolId: this.userPool.userPoolId,
      groupName: "admins",
      description: "Can edit and delete grocery vocabulary rows from the app",
    });

    const googleProvider = new UserPoolIdentityProviderGoogle(
      this,
      "GoogleProvider",
      {
        userPool: this.userPool,
        clientId: googleClientId,
        clientSecretValue: SecretValue.unsafePlainText(googleClientSecret),
        attributeMapping: {
          email: ProviderAttribute.GOOGLE_EMAIL,
          givenName: ProviderAttribute.GOOGLE_GIVEN_NAME,
          familyName: ProviderAttribute.GOOGLE_FAMILY_NAME,
        },
        scopes: ["profile", "email", "openid"],
      },
    );

    // Add Cognito domain for Hosted UI
    const domain = this.userPool.addDomain("CognitoDomain", {
      cognitoDomain: {
        domainPrefix: "sam-recipe-manager",
      },
    });

    // Create app client with OAuth support (for frontend to communicate with Cognito)
    const callbackUrls = [
      "http://localhost:8080", // Local development
    ];
    const logoutUrls = [
      "http://localhost:8080",
    ];

    // Add Amplify domain if provided
    if (props.amplifyDomain) {
      callbackUrls.push(props.amplifyDomain);
      logoutUrls.push(props.amplifyDomain);
    }

    this.userPoolClient = this.userPool.addClient("WebClient", {
      authFlows: {
        userPassword: true, // Enable username/password authentication
        userSrp: true, // Secure Remote Password protocol
      },
      generateSecret: false,
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [
          OAuthScope.EMAIL,
          OAuthScope.OPENID,
          OAuthScope.PROFILE,
          OAuthScope.COGNITO_ADMIN, // Required for fetchUserAttributes()
        ],
        callbackUrls,
        logoutUrls,
      },
      supportedIdentityProviders: [
        UserPoolClientIdentityProvider.COGNITO,
        UserPoolClientIdentityProvider.GOOGLE,
      ],
    });

    // Ensure Google provider is created before client
    this.userPoolClient.node.addDependency(googleProvider);

    // Outputs for frontend integration
    new CfnOutput(this, "UserPoolId", { value: this.userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", {
      value: this.userPoolClient.userPoolClientId,
    });
    new CfnOutput(this, "UserPoolRegion", { value: this.region });
    new CfnOutput(this, "UserPoolDomain", { value: domain.domainName });
  }
}
