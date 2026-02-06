import { CfnOutput, Duration, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  Role,
  ServicePrincipal,
  ManagedPolicy,
  OpenIdConnectProvider,
  PolicyDocument,
  PolicyStatement,
  OpenIdConnectPrincipal,
} from "aws-cdk-lib/aws-iam";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Constants } from "../utils/constants";

/**
 * CiRoleStack - CI/CD role
 * Creates specific GitHub Actions role with scoped permissions
 * Each has its own role with access only to its resources
 */

export class CiRoleStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const constants = new Constants();
    // CI/CD Role for GitHub Actions
    const providerArn = StringParameter.valueForStringParameter(
      this,
      constants.GITHUB_OIDC_PROVIDER_SSM_PARAM,
    );

    const provider = OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      "GitHubProvider",
      providerArn,
    );

    const githubOrg = this.node.tryGetContext("githubOrg");
    const githubRepo = this.node.tryGetContext("githubRepo");

    const githubPrincipal = new OpenIdConnectPrincipal(provider).withConditions(
      {
        StringLike: {
          "token.actions.githubusercontent.com:sub": `repo:${githubOrg}/${githubRepo}:*`,
        },
      },
    );

    const ciRole = new Role(this, "GitHubActionsRole", {
      assumedBy: githubPrincipal,
      description: "Role assumed by GitHub Actions for CI/CD",
      roleName: constants.CI_ROLE_NAME,
      maxSessionDuration: Duration.hours(1),
      inlinePolicies: {
        CdkDeploymentPolicy: new PolicyDocument({
          assignSids: true,
          statements: [
            // // 0. STS - Assume CDK bootstrap roles (CRITICAL - must be first!)
            new PolicyStatement({
              sid: "AssumeBootstrapRoles",
              actions: ["sts:AssumeRole"],
              resources: [
                `arn:aws:iam::${this.account}:role/cdk-hnb659fds-deploy-role-*`,
                `arn:aws:iam::${this.account}:role/cdk-hnb659fds-file-publishing-role-*`,
                `arn:aws:iam::${this.account}:role/cdk-hnb659fds-lookup-role-*`,
              ],
            }),
            // 1. CloudFormation (CDK needs this)
            new PolicyStatement({
              sid: "CloudFormationFullAccess",
              actions: [
                "cloudformation:CreateStack",
                "cloudformation:UpdateStack",
                "cloudformation:DeleteStack",
                "cloudformation:DescribeStacks",
                "cloudformation:DescribeStackEvents",
                "cloudformation:GetTemplate",
              ],
              resources: [
                `arn:aws:cloudformation:${this.region}:${this.account}:stack/RecipeManager*/*`,
              ],
            }),
            // 2. Lambda deployment
            new PolicyStatement({
              sid: "LambdaDeployment",
              actions: [
                "lambda:CreateFunction",
                "lambda:UpdateFunctionCode",
                "lambda:UpdateFunctionConfiguration",
                "lambda:GetFunction",
                "lambda:DeleteFunction",
                "lambda:AddPermission",
                "lambda:RemovePermission",
              ],
              resources: [
                `arn:aws:lambda:${this.region}:${this.account}:function:recipe-manager-*`,
              ],
            }),
            // 3. DynamoDB (describe only - table created separately)
            new PolicyStatement({
              sid: "DynamoDBDescribe",
              actions: ["dynamodb:DescribeTable", "dynamodb:ListTables"],
              resources: [
                `arn:aws:dynamodb:${this.region}:${this.account}:table/recipes`,
              ],
            }),
            // 4. API Gateway deployment
            new PolicyStatement({
              sid: "ApiGatewayDeployment",
              actions: [
                "apigateway:GET",
                "apigateway:POST",
                "apigateway:PUT",
                "apigateway:PATCH",
                "apigateway:DELETE",
              ],
              resources: [`arn:aws:apigateway:${this.region}::/*`],
            }),
            // 5. IAM (create/update Lambda execution role)
            new PolicyStatement({
              sid: "IAMRoleManagement",
              actions: [
                "iam:CreateRole",
                "iam:DeleteRole",
                "iam:GetRole",
                "iam:PassRole",
                "iam:AttachRolePolicy",
                "iam:DetachRolePolicy",
                "iam:PutRolePolicy",
                "iam:DeleteRolePolicy",
                "iam:GetRolePolicy",
                "iam:TagRole",
              ],
              resources: [
                `arn:aws:iam::${this.account}:role/RecipeManager*`,
                `arn:aws:iam::${this.account}:role/cdk-*`, // CDK-managed roles
              ],
            }),
            // 6. S3 (CDK asset storage)
            new PolicyStatement({
              sid: "CDKAssetStorage",
              actions: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
              resources: [
                `arn:aws:s3:::cdk-*-assets-${this.account}-${this.region}`,
                `arn:aws:s3:::cdk-*-assets-${this.account}-${this.region}/*`,
              ],
            }),
            // 7. SSM (read parameters)
            new PolicyStatement({
              sid: "SSMParameterRead",
              actions: ["ssm:GetParameter", "ssm:GetParameters"],
              resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/cdk-bootstrap/*`,
                `arn:aws:ssm:${this.region}:${this.account}:parameter/recipe-manager/*`,
              ],
            }),
          ],
        }),
      },
    });

    // Output role ARN for GitHub Actions
    new CfnOutput(this, "CiRoleArn", {
      value: ciRole.roleArn,
      description: "ARN of GitHub Actions CI role",
      exportName: "RecipeManagerCiRoleArn",
    });
  }
}
