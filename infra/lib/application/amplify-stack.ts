import { Annotations, CfnOutput, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { CfnApp, CfnBranch } from "aws-cdk-lib/aws-amplify";
import { CognitoStack } from "../foundation/cognito-stack";

/**
 * AmplifyStack - Frontend hosting with AWS Amplify
 * Deploys Next.js frontend with automatic builds from GitHub
 * Environment variables automatically injected from Cognito and API Gateway outputs
 *
 * NOTE: The GitHub PAT is passed via CDK context key "githubToken".
 * It is read from SSM at deploy time by the CI step (or locally) and passed with --context.
 * CloudFormation does NOT support SSM SecureString references in AWS::Amplify::App.
 *
 * Locally:
 *   GITHUB_TOKEN=$(aws ssm get-parameter --name /recipe-manager/github-token \
 *     --with-decryption --query Parameter.Value --output text --region eu-west-3)
 *   npx cdk deploy RecipeManagerAmplifyStack --context githubToken=$GITHUB_TOKEN
 */

interface AmplifyStackDependencies {
  cognitoStack: CognitoStack;
}

export class AmplifyStack extends Stack {
  public readonly amplifyApp: CfnApp;
  public readonly amplifyDomain: string;

  constructor(scope: Construct, id: string, props: StackProps, deps: AmplifyStackDependencies) {
    super(scope, id, props);

    const { cognitoStack } = deps;

    // GitHub PAT passed via CDK context at deploy time (never stored in CloudFormation template).
    // CloudFormation does not support SSM SecureString references in AWS::Amplify::App.
    // Always pass with: --context githubToken=$(aws ssm get-parameter --name /recipe-manager/github-token --with-decryption --query Parameter.Value --output text --region eu-west-3)
    const githubToken = (this.node.tryGetContext("githubToken") as string | undefined) ?? "";
    if (!githubToken) {
      // Emit a CDK annotation rather than hard-crashing so other stacks can still be synthesized.
      // Deploying this stack without the token will fail at CloudFormation level.
      Annotations.of(this).addWarning(
        'CDK context "githubToken" is missing. Pass it with --context githubToken=<value>. ' +
        "Read from SSM: aws ssm get-parameter --name /recipe-manager/github-token --with-decryption --query Parameter.Value --output text --region eu-west-3",
      );
    }

    // Get GitHub org/repo from CDK context (set in cdk.json)
    const githubOrg = this.node.tryGetContext("githubOrg") || "manelcardenas";
    const githubRepo = this.node.tryGetContext("githubRepo") || "sam";

    // API endpoint is read from context (set in cdk.json after first LambdaApiStack deploy).
    // We intentionally avoid a cross-stack CloudFormation Fn::ImportValue reference here:
    // that would lock the LambdaApiStack export and prevent it from being updated independently.
    const apiEndpoint = (this.node.tryGetContext("apiEndpoint") as string | undefined) ?? "";
    if (!apiEndpoint) {
      Annotations.of(this).addWarning(
        'CDK context "apiEndpoint" is missing. Add it to cdk.json after deploying LambdaApiStack.',
      );
    }

    // Create Amplify App
    this.amplifyApp = new CfnApp(this, "RecipeManagerApp", {
      name: "recipe-manager-frontend",
      description: "Recipe Manager Next.js frontend with Cognito authentication",
      repository: `https://github.com/${githubOrg}/${githubRepo}`,
      accessToken: githubToken, // GitHub PAT for repo access
      platform: "WEB", // Static export - all pages are "use client", no SSR needed
      // Fallback buildSpec stored in CloudFormation - overridden by amplify.yml in the repo.
      // Uses static export (output: 'export' in next.config.ts) - all pages are "use client"
      // so no SSR is needed. Artifacts come from frontend/out (not frontend/.next).
      //
      // KEEP IN SYNC WITH amplify.yml. This copy only runs if amplify.yml is
      // missing or renamed - which is exactly when a stale copy would be at its
      // most confusing, since it would fail on commands the repo outgrew.
      buildSpec: `version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci -w frontend --include-workspace-root
    build:
      commands:
        - npm run build -w frontend
  artifacts:
    baseDirectory: frontend/out
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
`,
      environmentVariables: [
        {
          name: "NEXT_PUBLIC_AWS_REGION",
          value: this.region,
        },
        {
          name: "NEXT_PUBLIC_USER_POOL_ID",
          value: cognitoStack.userPool.userPoolId,
        },
        {
          name: "NEXT_PUBLIC_USER_POOL_CLIENT_ID",
          value: cognitoStack.userPoolClient.userPoolClientId,
        },
        {
          name: "NEXT_PUBLIC_COGNITO_DOMAIN",
          value: "sam-recipe-manager", // From cognito-stack.ts
        },
        {
          name: "NEXT_PUBLIC_API_URL",
          value: apiEndpoint,
        },
      ],
    });

    // Create main branch
    // Auto-build is disabled: webhooks require admin:repo_hook PAT scope.
    // Builds are triggered explicitly from the CI workflow via `aws amplify start-job`.
    new CfnBranch(this, "MainBranch", {
      appId: this.amplifyApp.attrAppId,
      branchName: "main",
      enableAutoBuild: false,
      enablePullRequestPreview: false,
      framework: "Next.js - SSR",
      stage: "PRODUCTION",
    });

    // Construct the Amplify domain (format: https://main.dXXXXXXXXXX.amplifyapp.com)
    this.amplifyDomain = `https://main.${this.amplifyApp.attrDefaultDomain}`;

    // Outputs
    new CfnOutput(this, "AmplifyAppId", {
      value: this.amplifyApp.attrAppId,
      description: "Amplify App ID",
      exportName: "RecipeManagerAmplifyAppId",
    });

    new CfnOutput(this, "AmplifyDefaultDomain", {
      value: this.amplifyApp.attrDefaultDomain,
      description: "Amplify default domain",
      exportName: "RecipeManagerAmplifyDefaultDomain",
    });

    new CfnOutput(this, "AmplifyAppUrl", {
      value: this.amplifyDomain,
      description: "Amplify app URL (main branch)",
      exportName: "RecipeManagerAmplifyAppUrl",
    });
  }
}
