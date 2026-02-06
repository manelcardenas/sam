import { CfnOutput, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { OpenIdConnectProvider } from "aws-cdk-lib/aws-iam";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Constants } from "../utils/constants";
/**
 * GithubOidcProviderStack - Shared OIDC Provider
 * Creates a GitHub OIDC provider
 * Provider ARN is exported to SSM for lookup by CI role stacks
 */
export class GithubOidcProviderStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // Shared GitHub OIDC Provider for all environments
    const provider = new OpenIdConnectProvider(this, "GitHubProvider", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
    });

    new StringParameter(this, "GitHubOidcProviderArnParameter", {
      parameterName: new Constants().GITHUB_OIDC_PROVIDER_SSM_PARAM,
      stringValue: provider.openIdConnectProviderArn,
      description: "ARN of the GitHub OIDC Provider for CI/CD roles",
    });

    new CfnOutput(this, "GitHubOidcProviderArn", {
      value: provider.openIdConnectProviderArn,
      description: "ARN of the GitHub OIDC Provider for CI/CD roles",
    });
  }
}
