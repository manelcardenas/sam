#!/usr/bin/env node
import "source-map-support/register";
import { App } from "aws-cdk-lib";
import { GithubOidcProviderStack } from "../lib/foundation/github-oidc-provider-stack";
import { CiRoleStack } from "../lib/foundation/ci-role-stack";
import { DynamoDBStack } from "../lib/infrastructure/dynamodb-stack";
import { LambdaApiStack } from "../lib/application/lambda-api-stack";
import { CognitoStack } from "../lib/foundation/cognito-stack";
import { AmplifyStack } from "../lib/application/amplify-stack";

const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: "eu-west-3",
};

// Foundation (deploy once)
new GithubOidcProviderStack(app, "RecipeManagerOidcProviderStack", { env });
new CiRoleStack(app, "RecipeManagerCiRoleStack", { env });

// Cognito for authentication (foundation layer)
// Note: After first Amplify deployment, add amplifyDomain to cdk.context.json
// and redeploy Cognito to update OAuth callback URLs
const amplifyDomain = app.node.tryGetContext("amplifyDomain");
const cognitoStack = new CognitoStack(app, "RecipeManagerCognitoStack", {
  env,
  amplifyDomain,
});

// Infrastructure (deploy when changes)
new DynamoDBStack(app, "RecipeManagerDynamoDbStack", { env });

// Application (deploy frequently via CI/CD)
new LambdaApiStack(app, "RecipeManagerLambdaApiStack", { env }, cognitoStack);

// Frontend (Amplify)
new AmplifyStack(
  app,
  "RecipeManagerAmplifyStack",
  { env },
  {
    cognitoStack,
  },
);
